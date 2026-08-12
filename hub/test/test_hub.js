/**
 * Testa o protocolo do hub ponta a ponta sem nenhum ESP32 real: sobe o
 * servidor, conecta um WebSocket fake fazendo o papel do dispositivo
 * ("quarto_luz"), manda um comando via hubClient, e confere que o
 * resultado volta certo. Roda com `npm run hub:test`.
 */

process.env.HUB_PORT = 8799;
process.env.HUB_URL = 'ws://localhost:8799';

const WebSocket = require('ws');

require('../server');
const { sendCommand } = require('../interface/hubClient');

function esperar(ms) {

  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {

  // simula o firmware do ESP32: conecta, registra, responde "on"/"off" com ok
  const fakeDevice = new WebSocket(process.env.HUB_URL);

  await new Promise((resolve) => fakeDevice.on('open', resolve));

  fakeDevice.send(JSON.stringify({ type: 'register', device_id: 'quarto_luz' }));

  fakeDevice.on('message', (raw) => {

    const msg = JSON.parse(raw);

    if (msg.type === 'command') {

      fakeDevice.send(JSON.stringify({
        type: 'result',
        request_id: msg.request_id,
        status: 'ok'
      }));
    }
  });

  await esperar(200); // da tempo do register chegar no servidor

  console.log('--- comando pra dispositivo existente ---');
  const resultadoOn = await sendCommand('quarto_luz', 'on');
  console.log('OK:', resultadoOn);

  console.log('--- comando pra dispositivo que nao existe ---');

  try {

    await sendCommand('cozinha_luz', 'on');
    console.log('FALHOU: deveria ter rejeitado');
    process.exitCode = 1;

  } catch (erro) {

    console.log('OK, rejeitou como esperado:', erro.message);
  }

  fakeDevice.close();
  process.exit(process.exitCode || 0);
}

main().catch((erro) => {

  console.error('Teste falhou:', erro);
  process.exit(1);
});
