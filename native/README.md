# Dee Full — scaffold Capacitor

Este pacote empacota o **mesmo** `public/` do PWA como app nativo Android/iOS,
sem duplicar HTML/JS. O site/PWA continua existindo e funcionando exatamente
como hoje ("Dee Lite") — isso aqui só adiciona uma segunda forma de instalar
("Dee Full"), com mais permissões e mais recursos.

## O que já está pronto neste passo (scaffold)

- `capacitor.config.json` — aponta `webDir` para `../public` (a mesma pasta
  que o Firebase Hosting já serve), com `appId` `br.com.deemensagens.app`.
- `package.json` — todas as dependências nativas já pré-selecionadas e com
  as versões reais publicadas no npm (Capacitor 8.x).
- `android-permissions/AndroidManifest-additions.xml` — permissões pra
  mesclar manualmente no manifest gerado pelo Capacitor.
- `ios-permissions/Info-additions.plist` — chaves pra mesclar manualmente
  no Info.plist gerado pelo Capacitor.
- No PWA: `public/js/native-bridge.js` (detecta se está rodando nativo ou
  não) e o modal "Dee Lite x Dee Full" já plugado no botão **Instalar**
  que já existia (`doInstall()` → abre a escolha → `chooseInstall('lite'|'full')`).

> **Importante:** os plugins nativos de câmera dupla em chamada, viva-voz/
> auricular, chamada em tela cheia com o app fechado e push de verdade
> (FCM/APNs) **ainda não foram implementados** — isso é o próximo passo,
> puramente porque você escolheu focar primeiro no scaffold. As dependências
> já estão listadas no `package.json` esperando por eles.

## Passo a passo pra gerar o app de verdade

Rode tudo dentro da pasta `native/`:

```bash
cd native
npm install
```

### Android

```bash
npm run add:android      # cria a pasta android/ (só na primeira vez)
```

Depois, abra `android/app/src/main/AndroidManifest.xml` e cole o conteúdo
de `android-permissions/AndroidManifest-additions.xml` dentro de
`<manifest>`, antes de `<application>` (leia os comentários do próprio
arquivo — tem também 2 atributos pra colar na tag `<activity>` pra
chamada em tela cheia funcionar com a tela bloqueada).

```bash
npm run sync:android
npm run open:android     # abre no Android Studio
```

No Android Studio: `Build > Generate Signed Bundle/APK` pra gerar o
`.aab` (Play Store) ou `.apk` (teste direto no celular).

### iOS

Precisa de um Mac com Xcode instalado.

```bash
npm run add:ios          # cria a pasta ios/ (só na primeira vez)
```

Abra `ios/App/App/Info.plist` e cole o conteúdo de
`ios-permissions/Info-additions.plist` dentro do `<dict>` raiz.

```bash
npm run sync:ios
npm run open:ios          # abre no Xcode
```

No Xcode: selecione seu Team no "Signing & Capabilities", ative as
capabilities descritas no comentário do `Info-additions.plist` (Push
Notifications, Background Modes) e rode num dispositivo real (câmera e
push não funcionam no Simulator).

### Depois de qualquer mudança no `public/`

O `public/` é compartilhado entre o site e o app nativo. Sempre que
alterar algo lá, sincronize de novo antes de gerar uma nova build:

```bash
npm run sync
```

## Publicando e ligando o botão "Dee Full"

Depois de publicar na Play Store / App Store (ou de gerar um `.apk`
assinado pra distribuir direto), edite estas duas linhas em
`public/index.html` (procure por `DEE_FULL_ANDROID_URL`):

```js
var DEE_FULL_ANDROID_URL = 'https://play.google.com/store/apps/details?id=br.com.deemensagens.app';
var DEE_FULL_IOS_URL     = 'https://apps.apple.com/app/idXXXXXXXXX';
```

Até lá, quem clicar em "Dee Full" no modal de instalação vê um aviso
pedindo pra usar o Dee Lite por enquanto — nada quebra.

## Próximos passos (fora deste scaffold)

1. Implementar em `native-bridge.js` os módulos de câmera dupla,
   viva-voz/auricular (`capacitor-plugin-audio-toggle`), chamada em tela
   cheia (`@capgo/capacitor-incoming-call-kit`) e push
   (`@capacitor/push-notifications`).
2. Criar a Cloud Function que dispara essas notificações (hoje o projeto
   não tem nenhuma — nem para o Lite).
3. Testar em dispositivo Android e iPhone reais antes de publicar.
