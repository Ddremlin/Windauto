package io.github.ddremlin.windauto;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Круговое видео нативной камерой (CameraX): WebView не отдаёт зум камеры,
 * а через CameraX доступен весь диапазон, на Pixel — от 0.5× (сверхширокий объектив).
 */
@CapacitorPlugin(name = "VideoRecorder")
public class VideoRecorderPlugin extends Plugin {

    @PluginMethod
    public void record(PluginCall call) {
        Intent i = new Intent(getContext(), RecorderActivity.class);
        i.putExtra("maxSec", call.getInt("maxSec", 180));
        i.putExtra("bitrate", call.getInt("bitrate", 2_500_000));
        i.putExtra("tip", call.getString("tip", ""));
        i.putExtra("limit", call.getString("limit", ""));
        i.putExtra("cancel", call.getString("cancel", "Cancel"));
        i.putExtra("gallery", call.getString("gallery", "Gallery"));
        startActivityForResult(call, i, "onRecorded");
    }

    @ActivityCallback
    private void onRecorded(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent d = result.getData();
        JSObject r = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && d != null && d.getStringExtra("path") != null) {
            r.put("path", d.getStringExtra("path"));
            r.put("duration", d.getDoubleExtra("duration", 0));
        } else {
            // cancel — закрыли; gallery — выбрать файл; fallback — камера не открылась
            r.put("action", d != null && d.getStringExtra("action") != null ? d.getStringExtra("action") : "cancel");
            if (d != null && d.getStringExtra("message") != null) r.put("message", d.getStringExtra("message"));
        }
        call.resolve(r);
    }
}
