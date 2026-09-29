const { AuditLogEvent } = require('discord.js');
const db = require('./db');
const tracker = require('./tracker');

const SUPER_USER_ID = '463341116104900608';
const PUNISH_REASON_PREFIX = '[AUTOMOD]';

const AUDIT_TYPE_MAP = {
  chats: AuditLogEvent.ChannelDelete,
  cargos: AuditLogEvent.RoleDelete,
  ban: AuditLogEvent.MemberBanAdd,
};

const THRESHOLD_FIELD = { chats: 'channel_threshold', cargos: 'role_threshold', ban: 'ban_threshold' };
const PUNISHMENT_FIELD = { chats: 'channel_punishment', cargos: 'role_punishment', ban: 'ban_punishment' };

/** Busca no audit log quem foi o responsável por uma ação recente */
async function getRecentExecutor(guild, auditType, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 });
    const entry = logs.entries.find(
      (e) => (!targetId || e.targetId === targetId) && Date.now() - e.createdTimestamp < 10_000
    );
    return entry?.executor || null;
  } catch (err) {
    console.error('[AUTOMOD] Erro ao ler audit log:', err);
    return null;
  }
}

async function handleDestructiveAction(guild, tipo, targetId) {
  if (!guild) return;

  const config = await db.getConfig(guild.id).catch(() => null);
  if (!config || !config.enabled) return;

  const executor = await getRecentExecutor(guild, AUDIT_TYPE_MAP[tipo], targetId);
  if (!executor || executor.bot) return; // não identificado, ou foi o próprio bot (ex: /resetall)
  if (executor.id === SUPER_USER_ID || executor.id === guild.ownerId) return; // donos/super usuário são isentos

  const count = tracker.recordAndCount(guild.id, executor.id, tipo);
  const threshold = config[THRESHOLD_FIELD[tipo]];

  if (count < threshold) return;

  tracker.clear(guild.id, executor.id, tipo);
  const punishment = config[PUNISHMENT_FIELD[tipo]];
  await applyPunishment(guild, executor.id, punishment, tipo);
}

async function applyPunishment(guild, userId, punishment, tipo) {
  const labelMap = { chats: 'exclusão em massa de canais', cargos: 'exclusão em massa de cargos', ban: 'banimentos em massa' };
  const reason = `${PUNISH_REASON_PREFIX} Ações suspeitas: ${labelMap[tipo] || tipo}`;

  console.log(`[AUTOMOD] Punindo ${userId} em ${guild.id} (${punishment}) — motivo: ${labelMap[tipo]}`);

  try {
    if (punishment === 'timeout') {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) await member.timeout(24 * 60 * 60 * 1000, reason);
    } else if (punishment === 'kick') {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member) await member.kick(reason);
    } else {
      await guild.members.ban(userId, { reason });
      const unbanAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await db.scheduleUnban(guild.id, userId, unbanAt).catch(() => {});
    }
  } catch (err) {
    console.error('[AUTOMOD] Erro ao aplicar punição:', err);
  }
}

/** Roda periodicamente: desbane quem já cumpriu as 24h de ban automático */
async function sweepScheduledUnbans(client) {
  const due = await db.getDueUnbans().catch(() => []);
  for (const entry of due) {
    try {
      const guild = await client.guilds.fetch(entry.guild_id).catch(() => null);
      if (guild) {
        await guild.members.unban(entry.user_id, '[AUTOMOD] Fim do banimento automático de 24h').catch(() => {});
      }
    } finally {
      await db.removeScheduledUnban(entry.id).catch(() => {});
    }
  }
}

function registerAutomodListeners(client) {
  client.on('channelDelete', (channel) => {
    handleDestructiveAction(channel.guild, 'chats', channel.id).catch((err) =>
      console.error('[AUTOMOD] Erro no listener de canal:', err)
    );
  });

  client.on('roleDelete', (role) => {
    handleDestructiveAction(role.guild, 'cargos', role.id).catch((err) =>
      console.error('[AUTOMOD] Erro no listener de cargo:', err)
    );
  });

  client.on('guildBanAdd', (ban) => {
    handleDestructiveAction(ban.guild, 'ban', ban.user.id).catch((err) =>
      console.error('[AUTOMOD] Erro no listener de ban:', err)
    );
  });

  // Checa a cada 5 minutos se algum ban automático de 24h já pode ser revertido
  setInterval(() => sweepScheduledUnbans(client).catch((err) => console.error('[AUTOMOD] Erro no sweep de unban:', err)), 5 * 60 * 1000);
}

module.exports = { registerAutomodListeners, SUPER_USER_ID };
