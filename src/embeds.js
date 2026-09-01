const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const questions = require('./questions');

const timeLimitMin = Math.round(config.theme.questionTimeLimitMs / 60000);

const BANNER_PATH = path.join(__dirname, '..', 'assets', 'banner.png');

/** Retorna o anexo da imagem de banner (ou null se o arquivo não existir) */
function getBannerAttachment() {
  if (!fs.existsSync(BANNER_PATH)) return null;
  return new AttachmentBuilder(BANNER_PATH, { name: 'banner.png' });
}

function recruitmentAnnouncementEmbed() {
  const embed = new EmbedBuilder()
    .setColor(config.theme.color)
    .setTitle(`🩸 RECRUTAMENTO — ${config.theme.name}`)
    .setDescription(
      `> *"Uma vez Helheim, sempre Helheim."*\n\n` +
        `**Antes de vestir as cores da nossa gangue, prove que é digno de usá-las.**\n\n` +
        `📋 **ETAPAS:**\n` +
        `• **1.** Clique no botão abaixo para abrir sua sala privada de entrevista.\n` +
        `• **2.** Responda ${questions.length} perguntas, uma por vez.\n` +
        `• **3.** Seja sincero — a liderança vê além das palavras.\n` +
        `• **4.** Ao concluir, o cargo de Recruta é liberado automaticamente.\n\n` +
        `⚠️ Você tem ${timeLimitMin} minutos por pergunta. Ticket abandonado = reprovação automática.`
    )
    .setFooter({ text: config.theme.footer })
    .setTimestamp();

  if (getBannerAttachment()) {
    embed.setImage('attachment://banner.png');
  } else if (config.theme.bannerUrl) {
    embed.setImage(config.theme.bannerUrl);
  }

  return embed;
}

function ticketWelcomeEmbed(member) {
  const embed = new EmbedBuilder()
    .setColor(config.theme.color)
    .setTitle(`🩸 FORMULÁRIO DE RECRUTAMENTO — ${config.theme.name}`)
    .setDescription(
      `Saudações, <@${member.id}>!\n\n` +
        `> *"Honestidade é fundamental. Todas as respostas serão analisadas pela liderança."*\n\n` +
        `Iremos fazer **${questions.length} perguntas**, uma por vez.\n` +
        `Responda com calma e atenção. Você terá até **${timeLimitMin} minutos** para cada resposta.\n\n` +
        `*A primeira pergunta começará em instantes...*`
    )
    .setFooter({ text: `${config.theme.name} Recruitment • Hoje` })
    .setTimestamp();

  if (getBannerAttachment()) {
    embed.setImage('attachment://banner.png');
  } else if (config.theme.bannerUrl) {
    embed.setImage(config.theme.bannerUrl);
  }
  return embed;
}

function progressBar(current, total, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((current / total) * size)));
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function questionEmbed(question, index, total) {
  const embed = new EmbedBuilder()
    .setColor(config.theme.color)
    .setAuthor({ name: `${question.category}   •   Pergunta ${index + 1} de ${total}` })
    .setDescription(
      `**〔${question.number}〕** ${question.text}\n\n` +
        (question.type === 'choice'
          ? `Clique no botão correspondente abaixo · *Limite: ${timeLimitMin} min*`
          : `Digite sua resposta abaixo · *Limite: ${timeLimitMin} min*`)
    )
    .addFields({
      name: '\u200b',
      value: `${progressBar(index + 1, total)}   \`${index + 1}/${total}\``,
    })
    .setFooter({ text: '⫘'.repeat(14) });

  return embed;
}

function timeoutEmbed() {
  return new EmbedBuilder()
    .setColor(config.theme.failColor)
    .setTitle('⏱️ Tempo esgotado')
    .setDescription(
      `Você não respondeu dentro do limite de ${timeLimitMin} minutos. Este ticket será encerrado por inatividade.\n\n` +
        'Você pode iniciar um novo recrutamento quando quiser.'
    );
}

function approvedEmbed(member) {
  return new EmbedBuilder()
    .setColor(config.theme.successColor)
    .setTitle('✅ Recrutamento aprovado!')
    .setDescription(
      `Parabéns, <@${member.id}>! Suas respostas foram registradas e você foi **aprovado(a)** automaticamente.\n\n` +
        `Você já recebeu o cargo correspondente. Seja bem-vindo(a) à **${config.theme.name}**! 🩸`
    )
    .setFooter({ text: config.theme.footer })
    .setTimestamp();
}

function transcriptEmbed(application, member) {
  const embed = new EmbedBuilder()
    .setColor(config.theme.color)
    .setTitle(`📄 Transcript de Recrutamento — ${member.user.tag}`)
    .setThumbnail(member.displayAvatarURL())
    .setFooter({ text: 'bot by johankkjk' })
    .setTimestamp();

  application.answers.forEach((a, i) => {
    embed.addFields({ name: `${i + 1}. ${a.question}`, value: a.answer || '—' });
  });

  embed.addFields({ name: '\u200b', value: `ID do usuário: \`${member.id}\`` });

  return embed;
}

function alreadyInProgressEmbed(channelId) {
  return new EmbedBuilder()
    .setColor(config.theme.failColor)
    .setDescription(`⚠️ Você já tem um recrutamento em andamento em <#${channelId}>.`);
}

module.exports = {
  recruitmentAnnouncementEmbed,
  ticketWelcomeEmbed,
  questionEmbed,
  timeoutEmbed,
  approvedEmbed,
  transcriptEmbed,
  alreadyInProgressEmbed,
  getBannerAttachment,
};
