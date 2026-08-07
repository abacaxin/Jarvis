# Deploy 24/7 — Railway

Conforme decidido no planejamento original: Railway free tier, deploy direto do GitHub, zero config. PM2 não é necessário no Railway — a plataforma já reinicia o processo sozinha em caso de crash. `ecosystem.config.js` é só para rodar local.

## Pré-requisitos já prontos no repo

- `package.json` tem `"start": "node index.js"` — Railway detecta Node automaticamente via Nixpacks, sem configuração extra
- `.env.example` documenta as variáveis necessárias (`TOKEN`, `GROQ_API_KEY`)
- `.gitignore` já exclui `.env` e os arquivos de memória pessoal

## Passo a passo

1. **Criar o repositório no GitHub** (ainda não existe remote configurado neste projeto)
   - Repositório privado é a opção recomendada, já que a memória local do bot tem dados pessoais (mesmo não indo pro git, é o mesmo projeto)
2. **Push do código**
   ```bash
   git remote add origin <url-do-repo>
   git push -u origin master
   ```
3. **No Railway** ([railway.app](https://railway.app)):
   - New Project → Deploy from GitHub repo → selecionar o repositório
   - Em Variables, adicionar `TOKEN` e `GROQ_API_KEY` (os mesmos valores do seu `.env` local)
   - Railway builda e sobe sozinho a partir do `npm start`
4. **Confirmar que subiu**: checar os logs no painel do Railway — deve aparecer a linha `INFO Kevin online.` do logger

## Depois do primeiro deploy

- Cada `git push` na branch conectada faz redeploy automático
- Se o bot local (rodando via PM2) continuar ativo ao mesmo tempo que o do Railway, os dois vão tentar fazer `polling` no mesmo `TOKEN` do Telegram e vão brigar pelas mensagens — **parar o PM2 local** (`pm2 stop kevin`) antes de considerar o Railway a instância "oficial"

## O que falta decidir antes desse passo

Isso ainda depende de uma ação sua: criar o repositório no GitHub (ou me passar a URL de um que já exista) e criar a conta/projeto no Railway — login em serviço externo não é algo que o Kevin (o assistente, não o bot 😄) faz sozinho.
