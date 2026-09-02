const { SlashCommandBuilder } = require('discord.js');
const { Readable } = require('stream');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
  createAudioPlayer,
  createAudioResource,
  StreamType,
} = require('@discordjs/voice');

const callCommand = new SlashCommandBuilder()
  .setName('call')
  .setDescription('Faz o bot entrar ou sair de um canal de voz')
  .addSubcommand((sub) => sub.setName('entrar').setDescription('O bot entra no seu canal de voz atual'))
  .addSubcommand((sub) => sub.setName('sair').setDescription('O bot sai do canal de voz'))
  .toJSON();

// Guarda, por servidor, quem chamou o bot pra call, onde avisar se ele cair, e o player de silêncio.
// guildId -> { requesterId, textChannelId, leavingOnPurpose, player }
const voiceSessions = new Map();

// Pacote Opus válido representando silêncio — usado pra manter a conexão de voz
// viva sem precisar de nenhum codificador de áudio (nenhuma dependência nova).
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

function createSilenceStream() {
  return new Readable({
    objectMode: true,
    read() {
      this.push(SILENCE_FRAME);
    },
  });
}

function keepConnectionAlive(connection) {
  const player = createAudioPlayer();
  const resource = createAudioResource(createSilenceStream(), { inputType: StreamType.Opus });
  player.on('error', (err) => console.error('[VOICE] Erro no player de silêncio:', err));
  player.play(resource);
  connection.subscribe(player);
  return player;
}

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
        selfMute: true, // entra mutado; o "áudio" tocado é só silêncio pra manter a conexão viva
      });

      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
      const player = keepConnectionAlive(connection);

      voiceSessions.set(interaction.guildId, {
        requesterId: interaction.user.id,
        textChannelId: interaction.channelId,
        leavingOnPurpose: false,
        player,
      });

      registerDisconnectWatcher(connection, interaction.guildId, interaction.client);

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

    // Marca como saída intencional, pra não disparar o aviso de "caí sozinho"
    const session = voiceSessions.get(interaction.guildId);
    if (session) {
      session.leavingOnPurpose = true;
      session.player?.stop();
    }

    connection.destroy();
    await interaction.reply({ content: '👋 Saí do canal de voz.', ephemeral: true });
  }
}

/** Detecta queda/desconexão inesperada e avisa quem chamou o bot */
function registerDisconnectWatcher(connection, guildId, client) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      // Pode ser só uma troca de canal de voz (não uma queda real) — dá uma chance de reconectar sozinho
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, async () => {
    const session = voiceSessions.get(guildId);
    voiceSessions.delete(guildId);
    if (!session || session.leavingOnPurpose) return; // saída pedida por /call sair, não avisa

    try {
      const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
      if (channel) {
        await channel.send(
          `⚠️ Fui desconectado da call sem querer! <@${session.requesterId}>, foi você que me chamou — dá uma olhada aí.`
        );
      }
    } catch (err) {
      console.error('[VOICE] Erro ao avisar sobre desconexão:', err);
    }
  });
}

module.exports = { callCommand, handleCallCommand };
