const OpenAI = require('openai');
const fs = require('fs-extra');

// Unico modelo com suporte a imagem na Groq hoje. Status "Preview" (nao
// e um dos modelos de producao) e nao confirmado suportar json_schema
// estrito — por isso essa chamada e SEPARADA da unica chamada estrita
// do core/assistantBrain.js, nao unificada com ela (ver docs/decisoes.md).
const VISION_MODEL = 'qwen/qwen3.6-27b';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

function imageToDataUri(imagePath) {

  const buffer = fs.readFileSync(imagePath);
  const base64 = buffer.toString('base64');

  return `data:image/jpeg;base64,${base64}`;
}

async function describeImage(imagePath) {

  const dataUri = imageToDataUri(imagePath);

  const response = await groq.chat.completions.create({

    model: VISION_MODEL,

    messages: [
      {
        role: 'user',

        content: [
          {
            type: 'text',
            text: 'Descreva objetivamente o que aparece nesta imagem, em português, em até 3 frases.'
          },
          {
            type: 'image_url',
            image_url: { url: dataUri }
          }
        ]
      }
    ]
  });

  return response.choices[0].message.content;
}

module.exports = { describeImage };
