# Visão de produto

> Registrado em 2026-08-07. Isso é direção de longo prazo, não escopo do MVP atual — serve pra guiar decisões de arquitetura futuras sem travar o que já está funcionando hoje.

## O que Kevin é pra ser

Um assistente pessoal no estilo "Jarvis"/"Edith" — não um chatbot genérico. Cobre todos os âmbitos da vida do usuário, mas o foco principal é ser voltado aos **projetos** dele.

Além de responder, a visão é Kevin virar um **colega/parceiro de trabalho**, participando ativamente da montagem dos projetos:

- Anotações
- Ajuda em decisões técnicas
- Revisões (de código, de escopo, de progresso)
- To-do list
- Atualizar repositório (git) em nome do usuário
- Criar prompts de ação (transformar uma ideia solta em uma tarefa executável)
- Ativar agentes de código (disparar execução, não só sugerir)

## Visão computacional (câmera nos óculos)

Fase futura: uma câmera acoplada a um óculos, dando ao agente acesso à visão do usuário em tempo real. Já consta como item no backlog `[FUTURE]` do planejamento original ("Visão computacional"), mas aqui fica explícito que a forma prevista é hardware vestível, não só upload de imagem.

**Atualização 2026-08-08:** primeiro protótipo já existe (webcam + MediaPipe, ativado por `/foto`, ver `vision/README.md` e [decisoes.md](decisoes.md)) — ainda é webcam de bancada, não óculos, mas valida o pipeline (captura → descrição via Groq → injeção no `processMessage`) que a versão vestível vai reusar.

## Deploy: Raspberry Pi 3B como servidor doméstico, não Railway

**Atualização 2026-08-08:** decisão do usuário — Kevin não vai ficar 24/7 no Railway. Vai rodar local, num Raspberry Pi 3B no quarto, que serve de **hub central da casa**, não só host do Kevin.

**Atualização 2026-08-12:** serviço no Railway removido do painel. Não redeploya mais em `git push`. Fica só como histórico técnico em [deploy.md](deploy.md), caso volte a ser cogitado como fallback no futuro (ex: se o Pi ficar fora do ar).

## Hardware conectado ao Kevin (em planejamento, 2026-08-08)

Conforme descrito pelo usuário:

- **Speaker**: caixa de som Bluetooth fixa no quarto, é a saída de voz do Kevin (usa o TTS do `voice/speak_server.py`, hoje ainda só local/sem Telegram).
- **Microfone vestível**: reaproveitar os módulos Bluetooth de um fone TWS antigo pra montar um equipamento wearable (pulseira ou similar) que funcione como microfone de entrada — ainda ideia, não iniciado. É hack de hardware genuíno (reverse-engineering do módulo BT do fone, provavelmente perfil HFP/HSP) — fora do que dá pra resolver só em software.
- **Controle de luz**: ESP32 + módulo relé controlando a luz do quarto. Peças já em mãos, é o item mais concreto/pronto pra começar.
- **Arquitetura do hub**: o Raspberry Pi do quarto é o **servidor central da casa** (não só do Kevin). Múltiplas instâncias de ESP32 (luz, e futuramente outros sensores/atuadores) conectam nele via WebSocket — mesmo padrão que o usuário já conhece de outro projeto dele ("nem o Impetus faz"). Isso significa que o Pi vai rodar pelo menos dois serviços distintos: o bot do Kevin (Telegram) e um hub WebSocket que os ESP32s conectam — hoje só existe o primeiro.

## Implicações pra arquitetura (não implementar agora, só não fechar portas)

- **Ações com efeito real** (git push, disparar agente de código, ligar/desligar luz) exigem um nível de confirmação/permissão que hoje o bot não tem — é infra de segurança que precisa existir antes dessa fase, não depois. Isso vale tanto pra "commitar código" quanto pra "acender a luz por engano às 3h" — mesma categoria de risco (ação física/real disparada por LLM), tratar com o mesmo cuidado.
- **Multiagente** (mencionado no backlog original) provavelmente é o caminho pra separar "conversar" de "executar ação no repositório/sistema/casa" — não dá pra empilhar tudo num único LLM call como o `assistantBrain.js` faz hoje.
- **Hub WebSocket é um serviço separado do bot do Kevin** — não faz sentido meter lógica de ESP32/relé dentro de `index.js` ou `assistantBrain.js`. Quando isso for construído, Kevin fala com o hub (ex: via um cliente WebSocket simples ou HTTP interno), o hub fala com os ESP32s. Mantém o cérebro do Kevin sem saber os detalhes de protocolo de cada dispositivo — mesmo princípio já usado pra visão (`visionService.js` esconde o Python da visão do `assistantBrain.js`).
- **Visão computacional** é um input completamente novo (imagem/vídeo, não só texto) — o pipeline de mensagem em `index.js` já deixou de assumir `msg.text` como única entrada (ver comando `/foto`), mas ainda não existe versão vestível/óculos.
- Nada disso é bloqueante pro que existe hoje. A ordem certa continua sendo: fechar a base (memória, estabilidade) antes de empilhar essas camadas — o hub de casa é a próxima camada grande, não uma tarefa pequena.

Ver [progresso.md](progresso.md) para o que está pronto e o próximo passo real.
