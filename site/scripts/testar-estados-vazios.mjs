// Estado VAZIO do site (v5.2): a API sem nenhum evento, projeto, dirigente ou edital — que é a
// PRODUÇÃO no dia em que o site de dados vivos entra no ar. Constrói o site contra um mock vazio
// (`build-teste.mjs --vazio`, em `dist-vazio`) e confere o que aparece e o que NÃO pode aparecer.
// Página vazia que quebra, mostra "undefined" ou promete o que não existe é o pior primeiro dia.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const construcao = spawnSync('node', ['scripts/build-teste.mjs', '--vazio'], {
  stdio: 'inherit',
})
if (construcao.status !== 0) {
  console.error('O build vazio falhou.')
  process.exit(1)
}

const lerPagina = (caminho) =>
  readFileSync(`dist-vazio${caminho}index.html`, 'utf-8')
const problemas = []
const exigir = (condicao, mensagem) => {
  if (!condicao) problemas.push(mensagem)
}

// 1. Páginas de dado vivo mostram o estado vazio (com texto útil), não uma tela em branco.
const diretoria = lerPagina('/diretoria/')
exigir(
  diretoria.includes('data-estado="vazio"'),
  '/diretoria/ sem o estado vazio',
)
exigir(
  diretoria.includes('A composição atual ainda não foi publicada'),
  '/diretoria/ sem a mensagem de composição não publicada',
)
exigir(
  diretoria.includes('Como a diretoria é composta'),
  '/diretoria/ perdeu a explicação estatutária (Arts. 19, 24, 25, 32)',
)

const projetos = lerPagina('/projetos/')
exigir(
  projetos.includes('data-estado="vazio"'),
  '/projetos/ sem o estado vazio',
)
exigir(
  projetos.includes('Ainda não há projetos publicados'),
  '/projetos/ sem a mensagem de nenhum projeto',
)

const noticias = lerPagina('/noticias/')
exigir(
  noticias.includes('data-estado="vazio"'),
  '/noticias/ sem o estado vazio',
)
exigir(
  noticias.includes('Ainda não há notícias publicadas'),
  '/noticias/ sem a mensagem de nenhuma notícia',
)
const feed = readFileSync('dist-vazio/noticias/feed.xml', 'utf-8')
exigir(
  feed.includes('<channel>') && !feed.includes('<item>'),
  '/noticias/feed.xml vazio devia ser um feed válido sem itens',
)
exigir(
  !existsSync('dist-vazio/midia'),
  'nasceu /midia/ (foto de notícia) sem haver notícia',
)

// 2. Não nasce página de recurso que não existe.
for (const pasta of [
  'eventos',
  'projetos',
  'transparencia/assembleias',
  'noticias',
]) {
  const filhas = existsSync(`dist-vazio/${pasta}`)
    ? readdirSync(`dist-vazio/${pasta}`, { withFileTypes: true }).filter((e) =>
        e.isDirectory(),
      )
    : []
  exigir(
    filhas.length === 0,
    `${pasta}/ gerou página de recurso inexistente: ${filhas.map((f) => f.name)}`,
  )
}

// 3. A home não anuncia seção vazia; a transparência não fala de edital que não existe.
exigir(
  !lerPagina('/').includes('Nossos projetos'),
  'a home mostra "Nossos projetos" sem projeto',
)
const transparencia = lerPagina('/transparencia/')
exigir(
  transparencia.includes('o Estatuto é o único documento publicado'),
  '/transparencia/ sem o aviso de que só o Estatuto está publicado',
)
exigir(
  !transparencia.includes('id="assembleias"'),
  '/transparencia/ tem a seção de editais sem haver edital',
)

// 4. Nada de "undefined"/"null"/"[object" vazando para o texto de nenhuma página.
const paginas = []
const varrer = (pasta) => {
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = `${pasta}/${e.name}`
    if (e.isDirectory()) varrer(caminho)
    else if (e.name.endsWith('.html')) paginas.push(caminho)
  }
}
varrer('dist-vazio')
for (const pagina of paginas) {
  const texto = readFileSync(pagina, 'utf-8')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
  for (const lixo of ['undefined', 'null', '[object', 'NaN']) {
    exigir(
      !new RegExp(`(^|\\s)${lixo.replace('[', '\\[')}(\\s|$)`).test(texto),
      `${pagina} mostra "${lixo}"`,
    )
  }
}

// 5. A impressão do conteúdo vazio existe e conta zero.
const conteudo = JSON.parse(readFileSync('dist-vazio/conteudo.json', 'utf-8'))
exigir(
  /^[0-9a-f]{64}$/.test(conteudo.impressao),
  'conteudo.json sem impressão válida',
)
exigir(
  Object.values(conteudo.contagem).every((n) => n === 0),
  `conteudo.json devia contar zero: ${JSON.stringify(conteudo.contagem)}`,
)

if (problemas.length > 0) {
  console.error('\nESTADO VAZIO COM PROBLEMA:')
  for (const p of problemas) console.error('  -', p)
  process.exit(1)
}
console.log(`OK: estado vazio conferido em ${paginas.length} páginas.`)
