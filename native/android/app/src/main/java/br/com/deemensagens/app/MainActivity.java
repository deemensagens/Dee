package br.com.deemensagens.app;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // ══════════════════════════════════════════════════════════
    //  A partir do Android 15/16 (targetSdk 35+), o sistema obriga o app a
    //  desenhar em modo "edge-to-edge" (por baixo da barra de status e da
    //  barra/gestos de navegação), sem opção de desativar isso pelo
    //  Manifest. Como consequência, a WebView passou a ocupar a tela
    //  inteira e a .input-bar (campo de digitar mensagem) do index.html
    //  ficava escondida atrás dos botões/gestos de navegação do Android.
    //
    //  O CSS do app já está pronto pra esse cenário — ele usa
    //  `var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))`
    //  e só precisa que alguém preencha essa variável --safe-area-inset-*
    //  no <html> com o tamanho real das barras do sistema. Isso é papel do
    //  lado nativo (a WebView do Android, diferente do Safari/iOS, não
    //  preenche env(safe-area-inset-*) sozinha). Este trecho escuta as
    //  WindowInsets reais (barra de status, barra de navegação e teclado)
    //  e injeta os valores em pixels CSS direto na WebView.
    // ══════════════════════════════════════════════════════════
    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final WebView webView = this.bridge.getWebView();
        final float density = getResources().getDisplayMetrics().density;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            int top    = bars.top;
            int bottom = Math.max(bars.bottom, ime.bottom);
            int left   = bars.left;
            int right  = bars.right;

            injectSafeAreaInsets(webView,
                    pxToCssPx(top, density),
                    pxToCssPx(bottom, density),
                    pxToCssPx(left, density),
                    pxToCssPx(right, density));

            return windowInsets;
        });

        // Garante que o listener acima rode assim que a WebView terminar de
        // montar (a primeira aplicação de insets pode acontecer antes do
        // Capacitor terminar de carregar o index.html).
        webView.post(() -> ViewCompat.requestApplyInsets(webView));
    }

    private static float pxToCssPx(int px, float density) {
        return px / density;
    }

    private void injectSafeAreaInsets(@NonNull WebView webView, float top, float bottom, float left, float right) {
        String js = "document.documentElement.style.setProperty('--safe-area-inset-top', '" + top + "px');"
                + "document.documentElement.style.setProperty('--safe-area-inset-bottom', '" + bottom + "px');"
                + "document.documentElement.style.setProperty('--safe-area-inset-left', '" + left + "px');"
                + "document.documentElement.style.setProperty('--safe-area-inset-right', '" + right + "px');";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
