function timestamp() {

  return new Date().toISOString();
}

function info(msg, extra) {

  console.log(`[${timestamp()}] INFO  ${msg}`, extra !== undefined ? extra : '');
}

function warn(msg, extra) {

  console.warn(`[${timestamp()}] WARN  ${msg}`, extra !== undefined ? extra : '');
}

function error(msg, extra) {

  console.error(`[${timestamp()}] ERROR ${msg}`, extra !== undefined ? extra : '');
}

module.exports = {
  info,
  warn,
  error
};
