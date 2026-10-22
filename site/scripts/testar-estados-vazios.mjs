// Estado VAZIO do site (v5.2): a API sem nenhum evento, projeto, dirigente ou edital — que é a
// PRODUÇÃO no dia em que o site de dados vivos entra no ar. Constrói o site contra um mock vazio
// (`build-teste.mjs --vazio`, em `dist-vazio`) e confere o que aparece e o que NÃO pode aparecer.
// Página vazia que quebra, mostra "undefined" ou promete o que não existe é o pior primeiro dia.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { criarServidor } from './mock-api.mjs'

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
exigir(
  !existsSync('dist-vazio/midia/diretoria'),
  'nasceu /midia/diretoria/ (foto da Diretoria) sem haver ninguém na Diretoria',
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
// (mesmos dados, sem nenhum campo novo) e as notícias chegam sem `projeto_id`/`evento_id`/`emenda_id`.
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

// v5.7c - a API antiga também não tem a foto da Diretoria (o campo `foto` nem existe): a página constrói, cada pessoa aparece com o nome, o cargo e as INICIAIS, e não
// nasce nenhuma cópia de foto nem imagem quebrada.
const diretoriaAntiga = lerAntiga('/diretoria/')
exigir(
  diretoriaAntiga.includes('Maria de Teste da Silva') &&
    diretoriaAntiga.includes('Ana de Teste Lima'),
  'API antiga: a Diretoria perdeu as pessoas',
)
exigir(
  (diretoriaAntiga.match(/data-iniciais/g) ?? []).length === 3,
  'API antiga: as 3 pessoas da Diretoria deviam aparecer com as iniciais (sem foto)',
)
exigir(
  !diretoriaAntiga.includes('data-foto-da-diretoria') &&
    !diretoriaAntiga.includes('/midia/diretoria/'),
  'API antiga: a Diretoria mostra foto sem haver foto na API',
)
exigir(
  !existsSync('dist-antiga/midia/diretoria'),
  'API antiga: nasceu /midia/diretoria/ sem haver foto da Diretoria',
)

// v5.5d - a API antiga também não tem a situação do evento (status, motivo, data anterior): o evento que hoje está cancelado no mock vale como PROGRAMADO,
// sem aviso, sem selo e com o bloco de inscrição à vista — nunca "undefined" nem um aviso inventado.
if (existsSync('dist-antiga/eventos/10/index.html')) {
  const semSituacao = lerAntiga('/eventos/10/')
  exigir(
    semSituacao.includes('schema.org/EventScheduled') &&
      !semSituacao.includes('EventCancelled'),
    'API antiga: o evento sem situação devia sair como EventScheduled no JSON-LD',
  )
  exigir(
    /<div data-aviso-situacao[^>]*\shidden[\s>]/.test(semSituacao),
    'API antiga: o aviso da situação devia estar escondido num evento sem situação',
  )
  exigir(
    /<div data-como-participar>/.test(semSituacao),
    'API antiga: o bloco "Como participar" devia estar à mostra num evento sem situação',
  )
  exigir(
    !semSituacao.includes('undefined') && !semSituacao.includes('Motivo:'),
    'API antiga: a página do evento mostra "undefined" ou um motivo sem haver situação',
  )
} else {
  exigir(false, 'API antiga: a página /eventos/10/ não foi gerada')
}

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

// v5.5c - a inscrição em evento pelo site. As páginas dos links do e-mail (cancelar e confirmar) são estáticas e existem com a API sem nenhum dado e com a API antiga:
// fora do Google (noindex) e fora do sitemap. O formulário de inscrição só existe em evento gratuito sem pergunta de arquivo, e o TEXTO do consentimento nunca é escrito
// na página (vem da API, no navegador): com a API antiga (que ainda não tem a rota do consentimento) a página constrói do mesmo jeito.
for (const [rotulo, pasta] of [
  ['vazio', 'dist-vazio'],
  ['API antiga', 'dist-antiga'],
]) {
  for (const caminho of ['/cancelar-inscricao/', '/confirmar-inscricao/']) {
    if (!existsSync(`${pasta}${caminho}index.html`)) {
      exigir(false, `${rotulo}: ${caminho} não foi gerada`)
      continue
    }
    const html = readFileSync(`${pasta}${caminho}index.html`, 'utf-8')
    exigir(
      html.includes('name="robots" content="noindex'),
      `${rotulo}: ${caminho} sem noindex (não é página de conteúdo)`,
    )
    exigir(
      html.includes('data-inscricao-link') && html.includes('data-api-url='),
      `${rotulo}: ${caminho} sem o miolo que lê o ?token= no navegador`,
    )
    if (existsSync(`${pasta}/sitemap-0.xml`))
      exigir(
        !readFileSync(`${pasta}/sitemap-0.xml`, 'utf-8').includes(
          caminho.replaceAll('/', ''),
        ),
        `${rotulo}: ${caminho} entrou no sitemap`,
      )
  }
}
// v5.6b - a conta do visitante: página estática, fora do Google e do sitemap; entrar, pedir o código e ler a conta acontecem no navegador (a API pode estar vazia ou antiga).
for (const [rotulo, pasta] of [
  ['vazio', 'dist-vazio'],
  ['API antiga', 'dist-antiga'],
]) {
  const caminho = '/minha-conta/'
  if (!existsSync(`${pasta}${caminho}index.html`)) {
    exigir(false, `${rotulo}: ${caminho} não foi gerada`)
    continue
  }
  const html = readFileSync(`${pasta}${caminho}index.html`, 'utf-8')
  exigir(
    html.includes('name="robots" content="noindex'),
    `${rotulo}: ${caminho} sem noindex (não é página de conteúdo)`,
  )
  exigir(
    html.includes('data-conta-visitante') &&
      html.includes('data-api-url=') &&
      html.includes('data-formulario-email'),
    `${rotulo}: ${caminho} sem o miolo que pede o código e lê a conta no navegador`,
  )
  if (existsSync(`${pasta}/sitemap-0.xml`))
    exigir(
      !readFileSync(`${pasta}/sitemap-0.xml`, 'utf-8').includes('minha-conta'),
      `${rotulo}: ${caminho} entrou no sitemap`,
    )
}
for (const [caminho, formulario, rotulo] of [
  ['/eventos/2/', true, 'gratuito'],
  ['/eventos/7/', true, 'gratuito com perguntas'],
  ['/eventos/8/', true, 'gratuito com as vagas esgotadas'],
  ['/eventos/3/', false, 'com valor'],
  ['/eventos/9/', false, 'que pede um arquivo'],
  ['/eventos/1/', false, 'que já aconteceu'],
]) {
  if (!existsSync(`dist-antiga${caminho}index.html`)) {
    exigir(false, `API antiga: o evento ${rotulo} (${caminho}) não foi gerado`)
    continue
  }
  const html = lerAntiga(caminho)
  exigir(
    html.includes('data-inscricao-formulario') === formulario,
    `API antiga: o evento ${rotulo} (${caminho}) ${formulario ? 'perdeu' : 'tem'} o formulário de inscrição`,
  )
  exigir(
    !html.includes('Texto de teste do consentimento'),
    `API antiga: ${caminho} traz o texto do consentimento escrito na página (ele só pode vir da API)`,
  )
}
exigir(
  lerAntiga('/eventos/3/').includes('inscrição com valor'),
  'API antiga: o evento com valor não diz que a inscrição é com a secretaria',
)
exigir(
  lerAntiga('/eventos/9/').includes('pede o envio de um arquivo'),
  'API antiga: o evento que pede arquivo não manda falar com a secretaria',
)

// 7. v5.7c - FOTO ADULTERADA. A API serve para a Diretoria um arquivo que NÃO é o declarado (SHA-256 diferente). Diferente da foto de evento e da de etapa (que
// derrubam o build), a foto da Diretoria é a parte opcional da página: o build TEM de terminar, a página sai com todas as pessoas (nome, cargo e iniciais), nenhuma
// cópia da foto recusada vai ao ar e o motivo aparece no log do build.
const construcaoAdulterada = spawnSync(
  'node',
  ['scripts/build-teste.mjs', '--foto-adulterada'],
  { encoding: 'utf-8' },
)
const saidaDoBuild = `${construcaoAdulterada.stdout ?? ''}${construcaoAdulterada.stderr ?? ''}`
if (construcaoAdulterada.status !== 0) {
  console.error(saidaDoBuild)
  console.error(
    'O build com uma foto da Diretoria ADULTERADA falhou: uma foto recusada só pode deixar a pessoa sem foto (v5.7c).',
  )
  process.exit(1)
}
exigir(
  saidaDoBuild.includes('Foto da Diretoria NÃO publicada') &&
    saidaDoBuild.includes('não confere com a aprovada'),
  'foto adulterada: o log do build não registrou o aviso da foto recusada',
)
const diretoriaAdulterada = readFileSync(
  'dist-foto-adulterada/diretoria/index.html',
  'utf-8',
)
exigir(
  ['Maria de Teste da Silva', 'João de Teste Souza', 'Ana de Teste Lima'].every(
    (nome) => diretoriaAdulterada.includes(nome),
  ),
  'foto adulterada: alguém sumiu da página da Diretoria (só a foto podia sumir)',
)
exigir(
  (diretoriaAdulterada.match(/data-iniciais/g) ?? []).length === 3 &&
    !diretoriaAdulterada.includes('data-foto-da-diretoria'),
  'foto adulterada: as 3 pessoas deviam aparecer com as iniciais, nenhuma com a foto recusada',
)
exigir(
  !existsSync('dist-foto-adulterada/midia/diretoria'),
  'foto adulterada: a cópia da foto recusada foi publicada',
)
exigir(
  JSON.parse(readFileSync('dist-foto-adulterada/conteudo.json', 'utf-8'))
    .contagem.diretoria === 3,
  'foto adulterada: a contagem da Diretoria devia continuar 3',
)

// v5.6a - a página de DOAÇÃO é estática e existe com a API sem nenhum dado (a produção de hoje: sem chave Pix e sem campanha) e com a API antiga (que ainda não tem as rotas da
// doação). O que muda sem novo publicar (a chave Pix, o beneficiário, as campanhas, o quanto cada uma recebeu e se a doação pelo site está aberta) NUNCA é escrito na página: vem da API,
// no navegador. Aqui: a página traz a explicação honesta, as caixas de cada estado e o contato; nenhum dado ao vivo; está no sitemap; a Política é a 2.0 com o parágrafo da doação.
for (const [rotulo, ler, pasta] of [
  ['vazio', lerPagina, 'dist-vazio'],
  ['API antiga', lerAntiga, 'dist-antiga'],
]) {
  const caminho = '/como-ajudar/doar/'
  if (!existsSync(`${pasta}${caminho}index.html`)) {
    exigir(false, `${rotulo}: ${caminho} não foi gerada`)
    continue
  }
  const html = ler(caminho)
  for (const marca of [
    'data-doacao-vivo',
    'data-estado="carregando"',
    'data-estado="erro"',
    'data-estado="indisponivel"',
    'data-estado="pronto"',
    'data-tentar-de-novo',
    'name="pagina_web"',
    'Nada avisa o sistema quando você paga',
    'Não é instantâneo, e não há prazo prometido.',
    'não constitui, por si só, declaração de dedutibilidade fiscal',
    'A doação pelo site ainda não está disponível',
  ])
    exigir(html.includes(marca), `${rotulo}: ${caminho} sem "${marca}"`)
  exigir(
    !/123e4567|ASAF TESTE|PARAUAPEBAS|Campanha de teste|R\$\s*\d|DOA-\d{4}-\d/.test(
      html,
    ),
    `${rotulo}: ${caminho} traz dado ao vivo (chave Pix, beneficiário, campanha, valor ou protocolo) escrito na página`,
  )
  exigir(
    !html.includes('copia_e_cola') && !html.includes('00020126'),
    `${rotulo}: ${caminho} traz um código Pix escrito na página`,
  )
  exigir(
    html.includes('<noscript>') && html.includes('data-sem-javascript'),
    `${rotulo}: ${caminho} sem o aviso de quem está sem JavaScript`,
  )
  exigir(
    readFileSync(`${pasta}/sitemap-0.xml`, 'utf-8').includes(caminho),
    `${rotulo}: ${caminho} fora do sitemap`,
  )
  const politica = ler('/privacidade/')
  exigir(
    politica.includes('Versão 2.6') &&
      politica.includes('data-doacao') &&
      politica.includes('id="doacao-pelo-site"'),
    `${rotulo}: a Política não é a 2.0 com o parágrafo da doação`,
  )
  exigir(
    ler('/como-ajudar/').includes('href="/como-ajudar/doar/"'),
    `${rotulo}: Como ajudar não leva à página Doar`,
  )
}

// v5.6a - os MODOS da API simulada para a doação (o que o e2e e este teste assumem): `vazio` (a produção de hoje) = sem Pix e sem campanha; `semPix` = campanhas, mas Pix fechado,
// com o 503 no código Pix; API antiga = a rota não existe. Servidores em porta livre, só para ler.
async function lerDoMock(opcoes, caminho) {
  const servidor = criarServidor(opcoes)
  await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver))
  try {
    const resposta = await fetch(
      `http://127.0.0.1:${servidor.address().port}${caminho}`,
    )
    return { status: resposta.status, corpo: await resposta.json() }
  } finally {
    await new Promise((resolver) => servidor.close(resolver))
  }
}
const doacaoVazia = await lerDoMock({ vazio: true }, '/api/publico/doacao')
exigir(
  doacaoVazia.corpo.pix_disponivel === false &&
    doacaoVazia.corpo.chave_pix === null &&
    doacaoVazia.corpo.campanhas.length === 0,
  'mock vazio: a doação devia estar sem Pix e sem campanha',
)
const doacaoSemPix = await lerDoMock({ semPix: true }, '/api/publico/doacao')
exigir(
  doacaoSemPix.corpo.pix_disponivel === false &&
    doacaoSemPix.corpo.chave_pix === null &&
    doacaoSemPix.corpo.campanhas.length > 0,
  'mock --sem-pix: a doação devia estar sem Pix, com as campanhas',
)
exigir(
  (await lerDoMock({ semPix: true }, '/api/publico/doacao/pix')).status === 503,
  'mock --sem-pix: o código Pix devia responder 503',
)
exigir(
  (await lerDoMock({ antiga: true }, '/api/publico/doacao')).status === 404,
  'mock antigo: a rota da doação devia responder 404',
)

if (problemas.length > 0) {
  console.error('\nESTADO VAZIO COM PROBLEMA:')
  for (const p of problemas) console.error('  -', p)
  process.exit(1)
}
console.log(
  `OK: estado vazio conferido em ${paginas.length} páginas; build contra a API antiga (sem o contexto de projeto/evento, sem a foto da Diretoria e sem as rotas da doação) e com uma foto da Diretoria adulterada conferidos; a página de doação sem dado ao vivo; os modos vazio e sem Pix do mock.`,
)
