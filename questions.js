/**
 * Cada pergunta tem:
 *  - category: título da seção mostrado no embed
 *  - number: numeração exibida (formato 〔01〕)
 *  - label: nome curto usado no log (transcript) — se faltar, usa o texto da pergunta
 *  - text: a pergunta em si (aceita **negrito** markdown do Discord)
 *  - type:
 *      'text'   → o usuário digita a resposta
 *      'choice' → o usuário clica em UM botão (ou digita exatamente uma das opções)
 *      'multi'  → o usuário marca UMA OU MAIS opções num menu
 *  - options: obrigatório em 'choice' (até 5) e 'multi' (até 25)
 *  - roles (opcional, só 'choice'/'multi'): { 'Opção': 'ID do cargo' }. O cargo da opção escolhida é
 *    entregue na hora; os cargos das outras opções da MESMA pergunta são removidos (assim, quem
 *    refaz o registro e troca de resposta não fica com cargos antigos). ID null/ausente = não entrega cargo.
 *
 * Edite/adicione/remova perguntas livremente. O bot se adapta ao tamanho da lista.
 */
module.exports = [
  // ===== Registro (cada escolha entrega o cargo) =====
  {
    category: '📜 ࿔ Registro 𝜗˚⋆',
    number: '01',
    label: 'Gênero',
    text: 'Selecione abaixo o **gênero** com o qual você se identifica — você recebe o cargo logo em seguida no seu perfil!',
    type: 'choice',
    options: ['Homem', 'Mulher'],
    roles: {
      Homem: '1540407844879339590',
      Mulher: '1540400420495818792',
    },
  },
  {
    category: '📜 ࿔ Registro 𝜗˚⋆',
    number: '02',
    label: 'Dispositivos',
    text: 'Joga ou utiliza quais desses **dispositivos**? *(pode escolher mais de um)*',
    type: 'multi',
    options: ['Mobile', 'Console', 'PC'],
    roles: {
      Mobile: '1543094532483194910',
      Console: '1543094989951606834',
      PC: '1543095215232127007',
    },
  },
  {
    category: '📜 ࿔ Registro 𝜗˚⋆',
    number: '03',
    label: 'Idade',
    text: 'Quantos **anos** você tem?',
    type: 'choice',
    options: ['+16', '-16'],
    roles: {
      '+16': '1540400542998859906',
      '-16': '1540400623227375656',
    },
  },
  {
    category: '📜 ࿔ Registro 𝜗˚⋆',
    number: '04',
    label: 'Atividade',
    text:
      'Selecione abaixo se você seria **frequentemente ativo** ou **moderadamente ativo** na nossa comunidade — ' +
      'o cargo chega logo em seguida no seu perfil!',
    type: 'choice',
    options: ['Frequentemente ativo', 'Moderadamente ativo'],
    roles: {
      'Frequentemente ativo': '1540400902463029359',
      'Moderadamente ativo': '1540400984935768064',
    },
  },
  {
    category: '📜 ࿔ Registro 𝜗˚⋆',
    number: '05',
    label: 'Parte do dia',
    text: 'Selecione abaixo a **parte do dia** em que você seria mais ativo — o cargo chega logo em seguida no seu perfil!',
    type: 'choice',
    options: ['Manhã', 'Tarde e Noite'],
    // ATENÇÃO: os dois IDs chegaram iguais (1540426085835997254), então um deles está errado.
    // Em vez de chutar, os IDs vêm de variáveis de ambiente (Render): ROLE_MANHA_ID e ROLE_TARDE_NOITE_ID.
    // Enquanto não estiverem definidas, a escolha é registrada mas nenhum cargo é entregue.
    roles: {
      Manhã: process.env.ROLE_MANHA_ID || null,
      'Tarde e Noite': process.env.ROLE_TARDE_NOITE_ID || null,
    },
  },
  {
    category: '📜 ࿔ Registro 𝜗˚⋆',
    number: '06',
    label: 'Perfil',
    text: 'Selecione abaixo se você é um **Lutador** ou está por aqui apenas pela **paz/segurança**.',
    type: 'choice',
    options: ['Lutador', 'Paz'],
    roles: {
      Lutador: '1540400687626854551',
      Paz: '1540400765741310052',
    },
  },

  // ===== Sobre a comunidade (só registram a resposta no log, não entregam cargo) =====
  {
    category: '𖤐 COMUNIDADE',
    number: '07',
    label: 'Intuito',
    text: 'Qual seria o seu **intuito** aqui? *(pode escolher mais de um)*',
    type: 'multi',
    options: ['Buscar amizades', 'Jogar em grupo', 'Eventos e lives', 'Competir'],
  },
  {
    category: '𖤐 COMUNIDADE',
    number: '08',
    label: 'Como conheceu',
    text: 'Como conheceu a **𝑯𝒆𝒍𝒉𝒆𝒊𝒎**?',
    type: 'text',
  },
];
