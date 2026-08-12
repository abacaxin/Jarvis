# Hub WebSocket — protótipo experimental

Servidor central que os dispositivos ESP32 da casa (começando pela luz
do quarto) conectam. Roda como processo **separado** do bot do Kevin —
mesmo princípio já usado na visão (`vision/interface/visionService.js`
esconde o Python do brain; aqui `hub/interface/hubClient.js` esconde o
WebSocket/dispositivo do brain).

## 1. Por que este módulo existe

O Raspberry Pi que vai hospedar o Kevin também é o servidor central da
casa (ver [docs/visao-produto.md](../docs/visao-produto.md)) — não só
do Kevin. ESP32s (relé de luz, e futuramente outros sensores/atuadores)
conectam nele por WebSocket. O hub é essa camada: recebe registro de
dispositivo, roteia comando pro dispositivo certo, e devolve o
resultado pra quem pediu.

## 2. Como se encaixa no Kevin

```
Kevin Brain (index.js)
        │  comando explícito (/luz on, /luz off) — não decisão do LLM
        ▼
hubClient (hub/interface/hubClient.js)   ← Node, contrato estável, conexão lazy
        │  WebSocket
        ▼
hub/server.js                              ← processo próprio, roda no Pi (npm run hub:start)
        │  WebSocket
        ▼
ESP32 (hub/firmware/quarto_luz/quarto_luz.ino) ← relé, aciona a luz de verdade
```

`core/` e `services/` do Kevin não foram alterados. `index.js` só
importa `hubClient.sendCommand()` — não sabe que existe WebSocket, hub,
ou ESP32 por trás.

## 3. Por que comando explícito, não o LLM decidindo

`/luz on` e `/luz off` são comparação de string em `index.js`, igual o
`/foto` da visão — **não** um campo no `RESPONSE_SCHEMA` do brain. Duas
razões:

- Acender/apagar uma luz é uma ação com efeito físico real. Ainda não
  existe camada de permissão/confirmação pro Kevin decidir sozinho
  disparar isso por linguagem natural — mesmo princípio já registrado
  em [docs/visao-produto.md](../docs/visao-produto.md) pra git/agentes
  de código.
- Meter `device_action` no schema estrito da chamada única arriscaria a
  garantia de JSON bem formado que o resto da memória depende (mesma
  razão pela qual `/foto` também ficou de fora — ver seção 9 do
  [vision/README.md](../vision/README.md)).

## 4. Como testar sem hardware nenhum

```bash
npm run hub:test
```

Sobe o servidor numa porta de teste, conecta um WebSocket fake fazendo
o papel do ESP32 (`quarto_luz`), manda um comando via `hubClient` e
confere que o resultado volta certo — e que comando pra um dispositivo
que não existe rejeita com erro claro. Não depende de ESP32, WiFi ou
relé nenhum.

## 5. Como rodar de verdade

No Raspberry Pi (ou em qualquer máquina que vá ficar de pé recebendo
conexão dos ESP32s):

```bash
npm run hub:start
```

Sobe em `ws://<ip-da-maquina>:8765` (porta configurável em
`hub/config.json` ou `HUB_PORT`). O Kevin (`index.js`) conecta nele via
`HUB_URL` (default `ws://localhost:8765` — ajustar se o hub rodar numa
máquina diferente do bot, embora o plano seja os dois no mesmo Pi).

## 6. Como gravar o firmware do ESP32

1. Arduino IDE → Sketch → Include Library → Manage Libraries → instalar
   **WebSockets** (Links2004/arduinoWebSockets) e **ArduinoJson**
   (bblanchon/ArduinoJson).
2. Abrir `hub/firmware/quarto_luz/quarto_luz.ino`.
3. Preencher `WIFI_SSID`, `WIFI_PASSWORD`, `HUB_HOST` (IP do Pi na rede
   local) e conferir `RELAY_PIN` contra a fiação real.
4. Gravar no ESP32. O Serial Monitor (115200 baud) mostra o IP obtido e
   a confirmação de registro no hub.

Estado inicial do relé é sempre **desligado** ao ligar/resetar o ESP32
(`setRelay(false)` no `setup()`) — não confia em nenhum estado anterior
guardado.

## 7. Como adicionar um novo dispositivo

Não precisa mexer no `hub/server.js` — ele roteia por `device_id` sem
precisar conhecer os dispositivos de antemão. Pra adicionar um novo
(ex: luz da cozinha):

1. Copiar `hub/firmware/quarto_luz/` pra `hub/firmware/cozinha_luz/`,
   trocar `DEVICE_ID` e `RELAY_PIN`.
2. Adicionar em `hub/config.json` → `devices` (documentação, não é
   validado em runtime ainda).
3. No `index.js`, adicionar o comando explícito equivalente (`/luz
   cozinha on`/`off`, ou o padrão que fizer sentido conforme a
   quantidade de dispositivos crescer).

## 8. Limitações atuais

- **Sem autenticação** — qualquer coisa na rede local que saiba o IP e
  a porta do hub pode se conectar, registrar um `device_id` falso, ou
  mandar comando. Aceitável pra rede doméstica confiada, não pra expor
  a porta pra fora de casa.
- **Sem persistência de estado** — o hub não sabe se a luz está ligada
  ou desligada, só repassa comando/resultado. Se quiser um `/luz
  status`, isso precisa o ESP32 responder o estado atual (não
  implementado ainda).
- **Um dispositivo = uma conexão** — se dois processos tentarem
  registrar o mesmo `device_id`, o último que conectar sobrescreve o
  registro do primeiro no `Map`, sem aviso.
- **Firmware não testado em hardware real ainda** — escrito seguindo o
  padrão usual de `WebSocketsClient` + `ArduinoJson`, mas só o hub em
  si (servidor + cliente Node) foi validado ponta a ponta (`npm run
  hub:test`).
- **Reconexão do ESP32** — `setReconnectInterval(5000)` faz o cliente
  WebSocket tentar de novo a cada 5s se a conexão cair, mas não há
  lógica de re-registro além do que já acontece automaticamente no
  evento `WStype_CONNECTED`.

## Estrutura

```
hub/
├── config.json                    → porta do servidor, timeout, lista de dispositivos (documentação)
├── server.js                      → servidor WebSocket, roteia comando/resultado por device_id
├── interface/
│   └── hubClient.js               → contrato Node que o Kevin usa (esconde o WebSocket)
├── firmware/
│   └── quarto_luz/
│       └── quarto_luz.ino         → firmware ESP32 (relé da luz do quarto)
└── test/
    └── test_hub.js                → teste ponta a ponta com ESP32 simulado (`npm run hub:test`)
```
