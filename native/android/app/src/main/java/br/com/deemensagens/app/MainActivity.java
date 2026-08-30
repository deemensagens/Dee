package br.com.deemensagens.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    // Precisa bater com o "channel_id" que o Cloudflare Worker manda no
    // payload FCM das mensagens normais (ver cloudflare-worker/src/index.js).
    // Sem um canal criado ANTES da notificação chegar, o Android 8+ recusa
    // mostrar a notificação automática (a que aparece sozinha com o app
    // fechado/em segundo plano) — ela simplesmente não aparece, sem erro
    // nenhum visível. Chamadas não precisam disso porque o próprio plugin
    // de chamada (capacitor-incoming-call-kit) já cria o canal dele na hora
    // que uma chamada chega.
    private static final String MSG_CHANNEL_ID = "dee_messages";

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
    //
    //  IMPORTANTE (causa raiz do bug corrigido aqui): o Capacitor navega a
    //  WebView pra URL remota (capacitor.config.json -> server.url) de
    //  forma assíncrona — o carregamento da página real demora mais que um
    //  ciclo do loop principal. Se o primeiro disparo do listener de
    //  insets abaixo acontecer ANTES desse carregamento terminar, o valor
    //  injetado fica preso num documento "descartável" (o que existia
    //  antes da navegação) e se perde assim que a página de verdade
    //  termina de carregar por cima — resultado: a variável CSS nunca
    //  chega na página real, e a barra de digitar fica sem saber o
    //  tamanho da área segura. Por isso guardamos os últimos insets
    //  calculados e os REINJETAMOS toda vez que uma página termina de
    //  carregar (ver onPageFinished abaixo), não só na primeira vez que o
    //  Android nos avisa das medidas.
    // ══════════════════════════════════════════════════════════
    private float lastTop = 0, lastBottom = 0, lastLeft = 0, lastRight = 0;
    private boolean hasInsets = false;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createMessageNotificationChannel();

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final WebView webView = this.bridge.getWebView();
        final float density = getResources().getDisplayMetrics().density;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            lastTop    = pxToCssPx(bars.top, density);
            lastBottom = pxToCssPx(Math.max(bars.bottom, ime.bottom), density);
            lastLeft   = pxToCssPx(bars.left, density);
            lastRight  = pxToCssPx(bars.right, density);
            hasInsets  = true;

            injectSafeAreaInsets(webView, lastTop, lastBottom, lastLeft, lastRight);

            return windowInsets;
        });

        // Reaplica os últimos insets conhecidos toda vez que a WebView
        // termina de carregar uma página — é o que garante que a página
        // REAL (não a transitória de antes da navegação) sempre recebe o
        // valor certo, não importa a ordem em que os dois eventos
        // (insets prontos vs página carregada) acontecem. Estende o
        // BridgeWebViewClient do próprio Capacitor (em vez de substituir
        // por um WebViewClient genérico) pra não perder nenhum
        // comportamento interno dele — roteamento de URL, injeção da
        // ponte JS, etc.
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (hasInsets) injectSafeAreaInsets(view, lastTop, lastBottom, lastLeft, lastRight);
            }
        });

        // Garante que o listener acima rode assim que a WebView terminar de
        // montar (a primeira aplicação de insets pode acontecer antes do
        // Capacitor terminar de carregar o index.html — daí a reinjeção em
        // onPageFinished acima ser necessária).
        webView.post(() -> ViewCompat.requestApplyInsets(webView));
    }

    private void createMessageNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // canais só existem a partir do Android 8
        NotificationChannel channel = new NotificationChannel(
                MSG_CHANNEL_ID,
                "Mensagens",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Notificações de novas mensagens no Dee");
        NotificationManager manager = ContextCompat.getSystemService(this, NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
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
