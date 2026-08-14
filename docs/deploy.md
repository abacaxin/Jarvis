# Deploy — Raspberry Pi 3B (local)

**Atualização 2026-08-12:** o alvo real de deploy é um Raspberry Pi 3B local (quarto), não Railway. O Railway foi usado por um tempo como teste de deploy 24/7 e depois **removido** do painel — não está mais conectado a este repositório, não redeploya mais em `git push`. A seção abaixo fica só como histórico.

## Deploy real: Raspberry Pi 3B

Confirmado em 2026-08-12: SO já instalado é 64 bits (`aarch64`) — não precisou reinstalar. Câmera definida: webcam USB comum. Python do sistema é **3.13.5** — codename do SO provavelmente **Debian 13 (Trixie)**: Python 3.13 de sistema já sugeria isso, e bateu de novo quando `libatlas-base-dev` (Fase 1) não foi encontrado — esse pacote foi removido especificamente no Trixie. Ainda não confirmado via `cat /etc/os-release | grep VERSION_CODENAME` de forma definitiva, mas as duas evidências independentes convergem pro mesmo SO.

> **Fase 4 (venv Python) passou por três bloqueios de dependência — dois resolvidos, um corrigido mas AINDA NÃO testado no Pi:**
> 1. ~~`mediapipe` sem wheel pra Python 3.13~~ — primeira tentativa foi soltar o cap de versão pra pegar a `1.0.0` (única com wheel pra 3.13), mas essa versão **crasha ao rodar** no Cortex-A53 do Pi 3B: `FATAL ERROR: This binary was compiled with aes enabled, but this feature is not available on this processor`. O build da 1.0.0 passou a exigir a extensão de criptografia ARMv8 (AES) — o Cortex-A53 não tem, e isso é compilado no binário, não dá pra contornar com env var. **Fix de verdade**: o venv da visão usa Python 3.11 (via `pyenv`, Fase 4 abaixo) em vez do 3.13 do sistema, voltando pro `mediapipe` 0.10.x (que não tem esse requisito e já roda em Pi 3B segundo relatos de terceiros).
> 2. **Resolvido**: `openwakeword` exige `tflite-runtime` no Linux, que também não tem wheel pra Python 3.13/3.11 recente — só que esse a gente nem usa de verdade (sempre roda em modo ONNX, nunca importa tflite_runtime — confirmado lendo o source). Corrigido instalando `openwakeword` com `--no-deps` (ver comando abaixo e comentário em `voice/requirements.txt`).
>
> Ver [progresso.md](progresso.md) → "Em andamento" pro diagnóstico completo. **Item 1 (Python 3.11 + mediapipe 0.10.x) ainda não confirmado rodando no Pi de verdade.**

### Fase 1 — Pacotes de sistema

```bash
sudo apt update && sudo apt full-upgrade -y

sudo apt install -y git curl build-essential \
  libopenblas-dev libjpeg-dev libopenjp2-7 libtiff6 \
  portaudio19-dev python3-venv python3-pip ffmpeg \
  bluez bluez-tools pulseaudio pulseaudio-module-bluetooth
```

`libopenblas-dev`/`libjpeg`/etc. são exigências do opencv/numpy em ARM — era `libatlas-base-dev`, mas esse pacote foi **removido no Debian 13 (Trixie)** (segunda evidência de que é esse o SO, ver nota no topo desta página). `libopenblas-dev` é o substituto recomendado. `portaudio19-dev` é exigência de captura de áudio (voz). O grupo `bluez`/`pulseaudio` é pro alto-falante Bluetooth (Fase 6).

### Fase 2 — Node.js

Pi OS de 64 bits = arquitetura ARM64, o instalador oficial da NodeSource cobre isso. Usa a 22.x (LTS atual), não a 20.x — a 20 saiu de LTS em abril/2026 e já está sem patch de segurança; o Pi vai rodar um servidor WebSocket (`hub/server.js`) exposto pra dispositivos ESP32 na rede, não faz sentido isso rodar em runtime sem manutenção. Confirmado: NodeSource tem pacote pra Debian 13/Trixie na 22.x (instalação real reportada, `node -v` → v22.22.x).

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # confirma v22.x
```

### Fase 3 — Clonar o repo e instalar dependências Node

```bash
git clone https://github.com/abacaxin/Jarvis.git kevin
cd kevin
npm install
sudo npm install -g pm2
```

### Fase 4 — Ambiente Python (venv)

O Python 3.13 do sistema não roda `mediapipe` neste Pi de forma alguma (ver blockquote acima) — o venv usa Python 3.11 via [`pyenv`](https://github.com/pyenv/pyenv) em vez do `python3` do sistema. `deadsnakes` (PPA mais comum pra isso) foi descartado por só cobrir Ubuntu — Raspberry Pi OS é Debian.

```bash
sudo apt install -y build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev

curl https://pyenv.run | bash
export PATH="$HOME/.pyenv/bin:$PATH"
eval "$(pyenv init -)"

# compila o Python do zero — num Pi 3B isso é lento (CPU fraca), espera
# de 20 a 60 minutos na primeira vez, sem jeito de acelerar
pyenv install 3.11
```

```bash
~/.pyenv/versions/3.11*/bin/python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r vision/requirements.txt

# openwakeword com --no-deps: ele declara tflite-runtime como dependencia
# obrigatoria no Linux, mas esse pacote nao tem wheel pra Python 3.13 (e
# nosso codigo nunca usa esse caminho mesmo — ver comentario em
# voice/requirements.txt). Sem --no-deps, esse passo falha com "Could not
# find a version that satisfies the requirement tflite-runtime".
pip install --no-deps "openwakeword>=0.6,<1"
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

## Troubleshooting: `ENOENT` no `VISION_PYTHON_BIN` / venv nunca foi criado

Sintoma no `pm2 logs kevin`: `[vision-engine] Falha ao iniciar processo Python spawn /home/.../kevin/venv/bin/python3 ENOENT`. Significa que o caminho configurado em `VISION_PYTHON_BIN` (`ecosystem.config.js`) não existe — o venv da Fase 4 nunca chegou a ser criado (aconteceu em 2026-08-13: a causa raiz do `mediapipe` tinha sido diagnosticada, mas os comandos da Fase 4 nunca foram executados de fato no Pi).

**1. Checa se `pyenv` + Python 3.11 já existem**, pra não recompilar à toa:

```bash
pyenv --version
pyenv versions
```

Se aparecer `pyenv` instalado e uma versão `3.11.x` na lista, pula pro passo 3. Senão, passo 2.

**2. Instala `pyenv` + Python 3.11** (só se o passo 1 não achou nada):

```bash
sudo apt install -y build-essential libssl-dev zlib1g-dev libbz2-dev libreadline-dev libsqlite3-dev libffi-dev liblzma-dev

curl https://pyenv.run | bash
export PATH="$HOME/.pyenv/bin:$PATH"
eval "$(pyenv init -)"

pyenv install 3.11
```

Compila o Python do zero — **20 a 60 minutos numa Pi 3B**, sem como acelerar. Pode deixar rodando em segundo plano.

**3. Cria o venv e instala as dependências** (Fase 4 completa):

```bash
cd ~/kevin
~/.pyenv/versions/3.11*/bin/python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r vision/requirements.txt
pip install --no-deps "openwakeword>=0.6,<1"
pip install -r voice/requirements.txt
python vision/detection/download_model.py
deactivate
```

**4. Reinicia o Kevin pra ele pegar o venv:**

```bash
pm2 delete kevin
pm2 start ecosystem.config.js
```

Confirma com `ls -la ~/kevin/venv/bin/python3` que o arquivo existe antes do passo 4, se quiser ter certeza antes de reiniciar.

### Fase 10 — Music Assistant no Docker do Pi (abandonado — ver Fase 11)

**Atualização 2026-08-14: essa fase foi abandonada.** Depois do problema de espaço (abaixo) resolvido via USB, o `docker run` ainda deu camada de imagem corrompida numa tentativa e, na seguinte, o Docker Desktop/engine ficou travado (`_ping` 500 error) mesmo após reinstalar — decidido rodar o Music Assistant **no PC** em vez do Pi, pra não continuar perdendo tempo em infra que não é específica do Pi. Fica registrado abaixo só como histórico/aprendizado (o problema de containerd com root separado é uma lição válida pra qualquer container pesado que ainda venha a rodar no Pi no futuro). **O Pi continua tendo um papel na música — como player (Squeezelite), não como servidor — ver Fase 11.**

Backend de música pro Kevin (ver [decisoes.md](decisoes.md) pra arquitetura completa — sidecar Python usando `music-assistant-client`, ainda não implementado do lado do Kevin, isso aqui é só a infra de base). Estado em 2026-08-13: cartão SD do Pi é pequeno (14GB) e ficou sem espaço na primeira tentativa — documentado abaixo o caminho real, com o desvio pra armazenamento USB.

**10.1 — Instalar Docker**

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Depois do `usermod`, sai e entra de novo no SSH (ou `newgrp docker`) — sem isso todo comando docker pede `sudo`.

```bash
docker --version
```

**10.2 — Espaço em disco: provavelmente vai faltar**

Cartão SD pequeno (visto em produção: 14GB) não sobra espaço suficiente pra imagem do Music Assistant + a biblioteca dele, que só cresce. Sintoma: `docker run` falha com `failed to extract layer` (o download passa, a extração — que precisa de bem mais espaço temporário — não). Antes de tentar rodar o Music Assistant, limpa o que dá:

```bash
sudo apt clean
sudo apt autoremove -y
docker system prune -af
sudo journalctl --vacuum-size=50M
df -h /
```

Se sobrar menos de uns 3-4GB livre mesmo depois da limpeza, não adianta insistir — precisa de armazenamento externo (próximo passo). Visto em produção: 1GB livre num cartão de 14GB mesmo depois da limpeza — foi necessário mover o Docker pra um pendrive/HD USB.

**10.3 — Mover o Docker pra armazenamento USB** (só se a Fase 10.2 confirmou que falta espaço)

Pluga o pendrive/HD e identifica ele — na Raspberry Pi o cartão SD é `mmcblk0`, dispositivos USB aparecem como `sda`, `sdb` etc.:

```bash
lsblk
```

**Confirma o nome certo antes de continuar** — o próximo passo é destrutivo (apaga tudo no dispositivo). Se tiver dúvida, para aqui e confirma o nome antes de formatar.

Se a partição aparecer já montada (erro `mkfs` reclamando disso), desmonta primeiro:

```bash
sudo umount /dev/sda1
```

Formata (ajusta `/dev/sda1` pro nome real — se o pendrive não tiver partição nenhuma ainda, pode ser `/dev/sda` direto, sem o `1`):

```bash
sudo mkfs.ext4 /dev/sda1
```

Monta e deixa persistente entre reboots:

```bash
sudo mkdir -p /mnt/usbstorage
sudo mount /dev/sda1 /mnt/usbstorage
sudo blkid /dev/sda1
```

Pega o `UUID=...` que o `blkid` mostrou e adiciona no `/etc/fstab`:

```bash
echo "UUID=<uuid-aqui>  /mnt/usbstorage  ext4  defaults  0  2" | sudo tee -a /etc/fstab
```

**Não basta só configurar o `data-root` do Docker.** No Debian/Raspberry Pi OS, o pacote `containerd.io` roda como serviço **separado**, com o próprio diretório padrão (`/var/lib/containerd`) — o `data-root` do `daemon.json` só move a parte do Docker, o containerd continua escrevendo no cartão SD por baixo. Sintoma visto em produção: `docker run` continuava dando `no space left on device` mesmo depois do `data-root` configurado, porque o erro apontava pra `/var/lib/containerd/...`, não pra `/var/lib/docker/...`.

**Fix robusto** (move as duas pastas de verdade pro pendrive, deixa link simbólico no lugar original — funciona independente de qual serviço grava onde):

```bash
sudo systemctl stop docker
sudo systemctl stop containerd

sudo mkdir -p /mnt/usbstorage/docker /mnt/usbstorage/containerd

sudo rsync -aP /var/lib/docker/ /mnt/usbstorage/docker/
sudo rsync -aP /var/lib/containerd/ /mnt/usbstorage/containerd/

sudo rm -rf /var/lib/docker /var/lib/containerd
sudo ln -s /mnt/usbstorage/docker /var/lib/docker
sudo ln -s /mnt/usbstorage/containerd /var/lib/containerd

sudo systemctl start containerd
sudo systemctl start docker
```

Se tinha configurado `/etc/docker/daemon.json` com `data-root` numa tentativa anterior, remove esse arquivo (ou volta pro padrão) — o link simbólico já resolve tudo, não precisa dos dois mecanismos ao mesmo tempo:

```bash
sudo rm -f /etc/docker/daemon.json
sudo systemctl restart docker
```

Confirma que pegou:

```bash
docker info | grep "Docker Root Dir"
ls -la /var/lib/docker /var/lib/containerd
df -h /mnt/usbstorage
```

`Docker Root Dir` mostra `/var/lib/docker` mesmo (é o link), mas o `ls -la` tem que mostrar que ambos são links apontando pro `/mnt/usbstorage/...`.

**10.4 — Subir o Music Assistant**

```bash
docker run -d --name music-assistant --network=host --restart=unless-stopped -v music-assistant-data:/data ghcr.io/music-assistant/server
```

Numa linha só, de propósito — `\` de continuação de linha quebrou numa tentativa anterior (bash executou cada linha como comando separado). Se tiver sobrado um container de tentativa anterior:

```bash
docker rm -f music-assistant
```

Acompanha o download/start:

```bash
docker ps
docker logs -f music-assistant
```

**10.5 — Configuração inicial**

1. Abre `http://<ip-do-pi>:8095` no navegador
2. Configura as fontes de música (Spotify, biblioteca local, etc.)
3. **Settings → Profile** → gera o token de longa duração (10 anos) — vai pro `.env` do Kevin quando a integração for implementada

*(Passo 4 antigo, "instalar Squeezelite no PC", estava errado — o player é o Pi. Ver Fase 11.)*

### Fase 11 — Music Assistant no PC + Squeezelite no Pi (caminho atual)

**Servidor (PC, Windows):**

1. Instala o **Docker Desktop** ([docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)) — configura o WSL2 sozinho
2. **Settings → Resources → Network** → ativa host networking (suportado desde Docker Desktop 4.34)
3. Sobe o Music Assistant:
   ```bash
   docker run -d --name music-assistant --network=host --restart=unless-stopped -v music-assistant-data:/data ghcr.io/music-assistant/server
   ```
4. Acessa `http://localhost:8095`, configura as fontes de música
5. **Se for usar Spotify**: o fluxo padrão de autenticação pode redirecionar pro IP interno da VM do Docker Desktop (`192.168.65.x`) em vez de `localhost`, e o popup não completa. Fix: **Settings → Core** → campo **Base URL** → define `http://localhost:8095`, salva, tenta autenticar de novo.
6. **Settings → Profile** → gera o token de longa duração — vai pro `.env` do Kevin quando a integração for implementada
7. Anota o **IP do PC na rede local** (`ipconfig` no Windows) — o Pi vai precisar dele no próximo bloco

**Player (Pi, conectado na caixa de som — pré-requisito: Fase 6 já feita, Bluetooth pareado e definido como sink padrão do PulseAudio):**

```bash
sudo apt install -y squeezelite
```

Testa qual saída de áudio o Squeezelite enxerga:

```bash
squeezelite -l
```

Se o PulseAudio já está com a caixa Bluetooth como sink padrão (Fase 6), `-o default` deve rotear pra lá — senão, usa o nome exato que apareceu na lista acima. Roda apontando pro Music Assistant do PC (usa o IP anotado no passo 7 acima):

```bash
squeezelite -n "Quarto" -o default -s <ip-do-pc>
```

Se conectar certo, o player **"Quarto"** deve aparecer sozinho na lista de players do Music Assistant (`http://<ip-do-pc>:8095`) — testa tocando alguma coisa por lá antes de partir pro código do Kevin.

Pra deixar persistente (sobreviver a reboot do Pi), adiciona como uma terceira app no `ecosystem.config.js` com `interpreter` apontando pro binário do squeezelite, ou configura como serviço systemd — **ainda não decidido/implementado**, ver [decisoes.md](decisoes.md) e [progresso.md](progresso.md) pro estado atual antes de continuar.

## Histórico: Railway (removido)

Foi usado brevemente como deploy 24/7 de teste antes da decisão de ir para o Pi. Ficam registrados aqui os detalhes técnicos, caso o Railway volte a ser cogitado no futuro (ex: como fallback caso o Pi fique fora do ar):

- Free tier, deploy direto do GitHub, zero config — `package.json` já tem `"start": "node index.js"`, Railway detecta Node via Nixpacks sozinho.
- Variáveis de ambiente (`TOKEN`, `GROQ_API_KEY`) via aba **Variables** no painel.
- PM2 não é necessário lá — a plataforma reinicia o processo sozinha em crash.
- **Cuidado se reativar**: se o bot local (PM2) ficar ativo ao mesmo tempo que uma instância no Railway, os dois brigam pelo `polling` do mesmo `TOKEN` do Telegram.
