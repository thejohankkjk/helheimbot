const WINDOW_MS = 3 * 60 * 1000;

// Map<"guildId:userId:tipo", number[]> — timestamps das ações recentes
const actionLog = new Map();

function key(guildId, userId, tipo) {
  return `${guildId}:${userId}:${tipo}`;
}

/** Registra uma ação e retorna quantas ocorreram na janela de 3 min (incluindo essa) */
function recordAndCount(guildId, userId, tipo) {
  const k = key(guildId, userId, tipo);
  const now = Date.now();
  const timestamps = (actionLog.get(k) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  actionLog.set(k, timestamps);
  return timestamps.length;
}

/** Limpa o contador de alguém (chamado depois de aplicar a punição, pra não punir de novo em loop) */
function clear(guildId, userId, tipo) {
  actionLog.delete(key(guildId, userId, tipo));
}

module.exports = { recordAndCount, clear };
