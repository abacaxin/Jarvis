/**
 * Conversa por voz com o Kevin, local (sem Telegram ainda).
 *
 * Aperta Enter pra falar, Enter de novo pra parar. O audio vira texto
 * (Groq Whisper, services/audioTranscriber.js) e entra no processMessage()
 * normal — a mesma personalidade/memoria de sempre, so que a entrada
 * veio de voz em vez de teclado. A resposta do Kevin e falada de volta
 * (ElevenLabs, voice/speak_server.py — Groq nao tem voz em portugues).
 *
 * Roda: npm run voice:test
 */

require('dotenv').config();

const voiceService = require('./voiceService');
const { transcribeAudio } = require('../../services/audioTranscriber');
const { processMessage } = require('../../core/assistantBrain');

const MEMORY_FILES = {

  profileFile: './memory/profile.json',
  projectsFile: './memory/projects.json',
  knowledgeFile: './memory/knowledge.json',
  conversationsFile: './memory/conversations.json',
  todosFile: './memory/todos.json'
};

voiceService.on('voice.activated', () => {
  console.log('[VOICE] Sistema de voz ativado');
});

voiceService.on('voice.recording.started', () => {
  console.log('[VOICE] 🎙️  Gravando... (Enter pra parar)');
});

voiceService.on('voice.recording.stopped', () => {
  console.log('[VOICE] Gravação encerrada.');
});

voiceService.on('voice.speaking.started', () => {
  console.log('[KEVIN] 🔊 Falando...');
});

async function conversationLoop() {

  console.log('[KEVIN] Modo de conversa por voz.');
  console.log('[HINT] Ctrl+C pra sair a qualquer momento.\n');

  while (true) {

    console.log('\n[VOICE] Pressione Enter para começar a falar...');

    let gravacao;

    try {

      gravacao = await voiceService.recordUtterance();

    } catch (erro) {

      console.error('[VOICE][ERRO]', erro.message);
      continue;
    }

    console.log(`[VOICE] Gravado (${gravacao.duration_seconds}s), transcrevendo...`);

    let transcricao;

    try {

      transcricao = await transcribeAudio(gravacao.path);

    } catch (erro) {

      console.error('[VOICE][ERRO] Falha na transcrição:', erro.message);
      continue;
    }

    if (!transcricao || !transcricao.trim()) {

      console.log('[KEVIN] Não entendi nada, tenta de novo.');
      continue;
    }

    console.log(`[VOCÊ] "${transcricao.trim()}"`);

    let resposta, respostaFalada;

    try {

      ({ resposta, resposta_falada: respostaFalada } = await processMessage({
        texto: transcricao,
        ...MEMORY_FILES
      }));

      console.log(`[KEVIN] ${resposta}`);

    } catch (erro) {

      console.error('[KEVIN][ERRO]', erro.message);
      continue;
    }

    try {

      await voiceService.speak(respostaFalada);

    } catch (erro) {

      console.error('[VOICE][ERRO] Falha ao falar a resposta:', erro.message);
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n[KEVIN] Encerrando conversa por voz.');
  voiceService.stopSpeaking();
  process.exit(0);
});

conversationLoop();
