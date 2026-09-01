const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const embeds = require('./embeds');
const { sendPanel, isModerator } = require('./commands');

const arenaSlashCommand = new SlashCommandBuilder()
  .setName('arena')
  .setDescription('Comandos de administração da Arena 1v1')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((sub) => sub.setName('painel').setDescription('Envia o painel principal da Arena neste canal'))
  .addSubcommand((sub) =>
    sub
      .setName('link')
      .setDescription('Define o link do Servidor VIP do Roblox usado nas partidas')
      .addStringOption((opt) => opt.setName('url').setDescription('Link do servidor VIP').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('adicionar-pontos')
      .setDescription('Adiciona pontos ao ELO de um jogador')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador').setRequired(true))
      .addIntegerOption((opt) => opt.setName('quantidade').setDescription('Quantidade de pontos').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('remover-pontos')
      .setDescription('Remove pontos do ELO de um jogador')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador').setRequired(true))
      .addIntegerOption((opt) => opt.setName('quantidade').setDescription('Quantidade de pontos').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('resetar-pontos')
      .setDescription('Reseta o ELO de um jogador para o valor inicial (0 pontos)')
      .addUserOption((opt) => opt.setName('usuario').setDescription('Jogador').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('partidas').setDescription('Lista as partidas em andamento'))
  .toJSON();

async function handleArenaCommand(interaction) {
  if (!isModerator(interaction.member) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  if (sub === 'painel') {
    await sendPanel(interaction.channel);
    await interaction.reply({ content: '✅ Painel da Arena enviado.', ephemeral: true });
    return;
  }

  if (sub === 'link') {
    const url = interaction.options.getString('url');
    await db.setVipLink(guildId, url);
    await interaction.reply({ content: `✅ Link do Servidor VIP atualizado para: ${url}`, ephemeral: true });
    return;
  }

  if (sub === 'adicionar-pontos') {
    const user = interaction.options.getUser('usuario');
    const amount = interaction.options.getInteger('quantidade');
    const player = await db.getOrCreatePlayer(guildId, user.id);
    const updated = await db.setPoints(guildId, user.id, player.points + amount);
    await interaction.reply({ content: `🏆 <@${user.id}> recebeu +${amount} pontos. Total: **${updated.points}**.`, ephemeral: true });
    return;
  }

  if (sub === 'remover-pontos') {
    const user = interaction.options.getUser('usuario');
    const amount = interaction.options.getInteger('quantidade');
    const player = await db.getOrCreatePlayer(guildId, user.id);
    const updated = await db.setPoints(guildId, user.id, Math.max(0, player.points - amount));
    await interaction.reply({ content: `📉 <@${user.id}> perdeu ${amount} pontos. Total: **${updated.points}**.`, ephemeral: true });
    return;
  }

  if (sub === 'resetar-pontos') {
    const user = interaction.options.getUser('usuario');
    await db.getOrCreatePlayer(guildId, user.id);
    await db.setPoints(guildId, user.id, db.STARTING_POINTS);
    await interaction.reply({ content: `🔄 <@${user.id}> foi resetado para **${db.STARTING_POINTS}** pontos.`, ephemeral: true });
    return;
  }

  if (sub === 'partidas') {
    const matches = await db.getOngoingMatches(guildId);
    if (!matches.length) {
      await interaction.reply({ content: 'Nenhuma partida em andamento no momento.', ephemeral: true });
      return;
    }
    const lines = matches.map(
      (m) => `• <#${m.channel_id}> — <@${m.player1_id}> vs <@${m.player2_id}> (desde <t:${Math.floor(new Date(m.created_at).getTime() / 1000)}:R>)`
    );
    await interaction.reply({ content: `⚔️ **Partidas em andamento:**\n${lines.join('\n')}`, ephemeral: true });
    return;
  }
}

module.exports = { arenaSlashCommand, handleArenaCommand };
