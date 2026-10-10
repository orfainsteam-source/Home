package io.github.orfainsteam.home;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * دکمه‌های ویجت (دسته‌ها و به‌روزرسانی) از این اکتیویتی بی‌صفحه رد می‌شوند.
 * بعضی گوشی‌ها (ColorOS، MIUI، …) broadcast ویجت را برای اپی که اجرا نیست مسدود می‌کنند؛
 * اما باز کردن یک اکتیویتی با لمس کاربر همیشه مجاز است. چیزی نشان داده نمی‌شود و فوراً بسته می‌شود.
 */
public class WidgetAction extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        final Context ctx = getApplicationContext();
        Intent in = getIntent();
        String what = in == null ? null : in.getStringExtra("what");
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] all = mgr.getAppWidgetIds(new ComponentName(ctx, NewsWidget.class));
        if ("cat".equals(what)) {
            int id = in.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0);
            NewsWidget.prefs(ctx).edit().putString("cat_" + id, in.getStringExtra("cat")).commit();
            mgr.updateAppWidget(id, NewsWidget.build(ctx, id, null));
            mgr.notifyAppWidgetViewDataChanged(new int[]{id}, R.id.w_list);
        } else if ("refresh".equals(what)) {
            for (int id : all) mgr.updateAppWidget(id, NewsWidget.build(ctx, id, "در حال به‌روزرسانی…"));
            mgr.notifyAppWidgetViewDataChanged(all, R.id.w_list);
            new Thread(new Runnable() { public void run() { NewsWidget.requestCollect(ctx); } }).start();
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
