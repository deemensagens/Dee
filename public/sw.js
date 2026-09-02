const CACHE = 'dee-v3.8.1';


const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@700;900&family=DM+Sans:wght@300;400;500&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js'
];

// Identifica pedidos de navegação/HTML (abrir o app, recarregar a página,
// buscar index.html). Para ESSES pedidos usamos "network-first": tenta a
// rede primeiro e só cai no cache se estiver offline. É isso que faltava —
// antes, uma vez que o index.html entrava no cache, ele nunca mais era
// atualizado sozinho, mesmo com uma versão nova publicada no servidor.
function isHtmlRequest(request) {
    if (request.mode === 'navigate') return true;
    var accept = request.headers.get('accept') || '';
    return accept.indexOf('text/html') !== -1;
}

// ── CORREÇÃO: scripts e estilos do próprio app (index.html, social.js e
// qualquer .js/.css servido pelo nosso domínio) também precisam ser
// "network-first", igual ao HTML. Antes eles caíam na regra "cache-first"
// lá de baixo — ótima para bibliotecas externas (fontes, CDN), mas ruim
// para o NOSSO código: quando uma função nova era publicada (ex.: áudio
// nas postagens em social.js), o site (sem o cache antigo do SW) mostrava
// a novidade na hora, mas o app instalado (que já tinha o SW ativo com o
// JS antigo em cache) continuava servindo a versão velha de social.js pra
// sempre — mesmo o index.html atualizando sozinho — porque essa regra
// nunca buscava a rede de novo pra esses arquivos. Isso fazia parecer que
// "a atualização só funcionou no site, não no app".
function isAppScriptOrStyle(request) {
    if (request.destination === 'script' || request.destination === 'style') {
        return new URL(request.url).origin === self.location.origin;
    }
    var url = request.url;
    return url.startsWith(self.location.origin) && (url.endsWith('.js') || url.endsWith('.css'));
}

// ── CORREÇÃO: o manifest.json também precisa ser "network-first". Sem
// isso, uma vez que ele entrasse no cache do SW (regra "cache-first" lá
// embaixo, pensada pra fontes/ícones/CDN que raramente mudam), qualquer
// mudança nele (ex.: adicionar o share_target) nunca chegava em quem já
// tinha o app instalado — o Chrome continuava vendo a versão antiga e,
// por isso, nunca registrava recursos novos do manifest (como aparecer
// na folha de compartilhamento do Android) mesmo depois de reabrir o
// app ou até reinstalar sem limpar o cache manualmente.
function isManifest(request) {
    var url = request.url;
    return url.startsWith(self.location.origin) && url.indexOf('manifest.json') !== -1;
}

// ══════════════════════════════════════════════════════════
//  COMPARTILHAMENTO RECEBIDO DE OUTROS APPS (Web Share Target API)
//  Quando alguém compartilha algo (ex.: comprovante de um banco, foto da
//  galeria, um PDF) e escolhe o Dee na folha de compartilhamento do
//  Android, o sistema manda um POST pra essa URL com o conteúdo dentro do
//  corpo multipart/form-data (ver "share_target" no manifest.json). Um
//  POST não pode simplesmente "abrir" uma página — por isso: guardamos o
//  que foi recebido aqui no IndexedDB e respondemos com um redirect (303)
//  pro index.html com "?share=1" na URL. O próprio index.html, ao notar
//  esse parâmetro, lê o que foi salvo e abre a tela "Enviar para quem?"
//  (ver tryResolvePendingSWShareAction no index.html).
// ══════════════════════════════════════════════════════════
const SHARE_TARGET_DB_NAME = 'dee-share-target-db';
const SHARE_TARGET_STORE   = 'share';
function openShareTargetDB() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open(SHARE_TARGET_DB_NAME, 1);
        req.onupgradeneeded = function() {
            var dbi = req.result;
            if (!dbi.objectStoreNames.contains(SHARE_TARGET_STORE)) dbi.createObjectStore(SHARE_TARGET_STORE);
        };
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
    });
}
async function saveSharedPayload(request) {
    try {
        var formData = await request.formData();
        var files = formData.getAll('shared_files').filter(function(f) { return f && f.size > 0; });
        var title = formData.get('title') || '';
        var text  = formData.get('text') || '';
        var dbi   = await openShareTargetDB();
        await new Promise(function(resolve, reject) {
            var tx = dbi.transaction(SHARE_TARGET_STORE, 'readwrite');
            tx.objectStore(SHARE_TARGET_STORE).put({ files: files, title: title, text: text, ts: Date.now() }, 'pending');
            tx.oncomplete = resolve;
            tx.onerror = reject;
        });
    } catch (e) {
        console.warn('Falha ao salvar compartilhamento recebido:', e);
    }
}

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS).catch(function() {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  // ── COMPARTILHAMENTO RECEBIDO DE OUTROS APPS (Web Share Target API) ──
  // Ver bloco de comentário acima (saveSharedPayload). Precisa ser
  // verificado ANTES de qualquer outra regra porque é a única requisição
  // POST que este Service Worker trata — as demais regras abaixo (cache,
  // network-first, etc.) foram pensadas só para GET.
  if (e.request.method === 'POST' && new URL(e.request.url).pathname.endsWith('/share-target')) {
    e.respondWith(Response.redirect('./index.html?share=1', 303));
    e.waitUntil(saveSharedPayload(e.request.clone()));
    return;
  }

  // Não intercepta Firebase / APIs externas
  var url = e.request.url;
  if (url.includes('firestore') || url.includes('firebase') || url.includes('googleapis.com/firestore')) {
    return;
  }

  // ── HTML / navegação E scripts/estilos do próprio app (index.html,
  //    social.js, etc.): sempre tenta a rede primeiro. Garante que uma
  //    atualização publicada no servidor chegue no MESMO deploy tanto
  //    pra quem abre o site quanto pra quem já tem o app instalado. ──
  if (isHtmlRequest(e.request) || isAppScriptOrStyle(e.request) || isManifest(e.request)) {
    e.respondWith(
      // CORREÇÃO: "cache: 'reload'" faz o navegador ignorar qualquer
      // entrada já existente no CACHE HTTP dele (o que respeita
      // Cache-Control/max-age) e sempre buscar uma cópia fresca na rede,
      // regravando essa cópia nova no cache HTTP em seguida. Sem isso, o
      // fetch() abaixo continuava "network-first" só na lógica do SW —
      // mas o próprio fetch() por baixo dos panos podia devolver uma
      // resposta do cache HTTP do Chrome (por causa do max-age=3600 do
      // manifest.json, por ex.) sem nem chegar a bater na rede de verdade.
      // Era isso que fazia o manifest.json (com o share_target novo)
      // continuar "preso" numa versão antiga por até 1h, mesmo depois de
      // publicar e reinstalar o app.
      fetch(e.request, { cache: 'reload' }).then(function(response) {
        if (response && response.status === 200 && response.type !== 'opaque') {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        // Só usa o cache se a rede falhar (ex.: sem internet no momento)
        return caches.match(e.request).then(function(cached) {
          return cached || new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // ── Demais arquivos (fontes, bibliotecas externas via CDN, imagens,
  //    ícones, etc.): cache-first continua valendo — eles raramente mudam
  //    e não precisam de rede a cada acesso. ──
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        var clone = response.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
        return response;
      }).catch(function() {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});

/* ══════════════════════════════════════════════════════════
   A PARTIR DAQUI: NOTIFICAÇÕES DE CHAMADA EM SEGUNDO PLANO
   (push, ícone na barra de status, banner heads-up com
   "Atender"/"Recusar" e leitura das preferências do usuário
   salvas em IndexedDB). Nada abaixo desta linha foi alterado.
   ══════════════════════════════════════════════════════════ */

const SETTINGS_DB_NAME  = 'dee-settings-db';
const SETTINGS_STORE    = 'settings';
const DEFAULT_SETTINGS  = { callNotifEnabled: false, ringtone: 'toque_padrao', vibrateOnly: false };

// ── Lê as preferências de notificação salvas pela página no IndexedDB
//    (som escolhido, apenas vibrar, permissão ativa). O Service Worker
//    não tem acesso ao localStorage da página, então essa é a ponte. ──
function readNotifSettings() {
    return new Promise(function(resolve) {
        try {
            var req = indexedDB.open(SETTINGS_DB_NAME, 1);
            req.onupgradeneeded = function() {
                var dbi = req.result;
                if (!dbi.objectStoreNames.contains(SETTINGS_STORE)) dbi.createObjectStore(SETTINGS_STORE);
            };
            req.onsuccess = function() {
                try {
                    var dbi = req.result;
                    var tx = dbi.transaction(SETTINGS_STORE, 'readonly');
                    var getReq = tx.objectStore(SETTINGS_STORE).get('callNotifSettings');
                    getReq.onsuccess = function() { resolve(Object.assign({}, DEFAULT_SETTINGS, getReq.result || {})); };
                    getReq.onerror   = function() { resolve(DEFAULT_SETTINGS); };
                } catch(e) { resolve(DEFAULT_SETTINGS); }
            };
            req.onerror = function() { resolve(DEFAULT_SETTINGS); };
        } catch(e) { resolve(DEFAULT_SETTINGS); }
    });
}

/* ══════════════════════════════════════════════════════════
   PUSH — disparado quando um servidor (ex.: Cloud Function ligada
   à criação de um documento em "calls") envia uma notificação Web
   Push para este dispositivo. O payload esperado (JSON) é:
   { type: "incoming-call", callId, fromUid, fromName, callType }

   Observação importante sobre limitações reais do navegador:
   - Não é possível tocar um arquivo de áudio arbitrário (ex.:
     toque_padrao.mp3) a partir de uma notificação push em segundo
     plano — o navegador/SO usa o som padrão do sistema/canal de
     notificação. A preferência de "toque" escolhida pelo usuário
     é aplicada quando o app está em primeiro/segundo plano com a
     aba viva (ver playIncomingCallAlert no app), e o campo
     "silent"/"vibrate" abaixo é o que fica sob nosso controle
     numa notificação puramente nativa.
   - A propriedade "scenario" (usada nativamente no Windows Toast)
     não existe na Web Notifications API padrão; o equivalente
     funcional na web é: requireInteraction + renotify + tag fixa
     + ações "Atender"/"Recusar", combinado com o cabeçalho HTTP
     "Urgency: high" enviado pelo servidor no Web Push (isso é
     configurado no servidor, não aqui no service worker).
   ══════════════════════════════════════════════════════════ */
self.addEventListener('push', function(event) {
    var payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch(e) {}

    if (payload.type !== 'incoming-call') {
        // Push genérico (mensagem de chat, etc.) — mostra algo simples e sai.
        var title = payload.title || 'Dee';
        event.waitUntil(self.registration.showNotification(title, {
            body: payload.body || '',
            icon: 'icon-512.png',
            badge: 'icon-192.png'
        }));
        return;
    }

    event.waitUntil((async function() {
        var settings = await readNotifSettings();
        if (!settings.callNotifEnabled) return;

        var vibratePattern = settings.vibrateOnly
            ? [600, 300, 600, 300, 600]   // padrão "apenas vibrar"
            : [400, 200, 400];            // padrão normal (acompanha o som do sistema)

        await self.registration.showNotification('📞 Chamada recebida — ' + (payload.fromName || 'Usuário'), {
            body: payload.callType === 'video' ? 'Chamada de vídeo' : 'Chamada de voz',
            // "icon" é o desenho grande da notificação; "badge" é o ícone
            // monocromático pequeno que aparece na barra de status do
            // Android junto com Wi-Fi/bateria.
            icon: 'icon-512.png',
            badge: 'icon-192.png',
            tag: 'dee-call-' + payload.callId,
            renotify: true,
            requireInteraction: true,   // mantém o banner visível até o usuário agir
            silent: settings.vibrateOnly,
            vibrate: vibratePattern,
            data: { callId: payload.callId, fromUid: payload.fromUid, callType: payload.callType }
            // ── CORREÇÃO: os botões "Atender"/"Recusar" DIRETO na notificação
            // foram removidos de propósito. Em alguns celulares/versões do
            // Android, o navegador reporta pro Service Worker o botão ERRADO
            // que a pessoa tocou (ex.: tocou em "Atender" e chega aqui como
            // se fosse "Recusar") — um bug de plataforma, fora do nosso
            // controle, que fazia chamadas serem recusadas sem querer. Como
            // não dá pra confiar nessa informação, a notificação agora só
            // abre/foca o app na tela de chamada (ver notificationclick),
            // e a pessoa atende ou recusa pelos botões de dentro do app,
            // que são 100% confiáveis.
        });
    })());
});

/* ── NOTIFICATIONCLICK — usuário tocou no banner ou em um dos botões.
   Foca uma aba já aberta do app (ou abre uma nova, se o app estava
   totalmente fechado) e repassa a ação para o JS da página via
   postMessage. Trata os tipos de notificação, diferenciados por
   data.type:
     - "incoming-call" (ou notificações antigas sem "type", que eram
       sempre de chamada): chama acceptIncomingCall()/rejectIncomingCall()
       via DEE_CALL_ACTION.
     - "message": abre a conversa certa via DEE_MSG_ACTION.
     - "social": curtida/comentário/compartilhamento numa postagem —
       abre a postagem certa via DEE_SOCIAL_ACTION (tratado no social.js).
     - "status": um amigo publicou um novo status — abre o visualizador
       de status dessa pessoa via DEE_STATUS_ACTION.
     - "statuslike": alguém curtiu um dos SEUS status — abre o
       visualizador no seu próprio status via DEE_STATUS_ACTION.
     - "friend_request": alguém te enviou um pedido de amizade — abre
       a aba Amigos via DEE_FRIEND_ACTION.
   Antes deste ajuste, este listener só entendia chamada — um clique
   numa notificação de mensagem, interação social ou status não fazia
   nada acontecer. ── */
self.addEventListener('notificationclick', function(event) {
    var data   = event.notification.data || {};
    // ── CORREÇÃO: a notificação de chamada não tem mais botões de "Atender"/
    // "Recusar" (ver showNotification, no listener de push). Motivo: em
    // alguns celulares o navegador reporta pro Service Worker o botão
    // ERRADO que a pessoa tocou (bug de plataforma, fora do nosso
    // controle), fazendo a chamada ser recusada mesmo quando a pessoa
    // tocava em "Atender". Sem os botões, qualquer toque na notificação —
    // banner inteiro — só abre/foca o app na tela de chamada, e a pessoa
    // atende ou recusa pelos botões de dentro do app, que são confiáveis.
    // "action" fica sempre vazio agora, mas o código abaixo continua
    // preparado (isCallAction) caso outro tipo de notificação volte a usar
    // botões no futuro.
    var isCallAction = event.action === 'accept' || event.action === 'decline';
    var action       = isCallAction ? event.action : null;
    var isMsg        = data.type === 'message';
    var isSocial      = data.type === 'social';
    var isStatus      = data.type === 'status';
    var isStatusLike  = data.type === 'statuslike';
    var isFriendReq   = data.type === 'friend_request';
    var isCall        = !isMsg && !isSocial && !isStatus && !isStatusLike && !isFriendReq;
    event.notification.close();

    event.waitUntil((async function() {
        var allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        var client = allClients.find(function(c) { return 'focus' in c; });

        if (client) {
            if (isMsg) {
                client.postMessage({ type: 'DEE_MSG_ACTION', isGroup: !!data.isGroup, id: data.id, name: data.name });
            } else if (isSocial) {
                client.postMessage({ type: 'DEE_SOCIAL_ACTION', postId: data.postId });
            } else if (isStatus) {
                client.postMessage({ type: 'DEE_STATUS_ACTION', kind: 'new', uid: data.uid });
            } else if (isStatusLike) {
                client.postMessage({ type: 'DEE_STATUS_ACTION', kind: 'like', statusId: data.statusId });
            } else if (isFriendReq) {
                client.postMessage({ type: 'DEE_FRIEND_ACTION', fromUid: data.fromUid, fromName: data.fromName });
            } else if (isCall && action) {
                // Só manda ação de chamada quando foi mesmo um botão
                // ("Atender"/"Recusar"). Toque no corpo: só foca o app
                // abaixo (sem postMessage nenhum), a pessoa decide na tela.
                client.postMessage({ type: 'DEE_CALL_ACTION', action: action, callId: data.callId });
            }
            await client.focus();
        } else if (isMsg) {
            // App estava totalmente fechado: abre uma nova janela já
            // apontando para a conversa; o próprio index.html lê esses
            // parâmetros na inicialização (ver pendingSWMsgAction).
            var msgUrl = './index.html?msg=1&mid=' + encodeURIComponent(data.id || '') +
                         '&mgroup=' + (data.isGroup ? '1' : '0') +
                         '&mname=' + encodeURIComponent(data.name || '');
            await self.clients.openWindow(msgUrl);
        } else if (isSocial) {
            // App estava totalmente fechado: abre uma nova janela já
            // apontando pra postagem; o social.js lê esses parâmetros
            // assim que termina de iniciar (ver sfPendingOpenPostId).
            var socialUrl = './index.html?sopen=1&spost=' + encodeURIComponent(data.postId || '');
            await self.clients.openWindow(socialUrl);
        } else if (isStatus) {
            // App estava totalmente fechado: abre uma nova janela já
            // apontando para o status desse amigo; o índex.html lê esses
            // parâmetros na inicialização (ver pendingSWStatusAction).
            var statusUrl = './index.html?vstatus=1&vskind=new&vsuid=' + encodeURIComponent(data.uid || '');
            await self.clients.openWindow(statusUrl);
        } else if (isStatusLike) {
            // App estava totalmente fechado: abre uma nova janela já
            // apontando para o seu próprio status curtido.
            var statusLikeUrl = './index.html?vstatus=1&vskind=like&vsid=' + encodeURIComponent(data.statusId || '');
            await self.clients.openWindow(statusLikeUrl);
        } else if (isFriendReq) {
            // App estava totalmente fechado: abre uma nova janela já
            // apontando para a aba Amigos; o índex.html lê esse parâmetro
            // na inicialização (ver pendingSWFriendAction).
            await self.clients.openWindow('./index.html?vfriend=1');
        } else {
            // App estava totalmente fechado: abre uma nova janela. Se foi
            // um toque num botão de verdade ("Atender"/"Recusar"), leva a
            // intenção na URL — o próprio index.html reenvia a ação assim
            // que a chamada aparecer de novo no listener em tempo real
            // (mesmo callId). Se foi só um toque no corpo da notificação,
            // abre normal, SEM parâmetro de chamada nenhum: a pessoa decide
            // atender ou recusar já dentro da tela de chamada.
            var callUrl = action
                ? ('./index.html?call=' + action + '&id=' + encodeURIComponent(data.callId || ''))
                : './index.html';
            await self.clients.openWindow(callUrl);
        }
    })());
});

self.addEventListener('notificationclose', function() {
    // Nada obrigatório aqui — mantido para futura telemetria (chamada perdida etc.).
});

/* ── MESSAGE — recebe a sincronização de preferências mandada pela
   página sempre que o usuário muda um switch/select nas Configurações. ── */
self.addEventListener('message', function(event) {
    var msg = event.data || {};
    if (msg.type === 'SKIP_WAITING') {
        // Mandado pelo index.html assim que ele detecta que este sw.js
        // (versão nova, ainda em "waiting") terminou de instalar. Sem isso,
        // o navegador ficaria esperando todas as abas do site fecharem para
        // só então ativar a versão nova — era exatamente esse atraso que
        // obrigava a apagar cache/dados manualmente para ver a atualização.
        self.skipWaiting();
        return;
    }
    if (msg.type === 'DEE_SETTINGS_UPDATE') {
        // As preferências já são persistidas via IndexedDB pelo próprio
        // app (openSettingsDB/syncNotifSettingsToSW); nada extra a fazer
        // aqui além de existir esse listener para futuras extensões.
    }
});