# Decisões de arquitetura

Registro de decisões técnicas tomadas ao longo do projeto e o porquê. Objetivo: quando algo parecer estranho no código daqui a 3 meses, a resposta está aqui, não precisa adivinhar.

## Groq no lugar de OpenRouter (`openrouter/free`)

**Decisão:** trocar o provider de `openrouter/free` para a API da Groq.

**Por quê:** o modelo gratuito do OpenRouter é instável (fila imprevisível, sem garantia de qualidade/disponibilidade), problema já identificado no planejamento original. Groq tem SLA mais previsível e suporta Structured Outputs (JSON Schema estrito), o que resolve o segundo problema abaixo.

**Modelos usados hoje:**
- `openai/gpt-oss-120b` — chamada única (resposta + decisão de memória)

Trocar o modelo é uma linha em `FAST_MODEL` no topo de `core/assistantBrain.js`, **mas atenção**: `response_format: json_schema` com `strict: true` só é suportado por `openai/gpt-oss-20b` e `openai/gpt-oss-120b` na Groq (testado em produção — `llama-3.3-70b-versatile` retorna 400 nesse response_format). Qualquer outro modelo exige trocar pro modo `json_object` (sem garantia de schema) ou voltar a validar o JSON manualmente. Quando o Fast/Deep mode (bloco 4 do sprint) for implementado, provavelmente vira dois modelos diferentes ao invés de uma constante única — manter essa restrição em mente ao escolher o modelo do modo Fast.

## Uma chamada LLM em vez de duas

**Decisão:** unificar `analyzeIntent()` + geração de resposta em uma única chamada.

**Por quê:** o fluxo original fazia duas chamadas por mensagem sempre (análise de intenção + resposta final) — 2x custo, 2x latência, sem exceção. Também havia um problema crítico: se `analyzeIntent` retornasse JSON malformado, o fluxo continuava e podia salvar lixo na memória.

**Como:** a chamada única usa `response_format: { type: 'json_schema', json_schema: { strict: true, ... } }` da Groq, que garante que a resposta sempre volta no formato esperado (`resposta`, `save_project`, `project_name`, `save_knowledge`, `summary`) — elimina a necessidade de `try/catch` em volta de um `JSON.parse` torcendo pra dar certo.

## Histórico de sessão vem do disco, não de RAM

**Decisão:** `loadHistory()` em `memoryRouter.js` lê as últimas 10 trocas direto de `conversations.json` a cada mensagem, em vez de manter um `Map` em memória por `chatId` em `index.js`.

**Por quê:** a primeira versão do Bloco 3 usava um `Map` em RAM — funcionava liso local via PM2, mas quebrava no Railway: qualquer restart do processo (deploy, crash, realocação de host) zerava o `Map` inteiro, e Kevin "esquecia" até a mensagem anterior. Sintoma relatado em produção: perda de contexto entre mensagens consecutivas logo após o primeiro deploy no Railway.

`conversations.json` já era salvo a cada mensagem (só nunca era lido de volta — esse era o problema #2 do diagnóstico inicial). Usar esse arquivo como fonte do histórico resolve os dois problemas de uma vez: fecha o loop do `conversations.json` não utilizado, e torna a memória de sessão resistente a restart, que é a realidade normal de qualquer hospedagem em nuvem.

**Custo:** uma leitura de arquivo pequeno por mensagem em vez de um lookup em memória — desprezível pro tamanho de `conversations.json` (capado em 500 entradas).

## Relevância de memória (só em `knowledge`, não em `projects`)

**Decisão:** `knowledge` agora é selecionado por relevância à mensagem atual (overlap de palavras, normalizado por tamanho do texto, com bônus leve por `hits`) em vez de só pegar os últimos N por recência. Quando não há nenhum overlap de palavras, cai de volta pra recência — não fica vazio nem aleatório.

**Por quê não fiz o mesmo pra `projects`:** o prompt depende de listar TODOS os projetos ativos pro modelo conseguir reusar o nome exato e não duplicar (ver decisão de upsert por nome, acima). Se filtrasse projetos por relevância, um projeto ativo pouco mencionado na mensagem atual podia sumir da lista e o modelo criaria um duplicado sem saber que ele já existia. `projects` continua ordenado só por `updated_at`, capado em 15 — o risco de duplicar é pior que o risco de gastar um pouco mais de contexto.

## Personalidade: estilo Jarvis/Edith

**Decisão:** prompt de personalidade reescrito — competente, leal, direto, humor seco e ocasional (nunca forçado em toda resposta), nunca soa como assistente virtual genérico ("Como posso ajudar você hoje?"). Escolhido com o usuário via pergunta direta em 2026-08-07 (ver [visao-produto.md](visao-produto.md) pro contexto de por que o projeto mira nesse estilo).

Se o tom não estiver batendo, o ajuste é só no bloco "Personalidade" dentro do system prompt em `core/assistantBrain.js` — não precisa mexer em mais nada.

## To-do list segue o mesmo padrão do upsert de projeto

**Decisão:** `todo_action` ("add"/"complete"/null) + `todo_text` no schema único, igual o resto. Pra marcar uma tarefa como concluída, o modelo precisa reusar o texto EXATAMENTE como aparece em TO-DO PENDENTES no prompt — sem matching difuso (fuzzy) no código.

**Por quê:** a mesma lógica que evita duplicar projeto (dar ao modelo a lista exata pra ele referenciar por nome) evita completar a tarefa errada aqui. Fuzzy matching (por similaridade de texto) é mais flexível mas arrisca marcar como feita uma tarefa parecida só na superfície; matching exato contra uma lista que o próprio modelo já viu é mais previsível — se `completeTodo()` não achar bate exato, ela loga um warning e não faz nada (fail-safe, não fail-silent-errado).

Testado direto contra `processMessage` (add → listar → complete → listar de novo): funcionou de primeira, inclusive puxando o nome do usuário na confirmação ("Parabéns, Dan!").

## Efeito de "digitando" sem streaming real

**Decisão:** Groq não suporta streaming junto com `response_format: json_schema` estrito — então não dá pra fazer streaming token-a-token sem abrir mão da garantia de JSON bem formado do Bloco 2 (não vale a troca). Em vez disso: manda uma mensagem placeholder ("💭 Pensando...") na hora, mantém o indicador nativo "digitando..." do Telegram vivo via `setInterval` (ele expira sozinho a cada ~5s), e edita o placeholder com a resposta final quando chega (`bot.editMessageText`).

**Efeito colateral encontrado e corrigido:** a regra "pergunta sobre o que já existe na memória não conta como novo conteúdo" só cobria to-do e listagem explícita — uma pergunta tipo "e o robô, o que falta?" ainda disparava `save_project` e sobrescrevia a descrição do projeto com uma versão mais vaga. Regra de `save_project` reforçada pra exigir informação NOVA (decisão/progresso/mudança de escopo), não só uma pergunta de status. Revalidado depois do ajuste — parou de disparar.

## PM2 para gerenciar o processo

**Decisão:** rodar via PM2 (`ecosystem.config.js`) em vez de `node index.js` direto.

**Por quê:** restart automático em caso de crash, sem precisar de infra adicional — é a opção mais simples indicada no planejamento original para estabilidade local antes de pensar em deploy 24/7 (Railway, conforme planejamento).

## Análise de imagem (visão) é uma chamada Groq separada da chamada única do brain

**Decisão:** `services/visionAnalyzer.js` faz sua própria chamada à Groq (modelo `qwen/qwen3.6-27b`) pra descrever a foto capturada, em vez de colocar essa descrição dentro da mesma chamada estrita de `processMessage()`. O texto resultante entra em `processMessage()` como uma segunda chamada, como se fosse uma mensagem do usuário.

**Por quê:** `qwen/qwen3.6-27b` é o único modelo com suporte a imagem na Groq hoje, mas está em status **Preview** (não é modelo de produção — mesmo risco de instabilidade que já fez o projeto sair do `openrouter/free`, ver decisão acima) e não há confirmação de que suporta `response_format: json_schema` com `strict: true`. Colocar geração de descrição de imagem dentro da chamada única (que depende de `json_schema` estrito em `gpt-oss-20b`/`120b` pra funcionar) arriscaria essa garantia. Manter as duas chamadas separadas custa uma latência extra por foto, mas isola o risco: se o modelo de visão sumir/mudar de nome (comum em modelo Preview), só `visionAnalyzer.js` quebra — o resto do Kevin continua funcionando normalmente.

**Ativação:** hoje é sempre por comando explícito do usuário (`/foto` ou `/vision` em `index.js`), não uma decisão do LLM — colocar `activate_vision` no `RESPONSE_SCHEMA` do brain é um passo futuro deliberadamente não tomado aqui, pelo mesmo motivo (não vale o risco na chamada estrita ainda). Ver [vision/README.md](../vision/README.md) seção 9 para o detalhe da integração.

## TTS (Kevin falando) não usa Groq — e passou por 3 versões até estabilizar

**Decisão final:** `voice/speak_server.py` sintetiza a resposta do Kevin com **Edge TTS** (voz neural da Microsoft, `pt-BR-AntonioNeural`, gratuita, sem chave de API).

**Por quê nem Groq nem OpenAI/Azure oficiais:** a Groq só tem TTS em inglês e árabe (`canopylabs/orpheus-v1-english`/`-arabic-saudi`) — sem português, nem entrou como opção.

**Histórico da ida e volta** (registrado pra não repetir o mesmo caminho achando que é novidade):

1. **Edge TTS (v1).** Primeira escolha — gratuita, sem cadastro. Usuário reportou "muito robótica" e problema com acentuação.
2. **ElevenLabs (v2).** Trocado achando que era limitação da voz. Nesse meio tempo, **achamos e corrigimos um bug separado**: o Python no Windows lia `stdin` como `cp1252`, corrompendo todo acento (`ç`, `ã`, `õ`) antes mesmo do texto virar áudio (ver decisão de encoding abaixo) — ou seja, boa parte do "não reage bem às acentuações" original **não era a voz**, era esse bug. ElevenLabs funcionou (voz mais humana, modelo `eleven_flash_v2_5` de baixa latência), mas o usuário notou que o plano free deles aparentemente exige cartão/pode cobrar — não é o tipo de risco aceitável pra um protótipo experimental sem confirmação clara de custo zero.
3. **Edge TTS de novo (v3, atual).** Com o bug de encoding já corrigido, voltou a ser a opção — gratuita de verdade, sem risco de cobrança surpresa. Voz configurável em `voice/config.json` → `tts_voice` (`pt-BR-AntonioNeural` default, com `tts_pitch`/`tts_rate` pra ajustar tom/velocidade). Se a qualidade ainda incomodar agora que os acentos saem certos, os próximos candidatos "mais humanos" de verdade são pagos (ElevenLabs com cartão confirmado, Azure Speech oficial, OpenAI TTS) — nenhum é gratuito sem risco de cobrança.

**Reprodução:** `playsound` (opção mais óbvia pra tocar o `.mp3` gerado) falhou o build no Windows nesse ambiente — trocado por `pygame.mixer`, que instala via wheel pronta (sem compilador) e toca `.mp3` sem drama. `PYGAME_HIDE_SUPPORT_PROMPT=1` precisa ser setado antes do `import pygame`, senão ele imprime uma mensagem de boas-vindas no stdout que quebra o protocolo de eventos JSON-por-linha (mesmo formato do `vision/events.py`).

## `speak_server.py` é um processo persistente, não um por fala

**Decisão:** o processo Python que fala (`voice/speak_server.py`) sobe uma vez e fica vivo lendo uma linha de texto por vez do stdin — diferente de `capture.py`, que sobe um processo novo a cada gravação.

**Por quê:** medido nessa máquina, importar `edge_tts` + `pygame` (que carrega `aiohttp` por baixo) custa sozinho **~4,8s**, mais ~1,5-2s de handshake de rede pra sintetizar e ~0,7s pra inicializar o `pygame.mixer` — quase **7s de silêncio** antes do Kevin começar a falar, TODA fala, com o modelo antigo de "sobe processo, fala, morre" (`voice/speak.py`, removido). Como esse custo é fixo por processo (não por fala), manter o processo vivo faz ele ser pago só uma vez por sessão.

## Bug de encoding: texto acentuado chegava corrompido no Python

**Decisão:** `voiceService.js` seta `PYTHONIOENCODING=utf-8` no `env` do processo filho, em `spawnPython()`.

**Por quê:** no Windows, o Python lê/escreve `stdin`/`stdout` usando o codepage do sistema (`cp1252` nesta máquina) por padrão, não UTF-8. O Node manda o texto do Kevin em UTF-8 — todo acento (`ç`, `ã`, `õ`, `é`...) chegava corrompido em `speak_server.py` **antes mesmo de virar áudio**, e o TTS tentava pronunciar o texto errado. Sintoma reportado pelo usuário como "não reage bem às acentuações" — na real não era limitação da voz, era o texto já chegando errado. Confirmado reproduzindo isolado (`sys.stdin.read()` devolvendo string corrompida) antes de aplicar o fix.

**Efeito colateral tratado:** `VisionService.stopGestureRecognition()` já tinha esse problema (listener de `'exit'` genérico disparando aviso de "encerrou inesperado" numa parada intencional) — mesma correção aplicada em `voiceService.js` → `stopSpeaking()` (`removeAllListeners('exit')` antes de fechar o stdin).

## Wake word ("ativação por voz"): openWakeWord, não Porcupine

**Decisão:** `voice/wake_listener.py` usa **openWakeWord** com o modelo pré-treinado `hey_jarvis` como wake word padrão, escutando o microfone continuamente e gravando o comando até detectar silêncio (sem precisar de Enter — diferente de `capture.py`).

**Por quê Porcupine foi descartado:** era a escolha inicial (motor padrão da indústria, roda oficialmente em Raspberry Pi, treino de palavra customizada em segundos no console deles) mas exigia criar conta na Picovoice — o cadastro travou pro usuário, então foi abandonado antes de qualquer código ser escrito de verdade.

**Por quê "Hey Jarvis" em vez de "Kevin":** openWakeWord não exige conta nem chave de API, mas os modelos prontos são um conjunto fixo (`alexa`, `hey_mycroft`, `hey_jarvis`, `hey_rhasspy`, `timer`, `weather`) — "Kevin" não está entre eles. Treinar uma wake word customizada com openWakeWord é possível e também gratuito (via [openwakeword.com/train](https://openwakeword.com/train)), mas é passo extra que não bloqueia o protótipo funcionar agora. "Hey Jarvis" já vem pronto e combina com o tema do projeto (Kevin é inspirado no Jarvis). Trocar por um modelo customizado é só treinar e apontar `wake_word_model` (em `voice/config.json`) pro `.onnx` baixado — `wake_listener.py` já aceita tanto o nome de um modelo pré-treinado quanto o path de um customizado.

**Detecção de silêncio pra parar de gravar:** com ativação por voz, não faz mais sentido pedir Enter pra parar de falar — `wake_listener.py` grava até o volume (RMS) ficar abaixo de `silence_threshold` por `silence_duration_seconds` seguidos (default 1s), com um teto de segurança (`max_recording_seconds`, default 30s). É um limiar fixo, não um VAD de verdade — sensível a ruído de fundo/ganho do microfone; esses números em `config.json` são o primeiro ajuste se cortar a fala cedo ou tarde demais.

**Otimização: stub de `sklearn` antes de importar `openwakeword`.** `openwakeword/__init__.py` importa `sklearn` incondicionalmente (usado só para treinar um "verificador customizado" — feature que este projeto não usa, só faz detecção com modelo já treinado). Medido nesta máquina: importar `sklearn` sozinho custava **~26s**, inflando o startup do `wake_listener.py` pra **~45s**. `wake_listener.py` registra módulos-stub em `sys.modules` pras poucas classes/funções que `openwakeword` importa de `sklearn` (`LogisticRegression`, `make_pipeline`, `FunctionTransformer`, `StandardScaler`) antes do `import openwakeword` — isso não quebra a detecção (testado: `Model.predict()` funciona igual), só evita carregar uma biblioteca inteira só pra satisfazer um import não usado. Com o stub, o startup real caiu pra **~7,4s** (ativado + escutando). Se `wake_listener.py` algum dia precisar treinar verificador de verdade, é só remover o bloco do stub.

## Wake word + comando numa frase só (pré-roll de áudio)

**Decisão:** `WakeListener` mantém um `deque` curto (`pre_roll_seconds`, default 1.5s) com o áudio mais recente durante o modo IDLE. Quando a wake word dispara, esse pré-roll vira o início da gravação em vez de começar do zero.

**Por quê:** sem isso, o fluxo exigia uma pausa artificial — dizer "Hey Jarvis", esperar o sistema reagir, só então falar o comando. Com o pré-roll, "Hey Jarvis, ativa a visão" dito de corrida fica gravado inteiro, porque o áudio de ANTES da detecção (que inclui a wake word sendo pronunciada) já está no buffer quando a gravação começa. Efeito colateral: `has_spoken` agora começa sempre `True` (a wake word em si já conta como fala), então o branch antigo de "descartar gravação sem fala nenhuma" virou código morto e foi removido — na prática isso só troca "descartar silenciosamente" por "transcrição vazia/só-o-nome ocasional", que o lado Node já tratava (`"não entendi nada"`).

**Bug encontrado depois:** dizer só "Hey Jarvis" e fazer uma pausa NATURAL antes do comando de verdade (comportamento comum de fala, não um erro do usuário) cortava a gravação cedo demais — `silence_duration_seconds` (1s, pensado pra detectar o FIM de um comando) também se aplicava à pausa ANTES do comando começar, então "Hey Jarvis" sozinho virava a transcrição inteira e ia pro Kevin como se fosse o comando (gerando respostas tipo "mas eu sou o Kevin" pra quem disse só o nome do Jarvis).

**Correção — duas tolerâncias de silêncio diferentes:** `WakeListener` agora rastreia `command_speech_detected` (só vira `True` quando detecta fala REAL depois do gatilho, não a wake word do pré-roll). Antes disso, usa `post_wakeword_grace_seconds` (default 4s, bem mais tolerante) em vez do `silence_duration_seconds` curto — dá tempo real da pessoa começar a falar o comando depois de uma pausa natural. Assim que fala de verdade é detectada, volta pro `silence_duration_seconds` curto pra continuar detectando o FIM do comando com responsividade normal. Testado com dados sintéticos: pausa de 2s pós-wake-word (dentro da graça de 4s) não corta; depois que a fala do comando começa, 1,3s de silêncio já corta (usa o limiar curto).

**Rede de segurança no lado Node:** mesmo com a graça maior, ainda é possível a pessoa só dizer a wake word e desistir — `simulateWakeWordConversation.js` trata transcrições com 3 palavras ou menos como "provavelmente só a wake word" e volta a escutar direto (`forceListenNow()`) em vez de mandar pro Kevin. Heurística imperfeita (um comando curto de verdade, tipo "para", cai nesse caso também), mas cobre o cenário mais comum sem precisar de mais uma chamada de classificação.

## Roteamento de intenção por linguagem natural, não comando fixo

**Decisão:** `services/intentRouter.js` — chamada Groq separada (`gpt-oss-20b`, schema estrito, mesmo padrão de `visionAnalyzer.js`/`audioTranscriber.js`) classifica a transcrição em `chat`, `vision_activate` ou `vision_capture` antes de decidir o que fazer, em vez de exigir um comando fixo tipo `/foto`.

**Por quê:** pedido explícito do usuário — não queria ficar preso a uma palavra específica, queria que "Kevin, ativa a visão" e "Kevin, capture isso" funcionassem em linguagem natural, do jeito que o resto do Kevin já entende intenção (`save_project`, `todo_action` etc. no schema do brain). Mesma lógica de manter isso **fora** da chamada estrita principal: `intentRouter.js` é uma classificação pequena e isolada, não arrisca o schema que o resto do Kevin depende. Testado com 6 frases reais (Groq de verdade) — todas classificadas certo, incluindo casos ambíguos tipo "liga a câmera pra ver um gesto" → `vision_activate`.

**Mapeamento pro contrato existente:** `vision_capture` → `visionService.capture()` (foto direta, sem gesto). `vision_activate` → `visionService.startGestureRecognition()` (espera gesto, timeout de 30s — mesmo padrão de `index.js` → `handleVisionCommand()`, só que sem sessão persistente entre fotos, já que o loop de voz volta pro modo "escutando a wake word" a cada turno de qualquer forma).

## Follow-up sem repetir a wake word

**Decisão:** `wake_listener.py` roda uma thread separada lendo comandos do stdin (hoje só `"LISTEN_NOW"`); ao receber, pula a wake word e começa a gravar direto (`WakeListener.force_start_recording()`). `voiceService.js` expõe isso como `forceListenNow()`. O script de conversa (`simulateWakeWordConversation.js`) chama isso quando a resposta do Kevin termina em `"?"`.

**Por quê:** pedido explícito do usuário — em "Kevin, adicione um projeto" → "Certo, qual projeto?", não faz sentido exigir a wake word de novo só pra responder uma pergunta que o próprio Kevin fez. Reaproveita o mesmo processo/`InputStream` já rodando (não sobe um processo novo), só muda o `mode` internamente — mesma lógica de estado que já existia pra detecção real da wake word.

## Sessão contínua (vários turnos sem repetir a wake word)

**Decisão:** `simulateWakeWordConversation.js` ganhou `sessionActive` (vira `true` só numa detecção REAL da wake word, não numa `forceListenNow()`) e `consecutiveEmptyTurns`. Enquanto `sessionActive`, todo turno — não só respostas terminadas em `"?"` — volta a escutar direto via `forceListenNow()`, substituindo a heurística antiga de regex `/\?\s*$/`. A sessão encerra de duas formas: intenção `end_session` (nova, ver abaixo) ou `MAX_CONSECUTIVE_EMPTY_TURNS` (3) turnos seguidos vazios/curtos demais — isso evita loop infinito consumindo Whisper atrás de silêncio se o usuário simplesmente for embora sem avisar.

**Por quê:** pedido explícito do usuário — quer chamar o Kevin uma vez e conversar sobre um projeto inteiro (vários turnos de ida e volta) sem repetir "Hey Jarvis" a cada frase. A heurística antiga (só reescuta se a resposta terminar em `?`) cobria só o caso de pergunta explícita do Kevin, não uma conversa livre em ambos os sentidos.

**Nova intenção `end_session`:** `services/intentRouter.js` ganhou uma quarta categoria (`"pode encerrar"`, `"tchau Kevin"`, `"já terminei"` etc.), testada com 7 frases reais contra a Groq (4 de encerramento + 3 de controle) — todas classificadas certo. Mesmo padrão das outras: chamada separada, schema estrito, não arrisca o brain principal.

## Dois pacotes de resposta: texto completo vs. fala fluida

**Decisão:** `RESPONSE_SCHEMA` (`core/assistantBrain.js`) ganhou um segundo campo obrigatório, `resposta_falada`, ao lado do `resposta` já existente. `resposta` continua a resposta completa (usada em texto — Telegram, logs, histórico salvo em `conversations.json`); `resposta_falada` é a mesma ideia reduzida ao essencial pra ser falada — direto, fluido, curta por padrão (1-2 frases), só mais longa se o assunto pedir de verdade. `processMessage()` agora retorna `{ resposta, resposta_falada }` em vez de uma string; os 4 call sites reais (`index.js` x2, `simulateVoiceConversation.js`, `simulateWakeWordConversation.js` x2) foram atualizados — texto (Telegram) usa `resposta`, voz (`voiceService.speak()`) usa `resposta_falada`.

**Por quê:** pedido explícito do usuário — não queria que o Kevin "lesse" respostas longas em voz alta palavra por palavra; quer algo mais fluido de ouvir, reservando explicação completa pra quando for realmente necessário. Gerar os dois campos na MESMA chamada estrita (em vez de uma segunda chamada Groq só pra resumir pra fala) é mais barato e mais rápido — poucas frases extras de output, não uma chamada inteira nova — e mantém o padrão já estabelecido de manter tudo dentro do schema estrito principal quando possível, só saindo pra chamada separada quando o schema não suporta (caso do `intentRouter.js`).

**Testado com Groq real:** pergunta técnica ("explica o pre-roll de áudio") gerou `resposta` de 513 caracteres vs. `resposta_falada` de 180; mensagem curta ("bom dia") gerou os dois campos idênticos — confirma que o modelo só resume quando há o que resumir, não corta artificialmente respostas já curtas.

## Vision engine virou processo persistente (mesmo padrão da voz)

**Decisão:** `vision/engine.py` deixou de ser spawnado uma vez por foto/ativação (`--mode capture` / `--mode gestures`, processo novo a cada chamada) e virou um processo persistente, igual `voice/wake_listener.py` e `voice/speak_server.py` já eram: sobe uma vez e fica de pé lendo comandos JSON do stdin (`{"cmd": "capture", "show": true}`, `{"cmd": "start_gestures", "show": true}`, `{"cmd": "stop_gestures"}`). Camera (`CameraSource`) e `HandDetector` (modelo MediaPipe) são criados uma vez só no boot do processo e ficam vivos entre comandos — nunca mais fecham/recarregam sozinhos. `vision/interface/visionService.js` trocou o "spawna e mata a cada chamada" por um `ensureEngineProcess()` (mesmo formato do `ensureSpeakProcess()` de `voiceService.js`): sobe o processo na primeira chamada, reaproveita depois. `stopGestureRecognition()` não mata mais o processo — só manda `stop_gestures`, o loop de gestos para mas o processo (e a câmera) continuam quentes pro próximo comando.

**Por quê:** usuário reportou lentidão — primeira conexão demorada, conexões seguintes "ainda um pouco lentas", câmera "demora séculos" pra ativar. Medido nesta máquina: `capture()` a frio (processo novo, import do mediapipe, carregamento do modelo ~7.5MB, abertura da câmera) levava **~28 segundos**; a mesma chamada com o processo já quente (câmera já aberta, modelo já carregado) leva **~11-20 milissegundos** — a diferença inteira era custo de import/inicialização pago do zero a cada chamada, não trabalho de visão de verdade. Mesmo diagnóstico e mesma correção já validados antes pra `wake_listener.py` (stub do sklearn) e `speak_server.py` (processo persistente) — só nunca tinha sido aplicado à visão.

**Trade-off deliberado:** a câmera fica aberta (luz acesa) depois do primeiro uso, até o processo do Kevin encerrar — não solta mais sozinha entre chamadas. Sem release automático por inatividade por enquanto (`ponytail:` no código); se isso incomodar na prática, o próximo passo é um timer que solta a câmera após N segundos sem comando.

**Pre-warm no boot:** `visionService.prewarm()` sobe o processo (paga os ~28s de import/modelo) sem abrir a câmera nem esperar comando — chamado no boot do Kevin (`index.js` e `simulateWakeWordConversation.js`), escondendo esse custo antes de qualquer usuário pedir uma foto de verdade, em vez de pagar isso na cara do primeiro `/foto`.

**Testado com câmera real:** captura #1 (fria) 28.386ms; captura #2 (mesmo processo) 11ms; sessão de gestos start/stop preserva o mesmo PID; captura #3 depois de uma sessão de gestos, 20ms — confirma que o processo e a câmera seguem quentes através de múltiplos tipos de chamada, não só chamadas repetidas do mesmo tipo.

## Supressão de ruído no áudio gravado (sem PyTorch)

**Decisão:** `voice/wake_listener.py` roda `noisereduce.reduce_noise(y=audio, sr=16000, stationary=True)` em cima do áudio gravado, logo antes de `save_wav()` — spectral gating clássico (não a variante acelerada por PyTorch da mesma lib, que fica atrás de um extra `[pytorch]` opcional, deliberadamente não instalado). `stationary=True` assume ruído de fundo mais ou menos constante (ventilador, ruído elétrico) sem precisar de uma amostra separada só de ruído — cenário mais comum de casa/escritório.

**Por quê PyTorch ficou de fora:** usuário confirmou que o alvo de deploy é **Raspberry Pi 3B** especificamente (1GB RAM). PyTorch não tem wheel oficial confiável pra essa arquitetura (ver seção abaixo sobre risco maior de compatibilidade). `noisereduce` sem o extra `[pytorch]` usa só numpy/scipy — instala e roda em qualquer lugar que já roda o resto do projeto, sem essa dependência pesada. Verificado via metadata do pacote (`Requires-Dist: torch >=1.9.0 ; extra == 'pytorch'`) antes de instalar, pra não puxar torch sem querer.

**Latência medida (áudio sintético, nesta máquina — PC, não o Pi):** ~120ms por segundo de áudio (2s → 274ms, 4s → 472ms, 8s → 940ms). Pra um comando típico de poucos segundos, adiciona meio segundo antes da transcrição começar. **Não testado no Pi 3B ainda** — CPU bem mais fraca provavelmente estica isso; se ficar lento demais na prática, os ajustes são baixar `prop_decrease` (intensidade da redução, default 1.0) ou tornar a etapa opcional via `config.json`.

## Risco de compatibilidade: MediaPipe e onnxruntime em Raspberry Pi 3B

**Achado (pesquisa, não testado no hardware real ainda):** o MediaPipe (motor da visão) hoje só tem suporte oficial confiável em **Raspberry Pi OS de 64 bits** (Bookworm/Debian 12, `aarch64`) — instalação em 32 bits (`armv7l`, o padrão em imagens antigas de Pi 3) é instável ou não funciona. `onnxruntime` (motor do wake word via `openWakeWord`) também não tem wheel oficial no PyPI pra ARM32 — só builds de comunidade (ver [pi-top/onnxruntime-arm](https://github.com/pi-top/onnxruntime-arm) e [nknytk/built-onnxruntime-for-raspberrypi-linux](https://github.com/nknytk/built-onnxruntime-for-raspberrypi-linux)), instalação mais chata que `pip install` normal.

**Por quê isso importa agora:** usuário decidiu migrar o Kevin do PC pro Raspberry Pi 3B. Isso afeta **visão e wake word já existentes**, não só features novas — não é opcional resolver depois. Raspberry Pi Imager usa 64 bits por padrão pra Pi 3/4/5 desde 2022, então cartões gravados recentemente provavelmente já servem, mas isso não foi confirmado ainda (usuário respondeu "preciso conferir" — checar com `uname -m` no Pi: `aarch64` = 64 bits (ok), `armv7l` = 32 bits (mediapipe/onnxruntime problemáticos)).

**Pendente:** confirmar arquitetura do SO do Pi antes de: (a) considerar a migração "pronta pra testar", (b) decidir a abordagem de reconhecimento de locutor (verificação de voz) — modelos leves baseados em PyTorch (ex: Resemblyzer) estão descartados pelo mesmo motivo do noisereduce; a alternativa mais provável é reaproveitar o `onnxruntime` que já é dependência (via openWakeWord) com um modelo de speaker embedding exportado em ONNX, mas isso ainda não foi pesquisado/implementado. Também não validado: desempenho em tempo real do loop de gestos (mediapipe) na CPU fraca do Pi 3B (1.2GHz quad-core, sem GPU) — só a instalação foi pesquisada, não throughput.

**Limitações aceitas:** (1) heurística de "termina em `?`" é simples e perde follow-up sem interrogação (ex: "Me diz o nome do projeto."); upgrade natural é classificar com algo tipo `intentRouter.js` em vez de regex, se isso incomodar na prática. (2) não há lock entre a thread do stdin e a callback de áudio do `sounddevice` — uma corrida teórica existe (wake word real disparando no exato instante de um `LISTEN_NOW`), mas a frequência de chamada (só em resposta a uma pergunta do Kevin) e a consequência (perder alguns frames, não crashar) não justificam lock numa callback de áudio em tempo real.
