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

    global.DeeNative = DeeNative;
})(window);
