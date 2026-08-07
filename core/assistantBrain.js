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
  conversationsFile,
  history = []

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

  const activeProjects = projects
  .filter(p => p.status !== 'done')
  .sort((a, b) =>
    new Date(b.updated_at || b.created_at) -
    new Date(a.updated_at || a.created_at))
  .slice(0, 15);

  const memoryContext = `
PROJETOS ATIVOS (use o nome EXATAMENTE como está aqui se a mensagem for sobre um deles — não crie um projeto novo com nome diferente para a mesma coisa):
${activeProjects
.map(p =>
`- ${p.name}: ${p.description}`)
.join('\n') || '(nenhum)'}

CONHECIMENTOS RECENTES:
${knowledge
.slice(-20)
.map(k =>
`- ${k.value}`)
.join('\n') || '(nenhum)'}
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

Você conversa com ${profile.user_name || 'o usuário'}. Trate-o pelo nome quando fizer sentido, sem forçar a cada mensagem.

Você acompanha projetos, evolução e contexto do usuário.

${memoryContext}

Responda em JSON com os campos:
- resposta: sua resposta em texto natural para o usuário
- save_project: true APENAS se a mensagem descreve ou avança um projeto/ideia/sistema contínuo real
- project_name: nome do projeto (ou null se save_project for false). Se a mensagem for sobre um projeto que já está em PROJETOS ATIVOS, use o nome EXATAMENTE igual ao que já existe — isso atualiza o projeto em vez de criar um duplicado.
- save_knowledge: true APENAS se a mensagem contém um fato técnico ou informação específica que vale lembrar depois
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
