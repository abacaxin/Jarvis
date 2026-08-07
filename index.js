require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const { processMessage } =
require('./core/assistantBrain');

const token = process.env.TOKEN;

const bot = new TelegramBot(token, {
  polling: true
});

console.log("Kevin online.");

bot.on('polling_error', (erro) => {
  console.log('Erro de polling:', erro);
});

// chatId -> [{role, content}], ultimas 10 trocas (20 mensagens)
const sessionHistory = new Map();
const MAX_HISTORY_MESSAGES = 20;
const TELEGRAM_MAX_LENGTH = 4000;

function sendLong(chatId, texto) {

  for (let i = 0; i < texto.length; i += TELEGRAM_MAX_LENGTH) {

    bot.sendMessage(
      chatId,
      texto.slice(i, i + TELEGRAM_MAX_LENGTH)
    );
  }
}

bot.on('message', async (msg) => {

  const chatId = msg.chat.id;
  const texto = msg.text;

  if (!texto) return;

  // START
  if (texto === '/start') {

    sessionHistory.delete(chatId);

    bot.sendMessage(
      chatId,
      'Kevin online e operacional.'
    );

    return;
  }

  try {

    bot.sendChatAction(chatId, 'typing');

    const history =
    sessionHistory.get(chatId) || [];

    const resposta =
    await processMessage({

      texto,
      history,

      profileFile:
      './memory/profile.json',

      projectsFile:
      './memory/projects.json',

      knowledgeFile:
      './memory/knowledge.json',

      conversationsFile:
      './memory/conversations.json'
    });

    history.push(
      { role: 'user', content: texto },
      { role: 'assistant', content: resposta }
    );

    sessionHistory.set(
      chatId,
      history.slice(-MAX_HISTORY_MESSAGES)
    );

    sendLong(chatId, resposta);

  } catch (erro) {

    console.log(erro);

    bot.sendMessage(
      chatId,
      'Erro no cérebro.'
    );
  }
});
