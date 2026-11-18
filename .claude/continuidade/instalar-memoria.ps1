# Instala a memória de continuidade (servidor MCP de memória) neste computador.
# Uso, no PowerShell, na pasta deste arquivo:
#   powershell -ExecutionPolicy Bypass -File .\instalar-memoria.ps1
# Rodar de novo não estraga nada. Kit de 17/11/2026.

$ErrorActionPreference = 'Stop'
$destino = 'C:\MCP'
$versao = '2.1.1'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Falta o Node.js. Instale com:  winget install OpenJS.NodeJS.LTS'
    Write-Host 'Depois feche e abra o PowerShell e rode este instalador de novo.'
    exit 1
}

# 1. O kit e o programa de partida em C:\MCP.
$kit = Join-Path $destino 'continuidade'
New-Item -ItemType Directory -Force (Join-Path $destino 'memorias') | Out-Null
New-Item -ItemType Directory -Force $kit | Out-Null
if ((Resolve-Path $PSScriptRoot).Path -ne (Resolve-Path $kit).Path) {
    Copy-Item (Join-Path $PSScriptRoot '*') $kit -Force
}
Copy-Item (Join-Path $kit 'iniciar-memoria.mjs') $destino -Force

# 2. O servidor de memória, com versão fixa.
Write-Host "Instalando o servidor de memória $versao em $destino..."
npm install --prefix $destino --save-exact --no-fund --no-audit "@modelcontextprotocol/server-memory@$versao"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'A instalação do servidor falhou: veja a mensagem acima (internet? permissão?).'
    exit 1
}

# 3. O registro no Claude Code: o comando do terminal ou o da extensão do VS Code.
$claude = (Get-Command claude -ErrorAction SilentlyContinue).Source
if (-not $claude) {
    $claude = Get-ChildItem "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-*\resources\native-binary\claude.exe" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName
}
if (-not $claude) {
    Write-Host 'Não achei o Claude Code. Instale a extensão do VS Code e rode de novo.'
    exit 1
}
# No PowerShell 5.1, a saída de erro de um programa vira erro fatal com 'Stop': a
# resposta "não registrado" de um computador novo pararia o instalador.
$ErrorActionPreference = 'Continue'
& $claude mcp get memoria-projeto *> $null
$jaRegistrado = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if ($jaRegistrado) {
    Write-Host 'O servidor memoria-projeto já estava registrado no Claude Code.'
} else {
    & $claude mcp add --scope user memoria-projeto -- node "$destino\iniciar-memoria.mjs"
    if ($LASTEXITCODE -ne 0) { Write-Host 'O registro no Claude Code falhou.'; exit 1 }
}

# 4. As regras globais, só se ainda não houver.
$regras = Join-Path $env:USERPROFILE '.claude\CLAUDE.md'
if (Test-Path $regras) {
    Write-Host "Você já tem regras globais em ${regras}: não mexi."
    Write-Host "Se quiser, junte a elas o conteúdo de $kit\regras-globais.md."
} else {
    New-Item -ItemType Directory -Force (Split-Path $regras) | Out-Null
    Copy-Item (Join-Path $kit 'regras-globais.md') $regras
    Write-Host "Regras globais instaladas em $regras."
}

Write-Host ''
Write-Host 'Pronto. No VS Code: Ctrl+Shift+P, "Recarregar Janela". Depois, numa conversa nova'
Write-Host 'do Claude, digite /mcp: deve aparecer memoria-projeto conectado.'
