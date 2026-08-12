/**
 * Simula o cerebro do Kevin pedindo `activate vision`.
 *
 * O LLM nao esta ligado nisso ainda — quem chama o VisionService aqui e
 * este script, no lugar do assistantBrain.js. No futuro, a mesma
 * chamada (`visionService.startGestureRecognition()` /
 * `visionService.capture()`) sai de dentro do cerebro real, quando ele
 * decidir que precisa "ver" alguma coisa.
 *
 * Roda: npm run vision:test
 */

const visionService = require('./visionService');

console.log('[KEVIN] Comando simulado recebido: activate vision');

visionService.on('vision.activated', () => {
  console.log('[VISION] Sistema de visao ativado');
});

visionService.on('vision.camera.ready', (info) => {
  console.log('[CAMERA] Camera pronta', info);
});

visionService.on('vision.hand.detected', () => {
  console.log('[HAND] Mao detectada');
});

visionService.on('vision.hand.lost', () => {
  console.log('[HAND] Mao perdida de vista');
});

visionService.on('vision.gesture.recognized', ({ gesture }) => {
  console.log(`[GESTURE] Gesto reconhecido: ${gesture}`);
});

visionService.on('vision.protocol.triggered', ({ protocol }) => {
  console.log(`[PROTOCOL] ${protocol}`);
});

visionService.on('vision.action.pending', ({ protocol, delay_seconds }) => {
  console.log(`[ACTION] Tira a mao de cena — capturando em ${delay_seconds}s...`);
});

visionService.on('vision.capture.completed', (result) => {

  console.log('[ACTION] Captura concluida:', result);
  console.log('[KEVIN] Ciclo completo. Visao continua ativa — pode gesticular de novo.');

  // nao para mais aqui — a sessao fica ativa esperando o proximo gesto,
  // igual o /foto real no Telegram (index.js). So sai por Ctrl+C, "q"/ESC
  // na janela, ou se o engine morrer sozinho (vision.process.exit abaixo).
});

visionService.on('vision.error', ({ message }) => {
  console.error('[VISION][ERRO]', message);
});

visionService.on('vision.process.exit', ({ code }) => {

  if (code !== 0) {

    console.error(`[VISION] Processo encerrou com codigo ${code}`);
    process.exit(1);
  }
});

process.on('SIGINT', () => {

  console.log('\n[KEVIN] Encerrando teste (Ctrl+C)');
  visionService.stopGestureRecognition();
  process.exit(0);
});

visionService.startGestureRecognition({ show: true });

console.log('[HINT] Feche a mao (closed fist) na frente da webcam para disparar PROTOCOL_CAPTURE — pode repetir quantas vezes quiser.');
console.log('[HINT] Pressione Ctrl+C, ou "q"/ESC na janela de video, para sair.');
