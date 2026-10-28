package io.github.ddremlin.windauto;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrintPlugin.class);
        registerPlugin(VideoRecorderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
