package com.lyndasrummitummi.android

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

/**
 * The whole game is the same web page the Mac, Windows and iPhone apps show.
 * This activity hosts it and gives it the few things a web page cannot do by
 * itself: notifications, saving and opening game files, opening Messages or
 * Mail, and the camera for profile photos.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var pageLoaded = false
    private var pendingUrl: String? = null
    private var pendingGame: String? = null

    private var saveText: String? = null
    private var saveName = ""
    private var saveReply: Int? = null
    private var loadReply: Int? = null
    private var notificationAnswer: ((Boolean) -> Unit)? = null
    private var cameraRequest: PermissionRequest? = null

    private val prefs by lazy { getSharedPreferences("rummi", Context.MODE_PRIVATE) }

    private val createDocument = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val id = saveReply ?: return@registerForActivityResult
        saveReply = null
        val text = saveText
        saveText = null
        if (uri == null || text == null) return@registerForActivityResult reply(id, true, null)
        try {
            contentResolver.openOutputStream(uri, "wt")!!.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            reply(id, true, saveName)
        } catch (e: Exception) {
            reply(id, false, e.message ?: "The game could not be saved.")
        }
    }

    private val openDocument = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val id = loadReply ?: return@registerForActivityResult
        loadReply = null
        if (uri == null) return@registerForActivityResult reply(id, true, null)
        try {
            val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
            if (bytes.size > 4 * 1024 * 1024) return@registerForActivityResult reply(id, false, "That file is too large to be a saved game.")
            val name = uri.lastPathSegment?.substringAfterLast('/') ?: "game.rummitime"
            reply(id, true, JSONObject().put("name", name).put("text", String(bytes, Charsets.UTF_8)))
        } catch (e: Exception) {
            reply(id, false, "That file could not be read as a saved game.")
        }
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        notificationAnswer?.invoke(granted)
        notificationAnswer = null
    }

    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = cameraRequest ?: return@registerForActivityResult
        cameraRequest = null
        if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else request.deny()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        Channels.ensure(this)

        // the game fills the screen: the status and navigation bars come back with a swipe
        WindowCompat.getInsetsController(window, window.decorView).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }

        // The page is served from the app's own files under one fixed address, so
        // the players and settings it keeps (and the online sign-in) persist.
        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(0xFF1B1F2A.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportZoom(false)
            overScrollMode = WebView.OVER_SCROLL_NEVER
            addJavascriptInterface(Bridge(), "rkNative")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)

                // the game never navigates away; links that leave it go to the Bridge
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    pageLoaded = false
                    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(PAGE_SCRIPT, null)
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    pageLoaded = true
                }
            }
            webChromeClient = object : WebChromeClient() {
                // the camera, for a profile photo; Android still asks for its own permission
                override fun onPermissionRequest(request: PermissionRequest) {
                    val ours = request.origin.host == HOST
                    val video = request.resources.all { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE }
                    if (!ours || !video) return request.deny()
                    if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.resources)
                    } else {
                        cameraRequest = request
                        askCamera.launch(Manifest.permission.CAMERA)
                    }
                }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(this, PAGE_SCRIPT, setOf("https://$HOST"))
            }
        }
        setContentView(web)
        takeIntent(intent)
        web.loadUrl("https://$HOST/assets/web/index.html")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeIntent(intent)
    }

    /** An invitation link, or a tapped notification, started or returned to the game. */
    private fun takeIntent(intent: Intent?) {
        val data = intent?.data?.toString()
        if (data != null && data.lowercase().startsWith("rummi-tummi://")) {
            pendingUrl = data
            if (pageLoaded) {
                run("window.__rkOpenUrl && window.__rkOpenUrl(${JSONObject.quote(data)})")
                pendingUrl = null
            }
        }
        val gid = intent?.getStringExtra("gid")
        if (!gid.isNullOrEmpty()) {
            if (pageLoaded) run("window.__rkOpenGame && window.__rkOpenGame(${JSONObject.quote(gid)})") else pendingGame = gid
            intent?.removeExtra("gid")
        }
    }

    private fun run(js: String) = web.post { web.evaluateJavascript(js, null) }

    /** Answers a call the page made with rkNative.post: resolves or rejects its promise. */
    private fun reply(id: Int, ok: Boolean, value: Any?) {
        val literal = when (value) {
            null -> "null"
            is String -> JSONObject.quote(value)
            is Boolean, is Number -> value.toString()
            is JSONObject -> value.toString()
            else -> "null"
        }
        run("window.__rkReply($id, $ok, $literal)")
    }

    private fun notificationState(): String = when {
        NotificationManagerCompat.from(this).areNotificationsEnabled() -> "granted"
        prefs.getBoolean("askedNotifications", false) -> "denied"
        else -> "undecided"
    }

    private fun registerPush(id: Int) {
        fun fetchToken() {
            try {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    val token = task.result
                    if (task.isSuccessful && !token.isNullOrEmpty()) reply(id, true, JSONObject().put("token", token).put("env", "fcm"))
                    else reply(id, true, null)
                }
            } catch (e: IllegalStateException) {
                // built without google-services.json: no push, the game itself is unaffected
                reply(id, true, null)
            }
        }
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            prefs.edit().putBoolean("askedNotifications", true).apply()
            notificationAnswer = { granted -> if (granted) fetchToken() else reply(id, true, null) }
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            fetchToken()
        }
    }

    /** What the page can ask the app to do. */
    private inner class Bridge {
        @JavascriptInterface
        fun post(message: String) {
            runOnUiThread {
                try {
                    handle(JSONObject(message))
                } catch (e: Exception) {
                    Log.w(TAG, "bad request: ${e.message}")
                }
            }
        }
    }

    private fun handle(body: JSONObject) {
        val id = body.getInt("id")
        when (body.getString("cmd")) {
            "version" -> reply(id, true, packageManager.getPackageInfo(packageName, 0).versionName ?: "")
            "pendingUrl" -> {
                reply(id, true, pendingUrl)
                pendingUrl = null
            }
            "openExternal" -> {
                val text = body.optString("url")
                val scheme = Uri.parse(text).scheme?.lowercase() ?: ""
                // only Messages, Mail and the download page may be opened
                if (scheme !in listOf("sms", "mailto") && !text.startsWith("https://github.com/truevy/myrummikub/")) {
                    return reply(id, false, "That kind of link cannot be opened.")
                }
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(text)))
                    reply(id, true, true)
                } catch (e: Exception) {
                    reply(id, false, "Could not open that link.")
                }
            }
            "save" -> {
                saveText = body.optString("text")
                saveName = body.optString("name").substringAfterLast('/')
                saveReply = id
                createDocument.launch(saveName)
            }
            "load" -> {
                loadReply = id
                openDocument.launch(arrayOf("*/*"))
            }
            "pushRegister" -> registerPush(id)
            "pushStatus" -> reply(id, true, notificationState())
            "pushSettings" -> {
                startActivity(
                    Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
                reply(id, true, true)
            }
            "pushPending" -> {
                reply(id, true, pendingGame)
                pendingGame = null
            }
            "pushClear" -> {
                NotificationManagerCompat.from(this).cancelAll()
                reply(id, true, true)
            }
            "log" -> {
                Log.d(TAG, "[page] ${body.optString("text")}")
                reply(id, true, true)
            }
            else -> reply(id, false, "Unknown request.")
        }
    }

    companion object {
        private const val TAG = "RummiTime"
        private const val HOST = "appassets.androidplatform.net"

        /** Defined before the page's own scripts run: what the Mac app's preload script provides. */
        private val PAGE_SCRIPT = """
            (function () {
              if (window.rkPush) return;
              var pending = {}, next = 1, listeners = [];
              window.__rkReply = function (id, ok, value) {
                var p = pending[id];
                if (!p) return;
                delete pending[id];
                if (ok) p.resolve(value); else p.reject(new Error(value));
              };
              function call(message) {
                return new Promise(function (resolve, reject) {
                  var id = next++;
                  pending[id] = { resolve: resolve, reject: reject };
                  message.id = id;
                  rkNative.post(JSON.stringify(message));
                });
              }
              window.__rkOpenUrl = function (url) { listeners.forEach(function (cb) { cb(url); }); };
              window.rkCloud = {
                isDev: false,
                version: function () { return call({ cmd: 'version' }); },
                pendingUrl: function () { return call({ cmd: 'pendingUrl' }); },
                onUrl: function (cb) { listeners.push(cb); },
                openExternal: function (url) { return call({ cmd: 'openExternal', url: url }); }
              };
              window.rkPush = {
                kind: 'mobile',
                register: function () { return call({ cmd: 'pushRegister' }); },
                status: function () { return call({ cmd: 'pushStatus' }); },
                openSettings: function () { return call({ cmd: 'pushSettings' }); },
                pendingGame: function () { return call({ cmd: 'pushPending' }); },
                clearBadge: function () { return call({ cmd: 'pushClear' }); }
              };
              window.rkFiles = {
                save: function (name, text) { return call({ cmd: 'save', name: name, text: text }); },
                load: function () { return call({ cmd: 'load' }); }
              };
              window.addEventListener('error', function (e) {
                call({ cmd: 'log', text: 'error: ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno });
              });
            })();
        """.trimIndent()
    }
}
