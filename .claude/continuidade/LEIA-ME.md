# Memória de continuidade (opcional)

Para quem usa o Claude Code (ou o Codex) nos projetos da IEADESPA e quer que o trabalho
continue de onde parou: de uma conversa para outra, de uma conta para outra, do Claude
para o Codex.

## O que é

- **Servidor de memória** no seu computador: guarda os fatos de cada projeto, um arquivo
  por repositório, em `C:\MCP\memorias\`. É pessoal: não vai para o Git e não é
  compartilhado com ninguém.
- **`HANDOFF.md`** na raiz do repositório: o estado do seu trabalho (o que fez, o que
  falta, o próximo passo). Também é seu: o `.gitignore` não o deixa ir para o Git.
- **O repositório continua sendo a memória comum.** Decisão que os outros precisam saber
  vai para os documentos do projeto, não só para a sua memória.

## Instalar (uns 5 minutos, uma vez por computador)

1. **Node.js:** abra o PowerShell e digite `node -v`. Se não aparecer um número de
   versão, instale com `winget install OpenJS.NodeJS.LTS`, feche e abra o PowerShell.
2. **Claude Code:** a extensão do VS Code instalada e com login feito.
3. **Instalador:** no PowerShell, entre nesta pasta (`.claude\continuidade` do
   repositório) e rode:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\instalar-memoria.ps1
   ```

4. **Conferir:** no VS Code, `Ctrl+Shift+P` → "Recarregar Janela". Numa conversa nova do
   Claude, digite `/mcp`: deve aparecer `memoria-projeto` conectado.

Rodar o instalador de novo não estraga nada.

## O que o instalador faz

- Instala o servidor de memória (`@modelcontextprotocol/server-memory` 2.1.1, licença
  MIT) em `C:\MCP`, com versão fixa.
- Copia o programa de partida (`iniciar-memoria.mjs`) para `C:\MCP` e este kit para
  `C:\MCP\continuidade`. O programa escolhe a memória pela pasta do repositório aberto.
- Registra o servidor no Claude Code uma vez, para todos os projetos.
- Se você ainda não tem regras globais (`~/.claude/CLAUDE.md`), instala as da IEADESPA
  (`regras-globais.md`). Se já tem, não mexe e avisa, para você juntar à mão.

## Codex

Quem usa o Codex acrescenta ao `~/.codex/config.toml`:

```toml
[mcp_servers.memoria-projeto]
command = "node"
args = ['C:\MCP\iniciar-memoria.mjs']
```

## Problemas

- `C:\MCP\aberturas.log` mostra cada abertura do servidor: data, pasta e arquivo de
  memória.
- Se o `/mcp` não mostrar `memoria-projeto`, recarregue a janela do VS Code: o Claude só
  lê a lista de servidores quando liga.

Versão do kit: 17/11/2026.
