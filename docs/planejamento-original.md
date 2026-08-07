# Jarvis — Planejamento MVP
> Documentação completa da sessão de análise e planejamento

---

## Repositório

**GitHub:** https://github.com/abacaxin/Jarvis  
**Stack:** JavaScript (100%)  
**Interface:** Telegram Bot (node-telegram-bot-api)  
**LLM Provider:** OpenRouter  
**Fase atual:** MVP

### Estrutura de pastas

```
Jarvis/
├── core/
│   └── assistantBrain.js
├── memory/
│   ├── profile.json
│   ├── projects.json
│   ├── knowledge.json
│   └── conversations.json
├── services/
│   └── memoryRouter.js
├── index.js
├── package.json
└── .gitignore
```

---

## Lista de afazeres (backlog completo)

### [CORE]
- [ ] FAST MODE
- [ ] DEEP MODE
- [ ] Streaming de resposta
- [ ] Unificar resposta + análise em uma chamada

### [MEMORY]
- [ ] Remover dependência de conversations.json
- [ ] Transformar knowledge em fatos úteis compactos
- [ ] Separar knowledge por categorias
- [ ] Criar relevância de memória
- [ ] Criar memória contextual inteligente
- [ ] Projetos ativos/pausados/concluídos
- [ ] Cache RAM de memória
- [ ] Compactação automática de memória

### [PERSONALITY]
- [ ] Melhorar prompt estilo Alfred
- [ ] Consistência de personalidade
- [ ] Humor contextual leve
- [ ] Continuidade entre sessões

### [PERFORMANCE]
- [ ] Reduzir contexto enviado
- [ ] Remover JSON gigante do prompt
- [ ] Troca dinâmica de modelos
- [ ] Sistema de resposta rápida
- [ ] Streaming/edit message Telegram

### [INFRA]
- [ ] PM2
- [ ] Logs
- [ ] Diagnóstico do sistema
- [ ] Error handling
- [ ] Auto backup de memória

### [FUTURE]
- [ ] Multiagente
- [ ] Voice mode
- [ ] Controle do PC
- [ ] Visão computacional
- [ ] Planejamento autônomo

---

## Análise do código atual

### `index.js`
- Inicializa o bot Telegram via polling
- Escuta mensagens e chama `processMessage()`
- Passa os 4 arquivos JSON como parâmetro a cada mensagem
- **Problema:** não tem `sendChatAction('typing')` — bot parece morto enquanto processa
- **Problema:** erro é logado mas não tem estrutura de log real

### `core/assistantBrain.js`
- `analyzeIntent(texto)` — primeira chamada LLM, retorna JSON com flags de intenção
- `processMessage()` — segunda chamada LLM, gera a resposta final
- **Problema crítico:** 2 chamadas LLM por mensagem sempre, sem exceção
- **Problema crítico:** `conversations.json` é salvo mas **nunca lido de volta** — o bot não tem histórico real de conversa
- **Problema:** `knowledge.slice(-20)` é um band-aid — cresce infinitamente e vira ruído
- **Problema:** modelo usado é `openrouter/free` — instável, fila imprevisível
- **Problema:** se `analyzeIntent` retornar JSON malformado, o fluxo continua e pode salvar lixo

### `services/memoryRouter.js`
- Funções simples de load/save em JSON
- `saveProject`, `saveKnowledge`, `saveConversation`
- Só salva, nunca carrega para uso real no contexto
- Arquivos crescem indefinidamente sem compactação

---

## Diagnóstico — Problemas por prioridade

### 🔴 Críticos
| Problema | Impacto |
|---|---|
| 2 chamadas LLM por mensagem | 2x custo, 2x latência em toda mensagem |
| Histórico de conversa não existe | Bot esquece o que foi dito na mesma sessão |
| `conversations.json` nunca lido | Salva dados sem usar |
| Modelo `openrouter/free` genérico | Instável, fila, sem garantia de qualidade |

### 🟡 Importantes
| Problema | Impacto |
|---|---|
| Knowledge cresce sem controle | Vira ruído com o tempo |
| Sem error handling estruturado | Crashes silenciosos |
| Sem histórico por sessão/chat | Sem continuidade entre usuários |

### 🟢 Deixar pra depois
- Cache RAM, compactação automática (otimização prematura no MVP)
- Multiagente, voice, visão (pós-MVP)

---

## Fast Mode / Deep Mode

### Conceito
- **Fast Mode:** padrão no dia a dia — mais fluido, humanizado, rápido
- **Deep Mode:** acionado por palavras-chave — análise crítica, raciocínio mais profundo

### Modelos (OpenRouter, gratuitos)
| Mode | Modelo |
|---|---|
| Fast | `qwen/qwen3-8b:free` |
| Deep | `deepseek/deepseek-r1:free` |

### Detecção de modo por palavra-chave

```js
const DEEP_TRIGGERS = [
  'full analysis',
  'análise completa',
  'pensamento crítico',
  'me explica a fundo',
  'analisa isso',
  '/deep'
];

function detectMode(texto) {
  const lower = texto.toLowerCase();
  return DEEP_TRIGGERS.some(t => lower.includes(t))
    ? 'deep'
    : 'fast';
}
```

- Quando Deep Mode for ativado: enviar feedback visual ao usuário (ex: `"🧠 Modo análise ativado..."`)

---

## Sprint de amanhã

### Bloco 1 — Estabilidade (30 min)
**PM2 + typing indicator**
- Instalar PM2 e configurar startup automático
- Adicionar `sendChatAction('typing')` no `index.js` antes do `processMessage`
- Testar crash recovery

```bash
npm install -g pm2
pm2 start index.js --name jarvis
pm2 save
pm2 startup
```

### Bloco 2 — Performance core (1h)
**Unificar as duas chamadas LLM**
- Reescrever `assistantBrain.js` com uma única chamada que retorna JSON estruturado
- Formato esperado da resposta unificada:

```json
{
  "resposta": "...",
  "save_project": true,
  "project_name": "Jarvis",
  "save_knowledge": false,
  "summary": "..."
}
```

- Remover `analyzeIntent()` como função separada
- Definir modelo fast mode padrão: `qwen/qwen3-8b:free`

### Bloco 3 — Contexto real (1h)
**Histórico de sessão em memória**
- Criar `sessionHistory` como `Map` keyed por `chatId`
- Passar últimas 10 mensagens no array `messages` de cada chamada
- Limitar a janela a máx 10 turnos para não estourar contexto

```js
const sessionHistory = new Map(); // chatId → [{role, content}]
```

### Bloco 4 — Fast/Deep Mode (45 min)
- Criar lista de `DEEP_TRIGGERS`
- Lógica `detectMode(texto)` retornando `'fast'` ou `'deep'`
- Mapear cada mode para modelo diferente no OpenRouter
- Feedback visual ao usuário ao acionar deep mode

---

### Resultado esperado ao fim do dia
- Bot estável com restart automático
- Resposta ~2x mais rápida (1 chamada em vez de 2)
- Memória de conversa funcionando dentro da sessão
- Fast/Deep mode operacional

---

## Infraestrutura 24/7 — Opção 0800

### Stack gratuita recomendada
```
OpenRouter (modelos :free)  →  sem custo de LLM
Railway free tier           →  sem custo de hospedagem
GitHub                      →  deploy automático via push
```

### Railway
- Free tier: ~500h/mês (suficiente pra MVP solo)
- Deploy direto do GitHub, zero config
- Node.js nativo
- Variáveis de ambiente na UI
- **PM2 não necessário** — Railway já faz restart automático
- **Melhor opção pra agora**

### Alternativas se Railway falhar
| Opção | Prós | Contras |
|---|---|---|
| Fly.io | Free tier generoso, Node.js funciona bem | CLI mais técnica |
| Koyeb | Free tier sem hibernação | Menos conhecido |
| Render | Fácil de usar | Hiberna após 15 min — ruim pra bot |
| Hostinger VPS | ~R$20/mês, controle total | Tem custo |
| Contabo VPS | Preço competitivo | Tem custo |

### Oracle Cloud Free Tier
- VM ARM 4 cores / 24GB RAM permanentemente grátis — melhor custo-benefício no longo prazo
- **Na prática:** cadastro extremamente burocrático, recusa cartão sem motivo, travamentos frequentes
- **Conclusão:** não vale a frustração no MVP

---

## Ordem de execução geral (prioridade)

```
Amanhã (sprint):
  1. Typing indicator             ← 1 linha, UX imediata
  2. PM2                          ← 5 min, estabilidade
  3. Histórico de sessão          ← ~30 min, muda tudo
  4. Unificar chamadas LLM        ← ~1h, corta latência pela metade
  5. Fast/Deep mode               ← ~45 min

Semana seguinte:
  6. Refatorar knowledge          ← base para memória inteligente
  7. Error handling + logs reais  ← robustez
  8. Deploy no Railway            ← 24/7

Futuro (pós-MVP estável):
  9. Compactação automática de memória
  10. Memória contextual com relevância
  11. Streaming de resposta no Telegram
  12. Multiagente, voice, visão computacional
```
