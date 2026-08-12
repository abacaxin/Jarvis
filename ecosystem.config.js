module.exports = {
  apps: [
    {
      name: 'kevin',
      script: 'index.js',
      autorestart: true,
      watch: false

      // Se a visao usar um venv Python (recomendado no Pi), descomente
      // e ajuste o caminho — sem isso, spawn() usa o "python3" que
      // estiver no PATH do PM2, que pode nao ser o do venv:
      // env: {
      //   VISION_PYTHON_BIN: '/home/pi/kevin/venv/bin/python3'
      // }
    },
    {
      name: 'hub',
      script: 'hub/server.js',
      autorestart: true,
      watch: false
    }
  ]
};
