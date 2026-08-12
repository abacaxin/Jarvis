const OpenAI = require('openai');

// Chamada Groq SEPARADA da unica chamada estrita de processMessage()
// (core/assistantBrain.js) — mesmo raciocinio de visionAnalyzer.js e
// audioTranscriber.js: nao arrisca o schema estrito que o resto do
// Kevin depende, so classifica a intencao antes de decidir se a
// mensagem vai pro brain normal ou aciona a visao direto.
const MODEL = 'openai/gpt-oss-20b';

const INTENTS = ['chat', 'vision_activate', 'vision_capture', 'end_session'];

const INTENT_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'kevin_intent',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: INTENTS
        }
      },
      required: ['intent'],
      additionalProperties: false
    }
  }
};

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

async function classifyIntent(texto) {

  const response = await groq.chat.completions.create({

    model: MODEL,
    response_format: INTENT_SCHEMA,

    messages: [
      {
        role: 'system',

        content: `Classifique a intenção da mensagem do usuário em uma destas categorias:

- "vision_capture": pede pra tirar uma foto agora mesmo, sem gesto (ex: "capture isso", "tira uma foto", "bate uma foto agora", "fotografa isso aqui")
- "vision_activate": pede pra ativar a visão/câmera pra esperar um gesto depois (ex: "ativa a visão", "liga a câmera", "quero usar a visão")
- "end_session": pede claramente pra encerrar a conversa (ex: "obrigado, é só isso", "pode encerrar", "tchau Kevin", "já terminei", "só isso por hoje")
- "chat": qualquer outra coisa — conversa normal, pergunta, comando não relacionado a visão

Na dúvida entre vision_capture/vision_activate/end_session e chat, prefira "chat" — só classifica fora de "chat" se a intenção for clara e inequívoca.`
      },
      {
        role: 'user',
        content: texto
      }
    ]
  });

  const decision = JSON.parse(response.choices[0].message.content);
  return decision.intent;
}

module.exports = { classifyIntent, INTENTS };
