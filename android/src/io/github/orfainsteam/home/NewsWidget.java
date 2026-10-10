package io.github.orfainsteam.home;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** ویجت صفحه‌ی اصلی: تازه‌ترین خبرها (اول علاقه‌مندی‌ها) با کاور */
public class NewsWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "io.github.orfainsteam.home.WIDGET_REFRESH";
    static final int FLAG_MUTABLE = 0x02000000, FLAG_IMMUTABLE = 0x04000000;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, NewsWidget.class));
            for (int id : ids) {
                RemoteViews v = build(ctx, id);
                v.setTextViewText(R.id.w_updated, "در حال به‌روزرسانی…");
                mgr.updateAppWidget(id, v);
            }
            mgr.notifyAppWidgetViewDataChanged(ids, R.id.w_list);
        }
    }

    static RemoteViews build(Context ctx, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);

        Intent svc = new Intent(ctx, NewsWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse("dashboard://widget/" + id));   // برای هر ویجت جدا
        v.setRemoteAdapter(R.id.w_list, svc);
        v.setEmptyView(R.id.w_list, R.id.w_empty);

        // کلیک روی هر خبر: باز شدن همان خبر در اپ
        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | FLAG_MUTABLE));

        // کلیک روی سربرگ: باز شدن اپ
        Intent app = new Intent(ctx, MainActivity.class);
        app.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.w_title, PendingIntent.getActivity(ctx, 2, app, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE));

        Intent refresh = new Intent(ctx, NewsWidget.class);
        refresh.setAction(ACTION_REFRESH);
        v.setOnClickPendingIntent(R.id.w_refresh, PendingIntent.getBroadcast(ctx, 3, refresh, PendingIntent.FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE));

        String up = NewsWidgetService.lastUpdated(ctx);
        v.setTextViewText(R.id.w_updated, up);
        return v;
    }
}
