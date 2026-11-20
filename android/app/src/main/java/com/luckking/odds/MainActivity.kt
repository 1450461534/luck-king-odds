package com.luckking.odds

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * WebView 壳：加载 assets/web/ 下的网页版（识别、计算、展示全部复用 H5）。
 * 无障碍服务解析出的红包行文本通过 [Bridge] 推给 H5，计算结果再回传给悬浮窗。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = true
            domStorageEnabled = true
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                // 页面加载完成后，补推服务已缓存的最近一次解析结果
                RedPacketService.pendingRows?.let { pushRows(it) }
            }
        }
        webView.addJavascriptInterface(Bridge(), "LuckBridge")
        setContentView(webView)
        // 服务发现 WebView 就绪后直接把数据推进 H5
        RedPacketService.uiSink = { rows -> runOnUiThread { pushRows(rows) } }
    }

    private fun pushRows(rows: String) {
        val literal = JSONObject.quote(rows)
        webView.evaluateJavascript("window.__fromAndroid && window.__fromAndroid($literal)", null)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    /** H5 计算完成后回传结果的通道 */
    inner class Bridge {
        @android.webkit.JavascriptInterface
        fun onResult(resultJson: String) {
            FloatingResult.updateSummary(resultJson)
        }
    }
}
