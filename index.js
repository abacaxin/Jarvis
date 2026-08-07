require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const logger = require('./services/logger');

const { processMessage, detectMode } =
require('./core/assistantBrain');

const token = process.env.TOKEN;

if (!token) {

  logger.error('TOKEN nao configurado no .env, encerrando.');

  process.exit(1);
}

process.on('uncaughtException', (erro) => {

  logger.error('Uncaught exception', erro);

  process.exit(1);
});

process.on('unhandledRejection', (erro) => {

  logger.error('Unhandled rejection', erro);

  process.exit(1);
});

const bot = new TelegramBot(token, {
  polling: true
});

logger.info('Kevin online.');

bot.on('polling_error', (erro) => {
  logger.error('Erro de polling', erro);
});

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

    bot.sendMessage(
      chatId,
      'Kevin online e operacional.'
    );

    return;
  }

  try {

    if (detectMode(texto) === 'deep') {

      bot.sendMessage(
        chatId,
        '🧠 Modo análise ativado...'
      );
    }

    bot.sendChatAction(chatId, 'typing');

    const resposta =
    await processMessage({

      texto,

      profileFile:
      './memory/profile.json',

      projectsFile:
      './memory/projects.json',

      knowledgeFile:
      './memory/knowledge.json',

      conversationsFile:
      './memory/conversations.json'
    });

    sendLong(chatId, resposta);

  } catch (erro) {

    logger.error(`Erro processando mensagem de ${chatId}`, erro);

    bot.sendMessage(
      chatId,
      'Erro no cérebro.'
    );
  }
});
