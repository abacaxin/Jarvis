/**
 * Interface entre o Kevin (Node) e o modulo de voz (Python).
 *
 * Mesma forma do vision/interface/visionService.js: spawna processo(s)
 * Python e le eventos JSON (um por linha) do stdout deles.
 *
 * `recordUtterance()` sobe um processo novo por chamada (capture.py —
 * curto, precisa do stdin do terminal pro Enter). `speak()` mantem UM
 * processo vivo entre falas (speak_server.py, fala via ElevenLabs) —
 * importar as libs de audio (pygame) e inicializar o mixer custa
 * segundos sozinho, pagar isso a cada fala deixava o Kevin com um
 * silencio grande antes de responder.
 *
 * `startWakeListener()` sobe wake_listener.py (fica de pe, escutando o
 * microfone o tempo todo) — alternativa a recordUtterance() pra quando
 * a ativacao e por voz ("Hey Jarvis", wake word padrao — trocavel por
 * uma customizada em voice/config.json) em vez de Enter. Emite
 * `voice.wake_word.detected` ao ouvir a wake word, e
 * `voice.capture.completed` quando termina de gravar o comando (por
 * silencio, nao por Enter) — mesmo evento que recordUtterance() usa,
 * so que Node reage a ele via `.on(...)` em vez de esperar uma Promise
 * de uma unica chamada, porque agora dispara varias vezes sozinho.
 *
 * `forceListenNow()` manda o wake_listener.py pular a wake word e
 * comecar a gravar na hora — usado pra follow-up de conversa (o Kevin
 * fez uma pergunta e ta esperando resposta direta, sem repetir a wake
 * word). Mesmo evento `voice.capture.completed` de novo no final.
 *
 * Contrato:
 *   recordUtterance()   → Promise com {path, timestamp, duration_seconds, sample_rate}
 *   speak(texto)         → Promise (resolve quando terminar de falar)
 *   stopSpeaking()        → encerra o speak_server.py (se estiver de pe)
 *   startWakeListener()   → liga a escuta continua pela wake word
 *   stopWakeListener()    → desliga
 *   forceListenNow()      → pula a wake word, grava direto (follow-up)
 *   on('voice.<evento>', payload => ...) → EventEmitter padrao do Node
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const EventEmitter = require('events');
const logger = require('../../services/logger');

const PYTHON_BIN = process.env.VOICE_PYTHON_BIN || 'python3';
const VOICE_DIR = path.join(__dirname, '..');
const CAPTURE_PATH = path.join(VOICE_DIR, 'capture.py');
const SPEAK_SERVER_PATH = path.join(VOICE_DIR, 'speak_server.py');
const WAKE_LISTENER_PATH = path.join(VOICE_DIR, 'wake_listener.py');

const service = new EventEmitter();

let recording = false;
let wakeListenerProcess = null;

// speak_server.py fica de pe entre falas — importar pygame e
// inicializar o mixer de audio tem um custo fixo por processo, pagar
// isso a cada fala deixava um silencio grande antes do Kevin comecar a
// falar. Aqui esse custo e pago uma vez so, na primeira fala da sessao.
let speakProcess = null;
const speakQueue = [];

function spawnPython(scriptPath, { stdin = 'pipe', onEvent } = {}) {

  const proc = spawn(PYTHON_BIN, [scriptPath], {
    cwd: VOICE_DIR,
    stdio: [stdin, 'pipe', 'pipe'],
    // sem isso, o Python no Windows le/escreve stdio como cp1252 por
    // padrao (nao UTF-8) — todo acento do texto que o Kevin fala
    // (ç, ã, õ...) chegava corrompido no speak_server.py antes mesmo
    // de virar audio, o TTS tentava pronunciar lixo em vez do texto
    // certo.
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {

    let event;

    try {

      event = JSON.parse(line);

    } catch (erro) {

      logger.warn('Linha nao-JSON do processo de voz, ignorando', line);
      return;
    }

    service.emit(event.type, event.payload);
    if (onEvent) onEvent(event);
  });

  proc.on('error', (erro) => {
    logger.error('[voice] Falha ao iniciar processo Python', erro.message);
    service.emit('voice.error', { message: `Falha ao iniciar o processo Python: ${erro.message}` });
  });

  proc.stderr.on('data', (data) => {
    logger.warn('[voice]', data.toString().trim());
  });

  return proc;
}

function recordUtterance() {

  if (recording) {
    return Promise.reject(new Error('Ja tem uma gravacao em andamento'));
  }

  recording = true;

  return new Promise((resolve, reject) => {

    let result = null;
    let errorMessage = null;

    // stdin herdado do terminal — precisa receber o Enter de verdade
    // que o usuario aperta (ver capture.py).
    const proc = spawnPython(CAPTURE_PATH, {
      stdin: process.stdin,
      onEvent: (event) => {

        if (event.type === 'voice.capture.completed') result = event.payload;
        if (event.type === 'voice.error') errorMessage = event.payload.message;
      }
    });

    proc.on('exit', (code) => {

      recording = false;

      if (code === 0 && result) {

        resolve(result);

      } else {

        reject(new Error(
          errorMessage || `voice capture saiu com codigo ${code}`
        ));
      }
    });
  });
}

function ensureSpeakProcess() {

  if (speakProcess) return speakProcess;

  // stdin em pipe (fica aberto entre falas) — cada linha escrita nele e
  // um texto novo pra falar, o processo Python nunca fecha sozinho.
  const proc = spawnPython(SPEAK_SERVER_PATH, {
    stdin: 'pipe',
    onEvent: (event) => {

      if (event.type === 'voice.speaking.completed') {

        const pending = speakQueue.shift();
        if (pending) pending.resolve();
      }

      if (event.type === 'voice.error') {

        const pending = speakQueue.shift();
        if (pending) pending.reject(new Error(event.payload.message));
      }
    }
  });

  proc.on('exit', (code) => {

    logger.warn(`[voice] speak_server encerrou (codigo ${code}) — reinicia na proxima fala`);
    speakProcess = null;

    while (speakQueue.length) {

      const pending = speakQueue.shift();
      pending.reject(new Error(`speak_server encerrou inesperadamente (codigo ${code})`));
    }
  });

  speakProcess = proc;
  return proc;
}

function speak(texto) {

  if (!texto || !texto.trim()) return Promise.resolve();

  return new Promise((resolve, reject) => {

    const proc = ensureSpeakProcess();

    speakQueue.push({ resolve, reject });

    // protocolo e uma fala por linha — quebra de linha no meio do
    // texto do Kevin viraria "fim da fala atual" sem querer.
    proc.stdin.write(texto.replace(/\r?\n/g, ' ') + '\n');
  });
}

function stopSpeaking() {

  if (!speakProcess) return;

  // remove o listener de 'exit' antes — sem isso, o encerramento
  // intencional (stdin.end() -> Python sai limpo, codigo 0) dispara o
  // aviso de "encerrou inesperadamente" do listener generico (mesma
  // licao de vision/interface/visionService.js).
  speakProcess.removeAllListeners('exit');
  speakProcess.stdin.end();
  speakProcess = null;
}

function startWakeListener() {

  if (wakeListenerProcess) return;

  // stdin em pipe — nao e mais so escuta passiva do microfone: o Node
  // pode mandar "LISTEN_NOW" pra pular a wake word (ver
  // forceListenNow(), usado quando o Kevin faz uma pergunta e espera
  // resposta direta, sem repetir a wake word).
  const proc = spawnPython(WAKE_LISTENER_PATH, { stdin: 'pipe' });

  proc.on('exit', (code) => {

    logger.warn(`[voice] wake_listener encerrou (codigo ${code})`);
    wakeListenerProcess = null;
  });

  wakeListenerProcess = proc;
}

function stopWakeListener() {

  if (!wakeListenerProcess) return;

  // mesma licao do stopSpeaking() — remove o listener antes de matar,
  // senao um encerramento intencional loga como "inesperado".
  wakeListenerProcess.removeAllListeners('exit');
  wakeListenerProcess.kill('SIGTERM');
  wakeListenerProcess = null;
}

function forceListenNow() {

  // pula a wake word e comeca a gravar direto — usado pra follow-up
  // (o Kevin acabou de fazer uma pergunta, nao devia precisar dizer a
  // wake word de novo so pra responder). Sem-op se o wake_listener nao
  // estiver rodando.
  if (!wakeListenerProcess) return;

  wakeListenerProcess.stdin.write('LISTEN_NOW\n');
}

module.exports = Object.assign(service, {
  recordUtterance,
  speak,
  stopSpeaking,
  startWakeListener,
  stopWakeListener,
  forceListenNow
});
