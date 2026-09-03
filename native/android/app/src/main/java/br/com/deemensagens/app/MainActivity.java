package br.com.deemensagens.app;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
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


public class MainActivity extends BridgeActivity {

    private static final String MSG_CHANNEL_ID         = "dee_messages";
    private static final String MSG_CHANNEL_HEADS_UP_ID = "dee_messages_headsup";
    private static final int    REQ_NOTIFICATION        = 1001;
    private static final int    REQ_LOCATION            = 1002;

    private static final String PREFS_NAME           = "dee_prefs";
    private static final String PREF_FSI_SHOWN       = "fsi_prompt_shown";
    private static final String PREF_OVERLAY_SHOWN   = "overlay_prompt_shown";


    private float   lastTop = 0, lastBottom = 0, lastLeft = 0, lastRight = 0;
    private boolean hasInsets     = false;
    private boolean isFirstResume = true;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        // Registra a ponte de permissões nativas ANTES do super.onCreate —
        // é a ordem exigida pelo Capacitor para plugins próprios. Ela deixa
        // a tela de Configurações do app instalado ler e abrir as permissões
        // reais do Android (ver DeePermissionsPlugin.java).
        registerPlugin(DeePermissionsPlugin.class);

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

            // Piso mínimo de 48dp no valor injetado pro app (só existe aqui,
            // no APK nativo — o PWA no navegador não passa por este código,
            // então não é afetado). 48dp é o padrão do Android pra altura de
            // barra de navegação de 3 botões; garante que a barra de digitar
            // nunca fique colada nos botões do celular mesmo se o sistema
            // reportar um valor errado/zerado pra essa ROM específica.
            float bottomPx = Math.max(bars.bottom, ime.bottom);
            float bottomDp = pxToCssPx((int) bottomPx, density);
            boolean keyboardVisible = ime.bottom > bars.bottom;

            lastTop    = pxToCssPx(bars.top,    density);
            lastBottom = keyboardVisible ? bottomDp : Math.max(bottomDp, 48f);
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
            // Um diálogo por vez, em cascata: só oferecemos o próximo
            // pedido se o anterior não apareceu agora, para não empilhar
            // várias caixas na cara do usuário de uma só vez.
            //
            // O antigo pedido de "Início automático" foi REMOVIDO daqui de
            // propósito. Ele nasceu quando ainda achávamos que a ROM estava
            // barrando as notificações — mas a causa real era outra (o
            // Worker recusando os pushes). Depois de corrigida, os testes
            // mostraram que as notificações chegam sem essa configuração,
            // então o pedido virou só um incômodo na abertura do app.
            // O atalho continua disponível, sem insistência, na tela de
            // Configurações (ver DeePermissionsPlugin.java).
            if (!maybeRequestFullScreenIntentPermission()) {
                maybeRequestOverlayPermission();
            }
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

        // Localização: usada ao enviar sua localização numa conversa.
        // Pedimos junto das demais na primeira abertura para o mapa não
        // falhar depois, no meio do envio.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{ Manifest.permission.ACCESS_FINE_LOCATION,
                                  Manifest.permission.ACCESS_COARSE_LOCATION },
                    REQ_LOCATION
            );
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
        // ══════════════════════════════════════════════════════════
        //  POR QUE EXISTE UMA VARIÁVEL PRÓPRIA (--dee-inset-bottom)
        // ══════════════════════════════════════════════════════════
        //  As variáveis --safe-area-inset-* NÃO são exclusivas nossas: o
        //  plugin interno SystemBars do Capacitor 8 escreve nas MESMAS
        //  variáveis, e em algumas ROMs ele grava 0 depois da gente
        //  (workaround interno dele para um bug do Chromium). Quem escreve
        //  por último vence, então nosso valor era sobrescrito por 0 e a
        //  barra de digitar colava no rodapé.
        //
        //  --dee-inset-bottom é um nome que só existe aqui, então ninguém
        //  mais sobrescreve. O <style> injetado abaixo usa SÓ essa variável
        //  (com !important), o que torna o resultado independente da briga
        //  acima. E como toda essa injeção roda apenas dentro do WebView do
        //  APK, o site e o PWA no navegador não são afetados em nada.
        // ══════════════════════════════════════════════════════════
        String js =
            "document.documentElement.style.setProperty('--safe-area-inset-top','"    + top    + "px');"
          + "document.documentElement.style.setProperty('--safe-area-inset-bottom','" + bottom + "px');"
          + "document.documentElement.style.setProperty('--safe-area-inset-left','"   + left   + "px');"
          + "document.documentElement.style.setProperty('--safe-area-inset-right','"  + right  + "px');"
          + "document.documentElement.style.setProperty('--dee-inset-bottom','"       + bottom + "px');"
          + "(function(){"
          + "  var id='dee-native-layout-fix';"
          + "  var host=document.head||document.documentElement;"
          + "  if(!host) return;"
          + "  var s=document.getElementById(id);"
          + "  if(!s){ s=document.createElement('style'); s.id=id; host.appendChild(s); }"
          + "  if(s.getAttribute('data-done')==='1') return;"
          + "  s.textContent="
          + "    '.input-bar{padding-bottom:calc(var(--dee-inset-bottom,0px) + 8px) !important;}'"
          + "  + '.me-bar{padding-bottom:calc(var(--dee-inset-bottom,0px) + 10px) !important;}'"
          + "  + '.cam-controls{padding-bottom:calc(var(--dee-inset-bottom,0px) + 16px) !important;}';"
          + "  s.setAttribute('data-done','1');"
          + "})();";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    // ══════════════════════════════════════════════════════════
    //  TELA CHEIA DE CHAMADA (Android 14+) — permissão especial
    // ══════════════════════════════════════════════════════════
    //  Até o Android 13, declarar USE_FULL_SCREEN_INTENT no manifest era
    //  suficiente para uma chamada recebida cobrir a tela inteira. A partir
    //  do Android 14 isso virou uma "permissão de acesso especial": só apps
    //  cuja função principal é telefonia/alarme recebem automaticamente, e
    //  os demais precisam pedir ao usuário. Se a permissão não estiver
    //  concedida, a notificação de chamada é rebaixada para um aviso comum
    //  (não cobre a tela) — que é exatamente o sintoma relatado.
    //
    //  Este app declara a permissão no manifest mas nunca checava nem pedia,
    //  então em Android 14/15/16 a tela cheia simplesmente não acontecia.
    private boolean maybeRequestFullScreenIntentPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return false; // < Android 14: já vem liberado

        NotificationManager nm = ContextCompat.getSystemService(this, NotificationManager.class);
        if (nm == null) return false;
        if (nm.canUseFullScreenIntent()) return false; // já concedida, nada a fazer

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean(PREF_FSI_SHOWN, false)) return false; // só pedimos uma vez
        prefs.edit().putBoolean(PREF_FSI_SHOWN, true).apply();

        new AlertDialog.Builder(this)
            .setTitle("Permitir tela cheia nas chamadas")
            .setMessage("Para uma chamada de voz ou vídeo aparecer em tela cheia (como uma ligação normal) mesmo com o Dee fechado, o Android precisa de uma autorização extra. Na tela que abrir, ative o Dee na lista.")
            .setPositiveButton("Abrir configurações", (dialog, which) -> {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    // Algumas ROMs não aceitam a intent com o package embutido;
                    // nesse caso abrimos a lista geral, onde o usuário acha o Dee.
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT));
                    } catch (Exception ignored) {
                        openAppDetailsSettingsFallback();
                    }
                }
            })
            .setNegativeButton("Agora não", null)
            .setCancelable(true)
            .show();
        return true;
    }

    // ══════════════════════════════════════════════════════════
    //  EXIBIR SOBRE OUTROS APPS — necessária para a tela cheia da
    //  chamada abrir sozinha com o celular em uso
    // ══════════════════════════════════════════════════════════
    //  O Android 10+ proíbe um app de abrir telas a partir do segundo
    //  plano. Com o celular BLOQUEADO isso não é problema, porque quem
    //  abre a tela é o próprio sistema (via fullScreenIntent). Mas com o
    //  celular desbloqueado e em uso, sem essa permissão a chamada vira
    //  só um aviso no topo, em vez de cobrir a tela como uma ligação.
    //
    //  "Exibir sobre outros aplicativos" (SYSTEM_ALERT_WINDOW) é uma das
    //  exceções oficiais dessa regra — por isso pedimos aqui. É a mesma
    //  permissão que apps de chamada costumam pedir na primeira abertura.
    private boolean maybeRequestOverlayPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        if (Settings.canDrawOverlays(this)) return false; // já concedida

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        if (prefs.getBoolean(PREF_OVERLAY_SHOWN, false)) return false; // só pedimos uma vez
        prefs.edit().putBoolean(PREF_OVERLAY_SHOWN, true).apply();

        new AlertDialog.Builder(this)
            .setTitle("Para as chamadas abrirem em tela cheia")
            .setMessage("Sem esta autorização, uma chamada recebida aparece só como um aviso no topo enquanto você usa o celular, em vez de cobrir a tela como uma ligação normal. Na tela que abrir, ative o Dee.")
            .setPositiveButton("Abrir configurações", (dialog, which) -> {
                try {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));
                    } catch (Exception ignored) {
                        openAppDetailsSettingsFallback();
                    }
                }
            })
            .setNegativeButton("Agora não", null)
            .setCancelable(true)
            .show();
        return true;
    }

}