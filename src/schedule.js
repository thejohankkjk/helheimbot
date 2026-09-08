const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  EmbedBuilder,
} = require('discord.js');
const config = require('./config');
const { isModerator } = require('./arena/commands');

const START_BUTTON_ID = 'schedule_start';
const TIME_SELECT_ID = 'schedule_time_select';
const FINISH_BUTTON_ID = 'schedule_mark_finished';

const painelCommand = new SlashCommandBuilder()
  .setName('painel')
  .setDescription('Envia um painel fixo do bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((sub) => sub.setName('rec2').setDescription('Envia o painel de marcação de horário de recrutamento'))
  .toJSON();

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(config.theme.color)
    .setTitle(`📅 MARCAR RECRUTAMENTO — ${config.theme.name}`)
    .setDescription(
      `Já foi aprovado(a) na entrevista e falta só marcar o horário? Clique no botão abaixo.\n\n` +
        `📋 **COMO FUNCIONA:**\n` +
        `• **1.** Clique em **Marcar Recrutamento** pra abrir sua sala.\n` +
        `• **2.** Escolha o horário disponível (tarde ou noite).\n` +
        `• **3.** Aguarde um recrutador te chamar na sala pra combinar os detalhes.\n\n` +
        `⚠️ **ATENÇÃO:** se você não comparecer no horário marcado, vai precisar marcar de novo só na semana seguinte.`
    )
    .setFooter({ text: config.theme.footer });
}

async function handlePainelCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub !== 'rec2') return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(START_BUTTON_ID).setLabel('Marcar Recrutamento').setStyle(ButtonStyle.Danger).setEmoji('📅')
  );

  await interaction.channel.send({ embeds: [panelEmbed()], components: [row] });
  await interaction.reply({ content: '✅ Painel enviado.', ephemeral: true });
}

async function handleStartButton(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  const channelName = `recrutamento-${safeName}`;

  const existing = guild.channels.cache.find((c) => c.name === channelName);
  if (existing) {
    await interaction.editReply(`⚠️ Você já tem uma sala de marcação aberta: <#${existing.id}>`);
    return;
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: config.staffRoleId,
        type: OverwriteType.Role,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  await interaction.editReply(`✅ Sala criada: <#${channel.id}>`);

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(TIME_SELECT_ID)
      .setPlaceholder('Selecione o horário disponível')
      .addOptions(
        { label: 'De tarde', value: 'tarde', emoji: '🌤️' },
        { label: 'De noite', value: 'noite', emoji: '🌙' }
      )
  );

  const embed = new EmbedBuilder()
    .setColor(config.theme.color)
    .setTitle(`📅 MARCAR RECRUTAMENTO — ${config.theme.name}`)
    .setDescription(
      `Saudações, <@${interaction.user.id}>!\n\n` +
        `Selecione abaixo o horário em que você está disponível para o seu recrutamento.\n\n` +
        `⚠️ Se você não comparecer no horário marcado, só poderá marcar de novo na próxima semana.`
    );

  await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [selectRow] });
}

async function handleTimeSelect(interaction) {
  const horario = interaction.values[0];
  const horarioLabel = horario === 'tarde' ? '🌤️ De tarde' : '🌙 De noite';

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(config.theme.successColor)
        .setTitle(`📅 MARCAR RECRUTAMENTO — ${config.theme.name}`)
        .setDescription(
          `✅ Horário marcado: **${horarioLabel}**\n\n` +
            `Um recrutador vai te chamar aqui nessa sala pra combinar os detalhes. Fique atento(a)!\n\n` +
            `⚠️ Se você não comparecer, vai precisar marcar de novo só na semana que vem.`
        ),
    ],
    components: [],
  });

  if (config.scheduleLogChannelId) {
    const logChannel = await interaction.guild.channels.fetch(config.scheduleLogChannelId).catch(() => null);
    if (logChannel) {
      await logChannel
        .send({
          content: `📅 <@${interaction.user.id}> marcou recrutamento para **${horarioLabel}** — sala: <#${interaction.channelId}>`,
        })
        .catch(() => {});
    }
  }

  // Botão de finalizar fica na própria sala, pra quem for atender já ter à mão
  const finishRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(FINISH_BUTTON_ID).setLabel('Marcar como Finalizado').setStyle(ButtonStyle.Success).setEmoji('✅')
  );
  await interaction.channel.send({
    content: '👮 Quando o recrutamento for concluído, a staff pode finalizar e fechar a sala com o botão abaixo.',
    components: [finishRow],
  });
}

async function handleFinishButton(interaction) {
  if (!isModerator(interaction.member)) {
    await interaction.reply({ content: '⛔ Só a staff pode finalizar esse recrutamento.', ephemeral: true });
    return;
  }

  await interaction.reply('✅ Recrutamento marcado como finalizado. Essa sala será apagada em instantes.');
  setTimeout(() => interaction.channel.delete('Recrutamento agendado finalizado').catch(() => {}), 5_000);
}

module.exports = {
  painelCommand,
  handlePainelCommand,
  handleStartButton,
  handleTimeSelect,
  handleFinishButton,
  START_BUTTON_ID,
  TIME_SELECT_ID,
  FINISH_BUTTON_ID,
};
