# Kevin

Assistente pessoal contínuo via Telegram, com memória persistente de projetos e conhecimento entre conversas.

## Stack real

- Node.js
- `node-telegram-bot-api` — interface via Telegram (polling)
- Groq (SDK `openai`, endpoint compatível) — LLM
- `fs-extra` — memória persistida em JSON (`memory/*.json`)
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
│   ├── projects.json       → projetos identificados nas conversas
│   ├── knowledge.json      → fatos/conhecimento identificados nas conversas
│   └── conversations.json  → histórico bruto (ainda não é lido de volta — ver docs/progresso.md)
├── services/
│   └── memoryRouter.js     → load/save dos arquivos de memória
├── docs/                   → decisões de arquitetura e progresso do sprint
├── index.js                → bot Telegram, entrada principal
└── ecosystem.config.js     → config do PM2
```

## Status atual

MVP em desenvolvimento. Ver [docs/progresso.md](docs/progresso.md) para o que já foi feito e o que falta do sprint.
