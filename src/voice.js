const { SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } = require('@discordjs/voice');

const callCommand = new SlashCommandBuilder()
  .setName('call')
  .setDescription('Faz o bot entrar ou sair de um canal de voz')
  .addSubcommand((sub) => sub.setName('entrar').setDescription('O bot entra no seu canal de voz atual'))
  .addSubcommand((sub) => sub.setName('sair').setDescription('O bot sai do canal de voz'))
  .toJSON();

async function handleCallCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'entrar') {
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: '⛔ Você precisa estar num canal de voz primeiro.', ephemeral: true });
      return;
    }

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: true, // entra mutado, já que não vai tocar nem transmitir nada
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      await interaction.reply({ content: `🎧 Entrei em **${voiceChannel.name}**.`, ephemeral: true });
    } catch (err) {
      console.error('[VOICE] Erro ao entrar no canal:', err);
      await interaction.reply({ content: '❌ Não consegui entrar no canal de voz.', ephemeral: true });
    }
    return;
  }

  if (sub === 'sair') {
    const connection = getVoiceConnection(interaction.guildId);
    if (!connection) {
      await interaction.reply({ content: 'Eu não estou em nenhum canal de voz agora.', ephemeral: true });
      return;
    }
    connection.destroy();
    await interaction.reply({ content: '👋 Saí do canal de voz.', ephemeral: true });
  }
}

module.exports = { callCommand, handleCallCommand };
