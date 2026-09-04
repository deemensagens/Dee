// ══════════════════════════════════════════════════════════
//  native-bridge.js
//  Camada única que detecta se o Dee está rodando como app
//  nativo (Capacitor / "Dee Full") ou como site/PWA no navegador
//  ("Dee Lite"). Cada função nativa (câmeras, viva-voz, chamada em
//  tela cheia, push) vai se plugar aqui nos próximos passos —
//  por enquanto isso só define o "interruptor" e os fallbacks,
//  sem alterar nada do que já funciona no site/PWA.
// ══════════════════════════════════════════════════════════

(function (global) {
    'use strict';

    var isNative = !!(global.Capacitor && global.Capacitor.isNativePlatform && global.Capacitor.isNativePlatform());
    var platform = isNative && global.Capacitor.getPlatform ? global.Capacitor.getPlatform() : 'web';

    var DeeNative = {
        // true só dentro do app instalado via Capacitor (Dee Full).
        // false no navegador e no PWA instalado à tela inicial (Dee Lite).
        isNative: isNative,

        // 'android' | 'ios' | 'web'
        platform: platform,

        isAndroid: platform === 'android',
        isIOS: platform === 'ios',

        // true quando está rodando como PWA instalado (Dee Lite "instalado"),
        // mesmo sem ser o app nativo.
        isInstalledPWA: global.matchMedia && global.matchMedia('(display-mode: standalone)').matches,

        // Nome amigável pra usar em logs/telas de config.
        label: isNative ? 'Dee Full' : 'Dee Lite'
    };

    // ══════════════════════════════════════════════════════════
    //  Compartilhar (botão "Compartilhar" do app / do perfil)
    //  ──────────────────────────────────────────────────────────
    //  A WebView embutida no APK não implementa navigator.share (essa API
    //  só existe em navegadores de verdade, tipo o Chrome do PWA/site) —
    //  por isso o botão "caía" direto no fallback de copiar link dentro do
    //  app instalado. Esta função resolve isso com o plugin oficial
    //  @capacitor/share dentro do Dee Full, e continua usando
    //  navigator.share normalmente no site/PWA. Devolve true se ALGUMA
    //  forma de compartilhar foi mostrada (mesmo que a pessoa cancele a
    //  folha depois — isso não é erro, é escolha dela) e false só quando
    //  não existe NENHUMA forma de compartilhar disponível — nesse caso
    //  (e só nesse), quem chamou deve cair no fallback de copiar o link.
    // ══════════════════════════════════════════════════════════
    DeeNative.share = async function (opts) {
        opts = opts || {};
        if (isNative) {
            var plugins = global.Capacitor && global.Capacitor.Plugins;
            var sharePlugin = plugins && plugins.Share;
            if (sharePlugin && sharePlugin.share) {
                try {
                    await sharePlugin.share({
                        title: opts.title,
                        text: opts.text,
                        url: opts.url,
                        dialogTitle: opts.title
                    });
                } catch (e) { /* pessoa cancelou a folha nativa — não é erro */ }
                return true;
            }
        }
        if (global.navigator && global.navigator.share) {
            try { await global.navigator.share(opts); }
            catch (e) { /* pessoa cancelou — idem acima */ }
            return true;
        }
        return false;
    };

    // ══════════════════════════════════════════════════════════
    //  Permissões do Android (só existem no app instalado)
    //  ──────────────────────────────────────────────────────────
    //  No site e no PWA, quem manda são as permissões do NAVEGADOR
    //  (Notification API, getUserMedia) — e a tela de Configurações
    //  continua mostrando exatamente essas lá, sem mudança nenhuma.
    //
    //  Dentro do app instalado é outra história: as permissões que fazem
    //  o Dee funcionar são as do Android (notificação, bateria, início
    //  automático, tela cheia de chamada, exibir sobre outros apps), e
    //  elas não podem ser lidas nem alteradas por JavaScript. Estas duas
    //  funções conversam com o plugin nativo (DeePermissionsPlugin.java)
    //  para ler o estado real e abrir a tela certa do sistema.
    //
    //  Observação importante: nenhum app consegue CONCEDER essas
    //  permissões por conta própria — o Android exige o toque do usuário
    //  na tela do sistema. Por isso "open" só leva a pessoa até lá.
    // ══════════════════════════════════════════════════════════
    function pluginPermissoes() {
        var p = global.Capacitor && global.Capacitor.Plugins;
        return (p && p.DeePermissions) || null;
    }

    // Devolve um objeto com o estado de cada permissão, ou null quando não
    // estamos no app instalado (site/PWA) — quem chama usa isso para saber
    // que deve mostrar a versão web da tela.
    DeeNative.checkPermissions = async function () {
        if (!isNative) return null;
        var plugin = pluginPermissoes();
        if (!plugin || !plugin.check) return null;
        try { return await plugin.check(); }
        catch (e) { return null; }
    };

    // Abre a tela do sistema correspondente. "what" aceita:
    // 'notifications' | 'battery' | 'overlay' | 'fullScreen' | 'autostart'
    // qualquer outro valor abre a tela de detalhes do app.
    DeeNative.openPermission = async function (what) {
        if (!isNative) return false;
        var plugin = pluginPermissoes();
        if (!plugin || !plugin.open) return false;
        try { await plugin.open({ what: what || 'app' }); return true; }
        catch (e) { return false; }
    };

    // ══════════════════════════════════════════════════════════
    //  Tela apagada com o rosto encostado (chamada de voz)
    //  ──────────────────────────────────────────────────────────
    //  Nenhuma página web consegue apagar a tela do celular nem desligar
    //  o toque — isso é coisa que só o Android faz. Por isso quem executa
    //  é o plugin nativo (DeeProximityPlugin.java), e estas duas funções
    //  são só o atalho para chamá-lo de dentro do JavaScript da chamada.
    //
    //  No site e no PWA elas simplesmente não fazem nada e devolvem false,
    //  então o comportamento por lá continua exatamente o mesmo de sempre.
    // ══════════════════════════════════════════════════════════
    function pluginProximidade() {
        var p = global.Capacitor && global.Capacitor.Plugins;
        return (p && p.DeeProximity) || null;
    }

    DeeNative.startProximityLock = async function () {
        if (!isNative) return false;
        var plugin = pluginProximidade();
        if (!plugin || !plugin.start) return false;
        try {
            var r = await plugin.start();
            return !!(r && r.supported);
        } catch (e) { return false; }
    };

    DeeNative.stopProximityLock = async function () {
        if (!isNative) return false;
        var plugin = pluginProximidade();
        if (!plugin || !plugin.stop) return false;
        try { await plugin.stop(); return true; }
        catch (e) { return false; }
    };

    // ══════════════════════════════════════════════════════════
    //  Abrir uma localização no app de mapas do celular
    //  ──────────────────────────────────────────────────────────
    //  No app instalado quem faz isso é o Android (ver openMap em
    //  DeePermissionsPlugin.java): ele mostra a lista de aplicativos de
    //  mapa e a pessoa escolhe. No site e no PWA continua abrindo o
    //  Google Maps numa aba nova, como sempre foi.
    // ══════════════════════════════════════════════════════════
    DeeNative.openMap = async function (geo, web) {
        if (!isNative) return false;
        var p = global.Capacitor && global.Capacitor.Plugins;
        var plugin = p && p.DeePermissions;
        if (!plugin || !plugin.openMap) return false;
        try {
            var r = await plugin.openMap({ geo: geo, web: web });
            return !!(r && r.opened);
        } catch (e) { return false; }
    };

    global.DeeNative = DeeNative;
})(window);
