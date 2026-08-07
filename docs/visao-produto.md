# Visão de produto

> Registrado em 2026-08-07. Isso é direção de longo prazo, não escopo do MVP atual — serve pra guiar decisões de arquitetura futuras sem travar o que já está funcionando hoje.

## O que Kevin é pra ser

Um assistente pessoal no estilo "Jarvis"/"Edith" — não um chatbot genérico. Cobre todos os âmbitos da vida do usuário, mas o foco principal é ser voltado aos **projetos** dele.

Além de responder, a visão é Kevin virar um **colega/parceiro de trabalho**, participando ativamente da montagem dos projetos:

- Anotações
- Ajuda em decisões técnicas
- Revisões (de código, de escopo, de progresso)
- To-do list
- Atualizar repositório (git) em nome do usuário
- Criar prompts de ação (transformar uma ideia solta em uma tarefa executável)
- Ativar agentes de código (disparar execução, não só sugerir)

## Visão computacional (câmera nos óculos)

Fase futura: uma câmera acoplada a um óculos, dando ao agente acesso à visão do usuário em tempo real. Já consta como item no backlog `[FUTURE]` do planejamento original ("Visão computacional"), mas aqui fica explícito que a forma prevista é hardware vestível, não só upload de imagem.

## Implicações pra arquitetura (não implementar agora, só não fechar portas)

- **Ações com efeito real** (git push, disparar agente de código) exigem um nível de confirmação/permissão que hoje o bot não tem — é infra de segurança que precisa existir antes dessa fase, não depois.
- **Multiagente** (mencionado no backlog original) provavelmente é o caminho pra separar "conversar" de "executar ação no repositório/sistema" — não dá pra empilhar tudo num único LLM call como o `assistantBrain.js` faz hoje.
- **Visão computacional** é um input completamente novo (imagem/vídeo, não só texto) — quando chegar essa fase, o pipeline de mensagem em `index.js` precisa deixar de assumir `msg.text` como única entrada possível.
- Nada disso é bloqueante pro que existe hoje. A ordem certa continua sendo: fechar a base (memória, estabilidade, deploy) antes de empilhar essas camadas.

Ver [progresso.md](progresso.md) para o que está pronto e o próximo passo real.
