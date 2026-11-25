# Instruções para agentes (Codex e outros)

Antes de mexer em qualquer coisa neste repositório:

1. Leia o `CLAUDE.md` (regras do projeto: homologação antes da produção, produção só se confere por leitura, MFA do painel não se remove,
   tudo na última versão estável).
2. Leia o `HANDOFF.md` da bancada privada, em `C:\MCP\bancada\projetos\asaf\HANDOFF.md` (o estado atual do trabalho, o próximo passo exato
   e a linha "Em uso por": uma pessoa por vez). Desde 24/11/2026 o estado do trabalho não vem para este repositório, que é público; o
   `HANDOFF.md` daqui só aponta para a bancada.
3. Consulte o servidor MCP `memoria-projeto` (`search_nodes` ou `read_graph`), se estiver configurado neste computador: fatos duráveis do projeto,
   regras de negócio e decisões do Presidente da ASAF. A memória vem da bancada da IEADESPA (repositório privado `IEADESPA/bancada`, em
   `C:\MCP\bancada`): num computador novo, dois cliques em `.claude\continuidade\INSTALAR.cmd` (a porta; detalhes no
   `.claude/continuidade/LEIA-ME.md`). No Codex, rode o aviso de início à mão no começo da conversa: `node C:/MCP/bancada/aviso-inicio.mjs`.
4. Confira `git status` e o ramo atual.

O que outro colaborador precisa saber vai para os documentos do repositório (`PLANO_PROJETO.md`, `DECISOES_CONGELADAS.md`, `HISTORICO.md`), não só
para a memória de um computador.

Responda ao usuário sempre em português do Brasil, em linguagem simples (ele não programa).
