# Decisões de arquitetura

Registro de decisões técnicas tomadas ao longo do projeto e o porquê. Objetivo: quando algo parecer estranho no código daqui a 3 meses, a resposta está aqui, não precisa adivinhar.

## Groq no lugar de OpenRouter (`openrouter/free`)

**Decisão:** trocar o provider de `openrouter/free` para a API da Groq.

**Por quê:** o modelo gratuito do OpenRouter é instável (fila imprevisível, sem garantia de qualidade/disponibilidade), problema já identificado no planejamento original. Groq tem SLA mais previsível e suporta Structured Outputs (JSON Schema estrito), o que resolve o segundo problema abaixo.

**Modelos usados hoje:**
- `llama-3.3-70b-versatile` — chamada única (resposta + decisão de memória)

Trocar o modelo é uma linha em `FAST_MODEL` no topo de `core/assistantBrain.js`. Quando o Fast/Deep mode (bloco 4 do sprint) for implementado, provavelmente vira dois modelos diferentes ao invés de uma constante única.

## Uma chamada LLM em vez de duas

**Decisão:** unificar `analyzeIntent()` + geração de resposta em uma única chamada.

**Por quê:** o fluxo original fazia duas chamadas por mensagem sempre (análise de intenção + resposta final) — 2x custo, 2x latência, sem exceção. Também havia um problema crítico: se `analyzeIntent` retornasse JSON malformado, o fluxo continuava e podia salvar lixo na memória.

**Como:** a chamada única usa `response_format: { type: 'json_schema', json_schema: { strict: true, ... } }` da Groq, que garante que a resposta sempre volta no formato esperado (`resposta`, `save_project`, `project_name`, `save_knowledge`, `summary`) — elimina a necessidade de `try/catch` em volta de um `JSON.parse` torcendo pra dar certo.

## PM2 para gerenciar o processo

**Decisão:** rodar via PM2 (`ecosystem.config.js`) em vez de `node index.js` direto.

**Por quê:** restart automático em caso de crash, sem precisar de infra adicional — é a opção mais simples indicada no planejamento original para estabilidade local antes de pensar em deploy 24/7 (Railway, conforme planejamento).
