const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('./config');
const { isModerator } = require('./arena/commands');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // limite máximo do Discord (28 dias)

const castigoCommand = new SlashCommandBuilder()
  .setName('castigo')
  .setDescription('Aplica timeout (silenciar) em alguém, avisando o motivo por DM antes')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((opt) => opt.setName('usuario').setDescription('Quem castigar').setRequired(true))
  .addStringOption((opt) =>
    opt
      .setName('tempo')
      .setDescription('Ex: 3d, 5h, 30min, 3d e 2h, 4 horas e 30 min')
      .setRequired(true)
  )
  .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo do castigo').setRequired(true))
  .toJSON();

/**
 * Interpreta textos como "3d", "5h", "30 min", "3d e 2h", "4 horas e 30 min" e devolve
 * milissegundos (ou null se não achar nenhum número com unidade).
 */
function parseDuration(input) {
  const regex = /(\d+)\s*(dias?|horas?|minutos?|min|d|h|m)\b/gi;
  const text = input.toLowerCase();
  let match;
  let totalMs = 0;
  let found = false;

  while ((match = regex.exec(text)) !== null) {
    found = true;
    const value = parseInt(match[1], 10);
    const unit = match[2];

    if (unit.startsWith('d')) totalMs += value * 24 * 60 * 60 * 1000;
    else if (unit.startsWith('h')) totalMs += value * 60 * 60 * 1000;
    else totalMs += value * 60 * 1000; // min / minuto(s) / m
  }

  return found ? totalMs : null;
}

function formatDuration(ms) {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}min`);
  return parts.length ? parts.join(' ') : '0min';
}

function castigoAlertEmbed(guild, motivo, durationMs, moderatorTag) {
  const endsUnix = Math.floor((Date.now() + durationMs) / 1000);
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🚨 Alerta!!')
    .setThumbnail(guild.iconURL() || null)
    .setDescription(
      `Você recebeu um **castigo (timeout)** no servidor **${guild.name}**.\n\n` +
        `📋 **Motivo:** ${motivo}\n` +
        `⏳ **Duração:** ${formatDuration(durationMs)}\n` +
        `📅 **Termina:** <t:${endsUnix}:F> (<t:${endsUnix}:R>)\n` +
        `👮 **Responsável:** ${moderatorTag}\n\n` +
        `Enquanto durar, você não poderá enviar mensagens, falar em call nem reagir. ` +
        `Se acredita que isso foi um engano, entre em contato com a liderança da comunidade.`
    )
    .setFooter({ text: `${config.theme.footer} • bot by johankkjk` })
    .setTimestamp();
}

async function handleCastigoCommand(interaction) {
  if (!isModerator(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({ content: '⛔ Eu não tenho permissão de Silenciar Membros (timeout) nesse servidor.', ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const tempoTexto = interaction.options.getString('tempo');
  const motivo = interaction.options.getString('motivo');

  const durationMs = parseDuration(tempoTexto);
  if (!durationMs || durationMs <= 0) {
    await interaction.reply({
      content: '⚠️ Não consegui entender esse tempo. Exemplos válidos: `3d`, `5h`, `30min`, `3d e 2h`, `4 horas e 30 min`.',
      ephemeral: true,
    });
    return;
  }

  const clampedMs = Math.min(durationMs, MAX_TIMEOUT_MS);
  const wasClamped = clampedMs < durationMs;

  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: '⛔ Essa pessoa não está nesse servidor.', ephemeral: true });
    return;
  }
  if (!targetMember.moderatable) {
    await interaction.reply({
      content: '⛔ Não consigo castigar essa pessoa (cargo dela é igual ou maior que o meu, ou é o dono do servidor).',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Avisa por DM antes de aplicar (mesmo padrão do /ban); DM fechada não impede o castigo
  let dmSent = true;
  try {
    await targetUser.send({ embeds: [castigoAlertEmbed(guild, motivo, clampedMs, interaction.user.tag)] });
  } catch {
    dmSent = false;
  }

  try {
    await targetMember.timeout(clampedMs, motivo);
  } catch (err) {
    console.error('[CASTIGO] Erro ao aplicar timeout:', err);
    await interaction.editReply('❌ Não consegui aplicar o castigo. Veja os logs.');
    return;
  }

  await interaction.editReply(
    `✅ <@${targetUser.id}> foi castigado(a) por **${formatDuration(clampedMs)}**.\n` +
      `📋 Motivo: ${motivo}\n` +
      `📩 DM enviada: ${dmSent ? 'sim' : 'não (DM fechada)'}` +
      (wasClamped ? `\n⚠️ O tempo pedido passava do limite do Discord (28 dias), ajustei pro máximo.` : '')
  );
}

module.exports = { castigoCommand, handleCastigoCommand, parseDuration, formatDuration };
