const {
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
const questions = require('./questions');
const db = require('./supabase');
const embeds = require('./embeds');

const CHOICE_PREFIX = 'rec_choice';
const TIME_PERIOD_SELECT_ID = 'rec_time_period_select';

/** Cria o canal privado (ticket) para o recrutamento */
async function createTicketChannel(guild, member) {
  const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';

  const channel = await guild.channels.create({
    name: `rec-${safeName}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: config.staffRoleId,
        type: OverwriteType.Role,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  return channel;
}

function buildChoiceRow(options) {
  const row = new ActionRowBuilder();
  options.forEach((opt, idx) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CHOICE_PREFIX}:${idx}`)
        .setLabel(opt)
        .setStyle(ButtonStyle.Secondary)
    );
  });
  return row;
}

/**
 * Manda a pergunta `index` no canal e espera a resposta do usuário
 * (por texto ou clique em botão, o que vier primeiro).
 * Retorna { answer: string, timedOut: boolean }
 */
function askAndWait(channel, userId, index) {
  return new Promise((resolve) => {
    const question = questions[index];
    const embed = embeds.questionEmbed(question, index, questions.length);
    const components = question.type === 'choice' ? [buildChoiceRow(question.options)] : [];

    channel.send({ embeds: [embed], components }).then((sentMessage) => {
      let settled = false;

      const messageCollector = channel.createMessageCollector({
        filter: (m) => m.author.id === userId,
        max: 1,
        time: config.theme.questionTimeLimitMs,
      });

      const componentCollector =
        question.type === 'choice'
          ? sentMessage.createMessageComponentCollector({
              filter: (i) => i.user.id === userId,
              max: 1,
              time: config.theme.questionTimeLimitMs,
            })
          : null;

      const finish = (answer, timedOut) => {
        if (settled) return;
        settled = true;
        messageCollector.stop('done');
        if (componentCollector) componentCollector.stop('done');
        resolve({ answer, timedOut });
      };

      messageCollector.on('collect', (m) => {
        finish(m.content.trim(), false);
      });

      if (componentCollector) {
        componentCollector.on('collect', async (interaction) => {
          const idx = Number(interaction.customId.split(':')[1]);
          const chosen = question.options[idx];
          await interaction.update({ components: [] });
          await channel.send(`**${interaction.user.username}** respondeu: ${chosen}`);
          finish(chosen, false);
        });
      }

      messageCollector.on('end', (_collected, reason) => {
        if (reason !== 'done') finish(null, true);
      });
    });
  });
}

/** Espera uma única mensagem de texto do usuário no canal (fora do sistema de perguntas numeradas) */
function waitForTextMessage(channel, userId, timeoutMs) {
  return new Promise((resolve) => {
    const collector = channel.createMessageCollector({
      filter: (m) => m.author.id === userId,
      max: 1,
      time: timeoutMs,
    });
    collector.on('collect', (m) => resolve({ answer: m.content.trim(), timedOut: false }));
    collector.on('end', (collected) => {
      if (collected.size === 0) resolve({ answer: null, timedOut: true });
    });
  });
}

/** Manda um menu de seleção e espera o usuário escolher uma opção */
function waitForSelectChoice(channel, userId, embed, options, timeoutMs) {
  return new Promise((resolve) => {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(TIME_PERIOD_SELECT_ID)
        .setPlaceholder('Selecione uma opção')
        .addOptions(options)
    );

    channel.send({ embeds: [embed], components: [row] }).then((sentMessage) => {
      const collector = sentMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        max: 1,
        time: timeoutMs,
      });

      collector.on('collect', async (i) => {
        await i.update({ components: [] });
        resolve({ value: i.values[0], label: options.find((o) => o.value === i.values[0])?.label, timedOut: false });
      });

      collector.on('end', (collected) => {
        if (collected.size === 0) resolve({ value: null, label: null, timedOut: true });
      });
    });
  });
}

/** Roda o formulário completo dentro do canal do ticket */
async function runRecruitmentFlow(channel, member, application) {
  const answers = application.answers ? [...application.answers] : [];

  for (let i = application.current_question; i < questions.length; i++) {
    const { answer, timedOut } = await askAndWait(channel, member.id, i);

    if (timedOut) {
      await channel.send({ embeds: [embeds.timeoutEmbed()] });
      await db.finishApplication(application.id, 'expirado', 'sistema');
      setTimeout(() => channel.delete().catch(() => {}), 10_000);
      return;
    }

    answers.push({ question: questions[i].text, answer });
    application = await db.saveAnswer(application.id, answers, i + 1);
  }

  application = await runSecondPhase(channel, member, application, answers);
  if (!application) return; // expirou na segunda fase, já tratado dentro da função

  await finalizeApproval(channel, member, application);
}

/** Segunda fase: disponibilidade pra avaliação prática (período + horário exato) */
async function runSecondPhase(channel, member, application, answers) {
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(config.theme.color)
        .setDescription(
          `✅ **Primeira parte do recrutamento finalizada!**\n\n` +
            `Agora precisamos te avaliar jogando. Vamos marcar um horário para isso.`
        ),
    ],
  });

  const timeoutMs = config.theme.questionTimeLimitMs;

  // Pergunta 1 da 2ª fase: período (tarde/noite)
  const periodResult = await waitForSelectChoice(
    channel,
    member.id,
    new EmbedBuilder()
      .setColor(config.theme.color)
      .setAuthor({ name: '🕒 SEGUNDA FASE  •  Disponibilidade' })
      .setDescription(`**Em qual período você está disponível para a avaliação prática?**`),
    [
      { label: 'De tarde', value: 'tarde', emoji: '🌤️' },
      { label: 'De noite', value: 'noite', emoji: '🌙' },
    ],
    timeoutMs
  );

  if (periodResult.timedOut) {
    await channel.send({ embeds: [embeds.timeoutEmbed()] });
    await db.finishApplication(application.id, 'expirado', 'sistema');
    setTimeout(() => channel.delete().catch(() => {}), 10_000);
    return null;
  }

  answers.push({ question: 'Período disponível para a avaliação prática', answer: periodResult.label });
  application = await db.saveAnswer(application.id, answers, application.current_question);

  // Pergunta 2 da 2ª fase: horário exato dentro do período escolhido
  const horarioEmbed = new EmbedBuilder()
    .setColor(config.theme.color)
    .setAuthor({ name: '🕒 SEGUNDA FASE  •  Disponibilidade' })
    .setDescription(
      `**Que horário, dentro do período de ${periodResult.label.toLowerCase()}, você estaria disponível?**\n` +
        `Digite sua resposta (ex: 19:00). Limite: ${Math.round(timeoutMs / 60000)} min`
    );
  await channel.send({ embeds: [horarioEmbed] });

  const horarioResult = await waitForTextMessage(channel, member.id, timeoutMs);

  if (horarioResult.timedOut) {
    await channel.send({ embeds: [embeds.timeoutEmbed()] });
    await db.finishApplication(application.id, 'expirado', 'sistema');
    setTimeout(() => channel.delete().catch(() => {}), 10_000);
    return null;
  }

  answers.push({ question: `Horário específico (${periodResult.label})`, answer: horarioResult.answer });
  application = await db.saveAnswer(application.id, answers, application.current_question);

  return application;
}

async function finalizeApproval(channel, member, application) {
  try {
    await member.roles.add(config.approvedRoleId, 'Recrutamento aprovado automaticamente');
  } catch (err) {
    console.error('[RECRUTAMENTO] Falha ao atribuir cargo:', err);
    await channel.send(
      '⚠️ Não consegui atribuir o cargo automaticamente (verifique minhas permissões e a posição do cargo). A staff foi notificada.'
    );
  }

  const finished = await db.finishApplication(application.id, 'aprovado', 'auto');

  await channel.send({ embeds: [embeds.approvedEmbed(member)] });

  // Renomeia o canal para indicar que o recrutamento foi concluído
  const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  await channel.setName(`finalizado-${safeName}`).catch(() => {});

  // Trava o envio de mensagens imediatamente
  await channel.permissionOverwrites.edit(member.id, { SendMessages: false }).catch(() => {});

  // Após 20 segundos, some com a visibilidade do canal pro usuário.
  // O canal continua existindo e visível só para a staff (histórico/registro).
  setTimeout(() => {
    channel.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
  }, 20_000);

  // Após 5 minutos, o canal é apagado por completo — dando tempo da staff ler antes de sumir.
  setTimeout(() => {
    channel.delete('Ticket de recrutamento finalizado').catch(() => {});
  }, 5 * 60 * 1000);

  if (config.logChannelId) {
    const logChannel = await channel.guild.channels.fetch(config.logChannelId).catch(() => null);
    if (logChannel) {
      await logChannel
        .send({
          content:
            `<@${member.id}> foi aprovado(a) no recrutamento.\n` +
            `📎 Ticket: <#${channel.id}>\n` +
            `👮 <@&${config.recruitmentLogPingRoleId}>`,
          embeds: [embeds.transcriptEmbed(finished, member)],
        })
        .catch(() => {});
    }
  }
}

module.exports = {
  createTicketChannel,
  runRecruitmentFlow,
};
