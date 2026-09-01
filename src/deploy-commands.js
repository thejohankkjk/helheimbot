const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('./config');

const commands = [
  new SlashCommandBuilder()
    .setName('recrutamento')
    .setDescription('Envia a mensagem oficial de recrutamento com o botão de inscrição')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('[DEPLOY] Registrando slash commands no servidor...');
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands,
    });
    console.log('[DEPLOY] Comandos registrados com sucesso!');
  } catch (err) {
    console.error('[DEPLOY] Erro ao registrar comandos:', err);
    process.exit(1);
  }
})();
