package io.github.ddremlin.windauto;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.OrientationEventListener;
import android.view.ScaleGestureDetector;
import android.view.Surface;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.Preview;
import androidx.camera.core.ZoomState;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.video.FallbackStrategy;
import androidx.camera.video.FileOutputOptions;
import androidx.camera.video.PendingRecording;
import androidx.camera.video.Quality;
import androidx.camera.video.QualitySelector;
import androidx.camera.video.Recorder;
import androidx.camera.video.Recording;
import androidx.camera.video.VideoCapture;
import androidx.camera.video.VideoRecordEvent;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Экран записи кругового видео: превью, зум 0.5× · 1× · 2× · 5× и щипком, запись до maxSec */
public class RecorderActivity extends AppCompatActivity {

    private static final int REQ_PERMS = 1;
    private static final float[] MARKS = { 0.5f, 1f, 2f, 5f };

    private PreviewView preview;
    private TextView top;
    private TextView zoomValue;
    private LinearLayout zoomRow;
    private LinearLayout bar;
    private Button cancelBtn;
    private Button galleryBtn;
    private View recBtn;
    private final List<Button> markBtns = new ArrayList<>();
    private final List<Float> markVals = new ArrayList<>();

    private Camera camera;
    private VideoCapture<Recorder> videoCapture;
    private Recording recording;
    private File out;
    private boolean discard;
    private int maxSec;
    private OrientationEventListener orientation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        maxSec = getIntent().getIntExtra("maxSec", 180);
        buildUi();
        cleanOld();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                cancel();
            }
        });

        // кадр в ориентации телефона: экран вертикальный, а видео — как держат телефон
        orientation = new OrientationEventListener(this) {
            @Override
            public void onOrientationChanged(int deg) {
                if (deg == ORIENTATION_UNKNOWN || videoCapture == null || recording != null) return;
                int r = deg >= 45 && deg < 135 ? Surface.ROTATION_270
                    : deg >= 135 && deg < 225 ? Surface.ROTATION_180
                    : deg >= 225 && deg < 315 ? Surface.ROTATION_90
                    : Surface.ROTATION_0;
                videoCapture.setTargetRotation(r);
            }
        };

        if (granted(Manifest.permission.CAMERA)) startCamera();
        else ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO }, REQ_PERMS);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (orientation.canDetectOrientation()) orientation.enable();
    }

    @Override
    protected void onPause() {
        orientation.disable();
        super.onPause();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (granted(Manifest.permission.CAMERA)) startCamera();
        else finishWith("fallback", null);
    }

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED;
    }

    // --- интерфейс: всё кодом, без layout-файлов ---

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private GradientDrawable round(int color, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    private Button textButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(15);
        b.setBackground(round(0x33FFFFFF, 20));
        b.setPadding(dp(14), 0, dp(14), 0);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setSingleLine(true);
        b.setEllipsize(android.text.TextUtils.TruncateAt.END);
        return b;
    }

    @SuppressLint("ClickableViewAccessibility")
    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        preview = new PreviewView(this);
        // видно ровно то, что попадёт в кадр
        preview.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        root.addView(preview, new FrameLayout.LayoutParams(-1, -1));

        ScaleGestureDetector pinch = new ScaleGestureDetector(this, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector d) {
                ZoomState z = zoomState();
                if (z != null) setZoom(z.getZoomRatio() * d.getScaleFactor());
                return true;
            }
        });
        preview.setOnTouchListener((v, e) -> {
            pinch.onTouchEvent(e);
            return true;
        });

        top = new TextView(this);
        top.setTextColor(Color.WHITE);
        top.setTextSize(15);
        top.setGravity(Gravity.CENTER);
        top.setBackground(round(0x66000000, 12));
        top.setPadding(dp(14), dp(8), dp(14), dp(8));
        showTip();
        FrameLayout.LayoutParams topLp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        root.addView(top, topLp);

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setGravity(Gravity.CENTER_HORIZONTAL);

        zoomValue = new TextView(this);
        zoomValue.setTextColor(Color.WHITE);
        zoomValue.setTextSize(14);
        zoomValue.setTypeface(Typeface.DEFAULT_BOLD);
        zoomValue.setGravity(Gravity.CENTER);
        bottom.addView(zoomValue, new LinearLayout.LayoutParams(-2, -2));

        zoomRow = new LinearLayout(this);
        zoomRow.setOrientation(LinearLayout.HORIZONTAL);
        zoomRow.setGravity(Gravity.CENTER);
        zoomRow.setBackground(round(0x66000000, 24));
        zoomRow.setPadding(dp(4), dp(4), dp(4), dp(4));
        LinearLayout.LayoutParams zoomLp = new LinearLayout.LayoutParams(-2, -2);
        zoomLp.setMargins(0, dp(6), 0, dp(14));
        bottom.addView(zoomRow, zoomLp);

        bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        cancelBtn = textButton(getIntent().getStringExtra("cancel"));
        cancelBtn.setOnClickListener(v -> cancel());
        galleryBtn = textButton(getIntent().getStringExtra("gallery"));
        galleryBtn.setOnClickListener(v -> finishWith("gallery", null));

        recBtn = new View(this);
        recBtn.setContentDescription("REC");
        styleRecButton(false);
        recBtn.setEnabled(false);
        recBtn.setOnClickListener(v -> {
            if (recording == null) startRecording();
            else recording.stop();
        });

        LinearLayout.LayoutParams side = new LinearLayout.LayoutParams(0, dp(44), 1);
        FrameLayout cancelBox = new FrameLayout(this);
        cancelBox.setPadding(dp(8), 0, dp(8), 0);
        cancelBox.addView(cancelBtn, new FrameLayout.LayoutParams(-2, dp(44), Gravity.CENTER));
        FrameLayout galleryBox = new FrameLayout(this);
        galleryBox.setPadding(dp(8), 0, dp(8), 0);
        galleryBox.addView(galleryBtn, new FrameLayout.LayoutParams(-2, dp(44), Gravity.CENTER));
        bar.addView(cancelBox, side);
        bar.addView(recBtn, new LinearLayout.LayoutParams(dp(72), dp(72)));
        bar.addView(galleryBox, new LinearLayout.LayoutParams(0, dp(44), 1));
        bottom.addView(bar, new LinearLayout.LayoutParams(-1, -2));

        root.addView(bottom, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));

        // поверх системных панелей: отступы под строку состояния и жесты
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets s = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            topLp.topMargin = s.top + dp(12);
            top.setLayoutParams(topLp);
            bottom.setPadding(s.left, 0, s.right, s.bottom + dp(20));
            return insets;
        });
        setContentView(root);
    }

    private void styleRecButton(boolean stop) {
        GradientDrawable ring = new GradientDrawable();
        ring.setShape(GradientDrawable.OVAL);
        ring.setColor(stop ? 0x33FFFFFF : 0xFFE53935);
        ring.setStroke(dp(5), Color.WHITE);
        recBtn.setBackground(ring);
        if (stop) {
            // красный квадрат внутри кольца — «стоп»
            GradientDrawable sq = round(0xFFE53935, 6);
            sq.setSize(dp(28), dp(28));
            android.graphics.drawable.InsetDrawable inset = new android.graphics.drawable.InsetDrawable(sq, dp(22));
            recBtn.setForeground(inset);
        } else recBtn.setForeground(null);
    }

    private void showTip() {
        String tip = getIntent().getStringExtra("tip");
        String limit = getIntent().getStringExtra("limit");
        top.setText(limit == null || limit.isEmpty() ? tip : tip + "\n" + limit);
    }

    private static String fmtZoom(float z, boolean unit) {
        float v = Math.round(z * 10) / 10f;
        String s = v == (int) v ? String.valueOf((int) v) : String.format(Locale.ROOT, "%.1f", v).replace('.', ',');
        return unit ? s + "×" : s;
    }

    private static String fmtTime(long sec) {
        return String.format(Locale.ROOT, "%d:%02d", sec / 60, sec % 60);
    }

    // --- камера ---

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> f = ProcessCameraProvider.getInstance(this);
        f.addListener(() -> {
            try {
                ProcessCameraProvider provider = f.get();
                // превью в тех же 16:9, что и видео
                ResolutionSelector rs = new ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
                    .build();
                Preview p = new Preview.Builder().setResolutionSelector(rs).build();
                p.setSurfaceProvider(preview.getSurfaceProvider());
                Recorder rec = new Recorder.Builder()
                    .setQualitySelector(QualitySelector.from(Quality.FHD, FallbackStrategy.lowerQualityOrHigherThan(Quality.HD)))
                    .setTargetVideoEncodingBitRate(getIntent().getIntExtra("bitrate", 2_500_000))
                    .build();
                videoCapture = VideoCapture.withOutput(rec);
                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, videoCapture);
                camera.getCameraInfo().getZoomState().observe(this, this::onZoom);
                recBtn.setEnabled(true);
            } catch (Exception e) {
                finishWith("fallback", e.getMessage());
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private ZoomState zoomState() {
        return camera == null ? null : camera.getCameraInfo().getZoomState().getValue();
    }

    private void setZoom(float z) {
        ZoomState s = zoomState();
        if (s == null) return;
        camera.getCameraControl().setZoomRatio(Math.max(s.getMinZoomRatio(), Math.min(s.getMaxZoomRatio(), z)));
    }

    private void onZoom(ZoomState z) {
        // кнопки — один раз, когда стал известен диапазон камеры
        if (markBtns.isEmpty()) {
            for (float m : MARKS) {
                // 0.5 — если камера опускается ниже ~0.95 (на Pixel — 0.508); остальное — в пределах максимума
                float v = m < 1 ? z.getMinZoomRatio() : m;
                if (m < 1 && z.getMinZoomRatio() > 0.95f) continue;
                if (m > z.getMaxZoomRatio() + 0.01f) continue;
                Button b = textButton(fmtZoom(m, false));
                b.setTextSize(13);
                b.setPadding(0, 0, 0, 0);
                b.setSingleLine(true);
                b.setOnClickListener(x -> setZoom(v));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(44), dp(36));
                lp.setMargins(dp(2), 0, dp(2), 0);
                zoomRow.addView(b, lp);
                markBtns.add(b);
                markVals.add(v);
            }
            zoomRow.setVisibility(markBtns.size() > 1 ? View.VISIBLE : View.GONE);
        }
        float r = z.getZoomRatio();
        zoomValue.setText(fmtZoom(r < 1 && r > 0.45f ? Math.max(0.5f, r) : r, true));
        // подсвечена ближайшая снизу отметка
        int sel = 0;
        for (int i = 0; i < markVals.size(); i++) if (r >= markVals.get(i) - 0.02f) sel = i;
        for (int i = 0; i < markBtns.size(); i++) {
            Button b = markBtns.get(i);
            boolean on = i == sel;
            b.setBackground(round(on ? 0xFFFFFFFF : 0x00000000, 18));
            b.setTextColor(on ? Color.BLACK : Color.WHITE);
        }
    }

    // --- запись ---

    private void startRecording() {
        if (videoCapture == null) return;
        out = new File(getCacheDir(), "walk-" + System.currentTimeMillis() + ".mp4");
        FileOutputOptions opts = new FileOutputOptions.Builder(out).setDurationLimitMillis(maxSec * 1000L).build();
        PendingRecording pr = videoCapture.getOutput().prepareRecording(this, opts);
        // со звуком мастер проговаривает повреждения; без разрешения на микрофон — только видео
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) pr = pr.withAudioEnabled();
        discard = false;
        recording = pr.start(ContextCompat.getMainExecutor(this), this::onRecordEvent);
        styleRecButton(true);
        cancelBtn.setVisibility(View.INVISIBLE);
        galleryBtn.setVisibility(View.INVISIBLE);
        top.setText("● " + fmtTime(0) + " / " + fmtTime(maxSec));
    }

    private void onRecordEvent(VideoRecordEvent e) {
        if (e instanceof VideoRecordEvent.Status) {
            long sec = e.getRecordingStats().getRecordedDurationNanos() / 1_000_000_000L;
            top.setText("● " + fmtTime(sec) + " / " + fmtTime(maxSec));
        } else if (e instanceof VideoRecordEvent.Finalize) {
            recording = null;
            VideoRecordEvent.Finalize fin = (VideoRecordEvent.Finalize) e;
            double dur = fin.getRecordingStats().getRecordedDurationNanos() / 1e9;
            if (discard) {
                if (out != null) out.delete();
                finishWith("cancel", null);
            } else if (out != null && out.length() > 1000) {
                // в том числе «упёрлись в лимит времени» — файл целый
                Intent d = new Intent();
                d.putExtra("path", out.getAbsolutePath());
                d.putExtra("duration", dur);
                setResult(RESULT_OK, d);
                finish();
            } else {
                if (out != null) out.delete();
                finishWith("fallback", "error " + fin.getError());
            }
        }
    }

    private void cancel() {
        if (recording != null) {
            discard = true;
            recording.stop();
        } else finishWith("cancel", null);
    }

    private void finishWith(String action, String message) {
        Intent d = new Intent();
        d.putExtra("action", action);
        if (message != null) d.putExtra("message", message);
        setResult(RESULT_CANCELED, d);
        finish();
    }

    // прошлые записи уже перенесены в приложение — файлы в кеше не нужны
    private void cleanOld() {
        File[] old = getCacheDir().listFiles((dir, name) -> name.startsWith("walk-") && name.endsWith(".mp4"));
        if (old != null) for (File f : old) f.delete();
    }
}
