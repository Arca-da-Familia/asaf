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
// 3a. v5.5 - Despertai e contexto do evento: sem projeto em destaque, evento, foto nem notícia ligada, NADA disso aparece
// (nem a seção de destaque da home, nem a "próxima edição", nem a pasta de fotos de evento).
const inicio = lerPagina('/')
for (const marca of [
  'data-secao="destaque"',
  'data-proximas-edicoes',
  'Em destaque',
  'Próximo evento',
]) {
  exigir(
    !inicio.includes(marca),
    `a home mostra "${marca}" sem projeto em destaque`,
  )
}
exigir(
  !existsSync('dist-vazio/midia/eventos'),
  'nasceu /midia/eventos/ (foto de evento) sem haver evento com foto',
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

// 3b. Transparência (v5.4b) sem nenhuma emenda, parcerias ou documento aprovado: a PRODUÇÃO no dia em que o módulo entra
// no ar. O texto do estado vazio das emendas é o que o usuário pediu, palavra por palavra.
const emendas = lerPagina('/transparencia/emendas/')
exigir(
  emendas.includes('data-estado="vazio"'),
  '/transparencia/emendas/ sem o estado vazio',
)
exigir(
  emendas.includes(
    'A associação ainda não recebeu recursos de emendas parlamentares.',
  ) &&
    emendas.includes(
      'Esta página será atualizada em até 24 horas após qualquer recebimento.',
    ),
  '/transparencia/emendas/ sem o texto do estado vazio dado pelo usuário',
)
exigir(
  !emendas.includes('data-lista-de-parcerias'),
  '/transparencia/emendas/ mostra a lista (e os totais) sem haver emenda',
)
exigir(
  lerPagina('/transparencia/parcerias/').includes('data-estado="vazio"'),
  '/transparencia/parcerias/ sem o estado vazio',
)
exigir(
  lerPagina('/transparencia/documentos/').includes('data-estado="vazio"'),
  '/transparencia/documentos/ sem o estado vazio',
)
exigir(
  transparencia.includes(
    'A associação ainda não recebeu recursos de emendas parlamentares.',
  ),
  '/transparencia/ sem o estado vazio das emendas',
)
exigir(
  readFileSync('dist-vazio/transparencia/dados/emendas.csv', 'utf-8')
    .trim()
    .split(/\r?\n/).length === 1,
  'emendas.csv vazio devia ter só o cabeçalho',
)
exigir(
  JSON.parse(
    readFileSync('dist-vazio/transparencia/dados/emendas.json', 'utf-8'),
  ).length === 0,
  'emendas.json vazio devia ser uma lista vazia',
)
exigir(
  !existsSync('dist-vazio/arquivos'),
  'nasceu /arquivos/ (PDF da transparência) sem haver documento aprovado',
)
for (const pasta of ['transparencia/emendas', 'transparencia/parcerias']) {
  const filhas = readdirSync(`dist-vazio/${pasta}`, {
    withFileTypes: true,
  }).filter((e) => e.isDirectory())
  exigir(filhas.length === 0, `${pasta}/ gerou página de recurso inexistente`)
}

// 3c. NENHUM dado de exemplo chega ao build de produção: o mock marca todo registro de teste com "EXEMPLO", e este
// build (a API sem nada cadastrado) não pode conter a palavra em arquivo nenhum. Site de entidade que busca
// financiamento público não exibe registro falso.
const todosOsArquivos = []
const listar = (pasta) => {
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = `${pasta}/${e.name}`
    if (e.isDirectory()) listar(caminho)
    else todosOsArquivos.push(caminho)
  }
}
listar('dist-vazio')
for (const arquivo of todosOsArquivos) {
  if (!/\.(html|csv|json|xml|txt|js|css)$/.test(arquivo)) continue
  exigir(
    !readFileSync(arquivo, 'utf-8').includes('EXEMPLO'),
    `${arquivo} contém "EXEMPLO": dado de teste no build de produção`,
  )
  // A faixa do ambiente de TESTE (homologação) nunca pode existir no build de produção, nem noindex por causa dela.
  exigir(
    !readFileSync(arquivo, 'utf-8').includes('AMBIENTE DE TESTE') &&
      !readFileSync(arquivo, 'utf-8').includes('data-ambiente="homologacao"'),
    `${arquivo} traz a faixa do ambiente de TESTE no build de produção`,
  )
}

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

// 6. v5.5 - API ANTIGA. O site e a API são publicados juntos: se o build do site ler a API ANTES de ela ter o contexto de
// projeto/evento (destaque, edições, relatórios, fotos, projeto no evento), o site TEM que construir do mesmo jeito, só
// sem as seções novas — nunca quebrar o deploy nem mostrar bloco vazio. O mock `--antiga` responde como a API antiga
// (mesmos dados, sem nenhum campo novo) e as notícias chegam sem `projeto_id`/`evento_id`.
const construcaoAntiga = spawnSync(
  'node',
  ['scripts/build-teste.mjs', '--antiga'],
  { stdio: 'inherit' },
)
if (construcaoAntiga.status !== 0) {
  console.error(
    'O build contra a API ANTIGA falhou: o site não pode depender dos campos novos da API (v5.5).',
  )
  process.exit(1)
}
const lerAntiga = (caminho) =>
  readFileSync(`dist-antiga${caminho}index.html`, 'utf-8')
const homeAntiga = lerAntiga('/')
for (const marca of [
  'data-secao="destaque"',
  'data-proximas-edicoes',
  'Em destaque',
  'Próximo evento',
]) {
  exigir(
    !homeAntiga.includes(marca),
    `API antiga: a home mostra "${marca}" (não há destaque na API antiga)`,
  )
}
exigir(
  homeAntiga.includes('Nossos projetos'),
  'API antiga: a home perdeu "Nossos projetos"',
)
for (const [caminho, rotulo] of [
  ['/projetos/3/', 'a página do projeto'],
  ['/projetos/1/', 'a página do projeto de reforço'],
  ['/eventos/4/', 'a página do evento'],
  ['/eventos/2/', 'a página do evento avulso'],
  ['/noticias/noticia-de-teste-ligada-ao-projeto/', 'a página da notícia'],
]) {
  exigir(
    existsSync(`dist-antiga${caminho}index.html`),
    `API antiga: ${rotulo} (${caminho}) não foi gerada`,
  )
  if (!existsSync(`dist-antiga${caminho}index.html`)) continue
  const html = lerAntiga(caminho)
  for (const marca of [
    'data-secao=',
    'data-projeto-do-evento',
    'data-ligacoes-da-noticia',
    'Faz parte do projeto',
    'Outras edições',
    'Fotos do evento',
  ]) {
    exigir(
      !html.includes(marca),
      `API antiga: ${caminho} mostra "${marca}" sem haver dado`,
    )
  }
}
exigir(
  !existsSync('dist-antiga/midia/eventos'),
  'API antiga: nasceu /midia/eventos/ sem haver foto de evento',
)

// v5.4h - API antiga também não tem a rota da Instituição (404): o site constrói com os dados fixos do Estatuto, sem buraco.
const contatoAntiga = lerAntiga('/contato/')
for (const fixo of [
  '17.631.942/0001-70',
  '(94) 98412-0703',
  'asaf@asaf.org.br',
]) {
  exigir(
    contatoAntiga.includes(fixo),
    `API antiga: o contato perdeu o dado fixo "${fixo}"`,
  )
}
exigir(
  !contatoAntiga.includes('data-horario-de-atendimento') &&
    !contatoAntiga.includes('data-redes'),
  'API antiga: o contato mostra horário/redes sem haver dado da Instituição',
)

// v5.5a - os formulários da fila única de atendimento são HTML estático: existem com a API sem nenhum dado e com a API antiga (que ainda não tem a rota). O PRAZO
// de resposta nunca é escrito na página: vem da API, no navegador (a página sem ele só deixa o texto de fora). v5.5b: o pedido para ser voluntário também.
for (const [caminho, tipo] of [
  ['/contato/', 'CONTATO'],
  ['/transparencia/pedido-de-informacao/', 'PEDIDO_INFORMACAO'],
  ['/privacidade/solicitacao-do-titular/', 'TITULAR_LGPD'],
  ['/seja-voluntario/', 'VOLUNTARIO'],
]) {
  for (const [rotulo, ler] of [
    ['vazio', lerPagina],
    ['API antiga', lerAntiga],
  ]) {
    if (
      !existsSync(
        `${rotulo === 'vazio' ? 'dist-vazio' : 'dist-antiga'}${caminho}index.html`,
      )
    ) {
      exigir(false, `${rotulo}: ${caminho} não foi gerada`)
      continue
    }
    const html = ler(caminho)
    exigir(
      html.includes('data-atendimento-form') &&
        html.includes(`data-tipo="${tipo}"`),
      `${rotulo}: ${caminho} sem o formulário de atendimento do tipo ${tipo}`,
    )
    exigir(
      !html.includes('Respondemos em até'),
      `${rotulo}: ${caminho} traz um prazo escrito na página (ele só pode vir da API)`,
    )
    if (tipo === 'VOLUNTARIO') {
      // o voluntariado: data de nascimento (obrigatória) e CPF (opcional), sem assunto; e a página não diz mais que é preciso ser associado
      exigir(
        html.includes('name="data_nascimento"') &&
          html.includes('type="date"') &&
          html.includes('CPF (opcional)'),
        `${rotulo}: ${caminho} sem a data de nascimento e o CPF opcional do voluntariado`,
      )
      exigir(
        !html.includes('name="assunto"'),
        `${rotulo}: ${caminho} pede o assunto (o voluntariado não tem assunto)`,
      )
      exigir(
        html.includes('Como você gostaria de ajudar e quando tem tempo?'),
        `${rotulo}: ${caminho} sem o rótulo do campo de mensagem do voluntariado`,
      )
      exigir(
        html.includes('para ser voluntário não é preciso ser associado') &&
          !html.includes('usa o cadastro de associados'),
        `${rotulo}: ${caminho} com o texto antigo da escala (ou sem o novo)`,
      )
    }
  }
}

if (problemas.length > 0) {
  console.error('\nESTADO VAZIO COM PROBLEMA:')
  for (const p of problemas) console.error('  -', p)
  process.exit(1)
}
console.log(
  `OK: estado vazio conferido em ${paginas.length} páginas; build contra a API antiga (sem o contexto de projeto/evento) conferido.`,
)
