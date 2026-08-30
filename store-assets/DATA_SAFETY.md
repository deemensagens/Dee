# Segurança de dados (Data Safety) — rascunho pra preencher no Play Console

Baseado no que já está descrito em `public/privacidade.html`. O texto exato
das perguntas do Play Console muda de vez em quando — use isto como
referência do que responder, não como cópia literal.

## O app coleta ou compartilha algum dado do usuário?
**Sim.**

## Todos os dados de usuário coletados são criptografados em trânsito?
**Sim** (Firebase/Firestore usa HTTPS/TLS em todas as conexões).

## Você oferece um jeito de o usuário pedir a exclusão dos dados?
**Sim** — existe a opção "Excluir conta" dentro do próprio app, que apaga
a conta e os dados associados.

## Tipos de dados coletados

| Categoria (Play Console) | Coletado? | Detalhe | Finalidade declarada |
|---|---|---|---|
| **Informações pessoais** → Nome | Sim | Nome de exibição no cadastro | Funcionalidade do app |
| **Informações pessoais** → E-mail | Sim | Login/cadastro (e-mail/senha ou Google) | Funcionalidade do app, Autenticação |
| **Mensagens** → Outras mensagens dentro do app | Sim | Conteúdo das conversas (texto, mídia) | Funcionalidade do app |
| **Fotos e vídeos** | Sim | Enviados nas conversas | Funcionalidade do app |
| **Áudio** → Gravações de voz ou música | Sim | Áudios enviados no chat + chamadas de voz/vídeo | Funcionalidade do app |
| **Localização** → Localização aproximada/precisa | Sim, **opcional** (só quando o usuário ativa) | Compartilhar localização pontual ou ao vivo com um contato | Funcionalidade do app |
| **Identificadores do dispositivo ou outros** | Sim | Token de notificação (FCM), identificador de instalação | Funcionalidade do app (entregar notificações) |
| **Informações do app** → Registros (logs) de diagnóstico | Sim | Dados técnicos básicos (IP, tipo de dispositivo, SO) | Diagnóstico técnico |
| **Contatos** | **Não** | O Dee não lê a agenda/contatos do celular — os "amigos" são geridos só dentro do app | — |
| **Histórico de navegação / financeiro / saúde** | **Não** | — | — |

## Os dados são compartilhados com terceiros?
Marque como **processados por prestadores de serviço** (não como
"compartilhado para fins próprios de terceiros/anúncios):
- **Firebase/Google Cloud** — hospedagem, banco de dados (Firestore),
  autenticação e notificações push. É infraestrutura que roda o próprio
  app, não um terceiro que usa os dados pra outra finalidade.
- **Cloudflare** — só recebe o mínimo necessário pra disparar a
  notificação (uid, nome, prévia da mensagem) no momento do envio; não
  armazena nada permanentemente.

O Dee **não vende dados**, **não usa dados para anúncios** e **não
compartilha dados com anunciantes/corretores de dados**.

## Prática recomendada antes de enviar
Depois de preencher o formulário no Play Console, ele mostra um resumo —
compare esse resumo com a tabela acima e com o texto de
`public/privacidade.html` pra garantir que bate 100%. Divergência entre o
que a política de privacidade diz e o que o formulário da Play declara é
um dos motivos mais comuns de reprovação/suspensão.
