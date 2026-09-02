// ══════════════════════════════════════════════════════════
//  DEE PUSH WORKER
//
//  Recebe um aviso do próprio app ("mandei uma mensagem/live/etc pra
//  fulano") e manda, na hora, um push real via FCM pro celular do
//  destinatário — inclusive com o app dele 100% fechado ou a tela
//  bloqueada, porque quem exibe a notificação nesse caso é o próprio
//  Android/sistema operacional, não o app.
//
//  Por que precisa disso e não dá só pro app mandar direto pro Google?
//  Mandar notificação em nome do projeto exige uma "senha mestra" (a
//  conta de serviço do Firebase) — se ela fosse colocada dentro do
//  APK, qualquer pessoa poderia extrair e mandar notificação falsa pra
//  qualquer usuário seu. Aqui ela fica só neste servidor, como segredo.
//
//  Rota:  POST /notify
//  Corpo: { fromUid, fromName, preview, toUid? , groupId? }
//         (toUid para conversa 1-a-1, groupId para grupo — manda um
//          dos dois, nunca os dois)
//  Header obrigatório: X-Dee-Secret: <APP_SHARED_SECRET>
// ══════════════════════════════════════════════════════════

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

// Cache do access token em memória do isolate — evita gerar um token
// novo (que exige assinar um JWT) a cada notificação. Sobrevive
// enquanto o mesmo isolate do Worker ficar "quente"; se expirar ou o
// Worker reiniciar, é gerado de novo sozinho, sem intervenção manual.
let cachedToken = null; // { accessToken, expiresAt }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight de CORS (o app manda um header custom + JSON, então o
    // navegador sempre pergunta antes com OPTIONS).
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname !== '/notify' || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }

    const secret = request.headers.get('X-Dee-Secret');
    if (!secret || secret !== env.APP_SHARED_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }

    const { fromUid, fromName, preview, toUid, groupId, type, callId, hasVideo } = body || {};
    if (!fromUid || (!toUid && !groupId)) {
      return json({ error: 'missing_fields' }, 400);
    }
    const isCall = type === 'call';
    // Aviso de que a chamada acabou antes de ser atendida — serve para
    // fechar a tela de chamada no aparelho de quem ia receber, mesmo com
    // o app dele totalmente fechado (ver notifyCallCanceledPush no
    // index.html e o tratamento em DeeMessagingService.java).
    const isCallCancel = type === 'call_cancel';
    if ((isCall || isCallCancel) && (!toUid || !callId)) {
      return json({ error: 'missing_call_fields' }, 400);
    }

    let serviceAccount;
    try { serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); }
    catch (e) { return json({ error: 'server_misconfigured' }, 500); }

    const accessToken = await getAccessToken(serviceAccount, [FCM_SCOPE, FIRESTORE_SCOPE]);
    const projectId = serviceAccount.project_id;

    // 1) Descobre pra quem mandar (um token, no caso de DM; vários, no
    //    caso de grupo — todo mundo menos quem mandou a mensagem).
    let targets = []; // [{ uid, fcmToken }]
    try {
      if (toUid) {
        const tok = await getUserFcmToken(projectId, accessToken, toUid);
        if (tok) targets.push({ uid: toUid, fcmToken: tok });
      } else if (groupId) {
        targets = await getGroupFcmTokens(projectId, accessToken, groupId, fromUid);
      }
    } catch (e) {
      return json({ error: 'lookup_failed', detail: String(e) }, 502);
    }

    if (targets.length === 0) {
      return json({ sent: 0, reason: 'no_token_found' }, 200);
    }

    // 2) Manda um FCM pra cada um.
    //    - Chamada (isCall): mensagem SÓ COM "data" (sem "notification"),
    //      senão o Android mostra um aviso genérico em vez de deixar o
    //      DeeMessagingService (nativo) desenhar a tela de chamada.
    //    - Mensagem normal: notification+data juntos — o próprio Android
    //      já mostra a notificação sozinho com o app fechado/em segundo
    //      plano, sem precisar de nada especial do lado nativo.
    //
    //  CONTADOR DO ÍCONE (badgeCount)
    //  Quando o app está fechado, quem desenha a notificação é o Android,
    //  não o nosso código — então o número que aparece em cima do ícone só
    //  pode vir pronto no push, no campo notification_count. Esse número
    //  precisa existir no servidor, porque o contador do app (unreadCounts)
    //  vive só na memória do aparelho de quem recebe, e o Worker não tem
    //  como enxergar isso.
    //  Como funciona: aqui somamos +1 em usuarios/{uid}.badgeCount a cada
    //  mensagem e mandamos o total novo no push. Quando a pessoa abre o app
    //  e lê, o próprio app grava o total real de volta nesse mesmo campo
    //  (ver syncBadgeCountToServer no index.html) — é isso que faz o número
    //  zerar em vez de só crescer para sempre.
    //  Chamada não entra nessa conta: chamada perdida não é "mensagem não
    //  lida", e o payload dela nem tem bloco notification.
    const results = await Promise.all(targets.map(async (t) => {
      let badge = 0;
      if (!isCall && !isCallCancel) {
        badge = await bumpBadgeCount(projectId, accessToken, t.uid);
      }

      const androidNotification = {
        channel_id: 'dee_messages', // precisa bater com MSG_CHANNEL_ID no MainActivity.java
        // Sem isto, a notificação montada pelo próprio Android (o que
        // acontece quando o app está FECHADO) saía sem som — só vibrava.
        // Com o app aberto quem desenha é o nosso código, que já tocava o
        // som; por isso o problema só aparecia com o app fechado.
        // 'default' usa o som padrão do canal dee_messages.
        sound: 'default'
      };
      if (badge > 0) androidNotification.notification_count = badge;

      const message = isCallCancel
        ? {
            token: t.fcmToken,
            data: {
              type: 'call_cancel',
              callId: String(callId),
            },
            android: { priority: 'high' },
          }
        : isCall
        ? {
            token: t.fcmToken,
            data: {
              type: 'call',
              callId: String(callId),
              callerName: fromName || 'Alguém',
              callerUid: String(fromUid),
              hasVideo: hasVideo ? 'true' : 'false',
            },
            android: { priority: 'high' },
          }
        : {
            token: t.fcmToken,
            notification: {
              title: fromName || 'Nova mensagem',
              body: (preview || '').slice(0, 160) || 'Enviou uma mensagem',
            },
            data: {
              type: 'message',
              fromUid: String(fromUid),
              groupId: groupId ? String(groupId) : '',
            },
            android: {
              priority: 'high',
              notification: androidNotification,
            },
          };
      return sendFcm(projectId, accessToken, message).then(() => true).catch(() => false);
    }));

    return json({ sent: results.filter(Boolean).length, total: targets.length });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Dee-Secret',
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

// ── OAuth2: troca a "conta de serviço" por um token de acesso de curta
//    duração, assinando um JWT com a chave privada via Web Crypto
//    (não dá pra usar o firebase-admin normal aqui — ele depende de
//    APIs do Node que não existem no Worker). ──
async function getAccessToken(serviceAccount, scopes) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) {
    return cachedToken.accessToken;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + base64url(signature);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error('Falha ao obter access token: ' + JSON.stringify(data));
  }

  cachedToken = { accessToken: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return cachedToken.accessToken;
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = base64ToArrayBuffer(pemBody);
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(input) {
  let str;
  if (typeof input === 'string') {
    str = btoa(unescape(encodeURIComponent(input)));
  } else {
    const bytes = new Uint8Array(input);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    str = btoa(bin);
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Firestore REST: busca o fcmToken salvo em usuarios/{uid} ──
async function getUserFcmToken(projectId, accessToken, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/usuarios/${uid}`;
  const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!resp.ok) return null;
  const doc = await resp.json();
  return doc?.fields?.fcmToken?.stringValue || null;
}

// ── Firestore REST: busca os membros do grupo e o fcmToken de cada um
//    (menos de quem mandou a mensagem), usando :batchGet pra fazer isso
//    numa única ida ao Firestore em vez de N chamadas separadas. ──
async function getGroupFcmTokens(projectId, accessToken, groupId, fromUid) {
  const groupUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/grupos/${groupId}`;
  const groupResp = await fetch(groupUrl, { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!groupResp.ok) return [];
  const groupDoc = await groupResp.json();
  const membersField = groupDoc?.fields?.members?.arrayValue?.values || [];
  const memberUids = membersField.map((v) => v.stringValue).filter((u) => u && u !== fromUid);
  if (memberUids.length === 0) return [];

  const base = `projects/${projectId}/databases/(default)/documents`;
  const batchUrl = `https://firestore.googleapis.com/v1/${base}:batchGet`;
  const resp = await fetch(batchUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: memberUids.map((uid) => `${base}/usuarios/${uid}`) }),
  });
  if (!resp.ok) return [];
  const results = await resp.json();
  const out = [];
  for (const r of results) {
    const doc = r.found;
    const token = doc?.fields?.fcmToken?.stringValue;
    if (token) {
      const uid = doc.name.split('/').pop();
      out.push({ uid, fcmToken: token });
    }
  }
  return out;
}

// ── Firestore REST: soma +1 em usuarios/{uid}.badgeCount e devolve o
//    total novo, pra mandar no push como notification_count.
//
//    Usamos um "fieldTransform" de increment em vez de ler-somar-gravar
//    porque o incremento é feito pelo próprio servidor do Firestore, de
//    forma atômica: se duas mensagens chegarem no mesmo instante, nenhuma
//    sobrescreve a outra e o total fica certo.
//
//    Se qualquer coisa falhar, devolvemos 0 — nesse caso o push sai sem o
//    campo notification_count e a notificação aparece normalmente, só sem
//    o número. Ou seja: nunca deixamos o contador atrapalhar a entrega da
//    mensagem em si. ──
async function bumpBadgeCount(projectId, accessToken, uid) {
  try {
    const base = `projects/${projectId}/databases/(default)/documents`;
    const resp = await fetch(`https://firestore.googleapis.com/v1/${base}:commit`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            transform: {
              document: `${base}/usuarios/${uid}`,
              fieldTransforms: [
                { fieldPath: 'badgeCount', increment: { integerValue: '1' } },
              ],
            },
          },
        ],
      }),
    });
    if (!resp.ok) return 0;
    const out = await resp.json();
    const novo = out?.writeResults?.[0]?.transformResults?.[0]?.integerValue;
    const n = novo ? parseInt(novo, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

// ── Envia de fato a notificação pelo FCM HTTP v1 ──
async function sendFcm(projectId, accessToken, message) {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error('FCM send falhou: ' + errText);
  }
  return resp.json();
}
