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
const TYPING_REFRESH_MS = 4000;

function startTypingLoop(chatId) {

  bot.sendChatAction(chatId, 'typing').catch(() => {});

  return setInterval(() => {

    bot.sendChatAction(chatId, 'typing').catch(() => {});

  }, TYPING_REFRESH_MS);
}

async function sendLong(chatId, texto, placeholderId) {

  const chunks = [];

  for (let i = 0; i < texto.length; i += TELEGRAM_MAX_LENGTH) {

    chunks.push(texto.slice(i, i + TELEGRAM_MAX_LENGTH));
  }

  if (placeholderId) {

    try {

      await bot.editMessageText(chunks[0], {
        chat_id: chatId,
        message_id: placeholderId
      });

    } catch (erro) {

      logger.warn(
        'Falha ao editar mensagem, enviando nova',
        erro.message
      );

      await bot.sendMessage(chatId, chunks[0]);
    }

  } else {

    await bot.sendMessage(chatId, chunks[0]);
  }

  for (let i = 1; i < chunks.length; i++) {

    await bot.sendMessage(chatId, chunks[i]);
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

  let typingLoop;

  try {

    if (detectMode(texto) === 'deep') {

      await bot.sendMessage(
        chatId,
        '🧠 Modo análise ativado...'
      );
    }

    const placeholder =
    await bot.sendMessage(chatId, '💭 Pensando...');

    typingLoop = startTypingLoop(chatId);

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
      './memory/conversations.json',

      todosFile:
      './memory/todos.json'
    });

    await sendLong(chatId, resposta, placeholder.message_id);

  } catch (erro) {

    logger.error(`Erro processando mensagem de ${chatId}`, erro);

    bot.sendMessage(
      chatId,
      'Erro no cérebro.'
    );

  } finally {

    if (typingLoop) clearInterval(typingLoop);
  }
});
