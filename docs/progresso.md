# Progresso

Baseado no sprint definido em [planejamento-original.md](planejamento-original.md). Atualizar conforme os blocos avançam.

## Feito

- [x] **Bloco 1 — Estabilidade**
  - Typing indicator (`bot.sendChatAction('typing')`) antes de `processMessage` em `index.js`
  - PM2 configurado (`ecosystem.config.js`), processo roda como `kevin`
- [x] **Bloco 2 — Performance core**
  - Duas chamadas LLM unificadas em uma só, com JSON Schema estrito (ver [decisoes.md](decisoes.md))
  - Modelo padrão trocado para Groq (`llama-3.3-70b-versatile`) — o plano original previa `openrouter/free`/`qwen3-8b:free`, mudou de provider (ver decisoes.md)

## Pendente

- [ ] **Bloco 3 — Contexto real**: `sessionHistory` em memória (`Map` por `chatId`), últimas 10 mensagens passadas no array `messages` de cada chamada. Hoje `conversations.json` é salvo mas nunca lido de volta — Kevin não lembra da conversa dentro da própria sessão.
- [ ] **Bloco 4 — Fast/Deep mode**: `DEEP_TRIGGERS`, `detectMode(texto)`, mapear cada modo pra um modelo Groq diferente, feedback visual quando Deep Mode ativa.
- [ ] Refatorar `knowledge.json` (categorias, controle de crescimento)
- [ ] Error handling estruturado + logs reais
- [ ] Deploy 24/7 (Railway, conforme planejamento original)

## Bloqueado / precisa de ação externa

- `.env` local ainda não foi criado — falta `TOKEN` (Telegram) e `GROQ_API_KEY` (Groq) pra rodar e testar de fato. Nenhum bloco foi testado em execução real ainda, só verificado por sintaxe (`node -c`).
