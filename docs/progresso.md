# Progresso

Baseado no sprint definido em [planejamento-original.md](planejamento-original.md). Atualizar conforme os blocos avançam.

## Feito

- [x] **Bloco 1 — Estabilidade**
  - Typing indicator (`bot.sendChatAction('typing')`) antes de `processMessage` em `index.js`
  - PM2 configurado (`ecosystem.config.js`), processo roda como `kevin`
- [x] **Bloco 2 — Performance core**
  - Duas chamadas LLM unificadas em uma só, com JSON Schema estrito (ver [decisoes.md](decisoes.md))
  - Modelo padrão trocado para Groq (`llama-3.3-70b-versatile`) — o plano original previa `openrouter/free`/`qwen3-8b:free`, mudou de provider (ver decisoes.md)

- [x] **Bloco 3 — Contexto real**: histórico de conversa injetado nas mensagens enviadas ao Groq. Primeira versão usava `Map` em RAM por `chatId`; trocado depois por leitura do disco (`conversations.json`) — ver seção mais abaixo sobre o bug de memória no Railway.
- [x] **Correções encontradas na análise fullstack (2026-08-07)**:
  - `saveProject` fazia só `push` — todo projeto em andamento virava uma linha nova a cada mensagem (visto em produção: "Mini robô de bancada" duplicado). Agora faz upsert por nome (case-insensitive), acumulando um `history[]` por projeto.
  - Prompt salvava small talk ("Boa noite") como projeto e conhecimento ao mesmo tempo — regras explícitas anti-falso-positivo adicionadas, e o prompt agora lista os nomes de projetos ativos pra o modelo reusar o nome exato em vez de duplicar.
  - `projects` era despejado inteiro (sem limite) em todo prompt — agora filtra só `status !== 'done'`, ordena por `updated_at` e limita a 15.
  - `profile.user_name` era carregado e nunca usado — agora entra no system prompt.
  - `memory/*.json` (dados pessoais/conversas) estava sendo versionado no git — removido do tracking (fica só local).
  - Sem `polling_error` handler e sem proteção contra resposta acima de 4096 chars (limite do Telegram) — ambos adicionados em `index.js`.

- [x] **Bloco 4 — Fast/Deep mode**: `DEEP_TRIGGERS` + `detectMode(texto)` em `core/assistantBrain.js`. Fast usa `openai/gpt-oss-20b`, Deep usa `openai/gpt-oss-120b` (os únicos dois modelos Groq com `json_schema` estrito — mantém a garantia do Bloco 2 nos dois modos). Feedback visual ("🧠 Modo análise ativado...") enviado em `index.js` antes do typing indicator quando o modo deep é detectado.

**Sprint original 100% concluído** (blocos 1 a 5 do plano).

- [x] **Refatorar `knowledge.json`**: schema ganhou `category` (`tecnico`, `preferencia`, `pessoal`, `projeto`, `outro`, classificado pelo próprio LLM na chamada única). `saveKnowledge` agora faz dedup por valor normalizado (repetir o mesmo fato só incrementa `hits`, não duplica) e o arquivo tem teto de 300 entradas (trim automático das mais antigas). O prompt mostra os conhecimentos agrupados por categoria, até 8 por categoria — teto fixo independente de quanto o arquivo cresça.
- [x] **Error handling estruturado + logs reais**: `services/logger.js` (timestamp + nível) substitui `console.log` solto. `index.js` ganhou handlers de `uncaughtException`/`unhandledRejection` (loga e sai — PM2 reinicia limpo em vez de estado indefinido). `memoryRouter.js` e `assistantBrain.js` não crasham mais se um arquivo de memória estiver com JSON corrompido — logam warning e resetam pro fallback.
- [x] `conversations.json` também ganhou teto (500 entradas).

- [x] **Deploy 24/7 (Railway)**: feito, repo em [github.com/abacaxin/Jarvis](https://github.com/abacaxin/Jarvis) conectado, push na `main` fazia redeploy automático. **Removido em 2026-08-12** — decisão de ir com Raspberry Pi 3B local como alvo real (ver linha abaixo). Serviço apagado no painel do Railway, não redeploya mais.
- [x] **Bug pós-deploy: sessão perdia contexto entre mensagens no Railway** — `sessionHistory` (Map em RAM) zerava a cada restart do processo. Trocado por `loadHistory()`, que lê `conversations.json` do disco (ver [decisoes.md](decisoes.md)). `index.js` não mantém mais estado de sessão em memória.

- [x] **Personalidade estilo Jarvis/Edith**: prompt reescrito com o tom escolhido pelo usuário (competente, direto, humor seco e ocasional). Ver [decisoes.md](decisoes.md).
- [x] **Relevância de memória**: `knowledge` agora é selecionado por overlap de palavras com a mensagem atual + leve peso por `hits`, com fallback pra recência quando não há overlap. `projects` continua só por recência de propósito (ver decisoes.md — risco de duplicar é pior que gastar contexto extra).
- [x] **To-do list**: `memory/todos.json`, campos `todo_action`/`todo_text` no schema único. Marcar como concluído exige o modelo reusar o texto exato da lista TO-DO PENDENTES (mesmo princípio anti-duplicação do upsert de projeto). Testado direto (add → listar → complete → listar de novo), funcionou de primeira.
- [x] **Efeito de "digitando"**: placeholder "💭 Pensando..." editado com a resposta final (`bot.editMessageText`) + indicador nativo do Telegram mantido vivo via `setInterval` (expira sozinho a cada ~5s). Streaming de verdade não é possível junto com `json_schema` estrito na Groq — ver decisoes.md.
- [x] **Ajuste de precisão**: `save_project` exigia só "descrever ou avançar" o projeto — vago demais, uma pergunta de status ("e o robô, o que falta?") disparava salvamento e sobrescrevia a descrição com algo mais vago. Regra reforçada pra exigir informação nova (decisão/progresso real). Revalidado depois do ajuste.

- [x] **Visão computacional (protótipo)**: webcam + MediaPipe, ativado por `/foto`/`/vision`, reconhece gesto, tira foto, descreve via Groq e injeta no `processMessage`. Feito pelo usuário fora desta sessão, merge de `feature/vision-voice-assistant`. Ver [vision/README.md](../vision/README.md).
- [x] **Voz (protótipo, local, sem Telegram)**: wake word "Hey Jarvis", transcrição via Groq Whisper, resposta falada via Edge TTS, sessão contínua sem repetir a wake word. Feito pelo usuário fora desta sessão. Ver [voice em README.md](../README.md).
- [x] **Decisão: deploy real é Raspberry Pi 3B local, não Railway** — Railway removido do painel, documentado só como histórico. Ver [visao-produto.md](visao-produto.md) e [deploy.md](deploy.md).
- [x] **Hub WebSocket + luz do quarto (ESP32 + relé)**: `hub/server.js` (processo próprio) + `hub/interface/hubClient.js` (contrato pro Kevin) + firmware `hub/firmware/quarto_luz/quarto_luz.ino`. Comando explícito `/luz on`/`/luz off` em `index.js` — não é o LLM decidindo (mesmo motivo do `/foto`, ver decisoes.md). Protocolo validado ponta a ponta sem hardware real (`npm run hub:test`); firmware ainda não gravado/testado no ESP32 físico.

- [x] **SO do Pi confirmado 64 bits** (`aarch64`) — não precisou reinstalar. Câmera decidida: webcam USB comum. **Correção:** o codename Bookworm citado antes nunca foi confirmado de fato (só `uname -m` foi rodado) — dado que o Pi tem **Python 3.13.5** e Bookworm vem com Python 3.11 por padrão, o SO provavelmente é mais novo (Trixie/Debian 13 ou similar).
- [x] **Segunda evidência de que o SO é Debian 13 (Trixie): `libatlas-base-dev` (Fase 1) não foi encontrado no `apt`.** Esse pacote foi removido especificamente no Trixie, substituído por `libopenblas-dev` — `deploy.md` atualizado. Ainda não confirmado via `cat /etc/os-release | grep VERSION_CODENAME` de forma definitiva, mas duas evidências independentes (Python 3.13 default + esse pacote sumido) convergem.
- [x] **Guia de instalação completo pro Pi escrito** — [deploy.md](deploy.md), fases 1 a 9 (pacotes de sistema, Node, venv Python, .env, teste isolado de webcam/bluetooth/mic, ESP32, PM2 com `kevin`+`hub`, checklist final). `ecosystem.config.js` ganhou a app `hub` (antes só tinha `kevin`).

## Em andamento

- [x] **Causa da Fase 4 travada encontrada — primeira tentativa de fix (soltar o cap pra `mediapipe>=1.0.0`) resolveu o `pip install`, mas revelou um bloqueio pior.** `vision/requirements.txt` fixava `mediapipe>=0.10,<0.11`, cap escolhido antes do Python 3.13 existir; confirmado via PyPI que não existe NENHUM wheel 0.10.x pra Python 3.13 (nem build from source funciona, ver [google-ai-edge/mediapipe#6159](https://github.com/google-ai-edge/mediapipe/issues/6159)). Soltar pra `1.0.0` instalou, mas rodar `python vision/test/test_hand_detection.py` no Pi deu `FATAL ERROR: This binary was compiled with aes enabled, but this feature is not available on this processor` (SIGILL) — o build aarch64 da 1.0.0 exige a extensão de criptografia ARMv8 (AES), que o Cortex-A53 do Pi 3B não tem; é compilado no binário, não tem env var que resolva. **Fix de verdade**: pin voltou pra `mediapipe>=0.10,<0.11`, e o venv da Fase 4 do `deploy.md` passou a usar Python 3.11 via `pyenv` em vez do 3.13 do sistema — 0.10.18 (última da linha 0.10.x) tem wheel aarch64 confirmado pra cp311 e não tem esse requisito de AES. **Ainda não testado no Pi**: nem o `pyenv install 3.11` (lento numa CPU fraca), nem se `detection/hand_detector.py` (Tasks API) funciona de fato nessa combinação.

- [x] **Segundo bloqueio da Fase 4 encontrado e corrigido, falta validar no Pi.** `pip install -r voice/requirements.txt` falhava com `Could not find a version that satisfies the requirement tflite-runtime` — `openwakeword` declara `tflite-runtime<3,>=2.8.0` como obrigatório no Linux, mas esse pacote nunca lançou wheel pra Python 3.13 em nenhuma plataforma (projeto parado no PyPI, para em Python 3.11). Lendo o source do `openwakeword` (`model.py`): esse import só roda se `inference_framework="tflite"` — nosso `wake_listener.py` sempre pede `"onnx"`, então nunca precisamos de `tflite-runtime` de verdade. Fix: `voice/requirements.txt` tirou `openwakeword` da lista normal e listou seus deps reais (`onnxruntime`, `scipy`, `tqdm`, `requests`) explicitamente; `deploy.md` (Fase 4) instala `openwakeword` numa linha separada com `pip install --no-deps`, pulando o `tflite-runtime` que nunca é importado. **Ainda não testado no Pi.**

## Pendente

- [ ] Múltiplos `chatId` compartilham os mesmos arquivos de memória (`profile.json`, `projects.json`...) — ok pra uso solo, vira bug se mais de uma pessoa usar o bot
- [ ] Firmware do ESP32 (`hub/firmware/quarto_luz`) precisa ser gravado e testado em hardware real — só o servidor/cliente Node foram validados
- [ ] Guia do Pi ([deploy.md](deploy.md)) ainda não foi executado de ponta a ponta no hardware real — escrito com base no que já se sabia de cada subsistema, não validado no Pi 3B ainda
- [ ] `voice/wake_listener.py` não está no `ecosystem.config.js` de propósito (ainda prototípico, sem Telegram) — decidir se entra como processo persistente depois de validar o resto
