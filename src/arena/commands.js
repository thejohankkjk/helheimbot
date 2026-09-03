const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, OverwriteType } = require('discord.js');
const config = require('../config');
const db = require('./db');
const embeds = require('./embeds');

const PANEL_ROW = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('arena_join_queue').setLabel('Entrar na Fila').setStyle(ButtonStyle.Danger).setEmoji('⚔️'),
  new ButtonBuilder().setCustomId('arena_leave_queue').setLabel('Sair da Fila').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
  new ButtonBuilder().setCustomId('arena_ranking').setLabel('Ranking').setStyle(ButtonStyle.Secondary).setEmoji('🏆'),
  new ButtonBuilder().setCustomId('arena_profile').setLabel('Meu Perfil').setStyle(ButtonStyle.Secondary).setEmoji('👤')
);

function isModerator(interactionMember) {
  return (
    config.superUserIds.includes(interactionMember.id) ||
    interactionMember.roles.cache.has(config.staffRoleId) ||
    config.arenaAdminRoleIds.some((roleId) => interactionMember.roles.cache.has(roleId))
  );
}

async function sendPanel(channel) {
  await channel.send({ embeds: [embeds.panelEmbed()], components: [PANEL_ROW] });
}

const QUEUE_TIMEOUT_MS = 10 * 60 * 1000;

async function handleJoinQueue(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const guildId = interaction.guildId;
  const userId = interaction.user.id;

  const player = await db.getOrCreatePlayer(guildId, userId);

  if (db.isSuspended(player)) {
    const untilTs = Math.floor(new Date(player.suspended_until).getTime() / 1000);
    await interaction.editReply(`⛔ Você está suspenso da Arena até <t:${untilTs}:f> (<t:${untilTs}:R>).`);
    return;
  }

  if (player.status === 'queued') {
    await interaction.editReply('⚔️ Você já está na fila. Aguarde um oponente.');
    return;
  }
  if (player.status === 'in_match') {
    await interaction.editReply('🛡️ Você já está em uma partida em andamento.');
    return;
  }

  // Procura oponente antes de entrar na fila, pra evitar se parear consigo mesmo
  const opponent = await db.findQueuedOpponent(guildId, userId);

  if (!opponent) {
    let updated = await db.setStatus(guildId, userId, 'queued');
    await interaction.editReply({ embeds: [embeds.queueEmbed(interaction.member, player.points)] });
    const sentMessage = await announceInArenaChannel(
      interaction.guild,
      `⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘⫘\n` +
        `## 🔍 BUSCANDO PARTIDA\n\n` +
        `> <@${userId}> está buscando uma partida! 🎮\n\n` +
        `Quem terá a coragem de enfrentá-lo em uma partida de MD5? **[Melhor de 5]**⚔️`
    );
    if (sentMessage) {
      updated = await db.setStatus(guildId, userId, 'queued', null, sentMessage.id);
    }
    scheduleQueueTimeout(guildId, userId, updated.updated_at, interaction.guild);
    return;
  }

  // Encontrou oponente -> apaga a mensagem de "buscando" dele e cria a partida
  await deleteQueueMessage(interaction.guild, opponent.queue_message_id);

  const channel = await createMatchChannel(interaction.guild, userId, opponent.discord_id);
  const match = await db.createMatch(guildId, opponent.discord_id, userId, channel.id);

  await db.setStatus(guildId, userId, 'in_match', match.id, null);
  await db.setStatus(guildId, opponent.discord_id, 'in_match', match.id, null);

  await interaction.editReply(`⚔️ Oponente encontrado! Sua sala de combate: <#${channel.id}>`);

  await postMatchRoom(channel, match);
  await announceInArenaChannel(
    interaction.guild,
    { embeds: [embeds.matchAcceptedAnnouncementEmbed(opponent.discord_id, userId)] }
  );
}

/** Agenda o cancelamento automático da busca após 10 min sem oponente */
function scheduleQueueTimeout(guildId, userId, queuedAtIso, guild) {
  setTimeout(async () => {
    try {
      const player = await db.getOrCreatePlayer(guildId, userId);
      // Só cancela se ainda for a MESMA sessão de fila (evita cancelar uma busca nova
      // caso o jogador tenha saído e entrado de novo dentro da janela de 10 min)
      if (player.status !== 'queued' || player.updated_at !== queuedAtIso) return;

      await db.setStatus(guildId, userId, 'idle', null, null);
      await deleteQueueMessage(guild, player.queue_message_id);
      await announceInArenaChannel(
        guild,
        `⌛ A busca de <@${userId}> bateu o tempo limite. Ninguém aceitou o desafio a tempo.`
      );
    } catch (err) {
      console.error('[ARENA] Erro no timeout da fila:', err);
    }
  }, QUEUE_TIMEOUT_MS);
}

async function announceInArenaChannel(guild, payload) {
  if (!config.arenaChannelId) return null;
  const channel = await guild.channels.fetch(config.arenaChannelId).catch(() => null);
  if (!channel) return null;
  const message = typeof payload === 'string' ? { content: payload } : payload;
  return channel.send(message).catch(() => null);
}

/** Apaga a mensagem de "buscando partida" de um jogador, se existir */
async function deleteQueueMessage(guild, queueMessageId) {
  if (!config.arenaChannelId || !queueMessageId) return;
  const channel = await guild.channels.fetch(config.arenaChannelId).catch(() => null);
  if (!channel) return;
  const msg = await channel.messages.fetch(queueMessageId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

async function handleLeaveQueue(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const player = await db.getOrCreatePlayer(interaction.guildId, interaction.user.id);

  if (player.status !== 'queued') {
    await interaction.editReply('Você não está na fila no momento.');
    return;
  }

  await db.setStatus(interaction.guildId, interaction.user.id, 'idle', null, null);
  await deleteQueueMessage(interaction.guild, player.queue_message_id);
  await interaction.editReply('🚪 Você saiu da fila.');
}

async function handleRanking(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const players = await db.getRanking(interaction.guildId, 10);
  await interaction.editReply({ embeds: [embeds.rankingEmbed(players, interaction.user.id)] });
}

async function handleProfile(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { position, player } = await db.getRankPosition(interaction.guildId, interaction.user.id);
  await interaction.editReply({ embeds: [embeds.profileEmbed(interaction.member, player, position)] });
}

async function createMatchChannel(guild, userAId, userBId) {
  const categoryId = config.arenaCategoryId || config.ticketCategoryId;

  const channel = await guild.channels.create({
    name: `arena-${Date.now().toString().slice(-6)}`,
    type: ChannelType.GuildText,
    parent: categoryId || null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: userAId,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: userBId,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: config.staffRoleId,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      ...config.arenaAdminRoleIds.map((roleId) => ({
        id: roleId,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ],
  });

  return channel;
}

/** Trunca o nome pra não estourar o limite de 80 caracteres do label do botão */
function shortName(name, max = 20) {
  if (!name) return 'Jogador';
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

async function postMatchRoom(channel, match) {
  const [p1, p2] = await Promise.all([
    db.getOrCreatePlayer(match.guild_id, match.player1_id),
    db.getOrCreatePlayer(match.guild_id, match.player2_id),
  ]);

  const guild = channel.guild;
  const [member1, member2] = await Promise.all([
    guild.members.fetch(match.player1_id).catch(() => null),
    guild.members.fetch(match.player2_id).catch(() => null),
  ]);
  const name1 = shortName(member1 ? member1.user.username : null);
  const name2 = shortName(member2 ? member2.user.username : null);

  const vipLink = await db.getVipLink(match.guild_id);

  const linkRow = vipLink
    ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('🎮 Entrar no Servidor Roblox').setStyle(ButtonStyle.Link).setURL(vipLink)
      )
    : null;

  const resultRow1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`arena_result:${match.id}:p1:3x0`)
      .setLabel(`3x0 ${name1} (+25 / -25 pts)`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🥇'),
    new ButtonBuilder()
      .setCustomId(`arena_result:${match.id}:p2:3x0`)
      .setLabel(`3x0 ${name2} (+25 / -25 pts)`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('🥇')
  );
  const resultRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`arena_result:${match.id}:p1:round`)
      .setLabel(`Vitória ${name1} (P2 fez round)`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🥈'),
    new ButtonBuilder()
      .setCustomId(`arena_result:${match.id}:p2:round`)
      .setLabel(`Vitória ${name2} (P1 fez round)`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🥈')
  );
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`arena_cancel:${match.id}`)
      .setLabel('Cancelar Partida (Sem Alteração)')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🚫'),
    new ButtonBuilder()
      .setCustomId(`arena_abandon:${match.id}`)
      .setLabel('Encerrar por Abandono (após 60min)')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🚫')
  );

  await channel.send({
    content: `<@${match.player1_id}> <@${match.player2_id}>`,
    embeds: [embeds.matchEmbed(match, p1, p2), embeds.vipLinkEmbed(vipLink), embeds.combatGuidelinesEmbed()],
    components: linkRow ? [linkRow, resultRow1, resultRow2, cancelRow] : [resultRow1, resultRow2, cancelRow],
  });
}

/** customId no formato arena_result:<matchId>:<p1|p2>:<3x0|round> */
async function handleResult(interaction) {
  const [, matchId, playerSlot, kind] = interaction.customId.split(':');

  if (!isModerator(interaction.member)) {
    await interaction.reply({ content: '⛔ Somente a Moderação pode registrar o resultado.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const match = await db.getMatch(matchId);
  if (!match || match.status !== 'ongoing') {
    await interaction.editReply('⚠️ Essa partida já foi finalizada ou cancelada.');
    return;
  }

  const winnerId = playerSlot === 'p1' ? match.player1_id : match.player2_id;
  const loserId = playerSlot === 'p1' ? match.player2_id : match.player1_id;

  const winnerDelta = kind === '3x0' ? 25 : 15;
  const loserDelta = kind === '3x0' ? -25 : -10;
  const scoreLine = kind === '3x0' ? '3 × 0' : 'Vitória (round perdido)';

  // Fecha a partida de forma atômica (evita registro duplicado em cliques simultâneos)
  const closed = await db.closeMatch(matchId, {
    status: 'finished',
    winner_id: winnerId,
    result_type: kind,
  });

  if (!closed) {
    await interaction.editReply('⚠️ Essa partida já tinha sido registrada por outro moderador.');
    return;
  }

  const winnerResult = await db.addPoints(match.guild_id, winnerId, winnerDelta, 'win');
  const loserResult = await db.addPoints(match.guild_id, loserId, loserDelta, 'loss');

  await db.setStatus(match.guild_id, winnerId, 'idle', null);
  await db.setStatus(match.guild_id, loserId, 'idle', null);

  const winnerUser = await interaction.client.users.fetch(winnerId).catch(() => null);

  const resultEmbedPayload = embeds.resultEmbed({
    winnerId,
    loserId,
    winnerUser,
    matchNumber: closed.match_number,
    finishedAt: closed.finished_at,
    scoreLine,
    winnerBefore: winnerResult.before,
    winnerAfter: winnerResult.after,
    loserBefore: loserResult.before,
    loserAfter: loserResult.after,
    currentStreak: winnerResult.player.current_streak,
    moderatorId: interaction.user.id,
  });

  await interaction.editReply({ embeds: [resultEmbedPayload] });

  if (config.arenaLogChannelId) {
    const logChannel = await interaction.guild.channels.fetch(config.arenaLogChannelId).catch(() => null);
    if (logChannel) {
      await logChannel.send({ embeds: [resultEmbedPayload] })
        .catch(() => {});
    }
  }

  setTimeout(() => interaction.channel.delete('Partida de arena finalizada').catch(() => {}), 15_000);
}

/** customId no formato arena_cancel:<matchId> */
async function handleCancel(interaction) {
  const [, matchId] = interaction.customId.split(':');

  if (!isModerator(interaction.member)) {
    await interaction.reply({ content: '⛔ Somente a Moderação pode cancelar a partida.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const match = await db.getMatch(matchId);
  if (!match || match.status !== 'ongoing') {
    await interaction.editReply('⚠️ Essa partida já foi finalizada ou cancelada.');
    return;
  }

  const closed = await db.closeMatch(matchId, { status: 'cancelled' });
  if (!closed) {
    await interaction.editReply('⚠️ Essa partida já tinha sido resolvida.');
    return;
  }

  await db.setStatus(match.guild_id, match.player1_id, 'idle', null);
  await db.setStatus(match.guild_id, match.player2_id, 'idle', null);

  await interaction.editReply({ embeds: [embeds.cancelledEmbed(interaction.user.id)] });

  setTimeout(() => interaction.channel.delete('Partida de arena cancelada').catch(() => {}), 15_000);
}

/** customId no formato arena_abandon:<matchId> — qualquer um dos 2 lutadores pode usar após 60 min */
async function handleAbandon(interaction) {
  const [, matchId] = interaction.customId.split(':');

  const match = await db.getMatch(matchId);
  if (!match || match.status !== 'ongoing') {
    await interaction.reply({ content: '⚠️ Essa partida já foi finalizada ou cancelada.', ephemeral: true });
    return;
  }

  const isFighter = interaction.user.id === match.player1_id || interaction.user.id === match.player2_id;
  if (!isFighter && !isModerator(interaction.member)) {
    await interaction.reply({ content: '⛔ Só os dois lutadores (ou a Moderação) podem usar isso.', ephemeral: true });
    return;
  }

  const elapsedMs = Date.now() - new Date(match.created_at).getTime();
  const sixtyMinMs = 60 * 60 * 1000;

  if (elapsedMs < sixtyMinMs && !isModerator(interaction.member)) {
    const remainingMin = Math.ceil((sixtyMinMs - elapsedMs) / 60000);
    await interaction.reply({
      content: `⏳ Ainda faltam ${remainingMin} min pra poder encerrar por abandono (libera 60 min após a criação da sala).`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const closed = await db.closeMatch(matchId, { status: 'cancelled', result_type: 'abandono' });
  if (!closed) {
    await interaction.editReply('⚠️ Essa partida já tinha sido resolvida.');
    return;
  }

  await db.setStatus(match.guild_id, match.player1_id, 'idle', null);
  await db.setStatus(match.guild_id, match.player2_id, 'idle', null);

  await interaction.editReply(
    `🚫 Partida encerrada por abandono/inatividade (60 min sem resultado registrado), a pedido de <@${interaction.user.id}>. Nenhum ponto foi alterado.`
  );

  setTimeout(() => interaction.channel.delete('Partida de arena encerrada por abandono').catch(() => {}), 15_000);
}

/**
 * Chamado quando um canal é deletado no servidor (evento channelDelete).
 * Se o canal era a sala de uma partida ongoing, fecha a partida sem alterar pontos
 * e libera os dois jogadores (evita que fiquem travados em 'in_match' pra sempre).
 */
async function handleChannelDeleted(channel) {
  if (!channel?.id) return;

  const match = await db.getMatchByChannel(channel.id).catch((err) => {
    console.error('[ARENA] Erro ao buscar partida pelo canal deletado:', err);
    return null;
  });
  if (!match) return;

  const closed = await db.closeMatch(match.id, { status: 'cancelled', result_type: 'canal_deletado' });
  if (!closed) return; // já tinha sido resolvida antes do canal sumir

  await Promise.all([
    db.setStatus(match.guild_id, match.player1_id, 'idle', null),
    db.setStatus(match.guild_id, match.player2_id, 'idle', null),
  ]);

  console.log(
    `[ARENA] Partida ${match.id} cancelada automaticamente (sala deletada) — jogadores ${match.player1_id} e ${match.player2_id} liberados.`
  );
}

module.exports = {
  sendPanel,
  handleJoinQueue,
  handleLeaveQueue,
  handleRanking,
  handleProfile,
  handleResult,
  handleCancel,
  handleAbandon,
  handleChannelDeleted,
  isModerator,
};
