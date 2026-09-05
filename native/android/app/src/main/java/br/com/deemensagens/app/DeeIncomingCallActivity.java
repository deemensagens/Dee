package br.com.deemensagens.app;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

// Vem do plugin de chamadas: é a chave sob a qual o identificador da
// ligação é passado adiante. Reaproveitamos a mesma para o resto do
// fluxo continuar reconhecendo a chamada.
import app.capgo.incomingcallkit.IncomingCallActionReceiver;

// ══════════════════════════════════════════════════════════
//  DeeIncomingCallActivity — a tela cheia de chamada, agora nossa
// ══════════════════════════════════════════════════════════
//  POR QUE ESTA TELA EXISTE
//
//  A tela cheia de chamada vinha pronta de um plugin de terceiros, e
//  nela só era possível TOCAR nos botões. O pedido era ter também o
//  gesto de arrastar, como no telefone do próprio aparelho — e isso não
//  dava para acrescentar na tela do plugin sem alterá-lo por dentro (o
//  que se perderia na próxima reinstalação de dependências).
//
//  Então a tela passou a ser nossa. Ela aceita as duas formas:
//    · tocar no botão verde atende, no vermelho recusa;
//    · arrastar para CIMA atende, arrastar para BAIXO recusa.
//
//  Ela também acende a tela e aparece por cima do bloqueio, que é o
//  comportamento esperado de uma chamada chegando.
//
//  ATENDER e RECUSAR reaproveitam o caminho que já existia e funciona:
//  atender abre a CallAnswerActivity (que leva a pessoa direto para a
//  chamada dentro do app), e recusar dispara o DeeDeclineReceiver (que
//  avisa o outro lado sem precisar abrir o app).
// ══════════════════════════════════════════════════════════
public class DeeIncomingCallActivity extends AppCompatActivity {

    public static final String EXTRA_CALL_ID = "dee_call_id";
    public static final String EXTRA_CALLER  = "dee_caller_name";
    public static final String EXTRA_VIDEO   = "dee_has_video";
    public static final String EXTRA_TO_UID  = "dee_to_uid";
    public static final String EXTRA_TOKEN   = "dee_decline_token";
    public static final String EXTRA_NOTIF_ID = "dee_notif_id";

    // Distância mínima do arraste para valer como gesto. Abaixo disso é
    // considerado um toque, não um arraste — senão um dedo trêmulo
    // atenderia sem querer.
    private static final float DISTANCIA_MINIMA_DP = 60f;

    private String callId, callerName, toUid, declineToken;
    private boolean hasVideo;
    private int notifId = -1;
    private boolean jaDecidiu = false;   // impede atender e recusar na mesma vez

    public static Intent createIntent(Context ctx, String callId, String caller, boolean video,
                                      String toUid, String token, int notifId) {
        Intent i = new Intent(ctx, DeeIncomingCallActivity.class);
        i.putExtra(EXTRA_CALL_ID, callId);
        i.putExtra(EXTRA_CALLER, caller);
        i.putExtra(EXTRA_VIDEO, video);
        i.putExtra(EXTRA_TO_UID, toUid);
        i.putExtra(EXTRA_TOKEN, token);
        i.putExtra(EXTRA_NOTIF_ID, notifId);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return i;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Acende a tela e aparece por cima do bloqueio: chamada chegando
        // precisa ser vista, mesmo com o celular no bolso.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_dee_incoming_call);

        Intent in = getIntent();
        callId       = in.getStringExtra(EXTRA_CALL_ID);
        callerName   = in.getStringExtra(EXTRA_CALLER);
        toUid        = in.getStringExtra(EXTRA_TO_UID);
        declineToken = in.getStringExtra(EXTRA_TOKEN);
        hasVideo     = in.getBooleanExtra(EXTRA_VIDEO, false);
        notifId      = in.getIntExtra(EXTRA_NOTIF_ID, -1);

        TextView nome = findViewById(R.id.dee_call_name);
        TextView sub  = findViewById(R.id.dee_call_subtitle);
        if (nome != null) nome.setText(callerName == null || callerName.isEmpty() ? "Chamada" : callerName);
        if (sub != null)  sub.setText(hasVideo ? "Chamada de vídeo" : "Chamada de voz");

        View aceitar = findViewById(R.id.dee_btn_accept);
        View recusar = findViewById(R.id.dee_btn_decline);

        // Cada botão responde ao toque simples e também ao arraste.
        aceitar.setOnTouchListener(criarOuvinteDeGesto(true));
        recusar.setOnTouchListener(criarOuvinteDeGesto(false));
    }

    // ══════════════════════════════════════════════════════════
    //  O GESTO
    // ══════════════════════════════════════════════════════════
    //  Um mesmo ouvinte cobre as duas formas de usar:
    //    · soltou o dedo quase no mesmo lugar  → foi um toque
    //    · arrastou para CIMA além do mínimo   → atende
    //    · arrastou para BAIXO além do mínimo  → recusa
    //
    //  O botão acompanha o dedo enquanto arrasta, para a pessoa sentir
    //  que o gesto está funcionando em vez de ficar em dúvida.
    private View.OnTouchListener criarOuvinteDeGesto(final boolean ehBotaoDeAceitar) {
        final float minimo = DISTANCIA_MINIMA_DP * getResources().getDisplayMetrics().density;

        return new View.OnTouchListener() {
            float inicioY = 0f;

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        inicioY = e.getRawY();
                        v.animate().scaleX(1.08f).scaleY(1.08f).setDuration(90).start();
                        return true;

                    case MotionEvent.ACTION_MOVE:
                        // O botão segue o dedo, com metade do deslocamento,
                        // para o movimento parecer preso ao dedo sem sair
                        // voando pela tela.
                        v.setTranslationY((e.getRawY() - inicioY) * 0.5f);
                        return true;

                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        float deslocamento = e.getRawY() - inicioY;
                        v.animate().translationY(0f).scaleX(1f).scaleY(1f).setDuration(140).start();

                        if (Math.abs(deslocamento) < minimo) {
                            // Foi um toque simples: vale o botão em que tocou.
                            if (ehBotaoDeAceitar) atender(); else recusar();
                        } else if (deslocamento < 0) {
                            atender();   // arrastou para cima
                        } else {
                            recusar();   // arrastou para baixo
                        }
                        return true;
                }
                return false;
            }
        };
    }

    private void atender() {
        if (jaDecidiu) return;
        jaDecidiu = true;
        fecharNotificacao();
        try {
            Intent i = new Intent(this, CallAnswerActivity.class);
            i.putExtra(IncomingCallActionReceiver.EXTRA_CALL_ID, callId);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(i);
        } catch (Exception ignored) { }
        finish();
    }

    private void recusar() {
        if (jaDecidiu) return;
        jaDecidiu = true;
        fecharNotificacao();
        try {
            // Mesmo caminho do botão "Recusar" da notificação: avisa o
            // outro lado sem precisar abrir o app.
            Intent i = new Intent(this, DeeDeclineReceiver.class);
            i.putExtra(DeeDeclineReceiver.EXTRA_CALL_ID, callId);
            i.putExtra(DeeDeclineReceiver.EXTRA_TO_UID, toUid);
            i.putExtra(DeeDeclineReceiver.EXTRA_TOKEN, declineToken);
            i.putExtra(DeeDeclineReceiver.EXTRA_NOTIF_ID, notifId);
            sendBroadcast(i);
        } catch (Exception ignored) { }
        finish();
    }

    private void fecharNotificacao() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && notifId != -1) nm.cancel(notifId);
        } catch (Exception ignored) { }
    }

    // O botão voltar do sistema não pode "sumir" com a chamada sem
    // decidir nada — senão o outro lado ficaria chamando à toa.
    // Aqui ele vale como recusar, que é o que a pessoa quis dizer.
    @Override
    public void onBackPressed() {
        recusar();
    }
}
