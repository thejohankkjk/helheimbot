const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { supabase } = require('./supabase');

const START_BUTTON_ID = 'confess_start';
const MODAL_ID = 'confess_modal';
const TEXT_INPUT_ID = 'confess_text';

// Só esse ID pode usar /confess-log (dar/tirar permissão de ver autores) — nem staff, nem admin.
const OWNER_ID = '463341116104900608';

// Vermelho mais vivo/amigável, separado do vermelho escuro usado no resto do bot —
// essa função tem uma identidade visual própria (clean, branco/cinza, vermelho de destaque).
const CONFESS_COLOR = 0xff4d6d;

// Cooldown simples em memória pra não deixar alguém floodar o chat de mensagens anônimas
const lastSentAt = new Map(); // userId -> timestamp
const COOLDOWN_MS = 30_000;

const confessPanelCommand = new SlashCommandBuilder()
  .setName('confess-painel')
  .setDescription('Envia o painel do Helheim-Tell (mensagens anônimas) neste canal')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .toJSON();

const confessAutorCommand = new SlashCommandBuilder()
  .setName('confess-autor')
  .setDescription('Consulta quem enviou uma mensagem anônima específica (acesso restrito)')
  .addIntegerOption((opt) => opt.setName('numero').setDescription('Número da mensagem (#)').setRequired(true).setMinValue(1))
  .toJSON();

const confessLogCommand = new SlashCommandBuilder()
  .setName('confess-log')
  .setDescription('[Restrito ao dono] Dá ou tira de alguém a permissão de ver quem manda cada mensagem anônima')
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Dá a permissão de ver autores das mensagens anônimas')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Quem liberar').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Tira a permissão de ver autores das mensagens anônimas')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Quem remover').setRequired(true))
  )
  .toJSON();

const BANNER_PATH = path.join(__dirname, '..', 'assets', 'confess-banner.png');

/** Retorna o anexo da imagem do painel (ou null se o arquivo não existir) */
function getPanelBannerAttachment() {
  if (!fs.existsSync(BANNER_PATH)) return null;
  return new AttachmentBuilder(BANNER_PATH, { name: 'confess-banner.png' });
}

function panelEmbed() {
  const embed = new EmbedBuilder()
    .setColor(CONFESS_COLOR)
    .setTitle('✈️ Helheim-Tell')
    .setDescription(
      `**Envie uma mensagem anônima no nosso chat!** 💌\n\n` +
        `Compartilhe um pensamento, um recado, um elogio ou qualquer coisa com a comunidade — ` +
        `de forma **totalmente anônima**. ✨\n\n` +
        `Clique no botão abaixo pra escrever a sua.`
    )
    .setFooter({ text: `${config.theme.name} Comunidade` });

  if (getPanelBannerAttachment()) embed.setImage('attachment://confess-banner.png');
  return embed;
}

function panelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(START_BUTTON_ID).setLabel('Enviar mensagem anônima').setStyle(ButtonStyle.Danger).setEmoji('✈️')
  );
}

async function handleConfessPanelCommand(interaction) {
  const banner = getPanelBannerAttachment();
  const payload = { embeds: [panelEmbed()], components: [panelRow()] };
  if (banner) payload.files = [banner];

  await interaction.channel.send(payload);
  await interaction.reply({ content: '✅ Painel enviado.', ephemeral: true });
}

async function handleConfessButton(interaction) {
  const remaining = lastSentAt.get(interaction.user.id)
    ? COOLDOWN_MS - (Date.now() - lastSentAt.get(interaction.user.id))
    : 0;

  if (remaining > 0) {
    await interaction.reply({
      content: `⏳ Calma aí! Espera mais ${Math.ceil(remaining / 1000)}s pra mandar outra mensagem anônima.`,
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle('Helheim-Tell ✈️')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(TEXT_INPUT_ID)
          .setLabel('Sua mensagem anônima')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
          .setPlaceholder('Escreva aqui... ninguém vai saber que foi você 💌')
      )
    );

  await interaction.showModal(modal);
}

async function handleConfessModalSubmit(interaction) {
  const content = interaction.fields.getTextInputValue(TEXT_INPUT_ID).trim();
  if (!content) {
    await interaction.reply({ content: '⚠️ Mensagem vazia, não rolou.', ephemeral: true });
    return;
  }

  const { data, error } = await supabase
    .from('confessions')
    .insert({ guild_id: interaction.guildId, author_id: interaction.user.id, content })
    .select()
    .single();

  if (error) {
    console.error('[CONFESS] Erro ao salvar:', error);
    await interaction.reply({ content: '❌ Não consegui enviar sua mensagem agora. Tenta de novo em instantes.', ephemeral: true });
    return;
  }

  lastSentAt.set(interaction.user.id, Date.now());

  const confessEmbed = new EmbedBuilder()
    .setColor(CONFESS_COLOR)
    .setAuthor({ name: `✈️ Mensagem Anônima #${data.number}` })
    .setDescription(content)
    .setFooter({ text: 'Helheim-Tell • ninguém sabe quem enviou 🤍' })
    .setTimestamp();

  const channel = await interaction.guild.channels.fetch(config.confessChannelId).catch(() => null);
  if (!channel) {
    await interaction.reply({ content: '❌ Não achei o canal de mensagens anônimas. Avise a staff.', ephemeral: true });
    return;
  }

  await channel.send({ embeds: [confessEmbed] });
  await interaction.reply({ content: `✅ Mensagem enviada anonimamente como **#${data.number}**! 💌`, ephemeral: true });
}

async function canSeeAuthors(interaction) {
  if (interaction.user.id === OWNER_ID) return true; // dono sempre pode, por padrão
  const { data } = await supabase
    .from('confess_permissions')
    .select('user_id')
    .eq('guild_id', interaction.guildId)
    .eq('user_id', interaction.user.id)
    .maybeSingle();
  return Boolean(data);
}

async function handleConfessLogCommand(interaction) {
  if (interaction.user.id !== OWNER_ID) {
    await interaction.reply({ content: '⛔ Só o dono do bot pode usar esse comando.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const usuario = interaction.options.getUser('usuario');

  if (sub === 'add') {
    const { error } = await supabase
      .from('confess_permissions')
      .upsert({ guild_id: interaction.guildId, user_id: usuario.id, added_by: interaction.user.id });
    if (error) {
      console.error('[CONFESS] Erro ao adicionar permissão:', error);
      await interaction.reply({ content: '❌ Não consegui dar a permissão. Tenta de novo.', ephemeral: true });
      return;
    }
    await interaction.reply({
      content: `✅ <@${usuario.id}> agora pode ver quem manda cada mensagem anônima (\`/confess-autor\`).`,
      ephemeral: true,
    });
  } else {
    const { error } = await supabase
      .from('confess_permissions')
      .delete()
      .eq('guild_id', interaction.guildId)
      .eq('user_id', usuario.id);
    if (error) {
      console.error('[CONFESS] Erro ao remover permissão:', error);
      await interaction.reply({ content: '❌ Não consegui remover a permissão. Tenta de novo.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `✅ <@${usuario.id}> não pode mais ver autores das mensagens anônimas.`, ephemeral: true });
  }
}

async function handleConfessAutorCommand(interaction) {
  if (!(await canSeeAuthors(interaction))) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const numero = interaction.options.getInteger('numero');

  const { data, error } = await supabase
    .from('confessions')
    .select('author_id, content, created_at')
    .eq('guild_id', interaction.guildId)
    .eq('number', numero)
    .maybeSingle();

  if (error || !data) {
    await interaction.reply({ content: `⚠️ Não achei a mensagem #${numero}.`, ephemeral: true });
    return;
  }

  const sentUnix = Math.floor(new Date(data.created_at).getTime() / 1000);
  await interaction.reply({
    content:
      `🔎 **Mensagem #${numero}**\n` +
      `👤 Autor: <@${data.author_id}> (\`${data.author_id}\`)\n` +
      `📅 Enviada: <t:${sentUnix}:F>\n` +
      `💬 Conteúdo: ${data.content}`,
    ephemeral: true,
  });
}

module.exports = {
  confessPanelCommand,
  confessAutorCommand,
  confessLogCommand,
  handleConfessPanelCommand,
  handleConfessButton,
  handleConfessModalSubmit,
  handleConfessAutorCommand,
  handleConfessLogCommand,
  START_BUTTON_ID,
  MODAL_ID,
  getPanelBannerAttachment,
};
