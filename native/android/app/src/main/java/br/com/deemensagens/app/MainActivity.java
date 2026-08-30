package br.com.deemensagens.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private static final String MSG_CHANNEL_ID         = "dee_messages";
    private static final String MSG_CHANNEL_HEADS_UP_ID = "dee_messages_headsup";
    private static final int    REQ_NOTIFICATION        = 1001;

    private float   lastTop = 0, lastBottom = 0, lastLeft = 0, lastRight = 0;
    private boolean hasInsets = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1. Cria canais ANTES de tudo — se não existirem quando a
        //    primeira notificação chegar, ela é descartada silenciosamente.
        createNotificationChannels();

        // 2. Pede todas as permissões necessárias na primeira abertura.
        requestAllRequiredPermissions();

        // 3. Edge-to-edge + injeção de safe-area na WebView.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        final WebView webView = this.bridge.getWebView();
        final float density   = getResources().getDisplayMetrics().density;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            lastTop    = pxToCssPx(bars.top,    density);
            lastBottom = pxToCssPx(Math.max(bars.bottom, ime.bottom), density);
            lastLeft   = pxToCssPx(bars.left,   density);
            lastRight  = pxToCssPx(bars.right,  density);
            hasInsets  = true;

            injectSafeAreaInsets(webView, lastTop, lastBottom, lastLeft, lastRight);
            return windowInsets;
        });

        // Reinjeta em onPageFinished + duas reinjeções tardias para garantir
        // que a página final (após redirecionamentos do server.url) receba
        // os valores corretos, independente da ordem dos eventos.
        webView.setWebViewClient(new BridgeWebViewClient(this.bridge) {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (!hasInsets) return;
                injectSafeAreaInsets(view, lastTop, lastBottom, lastLeft, lastRight);
                mainHandler.postDelayed(() ->
                    injectSafeAreaInsets(view, lastTop, lastBottom, lastLeft, lastRight), 500);
                mainHandler.postDelayed(() ->
                    injectSafeAreaInsets(view, lastTop, lastBottom, lastLeft, lastRight), 1500);
            }
        });

        webView.post(() -> ViewCompat.requestApplyInsets(webView));
    }

    // ══════════════════════════════════════════════════════════
    //  REAPLICAR INSETS AO VOLTAR PARA O APP (troca de modo de navegação)
    // ══════════════════════════════════════════════════════════
    //  Pra trocar entre gestos e botões, o usuário obrigatoriamente sai do
    //  Dee e entra em Configurações — não dá pra trocar sem sair do app.
    //  Isso significa que onResume()/onWindowFocusChanged() SEMPRE disparam
    //  quando ele volta, então são o gancho certo pra pedir novos insets.
    //
    //  Por que não confiar só no listener do onCreate: em algumas ROMs
    //  (Realme UI, MIUI, OxygenOS) o listener de insets original não é
    //  rechamado sozinho quando o app estava em segundo plano durante a
    //  troca — ele só recebe o novo valor se alguém pedir explicitamente
    //  de novo. Sem isso, a barra de digitar ficaria com o tamanho antigo
    //  até o usuário fechar e reabrir o app.
    @Override
    public void onResume() {
        super.onResume();
        reaplicarInsets();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // hasFocus=true cobre também voltar da barra de notificações ou do
        // menu de apps recentes, não só do onResume.
        if (hasFocus) reaplicarInsets();
    }

    private void reaplicarInsets() {
        if (this.bridge == null) return;
        final WebView webView = this.bridge.getWebView();
        if (webView == null) return;

        webView.post(() -> ViewCompat.requestApplyInsets(webView));
        // Segunda tentativa com atraso — cobre o caso em que o sistema
        // ainda não terminou de recalcular o tamanho da barra de
        // navegação no exato instante em que o app volta ao primeiro plano.
        webView.postDelayed(() -> ViewCompat.requestApplyInsets(webView), 400);
    }

    // ══════════════════════════════════════════════════════════
    //  PERMISSÕES — pedidas na primeira abertura do app
    // ══════════════════════════════════════════════════════════
    private void requestAllRequiredPermissions() {
        // Android 13+ exige permissão explícita de notificação em runtime.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                        REQ_NOTIFICATION
                );
            }
        }

        // Otimização de bateria — crítico para notificações com app fechado.
        // Sem isso, ROMs como Realme UI, MIUI e OxygenOS matam o serviço
        // FCM após alguns minutos com a tela desligada.
        requestBatteryOptimizationExemption();
    }

    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        String pkg = getPackageName();
        if (pm.isIgnoringBatteryOptimizations(pkg)) return; // já está liberado

        // Abre a tela de configuração pedindo para ignorar otimização de
        // bateria — o usuário precisa confirmar manualmente, mas a tela
        // já abre direto no app (sem precisar navegar nas configurações).
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            startActivity(intent);
        } catch (Exception e) {
            // Se o dispositivo não suportar a intent direta, abre a tela
            // geral de otimização de bateria como fallback.
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                startActivity(fallback);
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATION) {
            // Após responder o pedido de notificação, pede a isenção
            // de bateria (em sequência para não sobrecarregar o usuário).
            mainHandler.postDelayed(this::requestBatteryOptimizationExemption, 800);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  CANAIS DE NOTIFICAÇÃO
    // ══════════════════════════════════════════════════════════
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
                ContextCompat.getSystemService(this, NotificationManager.class);
        if (manager == null) return;

        // Canal principal
        NotificationChannel msgChannel = new NotificationChannel(
                MSG_CHANNEL_ID, "Mensagens", NotificationManager.IMPORTANCE_HIGH);
        msgChannel.setDescription("Notificações de novas mensagens no Dee");
        msgChannel.enableVibration(true);
        msgChannel.enableLights(true);
        msgChannel.setShowBadge(true);
        manager.createNotificationChannel(msgChannel);

        // Canal heads-up — ROMs customizadas (Realme UI, MIUI, OxygenOS)
        // às vezes exigem um canal separado para notificações na tela bloqueada.
        NotificationChannel headsUpChannel = new NotificationChannel(
                MSG_CHANNEL_HEADS_UP_ID, "Mensagens (tela bloqueada)",
                NotificationManager.IMPORTANCE_HIGH);
        headsUpChannel.setDescription("Notificações de mensagens na tela bloqueada");
        headsUpChannel.enableVibration(true);
        headsUpChannel.enableLights(true);
        headsUpChannel.setShowBadge(true);
        manager.createNotificationChannel(headsUpChannel);
    }

    // ══════════════════════════════════════════════════════════
    //  SAFE-AREA
    // ══════════════════════════════════════════════════════════
    private static float pxToCssPx(int px, float density) {
        return px / density;
    }

    private void injectSafeAreaInsets(@NonNull WebView webView,
                                      float top, float bottom,
                                      float left, float right) {
        String js =
            "document.documentElement.style.setProperty('--safe-area-inset-top','"    + top    + "px');"
          + "document.documentElement.style.setProperty('--safe-area-inset-bottom','" + bottom + "px');"
          + "document.documentElement.style.setProperty('--safe-area-inset-left','"   + left   + "px');"
          + "document.documentElement.style.setProperty('--safe-area-inset-right','"  + right  + "px');";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}