require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[CONFIG] Faltando a variável de ambiente: ${name}`);
    process.exit(1);
  }
  return value;
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: required('GUILD_ID'),
  staffRoleId: required('STAFF_ROLE_ID'),
  // Usuário(s) que sempre têm acesso total ao bot, independente de cargo (dono/desenvolvedor)
  superUserIds: ['463341116104900608'],
  // Cargos extras que também podem finalizar/cancelar/decidir partidas da Arena, além do staffRoleId
  arenaAdminRoleIds: [
    '1531131859289903224',
    '1528965837929709578',
    '1527713236227719308',
    '1531127593603043579',
    '1527713098876719146',
  ],
  approvedRoleId: required('APPROVED_ROLE_ID'),
  ticketCategoryId: required('TICKET_CATEGORY_ID'),
  arenaCategoryId: process.env.ARENA_CATEGORY_ID || null, // se vazio, usa a mesma categoria dos tickets
  arenaChannelId: process.env.ARENA_CHANNEL_ID || null, // canal público de avisos da Arena (entrou na fila, match encontrado)
  // Canal que recebe o histórico/resultado das partidas da Arena (diferente do log de recrutamento!)
  arenaLogChannelId: process.env.ARENA_LOG_CHANNEL_ID || '1543939733108035725',
  logChannelId: process.env.LOG_CHANNEL_ID || null, // canal de log do RECRUTAMENTO
  scheduleLogChannelId: process.env.SCHEDULE_LOG_CHANNEL_ID || '1546701357325492224',

  supabaseUrl: required('SUPABASE_URL'),
  supabaseKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  // ===== Personalização do formulário =====
  theme: {
    name: '𝑯𝒆𝒍𝒉𝒆𝒊𝒎',
    color: 0x8b0000, // vermelho escuro
    successColor: 0x2ecc71,
    failColor: 0xe74c3c,
    footer: 'Helheim • Recrutamento Oficial',
    bannerUrl: null, // coloque aqui a URL da imagem de banner do recrutamento, se quiser
    questionTimeLimitMs: 3 * 60 * 1000, // 3 minutos por pergunta
  },
};
