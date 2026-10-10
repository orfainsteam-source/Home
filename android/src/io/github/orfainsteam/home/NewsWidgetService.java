package io.github.orfainsteam.home;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class NewsWidgetService extends RemoteViewsService {
    static final String DATA = MainActivity.HOME + "data/news.json";
    static final int MAX = 14;

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    static String lastUpdated(Context ctx) {
        long t = ctx.getSharedPreferences("widget", 0).getLong("fetched", 0);
        return t == 0 ? "" : "به‌روز شد · " + fa(new java.text.SimpleDateFormat("HH:mm").format(new java.util.Date(t)));
    }

    static String fa(String s) {
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) b.append(c >= '0' && c <= '9' ? (char) ('۰' + (c - '0')) : c);
        return b.toString();
    }

    static String ago(long ts) {
        long m = Math.max(0, (System.currentTimeMillis() - ts) / 60000);
        if (m < 1) return "همین حالا";
        if (m < 60) return fa(m + " دقیقه پیش");
        long h = m / 60;
        if (h < 24) return fa(h + " ساعت پیش");
        long d = h / 24;
        return d == 1 ? "دیروز" : fa(d + " روز پیش");
    }

    static class Entry { String id, title, src, img, fav, cat, favCat; long ts; boolean search; Bitmap bmp; }

    static class Factory implements RemoteViewsFactory {
        final Context ctx; final int widgetId;
        List<Entry> items = new ArrayList<>();
        final Map<String, Bitmap> cache = new HashMap<>();

        Factory(Context c, int id) { ctx = c; widgetId = id; }

        @Override public void onCreate() { }
        @Override public void onDestroy() { items.clear(); cache.clear(); }

        static String fetch(String url) throws Exception {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000); c.setReadTimeout(20000);
            c.setUseCaches(false);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            }
        }

        static Bitmap loadThumb(String url, int w, int h, float radius) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(10000); c.setReadTimeout(15000);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Dashboard");
                byte[] data;
                try (InputStream in = c.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384]; int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    data = out.toByteArray();
                }
                BitmapFactory.Options o = new BitmapFactory.Options(); o.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(data, 0, data.length, o);
                int s = 1; while (o.outWidth / (s * 2) >= w && o.outHeight / (s * 2) >= h) s *= 2;
                o = new BitmapFactory.Options(); o.inSampleSize = s;
                Bitmap src = BitmapFactory.decodeByteArray(data, 0, data.length, o);
                if (src == null) return null;
                // برش وسط و گوشه‌های گرد
                Bitmap dst = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                float sc = Math.max((float) w / src.getWidth(), (float) h / src.getHeight());
                Matrix m = new Matrix(); m.setScale(sc, sc);
                m.postTranslate((w - src.getWidth() * sc) / 2f, (h - src.getHeight() * sc) / 2f);
                BitmapShader sh = new BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
                sh.setLocalMatrix(m);
                Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG); p.setShader(sh);
                new Canvas(dst).drawRoundRect(new RectF(0, 0, w, h), radius, radius, p);
                src.recycle();
                return dst;
            } catch (Exception e) { return null; }
        }

        @Override
        public void onDataSetChanged() {
            List<Entry> fresh = new ArrayList<>();
            try {
                JSONObject root = new JSONObject(fetch(DATA + "?t=" + System.currentTimeMillis()));
                ctx.getSharedPreferences("widget", 0).edit().putLong("data_ts", root.optLong("ts")).apply();
                JSONArray arr = root.getJSONArray("items");
                String cat = NewsWidget.catOf(ctx, widgetId);
                List<Entry> favs = new ArrayList<>(), rest = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    Entry e = new Entry();
                    e.id = o.optString("id"); e.title = o.optString("title"); e.src = o.optString("src");
                    e.img = o.optString("img"); e.fav = o.optString("fav", ""); e.ts = o.optLong("ts");
                    e.cat = o.optString("cat"); e.favCat = o.optString("favCat", e.cat); e.search = o.optBoolean("search");
                    if (e.title.isEmpty() || e.img.isEmpty()) continue;
                    boolean inCat = "all".equals(cat) || "fav".equals(cat) || cat.equals(e.cat) || cat.equals(e.favCat);
                    if (!inCat) continue;
                    if (!e.fav.isEmpty()) favs.add(e);
                    else if (!e.search && !"fav".equals(cat)) rest.add(e);
                }
                if ("fav".equals(cat) || !"all".equals(cat)) {
                    // علاقه‌مندی‌ها (و در دسته‌ها: اول علاقه‌مندی‌های آن دسته، بعد بقیه)
                    fresh.addAll(favs.subList(0, Math.min(MAX, favs.size())));
                    for (Entry e : rest) { if (fresh.size() >= MAX) break; fresh.add(e); }
                } else {
                    List<Entry> mix = new ArrayList<>(rest); mix.addAll(favs);
                    fresh.addAll(mix);
                }
                java.util.Collections.sort(fresh, new java.util.Comparator<Entry>() {
                    @Override public int compare(Entry a, Entry b) { return Long.compare(b.ts, a.ts); }
                });
                if (fresh.size() > MAX) fresh = new ArrayList<>(fresh.subList(0, MAX));
            } catch (Exception e) {
                return;   // خطای شبکه: خبرهای قبلی بمانند
            }
            float d = ctx.getResources().getDisplayMetrics().density;
            int w = (int) (76 * d), h = (int) (54 * d);
            Map<String, Bitmap> next = new HashMap<>();
            for (Entry e : fresh) {
                Bitmap b = cache.containsKey(e.img) ? cache.get(e.img) : loadThumb(e.img, w, h, 10 * d);
                e.bmp = b; if (b != null) next.put(e.img, b);
            }
            cache.clear(); cache.putAll(next);
            items = fresh;
            SharedPreferences.Editor ed = ctx.getSharedPreferences("widget", 0).edit();
            ed.putLong("fetched", System.currentTimeMillis()).apply();
            // نوشته‌ی «به‌روزرسانی شد» در سربرگ
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, NewsWidget.class))) {
                RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
                v.setTextViewText(R.id.w_updated, "به‌روز شد · " + fa(new java.text.SimpleDateFormat("HH:mm").format(new java.util.Date())));
                mgr.partiallyUpdateAppWidget(id, v);
            }
        }

        @Override public int getCount() { return items.size(); }

        @Override
        public RemoteViews getViewAt(int pos) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_item);
            if (pos >= items.size()) return v;
            Entry e = items.get(pos);
            v.setTextViewText(R.id.i_title, e.title);
            v.setTextViewText(R.id.i_meta, (e.fav.isEmpty() ? "" : "★ " + e.fav + "  ·  ") + e.src + "  ·  " + ago(e.ts));
            if (e.bmp != null) v.setImageViewBitmap(R.id.i_img, e.bmp);
            else v.setImageViewResource(R.id.i_img, R.mipmap.ic_launcher);
            Intent fill = new Intent();
            fill.putExtra("read", e.id);
            v.setOnClickFillInIntent(R.id.i_root, fill);
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int pos) { return pos < items.size() ? items.get(pos).id.hashCode() : pos; }
        @Override public boolean hasStableIds() { return true; }
    }
}
