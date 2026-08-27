# Dee — Checklist pra publicar na Google Play Store

Isto organiza tudo que falta, na ordem certa. Os itens ✅ já estão prontos
neste projeto; os ⚠️/❌ dependem de uma ação sua (conta, texto, decisão).

---

## 0. Custo — a única parte paga de tudo isso

Diferente de todo o resto que construímos (Firebase Spark, Cloudflare Worker
grátis), publicar na Play Store tem uma taxa **única** de **US$ 25**, cobrada
uma vez só ao criar a conta de desenvolvedor Google Play — não é assinatura
mensal. É paga direto no [Play Console](https://play.google.com/console/).

---

## 1. Assinatura do app (✅ já existe)

- ✅ Já existe um keystore de release (`native/android/app/dee-release-key.jks`)
  e o `build.gradle` já está configurado pra usá-lo via
  `native/android/keystore.properties` (esse arquivo tem a senha — por
  isso ele **não vai** no zip pro GitHub público, só fica aqui local com
  você. Acabei de adicionar um `.gitignore` garantindo isso).
- ⚠️ **Faça backup desse `.jks` e do `keystore.properties` em outro lugar
  seguro agora** (ex.: um gerenciador de senhas, um HD externo). Se
  perder os dois, não tem como recuperar — você perderia a capacidade de
  atualizar o app pra sempre (tanto na Play Store quanto no GitHub).

---

## 2. Gerar o pacote que a Play Store aceita (.aab, não .apk)

A Play Store exige **Android App Bundle** (`.aab`), não `.apk`. No Android
Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**
(escolha essa opção, não "APK"). Ou por linha de comando:

```bash
cd "Dee mensagens atualizada/native/android"
./gradlew bundleRelease
```

O arquivo sai em `app/build/outputs/bundle/release/app-release.aab`. Isso
usa automaticamente a mesma assinatura configurada no item 1 — nada a mais
pra fazer aí.

**Continue subindo o `.apk` no GitHub Releases normalmente** (passo 4 do
outro guia) — as duas coisas convivem: quem baixa pelo GitHub recebe o
`.apk`, quem baixa pela Play Store recebe via `.aab`. É o mesmo código, o
mesmo `versionCode`/`versionName` (só suba os dois juntos a cada nova versão).

---

## 3. ⚠️ O passo mais esquecido: Play App Signing x Login com Google

Quando você sobe o `.aab` pela primeira vez, o Google Play pergunta se
quer usar **Play App Signing**. Aceite (é o padrão recomendado e
praticamente obrigatório hoje). Só que isso muda uma coisa importante:

**o Google vai re-assinar o app com uma chave própria dele antes de
distribuir pro usuário final** — diferente da chave que você usou pra
gerar o `.aab`. Isso significa que o certificado (SHA-1/SHA-256) de quem
instala pela Play Store **é diferente** do certificado de quem instala o
`.apk` pelo GitHub.

Por que isso importa: o **Login com Google** (Firebase Auth) verifica esse
certificado. Se você não avisar o Firebase sobre o certificado novo, **o
login com Google vai falhar só pra quem instalou pela Play Store**
(quem instalou pelo `.apk` do GitHub continua funcionando normal).

### Como resolver (depois de fazer o primeiro upload no Play Console):

1. No Play Console → seu app → **Integridade do app** (ou "Configuração
   do app" → "Assinatura do app", o nome muda um pouco de versão pra
   versão) → copie o **SHA-1** e o **SHA-256** que aparecem em
   "Certificado de assinatura do app" (esse é o certificado NOVO, gerado
   pelo Google, diferente do seu `.jks`).
2. Vá no [Firebase Console](https://console.firebase.google.com/) → ⚙️
   Configurações do projeto → aba **Geral** → role até o app Android
   `br.com.deemensagens.app` → **Adicionar impressão digital** → cole o
   SHA-1 (e depois o SHA-256, em outra entrada).
3. Baixe o `google-services.json` atualizado nesse mesmo lugar e substitua
   o arquivo em `native/android/app/google-services.json` — mesmo sem
   mudar nada nele visualmente, é bom garantir que está com a versão mais
   recente depois de adicionar a nova impressão digital.

Sem isso, o suporte a "Entrar com Google" simplesmente não funciona pra
quem baixar da Play Store — vale testar isso especificamente depois da
primeira versão publicada (mesmo que seja só em teste interno).

---

## 4. Ficha da loja (título, descrição, imagens)

- ✅ Rascunho de título/descrição pronto em `store-assets/STORE_LISTING.md`
  — revise e ajuste ao seu gosto antes de colar no Play Console.
- ✅ Ícone de alta resolução (512×512) já gerado em `store-assets/icon-512.png`.
- ⚠️ Imagem de destaque (1024×500) — gerei uma versão simples em
  `store-assets/feature-graphic-1024x500.png`, mas recomendo trocar por
  algo mais trabalhado antes de publicar de verdade (essa é só ponto de
  partida).
- ❌ Capturas de tela reais do app (mínimo 2) — precisam ser prints de
  verdade do app rodando no celular; não dá pra gerar isso por fora.

---

## 5. Política de privacidade

- ✅ Já existe e já está publicada:
  `https://dee-mensagens.firebaseapp.com/privacidade.html` — é só colar
  essa URL no campo "Política de privacidade" do Play Console.

---

## 6. Segurança de dados (Data Safety form)

- ✅ Rascunho completo de como preencher em `store-assets/DATA_SAFETY.md`,
  já baseado no que a política de privacidade descreve.

---

## 7. Classificação de conteúdo (Content Rating)

O Play Console faz um questionário (IARC). Como o Dee é um app de
mensagens/chamadas com conteúdo gerado pelo usuário (chat livre, fotos,
lives), a resposta correta no questionário é marcar que **existe
comunicação entre usuários e conteúdo gerado por usuários não
moderado previamente** — isso normalmente resulta numa classificação
etária mais alta por conta do risco teórico de conteúdo impróprio vindo
de outro usuário (é o mesmo caso de WhatsApp, Telegram, Discord). Isso é
esperado e não impede a publicação.

## 8. Público-alvo e conteúdo direcionado a crianças

No formulário de "Público-alvo", **não marque como app pra crianças**.
A política de privacidade já deixa isso explícito (13+, com supervisão até
os 18). Se o Play perguntar sobre a Family Policy, a resposta é que o Dee
**não é direcionado a crianças**.

---

## 9. Declaração de permissões sensíveis

O Play Console pede justificativa por escrito pra algumas permissões do
`AndroidManifest.xml`. Use estes textos (em inglês, que é como o
formulário pede) como base:

**`USE_FULL_SCREEN_INTENT`** (tela de chamada em tela cheia):
> "Dee is a calling/messaging app. This permission is used exclusively to
> show the incoming call screen full-screen when the app is closed or the
> device is locked, the same way any calling app (e.g. WhatsApp,
> Telegram) shows an incoming call."

**`SYSTEM_ALERT_WINDOW`** (desenhar por cima de outros apps):
> "Used only to display the incoming call UI on top of other apps/lock
> screen when a call is received while the app is closed or in the
> background — core functionality of a calling app, not used for ads or
> unrelated overlays."

**Permissões de mídia (`READ_MEDIA_IMAGES/VIDEO/AUDIO`)**:
> "Used to let the user select and send photos, videos and audio files
> from their device directly within a chat conversation."

Sem essas justificativas preenchidas, o Play Console frequentemente
bloqueia o envio até você completar — vale já deixar esse texto à mão.

---

## 10. Ordem recomendada de lançamento

1. Suba o `.aab` primeiro em uma faixa de **Teste interno** (Internal
   testing) — é a mais rápida de aprovar e permite testar tudo (inclusive
   o item 3, do Google Sign-In) sem expor pro público ainda.
2. Confirma que login com Google, chamada com app fechado/tela bloqueada
   e notificação de mensagem funcionam nessa versão baixada da Play Store
   (o comportamento pode diferir do `.apk` do GitHub por causa do
   certificado — item 3).
3. Promove pra **Produção** só depois de validar o item 2.

---

## Resumo do que já está pronto neste zip

| Item | Status |
|---|---|
| Keystore de assinatura configurado | ✅ |
| `.gitignore` protegendo a chave/segredos | ✅ |
| Ícone 512×512 | ✅ |
| Imagem de destaque (placeholder) | ✅ (trocar antes de publicar de vez) |
| Rascunho de título/descrição | ✅ |
| Rascunho de Data Safety | ✅ |
| Política de privacidade publicada | ✅ |
| Capturas de tela reais | ❌ você precisa tirar |
| Conta no Play Console | ❌ você precisa criar (US$ 25) |
| Primeiro upload + vínculo do SHA no Firebase | ❌ próximo passo, depende do 1º upload |
