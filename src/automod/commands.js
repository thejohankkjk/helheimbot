const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { SUPER_USER_ID } = require('./index');

const modconfigCommand = new SlashCommandBuilder()
  .setName('modconfig')
  .setDescription('Configura os limites do sistema anti-raid')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((opt) =>
    opt
      .setName('tipo')
      .setDescription('O que monitorar')
      .setRequired(true)
      .addChoices(
        { name: 'Banimentos em massa', value: 'ban' },
        { name: 'Exclusão de cargos', value: 'cargos' },
        { name: 'Exclusão de chats', value: 'chats' }
      )
  )
  .addIntegerOption((opt) =>
    opt.setName('quantia').setDescription('Quantas ações em até 3 min disparam a punição').setRequired(true).setMinValue(2)
  )
  .addStringOption((opt) =>
    opt
      .setName('punicao')
      .setDescription('O que acontece com quem disparar o limite')
      .setRequired(true)
      .addChoices({ name: 'Ban (24h)', value: 'ban' }, { name: 'Timeout (24h)', value: 'timeout' }, { name: 'Kick', value: 'kick' })
  )
  .toJSON();

const automodCommand = new SlashCommandBuilder()
  .setName('automod')
  .setDescription('Liga ou desliga o sistema anti-raid')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('on').setDescription('Ativa o anti-raid'))
  .addSubcommand((sub) => sub.setName('off').setDescription('Desativa o anti-raid'))
  .toJSON();

const modpermCommand = new SlashCommandBuilder()
  .setName('modperm')
  .setDescription('Dá (ou remove) permissão pra alguém configurar o anti-raid')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption((opt) => opt.setName('usuario').setDescription('Quem autorizar').setRequired(true))
  .addBooleanOption((opt) => opt.setName('remover').setDescription('Remover a permissão em vez de dar').setRequired(false))
  .toJSON();

/** Só o dono do servidor, o super usuário fixo, ou quem já foi autorizado via /modperm */
async function isAutomodAuthorized(interaction) {
  if (interaction.user.id === SUPER_USER_ID) return true;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return db.isAuthorized(interaction.guildId, interaction.user.id).catch(() => false);
}

async function handleModconfigCommand(interaction) {
  if (!(await isAutomodAuthorized(interaction))) {
    await interaction.reply({ content: '⛔ Só o dono do servidor ou quem tem permissão pode configurar isso.', ephemeral: true });
    return;
  }

  const tipo = interaction.options.getString('tipo');
  const quantia = interaction.options.getInteger('quantia');
  const punicao = interaction.options.getString('punicao');

  await db.setThresholdAndPunishment(interaction.guildId, tipo, quantia, punicao);

  const tipoLabel = { ban: 'Banimentos em massa', cargos: 'Exclusão de cargos', chats: 'Exclusão de chats' }[tipo];
  const punicaoLabel = { ban: 'Ban (24h)', timeout: 'Timeout (24h)', kick: 'Kick' }[punicao];

  await interaction.reply({
    content: `✅ **${tipoLabel}**: ${quantia}+ ações em até 3 min → **${punicaoLabel}**.`,
    ephemeral: true,
  });
}

async function handleAutomodCommand(interaction) {
  if (!(await isAutomodAuthorized(interaction))) {
    await interaction.reply({ content: '⛔ Só o dono do servidor ou quem tem permissão pode mexer nisso.', ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const enabled = sub === 'on';
  await db.setEnabled(interaction.guildId, enabled);

  await interaction.reply({ content: `✅ Sistema anti-raid **${enabled ? 'ativado' : 'desativado'}**.`, ephemeral: true });
}

async function handleModpermCommand(interaction) {
  if (!(await isAutomodAuthorized(interaction))) {
    await interaction.reply({ content: '⛔ Só o dono do servidor ou quem já tem permissão pode conceder isso.', ephemeral: true });
    return;
  }

  const usuario = interaction.options.getUser('usuario');
  const remover = interaction.options.getBoolean('remover') || false;

  if (remover) {
    await db.removePermission(interaction.guildId, usuario.id);
    await interaction.reply({ content: `✅ <@${usuario.id}> não pode mais configurar o anti-raid.`, ephemeral: true });
  } else {
    await db.addPermission(interaction.guildId, usuario.id, interaction.user.id);
    await interaction.reply({ content: `✅ <@${usuario.id}> agora pode configurar o anti-raid (\`/modconfig\`, \`/automod\`, \`/modperm\`).`, ephemeral: true });
  }
}

module.exports = {
  modconfigCommand,
  automodCommand,
  modpermCommand,
  handleModconfigCommand,
  handleAutomodCommand,
  handleModpermCommand,
};
