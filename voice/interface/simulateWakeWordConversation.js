/**
 * Conversa por voz hands-free — diga "Hey Jarvis" (wake word padrão,
 * pré-treinada, zero configuração) e fale o comando ou a mensagem numa
 * frase só (ex: "Hey Jarvis, ativa a visão") — grava sozinho até você
 * parar de falar (detecção de silêncio, sem precisar de Enter — ver
 * wake_listener.py). Diferente de simulateVoiceConversation.js
 * (ativação manual por Enter), que continua existindo à parte pra
 * testar sem depender da wake word.
 *
 * A intenção da fala é classificada em linguagem natural
 * (services/intentRouter.js — chamada Groq separada, não é comando
 * fixo tipo "/foto") entre conversa normal, ativar a visão (espera
 * gesto) ou capturar foto direto (sem gesto).
 *
 * Quer "Kevin" como wake word de verdade em vez de "Hey Jarvis"? Treine
 * um modelo customizado (grátis, mas exige login Google/GitHub) em
 * openwakeword.com/train e aponte `wake_word_model` (em
 * voice/config.json) pro .onnx baixado.
 *
 * Sessão contínua: uma vez que a wake word ativa de verdade, a conversa
 * inteira (varios turnos) segue sem repetir "Hey Jarvis" — cada
 * resposta volta a escutar direto (forceListenNow). Termina dizendo
 * algo tipo "pode encerrar" (intent "end_session", ver
 * services/intentRouter.js) ou parando de falar por alguns turnos
 * seguidos (MAX_CONSECUTIVE_EMPTY_TURNS).
 *
 * Roda: npm run voice:wake
 */

require('dotenv').config();

const voiceService = require('./voiceService');
const { transcribeAudio } = require('../../services/audioTranscriber');
const { classifyIntent } = require('../../services/intentRouter');
const { describeImage } = require('../../services/visionAnalyzer');
const { processMessage } = require('../../core/assistantBrain');
const visionService = require('../../vision/interface/visionService');

const MEMORY_FILES = {

  profileFile: './memory/profile.json',
  projectsFile: './memory/projects.json',
  knowledgeFile: './memory/knowledge.json',
  conversationsFile: './memory/conversations.json',
  todosFile: './memory/todos.json'
};

// generoso de proposito enquanto ainda esta testando/ajustando o
// reconhecimento de gesto — nao quer ficar cortado no meio do teste.
const VISION_GESTURE_TIMEOUT_MS = 5 * 60 * 1000;

let processing = false;

// sessao continua: depois da wake word ativar de verdade (nao forcada),
// todo turno seguinte volta a escutar direto (forceListenNow), sem
// precisar repetir "Hey Jarvis" — ate a intencao "end_session" ou
// turnos vazios/curtos demais seguidos (evita loop gastando Whisper
// atras de silencio).
let sessionActive = false;
let consecutiveEmptyTurns = 0;
const MAX_CONSECUTIVE_EMPTY_TURNS = 3;

// ---------------------------------------------------------------
// VISAO — acionada por intencao, nao por comando fixo (ver
// services/intentRouter.js). Duas formas, mapeando 1:1 pro contrato
// de vision/interface/visionService.js: capture() de uma vez, ou
// startGestureRecognition() esperando o usuario fazer um gesto.
// ---------------------------------------------------------------

async function respondToVisionResult(imagePath) {

  const descricao = await describeImage(imagePath);

  const { resposta, resposta_falada } = await processMessage({
    texto: `[Acabei de tirar uma foto do ambiente usando a visão. O que a foto mostra: ${descricao}]`,
    ...MEMORY_FILES
  });

  console.log(`[KEVIN] ${resposta}`);
  await voiceService.speak(resposta_falada);
}

async function handleVisionCapture() {

  console.log('[VISION] Capturando direto (sem gesto)...');
  await voiceService.speak('Certo, tirando a foto.');

  try {

    // show: true — mesma razao do handleVisionActivate, mostra um
    // flash rapido do frame capturado (voce esta na propria maquina).
    const result = await visionService.capture({ show: true });
    await respondToVisionResult(result.path);

  } catch (erro) {

    console.error('[VISION][ERRO]', erro.message);
    await voiceService.speak('Deu erro tentando tirar a foto.');
  }
}

function handleVisionActivate() {

  if (visionService.getStatus().status !== 'idle') {
    return voiceService.speak('A visão já está ativa.');
  }

  return new Promise((resolve) => {

    let done = false;

    const cleanup = () => {

      clearTimeout(timeoutHandle);
      visionService.off('vision.capture.completed', onCapture);
      visionService.off('vision.error', onError);
    };

    const onCapture = async (result) => {

      if (done) return;
      done = true;

      cleanup();
      visionService.stopGestureRecognition();

      try {

        await respondToVisionResult(result.path);

      } catch (erro) {

        console.error('[VISION][ERRO]', erro.message);
        await voiceService.speak('Tirei a foto, mas deu ruim analisando ela.');
      }

      resolve();
    };

    const onError = async ({ message }) => {

      if (done) return;
      done = true;

      cleanup();
      visionService.stopGestureRecognition();

      console.error('[VISION][ERRO]', message);
      await voiceService.speak(`Deu erro na visão: ${message}`);

      resolve();
    };

    visionService.on('vision.capture.completed', onCapture);
    visionService.on('vision.error', onError);

    const timeoutHandle = setTimeout(async () => {

      if (done) return;
      done = true;

      cleanup();
      visionService.stopGestureRecognition();

      await voiceService.speak('Ninguém fez o gesto a tempo, desativando a visão.');
      resolve();

    }, VISION_GESTURE_TIMEOUT_MS);

    // show: true — diferente do /foto no Telegram (sem tela local), a
    // conversa por voz roda na sua propria maquina, entao faz sentido
    // abrir a janela de debug (webcam + landmarks) pra voce ver o
    // gesto sendo reconhecido, mesma janela do `npm run vision:test`.
    voiceService.speak('Visão ativada. Pode fazer o gesto.')
      .then(() => visionService.startGestureRecognition({ show: true }));
  });
}

// ---------------------------------------------------------------
// LOGS
// ---------------------------------------------------------------

voiceService.on('voice.activated', () => {
  console.log('[VOICE] Sistema de voz ativado.');
});

voiceService.on('voice.wake_word.listening', () => {
  console.log('[VOICE] 👂 Escutando por "Hey Jarvis"...\n');
});

voiceService.on('voice.wake_word.detected', ({ score, forced }) => {

  if (forced) {
    console.log('[VOICE] 🎤 Gravando sua resposta (para sozinho no silêncio).');
  } else {
    console.log(`[VOICE] 🔴 Wake word detectada (score ${score}) — pode falar (para sozinho no silêncio).`);
    sessionActive = true;
    consecutiveEmptyTurns = 0;
  }
});

// diagnostico pra calibrar silence_threshold (voice/config.json) com
// numero real em vez de chute — mostra o nivel de audio (RMS) contra o
// limiar configurado, a cada ~0.5s enquanto grava o comando.
voiceService.on('voice.recording.level', ({ rms, threshold }) => {
  const acimaDoLimiar = rms > threshold ? '🔊 acima' : '🔈 abaixo';
  console.log(`[VOICE]    nível: ${rms} (limiar: ${threshold}) — ${acimaDoLimiar}`);
});

// diagnostico pra calibrar wake_word_threshold — mostra tentativas que
// chegaram perto da wake word mas nao bateram o limiar (score >= 0.1).
// Se aparecer sempre logo abaixo do limiar, baixa wake_word_threshold
// em voice/config.json; se nunca aparecer nada nem tentando falar bem
// perto do mic, o problema é outro (mic/modelo).
voiceService.on('voice.wake_word.score', ({ score, threshold }) => {
  console.log(`[VOICE]    tentativa de wake word: score ${score} (limiar: ${threshold}) — não bateu`);
});

voiceService.on('voice.capture.completed', async (gravacao) => {

  // wake_listener.py so dispara um capture.completed por vez (o
  // proprio InputStream so processa uma gravacao por vez), mas o guard
  // fica por seguranca contra qualquer sobreposicao futura.
  if (processing) return;
  processing = true;

  // enquanto a sessao estiver ativa, o padrao e continuar ouvindo
  // direto (sem repetir wake word) apos qualquer turno — so muda pra
  // false explicitamente ao encerrar a sessao.
  let keepListening = sessionActive;

  try {

    const motivo = gravacao.stop_reason === 'timeout'
      ? 'parou por TIMEOUT — não detectou silêncio, provavelmente silence_threshold precisa subir'
      : 'parou por silêncio detectado';

    console.log(`[VOICE] Gravado (${gravacao.duration_seconds}s, ${motivo}, nível máx: ${gravacao.max_rms_seen}), transcrevendo...`);

    const transcricao = await transcribeAudio(gravacao.path);

    if (!transcricao || !transcricao.trim()) {

      console.log('[KEVIN] Não entendi nada.');
      consecutiveEmptyTurns++;
      return;
    }

    console.log(`[VOCÊ] "${transcricao.trim()}"`);

    // heuristica: transcricao muito curta (poucas palavras) e provavel
    // que seja só a wake word em si (ex: "Hey Jarvis" pausado antes do
    // comando de verdade) — nao manda isso pro Kevin como se fosse o
    // comando, so continua esperando. Imperfeita (um comando curto de
    // verdade, tipo "para", cai aqui tambem), mas evita o caso mais
    // comum de "ele confundiu a wake word com o comando".
    const palavras = transcricao.trim().split(/\s+/).length;
    if (palavras <= 3) {

      console.log('[VOICE] Só ouvi a wake word (ou algo curto demais) — esperando o comando de verdade...');
      consecutiveEmptyTurns++;
      keepListening = true;
      return;
    }

    consecutiveEmptyTurns = 0;

    const intent = await classifyIntent(transcricao);
    console.log(`[INTENT] ${intent}`);

    if (intent === 'end_session') {

      console.log('[VOICE] Encerrando a sessão.');
      await voiceService.speak('Combinado, até mais.');
      sessionActive = false;
      keepListening = false;

    } else if (intent === 'vision_capture') {

      await handleVisionCapture();

    } else if (intent === 'vision_activate') {

      await handleVisionActivate();

    } else {

      const { resposta, resposta_falada } = await processMessage({
        texto: transcricao,
        ...MEMORY_FILES
      });

      console.log(`[KEVIN] ${resposta}`);
      await voiceService.speak(resposta_falada);
    }

  } catch (erro) {

    console.error('[ERRO]', erro.message);

  } finally {

    processing = false;

    if (sessionActive && consecutiveEmptyTurns >= MAX_CONSECUTIVE_EMPTY_TURNS) {

      console.log(`[VOICE] ${consecutiveEmptyTurns} turnos seguidos sem entender nada — encerrando a sessão por inatividade.`);
      sessionActive = false;
      consecutiveEmptyTurns = 0;
      keepListening = false;
    }

    if (keepListening) {

      console.log('\n[VOICE] 🎤 Sessão ativa — aguardando sua resposta (sem precisar da wake word)...\n');
      voiceService.forceListenNow();

    } else {

      console.log('\n[VOICE] 👂 Escutando por "Hey Jarvis" de novo...\n');
    }
  }
});

voiceService.on('voice.error', ({ message }) => {
  console.error('[VOICE][ERRO]', message);
});

process.on('SIGINT', () => {

  console.log('\n[KEVIN] Encerrando.');
  voiceService.stopWakeListener();
  voiceService.stopSpeaking();
  visionService.stopGestureRecognition();
  process.exit(0);
});

console.log('[KEVIN] Modo hands-free — diga "Hey Jarvis" a qualquer momento.');
console.log('[HINT] Ctrl+C pra sair.\n');

voiceService.startWakeListener();
visionService.prewarm();
