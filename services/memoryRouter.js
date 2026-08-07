const fs = require('fs-extra');

// ----------------------
// LOAD
// ----------------------

function load(path) {

  if (!fs.existsSync(path)) {

    fs.writeJsonSync(path, [], {
      spaces: 2
    });
  }

  return fs.readJsonSync(path);
}

// ----------------------
// SAVE
// ----------------------

function save(path, data) {

  fs.writeJsonSync(path, data, {
    spaces: 2
  });
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

function saveKnowledge(path, item) {

  const knowledge = load(path);

  knowledge.push({

    id: Date.now(),

    ...item
  });

  save(path, knowledge);
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

  save(path, conversations);
}

module.exports = {

  saveProject,
  saveKnowledge,
  saveConversation
};
