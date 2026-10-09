// Instituição PREENCHIDA (v5.4h): a diretoria cadastrou, no painel, dados válidos (CNPJ, telefone, e-mail, horário, redes) e marcou "vai para o site".
// Constrói o site contra a API simulada com esses dados (`build-teste.mjs --instituicao`, em `dist-instituicao`) e confere que as páginas passaram a
// mostrá-los — o contrário do estado de hoje, em que o CNPJ de exemplo da Instituição (inválido) nunca vai ao ar (isso o e2e e o `--antiga` provam).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const construcao = spawnSync(
  'node',
  ['scripts/build-teste.mjs', '--instituicao'],
  { stdio: 'inherit' },
)
if (construcao.status !== 0) {
  console.error('O build com a Instituição preenchida falhou.')
  process.exit(1)
}

const lerPagina = (caminho) =>
  readFileSync(`dist-instituicao${caminho}index.html`, 'utf-8')
const problemas = []
const exigir = (condicao, mensagem) => {
  if (!condicao) problemas.push(mensagem)
}

const NOVO = {
  cnpj: '11.222.333/0001-81',
  telefone: '(94) 99999-8888',
  telefoneLink: 'href="tel:+5594999998888"',
  email: 'contato.teste@asaf.org.br',
  horario: 'Segunda a sexta, das 8h às 17h',
  instagram: 'https://www.instagram.com/asaf.teste/',
  facebook: 'https://www.facebook.com/asaf.teste',
}
const FIXO = {
  cnpj: '17.631.942/0001-70',
  telefone: '(94) 98412-0703',
  email: 'asaf@asaf.org.br',
}

// 1. Contato: tudo o que a diretoria preencheu aparece, no lugar do texto fixo, e o horário e as redes ganham o seu bloco.
const contato = lerPagina('/contato/')
for (const [rotulo, valor] of Object.entries(NOVO)) {
  exigir(contato.includes(valor), `/contato/ não mostra ${rotulo} "${valor}"`)
}
for (const [rotulo, valor] of Object.entries(FIXO)) {
  exigir(
    !contato.includes(valor),
    `/contato/ ainda mostra o ${rotulo} fixo "${valor}"`,
  )
}
exigir(
  contato.includes('data-horario-de-atendimento'),
  '/contato/ sem o bloco do horário de atendimento',
)
exigir(contato.includes('data-redes'), '/contato/ sem o bloco das redes')
exigir(
  /<a[^>]*href="https:\/\/www\.instagram\.com\/asaf\.teste\/"[^>]*rel="noopener noreferrer"/.test(
    contato,
  ),
  '/contato/: o link do Instagram sem rel="noopener noreferrer"',
)

// 2. Rodapé (em toda página), Privacidade, Termos e Transparência: o mesmo e-mail e, onde há CNPJ, o novo.
for (const [pagina, esperados] of [
  ['/', [NOVO.email, NOVO.instagram, NOVO.facebook]],
  ['/privacidade/', [NOVO.email, NOVO.cnpj]],
  ['/termos/', [NOVO.email]],
  ['/transparencia/', [NOVO.email, NOVO.cnpj, NOVO.telefone]],
]) {
  if (!existsSync(`dist-instituicao${pagina}index.html`)) {
    exigir(false, `${pagina} não foi gerada`)
    continue
  }
  const html = lerPagina(pagina)
  for (const valor of esperados) {
    exigir(html.includes(valor), `${pagina} não mostra "${valor}"`)
  }
  for (const [rotulo, valor] of Object.entries(FIXO)) {
    exigir(!html.includes(valor), `${pagina} ainda mostra o ${rotulo} fixo`)
  }
}

// 3. Dados estruturados (Google): o JSON-LD da organização usa os dados novos e cita as redes.
const home = lerPagina('/')
const ldOrganizacao = [
  ...home.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  ),
]
  .map((m) => {
    try {
      return JSON.parse(m[1])
    } catch {
      return null
    }
  })
  .find((j) => j && (j['@type'] === 'NGO' || j.taxID))
exigir(ldOrganizacao, 'a home sem o JSON-LD da organização')
if (ldOrganizacao) {
  exigir(
    ldOrganizacao.taxID === NOVO.cnpj,
    `JSON-LD: taxID "${ldOrganizacao.taxID}" (esperado o CNPJ novo)`,
  )
  exigir(
    ldOrganizacao.email === NOVO.email,
    `JSON-LD: e-mail "${ldOrganizacao.email}"`,
  )
  exigir(
    Array.isArray(ldOrganizacao.sameAs) &&
      ldOrganizacao.sameAs.includes(NOVO.instagram) &&
      ldOrganizacao.sameAs.includes(NOVO.facebook),
    `JSON-LD: sameAs ${JSON.stringify(ldOrganizacao.sameAs)}`,
  )
}

// 4. A Instituição faz parte da impressão do conteúdo: quando a diretoria muda um dado, a sincronização reconstrói o site sozinha.
const conteudo = JSON.parse(
  readFileSync('dist-instituicao/conteudo.json', 'utf-8'),
)
exigir(
  /^[0-9a-f]{64}$/.test(conteudo.impressao),
  'conteudo.json sem impressão válida',
)
if (existsSync('dist/conteudo.json')) {
  const semInstituicao = JSON.parse(readFileSync('dist/conteudo.json', 'utf-8'))
  exigir(
    semInstituicao.impressao !== conteudo.impressao,
    'a impressão do conteúdo não mudou com a Instituição preenchida (o site não seria reconstruído)',
  )
}

if (problemas.length > 0) {
  console.error('\nINSTITUIÇÃO PREENCHIDA COM PROBLEMA:')
  for (const p of problemas) console.error('  -', p)
  process.exit(1)
}
console.log(
  'OK: com a Instituição preenchida, contato, rodapé, Privacidade, Termos, Transparência e o JSON-LD mostram os dados novos.',
)
