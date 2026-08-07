# Progresso

Baseado no sprint definido em [planejamento-original.md](planejamento-original.md). Atualizar conforme os blocos avançam.

## Feito

- [x] **Bloco 1 — Estabilidade**
  - Typing indicator (`bot.sendChatAction('typing')`) antes de `processMessage` em `index.js`
  - PM2 configurado (`ecosystem.config.js`), processo roda como `kevin`
- [x] **Bloco 2 — Performance core**
  - Duas chamadas LLM unificadas em uma só, com JSON Schema estrito (ver [decisoes.md](decisoes.md))
  - Modelo padrão trocado para Groq (`llama-3.3-70b-versatile`) — o plano original previa `openrouter/free`/`qwen3-8b:free`, mudou de provider (ver decisoes.md)

- [x] **Bloco 3 — Contexto real**: `sessionHistory` (`Map` por `chatId`, últimas 10 trocas) implementado em `index.js`, injetado nas mensagens enviadas ao Groq em `assistantBrain.js`. Reseta ao mandar `/start`.
- [x] **Correções encontradas na análise fullstack (2026-08-07)**:
  - `saveProject` fazia só `push` — todo projeto em andamento virava uma linha nova a cada mensagem (visto em produção: "Mini robô de bancada" duplicado). Agora faz upsert por nome (case-insensitive), acumulando um `history[]` por projeto.
  - Prompt salvava small talk ("Boa noite") como projeto e conhecimento ao mesmo tempo — regras explícitas anti-falso-positivo adicionadas, e o prompt agora lista os nomes de projetos ativos pra o modelo reusar o nome exato em vez de duplicar.
  - `projects` era despejado inteiro (sem limite) em todo prompt — agora filtra só `status !== 'done'`, ordena por `updated_at` e limita a 15.
  - `profile.user_name` era carregado e nunca usado — agora entra no system prompt.
  - `memory/*.json` (dados pessoais/conversas) estava sendo versionado no git — removido do tracking (fica só local).
  - Sem `polling_error` handler e sem proteção contra resposta acima de 4096 chars (limite do Telegram) — ambos adicionados em `index.js`.

## Pendente

- [ ] **Bloco 4 — Fast/Deep mode**: `DEEP_TRIGGERS`, `detectMode(texto)`, mapear cada modo pra um modelo Groq diferente (lembrar: só `openai/gpt-oss-20b`/`120b` suportam `json_schema` estrito — ver decisoes.md), feedback visual quando Deep Mode ativa.
- [ ] Refatorar `knowledge.json` (categorias, controle de crescimento, dedup — mesmo problema que projects tinha)
- [ ] Error handling estruturado + logs reais
- [ ] Deploy 24/7 (Railway, conforme planejamento original)
- [ ] Múltiplos `chatId` compartilham os mesmos arquivos de memória (`profile.json`, `projects.json`...) — ok pra uso solo, vira bug se mais de uma pessoa usar o bot

## Bloqueado / precisa de ação externa

- `.env` local ainda não foi criado — falta `TOKEN` (Telegram) e `GROQ_API_KEY` (Groq) pra rodar e testar de fato. Nenhum bloco foi testado em execução real ainda, só verificado por sintaxe (`node -c`).
