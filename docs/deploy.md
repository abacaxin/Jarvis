# Deploy — Raspberry Pi 3B (local)

**Atualização 2026-08-12:** o alvo real de deploy é um Raspberry Pi 3B local (quarto), não Railway. O Railway foi usado por um tempo como teste de deploy 24/7 e depois **removido** do painel — não está mais conectado a este repositório, não redeploya mais em `git push`. A seção abaixo fica só como histórico.

## Deploy real: Raspberry Pi 3B

Confirmado em 2026-08-12: SO já instalado é 64 bits (`aarch64`, Bookworm) — não precisou reinstalar. Câmera definida: webcam USB comum.

### Fase 1 — Pacotes de sistema

```bash
sudo apt update && sudo apt full-upgrade -y

sudo apt install -y git curl build-essential \
  libatlas-base-dev libjpeg-dev libopenjp2-7 libtiff6 \
  portaudio19-dev python3-venv python3-pip ffmpeg \
  bluez bluez-tools pulseaudio pulseaudio-module-bluetooth
```

`libatlas`/`libjpeg`/etc. são exigências do opencv/numpy em ARM. `portaudio19-dev` é exigência de captura de áudio (voz). O grupo `bluez`/`pulseaudio` é pro alto-falante Bluetooth (Fase 6).

### Fase 2 — Node.js

Pi OS de 64 bits = arquitetura ARM64, o instalador oficial da NodeSource cobre isso:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirma v20.x
```

### Fase 3 — Clonar o repo e instalar dependências Node

```bash
git clone https://github.com/abacaxin/Jarvis.git kevin
cd kevin
npm install
sudo npm install -g pm2
```

### Fase 4 — Ambiente Python (venv)

```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r vision/requirements.txt
pip install -r voice/requirements.txt
python vision/detection/download_model.py   # baixa o modelo de deteccao de mao, uma vez
deactivate
```

**Importante:** `vision/interface/visionService.js` chama o binário `python3` que estiver no `PATH` no momento — se o Kevin subir via PM2 (que normalmente não herda o venv ativado), ele pode achar o `python3` do sistema em vez do venv, sem `mediapipe` instalado. Pra evitar isso, configure `VISION_PYTHON_BIN` com o caminho absoluto do venv — já deixei comentado em `ecosystem.config.js`, só descomentar e ajustar o caminho (normalmente `/home/<usuario>/kevin/venv/bin/python3`).

### Fase 5 — Variáveis de ambiente

```bash
cp .env.example .env
nano .env   # preencher TOKEN e GROQ_API_KEY
```

### Fase 6 — Testar cada peça isolada (antes de juntar tudo)

**Webcam** (conecte a webcam USB antes):
```bash
ls /dev/video*                    # confirma que o Pi enxergou a camera
source venv/bin/activate
python vision/test/test_camera.py
python vision/test/test_hand_detection.py
deactivate
```
Ajuste `vision/config.json` → `camera.width`/`height` pra `320`/`240` antes de usar de verdade — a Pi 3B é fraca demais pro default de 640×480 (ver [decisoes.md](decisoes.md), seção 11 do vision/README.md).

**Bluetooth (caixa de som)**:
```bash
bluetoothctl
power on
agent on
scan on
# anote o MAC da caixa quando aparecer, ex: AA:BB:CC:DD:EE:FF
pair AA:BB:CC:DD:EE:FF
trust AA:BB:CC:DD:EE:FF
connect AA:BB:CC:DD:EE:FF
exit

pactl list sinks short             # confirma que o sink bluez_sink... apareceu
pactl set-default-sink <nome-do-sink-bluez>
```
Essa é a parte mais sujeita a exigir tentativa/erro num Pi headless — se `connect` falhar, geralmente é a caixa não estar em modo pareamento na hora do `scan on`.

**Microfone** (se for testar voz agora — USB ou o que estiver disponível, o wearable ainda não existe):
```bash
arecord -l                         # confirma que o Pi enxergou o microfone
```

### Fase 7 — ESP32 (feito no seu PC, não no Pi)

```bash
hostname -I   # roda no Pi, pega o IP local (ex: 192.168.0.42)
```
Recomendado fixar esse IP no roteador (reserva DHCP) — senão o ESP32 perde o hub toda vez que o IP mudar. Depois, na Arduino IDE, abra `hub/firmware/quarto_luz/quarto_luz.ino` e preencha `WIFI_SSID`, `WIFI_PASSWORD`, `HUB_HOST` (o IP acima), confira `RELAY_PIN`, e grave.

### Fase 8 — Subir os processos persistentes

`ecosystem.config.js` já tem duas apps: `kevin` (bot) e `hub` (WebSocket dos ESP32s):

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # segue a instrucao que ele imprime (comando com sudo pra rodar uma vez)
```
`pm2 startup` é o que garante que os dois processos voltem sozinhos se o Pi reiniciar (queda de energia, etc.) — sem isso, `pm2 save` sozinho não sobrevive a reboot.

`voice/wake_listener.py` (escuta contínua "Hey Jarvis") ainda não está integrado a essa lista de propósito — é prototípico, sem conexão com o Telegram ainda. Se quiser que fique sempre ativo no quarto, dá pra adicionar como uma terceira app no `ecosystem.config.js` com `interpreter: 'python3'` apontando pro venv, mas isso é um passo separado, depois de validar o resto.

### Fase 9 — Checklist final

- [ ] `pm2 status` mostra `kevin` e `hub` como `online`
- [ ] `/start` responde no Telegram
- [ ] `/foto` ativa a visão, reconhece gesto, tira foto e descreve
- [ ] `/luz on` / `/luz off` aciona o relé de verdade
- [ ] Áudio de teste toca na caixa Bluetooth (`paplay <algum .wav>` ou via `voice/speak_server.py`)

## Histórico: Railway (removido)

Foi usado brevemente como deploy 24/7 de teste antes da decisão de ir para o Pi. Ficam registrados aqui os detalhes técnicos, caso o Railway volte a ser cogitado no futuro (ex: como fallback caso o Pi fique fora do ar):

- Free tier, deploy direto do GitHub, zero config — `package.json` já tem `"start": "node index.js"`, Railway detecta Node via Nixpacks sozinho.
- Variáveis de ambiente (`TOKEN`, `GROQ_API_KEY`) via aba **Variables** no painel.
- PM2 não é necessário lá — a plataforma reinicia o processo sozinha em crash.
- **Cuidado se reativar**: se o bot local (PM2) ficar ativo ao mesmo tempo que uma instância no Railway, os dois brigam pelo `polling` do mesmo `TOKEN` do Telegram.
