/**
 * Interface entre o Kevin (Node) e o Vision System (Python).
 *
 * O cerebro do Kevin nao precisa saber que a visao roda em Python, nem
 * como a camera/deteccao/gestos funcionam por dentro — so chama estes
 * metodos e escuta os eventos `vision.*`.
 *
 * engine.py e um processo PERSISTENTE (mesmo padrao de
 * voice/voiceService.js — ver ensureSpeakProcess()/wake_listener):
 * sobe uma vez, na primeira chamada, e fica de pe recebendo comandos
 * JSON pelo stdin. Isso paga o import do mediapipe + carregamento do
 * modelo + abertura da camera (~segundos) UMA vez so, em vez de a cada
 * foto/ativacao — spawnar um processo novo por chamada era o motivo da
 * visao "demorar seculos" pra responder.
 *
 * Contrato:
 *   activate() / deactivate()                 → liga/desliga o loop de gestos
 *   startGestureRecognition(opts) / stop...()  → mesma coisa, nomes explicitos
 *   capture(opts)                              → Promise com {path, timestamp, resolution, type}
 *   getStatus()                                → { status, pid }
 *   on('vision.<evento>', payload => ...)      → EventEmitter padrao do Node
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const EventEmitter = require('events');
const logger = require('../../services/logger');

const PYTHON_BIN = process.env.VISION_PYTHON_BIN || 'python3';
const VISION_DIR = path.join(__dirname, '..');
const ENGINE_PATH = path.join(VISION_DIR, 'engine.py');

const service = new EventEmitter();

let engineProcess = null;
let status = 'idle'; // idle | active | error — status da SESSAO de gestos, nao do processo
let pendingCapture = null; // { resolve, reject } — no maximo uma captura em voo por vez

function ensureEngineProcess() {

  if (engineProcess) return engineProcess;

  const proc = spawn(PYTHON_BIN, [ENGINE_PATH], {
    cwd: VISION_DIR,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {

    let event;

    try {

      event = JSON.parse(line);

    } catch (erro) {

      logger.warn('Linha nao-JSON da vision engine, ignorando', line);
      return;
    }

    if (event.type === 'vision.activated' && event.payload.mode === 'gestures') {
      status = 'active';
    }

    if (event.type === 'vision.deactivated') {
      status = 'idle';
    }

    if (event.type === 'vision.capture.completed' && pendingCapture) {

      pendingCapture.resolve(event.payload);
      pendingCapture = null;
    }

    if (event.type === 'vision.error' && pendingCapture) {

      pendingCapture.reject(new Error(event.payload.message));
      pendingCapture = null;
    }

    // Feedback textual do que o engine esta vendo, pra debugar gesto sem
    // precisar da janela --show (que exige ambiente grafico, nao existe
    // num Pi headless). Acompanhar com `pm2 logs kevin`.
    if (event.type === 'vision.hand.detected') {
      logger.info('[vision] mão detectada');
    }

    if (event.type === 'vision.hand.lost') {
      logger.info('[vision] mão perdida');
    }

    if (event.type === 'vision.gesture.recognized') {
      logger.info(`[vision] gesto reconhecido: ${event.payload.gesture}`);
    }

    if (event.type === 'vision.protocol.triggered') {
      logger.info(`[vision] protocolo disparado: ${event.payload.protocol}`);
    }

    service.emit(event.type, event.payload);
  });

  // se o spawn falhar de verdade (ex: python3 nao esta no PATH), o
  // ChildProcess emite 'error' em vez de 'exit' — sem esse handler isso
  // sobe como excecao nao tratada e derruba o bot inteiro (index.js tem
  // process.on('uncaughtException') que mata o processo).
  proc.on('error', (erro) => {
    logger.error('[vision-engine] Falha ao iniciar processo Python', erro.message);
    service.emit('vision.error', { message: `Falha ao iniciar o processo Python: ${erro.message}` });
  });

  // mediapipe/TFLite escrevem log de inicializacao (nao-erro) em stderr
  // tambem — tratar como warn, nao error. Erro de verdade do engine vai
  // pelo evento "vision.error" (canal proprio, ver events.py).
  proc.stderr.on('data', (data) => {
    logger.warn('[vision-engine]', data.toString().trim());
  });

  proc.on('exit', (code) => {

    logger.warn(`[vision-engine] processo encerrou (codigo ${code})`);
    engineProcess = null;
    status = code === 0 ? 'idle' : 'error';
    service.emit('vision.process.exit', { code });
  });

  engineProcess = proc;
  return proc;
}

function startGestureRecognition({ show = false } = {}) {

  if (status !== 'idle') return getStatus();

  const proc = ensureEngineProcess();
  status = 'active';

  proc.stdin.write(JSON.stringify({ cmd: 'start_gestures', show }) + '\n');

  return getStatus();
}

function stopGestureRecognition() {

  if (status === 'idle' || !engineProcess) return getStatus();

  engineProcess.stdin.write(JSON.stringify({ cmd: 'stop_gestures' }) + '\n');
  status = 'idle';

  return getStatus();
}

function capture({ show = false } = {}) {

  if (status === 'active') {
    return Promise.reject(new Error('Visao ja esta em modo gestos — pare com stopGestureRecognition() antes de capturar direto'));
  }

  if (pendingCapture) {
    return Promise.reject(new Error('Ja existe uma captura em andamento'));
  }

  return new Promise((resolve, reject) => {

    const proc = ensureEngineProcess();
    pendingCapture = { resolve, reject };

    proc.stdin.write(JSON.stringify({ cmd: 'capture', show }) + '\n');
  });
}

function getStatus() {

  return {
    status,
    pid: engineProcess ? engineProcess.pid : null
  };
}

// sobe o processo (import do mediapipe + carregamento do modelo, ~28s
// medido nesta maquina) sem abrir a camera nem esperar comando nenhum —
// so pra pagar esse custo durante o boot do Kevin, escondido, em vez de
// no primeiro /foto ou "ativa a visao" de um usuario de verdade.
function prewarm() {
  ensureEngineProcess();
}

// activate/deactivate = alias mais curto do mesmo contrato, pro
// cerebro chamar sem precisar saber que "ativar a visao" hoje
// significa "comecar a escutar gestos".
module.exports = Object.assign(service, {
  activate: startGestureRecognition,
  deactivate: stopGestureRecognition,
  capture,
  startGestureRecognition,
  stopGestureRecognition,
  getStatus,
  prewarm
});
