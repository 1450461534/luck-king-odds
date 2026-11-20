package com.luckking.odds

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/**
 * WebView 壳：加载 assets/web/ 下的网页版（识别、计算、展示全部复用 H5）。
 *
 * 加载方式：loadDataWithBaseURL + shouldInterceptRequest 拦截虚拟域名，
 * 把 assets/web/ 下的文件按 MIME 返回——避开部分厂商 WebView 对 file:// 的限制。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private val fakeHost = "appassets.local"

    private fun isServiceEnabled(): Boolean {
        val s = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        return s?.contains(packageName) == true
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val u = request.url
                if (u.host != fakeHost) return null
                val p = (u.path ?: "/").removePrefix("/")
                if (p.contains("..")) return null
                return try {
                    val mime = when (p.substringAfterLast('.', "")) {
                        "html" -> "text/html"
                        "js" -> "application/javascript"
                        "json" -> "application/json"
                        "gz" -> "application/gzip"
                        "png" -> "image/png"
                        "css" -> "text/css"
                        else -> "application/octet-stream"
                    }
                    val encoding = if (mime.startsWith("text/") || mime.contains("javascript")) "utf-8" else null
                    WebResourceResponse(mime, encoding, assets.open("web/$p"))
                } catch (e: Exception) {
                    null
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                pushStatus()
                RedPacketService.pendingRows?.let { pushRows(it) }
            }
        }
        webView.addJavascriptInterface(Bridge(), "LuckBridge")
        setContentView(webView)
        loadWeb()
        RedPacketService.uiSink = { rows -> runOnUiThread { pushRows(rows) } }
    }

    private fun loadWeb() {
        val html = try {
            assets.open("web/index.html").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            "<h1 style='padding:20px'>资源加载失败，请重新安装</h1>"
        }
        webView.loadDataWithBaseURL("https://$fakeHost/index.html", html, "text/html", "utf-8", null)
    }

    private fun pushStatus() {
        val json = JSONObject()
            .put("serviceEnabled", isServiceEnabled())
            .put("lastEvent", RedPacketService.lastEventTime)
        webView.evaluateJavascript("window.__androidStatus && window.__androidStatus($json)", null)
    }

    private fun pushRows(rows: String) {
        val literal = JSONObject.quote(rows)
        webView.evaluateJavascript("window.__fromAndroid && window.__fromAndroid($literal)", null)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) pushStatus()
    }

    /** H5 ↔ 原生桥：状态查询、跳设置、结果回传 */
    inner class Bridge {
        @JavascriptInterface
        fun isServiceEnabled(): Boolean = this@MainActivity.isServiceEnabled()

        @JavascriptInterface
        fun openAccessibilitySettings() {
            startActivity(
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }

        @JavascriptInterface
        fun onResult(resultJson: String) {
            FloatingResult.updateSummary(resultJson)
        }
    }
}
