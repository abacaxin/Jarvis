# Deploy — Raspberry Pi 3B (local)

**Atualização 2026-08-12:** o alvo real de deploy é um Raspberry Pi 3B local (quarto), não Railway. O Railway foi usado por um tempo como teste de deploy 24/7 e depois **removido** do painel — não está mais conectado a este repositório, não redeploya mais em `git push`. A seção abaixo fica só como histórico.

## Deploy real: Raspberry Pi 3B

Ainda não formalizado passo a passo (o Pi hospeda mais que o Kevin — é o hub central da casa, ver [visao-produto.md](visao-produto.md) e [hub/README.md](../hub/README.md)). O que já se sabe:

- **Confirmar arquitetura do SO antes de tudo**: `uname -m` no Pi — precisa ser `aarch64` (64 bits). Visão (MediaPipe) e wake word (onnxruntime) têm suporte problemático em `armv7l` (32 bits). Ver [decisoes.md](decisoes.md), seção "Risco de compatibilidade".
- PM2 (`ecosystem.config.js`) continua fazendo sentido no Pi — ao contrário do Railway, aqui não existe plataforma cuidando de restart automático por fora.
- O hub (`hub/server.js`) roda como processo separado do bot (`npm run hub:start`), os dois de pé ao mesmo tempo no Pi.
- Vision (`vision/`) e voice (`voice/`) têm dependências Python (`pip install -r vision/requirements.txt`, `voice/requirements.txt`) que precisam ser instaladas no Pi — não vêm com `npm install`.

## Histórico: Railway (removido)

Foi usado brevemente como deploy 24/7 de teste antes da decisão de ir para o Pi. Ficam registrados aqui os detalhes técnicos, caso o Railway volte a ser cogitado no futuro (ex: como fallback caso o Pi fique fora do ar):

- Free tier, deploy direto do GitHub, zero config — `package.json` já tem `"start": "node index.js"`, Railway detecta Node via Nixpacks sozinho.
- Variáveis de ambiente (`TOKEN`, `GROQ_API_KEY`) via aba **Variables** no painel.
- PM2 não é necessário lá — a plataforma reinicia o processo sozinha em crash.
- **Cuidado se reativar**: se o bot local (PM2) ficar ativo ao mesmo tempo que uma instância no Railway, os dois brigam pelo `polling` do mesmo `TOKEN` do Telegram.
