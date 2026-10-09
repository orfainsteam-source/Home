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
import android.view.Window;
import android.webkit.CookieManager;
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
    private WebView web;

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
        s.setSupportMultipleWindows(false);    // لینک‌های target=_blank از shouldOverrideUrlLoading رد می‌شوند
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(isOnline() ? WebSettings.LOAD_DEFAULT : WebSettings.LOAD_CACHE_ELSE_NETWORK);
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equalsIgnoreCase(u.getHost())) return false;   // خود صفحه، داخل اپ بماند
                openOutside(u);                                          // سایت خبر، IMDb و … در مرورگر
                return true;
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

        if (state != null) web.restoreState(state);
        else web.loadUrl(HOME);
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
        // اول پنجره‌ی باز (خواندن خبر یا تنظیمات) بسته شود، بعد صفحه‌ی قبل، بعد خروج
        web.evaluateJavascript(
            "(function(){var d=[].slice.call(document.querySelectorAll('dialog[open]')).pop();if(d){d.close();return 1}return 0})()",
            v -> {
                if ("1".equals(v)) return;
                if (web.canGoBack()) web.goBack();
                else finish();
            });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); CookieManager.getInstance().flush(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }
}
