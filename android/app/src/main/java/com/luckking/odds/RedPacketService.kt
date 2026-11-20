package com.luckking.odds

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 无障碍读屏服务（纯只读）：
 * 监听微信窗口内容，把红包详情页的可见文本按屏幕纵向顺序收集成「行序列」，
 * 推给 MainActivity 的 WebView（H5 内已有同样的解析与计算逻辑）。
 *
 * 绝不模拟点击、不修改微信、不发送网络请求。
 */
class RedPacketService : AccessibilityService() {

    companion object {
        /** 最近一次收集到的行文本（WebView 页面加载完成后补推用） */
        @Volatile
        var pendingRows: String? = null
            private set

        /** 最近一次收到微信事件的时刻（用于诊断服务是否在收事件） */
        @Volatile
        var lastEventTime: String = "尚未收到"

        /** 处理链路追踪（最新在前，H5 状态卡直接显示） */
        @Volatile
        var debugLog: String = "（暂无记录）"

        /** MainActivity 就绪后把数据直接推进 H5；未就绪时回退到悬浮窗 */
        @Volatile
        var uiSink: ((String) -> Unit)? = null
    }

    private val handler = Handler(Looper.getMainLooper())
    private var pending = false
    private var lastSent: String? = null

    private fun dbg(msg: String) {
        val ts = SimpleDateFormat("HH:mm:ss.SSS", Locale.CHINA).format(Date())
        debugLog = "[$ts] $msg\n" + debugLog.take(2000)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg != "com.tencent.mm") return
        lastEventTime = SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date())

        val type = event.eventType
        val typeName = when (type) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "窗口切换"
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "内容变化"
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> "滚动"
            else -> "type=$type"
        }
        val relevant = type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
            type == AccessibilityEvent.TYPE_VIEW_SCROLLED
        if (!relevant) {
            dbg("收到微信事件（$typeName）→ 非关注类型，跳过")
            return
        }
        dbg("收到微信事件（$typeName）→ 700ms 后读屏")
        if (pending) {
            dbg("已有待处理任务，合并本次")
            return
        }
        pending = true
        handler.postDelayed({ pending = false; collect() }, 700)
    }

    private fun collect() {
        try {
            collectInner()
        } catch (e: Exception) {
            dbg("collect 异常: " + (e.message ?: e.javaClass.simpleName))
            FloatingResult.show(this, "读取节点出错: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun collectInner() {
        val root: AccessibilityNodeInfo = rootInActiveWindow
        if (root == null) {
            dbg("✗ rootInActiveWindow=null（活动窗口不可读取）")
            return
        }
        val rootPkg = root.packageName?.toString() ?: "?"
        // 核心校验：只处理微信窗口。事件到达后 700ms 内用户可能切回桌面/本应用，
        // 此时 rootInActiveWindow 已不是微信——读到的是别的窗口内容，必须跳过
        if (rootPkg != "com.tencent.mm") {
            dbg("✗ 跳过：当前活动窗口是 $rootPkg（不是微信），不处理")
            return
        }

        // 关键：红包详情页的内容可能在独立的窗口层（rootInActiveWindow 子树可能为空），
        // 因此遍历系统所有可见窗口，收集微信全部窗口的节点
        val windowRoots = mutableListOf<Pair<String, AccessibilityNodeInfo>>()
        windowRoots.add("活动窗口" to root)
        try {
            for (w in windows) {
                val wr = w.root ?: continue
                val wp = wr.packageName?.toString() ?: continue
                if (wp == "com.tencent.mm" && wr != root) {
                    windowRoots.add("窗口#" + w.id + "(layer=" + w.layer + ")" to wr)
                }
            }
        } catch (e: Exception) {
            dbg("遍历 windows 异常: " + (e.message ?: e.javaClass.simpleName))
        }
        dbg("候选窗口 " + windowRoots.size + " 个（活动窗口 + 微信其他窗口）")

        val nodes = mutableListOf<Pair<Int, String>>()
        val seen = HashSet<String>()
        var windowStat = StringBuilder()
        for ((label, wroot) in windowRoots) {
            var count = 0
            fun walk(n: AccessibilityNodeInfo?) {
                if (n == null) return
                n.text?.toString()?.takeIf { it.isNotBlank() }?.let { text ->
                    val rect = android.graphics.Rect()
                    n.getBoundsInScreen(rect)
                    val key = rect.top.toString() + "|" + text
                    if (seen.add(key)) {
                        nodes.add(rect.top to text)
                        count++
                    }
                }
                for (i in 0 until n.childCount) walk(n.getChild(i))
            }
            walk(wroot)
            windowStat.append(label).append("=").append(count).append("个 ")
        }
        dbg("各窗口节点数: " + windowStat + "（合并去重后 " + nodes.size + " 个）")
        dbg("root=微信，收集到 ${nodes.size} 个文本节点")

        if (nodes.isEmpty()) {
            dbg("✗ 荣耀/华为系 ROM 已隔离微信窗口内容（第三方无障碍读不到）——请改用截图方式：微信里截图 → 打开本应用自动识别")
            return
        }
        val rows = nodes.sortedBy { it.first }.joinToString("\n") { it.second }

        if (!rows.contains("元")) {
            dbg("✗ 过滤：行文本中没有「元」字（不是红包详情页）前60字=" + rows.take(60).replace("\n", " / "))
            return
        }
        val looksLikeRedPacket = rows.contains("红包") ||
            rows.contains("已领取") ||
            rows.contains("手气最佳") ||
            rows.contains("运气王")
        if (!looksLikeRedPacket) {
            dbg("✗ 过滤：有金额但无红包特征词 前60字=" + rows.take(60).replace("\n", " / "))
            return
        }
        if (rows == lastSent) {
            dbg("内容与上次相同，跳过推送")
            return
        }

        dbg("✓ 通过全部过滤 → 弹悬浮窗 + 推送 H5")
        lastSent = rows
        pendingRows = rows
        // 双通道：悬浮窗始终弹出（叠加层自带权限）；MainActivity 存活时 WebView 同步收数据
        FloatingResult.show(this, rows)
        val sink = uiSink
        if (sink != null) sink(rows)
    }

    override fun onInterrupt() {
        dbg("服务被系统中断 onInterrupt")
    }
}
