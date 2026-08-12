/**
 * Teste da interface Node <-> Python. Requer python3 com
 * vision/requirements.txt instalado e uma webcam disponivel.
 * Roda: node vision/test/test_vision_service.js
 */

const visionService = require('../interface/visionService');

async function main() {

  console.log('Testando VisionService.getStatus()...');
  const status = visionService.getStatus();

  if (status.status !== 'idle') {
    throw new Error(`status inicial deveria ser "idle", veio "${status.status}"`);
  }
  console.log('OK -', status);

  console.log('Testando VisionService.capture()...');
  const result = await visionService.capture();

  if (!result || !result.path) {
    throw new Error('capture() deveria retornar um objeto com "path"');
  }
  console.log('OK -', result);
}

main()
  .then(() => {
    console.log('OK - VisionService funcionando');
  })
  .catch((erro) => {
    console.error('FALHOU -', erro.message);
    process.exitCode = 1;
  });
