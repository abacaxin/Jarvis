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

const FAST_MODEL = 'openai/gpt-oss-120b';

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
        summary: { type: 'string' }
      },
      required: [
        'resposta',
        'save_project',
        'project_name',
        'save_knowledge',
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
  // SINGLE UNIFIED CALL
  // ----------------------

  let decision;

  try {

    const response =
    await openai.chat.completions.create({

      model: FAST_MODEL,

      response_format: RESPONSE_SCHEMA,

      messages: [

        {
          role: 'system',

          content: `
Você é ${profile.assistant_name || 'Kevin'}, um assistente pessoal contínuo.

Você acompanha projetos, evolução e contexto do usuário.

${memoryContext}

Responda em JSON com os campos:
- resposta: sua resposta em texto natural para o usuário
- save_project: true se a mensagem descreve um projeto/ideia/sistema contínuo novo
- project_name: nome do projeto (ou null se save_project for false)
- save_knowledge: true se a mensagem contém informação técnica ou relevante para lembrar
- summary: resumo curto da mensagem (usado para salvar projeto/conhecimento)

Regras para o campo resposta:
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

    decision = JSON.parse(
      response.choices[0].message.content
    );

  } catch (erro) {

    console.log('Erro na chamada LLM:', erro);

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
  processMessage
};
