package br.com.deemensagens.app;

import android.os.Bundle;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import app.capgo.incomingcallkit.IncomingCallActionReceiver;
import app.capgo.incomingcallkit.IncomingCallController;

// ══════════════════════════════════════════════════════════
//  CallAnswerActivity — atende a chamada direto pelo botão
//  "Atender" da notificação
// ══════════════════════════════════════════════════════════
//  O PROBLEMA QUE ISTO RESOLVE
//
//  O botão "Atender" original do plugin apontava para um
//  BroadcastReceiver. O receiver rodava, cancelava a notificação e
//  então tentava abrir a tela da chamada — só que, desde o Android 10,
//  o sistema PROÍBE um app de abrir telas a partir do segundo plano.
//  Resultado: a notificação sumia (essa parte funcionava) e nada abria.
//
//  Tocar no CORPO da notificação sempre funcionou porque ali o Android
//  concede um privilégio especial: notificação tocada pelo usuário pode
//  abrir tela. Esse privilégio vale para qualquer PendingIntent do tipo
//  "abrir Activity" disparado pela notificação — inclusive pelos botões.
//
//  Então a correção é simplesmente trocar o destino do botão: em vez de
//  um receiver invisível, ele abre esta Activity. Como uma Activity roda
//  em primeiro plano, ela pode aceitar a chamada e abrir a tela do app
//  sem esbarrar em nenhuma restrição.
//
//  Esta tela não desenha nada e se fecha no mesmo instante — o usuário
//  não chega a vê-la, só percebe que a chamada foi atendida num toque só.
// ══════════════════════════════════════════════════════════
public class CallAnswerActivity extends AppCompatActivity {

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Permite atender com a tela bloqueada, sem exigir desbloqueio antes.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

        String callId = getIntent() != null
            ? getIntent().getStringExtra(IncomingCallActionReceiver.EXTRA_CALL_ID)
            : null;

        if (callId != null && !callId.isEmpty()) {
            try {
                // launchApp=true: agora estamos em primeiro plano, então a
                // abertura da tela do app é permitida pelo sistema — que é
                // exatamente o que falhava quando isso rodava no receiver.
                IncomingCallController.acceptCall(this, callId, true);
            } catch (Exception ignored) {
                // Se algo falhar, não deixamos uma tela vazia presa: o
                // finish() abaixo fecha de qualquer forma.
            }
        }

        finish();
        overridePendingTransition(0, 0); // sem animação: a tela é invisível
    }
}
