const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: { persistSession: false },
});

const TABLE = 'recruitment_applications';

/** Busca uma aplicação em andamento do usuário no servidor (se existir) */
async function findOpenApplication(guildId, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('status', 'em_andamento')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data && data.length ? data[0] : null;
}

/** Busca uma aplicação pelo canal do ticket */
async function findApplicationByChannel(channelId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('channel_id', channelId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createApplication({ guildId, userId, username, channelId }) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      guild_id: guildId,
      user_id: userId,
      username,
      channel_id: channelId,
      status: 'em_andamento',
      current_question: 0,
      answers: [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function saveAnswer(applicationId, answers, nextQuestionIndex) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      answers,
      current_question: nextQuestionIndex,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function finishApplication(applicationId, status, reviewedBy = 'auto') {
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  findOpenApplication,
  findApplicationByChannel,
  createApplication,
  saveAnswer,
  finishApplication,
};
