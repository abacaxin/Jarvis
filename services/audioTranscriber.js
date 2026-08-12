const fs = require('fs');
const OpenAI = require('openai');

// Whisper na Groq e modelo de PRODUCAO (diferente do modelo de visao,
// que e Preview — ver docs/decisoes.md). Turbo: mais rapido/barato,
// suficiente pra conversa casual em portugues.
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1'
});

async function transcribeAudio(audioPath) {

  const response = await groq.audio.transcriptions.create({

    file: fs.createReadStream(audioPath),
    model: TRANSCRIPTION_MODEL,
    language: 'pt'
  });

  return response.text;
}

module.exports = { transcribeAudio };
