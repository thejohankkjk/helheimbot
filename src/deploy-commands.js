// Este script não é mais necessário no dia a dia — o index.js já registra os
// slash commands globalmente sozinho toda vez que o bot liga (veja o evento
// 'clientReady'). Mantido aqui só como utilitário manual, se precisar.
const { REST, Routes } = require('discord.js');
const config = require('./config');

(async () => {
  try {
    console.log('[DEPLOY] Esse script é legado — o index.js já registra os comandos sozinho ao ligar.');
    console.log('[DEPLOY] Rode "npm start" em vez disso.');
  } catch (err) {
    console.error('[DEPLOY] Erro:', err);
    process.exit(1);
  }
})();
