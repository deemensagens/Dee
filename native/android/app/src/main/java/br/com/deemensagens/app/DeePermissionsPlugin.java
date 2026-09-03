package br.com.deemensagens.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// ══════════════════════════════════════════════════════════
//  DeePermissionsPlugin — ponte entre o JavaScript e as
//  permissões do ANDROID
// ══════════════════════════════════════════════════════════
//  POR QUE ISTO EXISTE
//
//  A tela de Configurações do Dee mostrava permissões do NAVEGADOR
//  (Notification API, câmera e microfone via getUserMedia). Isso faz todo
//  sentido no site e no PWA, que realmente dependem delas.
//
//  Dentro do app instalado, porém, essas permissões não são as que
//  importam: quem manda ali são as permissões do Android (notificação,
//  bateria, início automático, tela cheia, sobreposição). Elas não podem
//  ser lidas nem alteradas por JavaScript — só por código nativo. Sem
//  esta ponte, a tela de Configurações do APK mostrava interruptores que
//  não controlavam nada de verdade.
//
//  O que este plugin faz:
//    check()          → devolve o estado real de cada permissão
//    open({ what })   → abre a tela do sistema correspondente
//
//  IMPORTANTE: nenhum app pode CONCEDER essas permissões por código —
//  o Android exige que o usuário confirme na tela do sistema. Por isso
//  aqui só lemos o estado e abrimos a tela certa; o toque final é sempre
//  do usuário. Não é limitação do Dee, é regra da plataforma.
// ══════════════════════════════════════════════════════════
@CapacitorPlugin(name = "DeePermissions")
public class DeePermissionsPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        JSObject r = new JSObject();

        // Notificações (Android 13+ pede permissão; antes disso vem liberada)
        boolean notif = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notif = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        r.put("notifications", notif);

        // Bateria sem restrição
        boolean bateria = false;
        try {
            PowerManager pm = ContextCompat.getSystemService(getContext(), PowerManager.class);
            if (pm != null) bateria = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        } catch (Exception ignored) {}
        r.put("battery", bateria);

        // Exibir sobre outros apps (necessária para a chamada abrir em tela
        // cheia com o celular em uso)
        boolean overlay = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            overlay = Settings.canDrawOverlays(getContext());
        }
        r.put("overlay", overlay);

        // Tela cheia de chamadas (virou permissão especial no Android 14)
        boolean fsi = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            NotificationManager nm = ContextCompat.getSystemService(getContext(), NotificationManager.class);
            fsi = nm != null && nm.canUseFullScreenIntent();
        }
        r.put("fullScreen", fsi);

        // Câmera e microfone (permissões normais do Android)
        r.put("camera", ContextCompat.checkSelfPermission(getContext(), Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED);
        r.put("microphone", ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED);
        r.put("location", ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED);

        // "Início automático" não tem API de leitura em nenhuma ROM — não
        // existe forma suportada de saber se está ligado. Por isso o JS
        // trata essa como "não sei", mostrando só o atalho para a tela.
        r.put("autostartSupported", autostartIntent() != null);

        call.resolve(r);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String what = call.getString("what", "");
        Intent intent = null;

        try {
            switch (what == null ? "" : what) {
                case "notifications":
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
                    break;

                case "battery":
                    intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    break;

                case "overlay":
                    // Tratado à parte porque cada marca tem a própria tela.
                    if (abrirTelaDeSobreposicao()) { call.resolve(); return; }
                    intent = null; // nada funcionou: cai no fallback lá embaixo
                    break;

                case "fullScreen":
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                    }
                    break;

                case "autostart":
                    intent = autostartIntent();
                    break;

                default: // "app" — câmera, microfone e o resto das permissões
                    intent = null;
                    break;
            }

            // Qualquer caso não coberto (ou intent que não existe neste
            // aparelho) cai na tela de detalhes do app, de onde o usuário
            // chega em tudo manualmente. Nunca deixamos o botão sem efeito.
            if (intent == null || intent.resolveActivity(getContext().getPackageManager()) == null) {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            }

            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Não foi possível abrir as configurações");
        }
    }

    // ══════════════════════════════════════════════════════════
    //  "EXIBIR SOBRE OUTROS APLICATIVOS" — ABRIR DIRETO NO DEE
    // ══════════════════════════════════════════════════════════
    //  A forma oficial do Android (ACTION_MANAGE_OVERLAY_PERMISSION com o
    //  nome do pacote junto) já pede para abrir direto na tela do Dee. Só
    //  que várias marcas — Realme, Oppo, Xiaomi, vivo — trocam essa tela
    //  pela versão própria delas e ignoram o pacote, jogando a pessoa
    //  naquela lista gigante com todos os apps do celular, onde ela tem
    //  que procurar o Dee no meio de dezenas de outros.
    //
    //  Aqui tentamos, em ordem: primeiro a tela específica da marca já
    //  apontando para o Dee, depois a forma oficial do Android com o
    //  pacote, e só se as duas falharem é que caímos na lista geral.
    //  Assim, na prática, a pessoa chega direto no interruptor certo.
    //
    //  Devolve true se conseguiu abrir alguma tela; false se nenhuma
    //  funcionou (aí quem chamou usa o fallback padrão).
    private boolean abrirTelaDeSobreposicao() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;

        String pkg = getContext().getPackageName();
        String marca = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        java.util.List<Intent> tentativas = new java.util.ArrayList<>();

        // 1) Tela da própria marca, já apontando para o Dee
        if (marca.contains("xiaomi") || marca.contains("redmi") || marca.contains("poco")) {
            Intent miui = new Intent("miui.intent.action.APP_PERM_EDITOR");
            miui.setClassName("com.miui.securitycenter",
                    "com.miui.permcenter.permissions.PermissionsEditorActivity");
            miui.putExtra("extra_pkgname", pkg);
            tentativas.add(miui);
        } else if (marca.contains("oppo") || marca.contains("realme") || marca.contains("oneplus")) {
            Intent oppo = new Intent();
            oppo.setClassName("com.coloros.safecenter",
                    "com.coloros.safecenter.permission.floatwindow.FloatWindowListActivity");
            oppo.putExtra("packageName", pkg);
            tentativas.add(oppo);

            Intent oppoAntigo = new Intent();
            oppoAntigo.setClassName("com.color.safecenter",
                    "com.color.safecenter.permission.floatwindow.FloatWindowListActivity");
            oppoAntigo.putExtra("packageName", pkg);
            tentativas.add(oppoAntigo);
        } else if (marca.contains("vivo")) {
            Intent vivo = new Intent();
            vivo.setClassName("com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.PurviewTabActivity");
            vivo.putExtra("packagename", pkg);
            tentativas.add(vivo);
        } else if (marca.contains("huawei") || marca.contains("honor")) {
            Intent huawei = new Intent();
            huawei.setClassName("com.huawei.systemmanager",
                    "com.huawei.notificationmanager.ui.NotificationManagmentActivity");
            tentativas.add(huawei);
        }

        // 2) Forma oficial do Android, com o pacote do Dee embutido —
        //    na maioria dos aparelhos isso já abre a tela certa
        Intent oficial = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
        oficial.setData(Uri.parse("package:" + pkg));
        tentativas.add(oficial);

        // 3) Último recurso: a lista geral (é o comportamento antigo)
        tentativas.add(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION));

        for (Intent i : tentativas) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                return true;
            } catch (Exception ignored) {
                // Esta ROM não tem essa tela — tenta a próxima da lista.
            }
        }
        return false;
    }

    // Telas de "Início automático" das ROMs que têm essa camada extra.
    // Devolve null em aparelhos sem ela (Samsung, Motorola, Google...).
    private Intent autostartIntent() {
        String m = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        Intent i = null;

        if (m.contains("xiaomi")) {
            i = component("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity");
        } else if (m.contains("oppo") || m.contains("realme") || m.contains("oneplus")) {
            Intent pm = getContext().getPackageManager().getLaunchIntentForPackage("com.coloros.phonemanager");
            if (pm != null) return pm;
            i = component("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity");
        } else if (m.contains("vivo")) {
            i = component("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity");
        } else if (m.contains("huawei") || m.contains("honor")) {
            i = component("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity");
        }

        if (i != null && i.resolveActivity(getContext().getPackageManager()) != null) return i;
        return null;
    }

    private Intent component(String pkg, String cls) {
        Intent i = new Intent();
        i.setComponent(new android.content.ComponentName(pkg, cls));
        return i;
    }
}
