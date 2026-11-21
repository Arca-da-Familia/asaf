# A porta da bancada da IEADESPA

Esta pasta é a **porta**: o pouco que cada projeto da IEADESPA guarda para chegar à bancada. A bancada em si (o
instalador, o aviso de início, o servidor de memória, as habilidades, a lista `bancada.json` e as regras globais) mora
num lugar só: o repositório privado `IEADESPA/bancada`, baixado em `C:\MCP\bancada` em cada computador.

## Num computador novo

1. Programas: Git, Node.js 22 ou mais novo (`winget install OpenJS.NodeJS.LTS`) e o VS Code com o Claude Code, com o
   login da conta da organização.
2. Dois cliques em **`INSTALAR.cmd`** (nesta pasta). Ele baixa a bancada em `C:\MCP\bancada` (o login do GitHub abre no
   navegador: quem faz é a pessoa) e chama o instalador, que **pergunta antes de cada mudança**.
   - Ou peça ao Claude: ele roda primeiro `INSTALAR.cmd -SoTestar` (só mostra o que faria), mostra a lista e, só com o
     seu sim, `INSTALAR.cmd -Sim`.
3. No VS Code: `Ctrl+Shift+P`, "Recarregar Janela".

Daí em diante, o **aviso de início** roda sozinho no começo de toda conversa, em qualquer pasta: atualiza a bancada,
mostra a linha "Em uso por" do `HANDOFF.md`, o `git pull` que falta e o que o computador tem de diferente da bancada.

## O que fica no projeto

| O quê | Onde |
| --- | --- |
| A porta | `.claude/continuidade/` (`INSTALAR.cmd`, `porta.sh` e este `LEIA-ME.md`) e o gancho no `.claude/settings.json` |
| A memória do projeto | `.claude/continuidade/memoria/<repositório>.jsonl` (servidor `memoria-projeto`) |
| A memória do Claude | `.claude/continuidade/memoria-claude/` (quando o projeto tem) |
| As regras do projeto | `CLAUDE.md`, `AGENTS.md` (Codex) e `HANDOFF.md` (com a linha "Em uso por") |

Os detalhes (o que o instalador faz, o Codex e os problemas comuns) estão no `LEIA-ME.md` da bancada, em
`C:\MCP\bancada\LEIA-ME.md`.

Modelo desta porta: `C:\MCP\bancada\porta\`. Não edite aqui: melhore na bancada (commit e push) e copie para os
projetos; o aviso de início avisa quando a porta de um projeto fica velha.
