package br.com.deemensagens.app;

import android.Manifest;
import android.app.ActivityManager;
import android.app.PendingIntent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.List;
import java.util.Map;

import app.capgo.incomingcallkit.IncomingCallActionReceiver;
import app.capgo.incomingcallkit.IncomingCallActivity;
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

        // Quem ligou desistiu antes de alguém atender: fecha a tela de
        // chamada e a notificação neste aparelho. Sem isto, com o app
        // fechado a tela ficava aberta para sempre — não há nada rodando
        // aqui que perceba a mudança no Firestore.
        if (data != null && "call_cancel".equals(data.get("type"))) {
            encerrarChamadaCancelada(data.get("callId"));
            return;
        }

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

        // ══════════════════════════════════════════════════════════
        //  ABRIR A TELA CHEIA NA HORA (como uma ligação de telefone)
        // ══════════════════════════════════════════════════════════
        //  O Android 10+ proíbe abrir telas a partir do segundo plano, e é
        //  por isso que aqui passávamos "false": a tela só aparecia sozinha
        //  com o celular bloqueado (caso em que o fullScreenIntent da
        //  notificação é acionado pelo próprio sistema). Com a tela
        //  desbloqueada, virava só um aviso no topo.
        //
        //  A permissão "Exibir sobre outros aplicativos" (SYSTEM_ALERT_WINDOW)
        //  é uma das exceções oficiais dessa regra: com ela concedida, o app
        //  PODE abrir a tela mesmo em segundo plano. Então, quando ela existe,
        //  pedimos a abertura imediata e a chamada cobre a tela na hora,
        //  independentemente do que o usuário estiver fazendo.
        //
        //  Sem a permissão, mantemos o comportamento antigo — a notificação
        //  com fullScreenIntent ainda cobre a tela se o celular estiver
        //  bloqueado, e vira aviso no topo se estiver em uso. Ou seja: nunca
        //  fica pior do que já era, só melhora quando dá.
        boolean podeAbrirDireto = Settings.canDrawOverlays(this);

        IncomingCallController.showIncomingCall(getApplicationContext(), record, podeAbrirDireto);

        // Reescreve a notificação que o plugin acabou de criar, trocando só
        // o destino do botão "Atender" (ver comentário completo abaixo).
        reescreverNotificacaoDeChamada(record);
    }

    // ══════════════════════════════════════════════════════════
    //  CHAMADA CANCELADA POR QUEM LIGOU
    // ══════════════════════════════════════════════════════════
    //  Duas coisas precisam sumir: a notificação e, se estiver aberta, a
    //  tela cheia de chamada.
    //
    //  A notificação é simples: endCall() do plugin já remove o registro
    //  da chamada e cancela a notificação.
    //
    //  A tela cheia é o pulo do gato. Ela é uma Activity do plugin e não
    //  temos como fechá-la de fora... exceto por um detalhe do próprio
    //  código dela: ao abrir, se a chamada não existir mais no registro,
    //  ela se fecha sozinha na hora. Como o endCall() acima ACABOU de
    //  apagar esse registro, basta reabri-la (sem SINGLE_TOP, para forçar
    //  uma instância nova) que ela nasce, não encontra a chamada e se
    //  encerra — levando a instância antiga junto por causa do CLEAR_TOP.
    //
    //  Isso evita mexer no código do plugin, que seria desfeito na
    //  próxima reinstalação de dependências.
    // ══════════════════════════════════════════════════════════
    private void encerrarChamadaCancelada(String callId) {
        if (callId == null || callId.isEmpty()) return;

        try {
            IncomingCallController.endCall(getApplicationContext(), callId, "canceled");
        } catch (Exception ignored) {}

        try {
            Intent fechar = new Intent(this, IncomingCallActivity.class);
            fechar.putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId);
            // NEW_TASK + CLEAR_TOP e SEM single top: garante instância nova,
            // que ao não achar a chamada se fecha imediatamente.
            fechar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(fechar);
        } catch (Exception ignored) {
            // Se o sistema bloquear a abertura (restrição de segundo plano),
            // a notificação já foi removida acima — a tela cheia, quando
            // houver, fecha ao ser tocada, como antes.
        }
    }

    // ══════════════════════════════════════════════════════════
    //  CORREÇÃO DO BOTÃO "ATENDER"
    // ══════════════════════════════════════════════════════════
    //  O plugin monta o botão "Atender" apontando para um
    //  BroadcastReceiver. O receiver roda normalmente e cancela a
    //  notificação, mas quando tenta abrir a tela da chamada esbarra na
    //  regra do Android 10+ que proíbe abrir telas a partir do segundo
    //  plano. Por isso a notificação sumia e nada acontecia.
    //
    //  Tocar no CORPO da notificação sempre funcionou porque ali o destino
    //  é uma Activity, e o Android concede privilégio de abrir tela para
    //  notificações tocadas pelo usuário. Esse privilégio vale igualmente
    //  para os BOTÕES, desde que apontem para uma Activity.
    //
    //  Então, em vez de alterar o plugin (o que seria desfeito na próxima
    //  reinstalação de dependências), publicamos a MESMA notificação por
    //  cima — mesmo id, então ela substitui em vez de duplicar — mudando
    //  apenas o destino do "Atender" para a CallAnswerActivity.
    //
    //  O "Recusar" continua apontando para o receiver original de
    //  propósito: recusar só encerra a chamada e fecha a notificação, não
    //  precisa abrir tela nenhuma — ou seja, nunca foi afetado pela
    //  restrição do Android.
    // ══════════════════════════════════════════════════════════
    private void reescreverNotificacaoDeChamada(IncomingCallRecord record) {
        try {
            String callId = record.getCallId();

            // Corpo da notificação e tela cheia: a mesma Activity do plugin
            // que já funciona hoje quando o usuário toca na notificação.
            PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                (callId + ":dee-content").hashCode(),
                IncomingCallActivity.createIntent(this, callId),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // A correção em si: Activity em vez de BroadcastReceiver.
            Intent answerIntent = new Intent(this, CallAnswerActivity.class);
            answerIntent.putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId);
            answerIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent acceptIntent = PendingIntent.getActivity(
                this,
                (callId + ":dee-accept").hashCode(),
                answerIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Recusar: mantém o receiver do plugin, que já funciona.
            Intent declineBroadcast = new Intent(this, IncomingCallActionReceiver.class);
            declineBroadcast.setAction(IncomingCallActionReceiver.ACTION_DECLINE_CALL);
            declineBroadcast.putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId);
            PendingIntent declineIntent = PendingIntent.getBroadcast(
                this,
                (callId + ":dee-decline").hashCode(),
                declineBroadcast,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder b = new NotificationCompat.Builder(this, record.getChannelId())
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle(record.getCallerName())
                .setContentText(record.hasVideo() ? "Chamada de vídeo" : "Chamada de voz")
                .setSubText(record.getAppName())
                .setContentIntent(contentIntent)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(contentIntent, true)
                .addAction(android.R.drawable.sym_action_call, record.getAcceptText(), acceptIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, record.getDeclineText(), declineIntent);

            if (record.getTimeoutMs() > 0) b.setTimeoutAfter(record.getTimeoutMs());

            // A partir do Android 13, publicar notificação exige permissão
            // do usuário. Se ela não foi concedida, simplesmente não
            // reescrevemos — a notificação original do plugin continua no
            // lugar e nada quebra. (O app pede essa permissão na primeira
            // abertura, então o caso normal é ela estar concedida.)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }

            // Mesmo id da notificação do plugin: substitui, não duplica.
            NotificationManagerCompat.from(this).notify(record.getNotificationId(), b.build());
        } catch (Exception ignored) {
            // Se algo falhar aqui, a notificação original do plugin continua
            // no lugar — o usuário ainda consegue atender tocando no corpo.
        }
    }
}
