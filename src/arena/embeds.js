const { EmbedBuilder } = require('discord.js');
const config = require('../config');

const ARENA_COLOR = 0x8b0000;

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`⚔️ ${config.theme.name} ・ ARENA 1V1`)
    .setDescription(
      `> Prove sua força na arena. Conquiste glória, honra e suba ao topo do ranking!\n\n` +
        `📜 **COMO FUNCIONA O MATCHMAKING:**\n` +
        `> • Clique em **⚔️ Entrar na Fila** para procurar um oponente.\n` +
        `> • Ao encontrar outro jogador, os dois serão colocados em um confronto 1v1.\n` +
        `> • Uma sala privada será criada para a partida.\n` +
        `> • O link do Servidor VIP do Roblox será enviado na sala.\n` +
        `> • Após o combate, a Moderação registra o vencedor.\n\n` +
        `🏆 **SISTEMA DE PONTUAÇÃO — ELO:**\n` +
        `┣ 🥇 Vitória 3x0: **+25 pts** ┃ Derrota 3x0: **-25 pts**\n` +
        `┗ 🥈 Vitória com Round perdido: **+15 pts** ┃  Derrota com 1 Round vencido: **-10 pts**\n\n` +
        `🎮 **Modo de jogo:** MD5 *(Melhor de 5)*`
    )
    .setFooter({ text: config.theme.footer });
}

function queueEmbed(member, points) {
  return new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`⚔️ ${config.theme.name} ・ MATCHMAKING`)
    .setDescription('> Os portões da arena foram abertos.')
    .addFields(
      { name: '🩸 Gladiador', value: `<@${member.id}>`, inline: true },
      { name: '⏳ Status', value: 'Procurando adversário...', inline: true },
      { name: '🏆 Pontos', value: `${points.toLocaleString('pt-BR')} pts`, inline: true }
    );
}

function matchEmbed(match, p1, p2) {
  return new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`⚔️ ${config.theme.name} ・ CONFRONTO 1V1`)
    .setDescription('> Dois guerreiros foram escolhidos. Que o mais forte prevaleça.')
    .addFields(
      { name: '🩸 GLADIADOR 1', value: `<@${match.player1_id}>\n🏆 Pontos: **${p1.points}**`, inline: true },
      { name: '⚔️ VS ⚔️', value: '\u200b', inline: true },
      { name: '🩸 GLADIADOR 2', value: `<@${match.player2_id}>\n🏆 Pontos: **${p2.points}**`, inline: true }
    );
}

function vipLinkEmbed(link) {
  return new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setDescription(
      link
        ? `🔗 **SERVIDOR VIP DO ROBLOX**\n${link}`
        : `⚠️ Nenhum link de Servidor VIP configurado ainda. Peça pra staff rodar \`/arena link\`.`
    );
}

function combatGuidelinesEmbed() {
  return new EmbedBuilder()
    .setColor(0x2f3136)
    .setDescription(
      `📜 **DIRETRIZES DO COMBATE**\n` +
        `• Os dois jogadores devem entrar no Servidor VIP.\n` +
        `• O combate deve ser realizado normalmente.\n` +
        `• Após o término, um Moderador deverá registrar o resultado.\n` +
        `• Somente membros autorizados da Moderação poderão registrar o resultado.\n` +
        `• O resultado, após confirmado, atualiza automaticamente os pontos e estatísticas.`
    );
}

function resultEmbed({
  winnerId,
  loserId,
  winnerUser,
  matchNumber,
  finishedAt,
  scoreLine,
  winnerBefore,
  winnerAfter,
  loserBefore,
  loserAfter,
  currentStreak,
  moderatorId,
}) {
  const winnerDelta = winnerAfter - winnerBefore;
  const loserDelta = loserAfter - loserBefore;
  const finishedUnix = Math.floor(new Date(finishedAt).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`🏆 ${winnerUser?.username ?? 'Guerreiro'} venceu`)
    .setDescription(`\`M-${matchNumber}\` · ⚔️ 1v1 MD5 · encerrada <t:${finishedUnix}:R>`)
    .addFields(
      { name: 'Placar', value: `\`\`\`${scoreLine}\`\`\`` },
      { name: '🏆 Vencedor', value: `<@${winnerId}>\n🗡️ ${winnerBefore} → ${winnerAfter} **+${winnerDelta}**`, inline: true },
      { name: '💀 Derrotado', value: `<@${loserId}>\n🛡️ ${loserBefore} → ${loserAfter} **${loserDelta}**`, inline: true }
    );

  if (currentStreak >= 2) {
    embed.addFields({ name: '\u200b', value: `🔥 <@${winnerId}> está com **${currentStreak} vitórias seguidas!**` });
  }

  if (winnerUser) embed.setThumbnail(winnerUser.displayAvatarURL());

  embed.setFooter({ text: 'Confirmado pela Moderação • bot by johankkjk' });

  return embed;
}

function cancelledEmbed(moderatorId) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('❌ Partida cancelada')
    .setDescription(
      `A partida foi cancelada pela Moderação (<@${moderatorId}>). Nenhum ponto foi alterado.`
    );
}

function rankingEmbed(players, requesterId) {
  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`🏆 ${config.theme.name} ・ RANKING DA ARENA`)
    .setDescription('> Os melhores guerreiros da Helheim, classificados por seus feitos na arena.');

  if (!players.length) {
    embed.addFields({ name: '\u200b', value: 'Ainda não há guerreiros no ranking.' });
    return embed;
  }

  const positionEmojis = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const top10 = players.slice(0, 10);
  const lines = top10.map((p, i) => {
    const pos = positionEmojis[i];
    const total = p.wins + p.losses;
    const winRate = total > 0 ? ((p.wins / total) * 100).toFixed(1) : '0.0';
    const you = p.discord_id === requesterId ? '  ◀ VOCÊ' : '';
    return `${pos} <@${p.discord_id}>${you}\n ${p.points} pts ┃ 🗡️ ${p.wins}V / 💀 ${p.losses}D ┃ 📈 ${winRate}% WR`;
  });

  embed.addFields({ name: '\u200b', value: lines.join('\n\n') });
  return embed;
}

function profileEmbed(member, player, position) {
  return new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`👤 ${config.theme.name} ・ PERFIL`)
    .setThumbnail(member.displayAvatarURL())
    .addFields(
      { name: '👤 USER', value: `<@${member.id}>`, inline: true },
      { name: '🏆 PONTOS', value: `${player.points} pts`, inline: true },
      { name: '🏅 POSIÇÃO RANK', value: `#${position}`, inline: true },
      { name: '🗡️ VITÓRIAS', value: `${player.wins}`, inline: true },
      { name: '🛡️ DERROTAS', value: `${player.losses}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🔥 STREAK ATUAL', value: `${player.current_streak}`, inline: true },
      { name: '🏆 MAIOR STREAK', value: `${player.best_streak}`, inline: true }
    );
}

module.exports = {
  panelEmbed,
  queueEmbed,
  matchEmbed,
  vipLinkEmbed,
  combatGuidelinesEmbed,
  resultEmbed,
  cancelledEmbed,
  rankingEmbed,
  profileEmbed,
};
