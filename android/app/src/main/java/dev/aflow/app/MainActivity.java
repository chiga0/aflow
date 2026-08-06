package dev.aflow.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
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
    private static final int FILE_CHOOSER_REQ = 1001;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

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

        // Without a WebChromeClient overriding onShowFileChooser, WebView
        // silently ignores <input type="file"> taps — the composer's 图片/文件
        // picker buttons would do nothing.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = filePathCallback;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, FILE_CHOOSER_REQ);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
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
        checkUpdate();
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
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQ) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
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
