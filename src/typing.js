const { SlashCommandBuilder, ChannelType, WebhookClient } = require('discord.js');
const db = require('./supabase');

const TYPING_INTERVAL_MS = 8_000;        // indicador dura ~10s, reenvia antes de sumir
const MAX_CONSECUTIVE_FAILURES = 5;      // após N falhas seguidas, entra em modo recovery
const RECOVERY_BASE_DELAY_MS = 5_000;    // 5s base pro backoff
const MAX_RECOVERY_DELAY_MS = 60_000;    // teto de 1min entre tentativas no recovery
const CHANNEL_REFRESH_THRESHOLD = 3;     // após 3 falhas, tenta re-fetch o canal

const OWNER_ID = '463341116104900608';

/**
 * Estado ativo por canal:
 * {
 *   channelId,
 *   intervalId,
 *   consecutiveFailures,
 *   recoveryTimeoutId,
 *   isRecovering,
 *   lastSuccess,
 *   guildId,
 *   startedAt
 * }
 */
const activeTyping = new Map();

/** Tabela opcional no Supabase pra persistir canais ativos entre restarts */
const TYPING_TABLE = 'bot_typing_state';

const typingCommand = new SlashCommandBuilder()
  .setName('digitando')
  .setDescription('Faz o bot parecer "digitando..." sem parar num canal (brincadeira)')
  .addSubcommand((sub) =>
    sub
      .setName('on')
      .setDescription('Liga')
      .addChannelOption((opt) =>
        opt.setName('canal').setDescription('Canal (padrão: este aqui)').addChannelTypes(ChannelType.GuildText).setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('off')
      .setDescription('Desliga')
      .addChannelOption((opt) =>
        opt.setName('canal').setDescription('Canal (padrão: este aqui)').addChannelTypes(ChannelType.GuildText).setRequired(false)
      )
  )
  .toJSON();

/**
 * Tenta enviar typing, com tratamento de erro granular.
 * Retorna { ok: true } ou { ok: false, error, code, shouldRefreshChannel }
 */
async function sendTypingSafe(channel) {
  try {
    await channel.sendTyping();
    return { ok: true };
  } catch (err) {
    const code = err.code || err.status || 'UNKNOWN';
    const message = err.message || String(err);

    // Erros que sugerem que o canal pode ter mudado (deletado, movido, permissão)
    const shouldRefreshChannel = [
      10003, // Unknown Channel
      50001, // Missing Access
      50013, // Missing Permissions
      'ENOENT',
      'NOT_FOUND',
    ].some(c => code === c || message.includes(c));

    // Erros de rate limit - não conta como falha "real", só espera
    const isRateLimit = code === 429 || code === 'RATE_LIMIT' || message.includes('rate limit');

    return {
      ok: false,
      error: message,
      code,
      shouldRefreshChannel,
      isRateLimit
    };
  }
}

/**
 * Tenta re-fetchar o canal do cache ou da API
 */
async function refreshChannel(channel) {
  try {
    // Primeiro tenta do cache
    const cached = channel.client.channels.cache.get(channel.id);
    if (cached && cached.isTextBased()) return cached;

    // Senão fetch da API
    const fetched = await channel.client.channels.fetch(channel.id);
    if (fetched && fetched.isTextBased()) return fetched;

    return null;
  } catch {
    return null;
  }
}

/**
 * Inicia/reinicia o loop de typing para um canal
 */
function startTypingLoop(state, client) {
  const { channelId } = state;

  const tick = async () => {
    const currentState = activeTyping.get(channelId);
    if (!currentState) return; // foi desligado

    let channel = client.channels.cache.get(channelId);

    // Se não tem no cache, tenta fetch
    if (!channel) {
      try {
        channel = await client.channels.fetch(channelId);
      } catch {
        channel = null;
      }
    }

    if (!channel || !channel.isTextBased()) {
      // Canal não existe mais ou não é de texto
      await handleFailure(currentState, { ok: false, error: 'Channel not found', code: 'CHANNEL_GONE', shouldRefreshChannel: false });
      return;
    }

    const result = await sendTypingSafe(channel);

    if (result.ok) {
      // Sucesso - reseta contador de falhas
      currentState.consecutiveFailures = 0;
      currentState.lastSuccess = Date.now();
      currentState.channel = channel; // atualiza referência

      // Se estava em recovery, sai do recovery
      if (currentState.isRecovering) {
        currentState.isRecovering = false;
        if (currentState.recoveryTimeoutId) {
          clearTimeout(currentState.recoveryTimeoutId);
          currentState.recoveryTimeoutId = null;
        }
        console.log(`[TYPING] Recovery concluído para canal ${channelId}`);
      }
      return;
    }

    // Falha
    await handleFailure(currentState, result, channel);
  };

  // Executa imediatamente e depois agenda
  tick();
  state.intervalId = setInterval(tick, TYPING_INTERVAL_MS);
}

/**
 * Lida com falha no envio de typing
 */
async function handleFailure(state, result, channel) {
  const { channelId } = state;

  // Rate limit não conta como falha consecutiva, só loga e espera
  if (result.isRateLimit) {
    console.warn(`[TYPING] Rate limit no canal ${channelId}, aguardando...`);
    return;
  }

  state.consecutiveFailures++;
  console.warn(`[TYPING] Falha ${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} no canal ${channelId}: ${result.error} (code: ${result.code})`);

  // Tenta re-fetch o canal após alguns erros
  if (state.consecutiveFailures >= CHANNEL_REFRESH_THRESHOLD && result.shouldRefreshChannel && channel) {
    console.log(`[TYPING] Tentando re-fetch do canal ${channelId}...`);
    const refreshed = await refreshChannel(channel);
    if (refreshed) {
      state.channel = refreshed;
      console.log(`[TYPING] Canal ${channelId} re-fetchado com sucesso`);
      // Não reseta falhas ainda - espera um sucesso real
    } else {
      console.warn(`[TYPING] Re-fetch falhou para canal ${channelId}`);
    }
  }

  // Entra em modo recovery após muitas falhas
  if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !state.isRecovering) {
    enterRecoveryMode(state);
  }
}

/**
 * Modo recovery: para o intervalo normal e tenta com backoff exponencial
 */
function enterRecoveryMode(state) {
  const { channelId } = state;

  console.log(`[TYPING] Entrando em modo RECOVERY para canal ${channelId}`);
  state.isRecovering = true;

  // Para o intervalo normal
  if (state.intervalId) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }

  const attemptRecovery = async (attempt = 1) => {
    const currentState = activeTyping.get(channelId);
    if (!currentState || !currentState.isRecovering) return; // foi desligado ou cancelado

    console.log(`[TYPING] Recovery attempt ${attempt} para canal ${channelId}`);

    // Tenta pegar o canal
    let channel = currentState.channel;
    if (!channel) {
      try {
        channel = await currentState.client?.channels?.fetch(channelId);
      } catch {}
    }

    if (!channel || !channel.isTextBased()) {
      console.warn(`[TYPING] Recovery: canal ${channelId} ainda indisponível`);
      scheduleNextRecovery(currentState, attempt + 1);
      return;
    }

    const result = await sendTypingSafe(channel);

    if (result.ok) {
      // Recuperou!
      currentState.consecutiveFailures = 0;
      currentState.lastSuccess = Date.now();
      currentState.channel = channel;
      currentState.isRecovering = false;
      currentState.recoveryTimeoutId = null;
      console.log(`[TYPING] Recovery BEM-SUCEDIDO para canal ${channelId}`);
      startTypingLoop(currentState, channel.client);
      return;
    }

    // Falhou - agenda próxima tentativa com backoff
    scheduleNextRecovery(currentState, attempt + 1);
  };

  const scheduleNextRecovery = (currentState, nextAttempt) => {
    const delay = Math.min(
      RECOVERY_BASE_DELAY_MS * Math.pow(2, nextAttempt - 2), // backoff exponencial
      MAX_RECOVERY_DELAY_MS
    );
    // Adiciona jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    const finalDelay = Math.floor(delay + jitter);

    console.log(`[TYPING] Próxima tentativa de recovery em ${Math.round(finalDelay / 1000)}s (attempt ${nextAttempt})`);

    currentState.recoveryTimeoutId = setTimeout(() => {
      attemptRecovery(nextAttempt);
    }, finalDelay);
  };

  // Inicia primeira tentativa de recovery
  attemptRecovery(1);
}

/**
 * Para o typing num canal
 */
function stopTyping(channelId) {
  const state = activeTyping.get(channelId);
  if (!state) return false;

  if (state.intervalId) clearInterval(state.intervalId);
  if (state.recoveryTimeoutId) clearTimeout(state.recoveryTimeoutId);

  activeTyping.delete(channelId);
  return true;
}

/**
 * Persiste estado no Supabase (opcional - survive restarts)
 */
async function persistTypingState(channelId, guildId, action) {
  try {
    if (action === 'start') {
      await db.supabase.from(TYPING_TABLE).upsert({
        channel_id: channelId,
        guild_id: guildId,
        active: true,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } else if (action === 'stop') {
      await db.supabase.from(TYPING_TABLE)
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('channel_id', channelId);
    }
  } catch (err) {
    // Silencioso - persistência é opcional
    console.debug(`[TYPING] Persistência falhou (ignorado):`, err.message);
  }
}

/**
 * Restaura canais ativos do Supabase no startup
 */
async function restoreTypingState(client) {
  try {
    const { data, error } = await db.supabase
      .from(TYPING_TABLE)
      .select('channel_id, guild_id')
      .eq('active', true);

    if (error) throw error;
    if (!data?.length) return;

    console.log(`[TYPING] Restaurando ${data.length} canal(is) ativo(s) do banco...`);

    for (const row of data) {
      try {
        const channel = await client.channels.fetch(row.channel_id).catch(() => null);
        if (channel && channel.isTextBased()) {
          await handleTypingOn(channel, channel.guild, true); // true = restored
          console.log(`[TYPING] Restaurado: ${row.channel_id}`);
        } else {
          // Canal não existe mais - marca inativo no banco
          await db.supabase.from(TYPING_TABLE)
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq('channel_id', row.channel_id);
        }
      } catch (err) {
        console.warn(`[TYPING] Falha ao restaurar ${row.channel_id}:`, err.message);
      }
    }
  } catch (err) {
    // Tabela pode não existir - ignora silenciosamente
    if (err.code !== '42P01') { // undefined_table
      console.warn('[TYPING] Restore falhou:', err.message);
    }
  }
}

/**
 * Lógica principal do /digitando on
 */
async function handleTypingOn(channel, guild, isRestored = false) {
  if (activeTyping.has(channel.id)) {
    return { alreadyActive: true };
  }

  const state = {
    channelId: channel.id,
    guildId: guild.id,
    channel,
    client: channel.client,
    consecutiveFailures: 0,
    intervalId: null,
    recoveryTimeoutId: null,
    isRecovering: false,
    lastSuccess: Date.now(),
    startedAt: Date.now(),
  };

  activeTyping.set(channel.id, state);
  startTypingLoop(state, channel.client);

  if (!isRestored) {
    await persistTypingState(channel.id, guild.id, 'start');
  }

  return { success: true };
}

/**
 * Lógica principal do /digitando off
 */
async function handleTypingOff(channelId, guildId) {
  const stopped = stopTyping(channelId);
  if (stopped) {
    await persistTypingState(channelId, guildId, 'stop');
  }
  return { stopped };
}

async function handleTypingCommand(interaction) {
  if (interaction.user.id !== OWNER_ID) {
    await interaction.reply({ content: '⛔ Só o dono do bot pode usar esse comando.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  if (sub === 'on') {
    const result = await handleTypingOn(channel, interaction.guild);
    if (result.alreadyActive) {
      await interaction.reply({ content: `⚠️ Já estou "digitando" em <#${channel.id}>.`, ephemeral: true });
      return;
    }
    await interaction.reply({ content: `✅ Agora tô "digitando..." sem parar em <#${channel.id}> 😂`, ephemeral: true });
    return;
  }

  // off
  const result = await handleTypingOff(channel.id, interaction.guild.id);
  if (!result.stopped) {
    await interaction.reply({ content: `Eu não tava "digitando" em <#${channel.id}>.`, ephemeral: true });
    return;
  }
  await interaction.reply({ content: `✅ Parei de "digitar" em <#${channel.id}>.`, ephemeral: true });
}

/**
 * Exporta funções pra uso externo (ex: restore no startup)
 */
module.exports = {
  typingCommand,
  handleTypingCommand,
  restoreTypingState,
  activeTyping, // expõe pra debug/status
};