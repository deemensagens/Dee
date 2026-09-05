package br.com.deemensagens.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

// Do plugin de chamadas: depois de avisar o servidor, repassamos a ação
// para o receptor original dele, que limpa o estado interno como sempre.
import app.capgo.incomingcallkit.IncomingCallActionReceiver;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

// ══════════════════════════════════════════════════════════
//  DeeDeclineReceiver — "Recusar" que realmente desliga dos dois lados
// ══════════════════════════════════════════════════════════
//  O PROBLEMA QUE ISTO RESOLVE
//
//  Quando o telefone toca com o Dee fechado, quem desenha a notificação
//  é o Android — nosso código não está rodando. O botão "Recusar"
//  apontava para o receptor do plugin, que fecha a notificação NESTE
//  aparelho e avisa o JavaScript do app. Só que, com o app fechado, não
//  existe JavaScript nenhum escutando.
//
//  Resultado: a notificação sumia aqui, mas ninguém avisava o outro
//  lado. Quem ligou continuava chamando, achando que ninguém atendeu,
//  até estourar o tempo de 45 segundos.
//
//  COMO FUNCIONA AGORA
//
//  Este receptor avisa o servidor diretamente, sem precisar abrir o app.
//  O servidor marca a chamada como recusada, e o telefone de quem ligou
//  para na hora — que é o comportamento esperado de qualquer aplicativo
//  de chamadas.
//
//  A prova de que o pedido é legítimo é um "bilhete" que veio junto com
//  o aviso da chamada. Só este aparelho o recebeu, e ele só vale para
//  esta chamada específica. O segredo que gera o bilhete fica no
//  servidor — nada sensível guardado dentro do aplicativo.
//
//  Depois de avisar o servidor, repassamos a ação para o receptor
//  original do plugin, para ele limpar o estado dele normalmente.
// ══════════════════════════════════════════════════════════
public class DeeDeclineReceiver extends BroadcastReceiver {

    private static final String TAG = "DeeDecline";

    public static final String EXTRA_CALL_ID = "dee_call_id";
    public static final String EXTRA_TO_UID = "dee_to_uid";
    public static final String EXTRA_TOKEN = "dee_decline_token";
    public static final String EXTRA_NOTIF_ID = "dee_notif_id";

    private static final String WORKER_URL =
        "https://dee-push.deemensagens.workers.dev/call-decline";

    @Override
    public void onReceive(Context context, Intent intent) {
        final String callId = intent.getStringExtra(EXTRA_CALL_ID);
        final String toUid = intent.getStringExtra(EXTRA_TO_UID);
        final String token = intent.getStringExtra(EXTRA_TOKEN);
        final int notifId = intent.getIntExtra(EXTRA_NOTIF_ID, -1);
        final Context app = context.getApplicationContext();

        // A notificação some imediatamente: para quem tocou em "Recusar",
        // a chamada acabou naquele instante. O aviso ao servidor acontece
        // logo em seguida, em segundo plano.
        try {
            NotificationManager nm = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                if (notifId != -1) nm.cancel(notifId);
                else nm.cancelAll();
            }
        } catch (Exception ignored) { }

        // goAsync dá ao receptor um tempo extra para terminar o trabalho
        // de rede. Sem isso o Android encerraria o processo antes de a
        // requisição sair, e o outro lado continuaria chamando.
        final PendingResult resultado = goAsync();

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (callId != null && toUid != null && token != null) {
                        avisarServidor(callId, toUid, token);
                    } else {
                        Log.w(TAG, "Recusa sem dados suficientes para avisar o servidor");
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Falha ao avisar a recusa: " + e.getMessage());
                } finally {
                    // Repassa para o receptor do plugin, para ele encerrar
                    // o estado interno dele como sempre fez.
                    try {
                        Intent original = new Intent(app, IncomingCallActionReceiver.class);
                        original.setAction(IncomingCallActionReceiver.ACTION_DECLINE_CALL);
                        original.putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId);
                        app.sendBroadcast(original);
                    } catch (Exception ignored) { }
                    resultado.finish();
                }
            }
        }).start();
    }

    private void avisarServidor(String callId, String toUid, String token) throws Exception {
        JSONObject corpo = new JSONObject();
        corpo.put("callId", callId);
        corpo.put("toUid", toUid);
        corpo.put("token", token);

        HttpURLConnection conexao = (HttpURLConnection) new URL(WORKER_URL).openConnection();
        try {
            conexao.setRequestMethod("POST");
            conexao.setRequestProperty("Content-Type", "application/json");
            conexao.setDoOutput(true);
            // Prazos curtos: é melhor falhar rápido do que segurar o
            // receptor até o Android encerrá-lo à força.
            conexao.setConnectTimeout(6000);
            conexao.setReadTimeout(6000);

            OutputStream saida = conexao.getOutputStream();
            saida.write(corpo.toString().getBytes("UTF-8"));
            saida.flush();
            saida.close();

            int codigo = conexao.getResponseCode();
            Log.d(TAG, "Recusa enviada, resposta do servidor: " + codigo);
        } finally {
            conexao.disconnect();
        }
    }
}
