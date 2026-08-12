# Kevin

Assistente pessoal contínuo via Telegram, no estilo Jarvis/Edith — memória persistente de projetos, conhecimento e tarefas entre conversas.

## Stack real

- Node.js
- `node-telegram-bot-api` — interface via Telegram (polling)
- Groq (SDK `openai`, endpoint compatível) — LLM
- `fs-extra` — memória persistida em JSON (`memory/*.json`)
- `ws` — servidor/cliente WebSocket do hub de dispositivos (`hub/`)
- PM2 — gerenciamento de processo (restart automático)

## Como rodar localmente

```bash
npm install
cp .env.example .env   # preencher TOKEN e GROQ_API_KEY
npm start
```

Ou gerenciado pelo PM2 (recomendado, reinicia sozinho em caso de crash):

```bash
pm2 start ecosystem.config.js
pm2 save
```

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `TOKEN` | Token do bot no Telegram (via [@BotFather](https://t.me/BotFather)) |
| `GROQ_API_KEY` | Chave de API da [Groq](https://console.groq.com) |

## Estrutura

```
Kevin/
├── core/
│   └── assistantBrain.js   → chamada única ao LLM, decide resposta + o que salvar na memória
├── memory/
│   ├── profile.json        → nome do usuário e do assistente
│   ├── projects.json       → projetos identificados nas conversas (upsert por nome)
│   ├── knowledge.json      → fatos/conhecimento, com categoria e dedup
│   ├── todos.json          → tarefas (add/complete via conversa)
│   └── conversations.json  → histórico bruto, também usado como memória de sessão
├── services/
│   ├── memoryRouter.js     → load/save dos arquivos de memória
│   ├── logger.js           → log estruturado (timestamp + nível)
│   ├── visionAnalyzer.js   → descreve foto capturada (Groq, chamada separada do brain)
│   ├── audioTranscriber.js → transcreve audio gravado (Groq Whisper, chamada separada do brain)
│   └── intentRouter.js     → classifica intenção da fala: chat/visão (Groq, chamada separada do brain)
├── docs/                   → decisões de arquitetura e progresso do sprint
├── vision/                 → visão computacional (protótipo experimental, ver vision/README.md)
├── voice/                  → entrada por voz (protótipo experimental, local — ver abaixo)
├── hub/                    → hub WebSocket pra dispositivos ESP32 da casa (ver hub/README.md)
├── index.js                → bot Telegram, entrada principal
└── ecosystem.config.js     → config do PM2
```

## Visão computacional (experimental)

Primeiro protótipo do sistema visual do Kevin — webcam + MediaPipe Hands rodando como processo Python separado, com uma interface Node (`vision/interface/visionService.js`) que o cérebro chama sem conhecer os detalhes de câmera/gestos. Comando `/foto` no Telegram já ativa a visão de verdade, espera o gesto, tira a foto e manda a descrição pro Kevin normal responder — ativação ainda é sempre manual (comando explícito), o LLM ainda não decide sozinho quando ligar a câmera. `vision/engine.py` é um processo persistente (sobe uma vez, fica de pé recebendo comandos) — evita pagar o import do mediapipe + abertura da câmera (~28s) a cada foto, ver [docs/decisoes.md](docs/decisoes.md). Ver [vision/README.md](vision/README.md).

## Conversa por voz (experimental)

Primeiro protótipo de conversa por voz, ida e volta — mesma forma da visão. `services/audioTranscriber.js` transcreve via Groq Whisper (modelo de produção, chamada separada do brain), o texto entra no `processMessage()` normal, e `voice/speak_server.py` fala a resposta de volta via **Edge TTS** (voz neural da Microsoft, gratuita, sem chave de API — a Groq não tem voz em português; ElevenLabs foi testado, mas o plano free deles parece exigir cartão/pode cobrar, ver [docs/decisoes.md](docs/decisoes.md) pro histórico completo). `speak_server.py` fica de pé entre falas em vez de subir um processo por fala, evitando pagar o custo de import/inicialização do áudio a cada resposta. Ainda **local, sem Telegram**.

Duas formas de ativar a gravação:
- **Manual** (`voice/capture.py`, Enter pra começar/parar) — `npm run voice:test`.
- **Hands-free** (`voice/wake_listener.py`) — diga **"Hey Jarvis"** (wake word pré-treinada, via [openWakeWord](https://github.com/dscripka/openWakeWord) — sem conta, sem chave de API; Porcupine foi tentado primeiro mas exigia cadastro que travou, ver [docs/decisoes.md](docs/decisoes.md)) e a frase toda numa fala só (ex: "Hey Jarvis, ativa a visão") — um pré-roll de áudio guarda o instante antes da detecção, então a wake word e o comando ficam gravados juntos, sem pausa entre os dois. Para sozinho por detecção de silêncio. `npm run voice:wake`. Quer "Kevin" como wake word de verdade em vez de "Hey Jarvis"? Treine grátis (exige login Google/GitHub) em [openwakeword.com/train](https://openwakeword.com/train) e troque `wake_word_model` em `voice/config.json`.

No modo hands-free, a fala é interpretada em linguagem natural (`services/intentRouter.js` — chamada Groq separada, não comando fixo) pra decidir entre conversa normal, ativar a visão (espera gesto), capturar foto direto ou encerrar a sessão. Depois da wake word ativar uma vez, a conversa segue em **sessão contínua**: todo turno seguinte volta a escutar direto (`voiceService.forceListenNow()`), sem precisar repetir "Hey Jarvis" — dá pra falar sobre um projeto inteiro, ida e volta, numa chamada só. A sessão termina quando você pede explicitamente ("pode encerrar", "tchau Kevin") ou depois de alguns turnos seguidos sem entender nada (evita ficar escutando pro vazio indefinidamente).

O Kevin responde em **dois pacotes**: `resposta` (texto completo, usada no Telegram/logs) e `resposta_falada` (a mesma ideia resumida ao essencial pra soar natural em voz alta — curta por padrão, só longa quando o assunto exigir). No modo voz, quem toca no `speak_server.py` é sempre a versão falada, não o texto completo.

O áudio gravado passa por supressão de ruído (`noisereduce`, spectral gating, sem PyTorch — ver [docs/decisoes.md](docs/decisoes.md)) antes de virar arquivo, tentando melhorar a transcrição em ambiente barulhento.

**Deploy alvo: Raspberry Pi 3B.** Visão (MediaPipe) e wake word (onnxruntime) têm suporte melhor em Raspberry Pi OS de 64 bits — confirmar com `uname -m` no Pi (`aarch64` = ok, `armv7l` = vai dar trabalho). Ver [docs/decisoes.md](docs/decisoes.md) pro levantamento completo de risco de compatibilidade, ainda não validado no hardware real.

## Hub de automação residencial (experimental)

O Raspberry Pi que hospeda o Kevin também é o servidor central da casa — não só do bot (ver [docs/visao-produto.md](docs/visao-produto.md)). `hub/server.js` é um processo **separado** do Kevin que aceita conexão WebSocket de dispositivos ESP32; `hub/interface/hubClient.js` é a ponte que o `index.js` usa sem saber que existe WebSocket por trás (mesmo princípio da visão). Primeiro dispositivo: relé controlando a luz do quarto, acionado por comando explícito `/luz on`/`/luz off` no Telegram — não é o LLM decidindo sozinho (ação com efeito físico real, sem camada de permissão ainda, ver docs/decisoes.md).

```bash
npm run hub:test    # valida o protocolo ponta a ponta sem hardware nenhum
npm run hub:start   # sobe o servidor de verdade (no Pi, junto do bot)
```

Ver [hub/README.md](hub/README.md).

## Status atual

MVP em desenvolvimento. Ver [docs/progresso.md](docs/progresso.md) para o que já foi feito e o que falta do sprint.
