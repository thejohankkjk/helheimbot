const {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActivityType,
} = require('discord.js');
const config = require('./src/config');
const db = require('./src/supabase');
const embeds = require('./src/embeds');
const { createTicketChannel, runRecruitmentFlow } = require('./src/recruitment');
const arena = require('./src/arena/commands');
const arenaAdmin = require('./src/arena/admin');
const moderation = require('./src/moderation');
const voice = require('./src/voice');
const resetall = require('./src/resetall');
const criar = require('./src/criar');
const editar = require('./src/editar');
const adicionar = require('./src/adicionar');

// Evita que o processo caia por causa de um erro não tratado isolado
// (a Discloud reinicia o app quando ele morre, então isso reduz quedas desnecessárias)
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

// Servidor HTTP mínimo de "estou vivo" — necessário em hosts como o Render, que
// esperam um Web Service respondendo numa porta. Também serve como alvo pra um
// serviço de ping externo (ex: UptimeRobot) evitar que o serviço "durma".
// Não interfere em nada do bot em si.
if (process.env.PORT) {
  const http = require('http');
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Helheim bot online.');
    })
    .listen(process.env.PORT, () => {
      console.log(`[KEEPALIVE] Servidor HTTP ouvindo na porta ${process.env.PORT}`);
    });
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

const START_BUTTON_ID = 'start_recruitment';

client.once('clientReady', async () => {
  console.log(`[BOT] Online como ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: 'Recrutamento & Gestão Helheim 🩸', type: ActivityType.Playing }],
    status: 'online',
  });

  try {
    const commands = [
      new SlashCommandBuilder()
        .setName('recrutamento')
        .setDescription('Envia a mensagem oficial de recrutamento com o botão de inscrição')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),
      arenaAdmin.arenaSlashCommand,
      moderation.suspendCommand,
      moderation.releaseCommand,
      voice.callCommand,
      resetall.resetAllCommand,
      criar.criarCommand,
      editar.editarCommand,
      adicionar.adicionarCommand,
    ];

    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });

    // Limpa qualquer comando antigo registrado só pra esse servidor (de antes de virar global),
    // pra não ficar duplicado na lista do Discord.
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: [] });

    console.log('[BOT] Slash commands registrados globalmente (pode levar até 1h pra propagar em servidores novos).');
  } catch (err) {
    console.error('[BOT] Falha ao registrar slash commands:', err);
  }

  for (const guild of client.guilds.cache.values()) {
    arena.cleanupOrphanedMatches(guild).catch((err) => console.error('[ARENA] Erro na limpeza automática:', err));
  }
});

// Se a sala de uma partida de arena for deletada (manualmente ou por qualquer motivo)
// antes do resultado ser registrado, cancela a partida e libera os dois jogadores.
client.on('channelDelete', async (channel) => {
  try {
    await arena.handleChannelDeleted(channel);
  } catch (err) {
    console.error('[ARENA] Erro ao tratar channelDelete:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // ===== Slash command: /recrutamento =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'recrutamento') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(START_BUTTON_ID)
          .setLabel('Iniciar Recrutamento')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⚔️')
      );

      const bannerAttachment = embeds.getBannerAttachment();
      const payload = {
        embeds: [embeds.recruitmentAnnouncementEmbed()],
        components: [row],
      };
      if (bannerAttachment) payload.files = [bannerAttachment];

      await interaction.channel.send(payload);

      await interaction.reply({ content: '✅ Mensagem de recrutamento enviada.', ephemeral: true });
      return;
    }

    // ===== Slash command: /arena =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'arena') {
      await arenaAdmin.handleArenaCommand(interaction);
      return;
    }

    // ===== Slash commands: /suspender e /liberar =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'suspender') {
      await moderation.handleSuspendCommand(interaction);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'liberar') {
      await moderation.handleReleaseCommand(interaction);
      return;
    }

    // ===== Slash command: /call =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'call') {
      await voice.handleCallCommand(interaction);
      return;
    }

    // ===== Slash command: /resetall =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'resetall') {
      await resetall.handleResetAllCommand(interaction);
      return;
    }

    // ===== Slash command: /criar =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'criar') {
      await criar.handleCriarCommand(interaction);
      return;
    }

    // ===== Slash command: /editar =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'editar') {
      await editar.handleEditarCommand(interaction);
      return;
    }

    // ===== Slash command: /adicionar =====
    if (interaction.isChatInputCommand() && interaction.commandName === 'adicionar') {
      await adicionar.handleAdicionarCommand(interaction);
      return;
    }

    // ===== Botão: Iniciar Recrutamento =====
    if (interaction.isButton() && interaction.customId === START_BUTTON_ID) {
      await interaction.deferReply({ ephemeral: true });

      const existing = await db.findOpenApplication(interaction.guildId, interaction.user.id);
      if (existing) {
        const stillExists = await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
        if (stillExists) {
          await interaction.editReply({ embeds: [embeds.alreadyInProgressEmbed(existing.channel_id)] });
          return;
        }
      }

      const channel = await createTicketChannel(interaction.guild, interaction.member);
      const application = await db.createApplication({
        guildId: interaction.guildId,
        userId: interaction.user.id,
        username: interaction.user.tag,
        channelId: channel.id,
      });

      await interaction.editReply({
        content: `✅ Sua sala de recrutamento foi criada com sucesso! Acesse: <#${channel.id}> para iniciar suas respostas.`,
      });

      const welcomeBanner = embeds.getBannerAttachment();
      await channel.send({
        content: `🩸 <@${interaction.user.id}>`,
        embeds: [embeds.ticketWelcomeEmbed(interaction.member)],
        files: welcomeBanner ? [welcomeBanner] : [],
      });

      // Pequena pausa antes da primeira pergunta, só por estética
      setTimeout(() => {
        runRecruitmentFlow(channel, interaction.member, application).catch((err) => {
          console.error('[RECRUTAMENTO] Erro no fluxo:', err);
          channel.send('❌ Ocorreu um erro inesperado. Chame a staff para verificar.').catch(() => {});
        });
      }, 2000);

      return;
    }

    // ===== Botões da Arena =====
    if (interaction.isButton() && interaction.customId === 'arena_join_queue') {
      await arena.handleJoinQueue(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'arena_leave_queue') {
      await arena.handleLeaveQueue(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'arena_ranking') {
      await arena.handleRanking(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'arena_profile') {
      await arena.handleProfile(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('arena_result:')) {
      await arena.handleResult(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('arena_cancel:')) {
      await arena.handleCancel(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('arena_abandon:')) {
      await arena.handleAbandon(interaction);
      return;
    }
  } catch (err) {
    console.error('[INTERACTION] Erro:', err);
    if (interaction.isRepliable()) {
      const payload = { content: '❌ Ocorreu um erro ao processar sua ação.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
});

client.login(config.token);
