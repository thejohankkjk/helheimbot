const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('./config');
const questions = require('./questions');
const db = require('./supabase');
const embeds = require('./embeds');

const CHOICE_PREFIX = 'rec_choice';

/** Cria o canal privado (ticket) para o recrutamento */
async function createTicketChannel(guild, member) {
  const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';

  const channel = await guild.channels.create({
    name: `rec-${safeName}`,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId || null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: config.staffRoleId,
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

/** Roda o formulário completo dentro do canal do ticket */
async function runRecruitmentFlow(channel, member, application) {
  const answers = [];

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

  await finalizeApproval(channel, member, application);
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
        .send({ content: `<@${member.id}> foi aprovado(a) no recrutamento.`, embeds: [embeds.transcriptEmbed(finished, member)] })
        .catch(() => {});
    }
  }
}

module.exports = {
  createTicketChannel,
  runRecruitmentFlow,
};
