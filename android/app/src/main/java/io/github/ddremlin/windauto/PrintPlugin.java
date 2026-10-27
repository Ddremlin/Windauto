package io.github.ddremlin.windauto;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** window.print() в WebView не работает — печатаем страницу через системную печать Android */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Windauto");
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(name);
            pm.print(name, adapter, new PrintAttributes.Builder().build());
            call.resolve();
        });
    }
}
