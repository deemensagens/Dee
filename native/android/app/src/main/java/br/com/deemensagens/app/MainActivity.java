package br.com.deemensagens.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
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

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private static final String MSG_CHANNEL_ID         = "dee_messages";
    private static final String MSG_CHANNEL_HEADS_UP_ID = "dee_messages_headsup";
    private static final int    REQ_NOTIFICATION        = 1001;

    private static final String PREFS_NAME           = "dee_prefs";
    private static final String PREF_AUTOSTART_SHOWN = "autostart_prompt_shown";

    private float   lastTop = 0, lastBottom = 0, lastLeft = 0, lastRight = 0;
    private boolean hasInsets     = false;
    private boolean isFirstResume = true;
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

        // ══════════════════════════════════════════════════════════
        //  COLD START FIX — ColorOS / RealmeUI / OxygenOS (Realme, Oppo,
        //  OnePlus) demoram mais que outras ROMs pra reportar o tamanho
        //  real da barra de navegação logo na primeira abertura do app.
        //  O primeiro callback de insets às vezes chega com bottom=0
        //  (valor "provisório"), e nada dispara um novo pedido sozinho
        //  nesse momento — só reaplicarInsets() cobria esse caso, mas ela
        //  só roda em onResume/onWindowFocusChanged, que não disparam de
        //  novo logo depois do onCreate. Pedimos de novo em intervalos
        //  crescentes só nos primeiros segundos de vida da Activity, pra
        //  pegar o valor certo assim que a ROM terminar de calcular o
        //  layout real das barras do sistema.
        // ══════════════════════════════════════════════════════════
        mainHandler.postDelayed(() -> ViewCompat.requestApplyInsets(webView), 300);
        mainHandler.postDelayed(() -> ViewCompat.requestApplyInsets(webView), 800);
        mainHandler.postDelayed(() -> ViewCompat.requestApplyInsets(webView), 1800);
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

        // Pula a primeiríssima chamada (é só a abertura normal do app,
        // logo após o onCreate) — a partir da segunda vez que o app volta
        // ao primeiro plano (ex.: voltando da tela de bateria que acabamos
        // de abrir), é seguro oferecer a tela de "Início automático",
        // porque o usuário já viu/respondeu os pedidos anteriores.
        if (isFirstResume) {
            isFirstResume = false;
        } else {
            maybeRequestAutostartPermission();
        }
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

    // ══════════════════════════════════════════════════════════
    //  INÍCIO AUTOMÁTICO — segunda camada de bateria de ROMs chinesas
    // ══════════════════════════════════════════════════════════
    //  Xiaomi (MIUI), Oppo/Realme/OnePlus (ColorOS/RealmeUI/OxygenOS),
    //  Vivo e Huawei/Honor têm um gerenciador de energia PRÓPRIO, além
    //  do padrão do Android. Mesmo com "ignorar otimização de bateria"
    //  concedido (API oficial, já tratada acima), essas ROMs ainda podem
    //  matar o app e impedir o FCM de acordá-lo, a menos que o usuário
    //  ative manualmente "Início automático" (ou nome equivalente) —
    //  não existe uma API do Android pra isso, cada fabricante tem sua
    //  própria tela, então detectamos a marca e levamos direto pra ela.
    //  Em aparelhos sem essa camada extra (Samsung, Motorola, Google,
    //  LG...) esse método simplesmente não faz nada.
    private void maybeRequestAutostartPermission() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean(PREF_AUTOSTART_SHOWN, false)) return; // já mostramos uma vez

        Intent target = autostartIntentForManufacturer();
        if (target == null) return; // marca sem essa tela extra conhecida

        prefs.edit().putBoolean(PREF_AUTOSTART_SHOWN, true).apply();

        new AlertDialog.Builder(this)
            .setTitle("Um passo a mais pra não perder mensagens")
            .setMessage("Seu celular tem um controle de bateria próprio, além do que você já liberou. Na tela que vai abrir, ative \"Início automático\" (ou nome parecido) para o Dee — sem isso, notificações podem não chegar com o app fechado.")
            .setPositiveButton("Abrir configurações", (dialog, which) -> {
                try {
                    startActivity(target);
                } catch (Exception e) {
                    openAppDetailsSettingsFallback();
                }
            })
            .setNegativeButton("Agora não", null)
            .setCancelable(true)
            .show();
    }

    // Monta a lista de telas conhecidas pra marca do aparelho atual e
    // devolve a primeira que realmente existir nesse dispositivo
    // específico (o nome do componente muda de versão pra versão da
    // ROM, por isso a lista de tentativas em vez de um valor único).
    private Intent autostartIntentForManufacturer() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        List<Intent> candidates = new ArrayList<>();

        if (manufacturer.contains("xiaomi")) {
            candidates.add(component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        } else if (manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus")) {
            // ColorOS / RealmeUI / OxygenOS compartilham a mesma base hoje —
            // tentamos várias variantes conhecidas, porque o componente
            // muda de versão pra versão da ROM e de marca pra marca.
            candidates.add(component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"));
            candidates.add(component("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"));
            candidates.add(component("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"));
            candidates.add(component("com.coloros.oppoguardelf", "com.coloros.oppoguardelf.activity.WhiteListAddActivity"));
            candidates.add(component("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"));
        } else if (manufacturer.contains("vivo")) {
            candidates.add(component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"));
            candidates.add(component("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"));
        } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
            candidates.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"));
            candidates.add(component("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"));
        } else if (manufacturer.contains("asus")) {
            candidates.add(component("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"));
        } else {
            return null; // Samsung, Motorola, Google, LG etc. não têm essa camada extra
        }

        for (Intent candidate : candidates) {
            if (candidate.resolveActivity(getPackageManager()) != null) return candidate;
        }
        return null; // nenhuma variante conhecida existe nesse aparelho específico
    }

    private Intent component(String pkg, String cls) {
        Intent intent = new Intent();
        intent.setComponent(new ComponentName(pkg, cls));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    // Se a tela específica da marca não existir/não abrir por algum
    // motivo, cai pelo menos na tela de detalhes do app — de lá o
    // usuário ainda consegue chegar manualmente nas opções de bateria.
    private void openAppDetailsSettingsFallback() {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception ignored) {}
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