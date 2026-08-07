require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');

const { processMessage } =
require('./core/assistantBrain');

const token = process.env.TOKEN;

const bot = new TelegramBot(token, {
  polling: true
});

console.log("Kevin online.");

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

    bot.sendMessage(
      chatId,
      resposta
    );

  } catch (erro) {

    console.log(erro);

    bot.sendMessage(
      chatId,
      'Erro no cérebro.'
    );
  }
});
