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

    global.DeeNative = DeeNative;
})(window);
