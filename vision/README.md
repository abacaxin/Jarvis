# Vision System — protótipo experimental

Primeiro módulo do sistema visual do Kevin. Roda em laboratório (webcam
USB no PC, ou Raspberry Pi 3B) e simula o que um dia será a câmera dos
óculos. Escopo desta etapa: **câmera → landmarks → gesto → protocolo →
ação → captura de foto**. Nada além disso (sem OCR, sem reconhecimento
de objeto/rosto, sem LLM analisando imagem — ver "Limitações atuais").

## 1. Por que este módulo existe

A visão de longo prazo do Kevin inclui um óculos com câmera dando a ele
acesso ao ambiente do usuário (ver [docs/visao-produto.md](../docs/visao-produto.md)).
Antes de qualquer hardware final, é preciso validar o núcleo de visão
computacional: captura de imagem e reconhecimento de gestos como forma
de comando. Este módulo é esse núcleo, isolado da webcam/Pi de hoje o
suficiente para trocar a fonte de imagem no futuro sem reescrever o
resto.

## 2. Como se encaixa no Kevin

```
Kevin Brain (core/assistantBrain.js)
        │  (ainda não conectado — ver secção 9)
        ▼
VisionService (vision/interface/visionService.js)   ← Node, contrato estável
        │  processo filho persistente, comandos JSON via stdin/stdout
        ▼
engine.py (vision/engine.py)                          ← Python, orquestra o pipeline
        │
        ▼
Camera → Hand Detector → Gesture Recognizer → Protocolo → Ação
(camera/) (detection/)    (gestures/)          (protocols/) (actions/)
```

`core/` e `services/` (o Kevin de hoje) não foram alterados. O único
ponto de contato é `vision/interface/visionService.js`, que o cérebro
poderá importar quando decidir usar visão — sem saber que por trás
existe um processo Python, MediaPipe, etc.

## 3. Como rodar o teste principal

```bash
pip install -r vision/requirements.txt
python vision/detection/download_model.py   # baixa o modelo do HandLandmarker (~7.5MB), uma vez
npm run vision:test
```

Por padrão o `VisionService` chama o binário `python3`. Se o seu
ambiente só tiver `python` no PATH (comum em algumas instalações
Windows), rode com `VISION_PYTHON_BIN=python npm run vision:test`.

Testado e validado no Windows (Python 3.13) com webcam real — captura
funcionando ponta a ponta. Duas coisas específicas de Windows já
resolvidas no código, documentadas aqui pra não parecerem bug:

- **Aviso benigno em stderr**: linhas `INFO: Created TensorFlow Lite
  XNNPACK delegate...` e `W0000 ... inference_feedback_manager...` são
  log de inicialização do MediaPipe/TFLite, não erro — aparecem como
  `WARN [vision-engine]` no terminal e podem ser ignoradas. Erro de
  verdade do engine sempre vem como evento `vision.error`.
- **Câmera lenta/travando pra abrir**: no Windows, `cv2.VideoCapture`
  sem backend explícito usa Media Foundation, que trava ou demora muito
  pra abrir a câmera (principalmente logo após um open/close anterior).
  `camera/camera_source.py` já força `cv2.CAP_DSHOW` quando o SO é
  Windows — em Linux/Pi (V4L2) isso não é necessário e não é aplicado.

Isso simula o Kevin mandando `activate vision`: abre a câmera, mostra
uma janela com os landmarks da mão, e espera um gesto. Feche a mão
(punho fechado) na frente da webcam para disparar `PROTOCOL_CAPTURE` —
uma foto é salva em `vision/captures/` e o processo encerra sozinho.
`Ctrl+C` ou `q`/`ESC` na janela também encerram.

Logs esperados no terminal:

```
[KEVIN] Comando simulado recebido: activate vision
[VISION] Sistema de visao ativado
[CAMERA] Camera pronta { index: 0, width: 320, height: 240, fps: 15 }
[HAND] Mao detectada
[GESTURE] Gesto reconhecido: CLOSED_FIST
[PROTOCOL] PROTOCOL_CAPTURE
[ACTION] Captura concluida: { path: '...', timestamp: '...', resolution: '320x240', type: 'photo' }
[KEVIN] Ciclo completo. Encerrando teste.
```

## 4. Como testar a webcam isoladamente

```bash
python vision/test/test_camera.py
```

Abre a câmera, lê um frame, confere que veio dado válido. Não depende
de MediaPipe — se isso falhar, o problema é câmera/driver/permissão,
não visão computacional.

## 5. Como testar hand tracking

```bash
python vision/test/test_hand_detection.py
```

Mostra a webcam por 8 segundos com uma janela (`cv2.imshow`) — coloque
a mão na frente e confirme no terminal que "mão detectada" aparece,
junto da contagem de 21 landmarks.

Camadas puras (sem câmera, sem hardware) também têm teste próprio:

```bash
python vision/test/test_gesture_recognizer.py   # classificação de gestos com landmarks sinteticos
python vision/test/test_protocol.py              # mapeamento gesto -> protocolo (config.json)
python vision/test/test_capture.py               # ação de captura salva arquivo e devolve metadata certa
python vision/test/test_motion_recognizer.py     # gestos de movimento (SWIPE_RIGHT, PINCH_EXPAND)
node vision/test/test_vision_service.js          # contrato Node <-> Python end-to-end
```

## 6. Como adicionar um novo gesto

Existem dois tipos de gesto hoje — **pose parada** (segura a mão numa
posição por alguns frames) e **movimento** (a mão se desloca ao longo de
uma janela de tempo). Qual usar depende do gesto que você quer.

### Pose parada (ex: punho fechado, mão aberta)

Tudo em `vision/gestures/definitions.py`:

1. Escreva uma função `landmarks -> bool` usando `finger_states()` como
   base (ela já devolve quais dos 5 dedos estão esticados).
2. Registre em `GESTURE_SIGNATURES` com o nome do gesto:

```python
def is_thumbs_up(landmarks):
    states = finger_states(landmarks)
    return states["thumb"] and not any(
        v for k, v in states.items() if k != "thumb"
    )

GESTURE_SIGNATURES = {
    "CLOSED_FIST": is_closed_fist,
    "OPEN_PALM": is_open_palm,
    "THUMBS_UP": is_thumbs_up,
}
```

### Movimento (ex: deslizar, afastar as mãos)

Em `vision/gestures/motion_recognizer.py`. O reconhecedor guarda uma
janela deslizante de `(timestamp, mãos_detectadas)` e você escreve uma
regra de trajetória sobre essa janela — ver `_check_swipe_right()` (uma
mão, olha a posição x no começo e no fim da janela) e
`_check_pinch_expand()` (duas mãos: exige a pose de "pinça" só no
**início** da janela — durante o movimento os dedos podem abrir
normalmente, só a distância entre as duas mãos no final importa) como
exemplo. Poses auxiliares (tipo "dois dedos esticados" e "pinça") ficam
em `definitions.py` — não precisam entrar em `GESTURE_SIGNATURES`, só
são usadas pelo `motion_recognizer.py` diretamente.

Em nenhum dos dois casos `detection/`, `protocols/` ou `actions/`
precisam mudar — o detector continua só devolvendo landmarks (agora
uma lista, uma por mão detectada), o resto é decoupled via
`engine.py` chamando os dois reconhecedores em sequência.

## 7. Como adicionar um novo protocolo

Edite `vision/config.json`, chave `protocols` (gesto → protocolo):

```json
"protocols": {
  "CLOSED_FIST": "PROTOCOL_CAPTURE",
  "OPEN_PALM": "PROTOCOL_IDLE",
  "THUMBS_UP": "PROTOCOL_MEU_NOVO_PROTOCOLO"
}
```

Um gesto pode existir sem protocolo (fica só reconhecido, sem ação —
é o caso de `OPEN_PALM`/`PROTOCOL_IDLE` hoje, que não tem ação
registrada e não faz nada além de aparecer nos logs).

## 8. Como adicionar uma nova ação

Em `vision/actions/`, crie a função (ex: `actions/minha_acao.py`) e
registre em `vision/actions/dispatcher.py`:

```python
from actions.minha_acao import minha_funcao

ACTIONS = {
    "PROTOCOL_CAPTURE": lambda ctx: save_capture(ctx["frame"], ctx["captures_dir"]),
    "PROTOCOL_MEU_NOVO_PROTOCOLO": lambda ctx: minha_funcao(ctx),
}
```

`ctx` (contexto) hoje carrega `frame` (o frame atual, array numpy BGR)
e `captures_dir`. O `engine.py` não precisa saber o que a ação faz.

`config.json` → `action_delay_seconds` (default 1.5) atrasa **qualquer**
ação disparada por gesto — dá tempo da mão que fez o gesto sair de
cena antes do `frame` passado pra ação ser capturado de verdade (senão
`PROTOCOL_CAPTURE` sempre pegaria a própria mão no meio da foto). O
delay acontece em `engine.py` (`_delay_then_fresh_frame`), não dentro
da ação — o `frame` que a ação recebe já vem "limpo". Zero desativa.
Nesse meio tempo o `--show` mostra uma contagem regressiva na tela.

`gestures.hand_loss_grace_frames` (default 5) tolera até N detecções
vazias seguidas antes de considerar a mão realmente perdida — uma
webcam ruim ocasionalmente falha a detecção por 1-2 frames mesmo com a
mão parada, e sem essa tolerância isso já resetava o debounce do gesto
(obrigando segurar a pose de novo do zero) e disparava `hand.lost` sem
a mão ter saído de cena. Subir esse número aumenta a tolerância; `0`
volta ao comportamento estrito (qualquer frame vazio = mão perdida).

`gestures.action_cooldown_seconds` (default 3.0) silencia o
reconhecimento de gesto por esse tempo logo depois de QUALQUER ação
disparar. A mão que acabou de fazer o gesto ainda está em
cena/movimento nesse instante — sem o cooldown, esse resíduo de
movimento era o caso mais comum de disparar um segundo gesto
"fantasma" logo em seguida. `0` desativa (reconhece de novo assim que o
próximo frame processado permitir).

## 9. Integração com o cérebro

**Já existe integração real**, via comando explícito — `/foto` (ou
`/vision`) no Telegram aciona `handleVisionCommand()` em `index.js`:
ativa `visionService.startGestureRecognition()` e **mantém a sessão
ativa** — cada gesto reconhecido tira uma foto nova, sem precisar mandar
`/foto` de novo. A sessão só desliga por `/pare` (ou `/parar`) explícito,
ou sozinha depois de 60s sem nenhum gesto (`VISION_IDLE_TIMEOUT_MS`).
A cada `vision.capture.completed`, a imagem vai pra
`services/visionAnalyzer.js` (Groq, `qwen/qwen3.6-27b` — modelo
"Preview", único com suporte a imagem na Groq hoje, ver
[docs/decisoes.md](../docs/decisoes.md)) descrever, e essa descrição
entra como texto sintético no `processMessage()` normal — o Kevin
responde com a personalidade de sempre e pode salvar em memória se for
o caso. `simulateKevinCommand.js` continua existindo à parte, pro teste
local isolado da camada de visão (sem precisar do bot do Telegram nem
de crédito de API rodando).

**O que ainda NÃO existe** — o LLM decidindo sozinho quando ativar a
visão (hoje é sempre um comando explícito do usuário, não uma decisão
do `assistantBrain.js`). Isso não entrou na chamada única e estrita do
brain de propósito — colocar `activate_vision` no `RESPONSE_SCHEMA`
significa arriscar a garantia de JSON estrito que todo o resto depende
(ver decisão "Uma chamada LLM em vez de duas" em decisoes.md). Quando
isso for feito, o caminho mais seguro é o brain decidir e chamar
`visionService` a partir de fora da chamada estrita, não dentro dela.

**Entrada não-texto** continua uma simplificação consciente: `index.js`
ainda trata a mensagem do Telegram como sempre-texto — o comando `/foto`
é reconhecido por comparação de string antes de qualquer chamada ao
brain, não por `msg.photo` ou outro tipo de input do Telegram (ver
[docs/visao-produto.md](../docs/visao-produto.md)).

**Eventos**: o `VisionService` emite eventos (`vision.gesture.recognized`,
`vision.capture.completed`, `vision.error`, etc.) via `EventEmitter`
padrão do Node — o cérebro pode tanto fazer `await visionService.capture()`
(uso pontual) quanto assinar `visionService.on(...)` (uso contínuo,
reativo a gesto — é o que `handleVisionCommand()` faz). Isso já é
suficiente pros dois padrões de uso sem precisar de um barramento de
eventos separado — se um dia isso crescer pra múltiplos serviços além
de visão, um EventEmitter compartilhado central é o próximo passo.

## 10. Limitações atuais

- `SWIPE_RIGHT` e `PINCH_EXPAND` (gestos de movimento) foram validados
  só com landmarks sintéticos (`test_motion_recognizer.py`), não com mão
  de verdade na frente da câmera ainda — os limiares em
  `config.json` → `gestures` (`swipe_min_dx`, `pinch_near`, `pinch_far`,
  `motion_window_seconds`) são um chute inicial razoável, não algo
  calibrado. Se disparar cedo/tarde demais na prática, ajustar ali
  primeiro, sem mexer em código.
- Dois gestos têm ação real: `CLOSED_FIST` e `PINCH_EXPAND` → captura.
  `OPEN_PALM` é reconhecido mas não faz nada — propositalmente, para
  provar que a camada de protocolo funciona sem forçar uma ação
  inventada. `SWIPE_RIGHT` está mapeado pra `PROTOCOL_SWIPE`, também
  sem ação ainda.
- `max_num_hands` default subiu pra 2 (necessário pro `PINCH_EXPAND`,
  que precisa das duas mãos ao mesmo tempo) — custa quase o dobro de
  processamento por frame comparado a 1 mão. Na Pi 3B, se
  `PINCH_EXPAND` não for essencial, baixar pra 1 economiza
  processamento de verdade (ver secção 11).
- Classificador de gesto é geométrico (posição relativa dos dedos), não
  treinado — funciona bem para gestos bem diferentes entre si (punho x
  mão aberta), mas não escala para gestos sutis sem redesenhar
  `definitions.py`.
- Heurística do polegar (`_thumb_extended` em `gestures/definitions.py`)
  não diferencia mão esquerda/direita explicitamente — pode errar
  dependendo da lateralidade da mão. MediaPipe já devolve
  `multi_handedness`; não usado ainda porque não era necessário para os
  dois gestos atuais.
- `VisionService.capture()` e `startGestureRecognition()` compartilham
  o mesmo canal de eventos (`service.emit`); rodar os dois ao mesmo
  tempo (duas chamadas simultâneas) não é um cenário tratado — ok para
  um protótipo de uso solo, não para múltiplas sessões concorrentes.
- Sem reconexão automática se a câmera cair no meio do loop de gestos —
  o processo emite `vision.error` e encerra; quem chamou decide se
  reativa.
- Não testado em hardware Raspberry Pi 3B real ainda — ver secção 11.
- **Aviso benigno no log**: `landmark_projection_calculator.cc ... Using
  NORM_RECT without IMAGE_DIMENSIONS is only supported for the square
  ROI` aparece porque o frame é 320×240 (não quadrado). É um aviso
  interno do HandLandmarker sobre a otimização de ROI entre frames
  (`RunningMode.VIDEO`), não impede a detecção. Se a precisão dos
  landmarks parecer ruim na prática, esse é o primeiro ponto a
  investigar — não confirmado como problema real ainda, só registrado.

## 11. Considerações para Raspberry Pi 3B

- **MediaPipe exige 64-bit**: o wheel oficial do `mediapipe` só existe
  para `aarch64` (Raspberry Pi OS **Bookworm de 64 bits**). A Pi 3B
  suporta 64-bit, mas a instalação padrão de muitos tutoriais antigos é
  32-bit (armv7) — nesse caso `pip install mediapipe` falha. Rodar Pi
  OS Lite 64-bit é pré-requisito, não opcional.
- **Modelo `.task` precisa ir junto**: `vision/detection/hand_landmarker.task`
  não é versionado (é binário, ~7.5MB — ver `.gitignore`). Rode
  `python vision/detection/download_model.py` na própria Pi (ou copie o
  arquivo manualmente) depois de clonar o repo lá — sem ele,
  `HandDetector` recusa iniciar com um erro claro.
- **FPS esperado é baixo**: MediaPipe Hands roda a ~8–15 FPS numa Pi 4;
  a Pi 3B (Cortex-A53 @ 1.2GHz vs. Cortex-A72 @ 1.5GHz da Pi 4, mesma
  contagem de núcleos) deve ficar bem abaixo disso — projete a
  experiência para gestos discretos e mantidos (segure o gesto ~1s),
  não para tracking fluido em tempo real.
- **Resolução da câmera é uma troca consciente**: o default hoje é
  640×480 — bom o suficiente pra testar no PC sem imagem pixelada, mas
  pesado pra Pi 3B. **Baixar pra 320×240 (ou menos) é o primeiro ajuste
  ao migrar pra Pi**, antes de mexer em qualquer outra coisa — é o que
  mais pesa no processamento por frame.
- **Mitigações já no `config.json`**, pensadas para a Pi 3B:
  - `detection.max_num_hands` — default é 2 (por causa do
    `PINCH_EXPAND`, que precisa das duas mãos); se esse gesto não for
    usado na Pi, baixar pra 1 economiza quase metade do processamento
    de detecção por frame
  - `detection.process_every_n_frames` — processa só 1 a cada N frames
    lidos da câmera; suba esse número na Pi se o FPS estiver baixo
    demais (o overlay de debug reaproveita a última detecção entre
    frames pulados)
  - `gestures.stability_frames` — quantos frames seguidos com o mesmo
    gesto até confirmar; em FPS baixo, considere baixar esse número
    (menos frames = confirma mais rápido, mas mais sensível a ruído)
- **Sem GPU/acelerador dedicado**: nada aqui depende de Coral TPU,
  Hailo etc. — se o desempenho na Pi 3B for inviável mesmo com as
  mitigações acima, a rota é acelerador externo (fora do escopo desta
  etapa) ou aceitar detecção sob-demanda (comando `capture`) em vez de
  loop contínuo de gestos.

## Estrutura

```
vision/
├── config.json              → tudo que é tunável (câmera, modelo, protocolos)
├── requirements.txt          → deps Python (mediapipe — já traz opencv-contrib-python)
├── engine.py                 → orquestra o pipeline, chamado pelo VisionService
├── events.py                 → protocolo de eventos JSON (stdout)
├── visualize.py               → overlay de debug (--show), desenho manual com cv2
├── camera/camera_source.py   → abre/lê/fecha a câmera
├── detection/
│   ├── hand_detector.py      → frame -> landmarks (MediaPipe Tasks: HandLandmarker)
│   ├── download_model.py     → baixa hand_landmarker.task (rodar uma vez)
│   └── hand_landmarker.task  → modelo baixado (binário, fora do git)
├── gestures/
│   ├── definitions.py         → geometria: landmarks -> pose (fechado/aberto/pinça/...)
│   ├── recognizer.py          → pose parada: debounce/estabilidade -> gesto confirmado
│   └── motion_recognizer.py   → movimento: janela de tempo -> gesto (swipe, pinça-expande)
├── protocols/protocol_map.py → gesto -> protocolo (lê config.json)
├── actions/
│   ├── capture_action.py     → salva frame em disco + metadata
│   └── dispatcher.py         → protocolo -> ação
├── captures/                 → fotos capturadas (não versionado, exceto .gitkeep)
├── interface/
│   ├── visionService.js      → contrato Node <-> Python (o que o Kevin vai chamar)
│   └── simulateKevinCommand.js → `npm run vision:test`
└── test/                     → um teste por camada (ver secções 4 e 5)
```
