const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const AUTHORIZED_USER_ID = '463341116104900608';
const MAX_QUANTITY = 100; // pode alterar aqui depois, se precisar

const criarCommand = new SlashCommandBuilder()
  .setName('criar')
  .setDescription('Criar cargos ou chats específicos')
  .addStringOption((opt) =>
    opt
      .setName('tipo')
      .setDescription('O que criar')
      .setRequired(true)
      .addChoices({ name: 'Cargo', value: 'cargo' }, { name: 'Chat', value: 'chat' })
  )
  .addStringOption((opt) => opt.setName('nome').setDescription('Nome a usar').setRequired(true))
  .addIntegerOption((opt) =>
    opt
      .setName('quantidade')
      .setDescription(`Quantos criar (máx ${MAX_QUANTITY})`)
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_QUANTITY)
  )
  .toJSON();

async function handleCriarCommand(interaction) {
  if (interaction.user.id !== AUTHORIZED_USER_ID) {
    await interaction.reply({ content: '⛔ Você não tem permissão para usar esse comando.', ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '⛔ Esse comando só funciona dentro de um servidor.', ephemeral: true });
    return;
  }

  const tipo = interaction.options.getString('tipo');
  const nome = interaction.options.getString('nome');
  // Trava extra no código, além do limite já imposto pela própria UI do Discord (setMaxValue)
  const quantidade = Math.min(interaction.options.getInteger('quantidade'), MAX_QUANTITY);

  const me = guild.members.me;
  const requiredPerm = tipo === 'cargo' ? PermissionFlagsBits.ManageRoles : PermissionFlagsBits.ManageChannels;
  if (!me.permissions.has(requiredPerm)) {
    await interaction.reply({
      content: `⛔ Eu não tenho permissão de ${tipo === 'cargo' ? 'Gerenciar Cargos' : 'Gerenciar Canais'} nesse servidor.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const created = [];
  const failed = [];

  // Cria um de cada vez (nunca em paralelo) — são no máximo MAX_QUANTITY, então não há
  // necessidade de otimizar velocidade, e assim fica mais fácil tratar rate limit/erro de cada um.
  for (let i = 1; i <= quantidade; i++) {
    const itemName = quantidade === 1 ? nome : `${nome} ${i}`;
    try {
      if (tipo === 'cargo') {
        const role = await guild.roles.create({
          name: itemName,
          reason: `Criado via /criar por ${interaction.user.tag}`,
        });
        created.push(role.name);
      } else {
        const channel = await guild.channels.create({
          name: itemName,
          type: ChannelType.GuildText,
          reason: `Criado via /criar por ${interaction.user.tag}`,
        });
        created.push(channel.name);
      }
    } catch (err) {
      console.error('[CRIAR] Erro ao criar item:', err);
      failed.push(itemName);
    }
  }

  const label = tipo === 'cargo' ? 'Cargos' : 'Chats';
  const lines = [`✅ ${label} criados: ${created.length}/${quantidade}`];
  if (created.length) lines.push(created.map((n) => `• ${n}`).join('\n'));
  if (failed.length) {
    lines.push(`❌ Falharam: ${failed.length}`);
    lines.push(failed.map((n) => `• ${n}`).join('\n'));
  }

  await interaction.editReply({ content: lines.join('\n') });
}

module.exports = { criarCommand, handleCriarCommand };