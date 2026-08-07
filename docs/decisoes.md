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

## PM2 para gerenciar o processo

**Decisão:** rodar via PM2 (`ecosystem.config.js`) em vez de `node index.js` direto.

**Por quê:** restart automático em caso de crash, sem precisar de infra adicional — é a opção mais simples indicada no planejamento original para estabilidade local antes de pensar em deploy 24/7 (Railway, conforme planejamento).
