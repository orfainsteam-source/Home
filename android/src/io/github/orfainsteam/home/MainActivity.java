package io.github.orfainsteam.home;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.webkit.ValueCallback;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * اپ «خانه‌ی من»: همان صفحه‌ی GitHub Pages داخل یک WebView.
 * خبرها و تنظیمات از خود سایت می‌آیند، پس با هر به‌روزرسانی سایت، اپ هم به‌روز است.
 */
public class MainActivity extends Activity {
    static final String HOME = "https://orfainsteam-source.github.io/Home/";
    static final String HOST = "orfainsteam-source.github.io";
    static final String IG_LOGIN = "https://www.instagram.com/accounts/login/";
    private WebView web;
    private ValueCallback<Uri[]> fileCb;   // انتخاب عکس پس‌زمینه از گالری
    static final int PICK = 41;
    private boolean igMode = false;   // در حال ورود به اینستاگرام داخل اپ
    private boolean ytMode = false;   // در حال ورود به حساب گوگل/یوتیوب داخل اپ
    static final String YT_LOGIN = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F";

    static boolean googleHost(String h) {
        return h.endsWith("google.com") || h.endsWith("youtube.com") || h.endsWith("gstatic.com") || h.endsWith("googleusercontent.com")
            || h.endsWith("youtube-nocookie.com") || h.endsWith("google.co") || h.equals("consent.youtube.com");
    }
    boolean ytLoggedIn() {
        String c = CookieManager.getInstance().getCookie("https://www.youtube.com/");
        return c != null && (c.contains("LOGIN_INFO=") || c.contains("SAPISID="));
    }
    private boolean clearPending = false;

    /** پل بین صفحه و اپ: فقط برای خواندن پست‌های اینستاگرام با حساب واردشده‌ی کاربر */
    class Bridge {
        @JavascriptInterface public String version() { return "3"; }

        /** توکن GitHub برای اینکه ویجت بتواند جمع‌آوری تازه بخواهد */
        @JavascriptInterface public void setToken(String t) {
            getSharedPreferences("widget", 0).edit().putString("gh_token", t == null ? "" : t.trim()).apply();
        }

        @JavascriptInterface public boolean igLoggedIn() {
            String c = CookieManager.getInstance().getCookie("https://www.instagram.com/");
            return c != null && c.contains("sessionid=");
        }

        @JavascriptInterface public boolean ytLoggedIn() { return MainActivity.this.ytLoggedIn(); }

        @JavascriptInterface public void openYouTubeLogin() {
            runOnUiThread(new Runnable() { public void run() { ytMode = true; web.loadUrl(YT_LOGIN); } });
        }

        @JavascriptInterface public void openInstagramLogin() {
            runOnUiThread(new Runnable() { public void run() { igMode = true; web.loadUrl(IG_LOGIN); } });
        }

        @JavascriptInterface public void request(final String id, final String url) {
            new Thread(new Runnable() { public void run() {
                int code = 0; String body = "";
                try {
                    URL u = new URL(url);
                    if (!"https".equals(u.getProtocol()) || !u.getHost().endsWith("instagram.com")) throw new SecurityException("host");
                    HttpURLConnection c = (HttpURLConnection) u.openConnection();
                    c.setConnectTimeout(15000); c.setReadTimeout(20000);
                    String cookies = CookieManager.getInstance().getCookie("https://www.instagram.com/");
                    if (cookies != null){
                        c.setRequestProperty("Cookie", cookies);
                        for (String part : cookies.split(";")) {
                            String p = part.trim();
                            if (p.startsWith("csrftoken=")) c.setRequestProperty("X-CSRFToken", p.substring(10));
                        }
                    }
                    c.setRequestProperty("User-Agent", web.getSettings().getUserAgentString());
                    c.setRequestProperty("X-IG-App-ID", "936619743392459");
                    c.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                    c.setRequestProperty("Accept", "application/json");
                    c.setRequestProperty("Referer", "https://www.instagram.com/");
                    code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    if (in != null) {
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        byte[] buf = new byte[16384]; int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        body = out.toString("UTF-8");
                    }
                } catch (Exception e) { body = String.valueOf(e.getMessage()); }
                final String js = "window.__nativeDone && window.__nativeDone(" + JSONObject.quote(id) + "," + code + "," + JSONObject.quote(body) + ")";
                runOnUiThread(new Runnable() { public void run() { web.evaluateJavascript(js, null); } });
            }}).start();
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: علاقه‌مندی‌ها، کلیدها، ترجمه‌ها
        s.setDatabaseEnabled(true);
        s.setSupportMultipleWindows(false);
        // گوگل ورود از داخل WebView را رد می‌کند؛ نشانه‌ی «wv» را از User-Agent برمی‌داریم
        s.setUserAgentString(s.getUserAgentString().replace("; wv)", ")").replaceAll("Version/\\d+(\\.\\d+)* ", ""));    // لینک‌های target=_blank از shouldOverrideUrlLoading رد می‌شوند
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "HomeNative");

        web.setWebChromeClient(new WebChromeClient() {
            View full; CustomViewCallback fullCb;
            // تمام‌صفحه برای تریلرها
            @Override public void onShowCustomView(View v, CustomViewCallback cb) {
                if (full != null) { cb.onCustomViewHidden(); return; }
                full = v; fullCb = cb;
                ((ViewGroup) getWindow().getDecorView()).addView(v, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }
            @Override public void onHideCustomView() {
                if (full == null) return;
                ((ViewGroup) getWindow().getDecorView()).removeView(full);
                full = null; if (fullCb != null) fullCb.onCustomViewHidden(); fullCb = null;
            }
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                try { startActivityForResult(Intent.createChooser(pick, "انتخاب عکس"), PICK); }
                catch (ActivityNotFoundException e) { fileCb = null; return false; }
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equalsIgnoreCase(u.getHost())) return false;   // خود صفحه، داخل اپ بماند
                String h = u.getHost() == null ? "" : u.getHost();
                // ورود به یوتیوب: «Sign in» داخل پلیر به گوگل می‌رود؛ به‌جای کروم، همین‌جا وارد شو
                boolean signIn = h.startsWith("accounts.google.") || (h.endsWith("youtube.com") && String.valueOf(u.getPath()).contains("signin"));
                if (signIn && !ytMode) ytMode = true;
                if (ytMode && googleHost(h)) {
                    if ((h.equals("m.youtube.com") || h.equals("www.youtube.com")) && ytLoggedIn() && !String.valueOf(u.getPath()).contains("signin")) {
                        goHome(); return true;
                    }
                    return false;
                }
                // حین ورود به اینستاگرام، صفحه‌های اینستاگرام/فیسبوک داخل اپ باز شوند
                if (igMode && (h.endsWith("instagram.com") || h.endsWith("facebook.com"))) {
                    // بعد از ورود، اینستاگرام به صفحه‌ی اصلی‌اش می‌رود؛ همان‌جا برگرد به خانه
                    String path = u.getPath() == null ? "/" : u.getPath();
                    if (h.endsWith("instagram.com") && ("/".equals(path) || path.startsWith("/accounts/onetap"))
                        && CookieManager.getInstance().getCookie("https://www.instagram.com/") != null
                        && CookieManager.getInstance().getCookie("https://www.instagram.com/").contains("sessionid=")) {
                        goHome(); return true;
                    }
                    return false;
                }
                openOutside(u);                                          // سایت خبر، IMDb و … در مرورگر
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (ytMode && url != null && (url.startsWith("https://m.youtube.com/") || url.startsWith("https://www.youtube.com/"))
                    && !url.contains("signin") && ytLoggedIn()) { goHome(); return; }
                if (clearPending && url != null && url.startsWith(HOME)) { clearPending = false; view.clearHistory(); }
                if (igMode && url != null && url.startsWith("https://www.instagram.com/") && !url.contains("/accounts/")) {
                    String ck = CookieManager.getInstance().getCookie("https://www.instagram.com/");
                    if (ck != null && ck.contains("sessionid=")) goHome();
                }
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                view.getSettings().setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame()) return;
                String html = "<!doctype html><html dir=rtl><head><meta name=viewport content='width=device-width,initial-scale=1'>"
                    + "<style>body{font-family:sans-serif;background:#1B1736;color:#F1EEFF;display:grid;place-items:center;height:100vh;margin:0;text-align:center}"
                    + "button{font:inherit;border:0;border-radius:999px;padding:10px 22px;background:#5CE1E6;color:#1B1736;font-weight:700;margin-top:14px}</style></head>"
                    + "<body><div><div style='font-size:1.3rem;font-weight:700'>اتصال برقرار نشد</div>"
                    + "<div style='opacity:.75;margin-top:8px'>اینترنت یا VPN را بررسی کن.</div>"
                    + "<button onclick=\"location.href='" + HOME + "'\">دوباره امتحان کن</button></div></body></html>";
                view.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", null);
            }
        });

        String read = getIntent() == null ? null : getIntent().getStringExtra("read");
        if (read != null) web.loadUrl(HOME + "#read=" + Uri.encode(read));
        else if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != PICK || fileCb == null) return;
        Uri[] out = null;
        if (res == RESULT_OK && data != null && data.getData() != null) out = new Uri[]{ data.getData() };
        fileCb.onReceiveValue(out);
        fileCb = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        final String read = intent.getStringExtra("read");
        if (read == null) return;
        // اپ باز است: همان خبر را در صفحه باز کن
        String js = "window.__openRead ? (window.__openRead(" + org.json.JSONObject.quote(read) + "), 1) : 0";
        web.evaluateJavascript(js, new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) {
                if (!"1".equals(v)) web.loadUrl(HOME + "#read=" + Uri.encode(read));
            }
        });
    }

    private void goHome() {
        igMode = false; ytMode = false;
        CookieManager.getInstance().flush();
        clearPending = true;
        web.loadUrl(HOME);
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) { }
    }

    private boolean isOnline() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo n = cm == null ? null : cm.getActiveNetworkInfo();
        return n != null && n.isConnected();
    }

    @Override
    public void onBackPressed() {
        if (igMode || ytMode) { goHome(); return; }
        // اول پنجره‌ی باز (خواندن خبر یا تنظیمات) بسته شود، بعد صفحه‌ی قبل، بعد خروج
        web.evaluateJavascript(
            "(function(){var d=[].slice.call(document.querySelectorAll('dialog[open]')).pop();if(d){d.close();return 1}return 0})()",
            new ValueCallback<String>() {
                @Override public void onReceiveValue(String v) {
                    if ("1".equals(v)) return;
                    if (web.canGoBack()) web.goBack();
                    else finish();
                }
            });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause(); web.onPause(); CookieManager.getInstance().flush();
        sendBroadcast(new Intent(this, NewsWidget.class).setAction(NewsWidget.ACTION_REFRESH));
    }

    @Override
    protected void onResume() {
        super.onResume(); web.onResume();
        web.evaluateJavascript("window.__homeResumed && window.__homeResumed()", null);
    }
}
