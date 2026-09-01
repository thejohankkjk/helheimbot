const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./arena/db');
const { isModerator } = require('./arena/commands');

const suspendCommand = new SlashCommandBuilder()
  .setName('suspender')
  .setDescription('Suspende um jogador de usar a Arena 1v1 por um período')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador a suspender').setRequired(true))
  .addIntegerOption((opt) =>
    opt.setName('horas').setDescription('Duração da suspensão em horas').setRequired(true).setMinValue(1)
  )
  .toJSON();

const releaseCommand = new SlashCommandBuilder()
  .setName('liberar')
  .setDescription('Remove a suspensão de um jogador da Arena 1v1')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador a liberar').setRequired(true))
  .toJSON();

function canModerate(interaction) {
  return isModerator(interaction.member) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

async function handleSuspendCommand(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const user = interaction.options.getUser('usuario');
  const hours = interaction.options.getInteger('horas');

  await db.suspendPlayer(interaction.guildId, user.id, hours);
  const untilTs = Math.floor((Date.now() + hours * 60 * 60 * 1000) / 1000);

  await interaction.reply({
    content: `🔨 <@${user.id}> foi suspenso da Arena por **${hours}h**. Liberado automaticamente <t:${untilTs}:R> (<t:${untilTs}:f>).`,
    ephemeral: true,
  });
}

async function handleReleaseCommand(interaction) {
  if (!canModerate(interaction)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const user = interaction.options.getUser('usuario');
  await db.liftSuspension(interaction.guildId, user.id);

  await interaction.reply({ content: `✅ <@${user.id}> foi liberado e já pode usar a Arena normalmente.`, ephemeral: true });
}

module.exports = {
  suspendCommand,
  releaseCommand,
  handleSuspendCommand,
  handleReleaseCommand,
};
