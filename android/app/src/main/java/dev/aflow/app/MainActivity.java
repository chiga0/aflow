package dev.aflow.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Thin WebView shell around https://aflow.dev.
 *
 * Zero GMS / Play-services dependency: a plain WebView gives us the site's
 * own service worker (offline shell, updates) and standalone feel, which is
 * exactly what CN-Android WebAPK installs cannot provide.
 */
public class MainActivity extends Activity {

    private static final String URL = "https://aflow.dev/";
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        // opaque dark canvas until the first HTML frame paints — kills the
        // transparent/white flash between activity start and page load.
        web.setBackgroundColor(Color.parseColor("#09090b"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // expose the shell version to the site (settings -> about)
        s.setUserAgentString(s.getUserAgentString() + " AFlowAndroid/" + BuildConfig.VERSION_NAME);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String host = u.getHost();
                if (host != null && (host.equals("aflow.dev") || host.endsWith(".aflow.dev"))) {
                    return false; // stay in-app
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setDownloadListener((url, ua, contentDisposition, mimetype, length) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
        });

        setContentView(web);
        web.loadUrl(URL);
        setupVoiceBridge();
        checkUpdate();
    }

    // ── native voice input (works without GMS on CN ROMs) ─────

    private android.speech.SpeechRecognizer recognizer;

    private void setupVoiceBridge() {
        web.addJavascriptInterface(new Object() {
            @android.webkit.JavascriptInterface
            public boolean available() {
                return android.speech.SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
            }

            @android.webkit.JavascriptInterface
            public void startVoice() {
                startSpeech();
            }

            @android.webkit.JavascriptInterface
            public void stopVoice() {
                runOnUiThread(() -> {
                    if (recognizer != null) recognizer.stopListening();
                });
            }
        }, "AflowVoice");
    }

    private void startSpeech() {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != 0) {
            requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, 77);
            return;
        }
        runOnUiThread(() -> {
            try {
                if (recognizer != null) recognizer.destroy();
                recognizer = android.speech.SpeechRecognizer.createSpeechRecognizer(this);
                android.content.Intent i = new android.content.Intent(
                        android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
                i.putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                recognizer.setRecognitionListener(new android.speech.RecognitionListener() {
                    public void onReadyForSpeech(android.os.Bundle p) { voiceCb("onStart", ""); }
                    public void onBeginningOfSpeech() { }
                    public void onRmsChanged(float f) { }
                    public void onBufferReceived(byte[] b) { }
                    public void onEndOfSpeech() { }
                    public void onError(int e) { voiceCb("onError", String.valueOf(e)); }
                    public void onResults(android.os.Bundle r) {
                        java.util.ArrayList<String> l = r.getStringArrayList(
                                android.speech.SpeechRecognizer.RESULTS_RECOGNITION);
                        voiceCb("onResult", (l == null || l.isEmpty()) ? "" : l.get(0));
                        voiceCb("onEnd", "");
                    }
                    public void onPartialResults(android.os.Bundle r) {
                        java.util.ArrayList<String> l = r.getStringArrayList(
                                android.speech.SpeechRecognizer.RESULTS_RECOGNITION);
                        if (l != null && !l.isEmpty()) voiceCb("onPartial", l.get(0));
                    }
                    public void onEvent(int e, android.os.Bundle p) { }
                });
                recognizer.startListening(i);
            } catch (Exception ignored) {
                voiceCb("onEnd", "");
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        // auto-start recognition once mic permission is granted
        if (code == 77 && res.length > 0 && res[0] == 0) {
            web.evaluateJavascript(
                "window.__aflowVoiceAutostart && window.__aflowVoiceAutostart()", null);
        }
    }

    private void voiceCb(String fn, String arg) {
        runOnUiThread(() -> web.evaluateJavascript(
                "window.__aflowVoiceCb && window.__aflowVoiceCb("
                        + org.json.JSONObject.quote(fn) + ","
                        + org.json.JSONObject.quote(arg) + ")", null));
    }

    // ── in-app updates ─────────────────────────────────────

    private void checkUpdate() {
        new Thread(() -> {
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection)
                        new java.net.URL("https://aflow.dev/apk-version.json").openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(5000);
                String body = new String(c.getInputStream().readAllBytes());
                org.json.JSONObject o = new org.json.JSONObject(body);
                String latest = o.optString("versionName", "");
                String url = o.optString("url", "");
                if (latest.isEmpty() || url.isEmpty()) return;
                if (!isNewer(latest, BuildConfig.VERSION_NAME)) return;
                runOnUiThread(() -> new android.app.AlertDialog.Builder(this)
                        .setTitle("发现新版本")
                        .setMessage("v" + latest + "（当前 v" + BuildConfig.VERSION_NAME
                                + "）。直接覆盖升级，无需卸载。")
                        .setPositiveButton("更新", (d, w) -> downloadAndInstall(url))
                        .setNegativeButton("稍后", null)
                        .show());
            } catch (Exception ignored) {
            }
        }).start();
    }

    private static boolean isNewer(String a, String b) {
        try {
            String[] pa = a.split("\\.");
            String[] pb = b.split("\\.");
            for (int i = 0; i < 3; i++) {
                int x = i < pa.length ? Integer.parseInt(pa[i]) : 0;
                int y = i < pb.length ? Integer.parseInt(pb[i]) : 0;
                if (x != y) return x > y;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private void downloadAndInstall(String url) {
        new Thread(() -> {
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection)
                        new java.net.URL(url).openConnection();
                c.setConnectTimeout(10000);
                java.io.File f = new java.io.File(getCacheDir(), "aflow-update.apk");
                try (java.io.InputStream in = c.getInputStream();
                     java.io.OutputStream out = new java.io.FileOutputStream(f)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                runOnUiThread(() -> {
                    android.net.Uri uri = android.net.Uri.parse(
                            "content://dev.aflow.app.apk/file");
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri,
                            "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(intent);
                });
            } catch (Exception ignored) {
            }
        }).start();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
