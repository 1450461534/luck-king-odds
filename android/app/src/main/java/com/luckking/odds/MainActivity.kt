package com.luckking.odds

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import org.json.JSONObject

/**
 * WebView 壳 + 截图自动识别：
 *  1. 打开应用时自动检查「最新截图」，若比上次处理的新 → ML Kit 离线 OCR → 行文本推给 H5
 *  2. 支持系统分享（在相册/微信里把截图分享给本应用）
 *  3. 无障碍服务保留：显示服务状态与 ROM 隔离诊断（荣耀已确认隔离微信窗口内容，
 *     所以读屏只作状态参考，识别主通道是截图 OCR）
 *
 * OCR 用 ML Kit 中文识别（bundled 版）：模型打进 APK，完全离线，无需 GMS。
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private val fakeHost = "appassets.local"

    /** 上次已处理的截图 date_added（秒），避免重复识别 */
    private var lastProcessedScreenshot: Long = 0

    private fun isServiceEnabled(): Boolean {
        val s = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
        return s?.contains(packageName) == true
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("lko", MODE_PRIVATE)
        lastProcessedScreenshot = prefs.getLong("lastScreenshotTs", 0)

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
            }
        }
        webView.addJavascriptInterface(Bridge(), "LuckBridge")
        setContentView(webView)
        loadWeb()

        // 分享进入：相册/文件管理器把截图分享给本应用
        val intentUri: Uri? = when (intent?.action) {
            Intent.ACTION_SEND -> if (intent.type?.startsWith("image/") == true) intent.getParcelableExtra(Intent.EXTRA_STREAM) else null
            else -> null
        }
        if (intentUri != null) {
            recognizeInBackground(intentUri)
        }
    }

    private fun loadWeb() {
        val html = try {
            assets.open("web/index.html").bufferedReader().use { it.readText() }
        } catch (e: Exception) {
            "<h1 style='padding:20px'>资源加载失败，请重新安装</h1>"
        }
        webView.loadDataWithBaseURL("https://$fakeHost/index.html", html, "text/html", "utf-8", null)
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            pushStatus()
            checkLatestScreenshot()
        }
    }

    /** 查询相册最新截图：比上次处理的新 → 自动 OCR */
    private fun checkLatestScreenshot() {
        try {
            val proj = arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DATE_ADDED
            )
            contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, proj, null, null,
                MediaStore.Images.Media.DATE_ADDED + " DESC"
            )?.use { c ->
                if (c.moveToFirst()) {
                    val id = c.getLong(0)
                    val dateAdded = c.getLong(1)
                    if (dateAdded > lastProcessedScreenshot) {
                        lastProcessedScreenshot = dateAdded
                        getSharedPreferences("lko", MODE_PRIVATE)
                            .edit().putLong("lastScreenshotTs", dateAdded).apply()
                        val uri = android.content.ContentUris.withAppendedId(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id
                        )
                        recognizeInBackground(uri)
                    }
                }
            }
        } catch (e: Exception) {
            dbg("查询最新截图失败: " + e.message)
        }
    }

    /** ML Kit 中文 OCR（离线），识别结果作为行文本推给 H5 */
    private fun recognizeInBackground(uri: Uri) {
        pushOcrStatus("正在识别最新截图…")
        Thread {
            try {
                val image = InputImage.fromFilePath(this, uri)
                val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
                recognizer.process(image)
                    .addOnSuccessListener { visionText ->
                        runOnUiThread {
                            pushOcrStatus("")
                            pushRows(visionText.text)
                        }
                        recognizer.close()
                    }
                    .addOnFailureListener { e ->
                        runOnUiThread {
                            pushOcrStatus("")
                            dbg("OCR 失败: " + e.message)
                            pushRows("__OCR_ERROR__" + (e.message ?: "未知"))
                        }
                        recognizer.close()
                    }
            } catch (e: Exception) {
                runOnUiThread {
                    pushOcrStatus("")
                    dbg("OCR 异常: " + e.message)
                    pushRows("__OCR_ERROR__" + (e.message ?: "未知"))
                }
            }
        }.start()
    }

    private fun dbg(msg: String) {
        val ts = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.CHINA).format(java.util.Date())
        RedPacketService.debugLog = "[$ts] $msg\n" + RedPacketService.debugLog.take(2000)
        pushStatus()
    }

    private fun pushStatus() {
        val json = JSONObject()
            .put("serviceEnabled", isServiceEnabled())
            .put("lastEvent", RedPacketService.lastEventTime)
            .put("debugLog", RedPacketService.debugLog)
        webView.evaluateJavascript("window.__androidStatus && window.__androidStatus($json)", null)
    }

    private fun pushOcrStatus(msg: String) {
        webView.evaluateJavascript("window.__ocrStatus && window.__ocrStatus(${JSONObject.quote(msg)})", null)
    }

    private fun pushRows(rows: String) {
        val literal = JSONObject.quote(rows)
        webView.evaluateJavascript("window.__fromAndroid && window.__fromAndroid($literal)", null)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    /** H5 ↔ 原生桥 */
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
            // H5 计算结果回传（悬浮窗方案退役，暂只记录）
        }
    }
}
