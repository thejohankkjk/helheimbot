const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const config = require('./config');
const { isModerator } = require('./arena/commands');

const banCommand = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Bane um usuário do servidor, avisando o motivo por DM antes')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((opt) => opt.setName('usuario').setDescription('Quem banir').setRequired(true))
  .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo do banimento').setRequired(true))
  .toJSON();

function banAlertEmbed(guild, motivo, moderatorTag) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🚨 Alerta!!')
    .setThumbnail(guild.iconURL() || null)
    .setDescription(
      `Você foi banido do servidor **${guild.name}**.\n\n` +
        `📋 **Motivo:** ${motivo}\n` +
        `👮 **Responsável:** ${moderatorTag}\n` +
        `📅 **Data:** <t:${Math.floor(Date.now() / 1000)}:F>\n\n` +
        `Se você acredita que isso foi um engano, entre em contato com a liderança da gangue.`
    )
    .setFooter({ text: `${config.theme.footer} • bot by johankkjk` })
    .setTimestamp();
}

async function handleBanCommand(interaction) {
  if (!isModerator(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.BanMembers)) {
    await interaction.reply({ content: '⛔ Eu não tenho permissão de Banir Membros nesse servidor.', ephemeral: true });
    return;
  }

  const targetUser = interaction.options.getUser('usuario');
  const motivo = interaction.options.getString('motivo');

  const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
  if (targetMember && !targetMember.bannable) {
    await interaction.reply({
      content: '⛔ Não consigo banir essa pessoa (cargo dela é igual ou maior que o meu, ou é o dono do servidor).',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Manda o aviso por DM ANTES de banir — depois de banido, normalmente não dá mais pra mandar DM
  let dmSent = true;
  try {
    await targetUser.send({ embeds: [banAlertEmbed(guild, motivo, interaction.user.tag)] });
  } catch {
    dmSent = false; // usuário pode ter DM fechada — segue com o ban mesmo assim
  }

  try {
    await guild.members.ban(targetUser.id, { reason: motivo });
  } catch (err) {
    console.error('[BAN] Erro ao banir:', err);
    await interaction.editReply('❌ Não consegui banir esse usuário. Veja os logs.');
    return;
  }

  await interaction.editReply(
    `✅ <@${targetUser.id}> foi banido(a).\n📋 Motivo: ${motivo}\n📩 DM enviada: ${dmSent ? 'sim' : 'não (DM fechada)'}`
  );
}

module.exports = { banCommand, handleBanCommand };
