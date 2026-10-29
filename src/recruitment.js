const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
} = require('discord.js');
const config = require('./config');
const questions = require('./questions');
const db = require('./supabase');
const embeds = require('./embeds');

const CHOICE_PREFIX = 'rec_choice';
const MULTI_PREFIX = 'rec_multi';

/** Cria o canal privado (ticket) para o registro */
async function createTicketChannel(guild, member) {
  const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';

  const channel = await guild.channels.create({
    name: `registro-${safeName}`,
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

function buildMultiRow(options) {
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(MULTI_PREFIX)
      .setPlaceholder('Selecione uma ou mais opções')
      .setMinValues(1)
      .setMaxValues(options.length)
      .addOptions(options.map((opt, idx) => ({ label: opt, value: String(idx) })))
  );
  return row;
}

/**
 * Manda a pergunta `index` no canal e espera a resposta do usuário.
 * Retorna { answer: string, selectedOptions: string[]|null, timedOut: boolean }.
 * selectedOptions só vem preenchido pra 'choice' (1 item) e 'multi' (1+ itens) — serve
 * pra saber exatamente quais cargos entregar/remover.
 */
function askAndWait(channel, userId, index) {
  return new Promise((resolve) => {
    const question = questions[index];
    const embed = embeds.questionEmbed(question, index, questions.length);
    let components = [];
    if (question.type === 'choice') components = [buildChoiceRow(question.options)];
    if (question.type === 'multi') components = [buildMultiRow(question.options)];

    channel.send({ embeds: [embed], components }).then((sentMessage) => {
      let settled = false;

      const messageCollector = channel.createMessageCollector({
        filter: (m) => m.author.id === userId,
        max: 1,
        time: config.theme.questionTimeLimitMs,
      });

      const componentCollector =
        question.type === 'choice' || question.type === 'multi'
          ? sentMessage.createMessageComponentCollector({
              filter: (i) => i.user.id === userId,
              max: 1,
              time: config.theme.questionTimeLimitMs,
            })
          : null;

      const finish = (answer, selectedOptions, timedOut) => {
        if (settled) return;
        settled = true;
        messageCollector.stop('done');
        if (componentCollector) componentCollector.stop('done');
        resolve({ answer, selectedOptions, timedOut });
      };

      messageCollector.on('collect', (m) => {
        finish(m.content.trim(), null, false);
      });

      if (componentCollector) {
        componentCollector.on('collect', async (interaction) => {
          if (question.type === 'choice') {
            const idx = Number(interaction.customId.split(':')[1]);
            const chosen = question.options[idx];
            await interaction.update({ components: [] });
            await channel.send(`**${interaction.user.username}** respondeu: ${chosen}`);
            finish(chosen, [chosen], false);
          } else {
            const chosen = interaction.values.map((v) => question.options[Number(v)]);
            await interaction.update({ components: [] });
            await channel.send(`**${interaction.user.username}** respondeu: ${chosen.join(', ')}`);
            finish(chosen.join(', '), chosen, false);
          }
        });
      }

      messageCollector.on('end', (_collected, reason) => {
        if (reason !== 'done') finish(null, null, true);
      });
    });
  });
}

/** Entrega o cargo da(s) opção(ões) escolhida(s) e remove o das não escolhidas da mesma pergunta */
async function applyQuestionRoles(member, question, selectedOptions) {
  if (!question.roles) return;

  for (const option of question.options) {
    const roleId = question.roles[option];
    if (!roleId) continue; // sem ID configurado pra essa opção — não mexe em nada

    try {
      if (selectedOptions.includes(option)) {
        await member.roles.add(roleId, `Registro: ${question.label || question.text} → ${option}`);
      } else {
        await member.roles.remove(roleId, `Registro: ${question.label || question.text} (troca de resposta)`);
      }
    } catch (err) {
      console.error(`[REGISTRO] Falha ao ajustar cargo da opção "${option}":`, err);
    }
  }
}

/** Roda o formulário completo dentro do canal do ticket */
async function runRecruitmentFlow(channel, member, application) {
  const answers = application.answers ? [...application.answers] : [];

  for (let i = application.current_question; i < questions.length; i++) {
    const question = questions[i];
    const { answer, selectedOptions, timedOut } = await askAndWait(channel, member.id, i);

    if (timedOut) {
      await channel.send({ embeds: [embeds.timeoutEmbed()] });
      await db.finishApplication(application.id, 'expirado', 'sistema');
      setTimeout(() => channel.delete().catch(() => {}), 10_000);
      return;
    }

    if (question.roles && selectedOptions) {
      await applyQuestionRoles(member, question, selectedOptions);
    }

    answers.push({ question: question.label || question.text, answer });
    application = await db.saveAnswer(application.id, answers, i + 1);
  }

  await finalizeRegistration(channel, member, application);
}

async function finalizeRegistration(channel, member, application) {
  if (config.approvedRoleId) {
    try {
      await member.roles.add(config.approvedRoleId, 'Registro concluído automaticamente');
    } catch (err) {
      console.error('[REGISTRO] Falha ao atribuir cargo geral:', err);
      await channel.send(
        '⚠️ Não consegui atribuir o cargo geral automaticamente (verifique minhas permissões e a posição do cargo). A staff foi notificada.'
      );
    }
  }

  const finished = await db.finishApplication(application.id, 'aprovado', 'auto');

  await channel.send({ embeds: [embeds.registrationCompleteEmbed(member)] });

  // Trava o envio de mensagens imediatamente
  await channel.permissionOverwrites.edit(member.id, { SendMessages: false }).catch(() => {});

  // Após 20 segundos, some com a visibilidade do canal pro usuário (staff continua vendo)
  setTimeout(() => {
    channel.permissionOverwrites.edit(member.id, { ViewChannel: false, SendMessages: false }).catch(() => {});
  }, 20_000);

  // Após 5 minutos, apaga o canal por completo
  setTimeout(() => {
    channel.delete('Registro finalizado').catch(() => {});
  }, 5 * 60 * 1000);

  if (config.logChannelId) {
    const logChannel = await channel.guild.channels.fetch(config.logChannelId).catch(() => null);
    if (logChannel) {
      const transcript = embeds.transcriptEmbeds(finished, member);
      const logError = (err) => console.error('[REGISTRO] Falha ao enviar o log:', err);

      await logChannel
        .send({
          content:
            `<@${member.id}> concluiu o registro.\n` +
            `📎 Ticket: <#${channel.id}>\n` +
            `👮 <@&${config.recruitmentLogPingRoleId}>`,
          embeds: [transcript[0]],
        })
        .catch(logError);

      for (const extra of transcript.slice(1)) {
        await logChannel.send({ embeds: [extra] }).catch(logError);
      }
    }
  }
}

module.exports = {
  createTicketChannel,
  runRecruitmentFlow,
};
