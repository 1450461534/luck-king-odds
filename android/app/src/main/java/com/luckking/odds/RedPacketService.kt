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

        /** MainActivity 就绪后把数据直接推进 H5；未就绪时回退到悬浮窗 */
        @Volatile
        var uiSink: ((String) -> Unit)? = null
    }

    private val handler = Handler(Looper.getMainLooper())
    private var pending = false
    private var lastSent: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg != "com.tencent.mm") return
        lastEventTime = SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date())

        val type = event.eventType
        val relevant = type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
            type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
            type == AccessibilityEvent.TYPE_VIEW_SCROLLED
        if (!relevant) return
        if (pending) return
        pending = true
        handler.postDelayed({ pending = false; collect() }, 700)
    }

    /** 深度遍历节点树，收集 (纵向坐标, 文本)，按 y 排序拼成行序列 */
    private fun collect() {
        try {
            collectInner()
        } catch (e: Exception) {
            // 错误可见化：悬浮窗直接显示异常信息，便于远程排查
            FloatingResult.show(this, "读取节点出错: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun collectInner() {
        val root: AccessibilityNodeInfo = rootInActiveWindow ?: return
        val nodes = mutableListOf<Pair<Int, String>>()
        fun walk(n: AccessibilityNodeInfo?) {
            if (n == null) return
            n.text?.toString()?.takeIf { it.isNotBlank() }?.let { text ->
                val rect = android.graphics.Rect()
                n.getBoundsInScreen(rect)
                nodes.add(rect.top to text)
            }
            for (i in 0 until n.childCount) walk(n.getChild(i))
        }
        walk(root)

        if (nodes.isEmpty()) return
        val rows = nodes.sortedBy { it.first }.joinToString("\n") { it.second }

        // 只在像「红包详情页」时推送：出现金额 + 红包特征文案
        if (!rows.contains("元")) return
        val looksLikeRedPacket = rows.contains("红包") ||
            rows.contains("已领取") ||
            rows.contains("手气最佳") ||
            rows.contains("运气王")
        if (!looksLikeRedPacket) return
        if (rows == lastSent) return

        lastSent = rows
        pendingRows = rows
        // 双通道：悬浮窗始终弹出（叠加层自带权限）；MainActivity 存活时 WebView 同步收数据
        FloatingResult.show(this, rows)
        val sink = uiSink
        if (sink != null) sink(rows)
    }

    override fun onInterrupt() {
        // 服务中断时无需处理
    }
}
