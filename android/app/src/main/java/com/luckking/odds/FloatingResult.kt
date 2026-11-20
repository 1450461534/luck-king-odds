package com.luckking.odds

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * 无障碍叠加层悬浮提示（TYPE_ACCESSIBILITY_OVERLAY）：
 * 检测到红包详情页时提示用户，点击「查看预测」打开 WebView 页面。
 * 依托无障碍服务自身的叠加层，不需要「悬浮窗」权限。
 */
object FloatingResult {

    private val main = Handler(Looper.getMainLooper())
    private var view: LinearLayout? = null
    private var summaryView: TextView? = null
    private var windowManager: WindowManager? = null

    fun show(context: Context, rows: String) {
        main.post { showInternal(context.applicationContext, rows) }
    }

    /** H5 计算完成后更新悬浮摘要（任意线程调用，内部切主线程） */
    fun updateSummary(resultJson: String) {
        main.post {
            val v = summaryView ?: return@post
            try {
                val json = JSONObject(resultJson)
                val text = when {
                    json.optBoolean("isFinished") -> "🧧 红包已抢完，运气王已判定（打开应用查看）"
                    json.has("pLuckyMe") ->
                        "🔮 你成为运气王的概率 ≈ " +
                            String.format("%.1f%%", json.optDouble("pLuckyMe") * 100)
                    else -> return@post
                }
                v.text = text
            } catch (_: Exception) {
            }
        }
    }

    private fun showInternal(context: Context, rows: String) {
        if (view != null) {
            summaryView?.text = "已读取 " + rows.split("\n").size + " 行文本"
            return
        }
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        val density = context.resources.displayMetrics.density
        fun dp(v: Int): Int = (v * density).toInt()

        val box = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(Color.WHITE)
            }
            elevation = dp(8).toFloat()
        }

        val title = TextView(context).apply {
            text = "🧧 检测到红包详情页"
            textSize = 15f
            setTypeface(null, Typeface.BOLD)
            setTextColor(Color.parseColor("#d0453e"))
        }

        val summary = TextView(context).apply {
            text = "已读取 " + rows.split("\n").size + " 行文本\n点击下方按钮查看运气王概率"
            textSize = 13f
            setTextColor(Color.parseColor("#55555c"))
            setPadding(0, dp(8), 0, 0)
        }
        summaryView = summary

        val open = Button(context).apply {
            text = "🔮 查看预测"
            textSize = 14f
            setOnClickListener {
                context.startActivity(
                    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                hide(context)
            }
        }

        val close = Button(context).apply {
            text = "忽略"
            textSize = 12f
            setOnClickListener { hide(context) }
        }

        val buttons = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
            addView(open, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(close, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }

        box.addView(title)
        box.addView(summary)
        box.addView(buttons)

        val lp = WindowManager.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            android.graphics.PixelFormat.TRANSLUCENT
        )
        lp.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        lp.y = dp(48)
        lp.horizontalMargin = dp(12).toFloat()

        wm.addView(box, lp)
        view = box
    }

    private fun hide(context: Context) {
        val v = view ?: return
        try {
            (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(v)
        } catch (_: Exception) {
        }
        view = null
        summaryView = null
    }
}
