const OpenAI = require('openai');
const fs = require('fs-extra');
const logger = require('../services/logger');

const {
  saveProject,
  saveKnowledge,
  saveConversation,
  loadHistory
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
        summary: { type: 'string' }
      },
      required: [
        'resposta',
        'save_project',
        'project_name',
        'save_knowledge',
        'knowledge_category',
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
  conversationsFile

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
    .slice(-8);

    if (!items.length) return null;

    return `${cat.toUpperCase()}:\n${items
    .map(k => `- ${k.value}`)
    .join('\n')}`;
  })
  .filter(Boolean)
  .join('\n\n');

  const memoryContext = `
PROJETOS ATIVOS (use o nome EXATAMENTE como está aqui se a mensagem for sobre um deles — não crie um projeto novo com nome diferente para a mesma coisa):
${activeProjects
.map(p =>
`- ${p.name}: ${p.description}`)
.join('\n') || '(nenhum)'}

CONHECIMENTOS RECENTES (por categoria):
${knowledgeByCategory || '(nenhum)'}
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
Você é ${profile.assistant_name || 'Kevin'}, um assistente pessoal contínuo.

Você conversa com ${profile.user_name || 'o usuário'}. Trate-o pelo nome quando fizer sentido, sem forçar a cada mensagem.

Você acompanha projetos, evolução e contexto do usuário.

${memoryContext}

Responda em JSON com os campos:
- resposta: sua resposta em texto natural para o usuário
- save_project: true APENAS se a mensagem descreve ou avança um projeto/ideia/sistema contínuo real
- project_name: nome do projeto (ou null se save_project for false). Se a mensagem for sobre um projeto que já está em PROJETOS ATIVOS, use o nome EXATAMENTE igual ao que já existe — isso atualiza o projeto em vez de criar um duplicado.
- save_knowledge: true APENAS se a mensagem contém um fato técnico ou informação específica que vale lembrar depois
- knowledge_category: quando save_knowledge for true, classifique em uma dessas categorias: ${KNOWLEDGE_CATEGORIES.join(', ')} (ou null se save_knowledge for false)
- summary: resumo curto da mensagem (usado para salvar projeto/conhecimento), sempre em português

Regras importantes para save_project e save_knowledge:
- Saudações, despedidas, small talk ("bom dia", "e aí", "tudo bem?", "boa noite") NUNCA contam como projeto ou conhecimento — nesses casos ambos ficam false
- Perguntas sobre o que já existe na memória (ex: "quais projetos eu tenho?") NUNCA contam como novo projeto ou conhecimento
- Na dúvida, prefira false — é melhor deixar de salvar algo relevante do que poluir a memória com lixo

Regras para o campo resposta:
- Fale naturalmente, em português
- Seja direto
- Não pareça um chatbot genérico
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
