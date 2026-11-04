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
    .setTitle(`📜 ࿔ Registro ${config.theme.name} 𝜗˚⋆`)
    .setDescription(
      `> *"Uma vez Helheim, sempre Helheim."*\n\n` +
        `୨୧ **Sejam bem-vindos à ${config.theme.name}!**\n` +
        `Somos uma comunidade feita de gente, conversa, eventos e jogatina. ` +
        `Faça seu registro para montar o seu perfil e entrar de vez.\n\n` +
        `𖤐 **COMO FUNCIONA:**\n` +
        `• **1.** Clique no botão abaixo para abrir sua sala privada.\n` +
        `• **2.** Responda ${questions.length} perguntas rápidas, uma por vez.\n` +
        `• **3.** Cada escolha te entrega o cargo correspondente **na hora**, no seu perfil.\n` +
        `• **4.** Ao terminar, é só aproveitar a comunidade!\n\n` +
        `⚠️ Você tem ${timeLimitMin} minutos por pergunta. Passou do tempo, a sala fecha e é só começar de novo.\n\n` +
        `𓆩 ࣪ ִֶָ𓂃 Mais que uma comunidade, uma família. 𓂃 ࣪ ִֶָ𓆪`
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
    .setTitle(`📜 ࿔ Registro ${config.theme.name} 𝜗˚⋆`)
    .setDescription(
      `Seja bem-vindo(a), <@${member.id}>! 🩸\n\n` +
        `> *"Mais que uma comunidade, uma família."*\n\n` +
        `Vamos fazer **${questions.length} perguntas** rápidas, uma por vez. ` +
        `Cada escolha te entrega o cargo correspondente logo em seguida, no seu perfil.\n` +
        `Você terá até **${timeLimitMin} minutos** para cada resposta.\n\n` +
        `*A primeira pergunta começará em instantes...*`
    )
    .setFooter({ text: `${config.theme.name} • Registro` })
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
          : question.type === 'multi'
            ? `Selecione no menu abaixo (pode marcar mais de uma opção) · *Limite: ${timeLimitMin} min*`
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
      `Você não respondeu dentro do limite de ${timeLimitMin} minutos. Esta sala será encerrada por inatividade.\n\n` +
        'Você pode refazer o seu registro quando quiser.'
    );
}

function registrationCompleteEmbed(member) {
  return new EmbedBuilder()
    .setColor(config.theme.successColor)
    .setTitle('✅ Registro concluído!')
    .setDescription(
      `Tudo certo, <@${member.id}>! Suas escolhas foram registradas e os cargos já estão no seu perfil.\n\n` +
        `Seja bem-vindo(a) à **${config.theme.name}** — mais que uma comunidade, uma família! 🩸\n\n` +
        `*Esta sala vai se fechar sozinha em instantes.*`
    )
    .setFooter({ text: config.theme.footer })
    .setTimestamp();
}

/**
 * Monta o transcript do recrutamento como uma LISTA de embeds.
 * O Discord limita cada mensagem a 6000 caracteres somando todos os embeds (e 25 campos por embed),
 * então com muitas perguntas/respostas longas o log precisa ser enviado em mais de uma mensagem
 * (um embed por mensagem). Quem chama deve enviar cada embed separadamente.
 */
function transcriptEmbeds(application, member) {
  const MAX_EMBED_CHARS = 5000; // margem de segurança sobre o limite de 6000
  const MAX_FIELDS = 24;
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

  const fields = [];
  application.answers.forEach((a, i) => {
    fields.push({ name: clip(`${i + 1}. ${a.question}`, 256), value: clip(a.answer || '—', 1024) });
  });
  fields.push({ name: '\u200b', value: `ID do usuário: \`${member.id}\`` });

  const makeEmbed = (isFirst) => {
    const embed = new EmbedBuilder().setColor(config.theme.color);
    if (isFirst) {
      embed
        .setTitle(`📄 Registro — ${member.user.tag}`)
        .setThumbnail(member.displayAvatarURL());
    }
    return embed;
  };

  const result = [];
  let current = makeEmbed(true);
  let size = 120; // título + folga
  let count = 0;

  for (const field of fields) {
    const fieldSize = field.name.length + field.value.length;
    if (count >= MAX_FIELDS || size + fieldSize > MAX_EMBED_CHARS) {
      result.push(current);
      current = makeEmbed(false);
      size = 0;
      count = 0;
    }
    current.addFields(field);
    size += fieldSize;
    count += 1;
  }
  result.push(current);

  result[result.length - 1].setFooter({ text: 'bot by johankkjk' }).setTimestamp();
  return result;
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
  registrationCompleteEmbed,
  transcriptEmbeds,
  alreadyInProgressEmbed,
  getBannerAttachment,
};
