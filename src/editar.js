giconst { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./arena/db');
const { isModerator } = require('./arena/commands');

const editarCommand = new SlashCommandBuilder()
  .setName('editar')
  .setDescription('Edita diretamente vitórias, derrotas ou pontuação de um jogador da Arena')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addStringOption((opt) =>
    opt
      .setName('tipo')
      .setDescription('O que editar')
      .setRequired(true)
      .addChoices(
        { name: 'Vitórias', value: 'vitoria' },
        { name: 'Derrotas', value: 'derrota' },
        { name: 'Pontuação', value: 'pontuacao' }
      )
  )
  .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador a editar').setRequired(true))
  .addIntegerOption((opt) =>
    opt.setName('valor').setDescription('Novo valor a ser definido').setRequired(true).setMinValue(0)
  )
  .toJSON();

async function handleEditarCommand(interaction) {
  if (!isModerator(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const tipo = interaction.options.getString('tipo');
  const usuario = interaction.options.getUser('usuario');
  const valor = interaction.options.getInteger('valor');
  const guildId = interaction.guildId;

  let updated;
  let label;

  if (tipo === 'vitoria') {
    updated = await db.setWins(guildId, usuario.id, valor);
    label = `Vitórias definidas para **${updated.wins}**`;
  } else if (tipo === 'derrota') {
    updated = await db.setLosses(guildId, usuario.id, valor);
    label = `Derrotas definidas para **${updated.losses}**`;
  } else {
    updated = await db.setPoints(guildId, usuario.id, valor);
    label = `Pontuação definida para **${updated.points}**`;
  }

  await interaction.reply({ content: `✅ <@${usuario.id}> — ${label}.`, ephemeral: true });
}

module.exports = { editarCommand, handleEditarCommand };
