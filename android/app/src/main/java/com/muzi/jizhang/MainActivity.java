package com.muzi.jizhang;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 记账本 · Android 外壳
 *
 * 前端是 web/ 目录下的纯静态单页应用，全部打包进 assets/www。
 * 通过拦截 https://app.local/ 的请求从 assets 直接读取，
 * 避开 file:// 协议下 localStorage 受限、相对路径解析异常等问题。
 */
public class MainActivity extends Activity {

    private static final String HOST = "app.local";
    private static final String START_URL = "https://app.local/index.html";
    private static final int REQ_FILE = 1001;
    private static final int REQ_STORAGE = 1002;

    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private long lastBackPress = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(Color.parseColor("#F6F7F9"));

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web);
        setContentView(root);

        configureWebView();

        if (Build.VERSION.SDK_INT <= 28) {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            }
        }

        web.loadUrl(START_URL);
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // 全部资源走 shouldInterceptRequest，无需开放文件协议
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        // 固定文字缩放，避免系统字体放大把布局挤乱
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setBackgroundColor(Color.parseColor("#F6F7F9"));
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        web.addJavascriptInterface(new Bridge(), "AppBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u == null || !HOST.equals(u.getHost())) return null;

                String path = u.getPath();
                if (path == null || path.length() == 0 || "/".equals(path)) path = "/index.html";
                while (path.startsWith("/")) path = path.substring(1);

                String mime = mimeOf(path);
                String encoding = isTextMime(mime) ? "utf-8" : null;

                Map<String, String> headers = new HashMap<String, String>();
                headers.put("Cache-Control", "no-cache");
                headers.put("X-Content-Type-Options", "nosniff");

                try {
                    InputStream is = getAssets().open("www/" + path);
                    return new WebResourceResponse(mime, encoding, 200, "OK", headers, is);
                } catch (IOException e) {
                    Map<String, String> h = new HashMap<String, String>();
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h,
                            new ByteArrayInputStream(("not found: " + path).getBytes()));
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && HOST.equals(u.getHost())) return false;
                // 外部链接交给系统浏览器
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectDownloadShim();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                }
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择账单文件"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    toast("无法打开文件选择器");
                    return false;
                }
            }
        });
    }

    /**
     * WebView 不会处理 blob: 下载，导出 CSV / XLSX / JSON 会静默失败。
     * 这里覆写 a.click()，把 Blob 转成 base64 交给原生层写进下载目录。
     */
    private void injectDownloadShim() {
        String js =
                "(function(){" +
                "  if (window.__apkDownloadShim) return; window.__apkDownloadShim = true;" +
                "  var origClick = HTMLAnchorElement.prototype.click;" +
                "  HTMLAnchorElement.prototype.click = function(){" +
                "    try {" +
                "      var href = this.href || '';" +
                "      var name = this.download || '';" +
                "      if (name && href.indexOf('blob:') === 0) {" +
                "        fetch(href).then(function(r){return r.blob();}).then(function(b){" +
                "          var fr = new FileReader();" +
                "          fr.onload = function(){" +
                "            var s = String(fr.result); var i = s.indexOf(',');" +
                "            AppBridge.saveFile(name, b.type || 'application/octet-stream', s.substring(i+1));" +
                "          };" +
                "          fr.onerror = function(){ AppBridge.toast('导出失败：读取文件出错'); };" +
                "          fr.readAsDataURL(b);" +
                "        }).catch(function(e){ AppBridge.toast('导出失败：' + e); });" +
                "        return;" +
                "      }" +
                "      if (name && href.indexOf('data:') === 0) {" +
                "        var s2 = href, i2 = s2.indexOf(',');" +
                "        var meta = s2.substring(5, i2), b64 = s2.substring(i2 + 1);" +
                "        var mime = (meta.split(';')[0] || 'application/octet-stream');" +
                "        if (meta.indexOf('base64') >= 0) {" +
                "          AppBridge.saveFile(name, mime, b64);" +
                "        } else {" +
                "          AppBridge.saveFile(name, mime, btoa(unescape(encodeURIComponent(decodeURIComponent(b64)))));" +
                "        }" +
                "        return;" +
                "      }" +
                "    } catch (e) { }" +
                "    return origClick.apply(this, arguments);" +
                "  };" +
                "})();";
        web.evaluateJavascript(js, null);
    }

    private class Bridge {
        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                String where = writeToDownloads(safeName(name), mime, data);
                toast("已保存：" + where);
            } catch (Exception e) {
                toast("保存失败：" + e.getMessage());
            }
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return "1.0.0";
        }
    }

    private static String safeName(String name) {
        if (name == null || name.trim().length() == 0) return "jiuzhang_" + System.currentTimeMillis() + ".txt";
        return name.replaceAll("[\\\\/:*?\"<>|]", "_");
    }

    private String writeToDownloads(String name, String mime, byte[] data) throws IOException {
        String type = (mime == null || mime.length() == 0) ? "application/octet-stream" : mime;

        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.Downloads.DISPLAY_NAME, name);
            v.put(MediaStore.Downloads.MIME_TYPE, type);
            v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/记账本");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("无法创建下载文件");
            OutputStream os = getContentResolver().openOutputStream(uri);
            if (os == null) throw new IOException("无法写入下载文件");
            try {
                os.write(data);
                os.flush();
            } finally {
                os.close();
            }
            return "下载/记账本/" + name;
        }

        File dir = new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS), "记账本");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");
        File f = new File(dir, name);
        FileOutputStream fos = new FileOutputStream(f);
        try {
            fos.write(data);
            fos.flush();
        } finally {
            fos.close();
        }
        try {
            android.media.MediaScannerConnection.scanFile(this,
                    new String[]{f.getAbsolutePath()}, null, null);
        } catch (Exception ignored) {
        }
        return f.getAbsolutePath();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                } else if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    result = new Uri[n];
                    for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                }
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web != null && web.canGoBack()) {
                web.goBack();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackPress < 2000) {
                finish();
            } else {
                lastBackPress = now;
                toast("再按一次退出");
            }
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".csv")) return "text/csv";
        return "application/octet-stream";
    }

    private static boolean isTextMime(String mime) {
        if (mime == null) return false;
        return mime.startsWith("text/")
                || mime.contains("javascript")
                || mime.contains("json")
                || mime.contains("svg")
                || mime.contains("xml");
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AppBridge");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
