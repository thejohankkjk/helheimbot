// castigo.js  -  comando /castigo  (timeout do Discord)  -  discord.js v14
//
// Uso:  /castigo usuario:@fulano tempo:"3d e 2h" motivo:"spam"
// Coloque este arquivo na pasta de comandos e o parseTempo.js ao lado dele
// (ajuste o require abaixo se você usar outra pasta).

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { interpretarTempo, formatarDuracao } = require('./parseTempo');

const cortar = (txt, max = 1000) => (txt.length > max ? txt.slice(0, max - 1) + '…' : txt);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('castigo')
    .setDescription('Coloca um membro de castigo (timeout)')
    .addUserOption((o) =>
      o.setName('usuario').setDescription('Quem vai de castigo').setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName('tempo')
        .setDescription('Ex.: 30 min, 5h, 3d e 2h, 4 horas e 30 min')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('motivo').setDescription('Motivo do castigo').setMaxLength(500).setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild, client } = interaction;
    const alvoUser = interaction.options.getUser('usuario', true);
    const textoTempo = interaction.options.getString('tempo', true);
    const motivo = interaction.options.getString('motivo') || 'Não informado';

    // ephemeral = só o moderador vê
    const erro = (msg) =>
      interaction.reply({ content: `❌ ${msg}`, flags: MessageFlags.Ephemeral });

    // ---------- validações ----------
    if (alvoUser.id === interaction.user.id) return erro('Você não pode se colocar de castigo.');
    if (alvoUser.id === client.user.id) return erro('Eu não posso me colocar de castigo.');

    const membro = await guild.members.fetch(alvoUser.id).catch(() => null);
    if (!membro) return erro('Esse usuário não está no servidor.');

    const moderador = interaction.member;
    const ehDono = guild.ownerId === moderador.id;
    if (!ehDono && membro.roles.highest.position >= moderador.roles.highest.position) {
      return erro('Você não pode castigar alguém com cargo igual ou maior que o seu.');
    }
    if (!membro.moderatable) {
      return erro(
        'Não consigo castigar essa pessoa (ela é administradora/dona, ou o cargo dela está acima do meu, ou me falta a permissão **Castigar membros**).'
      );
    }

    // ---------- interpretar o tempo ----------
    const tempo = interpretarTempo(textoTempo);
    if (tempo.erro) return erro(tempo.erro);

    const duracaoTexto = formatarDuracao(tempo.ms);
    const fim = Math.floor((Date.now() + tempo.ms) / 1000); // timestamp unix (segundos)
    const jaEstavaDeCastigo = membro.isCommunicationDisabled();

    await interaction.deferReply(); // resposta pública

    // ---------- aplicar o castigo ----------
    try {
      await membro.timeout(
        tempo.ms,
        cortar(`${motivo} | Por ${interaction.user.tag}`, 500)
      );
    } catch (e) {
      console.error('[castigo] falha ao aplicar timeout:', e);
      return interaction.editReply('❌ Não consegui aplicar o castigo. Verifique minhas permissões e a hierarquia de cargos.');
    }

    // ---------- DM para o castigado ----------
    let dmEnviada = true;
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('⏳ Você foi colocado de castigo')
        .setDescription(`Você recebeu um castigo no servidor **${guild.name}**.`)
        .addFields(
          { name: '⏱️ Duração', value: duracaoTexto, inline: true },
          { name: '🔓 Termina', value: `<t:${fim}:F>\n(<t:${fim}:R>)`, inline: true },
          { name: '📄 Motivo', value: cortar(motivo) },
          { name: '👮 Moderador', value: interaction.user.tag }
        )
        .setThumbnail(guild.iconURL())
        .setFooter({ text: guild.name })
        .setTimestamp();
      await alvoUser.send({ embeds: [dmEmbed] });
    } catch {
      dmEnviada = false; // DM fechada ou bloqueada
    }

    // ---------- resposta no canal ----------
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Membro colocado de castigo')
      .setThumbnail(alvoUser.displayAvatarURL())
      .addFields(
        { name: '👤 Membro', value: `${alvoUser} (${alvoUser.tag})`, inline: true },
        { name: '👮 Moderador', value: `${interaction.user}`, inline: true },
        { name: '⏱️ Duração', value: duracaoTexto, inline: true },
        { name: '🔓 Termina', value: `<t:${fim}:F> (<t:${fim}:R>)` },
        { name: '📄 Motivo', value: cortar(motivo) },
        {
          name: '📩 Aviso por DM',
          value: dmEnviada ? 'Enviado ✅' : 'Não consegui enviar (DM fechada) ❌',
        }
      )
      .setTimestamp();
    if (jaEstavaDeCastigo) embed.setFooter({ text: 'O castigo anterior foi substituído por este.' });

    await interaction.editReply({ embeds: [embed] });

    // ---------- log opcional (defina LOG_CHANNEL_ID no .env) ----------
    const logId = process.env.LOG_CHANNEL_ID;
    if (logId) {
      const canal = await guild.channels.fetch(logId).catch(() => null);
      if (canal?.isTextBased()) {
        canal.send({ embeds: [EmbedBuilder.from(embed).setTitle('📋 Castigo aplicado')] }).catch(() => {});
      }
    }
  },
};
