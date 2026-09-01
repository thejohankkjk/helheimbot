/**
 * Cada pergunta tem:
 *  - category: título da seção (com emoji) mostrado no embed
 *  - number: numeração exibida (formato 〔01〕)
 *  - text: a pergunta em si (aceita **negrito** markdown do Discord)
 *  - type: 'text' (usuário digita) ou 'choice' (usuário clica em botão)
 *  - options: obrigatório quando type === 'choice' (máximo 5 itens)
 *
 * Edite/adicione/remova perguntas livremente. O bot se adapta ao tamanho da lista.
 */
module.exports = [
  { category: '🩸 INFORMAÇÕES', number: '01', text: 'Qual é seu **Nick (ID)** no Roblox?', type: 'text' },
  { category: '🩸 INFORMAÇÕES', number: '02', text: 'Há quanto tempo você joga **Gakuran**?', type: 'text' },
  {
    category: '🩸 INFORMAÇÕES',
    number: '03',
    text: 'Já participou de outras **gangues**? Quais e por que saiu?',
    type: 'text',
  },
  { category: '🩸 INFORMAÇÕES', number: '04', text: 'Qual sua **altura** e seu **estilo de luta**?', type: 'text' },

  { category: '⚔️ MOTIVAÇÃO', number: '05', text: 'O que você pode **agregar à gangue**?', type: 'text' },
  {
    category: '⚔️ MOTIVAÇÃO',
    number: '06',
    text: 'Está disposto a **seguir a hierarquia e as ordens da liderança**?',
    type: 'choice',
    options: ['Sim', 'Não'],
  },

  {
    category: '🥊 MENTALIDADE',
    number: '07',
    text: 'Quantas horas por dia costuma jogar e em quais horários?',
    type: 'text',
  },
  {
    category: '🥊 MENTALIDADE',
    number: '08',
    text: 'Como reage ao **perder uma luta ou ser pressionado**?',
    type: 'text',
  },
  {
    category: '🥊 MENTALIDADE',
    number: '09',
    text: 'Você ajudaria um membro da **𝑯𝒆𝒍𝒉𝒆𝒊𝒎** quando necessário?',
    type: 'choice',
    options: ['Sim', 'Não'],
  },

  {
    category: '🩸 ÚLTIMA PALAVRA',
    number: '10',
    text:
      'Em poucas palavras, o que significam para você:\n' +
      '> **Lealdade:**\n> **Disciplina:**\n> **Família:**\n> **Respeito:**\n\n' +
      '*(pode responder tudo em uma única mensagem, uma linha para cada)*',
    type: 'text',
  },
  {
    category: '🩸 ÚLTIMA PALAVRA',
    number: '11',
    text: 'Existe algo mais que gostaria que a **liderança da 𝑯𝒆𝒍𝒉𝒆𝒊𝒎** soubesse?',
    type: 'text',
  },
];
