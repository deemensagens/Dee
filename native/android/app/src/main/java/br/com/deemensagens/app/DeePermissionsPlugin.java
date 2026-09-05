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
    //  GUARDAR QUEM É O DONO DESTE APARELHO
    // ══════════════════════════════════════════════════════════
    //  O botão "Recusar" da notificação precisa avisar o servidor sem
    //  abrir o app (ver DeeDeclineReceiver). Para o servidor conferir se
    //  o pedido é legítimo, ele precisa saber de quem é o aparelho — e
    //  esse dado só existe dentro do app, que naquele momento está
    //  fechado. Por isso ele é gravado aqui assim que a pessoa entra na
    //  conta, ficando disponível para o lado nativo a qualquer hora.
    @PluginMethod
    public void setUid(PluginCall call) {
        try {
            String uid = call.getString("uid");
            android.content.SharedPreferences prefs =
                getContext().getSharedPreferences("CapacitorStorage", android.content.Context.MODE_PRIVATE);
            prefs.edit().putString("dee_uid", uid == null ? "" : uid).apply();
        } catch (Exception ignored) { }
        call.resolve();
    }

    // ══════════════════════════════════════════════════════════
    //  SALVAR UM ARQUIVO RECEBIDO E ABRIR COM O APP DA ESCOLHA
    // ══════════════════════════════════════════════════════════
    //  No navegador, baixar um arquivo é só um link. Aqui não: o arquivo
    //  veio embutido na própria mensagem, ele já está na mão do aparelho.
    //  O Android não sabe "baixar" algo que não está na internet, então o
    //  toque em Baixar simplesmente não fazia nada — era por isso que não
    //  dava para salvar documento nenhum pelo aplicativo.
    //
    //  Aqui gravamos o arquivo na pasta de Downloads (a mesma de qualquer
    //  outro download, então a pessoa encontra onde espera encontrar) e
    //  abrimos a lista de "abrir com...", para ela escolher com o que
    //  visualizar. Funciona para qualquer formato: PDF, planilha, texto,
    //  imagem, compactado.
    @PluginMethod
    public void salvarArquivo(PluginCall call) {
        String base64 = call.getString("base64");
        String nome   = call.getString("fileName");
        String tipo   = call.getString("mimeType");

        JSObject r = new JSObject();
        if (base64 == null || base64.isEmpty()) { r.put("saved", false); call.resolve(r); return; }
        if (nome == null || nome.isEmpty()) nome = "arquivo";

        try {
            // O conteúdo chega como "data:tipo;base64,XXXX" — separamos o
            // cabeçalho do conteúdo em si.
            String conteudo = base64;
            int virgula = base64.indexOf(',');
            if (base64.startsWith("data:") && virgula > 0) {
                if ((tipo == null || tipo.isEmpty())) {
                    int pv = base64.indexOf(';');
                    if (pv > 5) tipo = base64.substring(5, pv);
                }
                conteudo = base64.substring(virgula + 1);
            }
            byte[] dados = android.util.Base64.decode(conteudo, android.util.Base64.DEFAULT);
            if (tipo == null || tipo.isEmpty()) tipo = "application/octet-stream";

            java.io.File pasta = android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_DOWNLOADS);
            if (pasta != null && !pasta.exists()) pasta.mkdirs();

            java.io.File arquivo = new java.io.File(pasta, nome);
            // Se já existe um arquivo com esse nome, acrescenta um número
            // em vez de sobrescrever o que a pessoa já tinha.
            int n = 1;
            String base = nome, ext = "";
            int ponto = nome.lastIndexOf('.');
            if (ponto > 0) { base = nome.substring(0, ponto); ext = nome.substring(ponto); }
            while (arquivo.exists() && n < 100) {
                arquivo = new java.io.File(pasta, base + " (" + n + ")" + ext);
                n++;
            }

            java.io.FileOutputStream saida = new java.io.FileOutputStream(arquivo);
            saida.write(dados);
            saida.flush();
            saida.close();

            // Avisa o sistema que existe um arquivo novo, para ele
            // aparecer na Galeria e no gerenciador de arquivos.
            try {
                android.media.MediaScannerConnection.scanFile(
                    getContext(), new String[]{ arquivo.getAbsolutePath() }, new String[]{ tipo }, null);
            } catch (Exception ignored) { }

            // Abre a lista de aplicativos capazes de exibir esse arquivo.
            try {
                Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", arquivo);
                Intent ver = new Intent(Intent.ACTION_VIEW);
                ver.setDataAndType(uri, tipo);
                ver.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                Intent escolha = Intent.createChooser(ver, "Abrir com");
                escolha.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(escolha);
            } catch (Exception ignored) {
                // Sem nenhum app capaz de abrir aquele formato: o arquivo
                // continua salvo em Downloads, que é o mais importante.
            }

            r.put("saved", true);
            r.put("path", arquivo.getAbsolutePath());
        } catch (Exception e) {
            r.put("saved", false);
            r.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(r);
    }

    // ══════════════════════════════════════════════════════════
    //  ABRIR UMA LOCALIZAÇÃO NO APP DE MAPAS DO CELULAR
    // ══════════════════════════════════════════════════════════
    //  Antes, tocar numa localização recebida chamava window.open com um
    //  link do Google Maps. Dentro do app isso tentava carregar a página
    //  na própria janela do Dee, que não tem permissão para navegar até
    //  lá — e o que aparecia era "Página da Web não disponível".
    //
    //  Aqui usamos o endereço "geo:", que é a forma padrão do Android de
    //  dizer "isto é um lugar no mapa". O sistema então abre a lista de
    //  aplicativos capazes de mostrar aquele ponto — Google Maps, Waze,
    //  Mapas do fabricante — e a pessoa escolhe qual quer usar, do mesmo
    //  jeito que acontece em qualquer outro app.
    //
    //  Se o aparelho não tiver nenhum app de mapas instalado, caímos no
    //  link normal do Google Maps aberto no navegador, para nunca ficar
    //  sem resposta ao toque.
    @PluginMethod
    public void openMap(PluginCall call) {
        String geo   = call.getString("geo");    // ex.: geo:0,0?q=-10.9,-37.0(Local)
        String web   = call.getString("web");    // ex.: https://www.google.com/maps?q=...
        boolean abriu = false;

        if (geo != null && !geo.isEmpty()) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(geo));
                // O "chooser" garante a pergunta "abrir com..." mesmo quando
                // já existe um app definido como padrão, deixando a escolha
                // sempre com a pessoa.
                Intent escolha = Intent.createChooser(i, "Abrir localização com");
                escolha.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(escolha);
                abriu = true;
            } catch (Exception ignored) { }
        }

        if (!abriu && web != null && !web.isEmpty()) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(web));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                abriu = true;
            } catch (Exception ignored) { }
        }

        JSObject r = new JSObject();
        r.put("opened", abriu);
        call.resolve(r);
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
