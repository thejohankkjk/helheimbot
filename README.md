# Helheim — Bot de Recrutamento & Arena

Bot de Discord com sistema de ticket + formulário sequencial de recrutamento.
Feito em **discord.js v14** + **Supabase** (banco de dados).

## Como funciona

1. Um admin roda `/recrutamento` no canal desejado → o bot posta o embed com o botão **"Iniciar Recrutamento"**.
2. O usuário clica no botão → o bot cria um canal privado (ticket) só dele + staff, e registra no Supabase.
3. O bot faz as perguntas (arquivo `src/questions.js`) uma por vez, com **5 minutos** de limite por resposta (texto ou botão).
4. Ao responder todas → **aprovação automática**: o cargo é atribuído, uma mensagem de boas-vindas é enviada, o canal é travado para o usuário, e um transcript é mandado no canal de logs.
5. Se o usuário não responder a tempo, o ticket é encerrado por inatividade.

## 1. Criar a aplicação do bot

1. Vá em https://discord.com/developers/applications → **New Application**.
2. Em **Bot**, clique em **Reset Token** e copie o token (isso vai no `DISCORD_TOKEN`).
3. Ainda em **Bot**, ative o **intent** `SERVER MEMBERS INTENT` e `MESSAGE CONTENT INTENT`.
4. Em **OAuth2 → URL Generator**, marque os escopos `bot` e `applications.commands`, e nas permissões marque: `Manage Roles`, `Manage Channels`, `View Channels`, `Send Messages`, `Read Message History`, `Embed Links`. Use o link gerado pra convidar o bot pro seu servidor.
5. **Importante:** no servidor, o cargo do bot precisa estar **acima** do cargo que ele vai atribuir (`APPROVED_ROLE_ID`) na lista de cargos.

## 2. Pegar os IDs necessários

Ative o **Modo Desenvolvedor** no Discord (Configurações → Avançado), depois clique com botão direito para copiar o ID de:
- O servidor (`GUILD_ID`)
- O cargo de staff que vai ver os tickets (`STAFF_ROLE_ID`)
- O cargo dado ao aprovar, ex: Shinpei (`APPROVED_ROLE_ID`)
- A categoria onde os tickets serão criados (`TICKET_CATEGORY_ID`)
- O canal de logs/transcripts, opcional (`LOG_CHANNEL_ID`)
- O `CLIENT_ID` fica em **Developer Portal → General Information → Application ID**

## 3. Configurar o `.env`

Copie `.env.example` para `.env` e preencha todos os valores, incluindo:
```
SUPABASE_URL=https://njenygwuqcjfkzeazade.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<sua service_role key>
```
A `service_role key` fica em **Supabase → Settings → API → Project API keys**. Ela é secreta — nunca a exponha publicamente nem suba num repositório público.

> A tabela `recruitment_applications` já foi criada no seu projeto Supabase.

## 4. Instalar e rodar localmente (teste)

```bash
npm install
npm run deploy   # registra o slash command /recrutamento no servidor
npm start        # liga o bot
```

## 5. Editar as perguntas

Abra `src/questions.js` e edite a lista livremente. Cada pergunta pode ser:
- `type: 'text'` → usuário digita a resposta
- `type: 'choice'` → usuário clica num botão (defina `options: [...]`, até 5 itens)

O bot se adapta automaticamente à quantidade de perguntas (o "Pergunta X de N" é calculado sozinho).

## 6. Hospedar no Discloud

1. Rode `npm install` localmente (o Discloud precisa da pasta `node_modules` junto, **ou** ative a opção de auto-instalar dependências no painel).
2. Compacte a pasta do projeto em `.zip` (sem o `.env`).
3. No painel do [Discloud](https://discloud.app), envie o `.zip` do bot.
4. O arquivo `discloud.config` já está configurado (`TYPE=bot`, `MAIN=index.js`, `RAM=100`, `VERSION=22`).
5. No painel, vá em **Variáveis** e adicione todas as chaves do `.env.example` com os valores reais.
6. Depois de subir, rode `npm run deploy` uma vez (localmente ou via terminal do Discloud, se disponível) para registrar o slash command — isso só precisa ser feito de novo se você mudar os comandos.

## Estrutura do projeto

```
index.js                 → liga o bot e trata os eventos (slash command + botão)
src/config.js             → lê as variáveis de ambiente e o tema visual
src/questions.js          → lista de perguntas (edite aqui)
src/embeds.js             → todos os embeds (visual das mensagens)
src/recruitment.js        → lógica do ticket, perguntas e aprovação
src/supabase.js           → acesso ao banco (Supabase)
src/deploy-commands.js    → registra o /recrutamento no Discord
discloud.config           → configuração de deploy no Discloud
```

## Sistema de Arena 1v1 (v1.02)

Comandos (staff/admin apenas, cargo `STAFF_ROLE_ID`):
- `/arena painel` — posta o painel principal (fila, ranking, perfil) no canal atual
- `/arena link <url>` — define o link do Servidor VIP do Roblox usado nas partidas
- `/arena adicionar-pontos @user <qtd>` / `/arena remover-pontos @user <qtd>` / `/arena resetar-pontos @user`
- `/arena partidas` — lista as partidas em andamento

Fluxo: jogador clica em **Entrar na Fila** → se tiver outro jogador esperando, a partida é criada automaticamente numa sala privada (categoria `ARENA_CATEGORY_ID`, ou a mesma dos tickets se não configurar) → o link VIP e as diretrizes são enviados → só a staff pode clicar nos botões de resultado (3x0 ou Round) ou cancelar → pontos/vitórias/derrotas são atualizados no Supabase e a sala se apaga sozinha ~15s depois.

ELO inicial: 1.000 pontos. Vitória 3x0: +25 / -25. Vitória com round perdido: +15 / -10.

## Controle de versão (uso interno)

Este projeto está sendo versionado internamente (git) durante o desenvolvimento com o Claude. Se precisar reverter algo, basta pedir "volta pra vX.XX" na conversa. Isso não aparece pra ninguém do servidor — é só uma ferramenta de trabalho.

## Personalizar o visual (cores, nome, banner)

Edite o objeto `theme` em `src/config.js`:
```js
theme: {
  name: '𝑯𝒆𝒍𝒉𝒆𝒊𝒎',
  color: 0x8b0000,
  bannerUrl: null, // coloque a URL de uma imagem pra aparecer no embed
  ...
}
```
