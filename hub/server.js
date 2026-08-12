/**
 * Hub WebSocket — servidor central do Raspberry Pi que os ESP32s da casa
 * conectam. Roda como processo PRÓPRIO, separado do bot do Kevin
 * (`npm run hub:start`) — mesmo princípio já usado na visão
 * (vision/interface/visionService.js esconde o Python do brain; aqui o
 * hub esconde o WebSocket/dispositivo do brain).
 *
 * Protocolo (JSON por linha, uma mensagem por frame WebSocket):
 *
 *   Dispositivo -> hub, ao conectar:
 *     { "type": "register", "device_id": "quarto_luz" }
 *
 *   Controlador (Kevin) -> hub, pra mandar um comando:
 *     { "type": "command", "device_id": "quarto_luz", "action": "on", "request_id": "..." }
 *
 *   Hub -> dispositivo, repassando o comando:
 *     { "type": "command", "action": "on", "request_id": "..." }
 *
 *   Dispositivo -> hub, apos executar:
 *     { "type": "result", "request_id": "...", "status": "ok" | "error", "error": "..." }
 *
 *   Hub -> controlador, repassando o resultado (mesmo payload do dispositivo).
 *
 * Qualquer conexao pode registrar um device_id (vira "dispositivo") ou
 * mandar "command" (vira "controlador") — nao ha distincao de papel no
 * handshake, so no que a conexao decide fazer.
 */

const WebSocket = require('ws');
const logger = require('../services/logger');
const config = require('./config.json');

const PORT = process.env.HUB_PORT || config.port;

const devices = new Map();          // device_id -> ws
const pendingByRequestId = new Map(); // request_id -> ws do controlador que pediu

const wss = new WebSocket.Server({ port: PORT });

function safeSend(ws, obj) {

  if (ws.readyState === WebSocket.OPEN) {

    ws.send(JSON.stringify(obj));
  }
}

wss.on('connection', (ws) => {

  ws.on('message', (raw) => {

    let msg;

    try {

      msg = JSON.parse(raw);

    } catch (erro) {

      logger.warn('[hub] mensagem nao-JSON recebida, ignorando');
      return;
    }

    if (msg.type === 'register') {

      ws._deviceId = msg.device_id;
      devices.set(msg.device_id, ws);

      logger.info(`[hub] dispositivo registrado: ${msg.device_id}`);
      return;
    }

    if (msg.type === 'command') {

      const target = devices.get(msg.device_id);

      if (!target || target.readyState !== WebSocket.OPEN) {

        safeSend(ws, {
          type: 'result',
          request_id: msg.request_id,
          status: 'error',
          error: `Dispositivo "${msg.device_id}" nao esta conectado`
        });

        return;
      }

      pendingByRequestId.set(msg.request_id, ws);

      safeSend(target, {
        type: 'command',
        action: msg.action,
        request_id: msg.request_id
      });

      return;
    }

    if (msg.type === 'result') {

      const controller = pendingByRequestId.get(msg.request_id);

      if (controller) safeSend(controller, msg);

      pendingByRequestId.delete(msg.request_id);
      return;
    }

    logger.warn(`[hub] tipo de mensagem desconhecido: ${msg.type}`);
  });

  ws.on('close', () => {

    if (ws._deviceId && devices.get(ws._deviceId) === ws) {

      devices.delete(ws._deviceId);
      logger.info(`[hub] dispositivo desconectado: ${ws._deviceId}`);
    }
  });

  ws.on('error', (erro) => {

    logger.warn('[hub] erro numa conexao', erro.message);
  });
});

logger.info(`[hub] servidor WebSocket ouvindo na porta ${PORT}`);

module.exports = wss;
