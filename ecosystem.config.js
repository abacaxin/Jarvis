module.exports = {
  apps: [
    {
      name: 'kevin',
      script: 'index.js',
      autorestart: true,
      watch: false,

      // Sem isso, spawn() usa o "python3" que estiver no PATH do PM2 —
      // que e o do sistema, sem mediapipe (instalado só no venv). Ajuste
      // o caminho se o seu venv nao estiver em <repo>/venv.
      env: {
        VISION_PYTHON_BIN: '/home/softh/kevin/venv/bin/python3'
      }
    },
    {
      name: 'hub',
      script: 'hub/server.js',
      autorestart: true,
      watch: false
    }
  ]
};
