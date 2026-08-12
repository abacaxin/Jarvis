/**
 * Interface entre o Kevin (index.js) e o Hub WebSocket (hub/server.js).
 *
 * O cerebro do Kevin nao precisa saber que existe um WebSocket, nem como
 * o hub roteia mensagem pra cada ESP32 — so chama sendCommand() e recebe
 * uma Promise. Mesmo principio de vision/interface/visionService.js.
 *
 * Conexao e preguicosa (lazy): nao conecta no require(), so no primeiro
 * sendCommand() — se o hub nao estiver rodando (ex: testando o bot sem
 * hardware nenhum ligado), o Kevin sobe normal e so falha quando alguem
 * de fato pedir uma acao de dispositivo.
 */

const WebSocket = require('ws');
const logger = require('../../services/logger');

const HUB_URL = process.env.HUB_URL || 'ws://localhost:8765';
const DEFAULT_TIMEOUT_MS = 5000;

let ws = null;
let connecting = null;

const pending = new Map(); // request_id -> { resolve, reject, timeout }

function ensureConnection() {

  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);

  if (connecting) return connecting;

  connecting = new Promise((resolve, reject) => {

    const socket = new WebSocket(HUB_URL);
    let settled = false;

    socket.on('open', () => {

      settled = true;
      ws = socket;
      connecting = null;

      resolve(socket);
    });

    socket.on('message', (raw) => {

      let msg;

      try {

        msg = JSON.parse(raw);

      } catch (erro) {

        logger.warn('[hub-client] mensagem nao-JSON recebida, ignorando');
        return;
      }

      if (msg.type === 'result' && pending.has(msg.request_id)) {

        const { resolve: resolveCmd, timeout } = pending.get(msg.request_id);

        clearTimeout(timeout);
        pending.delete(msg.request_id);

        resolveCmd(msg);
      }
    });

    socket.on('error', (erro) => {

      logger.warn('[hub-client] erro na conexao com o hub', erro.message);

      if (!settled) {

        settled = true;
        connecting = null;

        reject(erro);
      }
    });

    socket.on('close', () => {

      if (ws === socket) ws = null;
    });
  });

  return connecting;
}

async function sendCommand(deviceId, action, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {

  const socket = await ensureConnection();

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve, reject) => {

    const timeout = setTimeout(() => {

      pending.delete(requestId);
      reject(new Error(`Sem resposta do dispositivo "${deviceId}" (timeout)`));

    }, timeoutMs);

    pending.set(requestId, { resolve, reject, timeout });

    socket.send(JSON.stringify({
      type: 'command',
      device_id: deviceId,
      action,
      request_id: requestId
    }));

  }).then((result) => {

    if (result.status === 'error') {

      throw new Error(result.error || `Dispositivo "${deviceId}" retornou erro`);
    }

    return result;
  });
}

module.exports = { sendCommand };
