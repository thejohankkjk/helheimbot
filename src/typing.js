const { SlashCommandBuilder, ChannelType } = require('discord.js');

const TYPING_INTERVAL_MS = 8_000; // o indicador do Discord dura ~10s, reenvia antes de sumir

// Só esse ID pode usar /digitando — nem staff, nem admin.
const OWNER_ID = '463341116104900608';

// channelId -> intervalId, pra conseguir desligar depois
const activeTyping = new Map();

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

async function handleTypingCommand(interaction) {
  if (interaction.user.id !== OWNER_ID) {
    await interaction.reply({ content: '⛔ Só o dono do bot pode usar esse comando.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const channel = interaction.options.getChannel('canal') || interaction.channel;

  if (sub === 'on') {
    if (activeTyping.has(channel.id)) {
      await interaction.reply({ content: `⚠️ Já estou "digitando" em <#${channel.id}>.`, ephemeral: true });
      return;
    }

    channel.sendTyping().catch(() => {});
    const intervalId = setInterval(() => channel.sendTyping().catch(() => {}), TYPING_INTERVAL_MS);
    activeTyping.set(channel.id, intervalId);

    await interaction.reply({ content: `✅ Agora tô "digitando..." sem parar em <#${channel.id}> 😂`, ephemeral: true });
    return;
  }

  // off
  const intervalId = activeTyping.get(channel.id);
  if (!intervalId) {
    await interaction.reply({ content: `Eu não tava "digitando" em <#${channel.id}>.`, ephemeral: true });
    return;
  }

  clearInterval(intervalId);
  activeTyping.delete(channel.id);
  await interaction.reply({ content: `✅ Parei de "digitar" em <#${channel.id}>.`, ephemeral: true });
}

module.exports = { typingCommand, handleTypingCommand };
