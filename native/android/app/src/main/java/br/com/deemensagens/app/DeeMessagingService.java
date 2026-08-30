package br.com.deemensagens.app;

import android.app.ActivityManager;
import android.content.Context;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.List;
import java.util.Map;

import app.capgo.incomingcallkit.IncomingCallController;
import app.capgo.incomingcallkit.IncomingCallRecord;

// ══════════════════════════════════════════════════════════
//  DeeMessagingService
//
//  Substitui o serviço padrão do plugin @capacitor/push-notifications
//  (ver AndroidManifest.xml — removemos o service dele e registramos
//  este aqui no lugar) para poder interceptar as mensagens de "chamada"
//  ANTES de qualquer coisa, mesmo com o app 100% fechado (o Android
//  acorda este serviço sozinho quando chega um push, mesmo sem o
//  processo do app estar rodando).
//
//  Contrato esperado do servidor (Cloudflare Worker) para uma chamada:
//  enviar uma mensagem FCM SOMENTE COM "data" (sem bloco "notification",
//  senão o Android mostra uma notificação genérica em vez de deixar a
//  gente desenhar a tela de chamada) com os campos:
//    type          = "call"
//    callId        = mesmo ID do documento em calls/{callId}
//    callerName    = nome de quem está ligando
//    callerUid     = uid de quem está ligando
//    hasVideo      = "true" ou "false" (string, FCM data só aceita string)
//
//  Para mensagens normais (chat/status/amizade), o servidor pode mandar
//  o formato padrão com bloco "notification" — nesse caso o próprio
//  Android já mostra a notificação sozinho quando o app está fechado ou
//  em segundo plano, sem precisar de nenhum código aqui.
// ══════════════════════════════════════════════════════════
public class DeeMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();

        if (data != null && "call".equals(data.get("type"))) {
            // Se o app JÁ está aberto na tela (primeiro plano), o listener do
            // Firestore que roda dentro do próprio app (listenIncomingCalls,
            // no index.html) já vai mostrar a tela de chamada "por dentro" do
            // Dee — igual o WhatsApp faz. Não duplicamos com a tela nativa
            // por cima nesse caso. Se o app estiver fechado, minimizado ou a
            // tela bloqueada, aí sim precisa da tela nativa, porque nada do
            // JS está rodando/visível pra mostrar nada.
            if (!isAppInForeground()) {
                showIncomingCallFromPush(data);
            }
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            return;
        }

        // Mensagem normal (chat/status/amizade) chegando com o app rodando
        // (primeiro ou segundo plano) — repassa pro fluxo padrão do plugin,
        // que entrega pro JS via pushNotificationReceived.
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    private boolean isAppInForeground() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) return false;
        List<ActivityManager.RunningAppProcessInfo> processes = am.getRunningAppProcesses();
        if (processes == null) return false;
        String pkg = getPackageName();
        for (ActivityManager.RunningAppProcessInfo p : processes) {
            if (p.processName.equals(pkg)
                && p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                return true;
            }
        }
        return false;
    }

    private void showIncomingCallFromPush(Map<String, String> data) {
        String callId     = data.get("callId");
        String callerName = data.get("callerName");
        String callerUid  = data.get("callerUid");
        boolean hasVideo  = "true".equals(data.get("hasVideo"));

        if (callId == null || callId.isEmpty() || callerName == null || callerName.isEmpty()) {
            return; // payload incompleto, ignora silenciosamente
        }

        JSONObject extra = new JSONObject();
        try {
            extra.put("fromUid", callerUid);
            extra.put("hasVideo", hasVideo);
        } catch (Exception ignored) {}

        IncomingCallRecord record = new IncomingCallRecord(
            callId,
            callerName,
            null,               // handle (não usamos número de telefone)
            "Dee",              // appName
            hasVideo,
            45_000L,            // mesmo timeout usado no resto do app (45s)
            "Atender",
            "Recusar",
            "incoming_call_kit",
            "Chamadas recebidas",
            true,               // showFullScreen
            null,               // accentColor (usa o padrão do plugin)
            null,               // ringtoneUri (usa o toque padrão do sistema)
            true,               // highPriority
            extra,
            "ringing"
        );

        // launchImmediately=false: não força abrir a Activity na hora (não
        // temos uma Activity em primeiro plano aqui, é só o serviço de push
        // rodando). A notificação com fullScreenIntent já cuida de mostrar a
        // tela de chamada sozinha (com a tela bloqueada, o Android abre na
        // hora; com a tela ligada, aparece como notificação heads-up que
        // abre a tela de chamada ao tocar).
        IncomingCallController.showIncomingCall(getApplicationContext(), record, false);
    }
}
