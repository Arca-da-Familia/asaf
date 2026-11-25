# A porta da bancada da IEADESPA

Esta pasta é a **porta**: o pouco que cada projeto da IEADESPA guarda para chegar à bancada. A bancada em si (o
instalador, o aviso de início, o servidor de memória, as habilidades, a lista `bancada.json`, as regras globais e o
**estado do trabalho** de cada projeto) mora num lugar só: o repositório privado `IEADESPA/bancada`, baixado em
`C:\MCP\bancada` em cada computador.

## Num computador novo

1. Programas: Git, Node.js 22 ou mais novo (`winget install OpenJS.NodeJS.LTS`) e o VS Code com o Claude Code, com o
   login da conta da organização. A conta do GitHub precisa de acesso ao repositório privado `IEADESPA/bancada`.
2. Dois cliques em **`INSTALAR.cmd`** (nesta pasta). Ele baixa a bancada em `C:\MCP\bancada` (o login do GitHub abre no
   navegador: quem faz é a pessoa) e chama o instalador, que **pergunta antes de cada mudança**.
   - Ou peça ao Claude: ele roda primeiro `INSTALAR.cmd -SoTestar` (só mostra o que faria), mostra a lista e, só com o
     seu sim, `INSTALAR.cmd -Sim`.
3. No VS Code: `Ctrl+Shift+P`, "Recarregar Janela".

Daí em diante, o **aviso de início** roda sozinho no começo de toda conversa, em qualquer pasta: atualiza a bancada,
mostra a linha "Em uso por" do `HANDOFF.md` do projeto (na bancada), o `git pull` que falta e o que o computador tem de
diferente da bancada.

## O que fica onde

O repositório do projeto é **público**: o estado do trabalho não vem para cá (decisão de 24/11/2026).

| O quê | Onde |
| --- | --- |
| A porta | Aqui, em `.claude/continuidade/` (`INSTALAR.cmd`, `porta.sh` e este `LEIA-ME.md`), e o gancho no `.claude/settings.json` |
| As regras do projeto | No projeto: `CLAUDE.md`, `AGENTS.md` (Codex), o código, o plano e as decisões de regra |
| O estado do trabalho | Na bancada privada, `C:\MCP\bancada\projetos\<repositório>\`: o `HANDOFF.md` (com a linha "Em uso por", uma pessoa por vez), a memória do projeto (`memoria.jsonl`) e a memória do Claude (`memoria-claude/`) |

No projeto fica só um `HANDOFF.md` curto, que aponta para a bancada. Um projeto ainda não migrado guarda o estado do
jeito antigo (o `HANDOFF.md` completo na raiz e a memória em `.claude/continuidade/memoria/`), até alguém rodar o
migrador da bancada (`C:\MCP\bancada\migrar-estado.mjs`). O histórico antigo do repositório não se apaga.

Pegar um projeto, trabalhar e devolver (com os comandos de registro na bancada), o que o instalador faz, o Codex e os
problemas comuns estão no `LEIA-ME.md` da bancada, em `C:\MCP\bancada\LEIA-ME.md`.

Modelo desta porta: `C:\MCP\bancada\porta\`. Não edite aqui: melhore na bancada (commit e push) e copie para os
projetos; o aviso de início avisa quando a porta de um projeto fica velha.
