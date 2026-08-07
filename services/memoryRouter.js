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

function saveProject(path, project) {

  const projects = load(path);

  projects.push({

    id: Date.now(),

    ...project
  });

  save(path, projects);
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
