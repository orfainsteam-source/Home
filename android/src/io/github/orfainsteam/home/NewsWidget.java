package io.github.orfainsteam.home;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.widget.RemoteViews;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** ویجت صفحه‌ی اصلی: خبرها با کاور، دسته‌بندی قابل انتخاب، به‌روزرسانی درجا */
public class NewsWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "io.github.orfainsteam.home.WIDGET_REFRESH";
    static final String ACTION_CAT = "io.github.orfainsteam.home.WIDGET_CAT";
    static final int FLAG_MUTABLE = 0x02000000, FLAG_IMMUTABLE = 0x04000000;
    static final String[] CATS = {"fav", "all", "game", "anime"};
    static final int[] CHIPS = {R.id.c_fav, R.id.c_all, R.id.c_game, R.id.c_anime};

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("widget", 0); }
    static String catOf(Context c, int id) { return prefs(c).getString("cat_" + id, "fav"); }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id, null));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }

    @Override
    public void onReceive(final Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        final AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        final int[] all = mgr.getAppWidgetIds(new ComponentName(ctx, NewsWidget.class));
        if (ACTION_CAT.equals(intent.getAction())) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0);
            prefs(ctx).edit().putString("cat_" + id, intent.getStringExtra("cat")).apply();
            mgr.updateAppWidget(id, build(ctx, id, null));
            mgr.notifyAppWidgetViewDataChanged(new int[]{id}, R.id.w_list);
        } else if (ACTION_REFRESH.equals(intent.getAction())) {
            final boolean follow = intent.getBooleanExtra("follow", false);
            for (int id : all) mgr.updateAppWidget(id, build(ctx, id, "در حال به‌روزرسانی…"));
            mgr.notifyAppWidgetViewDataChanged(all, R.id.w_list);
            if (!follow) {
                // اگر خبرها کهنه‌اند و توکن داریم، از GitHub جمع‌آوری تازه بخواه و ۴ دقیقه بعد دوباره بخوان
                final PendingResult pr = goAsync();
                new Thread(new Runnable() { public void run() {
                    try { requestCollect(ctx); } finally { pr.finish(); }
                }}).start();
            }
        }
    }

    static void requestCollect(Context ctx) {
        String token = prefs(ctx).getString("gh_token", "");
        long dataTs = prefs(ctx).getLong("data_ts", 0);
        if (token.isEmpty() || System.currentTimeMillis() - dataTs < 12 * 60000) return;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/orfainsteam-source/Home/actions/workflows/collect.yml/dispatches").openConnection();
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setConnectTimeout(15000); c.setReadTimeout(15000);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write("{\"ref\":\"main\"}".getBytes("UTF-8")); }
            if (c.getResponseCode() == 204) {
                Intent again = new Intent(ctx, NewsWidget.class).setAction(ACTION_REFRESH).putExtra("follow", true);
                PendingIntent pi = PendingIntent.getBroadcast(ctx, 9, again, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);
                AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
                if (am != null) am.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 4 * 60000, pi);
            }
        } catch (Exception ignored) { }
    }

    static RemoteViews build(Context ctx, int id, String status) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);

        Intent svc = new Intent(ctx, NewsWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse("dashboard://widget/" + id));
        v.setRemoteAdapter(R.id.w_list, svc);
        v.setEmptyView(R.id.w_list, R.id.w_empty);

        // کلیک روی هر خبر: همان خبر در اپ
        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_MUTABLE));

        // فقط نشان D اپ را باز می‌کند
        Intent app = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.w_mark, PendingIntent.getActivity(ctx, 2, app, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE));

        // به‌روزرسانی درجا (اپ باز نمی‌شود)
        Intent refresh = new Intent(ctx, NewsWidget.class).setAction(ACTION_REFRESH);
        PendingIntent rp = PendingIntent.getBroadcast(ctx, 3, refresh, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.w_refresh, rp);
        v.setOnClickPendingIntent(R.id.w_updated, rp);

        // دسته‌ها
        String cur = catOf(ctx, id);
        int onText = ctx.getResources().getColor(R.color.w_on_accent), offText = ctx.getResources().getColor(R.color.w_text);
        for (int i = 0; i < CATS.length; i++) {
            boolean on = CATS[i].equals(cur);
            v.setInt(CHIPS[i], "setBackgroundResource", on ? R.drawable.chip_on : R.drawable.chip_off);
            v.setTextColor(CHIPS[i], on ? onText : offText);
            Intent ci = new Intent(ctx, NewsWidget.class).setAction(ACTION_CAT)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("cat", CATS[i])
                .setData(Uri.parse("dashboard://cat/" + id + "/" + CATS[i]));
            v.setOnClickPendingIntent(CHIPS[i], PendingIntent.getBroadcast(ctx, 100 + id * 10 + i, ci, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE));
        }

        v.setTextViewText(R.id.w_updated, status != null ? status : NewsWidgetService.lastUpdated(ctx));
        return v;
    }
}
