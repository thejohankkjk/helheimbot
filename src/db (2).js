const { supabase } = require('../supabase');

const CONFIG = 'automod_config';
const PERMISSIONS = 'automod_permissions';
const UNBANS = 'automod_scheduled_unbans';

const DEFAULT_CONFIG = {
  enabled: false,
  channel_threshold: 3,
  channel_punishment: 'ban',
  role_threshold: 3,
  role_punishment: 'ban',
  ban_threshold: 3,
  ban_punishment: 'ban',
};

async function getConfig(guildId) {
  const { data, error } = await supabase.from(CONFIG).select('*').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data || { guild_id: guildId, ...DEFAULT_CONFIG };
}

async function setEnabled(guildId, enabled) {
  const { error } = await supabase
    .from(CONFIG)
    .upsert({ guild_id: guildId, enabled, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function setThresholdAndPunishment(guildId, tipo, quantia, punicao) {
  const fieldMap = {
    chats: { threshold: 'channel_threshold', punishment: 'channel_punishment' },
    cargos: { threshold: 'role_threshold', punishment: 'role_punishment' },
    ban: { threshold: 'ban_threshold', punishment: 'ban_punishment' },
  };
  const fields = fieldMap[tipo];
  if (!fields) throw new Error(`Tipo inválido: ${tipo}`);

  const current = await getConfig(guildId);
  const update = {
    guild_id: guildId,
    enabled: current.enabled,
    channel_threshold: current.channel_threshold,
    channel_punishment: current.channel_punishment,
    role_threshold: current.role_threshold,
    role_punishment: current.role_punishment,
    ban_threshold: current.ban_threshold,
    ban_punishment: current.ban_punishment,
    updated_at: new Date().toISOString(),
  };
  update[fields.threshold] = quantia;
  update[fields.punishment] = punicao;

  const { error } = await supabase.from(CONFIG).upsert(update);
  if (error) throw error;
}

async function isAuthorized(guildId, userId) {
  const { data, error } = await supabase
    .from(PERMISSIONS)
    .select('user_id')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function addPermission(guildId, userId, addedBy) {
  const { error } = await supabase.from(PERMISSIONS).upsert({ guild_id: guildId, user_id: userId, added_by: addedBy });
  if (error) throw error;
}

async function removePermission(guildId, userId) {
  const { error } = await supabase.from(PERMISSIONS).delete().eq('guild_id', guildId).eq('user_id', userId);
  if (error) throw error;
}

async function scheduleUnban(guildId, userId, unbanAtIso) {
  const { error } = await supabase.from(UNBANS).insert({ guild_id: guildId, user_id: userId, unban_at: unbanAtIso });
  if (error) throw error;
}

async function getDueUnbans() {
  const { data, error } = await supabase.from(UNBANS).select('*').lte('unban_at', new Date().toISOString());
  if (error) throw error;
  return data || [];
}

async function removeScheduledUnban(id) {
  const { error } = await supabase.from(UNBANS).delete().eq('id', id);
  if (error) throw error;
}

module.exports = {
  getConfig,
  setEnabled,
  setThresholdAndPunishment,
  isAuthorized,
  addPermission,
  removePermission,
  scheduleUnban,
  getDueUnbans,
  removeScheduledUnban,
};
