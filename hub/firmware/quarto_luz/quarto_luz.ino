/**
 * Firmware do ESP32 + rele — luz do quarto.
 *
 * Conecta no WiFi, conecta no hub (hub/server.js) via WebSocket, se
 * registra como "quarto_luz", e fica esperando comandos { action: "on" |
 * "off" }. Aciona o pino do rele e responde com o resultado.
 *
 * Bibliotecas necessarias (Arduino IDE > Sketch > Include Library >
 * Manage Libraries):
 *   - WebSockets (Links2004/arduinoWebSockets)
 *   - ArduinoJson (bblanchon/ArduinoJson)
 *
 * Preencher antes de gravar: WIFI_SSID, WIFI_PASSWORD, HUB_HOST (IP do
 * Raspberry Pi na rede local) e RELAY_PIN (conforme a fiacao real).
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "SUA_REDE_AQUI";
const char* WIFI_PASSWORD = "SUA_SENHA_AQUI";

const char* HUB_HOST = "192.168.0.X"; // IP do Raspberry Pi
const uint16_t HUB_PORT = 8765;

const char* DEVICE_ID = "quarto_luz";
const int RELAY_PIN = 26; // ajustar conforme a fiacao

WebSocketsClient webSocket;

void setRelay(bool ligar) {

  digitalWrite(RELAY_PIN, ligar ? HIGH : LOW);
}

void sendResult(const char* requestId, bool ok, const char* errorMsg = nullptr) {

  StaticJsonDocument<256> doc;

  doc["type"] = "result";
  doc["request_id"] = requestId;
  doc["status"] = ok ? "ok" : "error";

  if (errorMsg) doc["error"] = errorMsg;

  String out;
  serializeJson(doc, out);

  webSocket.sendTXT(out);
}

void handleCommand(JsonDocument& doc) {

  const char* action = doc["action"];
  const char* requestId = doc["request_id"];

  if (strcmp(action, "on") == 0) {

    setRelay(true);
    sendResult(requestId, true);

  } else if (strcmp(action, "off") == 0) {

    setRelay(false);
    sendResult(requestId, true);

  } else {

    sendResult(requestId, false, "acao desconhecida");
  }
}

void registerDevice() {

  StaticJsonDocument<128> doc;

  doc["type"] = "register";
  doc["device_id"] = DEVICE_ID;

  String out;
  serializeJson(doc, out);

  webSocket.sendTXT(out);
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {

  switch (type) {

    case WStype_CONNECTED:

      Serial.println("[hub] conectado, registrando dispositivo...");
      registerDevice();
      break;

    case WStype_DISCONNECTED:

      Serial.println("[hub] desconectado, tentando reconectar...");
      break;

    case WStype_TEXT: {

      StaticJsonDocument<256> doc;
      DeserializationError erro = deserializeJson(doc, payload, length);

      if (erro) {

        Serial.println("[hub] JSON invalido recebido, ignorando");
        return;
      }

      const char* msgType = doc["type"];

      if (msgType && strcmp(msgType, "command") == 0) {

        handleCommand(doc);
      }

      break;
    }

    default:
      break;
  }
}

void setup() {

  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false); // estado inicial seguro: luz desligada

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Conectando ao WiFi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("WiFi conectado, IP: ");
  Serial.println(WiFi.localIP());

  webSocket.begin(HUB_HOST, HUB_PORT, "/");
  webSocket.onEvent(onWsEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {

  webSocket.loop();
}
