// Abre o servidor de memória (MCP) com um arquivo por projeto, em C:\MCP\memorias.
//
// O projeto é a pasta raiz do repositório Git em que o Claude Code (ou o Codex) foi aberto;
// fora de um repositório, a própria pasta. Ex.: "C:\sistemas vs code\construtor de igreja"
// usa C:\MCP\memorias\construtor-de-igreja.jsonl. A variável MEMORIA_PROJETO_PASTA, se
// existir, escolhe a pasta no lugar da atual.
//
// Cada abertura fica registrada em C:\MCP\aberturas.log (data, pasta e arquivo), para
// conferir qual memória cada sessão usou. Nada é escrito na saída padrão: ela é do MCP.
//
// Servidor: @modelcontextprotocol/server-memory 2.1.1 (licença MIT), instalado nesta pasta
// com versão fixa ("npm install --prefix C:\MCP"). Configurado em 17/11/2026.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

function raizDoProjeto(pasta) {
  const inicio = path.resolve(pasta);
  for (let atual = inicio; ; atual = path.dirname(atual)) {
    if (fs.existsSync(path.join(atual, ".git"))) return atual;
    if (path.dirname(atual) === atual) return inicio;
  }
}

function nomeDoArquivo(raiz) {
  const nome = path
    .basename(raiz)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // tira os acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${nome || "sem-nome"}.jsonl`;
}

const raiz = raizDoProjeto(process.env.MEMORIA_PROJETO_PASTA || process.cwd());
const arquivo = path.join(AQUI, "memorias", nomeDoArquivo(raiz));
fs.mkdirSync(path.dirname(arquivo), { recursive: true });
try {
  const quando = new Date().toLocaleString("pt-BR");
  fs.appendFileSync(path.join(AQUI, "aberturas.log"), `${quando}  ${raiz}  ->  ${arquivo}\n`);
} catch {
  // o registro é só para conferência: nunca impede a memória de abrir
}

process.env.MEMORY_FILE_PATH = arquivo;
const servidor = path.join(
  AQUI, "node_modules", "@modelcontextprotocol", "server-memory", "dist", "index.js"
);
try {
  const { main } = await import(pathToFileURL(servidor).href);
  await main();
} catch (erro) {
  process.stderr.write(
    `Não foi possível abrir o servidor de memória (${arquivo}). ` +
      `Confira se ele está instalado em ${AQUI} ("npm install --prefix C:\\MCP"). ` +
      `Detalhe técnico para os mantenedores: ${erro?.stack || erro}\n`
  );
  process.exit(1);
}
