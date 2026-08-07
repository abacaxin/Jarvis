const OpenAI = require('openai');
const fs = require('fs-extra');

const {
  saveProject,
  saveKnowledge,
  saveConversation
} = require('../services/memoryRouter');

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

// ----------------------
// LOAD JSON
// ----------------------

function loadJSON(path, fallback = []) {

  if (!fs.existsSync(path)) {

    fs.writeJsonSync(path, fallback, {
      spaces: 2
    });
  }

  return fs.readJsonSync(path);
}

// ----------------------
// ANALYZE INTENTION
// ----------------------

async function analyzeIntent(texto) {

  const response =
  await openai.chat.completions.create({

    model: 'llama-3.1-8b-instant',

    messages: [

      {
        role: 'system',

        content: `
Você é um sistema de análise de intenção.

Responda APENAS JSON válido.

Formato:

{
  "is_project": boolean,
  "project_name": string | null,
  "should_save_knowledge": boolean,
  "summary": string
}

Regras:
- Projetos são ideias contínuas, sistemas, construções ou desenvolvimento
- Conhecimento é informação técnica ou relevante
`
      },

      {
        role: 'user',
        content: texto
      }
    ]
  });

  try {

    return JSON.parse(
      response.choices[0].message.content
    );

  } catch {

    return {
      is_project: false,
      project_name: null,
      should_save_knowledge: false,
      summary: texto
    };
  }
}

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

  // ----------------------
  // INTENTION ENGINE
  // ----------------------

  const decision =
  await analyzeIntent(texto);

  // ----------------------
  // SAVE PROJECT
  // ----------------------

  if (decision.is_project) {

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

  if (
    decision.should_save_knowledge
  ) {

    saveKnowledge(knowledgeFile, {

      type: 'auto',

      value:
      decision.summary,

      raw: texto,

      created_at:
      new Date()
    });
  }

  // ----------------------
  // MEMORY CONTEXT
  // ----------------------

  const memoryContext = `

PROJETOS:
${projects
.map(p =>
`- ${p.name}: ${p.description}`)
.join('\n')}

CONHECIMENTOS:
${knowledge
.slice(-20)
.map(k =>
`- ${k.value}`)
.join('\n')}
`;

  // ----------------------
  // FINAL RESPONSE
  // ----------------------

  const response =
  await openai.chat.completions.create({

    model: 'llama-3.3-70b-versatile',

    messages: [

      {
        role: 'system',

        content: `
Você é ${profile.assistant_name || 'Kevin'}.

Você é um assistente pessoal contínuo.

Você acompanha projetos,
evolução e contexto do usuário.

${memoryContext}

Regras:
- Fale naturalmente
- Seja direto
- Não pareça um chatbot genérico
- Considere continuidade
`
      },

      {
        role: 'user',
        content: texto
      }
    ]
  });

  const resposta =
  response.choices[0]
  .message.content;

  // ----------------------
  // SAVE CONVERSATION
  // ----------------------

  saveConversation(
    conversationsFile,
    texto,
    resposta
  );

  return resposta;
}

module.exports = {
  processMessage
};
