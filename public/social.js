(function () {
    'use strict';

    // ── Estado local ──
    var sfPosts        = [];      // cache dos posts carregados (feed geral, mais recentes primeiro)
    var sfPostsUnsub    = null;
    var sfMode          = 'all';  // 'all' | 'mine'
    var sfIndex         = 0;      // índice do post visível no carrossel
    var sfPendingImage   = null;  // { base64, mimeType } da foto escolhida no modal de nova postagem
    var sfPendingAudio   = null;  // { base64, mimeType } do áudio gravado/escolhido no modal de nova postagem
    var sfCommentsUnsub  = null;  // listener dos comentários do post aberto no detalhe
    var sfDetailPostId   = null;  // post atualmente aberto no modal de detalhe
    var sfDetailPostOwnerUid = null; // dono do post aberto no detalhe (pode excluir qualquer comentário nele)
    var sfLoadedImages   = {};    // postId -> true, controla quais mediaId já foram baixados/decodificados
    var sfLoadedAudios   = {};    // postId -> true, controla quais audioId já foram baixados/decodificados
    // ── Gravação de áudio para novas postagens (independente da gravação do chat) ──
    var sfAudioRec = { isRecording: false, stream: null, recorder: null, chunks: [], startTime: 0, timer: null, timeoutId: null };
    var sfShareTargetPost = null; // post selecionado para compartilhar
    var sfBlockedUsers   = [];    // uids que o usuário logado bloqueou (posts somem do feed)
    var sfHiddenPosts    = [];    // postIds que o usuário logado ocultou individualmente
    var sfPrefsUnsub     = null;  // listener do doc social_blocks/{me.uid}
    var sfOptionsPost    = null;  // post selecionado no menu "⋯" (ocultar/bloquear)
    // ── Postagem em destaque (definida no painel administrativo) ──
    var sfPinned         = null;  // { postId, expiresAt } vindo de social_config/pinned
    var sfPinnedUnsub     = null;  // listener desse doc
    var sfPinnedPost      = null; // cache da postagem fixada, caso ela não esteja nos 150 posts mais recentes já carregados
    // ── Notificações de interação (curtida/comentário/compartilhamento nas
    //    MINHAS postagens) — badge em "Meus posts" + notificação nativa em
    //    segundo plano, no mesmo esquema já usado pras mensagens de chat. ──
    var sfNotificationsUnsub = null;
    var sfNotifUnread        = 0;    // interações NAS MINHAS postagens (curtida/comentário/compartilhamento/reconhecimento) — badge em "Meus posts"
    var sfLiveNotifUnread    = 0;    // avisos de "amigo começou uma live" — badge em "Comunidade" (não é interação no meu post)
    var sfPendingOpenPostId  = null; // postId a abrir assim que o app terminar de iniciar (veio de um clique em notificação nativa com o app totalmente fechado)

    // ── LIVE — transmissão ao vivo na Comunidade (mesmo esquema WebRTC/
    //    sinalização-via-Firestore da Live do chat, ver index.html, só que
    //    a live vive dentro do próprio post: social_posts/{postId}/viewers
    //    e /peers. Assim ela aparece e se comporta como uma publicação
    //    normal no feed, e qualquer um pode entrar direto pelo card. ──
    var sfLiveActivePostId    = null;  // postId da live atualmente aberta nesta sessão (anfitrião OU espectador)
    var sfLiveIsHost          = false;
    var sfLiveHostInfo        = null;  // { uid, nome, foto } — usado do lado do espectador
    var sfLiveLocalStream     = null;  // MediaStream da câmera/mic do anfitrião
    var sfLiveCamOn           = true;
    var sfLiveMicOn           = true;
    var sfLivePeerConns       = {};    // anfitrião: { viewerUid: RTCPeerConnection } · espectador: { viewer: RTCPeerConnection }
    var sfLivePeerVideoSenders = {};   // anfitrião: { viewerUid: RTCRtpSender } — replaceTrack ao ligar/desligar câmera
    var sfLivePeerCandUnsubs  = {};
    var sfLiveViewersUnsub    = null;  // anfitrião: listener da subcoleção "viewers"
    var sfLiveViewersMap      = {};    // anfitrião: uid -> { nome, foto, joinedAt }
    var sfLivePeerDocUnsub    = null;  // espectador: listener do próprio doc em "peers/{meuUid}"
    var sfLivePostWatchUnsub  = null;  // ambos: listener do post (status/camOn/micOn do anfitrião, likes, comentários)
    var sfLiveViewerMuted     = false;
    var sfLivePendingAudio    = null;  // áudio anexado ao iniciar a live (mesmo esquema da nova postagem)
    var sfLiveAudioRec        = { isRecording: false, stream: null, recorder: null, chunks: [], startTime: 0, timer: null, timeoutId: null };
    var sfLivePendingCover    = null;  // { base64, mimeType } da capa (opcional) escolhida ao iniciar a live — se não escolher, usa a foto de perfil, como já acontecia
    var sfLoadedCovers        = {};    // postId -> true, controla quais coverId (capa em partes) já foram baixados/decodificados

    var SF_MAX_INLINE = 700 * 1024; // mesmo limite usado no restante do app p/ decidir inline vs chunks

    // ── "Voz Dee" — Pontuação de Impacto / Reconhecimento / Selo / Spotlight ──
    // Ver bloco de funções mais abaixo ("VOZ DEE") pra explicação completa.
    // Cache dos eventos de impacto (social_impact_events), carregado sob
    // demanda e reaproveitado em memória durante a sessão (evita reler o
    // Firestore toda vez que um selo precisa ser desenhado).
    var sfImpactEvents        = null;  // array bruto de eventos já carregados nesta sessão (ou null se ainda não carregou)
    var sfImpactEventsAt      = 0;     // Date.now() do último carregamento — usado pro TTL do cache
    var sfImpactEventsLoading = null;  // Promise em andamento, evita disparar 2 carregamentos em paralelo
    var sfImpactScoreCache    = {};    // uid -> pontuação total já calculada (derivada de sfImpactEvents)
    var sfImpactRecentCache   = {};    // uid -> pontuação dos últimos 7 dias (pro Spotlight)
    var sfSpotlightTop3       = [];    // uids em destaque na semana atual (moldura + banner)
    var SF_IMPACT_TTL_MS      = 5 * 60 * 1000;      // recarrega o cache a cada 5min no máximo
    var SF_IMPACT_WINDOW_DAYS = 180;   // só busca eventos dos últimos 180 dias (mais velho que isso já decaiu quase a zero — ver sfDecayFactor — e isso limita o tamanho da leitura)
    var SF_HALF_LIFE_MS       = 30 * 24 * 60 * 60 * 1000; // meia-vida de 30 dias
    var SF_WEEK_MS            = 7 * 24 * 60 * 60 * 1000;  // "semana" fixa de 7 dias a partir da época Unix (mesmo cálculo usado nas firestore.rules)

    // ══════════════════════════════════════════════════════════════════
    //  CSS
    // ══════════════════════════════════════════════════════════════════
    function sfInjectCSS() {
        if (document.getElementById('sf-styles')) return;
        var css = '\
#social-feed-section{display:flex;flex-direction:column;flex:1;min-height:260px;overflow:hidden;border-top:1px solid var(--border);background:#161b2c;}\
.sf-header{display:flex;align-items:stretch;padding:8px 8px 6px;flex-shrink:0;width:100%;box-sizing:border-box;container-type:inline-size;container-name:sf-header;}\
.sf-title{font-family:"Syne",sans-serif;font-weight:800;font-size:12px;letter-spacing:.5px;color:var(--text);display:flex;align-items:center;gap:6px;}\
.sf-header-btns{display:flex;align-items:stretch;gap:4px;width:100%;}\
.sf-hbtn{background:rgba(0,229,204,.08);border:1px solid rgba(0,229,204,.18);color:var(--accent);cursor:pointer;height:28px;padding:0 7px;border-radius:8px;font-family:"Syne",sans-serif;font-weight:800;font-size:10.5px;letter-spacing:0;display:flex;align-items:center;justify-content:center;gap:3px;transition:background .2s;white-space:nowrap;overflow:hidden;min-width:0;box-sizing:border-box;flex:1 1 0;}\
.sf-hbtn-icon-only{flex:0 0 auto;padding:0 7px;position:relative;}\
.sf-hbtn-label{overflow:hidden;text-overflow:ellipsis;min-width:0;}\
.sf-rank-badge{position:absolute;top:-5px;right:-4px;z-index:2;pointer-events:none;}\
.sf-hbtn:hover{background:rgba(0,229,204,.16);}\
.sf-hbtn.on{background:var(--accent);color:#000;}\
.sf-hbtn.new{background:linear-gradient(135deg,var(--accent),#00b8a8);color:#000;border:none;}\
.sf-hbtn .icon{width:13px;height:13px;flex-shrink:0;}\
.sf-hbtn .tab-badge{flex-shrink:0;}\
@container sf-header (max-width:460px){\
.sf-hbtn{font-size:9.5px;padding:0 5px;gap:2px;height:26px;}\
.sf-hbtn-icon-only{padding:0 6px;}\
.sf-hbtn .icon{width:12px;height:12px;}\
}\
@container sf-header (max-width:380px){\
.sf-header-btns{gap:3px;}\
.sf-hbtn{font-size:8.5px;padding:0 4px;height:25px;}\
.sf-hbtn-icon-only{padding:0 6px;}\
.sf-hbtn .icon{width:11px;height:11px;}\
}\
@container sf-header (max-width:330px){\
.sf-header-btns{gap:2px;}\
.sf-hbtn{font-size:8px;padding:0 3px;}\
.sf-hbtn-icon-only{padding:0 5px;}\
}\
@supports not (container-type: inline-size){\
@media (max-width:460px){.sf-hbtn{font-size:9.5px;padding:0 5px;gap:2px;height:26px;}.sf-hbtn-icon-only{padding:0 6px;}.sf-hbtn .icon{width:12px;height:12px;}}\
@media (max-width:380px){.sf-header-btns{gap:3px;}.sf-hbtn{font-size:8.5px;padding:0 4px;height:25px;}.sf-hbtn-icon-only{padding:0 6px;}.sf-hbtn .icon{width:11px;height:11px;}}\
@media (max-width:330px){.sf-header-btns{gap:2px;}.sf-hbtn{font-size:8px;padding:0 3px;}.sf-hbtn-icon-only{padding:0 5px;}}\
}\
.sf-carousel-wrap{position:relative;flex:1;min-height:0;overflow:hidden;}\
.sf-arrow{display:none;position:absolute;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;background:rgba(10,14,22,.55);border:1px solid rgba(255,255,255,.14);color:#fff;font-size:14px;line-height:1;align-items:center;justify-content:center;cursor:pointer;z-index:3;transition:background .15s,opacity .15s;}\
.sf-arrow:hover{background:rgba(0,229,204,.35);border-color:var(--accent);}\
.sf-arrow.prev{left:6px;}\
.sf-arrow.next{right:6px;}\
.sf-arrow.hide{display:none !important;}\
@media (hover:hover) and (pointer:fine){.sf-arrow{display:flex;}}\
.sf-track{display:flex;height:100%;transition:transform .32s cubic-bezier(.16,1,.3,1);cursor:grab;touch-action:pan-y;}\
.sf-track.dragging{transition:none;cursor:grabbing;}\
.sf-card{flex:0 0 100%;width:100%;min-width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;padding:8px 12px 10px;overflow:hidden;}\
.sf-card-head{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-bottom:6px;}\
.sf-head-click{display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;border-radius:8px;transition:background .15s;}\
.sf-head-click:hover{background:rgba(0,229,204,.06);}\
.sf-detail-head-click{display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;border-radius:8px;transition:background .15s;}\
.sf-detail-head-click:hover{background:rgba(0,229,204,.06);}\
.sf-avatar{width:30px;height:30px;border-radius:9px;flex-shrink:0;background:var(--surface2);border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-family:"Syne",sans-serif;font-weight:900;font-size:12px;color:var(--accent);overflow:hidden;}\
.sf-avatar img{width:100%;height:100%;object-fit:cover;}\
.sf-head-info{flex:1;min-width:0;}\
.sf-name{font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\
.sf-time{font-size:10px;color:var(--muted);}\
.sf-del-btn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:3px 5px;border-radius:7px;flex-shrink:0;}\
.sf-del-btn:hover{color:var(--danger);background:rgba(255,59,92,.08);}\
.sf-more-btn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;padding:3px 8px;border-radius:7px;flex-shrink:0;line-height:1;}\
.sf-more-btn:hover{color:var(--accent);background:rgba(0,229,204,.08);}\
.sf-opt-row{display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:10px;cursor:pointer;font-size:13.5px;color:var(--text);background:var(--surface2);margin-bottom:8px;border:1px solid var(--border);transition:border-color .15s;}\
.sf-opt-row:hover{border-color:var(--accent);}\
.sf-opt-row.danger{color:var(--danger);}\
.sf-opt-row.danger:hover{border-color:rgba(255,59,92,.4);}\
.sf-blocked-row{display:flex;align-items:center;gap:10px;padding:9px 4px;}\
.sf-blocked-name{flex:1;min-width:0;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\
.sf-unblock-btn{flex-shrink:0;background:var(--surface2);border:1px solid var(--border-hi);color:var(--text);cursor:pointer;border-radius:8px;padding:7px 12px;font-family:"Syne",sans-serif;font-weight:800;font-size:11px;transition:border-color .15s;}\
.sf-unblock-btn:hover{border-color:var(--accent);color:var(--accent);}\
.sf-blocked-hint{font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.4;}\
.sf-card-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-radius:12px;background:var(--surface2);cursor:pointer;position:relative;}\
.sf-badge{display:inline-flex;align-items:center;justify-content:center;font-size:11px;margin-left:3px;vertical-align:middle;line-height:1;filter:drop-shadow(0 0 2px rgba(0,229,204,.35));}\
.sf-namewrap{display:flex;align-items:center;gap:2px;min-width:0;}\
.sf-avatar.sf-spotlight{position:relative;box-shadow:0 0 0 2px var(--accent),0 0 10px rgba(0,229,204,.55);}\
.sf-spotlight-banner{display:flex;align-items:center;gap:5px;padding:4px 10px;margin:0 12px 5px;border-radius:9px;background:linear-gradient(135deg,rgba(0,229,204,.14),rgba(0,184,168,.06));border:1px solid rgba(0,229,204,.28);font-size:9.5px;color:var(--text);flex-shrink:0;}\
.sf-spotlight-banner .icon{width:11px;height:11px;color:var(--accent);flex-shrink:0;}\
.sf-spotlight-names{font-weight:800;color:var(--accent);}\
.sf-spotlight-name-link{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;}\
.sf-spotlight-name-link:hover{color:var(--text);}\
.sf-rank-row{display:flex;align-items:center;gap:10px;padding:9px 4px;border-bottom:1px solid var(--border);}\
.sf-rank-row:last-child{border-bottom:none;}\
.sf-rank-pos{width:22px;flex-shrink:0;text-align:center;font-family:"Syne",sans-serif;font-weight:800;font-size:12.5px;color:var(--muted);}\
.sf-rank-row:nth-child(1) .sf-rank-pos{color:#ffd54a;}\
.sf-rank-row:nth-child(2) .sf-rank-pos{color:#c8ccd6;}\
.sf-rank-row:nth-child(3) .sf-rank-pos{color:#d69a5a;}\
.sf-rank-name{flex:1;min-width:0;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:2px;}\
.sf-rank-score{flex-shrink:0;font-family:"Syne",sans-serif;font-weight:800;font-size:12px;color:var(--accent);}\
.sf-recog-btn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:3px 5px;border-radius:7px;flex-shrink:0;display:flex;align-items:center;gap:3px;}\
.sf-recog-btn .icon{width:15px;height:15px;}\
.sf-recog-btn:hover,.sf-recog-btn.given{color:var(--accent);background:rgba(0,229,204,.08);}\
.sf-level-hint{font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.4;}\
.sf-card-body.sf-card-body-audio{flex:0 0 auto;background:transparent;border-radius:0;}\
.sf-card-body-combo .sf-card-media{flex:1 1 auto;min-height:0;}\
.sf-card-body-combo .sf-card-audio{flex:0 0 auto;max-height:60px;overflow:visible;}\
.sf-card-body-combo .sf-card-audio .audio-player{padding:6px 10px;gap:4px;border-radius:10px;}\
.sf-card-body-combo .sf-card-audio .ap-top{gap:8px;}\
.sf-card-body-combo .sf-card-audio .ap-play{width:24px;height:24px;font-size:10px;}\
.sf-card-body-combo .sf-card-audio .ap-label{font-size:9px;}\
.sf-card-body-combo .sf-card-audio .ap-time{font-size:9px;margin-top:1px;}\
.sf-card-body-combo .sf-card-audio .ap-track{height:12px;}\
.sf-card-body-combo .sf-card-audio .ap-waveform{display:none;}\
.sf-card-body-combo .sf-card-caption{flex:0 0 auto;}\
.sf-card-media{flex:1;min-height:0;background:#05070a;display:flex;align-items:center;justify-content:center;overflow:hidden;}\
.sf-card-media img{width:100%;height:100%;object-fit:cover;display:block;}\
.sf-media-loading{color:var(--muted);font-size:11px;}\
.sf-card-text{padding:14px;font-size:13px;line-height:1.5;color:var(--text);overflow-y:auto;flex:1;word-break:break-word;}\
.sf-card-text.sf-textonly{display:flex;align-items:center;justify-content:center;text-align:center;font-family:"Syne",sans-serif;font-weight:700;font-size:15px;background:linear-gradient(135deg,rgba(0,229,204,.08),rgba(0,136,255,.08));}\
.sf-card-caption{padding:8px 4px 0;font-size:12px;color:var(--text);line-height:1.4;word-break:break-word;max-height:52px;overflow-y:auto;flex-shrink:0;}\
.sf-link{color:var(--accent);text-decoration:underline;text-underline-offset:2px;word-break:break-all;}\
.sf-link:hover{text-decoration:none;}\
.sf-actions{display:flex;align-items:center;gap:6px;margin-top:8px;flex-shrink:0;}\
.sf-act-btn{background:var(--surface2);border:1px solid var(--border);color:var(--text);cursor:pointer;border-radius:20px;padding:6px 10px;font-size:11.5px;display:flex;align-items:center;gap:5px;transition:border-color .15s;}\
.sf-act-btn:hover{border-color:var(--accent);}\
.sf-act-btn.liked{color:var(--danger);border-color:rgba(255,59,92,.35);}\
.sf-act-btn span{font-family:"Syne",sans-serif;font-weight:800;}\
.sf-dots{display:flex;justify-content:center;gap:4px;padding:6px 0;flex-shrink:0;}\
.sf-dot{width:5px;height:5px;border-radius:50%;background:var(--border);transition:background .2s,width .2s;}\
.sf-dot.on{background:var(--accent);width:14px;border-radius:3px;}\
.sf-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--muted);font-size:12px;text-align:center;padding:16px;}\
.sf-empty-ic{font-size:26px;opacity:.4;}\
/* ── Modal: nova postagem ── */\
#sf-new-post-modal textarea{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px;color:var(--text);font-family:inherit;font-size:14px;resize:none;min-height:90px;}\
#sf-new-post-modal textarea:focus{outline:none;border-color:var(--accent);}\
.sf-new-preview{margin-top:12px;border-radius:12px;overflow:hidden;max-height:220px;display:none;background:#000;position:relative;}\
.sf-new-preview.show{display:block;}\
.sf-new-preview img{width:100%;max-height:220px;object-fit:contain;display:block;}\
.sf-new-preview .sf-rm-img{position:absolute;top:6px;right:6px;background:rgba(0,0,0,.6);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:13px;}\
.sf-pick-photo-btn{display:flex;align-items:center;gap:8px;padding:11px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;cursor:pointer;color:var(--text);font-size:13px;transition:border-color .15s;}\
.sf-pick-photo-btn:hover{border-color:var(--accent);}\
.sf-new-media-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}\
.sf-new-media-btns .sf-pick-photo-btn{flex:1 1 calc(50% - 4px);min-width:130px;}\
.sf-new-audio-preview{display:none;margin-top:12px;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:8px 10px;position:relative;}\
.sf-new-audio-preview.show{display:flex;}\
.sf-new-audio-preview audio{flex:1;height:36px;min-width:0;}\
.sf-rm-audio{flex-shrink:0;background:rgba(0,0,0,.35);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:12px;}\
.sf-new-rec-bar{display:none;align-items:center;gap:8px;margin-top:10px;padding:10px 12px;background:rgba(255,59,92,.08);border:1px solid rgba(255,59,92,.25);border-radius:12px;font-size:12.5px;color:var(--danger);}\
.sf-new-rec-bar.show{display:flex;}\
.sf-rdot{width:8px;height:8px;border-radius:50%;background:var(--danger);flex-shrink:0;animation:sf-blink 1s infinite;}\
@keyframes sf-blink{0%,100%{opacity:1;}50%{opacity:.25;}}\
.sf-new-rec-time{font-family:"Syne",sans-serif;font-weight:800;}\
.sf-new-rec-stop{margin-left:auto;background:var(--danger);border:none;color:#fff;cursor:pointer;height:26px;padding:0 10px;border-radius:8px;font-family:"Syne",sans-serif;font-weight:800;font-size:11px;}\
.sf-card-audio{flex-shrink:0;margin-top:6px;}\
.sf-card-audio .audio-player{width:100%;max-width:100%;}\
.sf-detail-audio{padding:14px 16px;}\
.sf-detail-audio .audio-player{width:100%;max-width:100%;}\
/* ── Modal: detalhe do post + comentários ── */\
#sf-detail-modal .mcard{max-width:440px;padding:0;overflow:hidden;display:flex;flex-direction:column;max-height:88vh;}\
.sf-detail-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0;}\
.sf-detail-close{margin-left:auto;background:var(--surface2);border:none;color:var(--text);width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:14px;flex-shrink:0;}\
.sf-detail-body{overflow-y:auto;flex-shrink:1;}\
.sf-detail-media{width:100%;max-height:340px;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;}\
.sf-detail-media img{width:100%;max-height:340px;object-fit:contain;}\
.sf-detail-text{padding:14px 16px;font-size:14px;line-height:1.55;color:var(--text);word-break:break-word;}\
.sf-detail-actions{display:flex;gap:8px;padding:4px 16px 12px;flex-shrink:0;}\
.sf-comments-title{padding:10px 16px 4px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);flex-shrink:0;}\
.sf-comments-list{padding:0 16px 8px;display:flex;flex-direction:column;gap:10px;}\
.sf-comment-row{display:flex;gap:8px;}\
.sf-comment-del-btn{flex-shrink:0;align-self:flex-start;background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:4px 6px;border-radius:7px;line-height:1;}\
.sf-comment-del-btn:hover{color:var(--danger);background:rgba(255,59,92,.08);}\
.sf-comment-body{flex:1;min-width:0;background:var(--surface2);border-radius:12px;padding:8px 10px;}\
.sf-comment-name{font-weight:700;font-size:12px;color:var(--accent);}\
.sf-comment-text{font-size:12.5px;color:var(--text);margin-top:2px;word-break:break-word;line-height:1.4;}\
.sf-comment-time{font-size:10px;color:var(--muted);margin-top:3px;}\
.sf-comments-empty{padding:14px 16px;color:var(--muted);font-size:12px;text-align:center;}\
.sf-comment-inputbar{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border);flex-shrink:0;}\
.sf-comment-inputbar input{flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:9px 14px;color:var(--text);font-size:13px;font-family:inherit;}\
.sf-comment-inputbar input:focus{outline:none;border-color:var(--accent);}\
.sf-comment-send{background:var(--accent);border:none;color:#000;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0;}\
/* ── Modal: compartilhar ── */\
.sf-share-preview{display:flex;gap:10px;align-items:center;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:8px;margin-bottom:14px;}\
.sf-share-preview img{width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#000;}\
.sf-share-preview-ic{width:48px;height:48px;border-radius:8px;flex-shrink:0;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:20px;}\
.sf-share-preview-title{font-size:13px;font-weight:700;font-family:"Syne",sans-serif;color:var(--text);}\
.sf-share-target-row{display:flex;align-items:center;gap:10px;padding:8px 4px;cursor:pointer;border-radius:8px;}\
.sf-share-target-row:hover{background:var(--surface2);}\
.sf-share-target-row label{flex:1;cursor:pointer;font-size:13px;}\
/* ── Cartão de post compartilhado dentro do chat ── */\
.sf-share-tag{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}\
.sf-share-card{display:flex;gap:10px;align-items:center;cursor:pointer;color:var(--text);background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:8px;max-width:260px;}\
.sf-share-card img{width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;background:#000;}\
.sf-share-card .sf-share-ic{width:56px;height:56px;border-radius:8px;flex-shrink:0;background:var(--surface3);display:flex;align-items:center;justify-content:center;font-size:22px;}\
.sf-share-info{flex:1;min-width:0;}\
.sf-share-title{font-size:13px;font-weight:700;font-family:"Syne",sans-serif;color:var(--accent);}\
.sf-share-sub{font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\
/* ── LIVE na Comunidade ── */\
.sf-live-btn{background:rgba(255,77,77,.1) !important;border-color:rgba(255,77,77,.28) !important;color:#ff5c5c !important;}\
.sf-live-btn:hover{background:rgba(255,77,77,.2) !important;}\
.sf-card-live-badge{position:absolute;top:8px;left:8px;z-index:3;display:flex;align-items:center;gap:5px;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);border-radius:20px;padding:4px 9px 4px 7px;font-family:"Syne",sans-serif;font-weight:800;font-size:10px;color:#fff;letter-spacing:.4px;}\
.sf-live-dot{width:7px;height:7px;border-radius:50%;background:#ff4d4d;animation:sf-live-pulse 1.4s infinite;flex-shrink:0;}\
.sf-live-dot.ended{background:var(--muted);animation:none;}\
@keyframes sf-live-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}\
.sf-live-viewers-chip{position:absolute;top:8px;right:8px;z-index:3;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);border-radius:20px;padding:4px 9px;font-size:10.5px;font-weight:700;color:#fff;}\
.sf-live-viewers-chip .icon{width:12px;height:12px;}\
.sf-card-live-thumb{position:relative;width:100%;aspect-ratio:4/3;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,#20263c,#161b2c);display:flex;align-items:center;justify-content:center;}\
.sf-card-live-thumb .sf-avatar{width:64px;height:64px;font-size:22px;}\
.sf-card-live-ended-label{position:absolute;bottom:8px;left:8px;right:8px;font-size:10.5px;color:var(--muted);font-weight:700;text-align:center;}\
.sf-live-cover-label{font-size:11.5px;color:var(--muted);margin:10px 0 -2px;line-height:1.4;}\
.sf-card-live-thumb img{width:100%;height:100%;object-fit:cover;display:block;}\
.sf-card-live-thumb.has-cover{background:#000;}\
.sf-detail-live-ended-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.45);}\
.sf-detail-live-ended{position:relative;z-index:1;}\
.sf-detail-live-area{position:relative;width:100%;border-radius:14px;overflow:hidden;background:#000;margin-bottom:10px;aspect-ratio:4/3;}\
.sf-detail-live-video{width:100%;height:100%;object-fit:cover;display:block;background:#000;}\
.sf-detail-live-badge{position:absolute;top:10px;left:10px;z-index:2;display:flex;align-items:center;gap:5px;background:rgba(0,0,0,.55);border-radius:20px;padding:4px 9px 4px 7px;}\
.sf-detail-live-badge span{font-family:"Syne",sans-serif;font-weight:800;font-size:10px;color:#fff;letter-spacing:.5px;}\
.sf-detail-live-viewers{position:absolute;top:10px;right:10px;z-index:2;display:flex;align-items:center;gap:4px;background:rgba(0,0,0,.55);border-radius:20px;padding:4px 9px;font-size:11px;font-weight:700;color:#fff;}\
.sf-detail-live-viewers .icon{width:13px;height:13px;}\
.sf-detail-live-controls{position:absolute;bottom:10px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:10px;z-index:2;}\
.sf-live-ctl-btn{width:38px;height:38px;border-radius:50%;background:rgba(20,22,30,.65);border:1px solid rgba(255,255,255,.16);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;}\
.sf-live-ctl-btn.off{background:var(--danger,#e5484d);}\
.sf-live-ctl-btn.end{background:var(--danger,#e5484d);}\
.sf-live-ctl-btn .icon{width:17px;height:17px;}\
.sf-detail-live-ended{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;height:100%;color:var(--muted);font-size:12.5px;text-align:center;padding:0 20px;}\
.sf-detail-live-ended .sf-avatar{width:56px;height:56px;font-size:20px;}\
.sf-live-camoff{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#0c0f18;z-index:1;}\
.sf-live-camoff.show{display:flex;}\
.sf-live-camoff .sf-avatar{width:56px;height:56px;font-size:20px;}\
.sf-live-camoff span{color:var(--muted);font-size:11.5px;}\
.sf-live-hint{font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.4;}\
';
        var style = document.createElement('style');
        style.id = 'sf-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ══════════════════════════════════════════════════════════════════
    //  HTML — injeta a seção da rede social + os modais no fim do body
    // ══════════════════════════════════════════════════════════════════
    function sfMountUI() {
        if (document.getElementById('social-feed-section')) return;
        var wrap = document.getElementById('tab-panels-wrap');
        if (!wrap) return;

        var section = document.createElement('div');
        section.id = 'social-feed-section';
        section.innerHTML =
            '<div class="sf-header">' +
                '<div class="sf-header-btns">' +
                    '<button class="sf-hbtn sf-tab on" id="sf-community-toggle" title="Ver postagens da comunidade"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span class="sf-hbtn-label">Comunidade</span><span class="tab-badge" id="sf-community-badge" style="display:none;">0</span></button>' +
                    '<button class="sf-hbtn sf-tab" id="sf-mine-toggle" title="Ver só meus posts"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="sf-hbtn-label">Meus posts</span><span class="tab-badge" id="sf-mine-badge" style="display:none;">0</span></button>' +
                    '<button class="sf-hbtn sf-hbtn-icon-only" id="sf-rank-btn" title="Ranking da Comunidade" aria-label="Ranking da Comunidade"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg><span class="unread-badge sf-rank-badge" id="sf-rank-badge" style="display:none;">0</span></button>' +
                    '<button class="sf-hbtn sf-hbtn-icon-only" id="sf-blocked-btn" title="Usuários bloqueados" aria-label="Usuários bloqueados"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></button>' +
                    '<button class="sf-hbtn new" id="sf-new-btn" title="Nova postagem"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span class="sf-hbtn-label">Postar</span></button>' +
                    '<button class="sf-hbtn sf-live-btn" id="sf-live-btn" title="Iniciar uma live"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg><span class="sf-hbtn-label">Live</span></button>' +
                '</div>' +
            '</div>' +
            '<div class="sf-spotlight-banner" id="sf-spotlight-banner" style="display:none;"></div>' +
            '<div class="sf-carousel-wrap">' +
                '<button class="sf-arrow prev" id="sf-arrow-prev" title="Postagem anterior" aria-label="Postagem anterior">‹</button>' +
                '<div class="sf-track" id="sf-track"></div>' +
                '<button class="sf-arrow next" id="sf-arrow-next" title="Próxima postagem" aria-label="Próxima postagem">›</button>' +
            '</div>' +
            '<div class="sf-dots" id="sf-dots"></div>';
        // Insere DEPOIS de #tab-panels-wrap (irmã seguinte), não mais dentro
        // de #panel-chats — assim ela fica fixa e visível em qualquer aba
        // (Chats/Status/Grupos/Amigos), sem "sumir" ao trocar de aba.
        wrap.insertAdjacentElement('afterend', section);

        var modals = document.createElement('div');
        modals.innerHTML =
            // Nova postagem
            '<div id="sf-new-post-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2 style="margin-bottom:12px;"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Nova Postagem</h2>' +
                    '<textarea id="sf-new-text" maxlength="500" placeholder="Escreva algo para a comunidade..."></textarea>' +
                    '<div class="sf-new-preview" id="sf-new-preview"><button class="sf-rm-img" id="sf-new-rm-img"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button><img id="sf-new-preview-img" src="" alt=""></div>' +
                    '<div class="sf-new-audio-preview" id="sf-new-audio-preview"><audio id="sf-new-audio-player" controls></audio><button class="sf-rm-audio" id="sf-new-rm-audio"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
                    '<div class="sf-new-rec-bar" id="sf-new-rec-bar"><span class="sf-rdot"></span> Gravando áudio... <span class="sf-new-rec-time" id="sf-new-rec-time">00:00</span><button class="sf-new-rec-stop" id="sf-new-rec-stop">Parar</button></div>' +
                    '<div class="sf-new-media-btns">' +
                        '<div class="sf-pick-photo-btn" id="sf-cam-photo-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span><span>Tirar foto</span></div>' +
                        '<div class="sf-pick-photo-btn" id="sf-pick-photo-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span><span>Galeria</span></div>' +
                        '<div class="sf-pick-photo-btn" id="sf-rec-audio-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span><span>Gravar áudio</span></div>' +
                        '<div class="sf-pick-photo-btn" id="sf-pick-audio-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span><span>Enviar áudio</span></div>' +
                    '</div>' +
                    '<div class="mbtns">' +
                        '<button class="mbtn sec" id="sf-new-cancel">Cancelar</button>' +
                        '<button class="mbtn pri" id="sf-new-submit">Publicar</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<input type="file" id="sf-new-file-input" hidden accept="image/*">' +
            '<input type="file" id="sf-new-audio-file-input" hidden accept="audio/*">' +
            // Iniciar Live (legenda + áudio opcional, igual à nova postagem)
            '<div id="sf-live-new-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2 style="margin-bottom:10px;"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> Iniciar Live</h2>' +
                    '<div class="sf-live-hint">Isso vai pedir acesso à sua câmera e ao microfone e começar uma transmissão ao vivo, visível para toda a comunidade. Ela aparece entre as postagens, como um post normal — você pode encerrar quando quiser.</div>' +
                    '<textarea id="sf-live-new-text" maxlength="500" placeholder="Escreva uma legenda para sua live (opcional)..."></textarea>' +
                    '<div class="sf-live-cover-label">Capa da live (opcional) — se não escolher, sua foto de perfil aparece na publicação, como já acontece.</div>' +
                    '<div class="sf-new-preview" id="sf-live-new-cover-preview"><button class="sf-rm-img" id="sf-live-new-rm-cover"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button><img id="sf-live-new-cover-preview-img" src="" alt=""></div>' +
                    '<div class="sf-new-media-btns">' +
                        '<div class="sf-pick-photo-btn" id="sf-live-cam-cover-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span><span>Tirar foto (capa)</span></div>' +
                        '<div class="sf-pick-photo-btn" id="sf-live-pick-cover-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span><span>Galeria (capa)</span></div>' +
                    '</div>' +
                    '<div class="sf-new-audio-preview" id="sf-live-new-audio-preview"><audio id="sf-live-new-audio-player" controls></audio><button class="sf-rm-audio" id="sf-live-new-rm-audio"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>' +
                    '<div class="sf-new-rec-bar" id="sf-live-new-rec-bar"><span class="sf-rdot"></span> Gravando áudio... <span class="sf-new-rec-time" id="sf-live-new-rec-time">00:00</span><button class="sf-new-rec-stop" id="sf-live-new-rec-stop">Parar</button></div>' +
                    '<div class="sf-new-media-btns">' +
                        '<div class="sf-pick-photo-btn" id="sf-live-rec-audio-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span><span>Gravar áudio</span></div>' +
                        '<div class="sf-pick-photo-btn" id="sf-live-pick-audio-btn"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span><span>Enviar áudio</span></div>' +
                    '</div>' +
                    '<div class="mbtns">' +
                        '<button class="mbtn sec" id="sf-live-new-cancel">Cancelar</button>' +
                        '<button class="mbtn pri" id="sf-live-new-start" style="background:linear-gradient(135deg,#ff4d4d,#c62828);">Iniciar Live</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<input type="file" id="sf-live-new-cover-file-input" hidden accept="image/*">' +
            '<input type="file" id="sf-live-new-audio-file-input" hidden accept="audio/*">' +
            // Detalhe do post + comentários
            '<div id="sf-detail-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<div class="sf-detail-head">' +
                        '<div class="sf-detail-head-click" id="sf-detail-head-click" title="Ver perfil">' +
                            '<div class="sf-avatar" id="sf-detail-avatar" style="width:36px;height:36px;">?</div>' +
                            '<div class="sf-head-info"><div class="sf-name" id="sf-detail-name">—</div><div class="sf-time" id="sf-detail-time"></div></div>' +
                        '</div>' +
                        '<button class="sf-del-btn" id="sf-detail-del-btn" style="display:none;" title="Excluir postagem"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>' +
                        '<button class="sf-more-btn" id="sf-detail-more-btn" style="display:none;" title="Mais opções">⋯</button>' +
                        '<button class="sf-detail-close" id="sf-detail-close-btn"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
                    '</div>' +
                    '<div class="sf-detail-body">' +
                        '<div id="sf-detail-media-wrap"></div>' +
                        '<div class="sf-detail-text" id="sf-detail-text" style="display:none;"></div>' +
                        '<div class="sf-detail-actions">' +
                            '<button class="sf-act-btn" id="sf-detail-like-btn"><svg class="icon icon-like-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> <span id="sf-detail-like-count">0</span></button>' +
                            '<button class="sf-act-btn" id="sf-detail-share-btn"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> <span id="sf-detail-share-count">0</span></button>' +
                            '<button class="sf-act-btn" id="sf-detail-recog-btn" style="display:none;" title="Dar Reconhecimento"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> Reconhecer</button>' +
                        '</div>' +
                        '<div class="sf-comments-title"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> Comentários (<span id="sf-detail-comment-count">0</span>)</div>' +
                        '<div class="sf-comments-list" id="sf-comments-list"></div>' +
                    '</div>' +
                    '<div class="sf-comment-inputbar">' +
                        '<input type="text" id="sf-comment-input" maxlength="300" placeholder="Escreva um comentário...">' +
                        '<button class="sf-comment-send" id="sf-comment-send-btn"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            // Compartilhar
            '<div id="sf-share-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Compartilhar Postagem</h2>' +
                    '<div class="sf-share-preview" id="sf-share-preview"></div>' +
                    '<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">Enviar para</div>' +
                    '<div class="scroll-list" id="sf-share-list"></div>' +
                    '<div class="mbtns">' +
                        '<button class="mbtn sec" id="sf-share-cancel">Cancelar</button>' +
                        '<button class="mbtn pri" id="sf-share-submit">Enviar</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            // Opções da postagem — ocultar / bloquear autor
            '<div id="sf-post-options-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2 style="margin-bottom:12px;">Opções da postagem</h2>' +
                    '<div class="sf-opt-row" id="sf-opt-hide"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg></span><span>Ocultar esta postagem</span></div>' +
                    '<div class="sf-opt-row danger" id="sf-opt-block"><span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span><span>Bloquear <span id="sf-opt-block-name">usuário</span></span></div>' +
                    '<div class="mbtns"><button class="mbtn sec" id="sf-opt-cancel">Cancelar</button></div>' +
                '</div>' +
            '</div>' +
            // Usuários bloqueados
            '<div id="sf-blocked-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Usuários bloqueados</h2>' +
                    '<div class="sf-blocked-hint">As postagens de quem você bloquear não aparecem mais na Comunidade Dee. Desbloqueie quando quiser voltar a vê-las.</div>' +
                    '<div class="scroll-list" id="sf-blocked-list"></div>' +
                    '<div class="mbtns"><button class="mbtn sec" id="sf-blocked-close">Fechar</button></div>' +
                '</div>' +
            '</div>' +
            // Ranking da Comunidade — top 10 por Pontuação de Impacto atual
            // (com decaimento já aplicado). Não é "quem tem mais seguidores"
            // — é quem vem CONTRIBUINDO de verdade, recentemente.
            '<div id="sf-rank-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> Ranking da Comunidade</h2>' +
                    '<div class="sf-level-hint">Pontuação por impacto real (curtidas, comentários, compartilhamentos e reconhecimentos recebidos), com decaimento — quem contribui continuamente sobe; quem para, cai aos poucos.</div>' +
                    '<div class="scroll-list" id="sf-rank-list"><div class="empty" style="padding:16px;">Carregando...</div></div>' +
                    '<div class="mbtns"><button class="mbtn sec" id="sf-rank-close">Fechar</button></div>' +
                '</div>' +
            '</div>' +
            // Dar Reconhecimento — 1x por semana, nunca a si mesmo, nunca
            // repetindo o mesmo destinatário duas semanas seguidas.
            '<div id="sf-recog-modal" class="overlay">' +
                '<div class="mcard">' +
                    '<h2><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg> Dar Reconhecimento</h2>' +
                    '<div class="sf-level-hint" id="sf-recog-text">Você tem 1 Reconhecimento por semana para dar a alguém cujo conteúdo achou realmente valioso. Vale 50 pontos de impacto.</div>' +
                    '<div class="mbtns"><button class="mbtn sec" id="sf-recog-cancel">Cancelar</button><button class="mbtn pri" id="sf-recog-confirm">Dar Reconhecimento</button></div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modals);

        sfWireEvents();
    }

    function sfWireEvents() {
        document.getElementById('sf-community-toggle').onclick = function () {
            sfMarkLiveNotificationsRead(); // toca em "Comunidade": considera os avisos de live pendentes como vistos
            if (sfMode === 'all') return;
            sfMode = 'all';
            document.getElementById('sf-community-toggle').classList.add('on');
            document.getElementById('sf-mine-toggle').classList.remove('on');
            sfIndex = 0;
            sfRenderCarousel();
        };
        document.getElementById('sf-mine-toggle').onclick = function () {
            sfMarkNotificationsRead(); // toca em "Meus posts": considera as notificações pendentes (nas minhas postagens) como vistas
            if (sfMode === 'mine') return;
            sfMode = 'mine';
            document.getElementById('sf-mine-toggle').classList.add('on');
            document.getElementById('sf-community-toggle').classList.remove('on');
            sfIndex = 0;
            sfRenderCarousel();
        };
        document.getElementById('sf-blocked-btn').onclick = sfOpenBlockedModal;
        document.getElementById('sf-blocked-close').onclick = function () { closeModal('sf-blocked-modal'); };
        document.getElementById('sf-rank-btn').onclick = sfOpenRankModal;
        document.getElementById('sf-rank-close').onclick = function () { closeModal('sf-rank-modal'); };
        document.getElementById('sf-recog-cancel').onclick = function () { closeModal('sf-recog-modal'); sfRecogTarget = null; };
        document.getElementById('sf-recog-confirm').onclick = sfConfirmRecognize;
        document.getElementById('sf-new-btn').onclick = sfOpenNewPostModal;
        document.getElementById('sf-new-cancel').onclick = function () { closeModal('sf-new-post-modal'); };
        document.getElementById('sf-new-submit').onclick = sfSubmitPost;
        document.getElementById('sf-pick-photo-btn').onclick = function () { document.getElementById('sf-new-file-input').click(); };
        document.getElementById('sf-new-file-input').onchange = sfHandleNewPhoto;
        document.getElementById('sf-new-rm-img').onclick = function (e) { e.stopPropagation(); sfPendingImage = null; sfUpdateNewPreview(); };
        document.getElementById('sf-cam-photo-btn').onclick = function () {
            if (typeof openCamera === 'function') openCamera('photo', 'social');
            else notify('Câmera não disponível neste dispositivo', 'warn');
        };
        document.getElementById('sf-pick-audio-btn').onclick = function () { document.getElementById('sf-new-audio-file-input').click(); };
        document.getElementById('sf-new-audio-file-input').onchange = sfHandleNewAudioFile;
        document.getElementById('sf-rec-audio-btn').onclick = sfStartRecordAudio;
        document.getElementById('sf-new-rec-stop').onclick = sfStopRecordAudio;
        document.getElementById('sf-new-rm-audio').onclick = function (e) { e.stopPropagation(); sfPendingAudio = null; sfUpdateNewAudioPreview(); };

        document.getElementById('sf-live-btn').onclick = sfOpenLiveNewModal;
        document.getElementById('sf-live-new-cancel').onclick = function () { closeModal('sf-live-new-modal'); };
        document.getElementById('sf-live-new-start').onclick = sfConfirmStartLive;
        document.getElementById('sf-live-new-rm-audio').onclick = function (e) { e.stopPropagation(); sfLivePendingAudio = null; sfUpdateLiveAudioPreview(); };
        document.getElementById('sf-live-cam-cover-btn').onclick = function () {
            if (typeof openCamera === 'function') openCamera('photo', 'social_live_cover');
            else notify('Câmera não disponível neste dispositivo', 'warn');
        };
        document.getElementById('sf-live-pick-cover-btn').onclick = function () { document.getElementById('sf-live-new-cover-file-input').click(); };
        document.getElementById('sf-live-new-cover-file-input').onchange = sfHandleLiveCoverPhoto;
        document.getElementById('sf-live-new-rm-cover').onclick = function (e) { e.stopPropagation(); sfLivePendingCover = null; sfUpdateLiveCoverPreview(); };
        document.getElementById('sf-live-pick-audio-btn').onclick = function () { document.getElementById('sf-live-new-audio-file-input').click(); };
        document.getElementById('sf-live-new-audio-file-input').onchange = sfHandleLiveAudioFile;
        document.getElementById('sf-live-rec-audio-btn').onclick = sfLiveStartRecordAudio;
        document.getElementById('sf-live-new-rec-stop').onclick = sfLiveStopRecordAudio;

        document.getElementById('sf-detail-close-btn').onclick = function () {
            closeModal('sf-detail-modal');
            sfStopCommentsListener();
            sfStopDetailMedia(); // para qualquer áudio/vídeo que tenha ficado tocando (legenda em áudio, etc.)
            sfLiveLeaveIfViewing(); // sai da live se eu estava só assistindo (anfitrião continua no ar em segundo plano)
        };
        document.getElementById('sf-detail-del-btn').onclick = function () { if (sfDetailPostId) sfDeletePost(sfDetailPostId, true); };
        document.getElementById('sf-detail-more-btn').onclick = function () {
            var p = sfPosts.find(function (x) { return x.id === sfDetailPostId; });
            if (p) sfOpenPostOptions(p);
        };
        document.getElementById('sf-detail-like-btn').onclick = function () { if (sfDetailPostId) sfToggleLike(sfDetailPostId); };
        document.getElementById('sf-detail-share-btn').onclick = function () {
            var p = sfPosts.find(function (x) { return x.id === sfDetailPostId; });
            if (p) sfOpenShareModal(p);
            else sfFetchAndSharePost(sfDetailPostId);
        };
        document.getElementById('sf-comment-send-btn').onclick = sfSubmitComment;
        document.getElementById('sf-comment-input').onkeydown = function (e) { if (e.key === 'Enter') sfSubmitComment(); };

        document.getElementById('sf-share-cancel').onclick = function () { closeModal('sf-share-modal'); };
        document.getElementById('sf-share-submit').onclick = sfDoShare;

        document.getElementById('sf-opt-hide').onclick = function () {
            if (!sfOptionsPost) return;
            var id = sfOptionsPost.id;
            closeModal('sf-post-options-modal');
            sfHidePost(id);
            sfOptionsPost = null;
        };
        document.getElementById('sf-opt-block').onclick = function () {
            if (!sfOptionsPost) return;
            var uid = sfOptionsPost.uid, nome = sfOptionsPost.nome;
            closeModal('sf-post-options-modal');
            sfBlockUser(uid, nome);
            sfOptionsPost = null;
        };
        document.getElementById('sf-opt-cancel').onclick = function () { closeModal('sf-post-options-modal'); sfOptionsPost = null; };

        sfInitDrag();
    }

    // ══════════════════════════════════════════════════════════════════
    //  FIRESTORE — feed
    // ══════════════════════════════════════════════════════════════════
    function sfListenPosts() {
        if (sfPostsUnsub) sfPostsUnsub();
        sfPostsUnsub = db.collection('social_posts').orderBy('createdAt', 'desc').limit(150)
            .onSnapshot(function (snap) {
                sfPosts = [];
                snap.forEach(function (d) { sfPosts.push(Object.assign({ id: d.id }, d.data())); });
                sfEnsurePinnedPostLoaded();
                if (sfIndex >= sfVisiblePosts().length) sfIndex = 0;
                sfRenderCarousel();
                if (sfDetailPostId) sfRefreshDetailIfOpen();
            }, function (err) { console.error('social feed:', err); });
    }

    function sfVisiblePosts() {
        var list = sfPosts.filter(function (p) {
            if (sfHiddenPosts.indexOf(p.id) !== -1) return false;
            if (sfBlockedUsers.indexOf(p.uid) !== -1) return false;
            return true;
        });
        if (sfMode === 'mine') return list.filter(function (p) { return me && p.uid === me.uid; });

        // Postagem em destaque (definida no painel administrativo): some
        // pro topo da lista, sem mudar a ordem "mais recentes primeiro"
        // das demais — as outras continuam exatamente na mesma sequência,
        // só a fixada "pula a fila".
        if (sfPinnedActive()) {
            var pid = sfPinned.postId;
            var rest = list.filter(function (p) { return p.id !== pid; });
            var pinnedObj = list.filter(function (p) { return p.id === pid; })[0];
            if (!pinnedObj && sfPinnedPost && sfPinnedPost.id === pid &&
                sfHiddenPosts.indexOf(pid) === -1 && sfBlockedUsers.indexOf(sfPinnedPost.uid) === -1) {
                pinnedObj = sfPinnedPost;
            }
            if (pinnedObj) return [pinnedObj].concat(rest);
        }
        return sfApplyLivePriority(list);
    }

    // ── Prioridade das LIVES ativas: quanto mais reconhecimento/comentário
    //    a live recebe, mais ela sobe no feed — mas nunca acima da postagem
    //    fixada pelo admin (essa já "pulou a fila" acima, antes de chegar
    //    aqui). As demais postagens continuam na ordem cronológica normal,
    //    só as lives ao vivo são reordenadas pra frente entre elas. ──
    function sfLiveScore(p) {
        return (p.likes || 0) + (p.commentsCount || 0) * 2;
    }
    function sfApplyLivePriority(list) {
        var liveActive = [];
        var rest = [];
        list.forEach(function (p) {
            if (p.type === 'live' && p.liveState && p.liveState.status === 'live') liveActive.push(p);
            else rest.push(p);
        });
        if (!liveActive.length) return list;
        liveActive.sort(function (a, b) { return sfLiveScore(b) - sfLiveScore(a); });
        return liveActive.concat(rest);
    }

    // ══════════════════════════════════════════════════════════════════
    //  DESTAQUE ADMINISTRATIVO — lê social_config/pinned (escrito pelo
    //  painel.html) e mantém a postagem escolhida sempre em primeiro no
    //  feed enquanto estiver dentro do prazo definido pelo admin.
    // ══════════════════════════════════════════════════════════════════
    function sfPinnedActive() {
        if (!sfPinned || !sfPinned.postId) return false;
        if (sfPinned.expiresAt && sfPinned.expiresAt <= Date.now()) return false;
        return true;
    }

    function sfEnsurePinnedPostLoaded() {
        if (!sfPinnedActive()) { sfPinnedPost = null; sfRenderCarousel(); return; }
        var pid = sfPinned.postId;
        var inCache = sfPosts.filter(function (p) { return p.id === pid; })[0];
        if (inCache) { sfPinnedPost = null; sfRenderCarousel(); return; }
        db.collection('social_posts').doc(pid).get().then(function (doc) {
            sfPinnedPost = doc.exists ? Object.assign({ id: doc.id }, doc.data()) : null;
            sfRenderCarousel();
        }).catch(function () { sfPinnedPost = null; });
    }

    function sfListenPinnedConfig() {
        if (sfPinnedUnsub) sfPinnedUnsub();
        sfPinnedUnsub = db.collection('social_config').doc('pinned')
            .onSnapshot(function (doc) {
                sfPinned = doc.exists ? doc.data() : null;
                sfEnsurePinnedPostLoaded();
            }, function (err) { console.error('social pinned config:', err); });
    }

    // ══════════════════════════════════════════════════════════════════
    //  CARROSSEL — arraste horizontal (mesmo padrão do carrossel de ads)
    // ══════════════════════════════════════════════════════════════════
    function sfRelTime(ts) {
        var diff = Date.now() - (ts || 0);
        var m = Math.floor(diff / 60000);
        if (m < 1) return 'agora';
        if (m < 60) return m + 'min';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h';
        var d = Math.floor(h / 24);
        if (d < 7) return d + 'd';
        return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }

    function sfCardMediaHtml(p) {
        if (p.type !== 'image' && p.type !== 'image_audio') return '';
        if (p.mediaData) return '<div class="sf-card-media"><img src="' + p.mediaData + '" alt=""></div>';
        if (p.mediaId) return '<div class="sf-card-media" data-media-id="' + p.mediaId + '" data-post-id="' + p.id + '"><div class="sf-media-loading">Carregando...</div></div>';
        return '';
    }
    // ── Miniatura do card de uma LIVE: capa escolhida pelo anfitrião (foto
    //    tirada na hora ou da galeria) OU, se ele não escolheu nenhuma, a
    //    própria foto de perfil como já acontecia + badge "AO VIVO"/
    //    "Encerrada" + contador de espectadores (enquanto ativa). ──
    function sfCardLiveThumbHtml(p) {
        var ls = p.liveState || {};
        var isActive = ls.status === 'live';
        var hasCover = !!(p.coverData || p.coverId);
        var coverHtml = p.coverData
            ? '<img src="' + p.coverData + '" alt="">'
            : (p.coverId ? '<div class="sf-media-loading" data-live-cover-id="' + p.coverId + '" data-live-cover-post="' + p.id + '">Carregando...</div>' : '');
        return (
            '<div class="sf-card-live-thumb' + (hasCover ? ' has-cover' : '') + '">' +
                (hasCover ? coverHtml : ('<div class="sf-avatar">' + avInner(p.nome, p.foto) + '</div>')) +
                '<div class="sf-card-live-badge"><span class="sf-live-dot' + (isActive ? '' : ' ended') + '"></span>' + (isActive ? 'AO VIVO' : 'ENCERRADA') + '</div>' +
                (isActive ? '<div class="sf-live-viewers-chip"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' + (ls.viewerCount || 0) + '</div>' : '') +
                (!isActive ? '<div class="sf-card-live-ended-label">Esta transmissão foi encerrada</div>' : '') +
            '</div>'
        );
    }
    function sfCardAudioHtml(p) {
        if (p.type !== 'audio' && p.type !== 'image_audio') return '';
        if (p.audioData) {
            var ap = buildAudioPlayer(p.audioData);
            return '<div class="sf-card-audio" onclick="event.stopPropagation()">' + ap.html + '</div>';
        }
        if (p.audioId) return '<div class="sf-card-audio" data-audio-id="' + p.audioId + '" data-post-audio="' + p.id + '" onclick="event.stopPropagation()"><div class="sf-media-loading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Carregando áudio...</div></div>';
        return '';
    }
    // Ativa (apMount) todos os players estilizados .audio-player que ainda não
    // foram inicializados dentro do container informado (evita registrar o
    // mesmo player mais de uma vez em apInstances).
    function sfMountAudioPlayers(container) {
        if (!container) return;
        container.querySelectorAll('.audio-player').forEach(function (el) {
            if (el.dataset.mounted) return;
            el.dataset.mounted = '1';
            apMount(el.id);
        });
    }

    // ── Detecta links (http://, https:// ou "www.") dentro da legenda de uma
    // publicação/comentário e os transforma em links clicáveis, mantendo o
    // resto do texto normalmente escapado (sem abrir brecha de HTML/XSS).
    // Pontuação comum de fim de frase (. , ! ? : ; ) ] " ') colada no final
    // do link é destacada para fora dele, pra não incluir sem querer um
    // ponto final ou vírgula dentro da URL.
    var SF_URL_REGEX = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
    function sfLinkify(text) {
        var str = String(text || '');
        if (!str) return '';
        var re = new RegExp(SF_URL_REGEX.source, 'gi');
        var result = '';
        var lastIndex = 0;
        var match;
        while ((match = re.exec(str)) !== null) {
            var url = match[0];
            var trailing = '';
            while (url.length && /[.,!?:;)\]"']/.test(url.charAt(url.length - 1))) {
                trailing = url.charAt(url.length - 1) + trailing;
                url = url.slice(0, -1);
            }
            if (!url) continue; // sobrou só pontuação, não é link de verdade
            var href = /^https?:\/\//i.test(url) ? url : ('https://' + url);
            // Passa pela página intersticial de anúncio (redirect.html) antes
            // do destino final — buildAdGateUrl() vem de index.html, que
            // carrega antes deste arquivo (ver comentário no fim de index.html).
            var gateHref = (typeof buildAdGateUrl === 'function') ? buildAdGateUrl(href) : href;
            result += esc(str.slice(lastIndex, match.index));
            result += '<a class="sf-link" href="' + esc(gateHref) + '" target="_blank" rel="noopener noreferrer nofollow" onclick="event.stopPropagation()">' + esc(url) + '</a>';
            result += esc(trailing);
            lastIndex = match.index + match[0].length;
        }
        result += esc(str.slice(lastIndex));
        return result;
    }

    function sfCardHtml(p) {
        var isMine = !!(me && p.uid === me.uid);
        var likedByMe = !!(me && p.likedBy && p.likedBy.indexOf(me.uid) !== -1);
        var isLive = (p.type === 'live');
        var mediaHtml = isLive ? sfCardLiveThumbHtml(p) : sfCardMediaHtml(p);
        var audioHtml = sfCardAudioHtml(p);
        var hasMedia = !!(mediaHtml || audioHtml);
        var audioOnly = (p.type === 'audio'); // só áudio, sem imagem — não deve esticar a caixa
        var comboType = (p.type === 'image_audio'); // imagem + áudio (+ legenda) — imagem é prioridade, áudio/legenda ficam menores mas sempre visíveis
        var textBlock = '';
        if (hasMedia) {
            if (p.text) textBlock = '<div class="sf-card-caption">' + sfLinkify(p.text) + '</div>';
        } else {
            textBlock = '<div class="sf-card-text sf-textonly">' + sfLinkify(p.text || '') + '</div>';
        }
        return (
            '<div class="sf-card" data-id="' + p.id + '">' +
                '<div class="sf-card-head">' +
                    '<div class="sf-head-click" data-profile="' + esc(p.uid || '') + '" data-profile-name="' + esc(p.nome || '') + '" title="Ver perfil">' +
                        '<div class="sf-avatar' + (sfSpotlightTop3.indexOf(p.uid) !== -1 ? ' sf-spotlight' : '') + '">' + avInner(p.nome, p.foto) + '</div>' +
                        '<div class="sf-head-info"><div class="sf-namewrap"><div class="sf-name">' + esc(p.nome || 'Usuário') + '</div>' + sfBadgeHtml(p.uid) + '</div><div class="sf-time">' + sfRelTime(p.createdAt) + '</div></div>' +
                    '</div>' +
                    (!isMine && me ? sfRecognizeBtnHtml(p.uid, p.nome) : '') +
                    (isMine ? '<button class="sf-del-btn" data-del="' + p.id + '" title="Excluir postagem"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>' : '<button class="sf-more-btn" data-more="' + p.id + '" title="Mais opções">⋯</button>') +
                '</div>' +
                '<div class="sf-card-body' + (audioOnly ? ' sf-card-body-audio' : '') + (comboType ? ' sf-card-body-combo' : '') + '" data-open="' + p.id + '">' + mediaHtml + audioHtml + textBlock + '</div>' +
                '<div class="sf-actions">' +
                    '<button class="sf-act-btn' + (likedByMe ? ' liked' : '') + '" data-like="' + p.id + '">' + (likedByMe ? '<svg class="icon icon-fill icon-like-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg class="icon icon-like-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>') + ' <span>' + (p.likes || 0) + '</span></button>' +
                    '<button class="sf-act-btn" data-comment="' + p.id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg> <span>' + (p.commentsCount || 0) + '</span></button>' +
                    '<button class="sf-act-btn" data-share="' + p.id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> <span>' + (p.sharesCount || 0) + '</span></button>' +
                '</div>' +
            '</div>'
        );
    }

    function sfRenderCarousel() {
        var dots  = document.getElementById('sf-dots');
        if (!dots) return;   // seção ainda não montada no DOM
        var track = document.getElementById('sf-track'); // pode ser null se estado vazio substituiu o wrap
        var list = sfVisiblePosts();

        if (!list.length) {
            if (track) track.innerHTML = ''; // guard: track pode já ter sido removido pelo estado vazio anterior
            dots.innerHTML = '';
            var wrap = document.querySelector('.sf-carousel-wrap');
            wrap.innerHTML = '<div class="sf-empty"><div class="sf-empty-ic"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>' +
                (sfMode === 'mine' ? 'Você ainda não publicou nada.<br>Toque em <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Postar para começar.' : 'Nenhuma postagem ainda.<br>Seja o primeiro a postar!') +
                '</div>';
            return;
        }
        // Se o wrap foi substituído pelo estado vazio antes, recria a track
        // junto com as setas de navegação (usadas só no PC — no celular o
        // arraste continua funcionando do mesmo jeito, sem mudanças).
        var wrap = document.querySelector('.sf-carousel-wrap');
        if (!document.getElementById('sf-track')) {
            wrap.innerHTML =
                '<button class="sf-arrow prev" id="sf-arrow-prev" title="Postagem anterior" aria-label="Postagem anterior">‹</button>' +
                '<div class="sf-track" id="sf-track"></div>' +
                '<button class="sf-arrow next" id="sf-arrow-next" title="Próxima postagem" aria-label="Próxima postagem">›</button>';
            track = document.getElementById('sf-track');
        }

        if (sfIndex >= list.length) sfIndex = list.length - 1;
        if (sfIndex < 0) sfIndex = 0;

        track.innerHTML = list.map(sfCardHtml).join('');
        track.style.transform = 'translateX(-' + (sfIndex * 100) + '%)';
        dots.innerHTML = list.map(function (_, i) { return '<div class="sf-dot' + (i === sfIndex ? ' on' : '') + '"></div>'; }).join('');

        sfBindCardActions(track);
        sfMountAudioPlayers(track);
        sfLazyLoadAround(list);
        sfWireArrows(list.length);
        sfUpdateArrowState(list.length);
    }

    // Liga os cliques das setas ◂ ▸ (só existem/aparecem no PC via CSS —
    // no celular ficam com display:none e o arraste já funciona como antes).
    function sfWireArrows() {
        var prev = document.getElementById('sf-arrow-prev');
        var next = document.getElementById('sf-arrow-next');
        if (prev && !prev.dataset.wired) {
            prev.dataset.wired = '1';
            prev.onclick = function (e) { e.stopPropagation(); sfGoTo(sfIndex - 1); };
        }
        if (next && !next.dataset.wired) {
            next.dataset.wired = '1';
            next.onclick = function (e) { e.stopPropagation(); sfGoTo(sfIndex + 1); };
        }
    }

    // Esconde a seta ◂ no primeiro post, a ▸ no último, e ambas se só
    // houver 1 postagem (nada pra navegar).
    function sfUpdateArrowState(total) {
        var prev = document.getElementById('sf-arrow-prev');
        var next = document.getElementById('sf-arrow-next');
        if (prev) prev.classList.toggle('hide', total <= 1 || sfIndex <= 0);
        if (next) next.classList.toggle('hide', total <= 1 || sfIndex >= total - 1);
    }

    function sfBindCardActions(track) {
        track.querySelectorAll('[data-open]').forEach(function (el) {
            el.onclick = function () { sfOpenPostDetail(el.getAttribute('data-open')); };
        });
        track.querySelectorAll('[data-del]').forEach(function (el) {
            el.onclick = function (e) { e.stopPropagation(); sfDeletePost(el.getAttribute('data-del'), false); };
        });
        track.querySelectorAll('[data-more]').forEach(function (el) {
            el.onclick = function (e) {
                e.stopPropagation();
                var p = sfPosts.find(function (x) { return x.id === el.getAttribute('data-more'); });
                if (p) sfOpenPostOptions(p);
            };
        });
        track.querySelectorAll('[data-like]').forEach(function (el) {
            el.onclick = function (e) { e.stopPropagation(); sfToggleLike(el.getAttribute('data-like')); };
        });
        track.querySelectorAll('[data-comment]').forEach(function (el) {
            el.onclick = function (e) { e.stopPropagation(); sfOpenPostDetail(el.getAttribute('data-comment'), true); };
        });
        track.querySelectorAll('[data-share]').forEach(function (el) {
            el.onclick = function (e) {
                e.stopPropagation();
                var p = sfPosts.find(function (x) { return x.id === el.getAttribute('data-share'); });
                if (p) sfOpenShareModal(p);
            };
        });
        track.querySelectorAll('[data-profile]').forEach(function (el) {
            el.onclick = function (e) {
                e.stopPropagation();
                var uid = el.getAttribute('data-profile');
                if (uid && typeof window.viewUserProfile === 'function') window.viewUserProfile(uid, el.getAttribute('data-profile-name'), e, true);
            };
        });
        track.querySelectorAll('[data-recognize]').forEach(function (el) {
            el.onclick = function (e) {
                e.stopPropagation();
                sfOpenRecognizeModal(el.getAttribute('data-recognize'), el.getAttribute('data-recognize-name'));
            };
        });
    }

    // Baixa (via chunks) a imagem do post atual e dos vizinhos, evitando
    // gastar banda com posts que o usuário ainda não viu.
    function sfLazyLoadAround(list) {
        [sfIndex - 1, sfIndex, sfIndex + 1].forEach(function (i) {
            if (i < 0 || i >= list.length) return;
            var p = list[i];
            var isImgType = (p.type === 'image' || p.type === 'image_audio');
            var isAudType = (p.type === 'audio' || p.type === 'image_audio');
            if (isImgType && !p.mediaData && p.mediaId && !sfLoadedImages[p.id]) {
                sfLoadedImages[p.id] = true;
                downloadChunks(p.mediaId).then(function (base64) {
                    var mediaEl = document.querySelector('.sf-card-media[data-post-id="' + p.id + '"]');
                    if (mediaEl) mediaEl.innerHTML = '<img src="' + base64 + '" alt="">';
                }).catch(function () {
                    sfLoadedImages[p.id] = false;
                    var mediaEl = document.querySelector('.sf-card-media[data-post-id="' + p.id + '"]');
                    if (mediaEl) mediaEl.innerHTML = '<div class="sf-media-loading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Erro ao carregar</div>';
                });
            }
            if (p.type === 'live' && !p.coverData && p.coverId && !sfLoadedCovers[p.id]) {
                sfLoadedCovers[p.id] = true;
                downloadChunks(p.coverId).then(function (base64) {
                    var coverEl = document.querySelector('.sf-card-live-thumb [data-live-cover-post="' + p.id + '"]');
                    if (coverEl) coverEl.outerHTML = '<img src="' + base64 + '" alt="">';
                }).catch(function () {
                    sfLoadedCovers[p.id] = false;
                });
            }
            if (isAudType && !p.audioData && p.audioId && !sfLoadedAudios[p.id]) {
                sfLoadedAudios[p.id] = true;
                downloadChunks(p.audioId).then(function (base64) {
                    var audioEl = document.querySelector('.sf-card-audio[data-post-audio="' + p.id + '"]');
                    if (audioEl) {
                        var ap = buildAudioPlayer(base64);
                        audioEl.innerHTML = ap.html;
                        apMount(ap.id);
                        audioEl.querySelector('.audio-player').dataset.mounted = '1';
                    }
                }).catch(function () {
                    sfLoadedAudios[p.id] = false;
                    var audioEl = document.querySelector('.sf-card-audio[data-post-audio="' + p.id + '"]');
                    if (audioEl) audioEl.innerHTML = '<div class="sf-media-loading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Erro ao carregar</div>';
                });
            }
        });
    }

    function sfGoTo(idx) {
        var list = sfVisiblePosts();
        if (!list.length) return;
        sfIndex = Math.max(0, Math.min(idx, list.length - 1));
        var track = document.getElementById('sf-track');
        if (track) track.style.transform = 'translateX(-' + (sfIndex * 100) + '%)';
        document.querySelectorAll('.sf-dot').forEach(function (d, i) { d.classList.toggle('on', i === sfIndex); });
        sfUpdateArrowState(list.length);
        sfLazyLoadAround(list);
    }

    function sfInitDrag() {
        var wrap = document.querySelector('.sf-carousel-wrap');
        if (!wrap) return;
        var dragging = false, startX = 0, currentX = 0, startTranslate = 0, widthPx = 0;

        function down(x) {
            var list = sfVisiblePosts();
            if (list.length <= 1) return;
            var track = document.getElementById('sf-track');
            if (!track) return;
            dragging = true; startX = x; currentX = x;
            widthPx = wrap.getBoundingClientRect().width || 1;
            startTranslate = -sfIndex * widthPx;
            track.classList.add('dragging');
        }
        function move(x) {
            if (!dragging) return;
            currentX = x;
            var track = document.getElementById('sf-track');
            if (track) track.style.transform = 'translateX(' + (startTranslate + (currentX - startX)) + 'px)';
        }
        function up() {
            if (!dragging) return;
            dragging = false;
            var track = document.getElementById('sf-track');
            if (track) track.classList.remove('dragging');
            var delta = currentX - startX;
            var threshold = widthPx * 0.18;
            if (delta < -threshold) sfGoTo(sfIndex + 1);
            else if (delta > threshold) sfGoTo(sfIndex - 1);
            else sfGoTo(sfIndex);
        }

        wrap.addEventListener('touchstart', function (e) { if (e.target.closest('.sf-arrow')) return; down(e.touches[0].clientX); }, { passive: true });
        wrap.addEventListener('touchmove',  function (e) { move(e.touches[0].clientX); }, { passive: true });
        wrap.addEventListener('touchend',   function () { up(); });
        wrap.addEventListener('mousedown', function (e) { if (e.target.closest('.sf-arrow')) return; e.preventDefault(); down(e.clientX); });
        window.addEventListener('mousemove', function (e) { if (dragging) move(e.clientX); });
        window.addEventListener('mouseup',   function () { if (dragging) up(); });
    }

    // ══════════════════════════════════════════════════════════════════
    //  NOVA POSTAGEM
    // ══════════════════════════════════════════════════════════════════
    function sfOpenNewPostModal() {
        document.getElementById('sf-new-text').value = '';
        sfPendingImage = null;
        sfPendingAudio = null;
        if (sfAudioRec.isRecording) sfStopRecordAudio();
        sfUpdateNewPreview();
        sfUpdateNewAudioPreview();
        openModal('sf-new-post-modal');
    }
    function sfUpdateNewPreview() {
        var wrap = document.getElementById('sf-new-preview');
        var img  = document.getElementById('sf-new-preview-img');
        if (sfPendingImage) { img.src = sfPendingImage.base64; wrap.classList.add('show'); }
        else { img.src = ''; wrap.classList.remove('show'); }
    }
    function sfHandleNewPhoto(e) {
        var file = e.target.files[0]; e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { notify('Escolha uma imagem', 'warn'); return; }
        var reader = new FileReader();
        reader.onload = async function (ev) {
            var resized = await resizeImageBase64(ev.target.result, 1080, 0.78);
            sfPendingImage = { base64: resized, mimeType: 'image/jpeg' };
            sfUpdateNewPreview();
        };
        reader.readAsDataURL(file);
    }

    // ── Foto tirada na hora, usando a MESMA câmera do app (index.html) ──
    // openCamera('photo','social') abre o #cam-modal por cima do modal de
    // nova postagem; ao capturar, index.html chama window.sfOnPhotoCaptured
    // em vez de tratar a foto como anexo de chat/status/perfil.
    window.sfOnPhotoCaptured = async function (base64) {
        try {
            var resized = (typeof resizeImageBase64 === 'function') ? await resizeImageBase64(base64, 1080, 0.78) : base64;
            sfPendingImage = { base64: resized, mimeType: 'image/jpeg' };
            sfUpdateNewPreview();
            if (!document.getElementById('sf-new-post-modal').classList.contains('open')) openModal('sf-new-post-modal');
        } catch (e) { notify('Erro ao processar a foto', 'err'); }
    };

    // ── Áudio: gravar na hora (mesma ideia do gravador do chat, porém
    //    independente, para não interferir no estado de gravação do chat) ──
    function sfUpdateNewAudioPreview() {
        var wrap   = document.getElementById('sf-new-audio-preview');
        var player = document.getElementById('sf-new-audio-player');
        if (sfPendingAudio) { player.src = sfPendingAudio.base64; wrap.classList.add('show'); }
        else { player.src = ''; wrap.classList.remove('show'); }
    }
    function sfHandleNewAudioFile(e) {
        var file = e.target.files[0]; e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('audio/')) { notify('Escolha um arquivo de áudio', 'warn'); return; }
        if (file.size > 15 * 1024 * 1024) { notify('Áudio muito grande (máx. 15MB)', 'warn'); return; }
        var reader = new FileReader();
        reader.onload = function (ev) {
            sfPendingAudio = { base64: ev.target.result, mimeType: file.type || 'audio/mpeg' };
            sfUpdateNewAudioPreview();
        };
        reader.readAsDataURL(file);
    }
    async function sfStartRecordAudio() {
        if (sfAudioRec.isRecording) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            notify('Gravação de áudio não é suportada neste navegador', 'warn'); return;
        }
        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
            sfAudioRec.stream = stream;
            sfAudioRec.chunks = [];
            var options = {};
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
            else if (MediaRecorder.isTypeSupported('audio/mp4')) options.mimeType = 'audio/mp4';
            sfAudioRec.recorder = new MediaRecorder(stream, options);
            sfAudioRec.startTime = Date.now();
            sfAudioRec.isRecording = true;
            sfAudioRec.recorder.ondataavailable = function (ev) { if (ev.data.size > 0) sfAudioRec.chunks.push(ev.data); };
            sfAudioRec.recorder.onstop = function () {
                sfAudioRec.isRecording = false;
                var mimeType = sfAudioRec.recorder.mimeType || 'audio/webm';
                var blob = new Blob(sfAudioRec.chunks, { type: mimeType });
                var reader = new FileReader();
                reader.onload = function (ev) {
                    sfPendingAudio = { base64: ev.target.result, mimeType: mimeType };
                    sfUpdateNewAudioPreview();
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(function (t) { t.stop(); });
                var bar = document.getElementById('sf-new-rec-bar');
                if (bar) bar.classList.remove('show');
                if (sfAudioRec.timer) clearInterval(sfAudioRec.timer);
            };
            sfAudioRec.recorder.start();
            var bar = document.getElementById('sf-new-rec-bar');
            if (bar) bar.classList.add('show');
            sfAudioRec.timer = setInterval(sfUpdateRecTime, 500);
            sfAudioRec.timeoutId = setTimeout(function () { if (sfAudioRec.isRecording) sfStopRecordAudio(); }, 120000); // 2min no máx.
        } catch (err) {
            notify('Microfone não permitido: ' + err.message, 'err');
            sfAudioRec.isRecording = false;
        }
    }
    function sfUpdateRecTime() {
        var el = document.getElementById('sf-new-rec-time');
        if (!el) return;
        var s = Math.floor((Date.now() - sfAudioRec.startTime) / 1000);
        var mm = String(Math.floor(s / 60)).padStart(2, '0');
        var ss = String(s % 60).padStart(2, '0');
        el.textContent = mm + ':' + ss;
    }
    function sfStopRecordAudio() {
        if (sfAudioRec.timeoutId) clearTimeout(sfAudioRec.timeoutId);
        if (sfAudioRec.recorder && sfAudioRec.recorder.state !== 'inactive') sfAudioRec.recorder.stop();
    }
    // ══════════════════════════════════════════════════════════════════
    //  LIVE — transmissão ao vivo na Comunidade
    //  (câmera do anfitrião → N espectadores, via WebRTC + sinalização
    //  pelo Firestore, exatamente como a Live do chat — só que a
    //  sinalização mora dentro do próprio post: social_posts/{postId}
    //  /viewers/{uid} e /peers/{viewerUid}, com suas subcoleções de ICE
    //  candidates em cada sentido. Isso faz a live aparecer e se
    //  comportar como uma publicação normal no feed.)
    // ══════════════════════════════════════════════════════════════════
    function sfLivePostRef(postId) {
        return db.collection('social_posts').doc(postId || sfLiveActivePostId);
    }

    // ── Modal "Iniciar Live" (legenda + áudio opcional, igual à nova postagem) ──
    function sfOpenLiveNewModal() {
        if (!me) return;
        if (sfLiveActivePostId) { notify('Você já está numa live. Encerre ou saia dela antes de iniciar outra.', 'warn'); return; }
        document.getElementById('sf-live-new-text').value = '';
        sfLivePendingAudio = null;
        sfLivePendingCover = null;
        sfUpdateLiveAudioPreview();
        sfUpdateLiveCoverPreview();
        openModal('sf-live-new-modal');
    }

    // ── Capa da live (opcional): tirar foto na hora ou escolher da galeria.
    //    Se o usuário não escolher nenhuma, a publicação usa a foto de
    //    perfil como capa, exatamente como já acontecia antes. ──
    function sfUpdateLiveCoverPreview() {
        var wrap = document.getElementById('sf-live-new-cover-preview');
        var img  = document.getElementById('sf-live-new-cover-preview-img');
        if (sfLivePendingCover) { img.src = sfLivePendingCover.base64; wrap.classList.add('show'); }
        else { img.src = ''; wrap.classList.remove('show'); }
    }
    function sfHandleLiveCoverPhoto(e) {
        var file = e.target.files[0]; e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) { notify('Escolha uma imagem', 'warn'); return; }
        var reader = new FileReader();
        reader.onload = async function (ev) {
            var resized = await resizeImageBase64(ev.target.result, 1080, 0.78);
            sfLivePendingCover = { base64: resized, mimeType: 'image/jpeg' };
            sfUpdateLiveCoverPreview();
        };
        reader.readAsDataURL(file);
    }
    // openCamera('photo','social_live_cover') abre o #cam-modal por cima do
    // modal de "Iniciar Live"; ao capturar, index.html chama esta função em
    // vez de tratar a foto como anexo de chat/status/perfil/postagem normal.
    window.sfOnLiveCoverCaptured = async function (base64) {
        try {
            var resized = (typeof resizeImageBase64 === 'function') ? await resizeImageBase64(base64, 1080, 0.78) : base64;
            sfLivePendingCover = { base64: resized, mimeType: 'image/jpeg' };
            sfUpdateLiveCoverPreview();
            if (!document.getElementById('sf-live-new-modal').classList.contains('open')) openModal('sf-live-new-modal');
        } catch (e) { notify('Erro ao processar a foto', 'err'); }
    };

    function sfUpdateLiveAudioPreview() {
        var wrap = document.getElementById('sf-live-new-audio-preview');
        var player = document.getElementById('sf-live-new-audio-player');
        if (sfLivePendingAudio) { player.src = sfLivePendingAudio.base64; wrap.classList.add('show'); }
        else { player.src = ''; wrap.classList.remove('show'); }
    }
    function sfHandleLiveAudioFile(e) {
        var file = e.target.files[0]; e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('audio/')) { notify('Escolha um arquivo de áudio', 'warn'); return; }
        if (file.size > 15 * 1024 * 1024) { notify('Áudio muito grande (máx. 15MB)', 'warn'); return; }
        var reader = new FileReader();
        reader.onload = function (ev) {
            sfLivePendingAudio = { base64: ev.target.result, mimeType: file.type || 'audio/mpeg' };
            sfUpdateLiveAudioPreview();
        };
        reader.readAsDataURL(file);
    }
    async function sfLiveStartRecordAudio() {
        if (sfLiveAudioRec.isRecording) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            notify('Gravação de áudio não é suportada neste navegador', 'warn'); return;
        }
        try {
            var stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
            sfLiveAudioRec.stream = stream;
            sfLiveAudioRec.chunks = [];
            var options = {};
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) options.mimeType = 'audio/webm;codecs=opus';
            else if (MediaRecorder.isTypeSupported('audio/mp4')) options.mimeType = 'audio/mp4';
            sfLiveAudioRec.recorder = new MediaRecorder(stream, options);
            sfLiveAudioRec.startTime = Date.now();
            sfLiveAudioRec.isRecording = true;
            sfLiveAudioRec.recorder.ondataavailable = function (ev) { if (ev.data.size > 0) sfLiveAudioRec.chunks.push(ev.data); };
            sfLiveAudioRec.recorder.onstop = function () {
                sfLiveAudioRec.isRecording = false;
                var mimeType = sfLiveAudioRec.recorder.mimeType || 'audio/webm';
                var blob = new Blob(sfLiveAudioRec.chunks, { type: mimeType });
                var reader = new FileReader();
                reader.onload = function (ev) {
                    sfLivePendingAudio = { base64: ev.target.result, mimeType: mimeType };
                    sfUpdateLiveAudioPreview();
                };
                reader.readAsDataURL(blob);
                stream.getTracks().forEach(function (t) { t.stop(); });
                var bar = document.getElementById('sf-live-new-rec-bar');
                if (bar) bar.classList.remove('show');
                if (sfLiveAudioRec.timer) clearInterval(sfLiveAudioRec.timer);
            };
            sfLiveAudioRec.recorder.start();
            var bar = document.getElementById('sf-live-new-rec-bar');
            if (bar) bar.classList.add('show');
            sfLiveAudioRec.timer = setInterval(sfUpdateLiveRecTime, 500);
            sfLiveAudioRec.timeoutId = setTimeout(function () { if (sfLiveAudioRec.isRecording) sfLiveStopRecordAudio(); }, 120000); // 2min no máx.
        } catch (err) {
            notify('Microfone não permitido: ' + err.message, 'err');
            sfLiveAudioRec.isRecording = false;
        }
    }
    function sfUpdateLiveRecTime() {
        var el = document.getElementById('sf-live-new-rec-time');
        if (!el) return;
        var s = Math.floor((Date.now() - sfLiveAudioRec.startTime) / 1000);
        el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
    function sfLiveStopRecordAudio() {
        if (sfLiveAudioRec.timeoutId) clearTimeout(sfLiveAudioRec.timeoutId);
        if (sfLiveAudioRec.recorder && sfLiveAudioRec.recorder.state !== 'inactive') sfLiveAudioRec.recorder.stop();
    }

    // ── Iniciar a live de verdade: pede câmera/mic, cria o post (type:
    //    'live') e abre o detalhe já no papel de anfitrião. ──
    async function sfConfirmStartLive() {
        if (!me) return;
        if (sfLiveActivePostId) { notify('Você já está numa live. Encerre ou saia dela antes de iniciar outra.', 'warn'); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { notify('Seu navegador não tem suporte a transmissão ao vivo', 'err'); return; }
        if (!mediaPermAllowed('mic') || !mediaPermAllowed('cam')) return;
        if (sfLiveAudioRec.isRecording) { notify('Termine ou pare a gravação antes de iniciar', 'warn'); return; }
        var text = document.getElementById('sf-live-new-text').value.trim().slice(0, 500);
        var btn = document.getElementById('sf-live-new-start');
        btn.disabled = true; btn.textContent = 'Iniciando...';
        var stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: CALL_AUDIO_CONSTRAINTS, video: { facingMode: 'user' } });
        } catch (e) {
            notify('Não foi possível acessar a câmera/microfone: ' + friendlyError(e), 'err');
            btn.disabled = false; btn.textContent = 'Iniciar Live';
            return;
        }
        try {
            var payload = {
                uid: me.uid, nome: me.nome, foto: me.foto || null,
                type: 'live', text: text, likes: 0, likedBy: [], commentsCount: 0, sharesCount: 0,
                createdAt: Date.now(),
                liveState: { status: 'live', hostUid: me.uid, hostName: me.nome, hostFoto: me.foto || null, startedAt: Date.now(), endedAt: null, camOn: true, micOn: true, viewerCount: 0 }
            };
            if (sfLivePendingAudio) {
                var ab64 = sfLivePendingAudio.base64;
                payload.audioMime = sfLivePendingAudio.mimeType || 'audio/webm';
                if (ab64.length <= SF_MAX_INLINE) { payload.audioData = ab64; }
                else {
                    var audioId = genMediaId();
                    payload.audioId = audioId;
                    notify('Publicando áudio em partes...', 'info', 8000);
                    await uploadChunks(ab64, audioId);
                }
            }
            if (sfLivePendingCover) {
                var cb64 = sfLivePendingCover.base64;
                if (cb64.length <= SF_MAX_INLINE) { payload.coverData = cb64; }
                else {
                    var coverId = genMediaId();
                    payload.coverId = coverId;
                    notify('Publicando capa em partes...', 'info', 8000);
                    await uploadChunks(cb64, coverId);
                }
            }
            var ref = await db.collection('social_posts').add(payload);
            sfLiveActivePostId = ref.id;
            sfLiveIsHost = true;
            sfLiveLocalStream = stream;
            sfLiveCamOn = true; sfLiveMicOn = true;
            sfLivePendingAudio = null;
            sfLivePendingCover = null;
            closeModal('sf-live-new-modal');
            sfMode = 'all';
            document.getElementById('sf-mine-toggle').classList.remove('on');
            document.getElementById('sf-community-toggle').classList.add('on');
            notify('Você está ao vivo!', 'ok');
            sfOpenPostDetail(ref.id);
            sfNotifyFriendsLiveStarted(Object.assign({ id: ref.id }, payload)); // avisa os amigos (não bloqueia a abertura da live)
        } catch (e) {
            stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e2) {} });
            notify('Erro ao iniciar live: ' + friendlyError(e), 'err');
        } finally {
            btn.disabled = false; btn.textContent = 'Iniciar Live';
        }
    }

    // ── Markup da área de vídeo no detalhe (ativa) ou do aviso de
    //    encerrada. Reconstruída só quando necessário (ver sfRenderDetail). ──
    function sfLiveDetailAreaHtml(p) {
        var ls = p.liveState || {};
        if (ls.status !== 'live') {
            var coverBg = p.coverData ? '<img class="sf-detail-live-ended-cover" src="' + p.coverData + '" alt="">' : '';
            return '<div class="sf-detail-live-area">' + coverBg + '<div class="sf-detail-live-ended"><div class="sf-avatar">' + avInner(p.nome, p.foto) + '</div><div>Esta transmissão foi encerrada' + (ls.endedAt ? (' há ' + sfRelTime(ls.endedAt)) : '') + '.</div></div></div>';
        }
        return (
            '<div class="sf-detail-live-area" id="sf-live-area">' +
                '<video id="sf-live-video" class="sf-detail-live-video" autoplay playsinline muted></video>' +
                '<div class="sf-live-camoff" id="sf-live-camoff"><div class="sf-avatar">' + avInner(p.nome, p.foto) + '</div><span>Câmera desligada</span></div>' +
                '<div class="sf-detail-live-badge"><span class="sf-live-dot"></span><span>AO VIVO</span></div>' +
                '<div class="sf-detail-live-viewers" id="sf-live-viewers-count"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>' + (ls.viewerCount || 0) + '</span></div>' +
                '<div class="sf-detail-live-controls" id="sf-live-controls"></div>' +
            '</div>'
        );
    }

    // ── Liga o vídeo/controles reais depois que o HTML acima entrou no DOM:
    //    anfitrião mostra sua própria câmera + controles de câmera/mic/
    //    encerrar; espectador entra na live (sfLiveJoin) e mostra som/volume. ──
    function sfLiveMountDetailArea(p) {
        var isHost = !!(me && p.liveState && p.liveState.hostUid === me.uid);
        var controls = document.getElementById('sf-live-controls');
        if (isHost) {
            sfLiveActivePostId = p.id;
            sfLiveIsHost = true;
            var video = document.getElementById('sf-live-video');
            if (video && sfLiveLocalStream) { video.muted = true; video.srcObject = sfLiveLocalStream; video.play().catch(function () {}); }
            if (controls) {
                controls.innerHTML =
                    '<button class="sf-live-ctl-btn' + (sfLiveCamOn ? '' : ' off') + '" id="sf-live-cam-btn" title="Câmera"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></button>' +
                    '<button class="sf-live-ctl-btn' + (sfLiveMicOn ? '' : ' off') + '" id="sf-live-mic-btn" title="Microfone"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>' +
                    '<button class="sf-live-ctl-btn end" id="sf-live-end-btn" title="Encerrar live"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/></svg></button>';
                document.getElementById('sf-live-cam-btn').onclick = sfLiveToggleCam;
                document.getElementById('sf-live-mic-btn').onclick = sfLiveToggleMic;
                document.getElementById('sf-live-end-btn').onclick = sfEndLive;
            }
            sfLiveUpdateCamOffOverlay(sfLiveCamOn);
            if (!sfLiveViewersUnsub) sfLiveWatchViewers(p.id);
        } else {
            sfLiveHostInfo = { uid: p.liveState.hostUid, nome: p.liveState.hostName, foto: p.liveState.hostFoto };
            sfLiveViewerMuted = false; // entra já com o som ativado — o espectador escolhe silenciar depois, pelo próprio ícone de som
            if (controls) {
                controls.innerHTML = sfLiveMuteBtnHtml();
                document.getElementById('sf-live-mute-btn').onclick = sfLiveToggleViewerMute;
            }
            sfLiveJoin(p.id);
        }
    }

    function sfLiveUpdateCamOffOverlay(camOn) {
        var overlay = document.getElementById('sf-live-camoff');
        if (overlay) overlay.classList.toggle('show', !camOn);
    }

    // ── Botão de som do espectador: troca o ícone inteiro (alto-falante com
    //    ondas = som ativo / alto-falante com X = mudo), não só a cor de
    //    fundo, pra ficar claro de olhar se está ativado ou não. ──
    function sfLiveMuteBtnHtml() {
        var icon = sfLiveViewerMuted
            ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
            : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
        var label = sfLiveViewerMuted ? 'Som desligado — toque para ativar' : 'Som ligado — toque para silenciar';
        return '<button class="sf-live-ctl-btn' + (sfLiveViewerMuted ? ' off' : '') + '" id="sf-live-mute-btn" title="' + label + '" aria-label="' + label + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + icon + '</svg></button>';
    }

    // ── ESPECTADOR: entra na live (presença + conexão WebRTC com o anfitrião) ──
    async function sfLiveJoin(postId) {
        if (!me) return;
        if (sfLiveIsHost) return; // sou o próprio anfitrião — nada a fazer aqui
        if (sfLivePeerConns.viewer && sfLiveActivePostId === postId) return; // já conectado a esta live nesta sessão
        sfLiveActivePostId = postId;
        var peerRef = sfLivePostRef(postId).collection('peers').doc(me.uid);
        var pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
        sfLivePeerConns.viewer = pc;

        pc.onicecandidate = function (e) { if (e.candidate) peerRef.collection('viewerCandidates').add(e.candidate.toJSON()).catch(function () {}); };
        pc.ontrack = function (e) {
            var vid = document.getElementById('sf-live-video');
            if (!vid) return;
            if (e.streams && e.streams[0]) vid.srcObject = e.streams[0];
            else {
                if (!(vid.srcObject instanceof MediaStream)) vid.srcObject = new MediaStream();
                vid.srcObject.addTrack(e.track);
            }
            vid.muted = sfLiveViewerMuted;
            vid.play().catch(function () {
                // Alguns navegadores bloqueiam autoplay com som (mesmo dentro de
                // um gesto do usuário, como abrir a live). Se tocar com som falhar,
                // cai pra mudo automaticamente e atualiza o ícone — a pessoa ainda
                // pode ativar o som na hora que quiser, tocando no próprio ícone.
                if (!vid.muted) {
                    vid.muted = true;
                    sfLiveViewerMuted = true;
                    sfLiveRefreshMuteBtn();
                    vid.play().catch(function () {});
                }
            });
        };
        pc.onconnectionstatechange = function () {
            if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && sfLiveActivePostId === postId && !sfLiveIsHost) {
                notify('Não foi possível conectar à transmissão.', 'warn');
            }
        };

        try {
            await sfLivePostRef(postId).collection('viewers').doc(me.uid).set({ uid: me.uid, nome: me.nome, foto: me.foto || null, joinedAt: Date.now(), active: true });
        } catch (e) { notify('Erro ao entrar na live: ' + friendlyError(e), 'err'); }

        sfLivePeerDocUnsub = peerRef.onSnapshot(async function (snap) {
            if (!snap.exists || sfLiveIsHost) return;
            var d = snap.data();
            if (d.offer && !pc.currentRemoteDescription) {
                try {
                    await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
                    var answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);
                    await peerRef.update({ answer: { type: answer.type, sdp: answer.sdp } });
                } catch (e) { console.warn('sf live: erro ao responder oferta do anfitrião', e); }
            }
        });
        sfLivePeerCandUnsubs.viewer = [ peerRef.collection('hostCandidates').onSnapshot(function (snap) {
            snap.docChanges().forEach(function (ch) {
                if (ch.type === 'added' && sfLivePeerConns.viewer) pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(function () {});
            });
        }) ];

        // Escuta o post em si: status (encerrada?) e câmera/mic do anfitrião.
        sfLivePostWatchUnsub = sfLivePostRef(postId).onSnapshot(function (snap) {
            if (!snap.exists) return;
            var d = snap.data();
            var ls = d.liveState || {};
            sfLiveUpdateCamOffOverlay(ls.camOn !== false);
            if (ls.status === 'ended') {
                notify('A live foi encerrada', 'info');
                sfStopDetailMedia(); // para o vídeo na hora — não deixa travado num último quadro
                sfLiveTeardown();
                // O espectador só sai da tela (não fica preso vendo o aviso de
                // "encerrada" dentro de um modal aberto): se o detalhe desta
                // live ainda está aberto, fecha ele igual ao botão de fechar.
                if (sfDetailPostId === postId && document.getElementById('sf-detail-modal').classList.contains('open')) {
                    closeModal('sf-detail-modal');
                    sfStopCommentsListener();
                } else {
                    sfRefreshDetailIfOpen();
                }
            }
        });
    }

    // ── ANFITRIÃO: escuta quem está assistindo e cria/derruba conexões ──
    function sfLiveWatchViewers(postId) {
        if (sfLiveViewersUnsub) sfLiveViewersUnsub();
        sfLiveViewersMap = {};
        sfLiveViewersUnsub = sfLivePostRef(postId).collection('viewers').onSnapshot(function (snap) {
            snap.docChanges().forEach(function (ch) {
                var uid = ch.doc.id;
                var d = ch.doc.data() || {};
                if (ch.type === 'removed' || d.active === false) {
                    delete sfLiveViewersMap[uid];
                    sfLiveCloseHostPeer(uid);
                } else {
                    sfLiveViewersMap[uid] = { nome: d.nome, foto: d.foto, joinedAt: d.joinedAt };
                    if (!sfLivePeerConns[uid]) sfLiveHostConnectToViewer(postId, uid);
                }
            });
            var count = Object.keys(sfLiveViewersMap).length;
            sfLivePostRef(postId).update({ 'liveState.viewerCount': count }).catch(function () {});
            var vcEl = document.getElementById('sf-live-viewers-count');
            if (vcEl) { var sp = vcEl.querySelector('span'); if (sp) sp.textContent = count; }
        }, function (err) { console.error('sf live viewers:', err); });
    }

    async function sfLiveHostConnectToViewer(postId, viewerUid) {
        var peerRef = sfLivePostRef(postId).collection('peers').doc(viewerUid);
        var pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS });
        sfLivePeerConns[viewerUid] = pc;

        // Transceivers criados de antemão (mesmo sem faixa ainda) pra
        // permitir ligar/desligar a câmera depois via replaceTrack sem
        // renegociar. Passar "streams" garante um msid válido no SDP —
        // sem isso, o "ontrack" do espectador chega sem stream associada.
        var streamsInit = sfLiveLocalStream ? { streams: [sfLiveLocalStream] } : {};
        var audioTx = pc.addTransceiver('audio', Object.assign({ direction: 'sendonly' }, streamsInit));
        var videoTx = pc.addTransceiver('video', Object.assign({ direction: 'sendonly' }, streamsInit));
        sfLivePeerVideoSenders[viewerUid] = videoTx.sender;
        if (sfLiveLocalStream) {
            var at = sfLiveLocalStream.getAudioTracks()[0]; if (at) audioTx.sender.replaceTrack(at).catch(function () {});
            var vt = sfLiveLocalStream.getVideoTracks()[0]; if (vt) videoTx.sender.replaceTrack(vt).catch(function () {});
        }

        pc.onicecandidate = function (e) { if (e.candidate) peerRef.collection('hostCandidates').add(e.candidate.toJSON()).catch(function () {}); };
        pc.onconnectionstatechange = function () {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') sfLiveCloseHostPeer(viewerUid);
        };

        try {
            var offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await peerRef.set({ offer: { type: offer.type, sdp: offer.sdp }, answer: null, createdAt: Date.now() });
        } catch (e) { console.warn('sf live: erro ao criar oferta para espectador', e); sfLiveCloseHostPeer(viewerUid); return; }

        var unsubs = [];
        unsubs.push(peerRef.onSnapshot(function (snap) {
            if (!snap.exists || !sfLivePeerConns[viewerUid]) return;
            var d = snap.data();
            if (d.answer && pc.signalingState !== 'stable') {
                pc.setRemoteDescription(new RTCSessionDescription(d.answer)).catch(function (e) { console.warn('sf live: setRemoteDescription (host) falhou', e); });
            }
        }));
        unsubs.push(peerRef.collection('viewerCandidates').onSnapshot(function (snap) {
            snap.docChanges().forEach(function (ch) {
                if (ch.type === 'added' && sfLivePeerConns[viewerUid]) pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(function () {});
            });
        }));
        sfLivePeerCandUnsubs[viewerUid] = unsubs;
    }

    function sfLiveCloseHostPeer(viewerUid) {
        var pc = sfLivePeerConns[viewerUid];
        if (pc) { try { pc.close(); } catch (e) {} delete sfLivePeerConns[viewerUid]; }
        delete sfLivePeerVideoSenders[viewerUid];
        var unsubs = sfLivePeerCandUnsubs[viewerUid];
        if (unsubs) { unsubs.forEach(function (u) { try { u(); } catch (e) {} }); delete sfLivePeerCandUnsubs[viewerUid]; }
    }

    // ── Controles do anfitrião durante a transmissão ──
    function sfLiveToggleCam() {
        if (!sfLiveIsHost || !sfLiveLocalStream) return;
        var t = sfLiveLocalStream.getVideoTracks()[0]; if (!t) return;
        sfLiveCamOn = !sfLiveCamOn; t.enabled = sfLiveCamOn;
        sfLivePostRef().update({ 'liveState.camOn': sfLiveCamOn }).catch(function () {});
        var btn = document.getElementById('sf-live-cam-btn'); if (btn) btn.classList.toggle('off', !sfLiveCamOn);
        sfLiveUpdateCamOffOverlay(sfLiveCamOn);
    }
    function sfLiveToggleMic() {
        if (!sfLiveIsHost || !sfLiveLocalStream) return;
        var t = sfLiveLocalStream.getAudioTracks()[0]; if (!t) return;
        sfLiveMicOn = !sfLiveMicOn; t.enabled = sfLiveMicOn;
        sfLivePostRef().update({ 'liveState.micOn': sfLiveMicOn }).catch(function () {});
        var btn = document.getElementById('sf-live-mic-btn'); if (btn) btn.classList.toggle('off', !sfLiveMicOn);
    }
    function sfLiveToggleViewerMute() {
        sfLiveViewerMuted = !sfLiveViewerMuted;
        var vid = document.getElementById('sf-live-video');
        if (vid) { vid.muted = sfLiveViewerMuted; vid.play().catch(function () {}); }
        sfLiveRefreshMuteBtn();
    }
    // Reconstrói o botão de som (ícone + cor) a partir do estado atual de
    // sfLiveViewerMuted, sem mexer no resto dos controles. Usado tanto no
    // toque manual do espectador quanto no fallback automático de autoplay
    // bloqueado (ver pc.ontrack em sfLiveJoin).
    function sfLiveRefreshMuteBtn() {
        var controls = document.getElementById('sf-live-controls');
        if (!controls || !document.getElementById('sf-live-mute-btn')) return; // não é a tela do espectador (ou não está montada)
        controls.innerHTML = sfLiveMuteBtnHtml();
        document.getElementById('sf-live-mute-btn').onclick = sfLiveToggleViewerMute;
    }

    // ── Anfitrião encerra a live pra todo mundo (único jeito de encerrar de vez) ──
    function sfEndLive() {
        if (!sfLiveIsHost || !sfLiveActivePostId) return;
        var postId = sfLiveActivePostId;
        customConfirm('Encerrar Live', 'Isso encerra a transmissão para todos que estão assistindo agora. Deseja continuar?', 'Encerrar', 'danger-btn').then(function (ok) {
            if (!ok) return;
            sfLivePostRef(postId).update({ 'liveState.status': 'ended', 'liveState.endedAt': Date.now(), 'liveState.camOn': false, 'liveState.micOn': false }).catch(function () {});
            notify('Live encerrada', 'ok');
            sfStopDetailMedia();
            sfLiveTeardown();
            sfRefreshDetailIfOpen();
        });
    }

    // ── Espectador sai da live ao fechar o detalhe (pode entrar de novo
    //    quantas vezes quiser, enquanto ela durar). O anfitrião NÃO sai
    //    ao fechar o detalhe — a transmissão continua no ar; só encerra
    //    de vez pelo botão "Encerrar" acima. ──
    function sfLiveLeaveIfViewing() {
        if (!sfLiveActivePostId || sfLiveIsHost) return;
        var ref = sfLivePostRef();
        if (ref && me) ref.collection('viewers').doc(me.uid).set({ active: false, leftAt: Date.now() }, { merge: true }).catch(function () {});
        sfLiveTeardown();
    }

    // ── Limpeza local completa (encerrar, sair, excluir o post ou deslogar) ──
    function sfLiveTeardown() {
        if (sfLiveLocalStream) {
            sfLiveLocalStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            sfLiveLocalStream = null;
        }
        Object.keys(sfLivePeerConns).forEach(function (k) { try { sfLivePeerConns[k].close(); } catch (e) {} });
        sfLivePeerConns = {};
        sfLivePeerVideoSenders = {};
        Object.keys(sfLivePeerCandUnsubs).forEach(function (k) {
            var u = sfLivePeerCandUnsubs[k];
            (Array.isArray(u) ? u : [u]).forEach(function (fn) { try { if (typeof fn === 'function') fn(); } catch (e) {} });
        });
        sfLivePeerCandUnsubs = {};
        if (sfLiveViewersUnsub)   { sfLiveViewersUnsub();   sfLiveViewersUnsub   = null; }
        if (sfLivePeerDocUnsub)   { sfLivePeerDocUnsub();   sfLivePeerDocUnsub   = null; }
        if (sfLivePostWatchUnsub) { sfLivePostWatchUnsub(); sfLivePostWatchUnsub = null; }
        sfLiveActivePostId = null; sfLiveIsHost = false; sfLiveHostInfo = null;
        sfLiveCamOn = true; sfLiveMicOn = true; sfLiveViewerMuted = false;
        sfLiveViewersMap = {};
    }

    async function sfSubmitPost() {
        if (!me) return;
        if (sfAudioRec.isRecording) { notify('Termine ou pare a gravação antes de publicar', 'warn'); return; }
        var text = document.getElementById('sf-new-text').value.trim().slice(0, 500);
        var hasImage = !!sfPendingImage;
        var hasAudio = !!sfPendingAudio;
        if (!text && !hasImage && !hasAudio) { notify('Escreva algo, adicione uma foto ou um áudio', 'warn'); return; }
        var type = hasImage && hasAudio ? 'image_audio' : hasImage ? 'image' : hasAudio ? 'audio' : 'text';
        var btn = document.getElementById('sf-new-submit');
        btn.disabled = true; btn.textContent = 'Publicando...';
        try {
            var payload = {
                uid: me.uid, nome: me.nome, foto: me.foto || null,
                type: type,
                text: text, likes: 0, likedBy: [], commentsCount: 0, sharesCount: 0,
                createdAt: Date.now()
            };
            if (hasImage) {
                var b64 = sfPendingImage.base64;
                if (b64.length <= SF_MAX_INLINE) {
                    payload.mediaData = b64;
                } else {
                    var mediaId = genMediaId();
                    payload.mediaId = mediaId;
                    notify('Publicando foto em partes...', 'info', 8000);
                    await uploadChunks(b64, mediaId);
                }
            }
            if (hasAudio) {
                var ab64 = sfPendingAudio.base64;
                payload.audioMime = sfPendingAudio.mimeType || 'audio/webm';
                if (ab64.length <= SF_MAX_INLINE) {
                    payload.audioData = ab64;
                } else {
                    var audioId = genMediaId();
                    payload.audioId = audioId;
                    notify('Publicando áudio em partes...', 'info', 8000);
                    await uploadChunks(ab64, audioId);
                }
            }
            await db.collection('social_posts').add(payload);
            // Radar de Interesses: analisa a legenda da publicação do mesmo jeito
            // que já analisa as mensagens de conversa (só contadores agregados e
            // anônimos por palavra-chave — o texto da legenda não é salvo nisso).
            if (text && typeof window.scanMessageForInsights === 'function') {
                try { window.scanMessageForInsights(text, 'post'); } catch (e) {}
            }
            notify('Postagem publicada!', 'ok');
            closeModal('sf-new-post-modal');
            sfPendingImage = null;
            sfPendingAudio = null;
            sfMode = 'all';
            document.getElementById('sf-mine-toggle').classList.remove('on');
            document.getElementById('sf-community-toggle').classList.add('on');
            sfIndex = 0;
        } catch (e) {
            notify('Erro ao publicar: ' + friendlyError(e), 'err');
        } finally {
            btn.disabled = false; btn.textContent = 'Publicar';
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  CURTIR
    // ══════════════════════════════════════════════════════════════════
    async function sfToggleLike(postId) {
        if (!me) return;
        try {
            var ref = db.collection('social_posts').doc(postId);
            var snap = await ref.get();
            if (!snap.exists) { notify('Esta postagem não existe mais', 'warn'); return; }
            var d = snap.data();
            var likedBy = d.likedBy || [];
            var likes = d.likes || 0;
            var isNewLike = likedBy.indexOf(me.uid) === -1;
            if (!isNewLike) { likedBy = likedBy.filter(function (u) { return u !== me.uid; }); likes = Math.max(0, likes - 1); }
            else { likedBy.push(me.uid); likes++; }
            await ref.update({ likedBy: likedBy, likes: likes });
            // Avisa o dono da postagem (se não for eu mesmo) só quando é uma
            // curtida NOVA — remover a curtida não gera notificação.
            if (isNewLike) {
                sfNotifyPostOwner(Object.assign({ id: postId }, d), 'like');
                sfRecordImpactEvent(Object.assign({ id: postId }, d), 'like'); // Voz Dee: curtida recebida = 1 ponto
            }
            // Radar de Interesses: uma curtida NOVA numa publicação com legenda é
            // sinal de que o assunto interessa às pessoas — soma um bônus de
            // engajamento nos termos já identificados nessa legenda (não conta
            // como uma nova "menção", só reforça o quanto aquilo engaja).
            if (isNewLike && d.text && typeof window.scanEngagementForInsights === 'function') {
                try { window.scanEngagementForInsights(d.text, 1); } catch (e) {}
            }
        } catch (e) { notify('Erro ao curtir: ' + friendlyError(e), 'err'); }
    }

    // ══════════════════════════════════════════════════════════════════
    //  EXCLUIR POSTAGEM
    // ══════════════════════════════════════════════════════════════════
    async function sfDeletePost(postId, fromDetail) {
        var p = sfPosts.find(function (x) { return x.id === postId; });
        if (!me || (p && p.uid !== me.uid)) return;
        var ok = await customConfirm('Excluir postagem', 'Esta postagem será excluída permanentemente para todos. Deseja continuar?', 'Excluir', 'danger-btn');
        if (!ok) return;
        try {
            var ref = db.collection('social_posts').doc(postId);
            var commentsSnap = await ref.collection('comments').get();
            var batch = db.batch();
            commentsSnap.forEach(function (c) { batch.delete(c.ref); });
            batch.delete(ref);
            await batch.commit();
            if (p && p.type === 'live') {
                // Melhor esforço: limpa a presença de espectadores e os pares
                // de sinalização WebRTC deixados pela live (não é crítico se
                // falhar — são só documentos de sinalização órfãos).
                ref.collection('viewers').get().then(function (vs) {
                    var b = db.batch(); vs.forEach(function (v) { b.delete(v.ref); }); return b.commit();
                }).catch(function () {});
                ref.collection('peers').get().then(function (ps) {
                    var b2 = db.batch(); ps.forEach(function (pDoc) { b2.delete(pDoc.ref); }); return b2.commit();
                }).catch(function () {});
            }
            if (p && p.mediaId) {
                localforage.removeItem(p.mediaId).catch(function () {});
                try {
                    var meta = await db.collection('chunks').doc(p.mediaId).get();
                    if (meta.exists) {
                        var total = meta.data().total;
                        var b2 = db.batch();
                        for (var i = 0; i < total; i++) b2.delete(db.collection('chunks').doc(p.mediaId).collection('parts').doc(String(i)));
                        b2.delete(db.collection('chunks').doc(p.mediaId));
                        await b2.commit();
                    }
                } catch (e2) {}
            }
            notify('Postagem excluída', 'ok');
            if (fromDetail) {
                closeModal('sf-detail-modal'); sfStopCommentsListener(); sfStopDetailMedia();
                if (sfLiveActivePostId === postId) sfLiveTeardown(); // era a live que eu tinha aberta (anfitrião ou espectador) — encerra tudo localmente
            }
        } catch (e) { notify('Erro ao excluir: ' + friendlyError(e), 'err'); }
    }

    // ══════════════════════════════════════════════════════════════════
    //  LIMPEZA DA REDE SOCIAL AO EXCLUIR A CONTA
    //  Chamada por doDeleteAccount() (index.html) antes de apagar o auth
    //  do Firebase. Sem isso, excluir a conta só apagava o documento em
    //  /usuarios — todo o resto (postagens, comentários, eventos de
    //  impacto que geram o Ranking, notificações, bloqueios) continuava
    //  no banco, e a pessoa seguia aparecendo (com um nome genérico
    //  "Usuário") no Ranking da Comunidade mesmo depois de excluir a
    //  conta. Best-effort: cada bloco tem seu próprio try/catch pra um
    //  erro isolado não travar os demais nem impedir a exclusão da conta.
    // ══════════════════════════════════════════════════════════════════
    async function sfPurgeMyContentOnAccountDeletion(uid) {
        if (!uid) return;
        // 1) Eventos de impacto que a pessoa RECEBEU — é isso que soma a
        //    pontuação exibida no Ranking. Sem apagar isso, a pontuação
        //    (e a posição no ranking) continuaria existindo pra sempre.
        try {
            var evSnap = await db.collection('social_impact_events').where('toUid', '==', uid).get();
            var evDocs = evSnap.docs;
            for (var i = 0; i < evDocs.length; i += 400) {
                var b = db.batch();
                evDocs.slice(i, i + 400).forEach(function (d) { b.delete(d.ref); });
                await b.commit();
            }
        } catch (e) { console.warn('Falha ao limpar eventos de impacto:', e); }
        // 2) Postagens da pessoa (com comentários e mídia de cada uma).
        try {
            var postsSnap = await db.collection('social_posts').where('uid', '==', uid).get();
            for (var p = 0; p < postsSnap.docs.length; p++) {
                var postDoc = postsSnap.docs[p];
                try {
                    var commentsSnap = await postDoc.ref.collection('comments').get();
                    var pb = db.batch();
                    commentsSnap.forEach(function (c) { pb.delete(c.ref); });
                    pb.delete(postDoc.ref);
                    await pb.commit();
                    var mediaId = postDoc.data().mediaId;
                    if (mediaId) {
                        var meta = await db.collection('chunks').doc(mediaId).get();
                        if (meta.exists) {
                            var total = meta.data().total;
                            var mb = db.batch();
                            for (var t = 0; t < total; t++) mb.delete(db.collection('chunks').doc(mediaId).collection('parts').doc(String(t)));
                            mb.delete(db.collection('chunks').doc(mediaId));
                            await mb.commit();
                        }
                    }
                } catch (e2) { console.warn('Falha ao limpar postagem:', e2); }
            }
        } catch (e) { console.warn('Falha ao listar postagens para exclusão:', e); }
        // 3) Comentários que a pessoa deixou em postagens de outras pessoas.
        try {
            var myComments = await db.collectionGroup('comments').where('uid', '==', uid).get();
            var cDocs = myComments.docs;
            for (var j = 0; j < cDocs.length; j += 400) {
                var cb = db.batch();
                cDocs.slice(j, j + 400).forEach(function (d) { cb.delete(d.ref); });
                await cb.commit();
            }
        } catch (e) { console.warn('Falha ao limpar comentários:', e); }
        // 4) Notificações de interação (enviadas ou recebidas).
        try {
            var n1 = await db.collection('social_notifications').where('toUid', '==', uid).get();
            var n2 = await db.collection('social_notifications').where('fromUid', '==', uid).get();
            var nDocs = n1.docs.concat(n2.docs);
            for (var k = 0; k < nDocs.length; k += 400) {
                var nb = db.batch();
                nDocs.slice(k, k + 400).forEach(function (d) { nb.delete(d.ref); });
                await nb.commit();
            }
        } catch (e) { console.warn('Falha ao limpar notificações:', e); }
        // 5) Preferências de ocultar/bloquear (social_blocks/{uid}).
        try { await db.collection('social_blocks').doc(uid).delete(); } catch (e) {}
        // 6) Amizades confirmadas (friends/{id} com "users" contendo o uid).
        try {
            var friendsSnap = await db.collection('friends').where('users', 'array-contains', uid).get();
            var fb = db.batch();
            friendsSnap.forEach(function (d) { fb.delete(d.ref); });
            if (!friendsSnap.empty) await fb.commit();
        } catch (e) { console.warn('Falha ao limpar amizades:', e); }
        // 7) Status (histórias) publicados pela pessoa.
        try {
            var statusSnap = await db.collection('status').where('uid', '==', uid).get();
            var sb = db.batch();
            statusSnap.forEach(function (d) { sb.delete(d.ref); });
            if (!statusSnap.empty) await sb.commit();
        } catch (e) { console.warn('Falha ao limpar status:', e); }
    }
    window.sfPurgeMyContentOnAccountDeletion = sfPurgeMyContentOnAccountDeletion;

    // ══════════════════════════════════════════════════════════════════
    //  OCULTAR POSTAGEM / BLOQUEAR USUÁRIO
    //  Preferências pessoais guardadas em social_blocks/{me.uid} — só o
    //  próprio usuário lê/escreve esse documento (ver firestore.rules).
    //  "Ocultar" some só com aquela postagem específica; "Bloquear" some
    //  com TODAS as postagens (passadas e futuras) daquele autor, até
    //  a pessoa desbloquear pela aba "<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqueados".
    // ══════════════════════════════════════════════════════════════════
    function sfOpenPostOptions(p) {
        if (!me || p.uid === me.uid) return; // não faz sentido ocultar/bloquear a si mesmo
        sfOptionsPost = p;
        document.getElementById('sf-opt-block-name').textContent = p.nome || 'usuário';
        openModal('sf-post-options-modal');
    }

    async function sfHidePost(postId) {
        if (!me) return;
        try {
            await db.collection('social_blocks').doc(me.uid).set(
                { hiddenPosts: firebase.firestore.FieldValue.arrayUnion(postId) },
                { merge: true }
            );
            notify('Postagem ocultada', 'ok');
        } catch (e) { notify('Erro ao ocultar: ' + friendlyError(e), 'err'); }
    }

    async function sfBlockUser(uid, nome) {
        if (!me || !uid || uid === me.uid) return;
        var ok = await customConfirm(
            'Bloquear usuário',
            'As postagens de ' + (nome || 'este usuário') + ' não vão mais aparecer para você na Comunidade Dee. Você pode desbloquear quando quiser, na aba Bloqueados.',
            'Bloquear', 'danger-btn'
        );
        if (!ok) return;
        try {
            await db.collection('social_blocks').doc(me.uid).set(
                { blockedUsers: firebase.firestore.FieldValue.arrayUnion(uid) },
                { merge: true }
            );
            notify('Usuário bloqueado', 'ok');
        } catch (e) { notify('Erro ao bloquear: ' + friendlyError(e), 'err'); }
    }

    async function sfUnblockUser(uid) {
        if (!me || !uid) return;
        try {
            await db.collection('social_blocks').doc(me.uid).set(
                { blockedUsers: firebase.firestore.FieldValue.arrayRemove(uid) },
                { merge: true }
            );
            notify('Usuário desbloqueado', 'ok');
        } catch (e) { notify('Erro ao desbloquear: ' + friendlyError(e), 'err'); }
    }

    function sfRenderBlockedList() {
        var list = document.getElementById('sf-blocked-list');
        if (!list) return;
        if (!sfBlockedUsers.length) {
            list.innerHTML = '<div class="empty" style="padding:16px;">Você não bloqueou ninguém ainda.</div>';
            return;
        }
        var users = typeof allUsers !== 'undefined' ? allUsers : [];
        var rows = sfBlockedUsers.map(function (uid) {
            var u = users.find(function (x) { return x.uid === uid; });
            var nome = (u && u.nome) || 'Usuário';
            var foto = u ? u.foto : null;
            return '<div class="sf-blocked-row">' +
                '<div class="sf-avatar" style="width:34px;height:34px;flex-shrink:0;">' + avInner(nome, foto) + '</div>' +
                '<div class="sf-blocked-name">' + esc(nome) + '</div>' +
                '<button class="sf-unblock-btn" data-unblock="' + uid + '">Desbloquear</button>' +
            '</div>';
        }).join('');
        list.innerHTML = rows;
        list.querySelectorAll('[data-unblock]').forEach(function (btn) {
            btn.onclick = function () { sfUnblockUser(btn.getAttribute('data-unblock')); };
        });
    }

    function sfOpenBlockedModal() {
        sfRenderBlockedList();
        openModal('sf-blocked-modal');
    }

    // Carrega e escuta em tempo real as preferências pessoais de
    // ocultar/bloquear, refletindo no feed assim que mudam (inclusive se
    // alteradas em outro dispositivo logado com a mesma conta).
    function sfListenPrefs() {
        if (sfPrefsUnsub) sfPrefsUnsub();
        if (!me) return;
        sfPrefsUnsub = db.collection('social_blocks').doc(me.uid).onSnapshot(function (snap) {
            var d = snap.exists ? snap.data() : {};
            sfBlockedUsers = d.blockedUsers || [];
            sfHiddenPosts  = d.hiddenPosts  || [];
            if (sfIndex >= sfVisiblePosts().length) sfIndex = 0;
            sfRenderCarousel();
            // Se a postagem aberta no detalhe acabou de ser ocultada, ou o
            // autor dela acabou de ser bloqueado, fecha o modal na hora.
            if (sfDetailPostId) {
                var openP = sfPosts.find(function (x) { return x.id === sfDetailPostId; });
                var shouldClose = sfHiddenPosts.indexOf(sfDetailPostId) !== -1 ||
                    (openP && sfBlockedUsers.indexOf(openP.uid) !== -1);
                if (shouldClose) {
                    closeModal('sf-detail-modal'); sfStopCommentsListener(); sfStopDetailMedia();
                    sfLiveLeaveIfViewing();
                }
            }
            var blockedModal = document.getElementById('sf-blocked-modal');
            if (blockedModal && blockedModal.classList.contains('open')) sfRenderBlockedList();
        }, function (err) { console.error('social prefs:', err); });
    }

    // ══════════════════════════════════════════════════════════════════
    //  DETALHE DO POST + COMENTÁRIOS
    // ══════════════════════════════════════════════════════════════════
    function sfStopCommentsListener() {
        if (sfCommentsUnsub) { sfCommentsUnsub(); sfCommentsUnsub = null; }
        sfDetailPostId = null;
        sfDetailPostOwnerUid = null;
    }

    // ── Pausa qualquer áudio/vídeo que tenha ficado tocando dentro do
    //    detalhe (legenda em áudio da postagem/live, ou o próprio vídeo da
    //    live). Chamada sempre que o detalhe fecha ou troca de postagem,
    //    pra quem estava assistindo/ouvindo não continuar com som tocando
    //    depois de sair. ──
    function sfStopDetailMedia() {
        var wrap = document.getElementById('sf-detail-media-wrap');
        if (wrap) {
            wrap.querySelectorAll('audio').forEach(function (a) { try { a.pause(); } catch (e) {} });
            var vid = wrap.querySelector('video');
            if (vid) { try { vid.pause(); vid.srcObject = null; } catch (e) {} }
        }
    }

    async function sfOpenPostDetail(postId, focusComment) {
        var p = sfPosts.find(function (x) { return x.id === postId; });
        if (!p) {
            try {
                var snap = await db.collection('social_posts').doc(postId).get();
                if (!snap.exists) { notify('Esta postagem foi removida', 'info'); return; }
                p = Object.assign({ id: snap.id }, snap.data());
            } catch (e) { notify('Erro ao abrir postagem: ' + friendlyError(e), 'err'); return; }
        }
        sfDetailPostId = postId;
        sfRenderDetail(p);
        openModal('sf-detail-modal');
        if (focusComment) setTimeout(function () { document.getElementById('sf-comment-input').focus(); }, 200);
        sfListenComments(postId, p.uid || null);
    }

    function sfRefreshDetailIfOpen() {
        if (!document.getElementById('sf-detail-modal').classList.contains('open')) return;
        var p = sfPosts.find(function (x) { return x.id === sfDetailPostId; });
        if (p) sfRenderDetail(p);
    }

    function sfRenderDetail(p) {
        var isMine = !!(me && p.uid === me.uid);
        var likedByMe = !!(me && p.likedBy && p.likedBy.indexOf(me.uid) !== -1);
        document.getElementById('sf-detail-avatar').innerHTML = avInner(p.nome, p.foto);
        document.getElementById('sf-detail-avatar').classList.toggle('sf-spotlight', sfSpotlightTop3.indexOf(p.uid) !== -1);
        document.getElementById('sf-detail-name').innerHTML = esc(p.nome || 'Usuário') + sfBadgeHtml(p.uid);
        document.getElementById('sf-detail-time').textContent = sfRelTime(p.createdAt);
        var detailHeadClick = document.getElementById('sf-detail-head-click');
        if (detailHeadClick) {
            detailHeadClick.onclick = function (e) {
                e.stopPropagation();
                if (p.uid && typeof window.viewUserProfile === 'function') window.viewUserProfile(p.uid, p.nome, e, true);
            };
        }
        document.getElementById('sf-detail-del-btn').style.display = isMine ? 'flex' : 'none';
        document.getElementById('sf-detail-more-btn').style.display = isMine ? 'none' : 'flex';
        var recogBtn = document.getElementById('sf-detail-recog-btn');
        if (recogBtn) {
            if (!isMine && me) {
                recogBtn.style.display = 'flex';
                recogBtn.onclick = function () { sfOpenRecognizeModal(p.uid, p.nome); };
            } else {
                recogBtn.style.display = 'none';
            }
        }

        var mediaWrap = document.getElementById('sf-detail-media-wrap');
        var textEl = document.getElementById('sf-detail-text');
        var hasImg = (p.type === 'image' || p.type === 'image_audio');
        var hasAud = (p.type === 'audio' || p.type === 'image_audio') || (p.type === 'live' && (p.audioData || p.audioId));
        // A LIVE já mostra o vídeo. Sempre que o feed atualiza (curtida/
        // comentário em QUALQUER post), esta função roda de novo — se
        // recriássemos o <video> a cada vez, a conexão WebRTC já
        // conectada perderia a imagem. Só reconstrói o bloco da live
        // quando ainda não está montado para ESTE post no estado atual
        // (primeira abertura, ou a live acabou de ser encerrada).
        var isLiveActive = p.type === 'live' && p.liveState && p.liveState.status === 'live';
        var liveAlreadyMounted = isLiveActive && document.getElementById('sf-live-area') && sfLiveActivePostId === p.id;
        if (!liveAlreadyMounted) {
            // IMPORTANTE: monta o HTML inteiro numa string local e faz UMA
            // única atribuição a mediaWrap.innerHTML no final. Usar
            // "mediaWrap.innerHTML += ..." várias vezes (como antes) faz o
            // navegador serializar e reconstruir TODOS os elementos já
            // inseridos a cada chamada — isso destruía o <video> da live
            // (perdendo o srcObject da própria câmera do anfitrião, já
            // preenchido por sfLiveMountDetailArea) e os botões de
            // câmera/mic/encerrar sempre que a postagem também tinha
            // imagem/áudio anexado. Por isso o anfitrião não via a própria
            // câmera nem conseguia usar os controles, mesmo a conexão
            // WebRTC (o que o espectador recebe) continuando 100% normal.
            var mediaHtml = '';
            if (p.type === 'live') mediaHtml += sfLiveDetailAreaHtml(p);
            if (hasImg) {
                if (p.mediaData) {
                    mediaHtml += '<div class="sf-detail-media"><img src="' + p.mediaData + '" alt=""></div>';
                } else if (p.mediaId) {
                    mediaHtml += '<div class="sf-detail-media" id="sf-detail-media-img"><div class="sf-media-loading">Carregando...</div></div>';
                }
            }
            var apDetail = null;
            if (hasAud) {
                if (p.audioData) {
                    apDetail = buildAudioPlayer(p.audioData);
                    mediaHtml += '<div class="sf-detail-audio">' + apDetail.html + '</div>';
                } else if (p.audioId) {
                    mediaHtml += '<div class="sf-detail-audio" id="sf-detail-media-audio"><div class="sf-media-loading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg> Carregando áudio...</div></div>';
                }
            }
            mediaWrap.innerHTML = mediaHtml;
            // Só agora, com o DOM final já estável, é que ligamos a câmera/
            // conexões (live) e disparamos os downloads assíncronos — nada
            // mais vai reconstruir mediaWrap depois disso.
            if (p.type === 'live') {
                if (isLiveActive) sfLiveMountDetailArea(p);
                else if (sfLiveActivePostId === p.id) sfLiveTeardown(); // a live que eu via/hospedava acabou de encerrar
            }
            if (hasImg && p.mediaId) {
                downloadChunks(p.mediaId).then(function (base64) {
                    var el = document.getElementById('sf-detail-media-img');
                    if (el) el.innerHTML = '<img src="' + base64 + '" alt="">';
                }).catch(function () {
                    var el = document.getElementById('sf-detail-media-img');
                    if (el) el.innerHTML = '<div class="sf-media-loading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Erro ao carregar</div>';
                });
            }
            if (hasAud) {
                if (p.audioData && apDetail) {
                    apMount(apDetail.id);
                } else if (p.audioId) {
                    downloadChunks(p.audioId).then(function (base64) {
                        var el = document.getElementById('sf-detail-media-audio');
                        if (el) {
                            var ap = buildAudioPlayer(base64);
                            el.innerHTML = ap.html;
                            apMount(ap.id);
                        }
                    }).catch(function () {
                        var el = document.getElementById('sf-detail-media-audio');
                        if (el) el.innerHTML = '<div class="sf-media-loading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Erro ao carregar</div>';
                    });
                }
            }
        } else {
            // Live já montada: só atualiza o contador de espectadores.
            var vcEl0 = document.getElementById('sf-live-viewers-count');
            if (vcEl0) { var sp0 = vcEl0.querySelector('span'); if (sp0) sp0.textContent = (p.liveState.viewerCount || 0); }
        }
        if (p.text) { textEl.style.display = 'block'; textEl.innerHTML = sfLinkify(p.text); } else { textEl.style.display = 'none'; }

        var likeBtn = document.getElementById('sf-detail-like-btn');
        likeBtn.classList.toggle('liked', likedByMe);
        likeBtn.innerHTML = (likedByMe ? '<svg class="icon icon-fill icon-like-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' : '<svg class="icon icon-like-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>') + ' <span id="sf-detail-like-count">' + (p.likes || 0) + '</span>';
        document.getElementById('sf-detail-share-count').textContent = p.sharesCount || 0;
        document.getElementById('sf-detail-comment-count').textContent = p.commentsCount || 0;
    }

    function sfListenComments(postId, ownerUid) {
        sfStopCommentsListener();
        sfDetailPostId = postId;
        sfDetailPostOwnerUid = (typeof ownerUid !== 'undefined') ? ownerUid : null;
        sfCommentsUnsub = db.collection('social_posts').doc(postId).collection('comments')
            .orderBy('createdAt', 'asc')
            .onSnapshot(function (snap) {
                var list = document.getElementById('sf-comments-list');
                if (snap.empty) {
                    list.innerHTML = '<div class="sf-comments-empty">Nenhum comentário ainda. Seja o primeiro!</div>';
                    return;
                }
                var html = '';
                snap.forEach(function (d) {
                    var c = d.data();
                    // O autor do comentário pode excluir o próprio comentário;
                    // o dono do post pode excluir qualquer comentário no seu post.
                    var canDelete = !!(me && (c.uid === me.uid || (sfDetailPostOwnerUid && sfDetailPostOwnerUid === me.uid)));
                    html += '<div class="sf-comment-row">' +
                        '<div class="sf-avatar" style="width:28px;height:28px;">' + avInner(c.nome, c.foto) + '</div>' +
                        '<div class="sf-comment-body">' +
                            '<div class="sf-comment-name">' + esc(c.nome || 'Usuário') + sfBadgeHtml(c.uid) + '</div>' +
                            '<div class="sf-comment-text">' + sfLinkify(c.text || '') + '</div>' +
                            '<div class="sf-comment-time">' + sfRelTime(c.createdAt) + '</div>' +
                        '</div>' +
                        (canDelete ? '<button class="sf-comment-del-btn" data-cdel="' + d.id + '" title="Excluir comentário"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg></button>' : '') +
                    '</div>';
                });
                list.innerHTML = html;
                list.scrollTop = list.scrollHeight;
                list.querySelectorAll('[data-cdel]').forEach(function (btn) {
                    btn.onclick = function (e) {
                        e.stopPropagation();
                        sfDeleteComment(sfDetailPostId, btn.getAttribute('data-cdel'));
                    };
                });
            }, function (err) { console.error('comments:', err); });
    }

    async function sfDeleteComment(postId, commentId) {
        if (!me || !postId || !commentId) return;
        var ok = await customConfirm('Excluir comentário', 'Este comentário será excluído permanentemente. Deseja continuar?', 'Excluir', 'danger-btn');
        if (!ok) return;
        try {
            var postRef = db.collection('social_posts').doc(postId);
            await postRef.collection('comments').doc(commentId).delete();
            await postRef.update({ commentsCount: firebase.firestore.FieldValue.increment(-1) });
        } catch (e) { notify('Erro ao excluir comentário: ' + friendlyError(e), 'err'); }
    }

    async function sfSubmitComment() {
        if (!me || !sfDetailPostId) return;
        var inp = document.getElementById('sf-comment-input');
        var text = inp.value.trim().slice(0, 300);
        if (!text) return;
        inp.value = '';
        try {
            var ref = db.collection('social_posts').doc(sfDetailPostId);
            await ref.collection('comments').add({ uid: me.uid, nome: me.nome, foto: me.foto || null, text: text, createdAt: Date.now() });
            await ref.update({ commentsCount: firebase.firestore.FieldValue.increment(1) });
            // Avisa o dono da postagem (se não for eu mesmo) que recebeu um
            // comentário novo. Usa o post já em cache (sfPosts) quando
            // disponível; senão cai no owner uid guardado ao abrir o detalhe.
            var commentedPost = sfPosts.find(function (x) { return x.id === sfDetailPostId; }) ||
                { id: sfDetailPostId, uid: sfDetailPostOwnerUid };
            sfNotifyPostOwner(commentedPost, 'comment');
            sfRecordImpactEvent(commentedPost, 'comment'); // Voz Dee: comentário recebido = 3 pontos
            // Radar de Interesses: analisa o comentário do mesmo jeito que já
            // analisa mensagens de conversa e legendas de publicação.
            if (typeof window.scanMessageForInsights === 'function') {
                try { window.scanMessageForInsights(text, 'comment'); } catch (e) {}
            }
        } catch (e) { notify('Erro ao comentar: ' + friendlyError(e), 'err'); }
    }

    // ══════════════════════════════════════════════════════════════════
    //  COMPARTILHAR — envia um cartão do post para uma conversa/grupo
    // ══════════════════════════════════════════════════════════════════
    function sfTypeIcon(type) {
        if (type === 'image' || type === 'image_audio') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
        if (type === 'audio') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
        return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    }
    function sfOpenShareModal(p) {
        sfShareTargetPost = p;
        var prev = document.getElementById('sf-share-preview');
        var hasImg = (p.type === 'image' || p.type === 'image_audio') && p.mediaData;
        var mediaHtml = hasImg ? '<img src="' + p.mediaData + '" alt="">' : '<div class="sf-share-preview-ic">' + sfTypeIcon(p.type) + '</div>';
        prev.innerHTML = mediaHtml + '<div class="sf-share-preview-title">' + esc((p.nome || 'Usuário') + (p.text ? ' — ' + p.text.slice(0, 40) : '')) + '</div>';

        var list = document.getElementById('sf-share-list');
        list.innerHTML = '<div class="empty" style="padding:16px;">Carregando...</div>';
        openModal('sf-share-modal');

        var friends = (typeof allUsers !== 'undefined' ? allUsers : []).filter(function (u) { return myFriends.indexOf(u.uid) !== -1; });
        db.collection('grupos').where('members', 'array-contains', me.uid).get().then(function (gsnap) {
            var groups = [];
            gsnap.forEach(function (d) { groups.push(Object.assign({ id: d.id }, d.data())); });
            if (!friends.length && !groups.length) {
                list.innerHTML = '<div class="empty" style="padding:16px;">Adicione amigos ou crie um grupo primeiro</div>';
                return;
            }
            var rows = '';
            friends.forEach(function (u) {
                rows += '<div class="sf-share-target-row">' +
                    '<input type="checkbox" id="sfsh-u-' + u.uid + '" value="u:' + u.uid + '">' +
                    '<label for="sfsh-u-' + u.uid + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ' + esc(u.nome) + '</label></div>';
            });
            groups.forEach(function (g) {
                rows += '<div class="sf-share-target-row">' +
                    '<input type="checkbox" id="sfsh-g-' + g.id + '" value="g:' + g.id + '">' +
                    '<label for="sfsh-g-' + g.id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ' + esc(g.nome) + '</label></div>';
            });
            list.innerHTML = rows;
        }).catch(function () { list.innerHTML = '<div class="empty" style="padding:16px;">Erro ao carregar grupos</div>'; });
    }

    async function sfFetchAndSharePost(postId) {
        try {
            var snap = await db.collection('social_posts').doc(postId).get();
            if (!snap.exists) { notify('Esta postagem foi removida', 'info'); return; }
            sfOpenShareModal(Object.assign({ id: snap.id }, snap.data()));
        } catch (e) { notify('Erro ao carregar postagem: ' + friendlyError(e), 'err'); }
    }

    async function sfDoShare() {
        var p = sfShareTargetPost;
        if (!p) return;
        var checked = Array.prototype.slice.call(document.querySelectorAll('#sf-share-list input:checked')).map(function (i) { return i.value; });
        if (!checked.length) { notify('Selecione ao menos um amigo ou grupo', 'warn'); return; }

        var payload = {
            senderId: me.uid, senderName: me.nome, text: '', type: 'social_share', time: Date.now(),
            postId: p.id,
            postAuthorName: p.nome || 'Usuário',
            postAuthorFoto: p.foto || null,
            postType: p.type,
            postText: (p.text || '').slice(0, 140),
            postMediaPreview: ((p.type === 'image' || p.type === 'image_audio') && p.mediaData) ? p.mediaData : null
        };

        var ok = 0, fail = 0;
        for (var i = 0; i < checked.length; i++) {
            var parts = checked[i].split(':');
            var kind = parts[0], id = parts[1];
            try {
                var ref = kind === 'g'
                    ? db.collection('grupos').doc(id).collection('mensagens')
                    : db.collection('conversas').doc(convId(me.uid, id)).collection('mensagens');
                await ref.add(payload);
                ok++;
            } catch (e) { fail++; }
        }
        try { await db.collection('social_posts').doc(p.id).update({ sharesCount: firebase.firestore.FieldValue.increment(ok) }); } catch (e) {}
        // Avisa o dono da postagem que ela foi compartilhada — uma única
        // notificação por ação de compartilhar, mesmo enviando pra vários
        // amigos/grupos de uma vez.
        if (ok > 0) {
            sfNotifyPostOwner(p, 'share');
            sfRecordImpactEvent(p, 'share'); // Voz Dee: compartilhamento recebido = 5 pontos (1 evento por ação de compartilhar, não por destinatário)
        }
        // Radar de Interesses: compartilhamento é um sinal de engajamento ainda
        // mais forte que curtida (a pessoa achou relevante o bastante pra mandar
        // pra alguém) — bônus x2 por compartilhamento bem-sucedido.
        if (ok > 0 && p.text && typeof window.scanEngagementForInsights === 'function') {
            try { window.scanEngagementForInsights(p.text, ok * 2); } catch (e) {}
        }

        closeModal('sf-share-modal');
        sfShareTargetPost = null;
        if (ok && !fail) notify('Postagem compartilhada com ' + ok + (ok === 1 ? ' conversa' : ' conversas') + '!', 'ok');
        else if (ok && fail) notify('Compartilhado com ' + ok + ', mas ' + fail + ' falharam', 'warn');
        else notify('Não foi possível compartilhar', 'err');
    }

    // ══════════════════════════════════════════════════════════════════
    //  INTEGRAÇÃO COM O CHAT — renderiza o cartão "post compartilhado"
    //  dentro das mensagens, sem precisar editar renderMsg() do index.html.
    // ══════════════════════════════════════════════════════════════════
    function sfRenderShareCard(bub, m) {
        var mediaHtml = m.postMediaPreview
            ? '<img src="' + m.postMediaPreview + '" alt="">'
            : '<div class="sf-share-ic">' + sfTypeIcon(m.postType) + '</div>';
        bub.innerHTML =
            '<div class="sf-share-tag"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Postagem compartilhada</div>' +
            '<div class="sf-share-card" data-sf-open="' + esc(m.postId || '') + '">' +
                mediaHtml +
                '<div class="sf-share-info">' +
                    '<div class="sf-share-title">' + esc(m.postAuthorName || 'Usuário') + '</div>' +
                    '<div class="sf-share-sub">' + esc(m.postText || (m.postType === 'image' ? 'Foto' : m.postType === 'audio' ? 'Áudio' : m.postType === 'image_audio' ? 'Foto + áudio' : 'Postagem')) + '</div>' +
                '</div>' +
            '</div>';
        var card = bub.querySelector('[data-sf-open]');
        if (card) card.onclick = function (e) { e.stopPropagation(); sfOpenPostDetail(m.postId); };
    }

    function sfPatchChatRendering() {
        if (typeof window.renderMsg === 'function' && !window.renderMsg._sfPatched) {
            var orig = window.renderMsg;
            var patched = function (doc, isHistorical) {
                var res = orig(doc, isHistorical);
                var m = doc.data();
                if (m.type === 'social_share') {
                    var bub = document.querySelector('[data-mid="' + doc.id + '"] .bubble');
                    if (bub) sfRenderShareCard(bub, m);
                }
                return res;
            };
            patched._sfPatched = true;
            window.renderMsg = patched;
        }
        if (typeof window.getMsgPreview === 'function' && !window.getMsgPreview._sfPatched) {
            var origPreview = window.getMsgPreview;
            var patchedPreview = function (m) {
                if (m.type === 'social_share') return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Postagem compartilhada';
                return origPreview(m);
            };
            patchedPreview._sfPatched = true;
            window.getMsgPreview = patchedPreview;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  NOTIFICAÇÕES DE INTERAÇÃO — curtida/comentário/compartilhamento nas
    //  MINHAS postagens. Duas partes, iguais em espírito ao que já existe
    //  pro chat: (1) um badge numérico em cima do botão "Meus posts",
    //  igual aos badges de CHATS/GRUPOS; (2) uma notificação nativa do
    //  sistema quando a interação chega com a aba em segundo plano.
    // ══════════════════════════════════════════════════════════════════

    // Grava um aviso em social_notifications/{id} para o dono da postagem
    // ler depois. Nunca notifica a própria pessoa (ex.: curtir o próprio
    // post) e nunca deixa um erro aqui derrubar a ação principal (curtir/
    // comentar/compartilhar já foi salvo antes desta chamada).
    async function sfNotifyPostOwner(post, type) {
        if (!me || !post || !post.uid || post.uid === me.uid) return;
        try {
            await db.collection('social_notifications').add({
                toUid: post.uid,
                fromUid: me.uid,
                fromName: me.nome,
                fromFoto: me.foto || null,
                type: type, // 'like' | 'comment' | 'share'
                postId: post.id,
                postType: post.type || null,
                postText: (post.text || '').slice(0, 80),
                postMediaPreview: ((post.type === 'image' || post.type === 'image_audio') && post.mediaData) ? post.mediaData : null,
                read: false,
                createdAt: Date.now()
            });
        } catch (e) { console.warn('Falha ao registrar notificação social:', e); }
    }

    // Avisa os amigos (mesma lista usada em Chats/Grupos — "myFriends" é
    // global, vem do index.html) assim que uma live começa na Comunidade,
    // igual a como qualquer mensagem de live no chat/grupo já notifica
    // quem está do outro lado da conversa. Como não existe Cloud Function
    // neste projeto para centralizar isso, é o próprio anfitrião quem
    // grava, na hora, um aviso em social_notifications para cada amigo
    // (mesmo esquema/coleção já usado para curtida/comentário/
    // compartilhamento — só que aqui quem dispara não é quem recebeu a
    // interação, e sim quem começou a transmissão). Pessoas que não são
    // amigas não recebem nada, mesmo a live sendo pública no feed.
    async function sfNotifyFriendsLiveStarted(post) {
        if (!me || !post) return;
        var friends = (typeof myFriends !== 'undefined' && myFriends) ? myFriends : [];
        friends = friends.filter(function (uid) { return uid && uid !== me.uid; });
        if (!friends.length) return;
        try {
            var CHUNK = 450; // limite do Firestore é 500 escritas por batch; margem de segurança
            for (var i = 0; i < friends.length; i += CHUNK) {
                var batch = db.batch();
                friends.slice(i, i + CHUNK).forEach(function (uid) {
                    var ref = db.collection('social_notifications').doc();
                    batch.set(ref, {
                        toUid: uid,
                        fromUid: me.uid,
                        fromName: me.nome,
                        fromFoto: me.foto || null,
                        type: 'live',
                        postId: post.id,
                        postType: 'live',
                        postText: (post.text || '').slice(0, 80),
                        postMediaPreview: null,
                        read: false,
                        createdAt: Date.now()
                    });
                });
                await batch.commit();
            }
        } catch (e) { console.warn('Falha ao notificar amigos sobre a live:', e); }
    }

    function sfUpdateNotifBadge() {
        var badge = document.getElementById('sf-mine-badge');
        if (badge) {
            badge.textContent = sfNotifUnread > 99 ? '99+' : String(sfNotifUnread);
            badge.style.display = sfNotifUnread > 0 ? 'inline' : 'none';
        }
        var liveBadge = document.getElementById('sf-community-badge');
        if (liveBadge) {
            liveBadge.textContent = sfLiveNotifUnread > 99 ? '99+' : String(sfLiveNotifUnread);
            liveBadge.style.display = sfLiveNotifUnread > 0 ? 'inline' : 'none';
        }
    }

    // Marca como lidas as notificações de interação NAS MINHAS postagens
    // (curtida/comentário/compartilhamento/reconhecimento) — chamado ao
    // abrir a aba "Meus posts". Avisos de "amigo começou uma live" (type
    // 'live') não são interação no meu post, então ficam de fora daqui —
    // eles são marcados como vistos ao abrir "Comunidade" (ver
    // sfMarkLiveNotificationsRead), que é onde a live realmente aparece.
    async function sfMarkNotificationsRead() {
        if (!me || sfNotifUnread === 0) return;
        try {
            var snap = await db.collection('social_notifications')
                .where('toUid', '==', me.uid).where('read', '==', false).get();
            if (snap.empty) return;
            var batch = db.batch();
            var any = false;
            snap.forEach(function (d) {
                if (d.data().type === 'live') return; // não é sobre o meu post — não marca aqui
                batch.update(d.ref, { read: true });
                any = true;
            });
            if (any) await batch.commit();
        } catch (e) { console.warn('Falha ao marcar notificações sociais como lidas:', e); }
    }

    // Marca como vistos os avisos de "amigo começou uma live" — chamado ao
    // abrir a aba "Comunidade", que é onde a pessoa realmente vê a live
    // (o feed geral), em vez de "Meus posts".
    async function sfMarkLiveNotificationsRead() {
        if (!me || sfLiveNotifUnread === 0) return;
        try {
            var snap = await db.collection('social_notifications')
                .where('toUid', '==', me.uid).where('read', '==', false).get();
            if (snap.empty) return;
            var batch = db.batch();
            var any = false;
            snap.forEach(function (d) {
                if (d.data().type !== 'live') return;
                batch.update(d.ref, { read: true });
                any = true;
            });
            if (any) await batch.commit();
        } catch (e) { console.warn('Falha ao marcar avisos de live como vistos:', e); }
    }

    function sfNotifText(n) {
        var name = n.fromName || 'Alguém';
        if (n.type === 'like')    return name + ' curtiu sua postagem';
        if (n.type === 'comment') return name + ' comentou na sua postagem';
        if (n.type === 'share')   return name + ' compartilhou sua postagem';
        if (n.type === 'recognition') return name + ' te deu um Reconhecimento! 🏆';
        if (n.type === 'live')    return name + ' começou uma transmissão ao vivo 🔴';
        return name + ' interagiu com sua postagem';
    }

    // Escuta em tempo real as notificações pendentes (toUid == eu, read ==
    // false): mantém os badges atualizados — "Meus posts" para interações
    // nas minhas postagens, "Comunidade" para avisos de live de amigos —
    // e, a cada nova notificação que chega depois da carga inicial,
    // dispara o aviso (flutuante em primeiro plano / nativo do sistema em
    // segundo plano).
    function sfListenNotifications() {
        if (sfNotificationsUnsub) sfNotificationsUnsub();
        if (!me) return;
        var firstSnapshot = true;
        sfNotificationsUnsub = db.collection('social_notifications')
            .where('toUid', '==', me.uid)
            .where('read', '==', false)
            .onSnapshot(function (snap) {
                var mineCount = 0, liveCount = 0;
                snap.forEach(function (d) {
                    if (d.data().type === 'live') liveCount++; else mineCount++;
                });
                sfNotifUnread = mineCount;
                sfLiveNotifUnread = liveCount;
                sfUpdateNotifBadge();
                if (!firstSnapshot) {
                    snap.docChanges().forEach(function (change) {
                        if (change.type === 'added') {
                            sfHandleNewNotification(Object.assign({ id: change.doc.id }, change.doc.data()));
                        }
                    });
                }
                firstSnapshot = false;
            }, function (err) { console.error('social notifications:', err); });
    }

    function sfHandleNewNotification(n) {
        // Notificação flutuante DENTRO do app (mesmo toast usado no resto
        // do app) — só faz sentido com a aba em primeiro plano.
        if (!document.hidden && typeof window.notify === 'function') {
            notify(sfNotifText(n), 'info');
        }
        // Notificação NATIVA do sistema, para quando a aba está em segundo
        // plano — mesma correção que fizemos pras mensagens de chat: pede
        // pro Service Worker mostrar (reg.showNotification), já que criar
        // com `new Notification()` direto da página é bloqueado no Android
        // quando existe um Service Worker ativo.
        if (document.hidden) sfFireSystemNotification(n);
    }

    async function sfFireSystemNotification(n) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (!('serviceWorker' in navigator)) return;
        var ns = (typeof loadNotifSettings === 'function') ? loadNotifSettings() : {};
        if (ns.msgNotifEnabled === false) return; // pessoa desativou notificações em Configurações
        try {
            var reg = await navigator.serviceWorker.ready;
            await reg.showNotification('Dee', {
                body: sfNotifText(n),
                icon: n.fromFoto || 'icon-192.png',
                badge: 'icon-192.png',
                // Mesma tag pra curtidas/comentários/compartilhamentos do
                // MESMO post: chegadas seguidas atualizam o banner (com
                // renotify) em vez de empilhar várias notificações.
                tag: 'dee-social-' + n.postId + '-' + n.type,
                renotify: true,
                data: { type: 'social', postId: n.postId }
            });
        } catch (e) { console.warn('Falha ao mostrar notificação social:', e); }
    }

    // Repasse da ação vinda do sw.js quando o usuário toca numa notificação
    // nativa de interação social (curtida/comentário/compartilhamento) —
    // com o app já aberto (em primeiro ou segundo plano).
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', function (event) {
            var msg = event.data || {};
            if (msg.type === 'DEE_SOCIAL_ACTION' && msg.postId) {
                sfOpenPostDetail(msg.postId);
            }
        });
    }
    // Se o app foi reaberto do zero (estava totalmente fechado) a partir de
    // um clique numa dessas notificações, a URL chega com
    // ?sopen=1&spost=POST_ID (ver notificationclick no sw.js) — guarda a
    // intenção e abre assim que o boot terminar (ver sfBoot).
    (function () {
        var params = new URLSearchParams(window.location.search);
        if (params.get('sopen') === '1') {
            sfPendingOpenPostId = params.get('spost');
            try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
        }
    })();

    // ══════════════════════════════════════════════════════════════════
    //  VOZ DEE — Pontuação de Impacto, Reconhecimento, Selo/Nível e
    //  Spotlight da Semana. Sem sistema de "seguidores": a reputação vem
    //  de impacto real (curtida/comentário/compartilhamento RECEBIDOS) e
    //  de reconhecimento espontâneo entre usuários.
    //
    //  Arquitetura (sem Cloud Functions — só client + Firestore):
    //  - Cada interação RECEBIDA grava um evento imutável em
    //    social_impact_events/{id}: {toUid, fromUid, type, weight,
    //    createdAt, postId}. Nunca existe um campo "score" gravável —
    //    a pontuação é sempre a SOMA desses eventos, calculada aqui no
    //    cliente, com decaimento exponencial (meia-vida de 30 dias)
    //    aplicado sobre o timestamp de cada evento. Isso é o que as
    //    firestore.rules impedem de ser manipulado: ninguém escreve a
    //    própria pontuação, só gera eventos (e o "weight" de cada tipo
    //    é travado nas rules).
    //  - Pra não reler o Firestore inteiro a cada selo desenhado, os
    //    eventos são carregados uma vez por sessão (com um recorte dos
    //    últimos SF_IMPACT_WINDOW_DAYS dias, o suficiente pro decaimento
    //    já ter zerado contribuições mais antigas) e ficam em
    //    sfImpactEvents; sfComputeImpactScore/sfComputeRecentScore só
    //    somam sobre esse array em memória. O cache expira sozinho após
    //    SF_IMPACT_TTL_MS e é usado pra Ranking, Spotlight e selos.
    // ══════════════════════════════════════════════════════════════════

    // Fator de decaimento exponencial: perde metade do valor a cada
    // SF_HALF_LIFE_MS (30 dias). ts = timestamp (ms) do evento.
    function sfDecayFactor(ts) {
        var ageMs = Date.now() - (ts || 0);
        if (ageMs <= 0) return 1;
        return Math.pow(0.5, ageMs / SF_HALF_LIFE_MS);
    }

    // "Semana" fixa de 7 dias contada a partir da época Unix — igual pra
    // todo mundo, não depende de quando a pessoa começou a usar o app.
    // (mesmo cálculo usado em firestore.rules, pro doc social_recognitions)
    function sfWeekId(ts) {
        return Math.floor((ts || Date.now()) / SF_WEEK_MS);
    }

    // Carrega (ou reaproveita, se ainda "fresco") o cache de eventos de
    // impacto. Retorna uma Promise com o array de eventos. Nunca deixa
    // dois carregamentos rodarem em paralelo (sfImpactEventsLoading).
    function sfLoadImpactEvents(force) {
        var fresh = sfImpactEvents && (Date.now() - sfImpactEventsAt) < SF_IMPACT_TTL_MS;
        if (fresh && !force) return Promise.resolve(sfImpactEvents);
        if (sfImpactEventsLoading) return sfImpactEventsLoading;
        var cutoff = Date.now() - (SF_IMPACT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        sfImpactEventsLoading = db.collection('social_impact_events')
            .where('createdAt', '>=', cutoff)
            .get()
            .then(function (snap) {
                var list = [];
                snap.forEach(function (d) { list.push(d.data()); });
                sfImpactEvents = list;
                sfImpactEventsAt = Date.now();
                sfImpactScoreCache = {};
                sfImpactRecentCache = {};
                sfRecomputeSpotlight();
                sfCheckMyRankChange(); // Voz Dee: dispara notificação se minha posição/pontuação mudou
                sfImpactEventsLoading = null;
                // Reflete os selos/spotlight recém-calculados no que já
                // está desenhado na tela (feed atual, detalhe aberto,
                // ranking se estiver aberto).
                sfRenderCarousel();
                sfRefreshDetailIfOpen();
                if (document.getElementById('sf-rank-modal') && document.getElementById('sf-rank-modal').classList.contains('open')) sfRenderRankList();
                return list;
            }, function (err) {
                console.warn('Falha ao carregar eventos de impacto:', err);
                sfImpactEventsLoading = null;
                return sfImpactEvents || [];
            });
        return sfImpactEventsLoading;
    }

    // Pontuação total (com decaimento) de um uid, somando só sobre o
    // cache já carregado — síncrono de propósito, pra poder ser chamado
    // direto dentro de funções de render (sfCardHtml, comentários etc).
    // Retorna 0 se o cache ainda não carregou (o selo aparece assim que
    // sfLoadImpactEvents() resolver e re-renderizar o feed).
    function sfComputeImpactScoreSync(uid) {
        if (!uid) return 0;
        if (Object.prototype.hasOwnProperty.call(sfImpactScoreCache, uid)) return sfImpactScoreCache[uid];
        var total = 0;
        (sfImpactEvents || []).forEach(function (ev) {
            if (ev.toUid !== uid) return;
            total += (ev.weight || 0) * sfDecayFactor(ev.createdAt);
        });
        sfImpactScoreCache[uid] = total;
        return total;
    }

    // Pontuação ganha só nos últimos "days" dias (sem olhar o total
    // acumulado) — é o que decide o Spotlight da Semana. Também soma
    // com decaimento (pouca diferença numa janela de 7 dias, mas mantém
    // a mesma régua usada em todo o resto do sistema).
    function sfComputeRecentScoreSync(uid, days) {
        var key = uid + ':' + days;
        if (Object.prototype.hasOwnProperty.call(sfImpactRecentCache, key)) return sfImpactRecentCache[key];
        var cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        var total = 0;
        (sfImpactEvents || []).forEach(function (ev) {
            if (ev.toUid !== uid || (ev.createdAt || 0) < cutoff) return;
            total += (ev.weight || 0) * sfDecayFactor(ev.createdAt);
        });
        sfImpactRecentCache[key] = total;
        return total;
    }

    // Faixas de nível — ajuste livremente os limiares aqui, num só lugar.
    var SF_LEVELS = [
        { min: 4000, emoji: '👑', name: 'Lenda Dee' },
        { min: 1500, emoji: '💠', name: 'Voz da Comunidade' },
        { min: 500,  emoji: '🔷', name: 'Referência' },
        { min: 100,  emoji: '🔹', name: 'Presença Ativa' }
    ];
    // Retorna o nível (ou null se ainda não bateu o primeiro limiar —
    // "Iniciando" não tem selo, por design).
    function sfLevelFor(score) {
        for (var i = 0; i < SF_LEVELS.length; i++) {
            if (score >= SF_LEVELS[i].min) return SF_LEVELS[i];
        }
        return null;
    }

    // HTML prontinho do selo pra colar do lado do nome — string vazia se
    // a pessoa ainda não tem nível (não quebra o layout: mesmo espaço
    // que já existia antes desse sistema existir).
    function sfBadgeHtml(uid) {
        var lvl = sfLevelFor(sfComputeImpactScoreSync(uid));
        if (!lvl) return '';
        return '<span class="sf-badge" title="' + esc(lvl.name) + '">' + lvl.emoji + '</span>';
    }

    // Botão de "Reconhecer" (ícone de prêmio) que aparece ao lado do
    // nome nos cards do feed — versão compacta do botão que também
    // existe no detalhe do post.
    function sfRecognizeBtnHtml(uid, nome) {
        return '<button class="sf-recog-btn" data-recognize="' + esc(uid || '') + '" data-recognize-name="' + esc(nome || '') + '" title="Dar Reconhecimento"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg></button>';
    }

    // ── Ranking da Comunidade — top 10 por pontuação atual ──
    function sfOpenRankModal() {
        openModal('sf-rank-modal');
        sfRenderRankList();
        sfLoadImpactEvents(); // garante que está atualizado ao abrir
        sfMarkRankNotifRead(); // abrir o ranking zera o badge de novidades, igual Meus Posts/Chats/Grupos
    }
    function sfRenderRankList() {
        var list = document.getElementById('sf-rank-list');
        if (!list) return;
        if (!sfImpactEvents) { list.innerHTML = '<div class="empty" style="padding:16px;">Carregando...</div>'; return; }
        var scores = {};
        sfImpactEvents.forEach(function (ev) {
            if (!ev.toUid) return;
            if (!(ev.toUid in scores)) scores[ev.toUid] = sfComputeImpactScoreSync(ev.toUid);
        });
        var ranked = Object.keys(scores)
            .map(function (uid) { return { uid: uid, score: scores[uid] }; })
            .filter(function (r) { return r.score > 0; })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, 10);
        if (!ranked.length) {
            list.innerHTML = '<div class="empty" style="padding:16px;">Ninguém pontuou ainda — curta, comente ou compartilhe algo pra começar!</div>';
            return;
        }
        var users = typeof allUsers !== 'undefined' ? allUsers : [];
        // Uma conta excluída some de /usuarios, então seu uid não é mais
        // encontrado em `users`. Antes disso caía no fallback genérico
        // "Usuário" e a pessoa continuava aparecendo no ranking mesmo após
        // excluir a conta — exatamente o que não pode acontecer. Agora,
        // qualquer uid que não seja "eu" e não exista mais em `users` é
        // tratado como conta excluída e simplesmente removido da lista
        // (em vez de mostrado com um nome genérico).
        var visible = ranked.filter(function (r) {
            if (me && r.uid === me.uid) return true;
            return !!users.find(function (x) { return x.uid === r.uid; });
        });
        if (!visible.length) {
            list.innerHTML = '<div class="empty" style="padding:16px;">Ninguém pontuou ainda — curta, comente ou compartilhe algo pra começar!</div>';
            return;
        }
        list.innerHTML = visible.map(function (r, i) {
            var isMe = !!(me && r.uid === me.uid);
            var u = users.find(function (x) { return x.uid === r.uid; });
            var nome = isMe ? 'Você' : (u && u.nome);
            var foto = isMe ? (me.foto || null) : (u ? u.foto : null);
            return '<div class="sf-rank-row">' +
                '<div class="sf-rank-pos">' + (i + 1) + '</div>' +
                '<div class="sf-avatar' + (sfSpotlightTop3.indexOf(r.uid) !== -1 ? ' sf-spotlight' : '') + '" style="width:30px;height:30px;">' + avInner(nome, foto) + '</div>' +
                '<div class="sf-rank-name">' + esc(nome) + sfBadgeHtml(r.uid) + '</div>' +
                '<div class="sf-rank-score">' + Math.round(r.score) + '</div>' +
            '</div>';
        }).join('');
    }

    // Posição de um uid no ranking geral (não só o top 10 mostrado no
    // modal de ranking) — usado no bloco de ranking do perfil de usuário.
    // Retorna null se a pessoa ainda não tem pontuação (>0).
    function sfRankPositionSync(uid) {
        if (!uid) return null;
        var score = sfComputeImpactScoreSync(uid);
        if (!score || score <= 0) return null;
        var scores = {};
        (sfImpactEvents || []).forEach(function (ev) {
            if (!ev.toUid) return;
            if (!(ev.toUid in scores)) scores[ev.toUid] = sfComputeImpactScoreSync(ev.toUid);
        });
        var usersForPos = typeof allUsers !== 'undefined' ? allUsers : [];
        var ranked = Object.keys(scores)
            .map(function (u) { return { uid: u, score: scores[u] }; })
            .filter(function (r) { return r.score > 0; })
            // Mesma lógica de sfRenderRankList: contas excluídas (uid que já
            // não existe mais em `users`) não contam nem pra posição de
            // ninguém — senão a numeração "#3 no ranking" continuaria
            // incluindo gente que já apagou a conta.
            .filter(function (r) { return (me && r.uid === me.uid) || !!usersForPos.find(function (x) { return x.uid === r.uid; }); })
            .sort(function (a, b) { return b.score - a.score; });
        for (var i = 0; i < ranked.length; i++) {
            if (ranked[i].uid === uid) return { position: i + 1, total: ranked.length };
        }
        return null;
    }

    // Desenha (ou esconde) o bloco de ranking dentro do modal de perfil
    // (#profile-view-rank, em index.html). Síncrono — usa o cache atual
    // de sfImpactEvents, que pode ainda não ter carregado.
    function sfRenderProfileRankBlock(uid) {
        var el = document.getElementById('profile-view-rank');
        if (!el) return;
        var score = sfComputeImpactScoreSync(uid);
        if (!score || score <= 0) { el.style.display = 'none'; el.innerHTML = ''; return; }
        var lvl = sfLevelFor(score);
        var pos = sfRankPositionSync(uid);
        var parts = [];
        if (lvl) parts.push('<span class="profile-rank-level">' + lvl.emoji + ' ' + esc(lvl.name) + '</span>');
        parts.push('<span class="profile-rank-score">' + Math.round(score) + ' pontos</span>');
        if (pos) parts.push('<span class="profile-rank-pos">#' + pos.position + ' no ranking</span>');
        el.innerHTML = parts.join('<span class="profile-rank-sep">·</span>');
        el.style.display = 'flex';
    }

    // Chamada pelo viewUserProfile() em index.html assim que o modal de
    // perfil abre: desenha com o que já está em cache e, se os eventos
    // de impacto ainda não tinham carregado, atualiza de novo quando
    // terminarem — só se o modal ainda estiver aberto no mesmo usuário.
    function sfPopulateProfileRank(uid) {
        sfRenderProfileRankBlock(uid);
        sfLoadImpactEvents().then(function () {
            var modal = document.getElementById('profile-view-modal');
            if (modal && modal.classList.contains('open') && modal.dataset.profileUid === uid) {
                sfRenderProfileRankBlock(uid);
            }
        });
    }

    // ══════════════════════════════════════════════════════════════════
    //  NOTIFICAÇÕES DE RANKING — avisa a pessoa sempre que a PRÓPRIA
    //  posição no ranking ou a própria pontuação de impacto mudar
    //  (subiu, desceu, ganhou pontos, perdeu pontos por decaimento
    //  etc). Mesmo padrão visual/comportamental já usado pras
    //  notificações de curtida/comentário/compartilhamento logo
    //  acima: toast em primeiro plano, notificação nativa do sistema
    //  quando a aba está em segundo plano, e um badge numérico em
    //  cima do botão de ranking (#sf-rank-btn) até a pessoa abrir o
    //  modal do Ranking da Comunidade.
    //
    //  Como não existe Cloud Function/servidor aqui (mesma limitação
    //  já documentada pro resto do app), a checagem roda no cliente:
    //  sempre que sfLoadImpactEvents() recarrega o cache (ao abrir o
    //  app, abrir o ranking, abrir um perfil, ou pelo watcher
    //  periódico abaixo), comparamos posição/pontuação atuais com o
    //  último valor salvo em localStorage e dispara a notificação se
    //  algo mudou. O valor anterior fica salvo por conta (uid), pra
    //  não misturar contas diferentes no mesmo aparelho.
    // ══════════════════════════════════════════════════════════════════
    var SF_RANK_STATE_PREFIX      = 'dee_rank_state_';
    var SF_RANK_CHECK_INTERVAL_MS = 3 * 60 * 1000; // força uma nova checagem a cada 3min (sfLoadImpactEvents só relê de verdade se o cache de 5min já venceu)
    var sfRankNotifUnread = 0;
    var sfRankCheckTimer  = null;

    function sfRankStateKey() { return me ? (SF_RANK_STATE_PREFIX + me.uid) : null; }

    function sfLoadRankState() {
        var key = sfRankStateKey();
        if (!key) return null;
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function sfSaveRankState(state) {
        var key = sfRankStateKey();
        if (!key) return;
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
    }

    function sfUpdateRankBadge() {
        var badge = document.getElementById('sf-rank-badge');
        if (!badge) return;
        badge.textContent   = sfRankNotifUnread > 99 ? '99+' : String(sfRankNotifUnread);
        badge.style.display = sfRankNotifUnread > 0 ? 'flex' : 'none';
    }
    // Chamado ao abrir o modal do Ranking da Comunidade — mesmo espírito
    // de "abrir zera o não-lido" usado em Meus Posts/Chats/Grupos.
    function sfMarkRankNotifRead() {
        if (sfRankNotifUnread === 0) return;
        sfRankNotifUnread = 0;
        sfUpdateRankBadge();
    }

    // Compara minha posição/pontuação atuais com o último estado salvo.
    // Na primeiríssima vez (nunca tinha estado salvo) só grava a
    // referência, sem notificar — do contrário todo mundo levaria uma
    // notificação "você entrou no ranking" na primeira vez que o
    // recurso for publicado.
    function sfCheckMyRankChange() {
        if (!me) return;
        var scoreRounded = Math.round(sfComputeImpactScoreSync(me.uid));
        var pos    = sfRankPositionSync(me.uid);
        var posNum = pos ? pos.position : null;
        var prev   = sfLoadRankState();
        if (!prev) { sfSaveRankState({ position: posNum, score: scoreRounded }); return; }

        // ── Posição (subiu / desceu / entrou / saiu do ranking) ──
        if (prev.position != null && posNum != null && prev.position !== posNum) {
            var up = posNum < prev.position; // número menor = posição melhor
            sfFireRankNotification(
                up ? ('Você subiu para #' + posNum + ' no ranking! 🚀')
                   : ('Você caiu para #' + posNum + ' no ranking.'),
                up ? 'ok' : 'warn'
            );
        } else if (prev.position == null && posNum != null) {
            sfFireRankNotification('Você entrou no ranking em #' + posNum + '! 🎉', 'ok');
        } else if (prev.position != null && posNum == null) {
            sfFireRankNotification('Você saiu do ranking.', 'warn');
        }

        // ── Pontuação (ganhou / perdeu pontos de impacto) ──
        if (prev.score !== scoreRounded) {
            var diff = scoreRounded - prev.score;
            if (diff > 0) sfFireRankNotification('Você ganhou ' + diff + ' ponto' + (diff === 1 ? '' : 's') + ' de impacto!', 'ok');
            else if (diff < 0) sfFireRankNotification('Você perdeu ' + Math.abs(diff) + ' ponto' + (Math.abs(diff) === 1 ? '' : 's') + ' de impacto.', 'warn');
        }

        sfSaveRankState({ position: posNum, score: scoreRounded });
    }

    function sfFireRankNotification(text, kind) {
        sfRankNotifUnread++;
        sfUpdateRankBadge();
        // Toast flutuante dentro do app (mesmo componente usado no resto
        // do app) — só com a aba em primeiro plano.
        if (!document.hidden && typeof window.notify === 'function') notify(text, kind === 'warn' ? 'warn' : 'ok');
        // Notificação nativa do sistema quando a aba está em segundo
        // plano — mesmo mecanismo (via Service Worker) já usado pras
        // notificações de chat/status/pedido de amizade/interação social.
        if (document.hidden) sfFireSystemRankNotification(text);
    }

    async function sfFireSystemRankNotification(text) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        if (!('serviceWorker' in navigator)) return;
        var ns = (typeof loadNotifSettings === 'function') ? loadNotifSettings() : {};
        if (ns.msgNotifEnabled === false) return; // pessoa desativou notificações em Configurações
        try {
            var reg = await navigator.serviceWorker.ready;
            await reg.showNotification('Dee', {
                body: text,
                icon: 'icon-192.png',
                badge: 'icon-192.png',
                tag: 'dee-rank-update',
                renotify: true
            });
        } catch (e) { console.warn('Falha ao mostrar notificação de ranking:', e); }
    }

    // Watcher periódico: garante que a notificação chega mesmo se a
    // pessoa não abrir o ranking nem o próprio perfil por um tempo —
    // sfLoadImpactEvents() já protege contra releitura excessiva do
    // Firestore (só busca de novo se o cache de 5min tiver vencido).
    function sfStartRankWatcher() {
        if (sfRankCheckTimer) clearInterval(sfRankCheckTimer);
        sfRankCheckTimer = setInterval(function () {
            sfLoadImpactEvents().then(sfCheckMyRankChange);
        }, SF_RANK_CHECK_INTERVAL_MS);
    }
    function sfStopRankWatcher() {
        if (sfRankCheckTimer) { clearInterval(sfRankCheckTimer); sfRankCheckTimer = null; }
    }

    // ── Spotlight da Semana — top 3 por pontos ganhos nos últimos 7 dias ──
    function sfRecomputeSpotlight() {
        var scores = {};
        (sfImpactEvents || []).forEach(function (ev) {
            if (!ev.toUid) return;
            if (!(ev.toUid in scores)) scores[ev.toUid] = sfComputeRecentScoreSync(ev.toUid, 7);
        });
        var users = typeof allUsers !== 'undefined' ? allUsers : [];
        var ranked = Object.keys(scores)
            .map(function (uid) { return { uid: uid, score: scores[uid] }; })
            .filter(function (r) { return r.score > 0; })
            // Mesma lógica do Ranking da Comunidade: uma conta excluída some
            // de /usuarios, então seu uid não é mais encontrado em `users`.
            // Sem esse filtro, ela continuava ganhando uma das 3 vagas do
            // "Destaques da semana" (com o nome genérico "Usuário") mesmo
            // depois de excluir a conta.
            .filter(function (r) { return (me && r.uid === me.uid) || !!users.find(function (x) { return x.uid === r.uid; }); })
            .sort(function (a, b) { return b.score - a.score; })
            .slice(0, 3);
        sfSpotlightTop3 = ranked.map(function (r) { return r.uid; });
        sfRenderSpotlightBanner();
    }
    function sfRenderSpotlightBanner() {
        var el = document.getElementById('sf-spotlight-banner');
        if (!el) return;
        if (!sfSpotlightTop3.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
        var users = typeof allUsers !== 'undefined' ? allUsers : [];
        // Cada nome é clicável e abre o perfil da pessoa (foto, nome,
        // descrição e ranking/pontuação) — exceto o meu próprio, que abre
        // meu perfil. IMPORTANTE: allUsers nunca contém o próprio uid
        // (é filtrado ao carregar a lista), então sem esse "if" o meu
        // nome sempre cairia no fallback "Usuário" em vez de aparecer
        // corretamente — por isso o uid é comparado com `me` ANTES de
        // procurar em allUsers. Uids que não são "eu" e não existem mais
        // em `users` (conta excluída) são descartados por segurança —
        // sfRecomputeSpotlight já filtra isso antes de chegar aqui, mas
        // este segundo filtro garante que nenhum resto apareça mesmo se
        // sfSpotlightTop3 for populado por outro caminho no futuro.
        var visible = sfSpotlightTop3.filter(function (uid) {
            return (me && uid === me.uid) || !!users.find(function (x) { return x.uid === uid; });
        });
        if (!visible.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
        var namesHtml = visible.map(function (uid) {
            var isMe = !!(me && uid === me.uid);
            var u = users.find(function (x) { return x.uid === uid; });
            var nome = isMe ? 'Você' : u.nome;
            return '<span class="sf-spotlight-name-link" data-spotlight-uid="' + esc(uid) + '" data-spotlight-name="' + esc(nome) + '"' +
                (isMe ? ' data-spotlight-me="1"' : '') + '>' + esc(nome) + '</span>';
        }).join(', ');
        el.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>' +
            '<span>Destaques da semana: <span class="sf-spotlight-names">' + namesHtml + '</span></span>';
        el.style.display = 'flex';
        el.querySelectorAll('[data-spotlight-uid]').forEach(function (span) {
            span.onclick = function (e) {
                e.stopPropagation();
                if (span.getAttribute('data-spotlight-me') === '1') { if (typeof window.openMyProfile === 'function') window.openMyProfile(); return; }
                if (typeof window.viewUserProfile === 'function') {
                    window.viewUserProfile(span.getAttribute('data-spotlight-uid'), span.getAttribute('data-spotlight-name'), e, true);
                }
            };
        });
    }

    // ── Grava um evento de impacto (curtida/comentário/compartilhamento
    //    RECEBIDOS). Chamado sempre a partir da mesma ação que já
    //    dispara sfNotifyPostOwner (nunca pontua interação com o próprio
    //    conteúdo). Não bloqueia nem espera a ação principal — se falhar,
    //    só a pontuação fica desatualizada, a curtida/comentário/
    //    compartilhamento em si já foi salvo antes.
    var SF_IMPACT_WEIGHTS = { like: 1, comment: 3, share: 5 };
    async function sfRecordImpactEvent(post, type) {
        if (!me || !post || !post.uid || post.uid === me.uid) return;
        var weight = SF_IMPACT_WEIGHTS[type];
        if (!weight) return;
        try {
            await db.collection('social_impact_events').add({
                toUid: post.uid,
                fromUid: me.uid,
                type: type,
                weight: weight,
                postId: post.id || null,
                createdAt: Date.now()
            });
            // Zera o cache SÓ da pontuação desse uid (não precisa relatar
            // do Firestore de novo pra refletir a própria ação na hora).
            delete sfImpactScoreCache[post.uid];
            if (sfImpactEvents) {
                sfImpactEvents.push({ toUid: post.uid, fromUid: me.uid, type: type, weight: weight, postId: post.id || null, createdAt: Date.now() });
            }
        } catch (e) { console.warn('Falha ao registrar evento de impacto:', e); }
    }

    // ── Reconhecimento — 1 por semana, nunca a si mesmo, nunca repetindo
    //    o mesmo destinatário em duas semanas seguidas. A validação "de
    //    verdade" mora nas firestore.rules (doc ID = giverUid_weekId +
    //    leitura da semana anterior); aqui no cliente só damos feedback
    //    cedo (antes de tentar escrever) pra uma UX melhor.
    var sfRecogTarget = null; // { uid, nome } selecionado no momento
    var sfMyLastRecognition = undefined; // cache do último doc social_recognitions do MEU uid (undefined = ainda não checou)

    async function sfFetchMyLastRecognition() {
        if (!me) return null;
        if (sfMyLastRecognition !== undefined) return sfMyLastRecognition;
        try {
            var weekId = sfWeekId();
            var doc = await db.collection('social_recognitions').doc(me.uid + '_' + weekId).get();
            sfMyLastRecognition = doc.exists ? doc.data() : null;
            return sfMyLastRecognition;
        } catch (e) { console.warn('Falha ao checar reconhecimento da semana:', e); return null; }
    }

    async function sfOpenRecognizeModal(uid, nome) {
        if (!me || !uid || uid === me.uid) return;
        sfRecogTarget = { uid: uid, nome: nome || 'Usuário' };
        var textEl = document.getElementById('sf-recog-text');
        var confirmBtn = document.getElementById('sf-recog-confirm');
        textEl.textContent = 'Verificando...';
        confirmBtn.disabled = true;
        openModal('sf-recog-modal');

        var already = await sfFetchMyLastRecognition();
        if (already) {
            if (already.toUid === uid) {
                textEl.textContent = 'Você já deu seu Reconhecimento desta semana para ' + sfRecogTarget.nome + '.';
            } else {
                var untilNext = Math.ceil((((sfWeekId() + 1) * SF_WEEK_MS) - Date.now()) / (24 * 60 * 60 * 1000));
                textEl.textContent = 'Você já usou seu Reconhecimento desta semana. Um novo fica disponível em ' + Math.max(untilNext, 1) + ' dia(s).';
            }
            confirmBtn.disabled = true;
            return;
        }
        textEl.textContent = 'Dar 1 Reconhecimento (vale 50 pontos de impacto) para ' + sfRecogTarget.nome + '? Você só pode dar 1 por semana, e não pode repetir a mesma pessoa na semana seguinte.';
        confirmBtn.disabled = false;
    }

    async function sfConfirmRecognize() {
        if (!me || !sfRecogTarget) return;
        var uid = sfRecogTarget.uid, nome = sfRecogTarget.nome;
        var confirmBtn = document.getElementById('sf-recog-confirm');
        confirmBtn.disabled = true;
        try {
            var weekId = sfWeekId();
            var docId = me.uid + '_' + weekId;
            await db.collection('social_recognitions').doc(docId).set({
                giverUid: me.uid,
                toUid: uid,
                weekId: weekId,
                createdAt: Date.now()
            });
            await db.collection('social_impact_events').add({
                toUid: uid, fromUid: me.uid, type: 'recognition', weight: 50, postId: null, createdAt: Date.now()
            });
            await db.collection('social_notifications').add({
                toUid: uid, fromUid: me.uid, fromName: me.nome, fromFoto: me.foto || null,
                type: 'recognition', postId: null, postType: null, postText: '', postMediaPreview: null,
                read: false, createdAt: Date.now()
            });
            sfMyLastRecognition = { giverUid: me.uid, toUid: uid, weekId: weekId, createdAt: Date.now() };
            delete sfImpactScoreCache[uid];
            if (sfImpactEvents) sfImpactEvents.push({ toUid: uid, fromUid: me.uid, type: 'recognition', weight: 50, postId: null, createdAt: Date.now() });
            sfRenderCarousel();
            sfRefreshDetailIfOpen();
            notify('Reconhecimento enviado para ' + nome + '!', 'ok');
            closeModal('sf-recog-modal');
            sfRecogTarget = null;
        } catch (e) {
            notify('Erro ao dar reconhecimento: ' + friendlyError(e), 'err');
            confirmBtn.disabled = false;
            // NÃO zera sfRecogTarget aqui: se zerasse, um novo clique em
            // "Dar Reconhecimento" cairia no guard do início da função
            // (if (!me || !sfRecogTarget) return;) e não faria nada —
            // o modal ficava travado sem reagir a mais nenhum clique.
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  BOOT — conecta ao ciclo de vida do app (initApp / logout)
    // ══════════════════════════════════════════════════════════════════
    function sfStopAll() {
        // Se eu estava transmitindo, marca a live como encerrada no
        // Firestore (melhor esforço) antes de derrubar tudo localmente.
        if (sfLiveIsHost && sfLiveActivePostId) {
            db.collection('social_posts').doc(sfLiveActivePostId)
                .update({ 'liveState.status': 'ended', 'liveState.endedAt': Date.now() }).catch(function () {});
        } else if (sfLiveActivePostId && me) {
            sfLivePostRef().collection('viewers').doc(me.uid).set({ active: false, leftAt: Date.now() }, { merge: true }).catch(function () {});
        }
        sfLiveTeardown();
        if (sfPostsUnsub) { sfPostsUnsub(); sfPostsUnsub = null; }
        if (sfPrefsUnsub) { sfPrefsUnsub(); sfPrefsUnsub = null; }
        if (sfPinnedUnsub) { sfPinnedUnsub(); sfPinnedUnsub = null; }
        if (sfNotificationsUnsub) { sfNotificationsUnsub(); sfNotificationsUnsub = null; }
        sfStopCommentsListener();
        sfPosts = []; sfIndex = 0; sfMode = 'all'; sfLoadedImages = {};
        sfBlockedUsers = []; sfHiddenPosts = []; sfOptionsPost = null;
        sfPinned = null; sfPinnedPost = null;
        sfNotifUnread = 0; sfLiveNotifUnread = 0; sfUpdateNotifBadge();
        // Voz Dee: limpa o cache de pontuação/reconhecimento ao deslogar,
        // pra não vazar dados de uma conta pra outra no mesmo dispositivo.
        sfImpactEvents = null; sfImpactEventsAt = 0; sfImpactEventsLoading = null;
        sfImpactScoreCache = {}; sfImpactRecentCache = {}; sfSpotlightTop3 = [];
        sfMyLastRecognition = undefined; sfRecogTarget = null;
        // Voz Dee: para o watcher de ranking e zera o badge/contagem ao
        // deslogar (o estado salvo em localStorage fica, é por uid, então
        // não há risco de misturar contas — só não deve ficar "piscando"
        // enquanto ninguém está logado).
        sfStopRankWatcher();
        sfRankNotifUnread = 0; sfUpdateRankBadge();
    }

    function sfBoot() {
        sfInjectCSS();
        sfMountUI();
        sfPatchChatRendering();
        sfListenPosts();
        sfListenPrefs();
        sfListenPinnedConfig();
        sfListenNotifications();
        sfLoadImpactEvents(); // Voz Dee: carrega pontuação/spotlight assim que a Comunidade abre
        sfStartRankWatcher(); // Voz Dee: passa a checar periodicamente mudanças na minha posição/pontuação
        // Se o app acabou de abrir por causa de um clique numa notificação
        // de interação social (app estava 100% fechado), abre a postagem.
        if (sfPendingOpenPostId) {
            var pid = sfPendingOpenPostId;
            sfPendingOpenPostId = null;
            sfOpenPostDetail(pid);
        }
    }

    function sfWaitAndPatchLifecycle() {
        // initApp() só existe depois que o script principal do index.html
        // já rodou (o que é garantido, já que este arquivo é carregado por
        // último). Se por algum motivo ainda não existir, tenta de novo.
        if (typeof window.initApp !== 'function') {
            setTimeout(sfWaitAndPatchLifecycle, 150);
            return;
        }
        if (window.initApp._sfPatched) return;
        var origInitApp = window.initApp;
        var patchedInitApp = function () {
            origInitApp();
            sfBoot();
        };
        patchedInitApp._sfPatched = true;
        window.initApp = patchedInitApp;

        if (typeof window.stopAllUnsubscribers === 'function' && !window.stopAllUnsubscribers._sfPatched) {
            var origStop = window.stopAllUnsubscribers;
            var patchedStop = function () { origStop(); sfStopAll(); };
            patchedStop._sfPatched = true;
            window.stopAllUnsubscribers = patchedStop;
        }

        // Caso o app já esteja logado e initApp() já tenha rodado antes deste
        // script terminar de carregar (ex.: sessão já ativa), inicializa direto.
        // OBS: "me" aqui é a variável global do index.html (declarada com
        // "let", por isso NÃO existe como "window.me" — checar window.me
        // sempre dava falso e fazia essa recuperação nunca funcionar,
        // fazendo a seção só aparecer depois de atualizar a página de
        // novo). Checamos a própria variável "me", que o escopo léxico
        // deste arquivo enxerga normalmente.
        if (typeof me !== 'undefined' && me && document.getElementById('app-screen') && document.getElementById('app-screen').classList.contains('active')) {
            sfBoot();
        }
    }

    window.sfBadgeHtml = sfBadgeHtml;
    window.sfComputeImpactScoreSync = sfComputeImpactScoreSync;
    window.sfLevelFor = sfLevelFor;
    window.SF_LEVELS = SF_LEVELS;
    window.sfLoadImpactEvents = sfLoadImpactEvents;
    window.sfRankPositionSync = sfRankPositionSync;
    window.sfPopulateProfileRank = sfPopulateProfileRank;

    sfWaitAndPatchLifecycle();
})();