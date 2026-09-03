package br.com.deemensagens.app;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// ══════════════════════════════════════════════════════════
//  DeeProximityPlugin — apaga a tela com o rosto encostado
// ══════════════════════════════════════════════════════════
//  POR QUE ISTO EXISTE
//
//  Numa ligação de voz a pessoa encosta o celular no rosto. Sem nenhuma
//  proteção, a bochecha toca na tela e acaba apertando os botões da
//  chamada sozinha: muta o microfone, liga o viva-voz, ou desliga a
//  ligação no meio da conversa.
//
//  Todo aplicativo de telefone resolve isso do mesmo jeito: usa o sensor
//  de proximidade (aquele perto do alto-falante de cima). Enquanto tem
//  algo perto dele, o sistema apaga a tela e ignora qualquer toque; ao
//  afastar o celular do rosto, a tela volta sozinha, exatamente como
//  estava.
//
//  Isso não existe em JavaScript — nenhuma página web consegue apagar a
//  tela do celular nem desligar o toque. Quem faz esse trabalho é o
//  Android, através do PROXIMITY_SCREEN_OFF_WAKE_LOCK: é literalmente o
//  mesmo recurso do sistema que o app de telefone usa.
//
//  Como este plugin só existe dentro do app instalado, o site e o PWA
//  seguem funcionando exatamente como antes, sem nenhuma mudança.
//
//  Quem liga e desliga é o próprio Dee, pelo JavaScript da chamada
//  (ver "atualizarTravaDeProximidade" no index.html):
//    start() → durante uma chamada de VOZ, com o viva-voz desligado
//    stop()  → ao encerrar a chamada, ou assim que o viva-voz é ligado
//              (viva-voz ligado = celular longe do rosto = a pessoa quer
//              usar a tela normalmente)
// ══════════════════════════════════════════════════════════
@CapacitorPlugin(name = "DeeProximity")
public class DeeProximityPlugin extends Plugin {

    private PowerManager.WakeLock wakeLock;

    @PluginMethod
    public void start(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm == null) { call.resolve(resultado(false)); return; }

            // Nem todo aparelho tem sensor de proximidade. Quando não tem,
            // devolvemos "supported: false" e o Dee simplesmente segue sem
            // esse recurso — a chamada continua funcionando normalmente.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP
                    && !pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                call.resolve(resultado(false));
                return;
            }

            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "Dee:chamada-proximidade");
                // Sem contagem de referências: não importa quantas vezes
                // start() seja chamado, um único stop() sempre libera de vez.
                // É o que garante que a tela nunca fique presa apagada.
                wakeLock.setReferenceCounted(false);
            }

            if (!wakeLock.isHeld()) {
                // Prazo máximo de 2 horas como rede de segurança: se por
                // qualquer motivo o stop() não chegar (app encerrado à força,
                // por exemplo), o próprio Android solta a trava sozinho.
                wakeLock.acquire(2 * 60 * 60 * 1000L);
            }
            call.resolve(resultado(true));
        } catch (Exception e) {
            // Uma falha aqui nunca pode derrubar a ligação — no pior caso a
            // pessoa fica sem a proteção da tela, e só.
            call.resolve(resultado(false));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        liberar();
        call.resolve();
    }

    // Se a Activity for destruída no meio de uma chamada (app fechado à
    // força, sistema recuperando memória), soltamos a trava aqui também.
    // Sem isso, a tela poderia continuar apagando ao aproximar do rosto
    // mesmo depois do Dee ter saído do ar.
    @Override
    protected void handleOnDestroy() {
        liberar();
        super.handleOnDestroy();
    }

    private void liberar() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
    }

    private JSObject resultado(boolean suportado) {
        JSObject r = new JSObject();
        r.put("supported", suportado);
        return r;
    }
}
