const { supabase } = require('../supabase');

const PLAYERS = 'arena_players';
const MATCHES = 'arena_matches';
const CONFIG = 'arena_config';

const STARTING_POINTS = 0;

/** Busca o jogador; cria com pontuação inicial se não existir */
async function getOrCreatePlayer(guildId, discordId) {
  const { data: existing, error: findErr } = await supabase
    .from(PLAYERS)
    .select('*')
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing;

  const { data, error } = await supabase
    .from(PLAYERS)
    .insert({ guild_id: guildId, discord_id: discordId, points: STARTING_POINTS })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function setStatus(guildId, discordId, status, currentMatchId = null, queueMessageId = undefined) {
  const update = { status, current_match_id: currentMatchId, updated_at: new Date().toISOString() };
  if (queueMessageId !== undefined) update.queue_message_id = queueMessageId;

  const { data, error } = await supabase
    .from(PLAYERS)
    .update(update)
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Procura outro jogador na fila (o mais antigo primeiro), excluindo o próprio usuário */
async function findQueuedOpponent(guildId, excludeDiscordId) {
  const { data, error } = await supabase
    .from(PLAYERS)
    .select('*')
    .eq('guild_id', guildId)
    .eq('status', 'queued')
    .neq('discord_id', excludeDiscordId)
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createMatch(guildId, player1Id, player2Id, channelId) {
  const { data, error } = await supabase
    .from(MATCHES)
    .insert({
      guild_id: guildId,
      player1_id: player1Id,
      player2_id: player2Id,
      channel_id: channelId,
      status: 'ongoing',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMatch(matchId) {
  const { data, error } = await supabase.from(MATCHES).select('*').eq('id', matchId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Fecha a partida de forma atômica: só atualiza se ela ainda estiver 'ongoing'.
 * Retorna null se a partida já tinha sido finalizada/cancelada (evita registro duplicado).
 */
async function closeMatch(matchId, fields) {
  const { data, error } = await supabase
    .from(MATCHES)
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq('id', matchId)
    .eq('status', 'ongoing')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function addPoints(guildId, discordId, delta, resultKind) {
  const player = await getOrCreatePlayer(guildId, discordId);
  const newPoints = Math.max(0, player.points + delta);
  const update = {
    points: newPoints,
    updated_at: new Date().toISOString(),
  };
  if (resultKind === 'win') {
    update.wins = player.wins + 1;
    update.current_streak = player.current_streak + 1;
    update.best_streak = Math.max(player.best_streak, update.current_streak);
  }
  if (resultKind === 'loss') {
    update.losses = player.losses + 1;
    update.current_streak = 0;
  }

  const { data, error } = await supabase
    .from(PLAYERS)
    .update(update)
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .select()
    .single();
  if (error) throw error;
  return { before: player.points, after: data.points, player: data };
}

async function setPoints(guildId, discordId, points) {
  await getOrCreatePlayer(guildId, discordId);
  const { data, error } = await supabase
    .from(PLAYERS)
    .update({ points, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRanking(guildId, limit = 10) {
  const { data, error } = await supabase
    .from(PLAYERS)
    .select('*')
    .eq('guild_id', guildId)
    .order('points', { ascending: false })
    .order('wins', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Posição do jogador no ranking (1-based), calculada por pontos (empate desempata por vitórias) */
async function getRankPosition(guildId, discordId) {
  const player = await getOrCreatePlayer(guildId, discordId);
  const { count, error } = await supabase
    .from(PLAYERS)
    .select('discord_id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .or(`points.gt.${player.points},and(points.eq.${player.points},wins.gt.${player.wins})`);
  if (error) throw error;
  return { position: (count || 0) + 1, player };
}

async function getOngoingMatches(guildId) {
  const { data, error } = await supabase
    .from(MATCHES)
    .select('*')
    .eq('guild_id', guildId)
    .eq('status', 'ongoing')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/** Busca uma partida ongoing pelo channel_id (usado quando o canal é deletado manualmente) */
async function getMatchByChannel(channelId) {
  const { data, error } = await supabase
    .from(MATCHES)
    .select('*')
    .eq('channel_id', channelId)
    .eq('status', 'ongoing')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getVipLink(guildId) {
  const { data, error } = await supabase.from(CONFIG).select('vip_link').eq('guild_id', guildId).maybeSingle();
  if (error) throw error;
  return data?.vip_link || null;
}

async function setVipLink(guildId, link) {
  const { data, error } = await supabase
    .from(CONFIG)
    .upsert({ guild_id: guildId, vip_link: link, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function suspendPlayer(guildId, discordId, hours) {
  await getOrCreatePlayer(guildId, discordId);
  const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(PLAYERS)
    .update({ suspended_until: until, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function liftSuspension(guildId, discordId) {
  await getOrCreatePlayer(guildId, discordId);
  const { data, error } = await supabase
    .from(PLAYERS)
    .update({ suspended_until: null, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId)
    .eq('discord_id', discordId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function isSuspended(player) {
  return Boolean(player.suspended_until) && new Date(player.suspended_until).getTime() > Date.now();
}

module.exports = {
  STARTING_POINTS,
  getOrCreatePlayer,
  setStatus,
  findQueuedOpponent,
  createMatch,
  getMatch,
  closeMatch,
  addPoints,
  setPoints,
  getRanking,
  getRankPosition,
  getOngoingMatches,
  getMatchByChannel,
  getVipLink,
  setVipLink,
  suspendPlayer,
  liftSuspension,
  isSuspended,
};
