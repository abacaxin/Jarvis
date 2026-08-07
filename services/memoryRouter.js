const fs = require('fs-extra');
const logger = require('./logger');

const MAX_KNOWLEDGE = 300;
const MAX_CONVERSATIONS = 500;

// ----------------------
// LOAD
// ----------------------

function load(path) {

  if (!fs.existsSync(path)) {

    fs.writeJsonSync(path, [], {
      spaces: 2
    });

    return [];
  }

  try {

    return fs.readJsonSync(path);

  } catch (erro) {

    logger.warn(
      `Arquivo de memoria corrompido, resetando: ${path}`,
      erro.message
    );

    fs.writeJsonSync(path, [], {
      spaces: 2
    });

    return [];
  }
}

// ----------------------
// SAVE
// ----------------------

function save(path, data) {

  try {

    fs.writeJsonSync(path, data, {
      spaces: 2
    });

  } catch (erro) {

    logger.error(
      `Falha ao salvar memoria: ${path}`,
      erro
    );
  }
}

// ----------------------
// PROJECTS
// ----------------------

function normalizeName(name) {

  return (name || '')
  .trim()
  .toLowerCase();
}

function saveProject(path, project) {

  const projects = load(path);

  const existing = projects.find(p =>
    p.status !== 'done' &&
    normalizeName(p.name) === normalizeName(project.name)
  );

  if (existing) {

    existing.description =
    project.description ||
    existing.description;

    existing.updated_at = new Date();

    existing.history =
    existing.history || [];

    existing.history.push({
      raw: project.raw,
      summary: project.description,
      at: new Date()
    });

    save(path, projects);

    return existing;
  }

  const novo = {

    id: Date.now(),

    ...project,

    updated_at: new Date(),

    history: [{
      raw: project.raw,
      summary: project.description,
      at: new Date()
    }]
  };

  projects.push(novo);

  save(path, projects);

  return novo;
}

// ----------------------
// KNOWLEDGE
// ----------------------

function normalizeValue(value) {

  return (value || '')
  .trim()
  .toLowerCase();
}

function saveKnowledge(path, item) {

  const knowledge = load(path);

  const existing = knowledge.find(k =>
    normalizeValue(k.value) === normalizeValue(item.value)
  );

  if (existing) {

    existing.updated_at = new Date();
    existing.hits = (existing.hits || 1) + 1;

    save(path, knowledge);

    return existing;
  }

  knowledge.push({

    id: Date.now(),

    ...item,

    updated_at: new Date(),
    hits: 1
  });

  const trimmed = knowledge.length > MAX_KNOWLEDGE
    ? knowledge.slice(knowledge.length - MAX_KNOWLEDGE)
    : knowledge;

  save(path, trimmed);

  return trimmed[trimmed.length - 1];
}

// ----------------------
// CONVERSATIONS
// ----------------------

function saveConversation(
  path,
  user,
  assistant
) {

  const conversations =
  load(path);

  conversations.push({

    timestamp: new Date(),

    user,
    assistant
  });

  const trimmed = conversations.length > MAX_CONVERSATIONS
    ? conversations.slice(conversations.length - MAX_CONVERSATIONS)
    : conversations;

  save(path, trimmed);
}

function loadHistory(path, turns = 10) {

  const conversations = load(path);

  return conversations
  .slice(-turns)
  .flatMap(c => [
    { role: 'user', content: c.user },
    { role: 'assistant', content: c.assistant }
  ]);
}

module.exports = {

  saveProject,
  saveKnowledge,
  saveConversation,
  loadHistory
};
