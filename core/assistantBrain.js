const OpenAI = require('openai');
const fs = require('fs-extra');
const logger = require('../services/logger');

const {
  saveProject,
  saveKnowledge,
  saveConversation,
  loadHistory,
  saveTodo,
  completeTodo
} = require('../services/memoryRouter');

const HISTORY_TURNS = 10;

const KNOWLEDGE_CATEGORIES = [
  'tecnico',
  'preferencia',
  'pessoal',
  'projeto',
  'outro'
];

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

// Só openai/gpt-oss-20b e openai/gpt-oss-120b suportam response_format
// json_schema estrito na Groq (ver docs/decisoes.md) — por isso os dois
// modos usam modelos dessa família em vez de llama/qwen/deepseek.
const MODELS = {
  fast: 'openai/gpt-oss-20b',
  deep: 'openai/gpt-oss-120b'
};

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

// ----------------------
// RELEVANCIA (overlap de palavras com a mensagem atual)
// ----------------------

function tokenize(texto) {

  return (texto || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .match(/[a-z0-9]+/g) || [];
}

function relevanceScore(query, texto) {

  const queryTokens = new Set(tokenize(query));

  if (!queryTokens.size) return 0;

  const textTokens = tokenize(texto);

  if (!textTokens.length) return 0;

  const overlap = textTokens
  .filter(t => queryTokens.has(t))
  .length;

  return overlap / Math.sqrt(textTokens.length);
}

// ----------------------
// LOAD JSON
// ----------------------

function loadJSON(path, fallback = []) {

  if (!fs.existsSync(path)) {

    fs.writeJsonSync(path, fallback, {
      spaces: 2
    });

    return fallback;
  }

  try {

    return fs.readJsonSync(path);

  } catch (erro) {

    logger.warn(
      `Arquivo corrompido, usando fallback: ${path}`,
      erro.message
    );

    return fallback;
  }
}

// ----------------------
// RESPONSE SCHEMA
// ----------------------

const RESPONSE_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'kevin_response',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        resposta: { type: 'string' },
        save_project: { type: 'boolean' },
        project_name: { type: ['string', 'null'] },
        save_knowledge: { type: 'boolean' },
        knowledge_category: {
          type: ['string', 'null'],
          enum: [...KNOWLEDGE_CATEGORIES, null]
        },
        todo_action: {
          type: ['string', 'null'],
          enum: ['add', 'complete', null]
        },
        todo_text: { type: ['string', 'null'] },
        summary: { type: 'string' }
      },
      required: [
        'resposta',
        'save_project',
        'project_name',
        'save_knowledge',
        'knowledge_category',
        'todo_action',
        'todo_text',
        'summary'
      ],
      additionalProperties: false
    }
  }
};

// ----------------------
// MAIN BRAIN
// ----------------------

async function processMessage({

  texto,
  profileFile,
  projectsFile,
  knowledgeFile,
  conversationsFile,
  todosFile

}) {

  // ----------------------
  // LOAD MEMORY
  // ----------------------

  const profile =
  loadJSON(profileFile, {});

  const projects =
  loadJSON(projectsFile);

  const knowledge =
  loadJSON(knowledgeFile);

  const todos =
  loadJSON(todosFile);

  // Historico vem do disco (conversations.json), nao de um Map em RAM —
  // sobrevive a restart do processo (deploy, crash, realocacao no Railway).
  const history =
  loadHistory(conversationsFile, HISTORY_TURNS);

  // ----------------------
  // MEMORY CONTEXT
  // ----------------------

  const activeProjects = projects
  .filter(p => p.status !== 'done')
  .sort((a, b) =>
    new Date(b.updated_at || b.created_at) -
    new Date(a.updated_at || a.created_at))
  .slice(0, 15);

  const knowledgeByCategory = KNOWLEDGE_CATEGORIES
  .map(cat => {

    const items = knowledge
    .filter(k => (k.category || 'outro') === cat)
    .map(k => ({
      ...k,
      _score:
      relevanceScore(texto, k.value) +
      Math.min(k.hits || 1, 5) * 0.05
    }))
    .sort((a, b) => {

      if (b._score !== a._score) return b._score - a._score;

      // sem sinal de relevancia pra nenhum dos dois: cai pra recencia
      return new Date(b.updated_at || b.created_at) -
        new Date(a.updated_at || a.created_at);
    })
    .slice(0, 8);

    if (!items.length) return null;

    return `${cat.toUpperCase()}:\n${items
    .map(k => `- ${k.value}`)
    .join('\n')}`;
  })
  .filter(Boolean)
  .join('\n\n');

  const pendingTodos = todos
  .filter(t => t.status === 'pending')
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  .slice(0, 20);

  const memoryContext = `
PROJETOS ATIVOS (use o nome EXATAMENTE como está aqui se a mensagem for sobre um deles — não crie um projeto novo com nome diferente para a mesma coisa):
${activeProjects
.map(p =>
`- ${p.name}: ${p.description}`)
.join('\n') || '(nenhum)'}

CONHECIMENTOS RECENTES (por categoria):
${knowledgeByCategory || '(nenhum)'}

TO-DO PENDENTES (use o texto EXATAMENTE como está aqui em todo_text quando for marcar como concluído):
${pendingTodos
.map(t => `- ${t.text}`)
.join('\n') || '(nenhum)'}
`;

  // ----------------------
  // SINGLE UNIFIED CALL
  // ----------------------

  const mode = detectMode(texto);

  let decision;

  try {

    const response =
    await openai.chat.completions.create({

      model: MODELS[mode],

      response_format: RESPONSE_SCHEMA,

      messages: [

        {
          role: 'system',

          content: `
Você é ${profile.assistant_name || 'Kevin'} — um assistente pessoal no estilo Jarvis/Edith: extremamente competente, leal e direto ao ponto. Não é um chatbot genérico nem um bajulador, e nunca é subserviente.

Você conversa com ${profile.user_name || 'o usuário'}. Trate-o pelo nome quando fizer sentido, sem forçar a cada mensagem.

Personalidade (mantenha consistente em toda a conversa):
- Tom seco e confiante, com humor leve e ocasional — um comentário seco ou uma ironia sutil de vez em quando, nunca forçado em toda resposta
- Direto ao ponto, sem introduções desnecessárias tipo "Como posso ajudar você hoje?" ou "Estou aqui para ajudar!"
- Trata o usuário como um parceiro competente que já entende do assunto, não alguém que precisa de tudo explicado do zero
- Puxa o tom pelo usuário: se ele brincar, pode acompanhar; se ele for sério/técnico, fica sério/técnico junto

Você acompanha projetos, evolução e contexto do usuário.

${memoryContext}

Responda em JSON com os campos:
- resposta: sua resposta em texto natural para o usuário
- save_project: true APENAS se a mensagem TRAZ informação nova sobre um projeto (decisão, progresso, mudança de escopo) — perguntas sobre o status/andamento do projeto NÃO contam, mesmo que a resposta relembre detalhes dele
- project_name: nome do projeto (ou null se save_project for false). Se a mensagem for sobre um projeto que já está em PROJETOS ATIVOS, use o nome EXATAMENTE igual ao que já existe — isso atualiza o projeto em vez de criar um duplicado.
- save_knowledge: true APENAS se a mensagem contém um fato técnico ou informação específica que vale lembrar depois
- knowledge_category: quando save_knowledge for true, classifique em uma dessas categorias: ${KNOWLEDGE_CATEGORIES.join(', ')} (ou null se save_knowledge for false)
- todo_action: "add" se a mensagem descreve uma tarefa nova e acionável que o usuário quer que você acompanhe; "complete" se a mensagem indica que uma tarefa da lista TO-DO PENDENTES foi concluída; null se não for nem uma coisa nem outra
- todo_text: quando todo_action for "add", o texto da tarefa nova (curto, acionável); quando for "complete", o texto EXATAMENTE igual ao item correspondente em TO-DO PENDENTES; null se todo_action for null
- summary: resumo curto da mensagem (usado para salvar projeto/conhecimento), sempre em português

Regras importantes para save_project, save_knowledge e todo_action:
- Saudações, despedidas, small talk ("bom dia", "e aí", "tudo bem?", "boa noite") NUNCA contam como projeto, conhecimento ou tarefa — nesses casos todos ficam false/null
- Perguntas sobre o que já existe na memória (ex: "quais projetos eu tenho?", "o que falta na minha lista?") NUNCA contam como novo projeto, conhecimento ou tarefa — apenas responda usando o que já está no contexto acima
- Só marque todo_action "complete" se conseguir identificar com confiança qual item da lista TO-DO PENDENTES o usuário quer dizer; se não tiver certeza, deixe null e pergunte na resposta
- Na dúvida, prefira false/null — é melhor deixar de salvar algo relevante do que poluir a memória com lixo

Regras para o campo resposta:
- Fale em português, seguindo a personalidade descrita acima
- Considere a continuidade da conversa (histórico abaixo, se houver)
`
        },

        ...history,

        {
          role: 'user',
          content: texto
        }
      ]
    });

    decision = JSON.parse(
      response.choices[0].message.content
    );

  } catch (erro) {

    logger.error('Erro na chamada LLM', erro);

    return 'Deu ruim aqui do meu lado, tenta de novo.';
  }

  // ----------------------
  // SAVE PROJECT
  // ----------------------

  if (decision.save_project) {

    saveProject(projectsFile, {

      name:
      decision.project_name ||
      'Projeto sem nome',

      description:
      decision.summary,

      raw: texto,

      status: 'active',

      created_at:
      new Date()
    });
  }

  // ----------------------
  // SAVE KNOWLEDGE
  // ----------------------

  if (decision.save_knowledge) {

    saveKnowledge(knowledgeFile, {

      type: 'auto',

      category:
      decision.knowledge_category || 'outro',

      value:
      decision.summary,

      raw: texto,

      created_at:
      new Date()
    });
  }

  // ----------------------
  // TODO
  // ----------------------

  if (decision.todo_action === 'add' && decision.todo_text) {

    saveTodo(todosFile, decision.todo_text);

  } else if (decision.todo_action === 'complete' && decision.todo_text) {

    completeTodo(todosFile, decision.todo_text);
  }

  // ----------------------
  // SAVE CONVERSATION
  // ----------------------

  saveConversation(
    conversationsFile,
    texto,
    decision.resposta
  );

  return decision.resposta;
}

module.exports = {
  processMessage,
  detectMode
};
