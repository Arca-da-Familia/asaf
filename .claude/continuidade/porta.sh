#!/bin/bash
# A PORTA da bancada da IEADESPA neste projeto (gancho SessionStart do .claude/settings.json do projeto).
#  - Sem Node.js no computador: diz como instalar.
#  - Sem a bancada (C:\MCP\bancada): avisa "dois cliques em .claude\continuidade\INSTALAR.cmd" e pede ao Claude que
#    ofereça rodar primeiro com -SoTestar e, só com o sim da pessoa, com -Sim.
#  - Com a bancada e o aviso de início ligado no usuário (~/.claude/settings.json): fica quieta (sem aviso dobrado).
#  - Com a bancada, mas sem o gancho do usuário: roda o aviso da bancada daqui mesmo.
# Nunca impede a conversa: sai sempre com 0. Modelo: C:\MCP\bancada\porta\porta.sh (o aviso avisa quando fica velha).
# Para testes: BANCADA_BASE (no lugar de C:\MCP) e BANCADA_CASA (no lugar da pasta do usuário).
BASE="${BANCADA_BASE:-C:/MCP}"
BASE="${BASE//\\//}"
CASA="${BANCADA_CASA:-$HOME}"
AVISO="$BASE/bancada/aviso-inicio.mjs"

if ! command -v node >/dev/null 2>&1; then
  cat <<'JSON'
{"systemMessage":"Bancada: falta o Node.js neste computador. Instale com  winget install OpenJS.NodeJS.LTS  (ou em nodejs.org), feche e abra o VS Code e dê dois cliques em .claude\\continuidade\\INSTALAR.cmd.","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Porta da bancada da IEADESPA (.claude/continuidade/porta.sh): este computador não tem o Node.js. Conte à pessoa, em português simples, que ela precisa instalar o Node.js 22 ou mais novo (winget install OpenJS.NodeJS.LTS, ou em nodejs.org), fechar e abrir o VS Code e dar dois cliques em .claude\\continuidade\\INSTALAR.cmd. Depois, ofereça rodar o instalador por ela: primeiro com -SoTestar e, só com o sim dela, com -Sim."}}
JSON
  exit 0
fi

if [ ! -f "$AVISO" ]; then
  cat <<'JSON'
{"systemMessage":"Bancada: este computador ainda não tem a bancada da IEADESPA. Para instalar: dois cliques em .claude\\continuidade\\INSTALAR.cmd (ele pergunta antes de cada mudança).","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Porta da bancada da IEADESPA (.claude/continuidade/porta.sh): este computador ainda não tem a bancada (C:\\MCP\\bancada), ou seja, falta o servidor de memória, o aviso de início, as habilidades e as regras globais. Na primeira resposta, conte isso à pessoa em português simples e ofereça instalar. O jeito dela: dois cliques em .claude\\continuidade\\INSTALAR.cmd. Se ela preferir que você rode: primeiro .claude\\continuidade\\INSTALAR.cmd -SoTestar (só mostra o que faria; o login do GitHub pode abrir no navegador e quem faz é ela), mostre a lista e, SÓ com o sim dela, .claude\\continuidade\\INSTALAR.cmd -Sim. Depois: recarregar a janela do VS Code."}}
JSON
  exit 0
fi

if grep -qsF 'bancada/aviso-inicio.mjs' "$CASA/.claude/settings.json"; then
  exit 0 # o gancho do usuário já mostra o aviso de início
fi

node "$AVISO" --pela-porta || true
exit 0
