require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const logger = require('./services/logger');

const { processMessage, detectMode } =
require('./core/assistantBrain');

const visionService = require('./vision/interface/visionService');
const { describeImage } = require('./services/visionAnalyzer');
const { sendCommand: sendHubCommand } = require('./hub/interface/hubClient');

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

// sobe o processo Python da visao em segundo plano, sem esperar por
// ele — paga o import pesado do mediapipe (~28s medidos nesta maquina)
// durante o boot do Kevin, escondido, em vez de no primeiro /foto real.
visionService.prewarm();

bot.on('polling_error', (erro) => {
  logger.error('Erro de polling', erro);
});

const TELEGRAM_MAX_LENGTH = 4000;
const TYPING_REFRESH_MS = 4000;

// tempo sem nenhum gesto ate desligar a visao sozinha — reinicia a
// cada foto tirada, entao uma sessao com fotos frequentes fica ativa
// indefinidamente; so expira se ninguem gesticular por esse tempo.
const VISION_IDLE_TIMEOUT_MS = 60000;

const MEMORY_FILES = {

  profileFile: './memory/profile.json',
  projectsFile: './memory/projects.json',
  knowledgeFile: './memory/knowledge.json',
  conversationsFile: './memory/conversations.json',
  todosFile: './memory/todos.json'
};

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

// COMANDO DE VISAO
// Ativa o vision system e o deixa ativo — cada gesto reconhecido dispara
// uma foto, descrita separadamente (services/visionAnalyzer.js, ver
// docs/decisoes.md sobre por que nao entra na chamada unica do brain) e
// injetada no Kevin normal (processMessage) como se fosse mensagem do
// usuario. A sessao SO desliga por /pare ou por inatividade — nao mais
// a cada foto (o engine ja tem cooldown proprio contra reconhecimento
// fantasma logo apos uma acao, ver gestures.action_cooldown_seconds em
// vision/config.json). Simulacao local fica em
// vision/interface/simulateKevinCommand.js; esta e a ativacao real.
let activeVisionCleanup = null;

async function handleVisionCommand(chatId) {

  if (visionService.getStatus().status !== 'idle') {

    await bot.sendMessage(chatId, 'A visão já tá ativa, aguenta aí. Manda /pare pra desligar.');
    return;
  }

  await bot.sendMessage(
    chatId,
    '📷 Visão ativada — feche o punho (ou junte e afaste as duas mãos) sempre que quiser uma foto. Manda /pare quando terminar.'
  );

  let idleTimeout;

  const cleanup = () => {

    clearTimeout(idleTimeout);
    visionService.off('vision.capture.completed', onCapture);
    visionService.off('vision.error', onError);
    visionService.off('vision.process.exit', onProcessExit);
    activeVisionCleanup = null;
  };

  const resetIdleTimeout = () => {

    clearTimeout(idleTimeout);

    idleTimeout = setTimeout(async () => {

      cleanup();
      visionService.stopGestureRecognition();
      await bot.sendMessage(chatId, 'Visão desativada por inatividade.');

    }, VISION_IDLE_TIMEOUT_MS);
  };

  const onCapture = async (result) => {

    // continua ativo — a sessao so termina por /pare ou inatividade,
    // nao a cada foto.
    resetIdleTimeout();

    await bot.sendMessage(chatId, '🖼️ Foto capturada, analisando...');

    // TEMPORARIO: manda a foto de volta so pra confirmar visualmente que
    // a captura esta funcionando de verdade, enquanto isso ainda nao
    // esta validado no Pi. Nao trava o fluxo se falhar (arquivo pode ja
    // ter sido limpo, etc).
    try {

      await bot.sendPhoto(chatId, result.path);

    } catch (erro) {

      logger.warn('Falha ao enviar foto de debug', erro.message);
    }

    let descricao;

    try {

      descricao = await describeImage(result.path);

    } catch (erro) {

      logger.error('Erro analisando imagem', erro);
      await bot.sendMessage(chatId, 'Tirei a foto, mas deu ruim analisando ela.');
      return;
    }

    try {

      const { resposta } = await processMessage({

        texto: `[Acabei de tirar uma foto do ambiente usando a visão. O que a foto mostra: ${descricao}]`,
        ...MEMORY_FILES
      });

      await bot.sendMessage(chatId, resposta);

    } catch (erro) {

      logger.error('Erro processando descricao da imagem', erro);
      await bot.sendMessage(chatId, 'Tirei a foto e entendi o que é, mas deu ruim na resposta.');
    }
  };

  const onError = async ({ message }) => {

    cleanup();
    visionService.stopGestureRecognition();

    logger.error('Erro no vision system', message);
    await bot.sendMessage(chatId, `Deu erro na visão: ${message}`);
  };

  // rede de seguranca: se o processo Python cair sem passar por
  // emit_error() (crash bruto, fora do try/except do engine.py), a
  // sessao ficaria "presa" sem ninguem avisar o usuario. Saida limpa
  // (code 0, ex: alguem fechou a janela de debug com "q") nao e erro —
  // so avisa em saida inesperada.
  const onProcessExit = async ({ code }) => {

    if (code === 0) return;

    cleanup();

    logger.error(`Vision engine encerrou inesperadamente (codigo ${code})`);
    await bot.sendMessage(chatId, 'A visão parou de responder. Manda /foto pra tentar de novo.');
  };

  visionService.on('vision.capture.completed', onCapture);
  visionService.on('vision.error', onError);
  visionService.on('vision.process.exit', onProcessExit);

  activeVisionCleanup = cleanup;

  resetIdleTimeout();
  visionService.startGestureRecognition({ show: false });
}

async function handleStopVisionCommand(chatId) {

  if (visionService.getStatus().status === 'idle') {

    await bot.sendMessage(chatId, 'A visão já não tá ativa.');
    return;
  }

  if (activeVisionCleanup) activeVisionCleanup();
  visionService.stopGestureRecognition();

  await bot.sendMessage(chatId, 'Visão desativada.');
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

  // VISAO
  if (texto === '/foto' || texto === '/vision') {

    return handleVisionCommand(chatId);
  }

  if (texto === '/pare' || texto === '/parar') {

    return handleStopVisionCommand(chatId);
  }

  // LUZ
  // Comando explicito, nao decisao do LLM — acao com efeito fisico real,
  // sem camada de permissao/confirmacao ainda (ver docs/visao-produto.md).
  if (texto === '/luz on' || texto === '/luz off') {

    const acao = texto.endsWith('on') ? 'on' : 'off';

    try {

      await sendHubCommand('quarto_luz', acao);

      await bot.sendMessage(
        chatId,
        acao === 'on' ? 'Luz ligada.' : 'Luz apagada.'
      );

    } catch (erro) {

      logger.error('Erro no comando de luz', erro);

      await bot.sendMessage(chatId, `Não consegui: ${erro.message}`);
    }

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

    const { resposta } =
    await processMessage({

      texto,
      ...MEMORY_FILES
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
