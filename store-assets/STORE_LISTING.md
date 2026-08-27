# Ficha da loja — rascunho pra colar no Play Console

Ajuste à vontade — isso é só um ponto de partida pra você não começar do zero.
Os limites de caracteres abaixo são os da própria Play Store.

## Nome do app (máx. 30 caracteres)
```
Dee — Mensagens e Chamadas
```

## Descrição curta (máx. 80 caracteres)
```
Mensagens, chamadas de voz e vídeo com quem você ama, em tempo real.
```

## Descrição completa (máx. 4000 caracteres)
```
Dee é um app de mensagens feito pra manter você perto de quem importa —
com conversas em tempo real, chamadas de voz, chamadas de vídeo e mais.

PRINCIPAIS RECURSOS
• Mensagens de texto, áudio, fotos e arquivos, em tempo real
• Chamadas de vídeo e de voz
• Notificação de chamada e mensagem mesmo com o app fechado ou a tela bloqueada
• Compartilhamento de localização (pontual ou ao vivo)
• Grupos de conversa
• Transmissões ao vivo
• Convites de jogos e sugestão de cinema entre amigos

PRIVACIDADE
Sua conta e suas conversas são só suas. Você pode excluir sua conta e
todos os dados associados a qualquer momento, direto pelo app.
Veja a política de privacidade completa em:
https://dee-mensagens.firebaseapp.com/privacidade.html

Dee é gratuito e não é direcionado a crianças menores de 13 anos.
```

## Categoria sugerida
Comunicação

## Público-alvo
13 anos ou mais (não direcionado a crianças — ver política de privacidade)

## E-mail de contato do desenvolvedor (obrigatório)
```
deemensagens@gmail.com
```
(já é o e-mail de suporte configurado no Firebase Auth/Google Sign-In —
reaproveitar o mesmo mantém consistência)

## Site (opcional, mas recomendado)
```
https://dee-mensagens.firebaseapp.com
```

## Política de privacidade (obrigatório)
```
https://dee-mensagens.firebaseapp.com/privacidade.html
```
Já existe e já está publicada — só usar essa URL direto no formulário.

---

## Imagens (o que ainda falta você fornecer/gerar)

| Item | Medida exigida | Status |
|---|---|---|
| Ícone de alta resolução | 512×512 PNG | ✅ gerado em `store-assets/icon-512.png` (a partir do seu ícone atual) |
| Imagem de destaque (feature graphic) | 1024×500 PNG/JPG | ⚠️ gerada uma versão simples em `store-assets/feature-graphic-1024x500.png` — recomendo trocar por uma arte mais elaborada antes de publicar, essa é só placeholder |
| Capturas de tela do celular | mínimo 2, até 8 — JPG/PNG, proporção 16:9 ou 9:16 | ❌ faltam — precisa tirar prints reais do app (tela de conversa, tela de chamada, tela de permissões, etc.) |

As capturas de tela **têm que ser do app de verdade rodando** — não dá pra
inventar/gerar essas por você não ter como fingir a interface real do
Android. É só abrir o app instalado, usar o botão de captura de tela do
celular nas telas mais bonitas/representativas (conversa, chamada de
vídeo, tela inicial) e subir os arquivos direto no Play Console.
