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

- [x] **Bloco 4 — Fast/Deep mode**: `DEEP_TRIGGERS` + `detectMode(texto)` em `core/assistantBrain.js`. Fast usa `openai/gpt-oss-20b`, Deep usa `openai/gpt-oss-120b` (os únicos dois modelos Groq com `json_schema` estrito — mantém a garantia do Bloco 2 nos dois modos). Feedback visual ("🧠 Modo análise ativado...") enviado em `index.js` antes do typing indicator quando o modo deep é detectado.

**Sprint original 100% concluído** (blocos 1 a 5 do plano).

- [x] **Refatorar `knowledge.json`**: schema ganhou `category` (`tecnico`, `preferencia`, `pessoal`, `projeto`, `outro`, classificado pelo próprio LLM na chamada única). `saveKnowledge` agora faz dedup por valor normalizado (repetir o mesmo fato só incrementa `hits`, não duplica) e o arquivo tem teto de 300 entradas (trim automático das mais antigas). O prompt mostra os conhecimentos agrupados por categoria, até 8 por categoria — teto fixo independente de quanto o arquivo cresça.
- [x] **Error handling estruturado + logs reais**: `services/logger.js` (timestamp + nível) substitui `console.log` solto. `index.js` ganhou handlers de `uncaughtException`/`unhandledRejection` (loga e sai — PM2 reinicia limpo em vez de estado indefinido). `memoryRouter.js` e `assistantBrain.js` não crasham mais se um arquivo de memória estiver com JSON corrompido — logam warning e resetam pro fallback.
- [x] `conversations.json` também ganhou teto (500 entradas).

## Pendente

- [ ] Deploy 24/7 (Railway, conforme planejamento original) — ver [deploy.md](deploy.md)
- [ ] Múltiplos `chatId` compartilham os mesmos arquivos de memória (`profile.json`, `projects.json`...) — ok pra uso solo, vira bug se mais de uma pessoa usar o bot

## Bloqueado / precisa de ação externa

- `.env` local ainda não foi criado — falta `TOKEN` (Telegram) e `GROQ_API_KEY` (Groq) pra rodar e testar de fato. Nenhum bloco foi testado em execução real ainda, só verificado por sintaxe (`node -c`).
