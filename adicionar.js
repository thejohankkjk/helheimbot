const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./arena/db');
const { isModerator } = require('./arena/commands');

const adicionarCommand = new SlashCommandBuilder()
  .setName('adicionar')
  .setDescription('Soma vitórias, derrotas ou pontos ao total atual de um jogador da Arena')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addStringOption((opt) =>
    opt
      .setName('tipo')
      .setDescription('O que somar')
      .setRequired(true)
      .addChoices(
        { name: 'Vitórias', value: 'vitoria' },
        { name: 'Derrotas', value: 'derrota' },
        { name: 'Pontuação', value: 'pontuacao' }
      )
  )
  .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador a editar').setRequired(true))
  .addIntegerOption((opt) =>
    opt
      .setName('valor')
      .setDescription('Quanto somar (use número negativo pra subtrair)')
      .setRequired(true)
  )
  .toJSON();

async function handleAdicionarCommand(interaction) {
  if (!isModerator(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const tipo = interaction.options.getString('tipo');
  const usuario = interaction.options.getUser('usuario');
  const valor = interaction.options.getInteger('valor');
  const guildId = interaction.guildId;

  const player = await db.getOrCreatePlayer(guildId, usuario.id);

  let updated;
  let label;

  if (tipo === 'vitoria') {
    updated = await db.setWins(guildId, usuario.id, Math.max(0, player.wins + valor));
    label = `Vitórias: ${player.wins} → **${updated.wins}**`;
  } else if (tipo === 'derrota') {
    updated = await db.setLosses(guildId, usuario.id, Math.max(0, player.losses + valor));
    label = `Derrotas: ${player.losses} → **${updated.losses}**`;
  } else {
    updated = await db.setPoints(guildId, usuario.id, Math.max(0, player.points + valor));
    label = `Pontuação: ${player.points} → **${updated.points}**`;
  }

  await interaction.reply({ content: `✅ <@${usuario.id}> — ${label}.`, ephemeral: true });
}

module.exports = { adicionarCommand, handleAdicionarCommand };
