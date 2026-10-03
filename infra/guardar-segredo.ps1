<#
.SYNOPSIS
  Guarda um segredo no Key Vault da ASAF SEM que ele apareça na tela, no histórico do terminal,
  em argumento de comando ou numa conversa.

.DESCRIPTION
  Para o token do Directus (v5.3 do PLANO_PROJETO.md) e para qualquer segredo que o sistema
  precise: você cola o valor numa entrada OCULTA (nada é exibido enquanto digita), o script grava
  num arquivo temporário, entrega ao Azure e apaga o arquivo. O valor nunca é impresso.

  Por que um script e não colar no chat: a conversa fica registrada, e o sistema de segurança do
  Claude Code recusa gravar segredo. O Key Vault é o lugar certo: a API e o build do site leem de lá.

.EXAMPLE
  # No terminal do VS Code (PowerShell), na pasta do projeto, já logado no Azure (az login):
  .\infra\guardar-segredo.ps1 -Nome DIRECTUS-ADMIN-TOKEN

.EXAMPLE
  .\infra\guardar-segredo.ps1 -Nome DIRECTUS-SITE-TOKEN
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('DIRECTUS-ADMIN-TOKEN', 'DIRECTUS-SITE-TOKEN')]
    [string]$Nome,

    [string]$Cofre = 'kv-asaf-arca'
)

$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host "Segredo: $Nome   (Key Vault: $Cofre)" -ForegroundColor Cyan
if ($Nome -eq 'DIRECTUS-ADMIN-TOKEN') {
    Write-Host 'Este é TEMPORÁRIO: serve só para montar a estrutura do Directus e será revogado ao fim da v5.3.'
}
else {
    Write-Host 'Este é o token SOMENTE-LEITURA que o build do site usa para ler conteúdo publicado.'
}
Write-Host 'Cole o valor e tecle Enter. Nada aparece na tela enquanto você cola - é assim mesmo.'
Write-Host ''

$seguro = Read-Host -Prompt 'Valor' -AsSecureString
if ($seguro.Length -eq 0) {
    Write-Host 'Nada foi digitado. Nada foi gravado.' -ForegroundColor Yellow
    exit 1
}

$ponteiro = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
$arquivo = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
try {
    $valor = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro).Trim()
    if ($valor.Length -lt 20) {
        Write-Host 'O valor é curto demais para ser um token (menos de 20 caracteres). Nada foi gravado.' -ForegroundColor Yellow
        exit 1
    }

    # Sem BOM e sem quebra de linha no fim: o Key Vault guarda exatamente o que está no arquivo.
    [System.IO.File]::WriteAllText($arquivo, $valor, (New-Object System.Text.UTF8Encoding($false)))

    # O valor vai por ARQUIVO (--file), nunca por argumento: argumento aparece na lista de processos.
    $resposta = az keyvault secret set --vault-name $Cofre --name $Nome --file $arquivo --query '{nome:name, versao:id}' -o json
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'O Azure recusou. Confira se você está logado (az login) e tem permissão no Key Vault.' -ForegroundColor Red
        exit 1
    }
    Write-Host ''
    Write-Host 'Gravado com sucesso (o valor não é exibido):' -ForegroundColor Green
    Write-Host $resposta
}
finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
    if (Test-Path $arquivo) {
        # Sobrescreve antes de apagar, para não deixar o token no disco.
        [System.IO.File]::WriteAllText($arquivo, ('0' * 256))
        Remove-Item $arquivo -Force
    }
    $valor = $null
}

Write-Host ''
Write-Host 'Pode fechar esta janela. Avise no chat apenas "gravei" - NÃO cole o valor no chat.'
