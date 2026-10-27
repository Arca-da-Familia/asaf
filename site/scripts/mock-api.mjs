// API simulada só para teste e CI (v5.0, ampliada na v5.2): responde as rotas públicas
// `/api/publico/...` com o MESMO formato da API real, na porta 4322. Existe para que o build,
// o Playwright e o Lighthouse CI testem o site SEM depender da API de produção — dependência
// externa em portão de qualidade é flakiness (a API escala a zero).
//
// Desde a v5.2 as páginas de Diretoria, Projetos, Eventos e Edital são GERADAS NO BUILD a partir da
// API: então o mock precisa estar de pé durante o `build:teste` (ver scripts/build-teste.mjs).
//
// O fetch do site é de verdade (HTTP -> JSON -> página); só o servidor é falso. Datas relativas a
// "hoje", para o teste nunca envelhecer. `vazio` simula a produção sem nenhum dado cadastrado.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

export const PORTA_DO_MOCK = Number(process.env.MOCK_API_PORT ?? 4322)

// DIRECTUS simulado (v5.3), no MESMO servidor, sob este prefixo: `DIRECTUS_URL=http://127.0.0.1:<porta>/__directus`.
// Exige o token como o Directus real exige (sem ele, 401): o teste prova que o build manda o token.
export const PREFIXO_DO_DIRECTUS = '/__directus'
export const TOKEN_DO_MOCK = 'token-de-teste-do-site'
export const ID_DA_FOTO_DE_TESTE = '11111111-1111-4111-8111-111111111111'

/** Variáveis de ambiente que apontam o site (build, sincronização) para este mock, em qualquer porta. */
export function ambienteDeTeste(porta = PORTA_DO_MOCK) {
  return {
    PUBLIC_API_URL: `http://127.0.0.1:${porta}`,
    DIRECTUS_URL: `http://127.0.0.1:${porta}${PREFIXO_DO_DIRECTUS}`,
    DIRECTUS_SITE_TOKEN: TOKEN_DO_MOCK,
    DIRECTUS_OBRIGATORIO: '1',
  }
}
// Mesmas origens que a API real libera para o site em desenvolvimento (app/main.py). `PORTA_DO_SITE_DE_TESTE` (com
// `MOCK_API_PORT`) deixa rodar o e2e em outras portas quando a 4321/4322 já estão ocupadas por outra cópia do projeto.
const PORTA_DO_SITE_DE_TESTE = Number(
  process.env.PORTA_DO_SITE_DE_TESTE ?? 4321,
)
const ORIGENS_PERMITIDAS = new Set([
  'http://127.0.0.1:4321',
  'http://localhost:4321',
  `http://127.0.0.1:${PORTA_DO_SITE_DE_TESTE}`,
  `http://localhost:${PORTA_DO_SITE_DE_TESTE}`,
])

/**
 * O "agora" do mock: o relógio, ou `MOCK_AGORA` (ISO) para reproduzir o dia em que o build rodou. As datas do mock são
 * relativas a hoje (dia inteiro); se a virada do dia (UTC) cair ENTRE o build e o teste de sincronização, a API "mudaria"
 * sozinha e o teste acusaria reconstrução sem parar — foi o que aconteceu no CI à meia-noite UTC de 2026-10-05.
 */
const agora = () =>
  process.env.MOCK_AGORA ? Date.parse(process.env.MOCK_AGORA) : Date.now()

/**
 * O instante, daqui a `dias` dias, em que são `hora` horas em Belém (UTC-3), no formato que a API real devolve: UTC, SEM fuso ("AAAA-MM-DDT22:00:00" para as 19h de Belém). É assim que o
 * painel manda e o servidor guarda; o site converte de volta para Belém ao mostrar (até a v5.7 ele lia a hora crua como local e todo evento aparecia 3 horas depois do digitado).
 */
function dataLocal(dias, hora = 19) {
  const d = new Date(agora() + dias * 86_400_000)
  const dia = d.toISOString().slice(0, 10)
  const emBelem = Date.parse(
    `${dia}T${String(hora).padStart(2, '0')}:00:00-03:00`,
  )
  return new Date(emBelem).toISOString().slice(0, 19)
}

const soData = (dias) => dataLocal(dias).slice(0, 10)

/** O projeto principal de teste (em destaque na Home). Nome neutro de propósito: nada de fato real. */
const ID_DO_PROJETO_PRINCIPAL = 3

function eventos() {
  const base = {
    descricao: null,
    categoria: 'Encontro',
    id_espaco: null,
    endereco_avulso: null,
    vagas: null,
    vagas_livres: null,
    gratuito: true,
    data_hora_fim: null,
    id_projeto: null,
    // v5.5d - a situação do evento: todo evento é "Programado", sem motivo e nunca remarcado, salvo os de teste da situação (10 a 13).
    status: 'Programado',
    motivo_status: null,
    data_hora_inicio_anterior: null,
  }
  return [
    {
      ...base,
      id_evento: 1,
      titulo: 'Evento de teste já realizado',
      data_hora_inicio: dataLocal(-30),
    },
    {
      ...base,
      id_evento: 2,
      titulo: 'Evento de teste — encontro de famílias',
      descricao: 'Descrição de teste do encontro.',
      endereco_avulso: 'Local de teste, Parauapebas',
      vagas: 40,
      vagas_livres: 12,
      data_hora_inicio: dataLocal(7),
      data_hora_fim: dataLocal(7, 21),
    },
    {
      ...base,
      id_evento: 3,
      titulo: 'Evento de teste — vagas esgotadas',
      gratuito: false,
      vagas: 10,
      vagas_livres: 0,
      data_hora_inicio: dataLocal(14),
    },
    // v5.5 - o projeto principal de teste (id 3) tem duas edições: uma passada (com relatório e fotos) e uma futura.
    {
      ...base,
      id_evento: 4,
      id_projeto: ID_DO_PROJETO_PRINCIPAL,
      titulo: 'Projeto Principal de Teste — 1ª edição',
      descricao: 'Descrição de teste da edição que já aconteceu.',
      endereco_avulso: 'Quadra de teste, Parauapebas',
      data_hora_inicio: dataLocal(-60),
      data_hora_fim: dataLocal(-60, 21),
    },
    {
      ...base,
      id_evento: 5,
      id_projeto: ID_DO_PROJETO_PRINCIPAL,
      titulo: 'Projeto Principal de Teste — 2ª edição',
      descricao: 'Descrição de teste da próxima edição.',
      data_hora_inicio: dataLocal(21),
      data_hora_fim: dataLocal(21, 22),
    },
    // Edição de OUTRO projeto (o de reforço escolar): nunca aparece na página do projeto principal.
    {
      ...base,
      id_evento: 6,
      id_projeto: 1,
      titulo: 'Edição de teste do reforço escolar',
      data_hora_inicio: dataLocal(-90),
    },
    // v5.5c - a inscrição pelo site. O 2 é o gratuito simples (duas sessões sem limite de vagas, sem perguntas) e o 3 é o pago e esgotado (a inscrição é com a
    // secretaria). O 7 é gratuito, com sessões (uma lotada) e perguntas de todos os tipos; o 8, gratuito com as vagas esgotadas (lista de espera); o 9 pede um arquivo.
    {
      ...base,
      id_evento: 7,
      titulo: 'Evento de teste — inscrição com perguntas',
      descricao: 'Descrição de teste do evento com perguntas na inscrição.',
      endereco_avulso: 'Salão de teste, Parauapebas',
      vagas: 30,
      vagas_livres: 18,
      data_hora_inicio: dataLocal(30),
      data_hora_fim: dataLocal(30, 21),
    },
    {
      ...base,
      id_evento: 8,
      titulo: 'Evento de teste — lista de espera',
      vagas: 5,
      vagas_livres: 0,
      data_hora_inicio: dataLocal(35),
    },
    {
      ...base,
      id_evento: 9,
      titulo: 'Evento de teste — pede um arquivo',
      data_hora_inicio: dataLocal(40),
    },
    // v5.5d - a SITUAÇÃO do evento. Os quatro são do projeto 1 (reforço escolar) e edições da mesma série (a cadeia 10..13): cada página mostra os outros três em
    // "Outras edições", com o selo. Ficam depois dos seis eventos que a Home mostra (ela mostra seis), de propósito: os testes que precisam deles na lista pedem a lista
    // à API e ficam só com estes (id 10 a 13).
    //   10: cancelado, com motivo. 11: adiado, com motivo (a data é a original). 12: remarcado (programado, com a data de antes e um motivo), com duas sessões.
    //   13: realizado (já aconteceu).
    {
      ...base,
      id_evento: 10,
      id_projeto: 1,
      titulo: 'Evento de teste — cancelado',
      descricao: 'Descrição de teste do evento cancelado.',
      endereco_avulso: 'Salão de teste, Parauapebas',
      status: 'Cancelado',
      motivo_status: 'O local ficou indisponível por causa da chuva.',
      vagas: 25,
      vagas_livres: 25,
      data_hora_inicio: dataLocal(60),
      data_hora_fim: dataLocal(60, 21),
    },
    {
      ...base,
      id_evento: 11,
      id_projeto: 1,
      titulo: 'Evento de teste — adiado',
      descricao: 'Descrição de teste do evento adiado.',
      status: 'Adiado',
      motivo_status:
        'Estamos aguardando a liberação do espaço pela prefeitura.',
      vagas: 20,
      vagas_livres: 20,
      data_hora_inicio: dataLocal(62),
      data_hora_fim: dataLocal(62, 21),
    },
    {
      ...base,
      id_evento: 12,
      id_projeto: 1,
      titulo: 'Evento de teste — remarcado',
      descricao: 'Descrição de teste do evento remarcado.',
      endereco_avulso: 'Quadra de teste, Parauapebas',
      status: 'Programado',
      motivo_status: 'O espaço estava ocupado na data original.',
      data_hora_inicio_anterior: dataLocal(50),
      vagas: 15,
      vagas_livres: 9,
      data_hora_inicio: dataLocal(64),
      data_hora_fim: dataLocal(64, 21),
    },
    {
      ...base,
      id_evento: 13,
      id_projeto: 1,
      titulo: 'Evento de teste — realizado',
      descricao: 'Descrição de teste do evento realizado.',
      status: 'Realizado',
      data_hora_inicio: dataLocal(-120),
      data_hora_fim: dataLocal(-120, 21),
    },
  ]
}

/** As sessões de cada evento (como a API devolve: com as vagas ocupadas e livres). */
function sessoesDoEvento(id) {
  if (id === 2)
    return [
      {
        id_sessao: 21,
        id_evento: 2,
        titulo: 'Acolhimento e boas-vindas',
        descricao: 'Recepção das famílias.',
        data_hora_inicio: dataLocal(7, 19),
        data_hora_fim: dataLocal(7, 20),
        vagas: null,
        vagas_ocupadas: 0,
        vagas_livres: null,
      },
      {
        id_sessao: 22,
        id_evento: 2,
        titulo: 'Roda de conversa',
        descricao: null,
        data_hora_inicio: dataLocal(7, 20),
        data_hora_fim: dataLocal(7, 21),
        vagas: null,
        vagas_ocupadas: 0,
        vagas_livres: null,
      },
    ]
  if (id === 12)
    return [
      {
        id_sessao: 121,
        id_evento: 12,
        titulo: 'Abertura do evento remarcado',
        descricao: null,
        data_hora_inicio: dataLocal(64, 19),
        data_hora_fim: dataLocal(64, 20),
        vagas: null,
        vagas_ocupadas: 0,
        vagas_livres: null,
      },
      {
        id_sessao: 122,
        id_evento: 12,
        titulo: 'Encerramento do evento remarcado',
        descricao: null,
        data_hora_inicio: dataLocal(64, 20),
        data_hora_fim: dataLocal(64, 21),
        vagas: null,
        vagas_ocupadas: 0,
        vagas_livres: null,
      },
    ]
  if (id === 7)
    return [
      {
        id_sessao: 71,
        id_evento: 7,
        titulo: 'Oficina da manhã',
        descricao: null,
        data_hora_inicio: dataLocal(30, 9),
        data_hora_fim: dataLocal(30, 12),
        vagas: 10,
        vagas_ocupadas: 4,
        vagas_livres: 6,
      },
      {
        id_sessao: 72,
        id_evento: 7,
        titulo: 'Oficina da tarde',
        descricao: null,
        data_hora_inicio: dataLocal(30, 14),
        data_hora_fim: dataLocal(30, 17),
        vagas: 8,
        vagas_ocupadas: 8,
        vagas_livres: 0,
      },
    ]
  return []
}

/** As perguntas do formulário de inscrição (como a API devolve: `opcoes` em CSV). Evento sem pergunta = lista vazia. */
function perguntasDoEvento(id) {
  const pergunta = (id_pergunta, ordem, enunciado, tipo, extra = {}) => ({
    id_pergunta,
    id_evento: id,
    enunciado,
    tipo,
    opcoes: null,
    obrigatoria: true,
    ordem,
    ...extra,
  })
  if (id === 7)
    return [
      pergunta(701, 1, 'Como você ficou sabendo do evento?', 'SELECAO_UNICA', {
        opcoes: 'Redes sociais,Indicação de amigo,Igreja,Outro',
      }),
      pergunta(702, 2, 'Qual é a sua idade?', 'NUMERO'),
      pergunta(703, 3, 'Qual o seu nome para o crachá?', 'TEXTO_CURTO'),
      pergunta(704, 4, 'Tem alguma restrição alimentar?', 'TEXTO_LONGO', {
        obrigatoria: false,
      }),
      pergunta(
        705,
        5,
        'Quais refeições você vai fazer no local?',
        'SELECAO_MULTIPLA',
        { opcoes: 'Café da manhã,Almoço,Jantar' },
      ),
      pergunta(706, 6, 'Data de nascimento', 'DATA', { obrigatoria: false }),
      pergunta(707, 7, 'Tamanho da camiseta', 'SELECAO_UNICA', {
        opcoes: 'PP,P,M,G,GG,XG',
        obrigatoria: false,
      }),
    ]
  if (id === 9)
    return [pergunta(901, 1, 'Envie o comprovante de residência', 'ARQUIVO')]
  return []
}

/** O mínimo de um evento nas listas de contexto (edições do projeto, cadeia de edições). */
const resumoDoEvento = (e) => ({
  id_evento: e.id_evento,
  titulo: e.titulo,
  categoria: e.categoria,
  data_hora_inicio: e.data_hora_inicio,
  data_hora_fim: e.data_hora_fim,
  endereco_avulso: e.endereco_avulso,
  status: e.status,
})

/**
 * Cadeia de edições (nova-edicao): as duas edições do projeto principal e (v5.5d) as quatro do evento em cada situação. Evento sem cadeia = só ele mesmo.
 */
const CADEIA_DE_EDICOES = {
  4: [4, 5],
  5: [4, 5],
  10: [10, 11, 12, 13],
  11: [10, 11, 12, 13],
  12: [10, 11, 12, 13],
  13: [10, 11, 12, 13],
}

/** Foto na forma pública (campos explícitos; a galeria do projeto acrescenta `id_evento`). */
const fotoPublica = (f) => ({
  id_foto: f.id_foto,
  alt: f.alt,
  largura: f.largura,
  altura: f.altura,
  tamanho: f.bytes.length,
  sha256: sha256(f.bytes),
  arquivo: `/api/publico/eventos/${f.id_evento}/fotos/${f.id_foto}`,
})

function detalheDoEvento(id) {
  const evento = eventos().find((e) => e.id_evento === id)
  if (!evento) return null
  const projeto = evento.id_projeto
    ? projetos().find((p) => p.id_projeto === evento.id_projeto)
    : null
  const contexto = {
    projeto: projeto
      ? { id_projeto: projeto.id_projeto, nome: projeto.nome }
      : null,
    edicoes: (CADEIA_DE_EDICOES[id] ?? [id]).map((i) => ({
      ...resumoDoEvento(eventos().find((e) => e.id_evento === i)),
      atual: i === id,
    })),
    documentos: documentos().filter(
      (d) => d.vinculo_tipo === 'evento' && d.vinculo_id === id,
    ),
    fotos: FOTOS_DE_EVENTO.filter((f) => f.id_evento === id).map(fotoPublica),
  }
  const sessoes = sessoesDoEvento(id)
  return { ...evento, sessoes, perguntas: perguntasDoEvento(id), ...contexto }
}

const projetos = () => [
  {
    id_projeto: 1,
    nome: 'Projeto de teste — reforço escolar',
    descricao:
      'Aulas de reforço escolar para crianças da comunidade, aos sábados pela manhã, com apoio de voluntários.',
    tipo_codigo: 'SOCIAL',
    tipo: 'Social',
    status_codigo: 'EM_EXECUCAO',
    status: 'Em execução',
    publico_alvo: 'Crianças de 6 a 12 anos',
    data_inicio: soData(-60),
    data_fim_prevista: soData(120),
    destaque: false,
  },
  {
    id_projeto: 2,
    nome: 'Projeto de teste concluído com um nome muito longo para conferir que o título não estoura o limite do Google',
    descricao: null,
    tipo_codigo: null,
    tipo: null,
    status_codigo: 'CONCLUIDO',
    status: 'Concluído',
    publico_alvo: null,
    data_inicio: soData(-400),
    data_fim_prevista: soData(-30),
    destaque: false,
  },
  // v5.5 - o projeto principal (em destaque). Descrição e nome de teste, sem nenhum fato real.
  {
    id_projeto: ID_DO_PROJETO_PRINCIPAL,
    nome: 'Projeto Principal de Teste',
    descricao:
      'Descrição de teste do projeto principal: encontros periódicos com as comunidades, em edições, com relatório e fotos de cada uma.',
    tipo_codigo: 'SOCIAL',
    tipo: 'Social',
    status_codigo: 'EM_EXECUCAO',
    status: 'Em execução',
    publico_alvo: 'Comunidades de teste',
    data_inicio: soData(-120),
    data_fim_prevista: soData(240),
    destaque: true,
  },
]

/** Detalhe do projeto: as edições (eventos Públicos dele, a mais recente primeiro), os documentos aprovados ligados a
 *  ele ou a uma edição e as fotos mais recentes (até 12). */
function detalheDoProjeto(id) {
  const projeto = projetos().find((p) => p.id_projeto === id)
  if (!projeto) return null
  const doProjeto = eventos()
    .filter((e) => e.id_projeto === id)
    .sort((a, b) => b.data_hora_inicio.localeCompare(a.data_hora_inicio))
  const idsDosEventos = doProjeto.map((e) => e.id_evento)
  return {
    ...projeto,
    eventos: doProjeto.map(resumoDoEvento),
    documentos: documentos().filter(
      (d) =>
        (d.vinculo_tipo === 'projeto' && d.vinculo_id === id) ||
        (d.vinculo_tipo === 'evento' && idsDosEventos.includes(d.vinculo_id)),
    ),
    fotos: FOTOS_DE_EVENTO.filter((f) => idsDosEventos.includes(f.id_evento))
      .sort((a, b) => b.id_foto - a.id_foto)
      .slice(0, 12)
      .map((f) => ({ ...fotoPublica(f), id_evento: f.id_evento })),
  }
}

const diretoria = () => [
  {
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    orgao: 'Diretoria Executiva',
    cargo_codigo: 'PRESIDENTE',
    cargo: 'Presidente',
    nome: 'Maria de Teste da Silva',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
    foto: fotoPublicaDaDiretoria(FOTOS_DA_DIRETORIA.PRESIDENTE),
  },
  // v7.0a: só o 2º Vice-Presidente (o 1º não publicado) - a Política mostra o 2º como o substituto do encarregado, na falta do 1º
  {
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    orgao: 'Diretoria Executiva',
    cargo_codigo: 'VICE_PRESIDENTE_2',
    cargo: '2º Vice-Presidente',
    nome: 'Pedro de Teste Alves',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
    foto: null,
  },
  {
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    orgao: 'Diretoria Executiva',
    cargo_codigo: 'SECRETARIO',
    cargo: '1º Secretário',
    nome: 'João de Teste Souza',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
    // sem foto autorizada: a página mostra as iniciais
    foto: null,
  },
  {
    orgao_codigo: 'CONSELHO_FISCAL',
    orgao: 'Conselho Fiscal',
    cargo_codigo: 'CONSELHO_FISCAL',
    cargo: 'Conselheiro Fiscal',
    nome: 'Ana de Teste Lima',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
    foto: fotoPublicaDaDiretoria(FOTOS_DA_DIRETORIA.CONSELHO_FISCAL),
  },
]

const assembleias = () => [
  {
    id_assembleia: 5,
    tipo: 'Ordinária',
    status: 'Convocada',
    pauta: 'Prestação de contas do exercício anterior.',
    local_fisico: 'Sede da ASAF, Rua Paulo Afonso, 150',
    convocada_em: dataLocal(-1, 14), // fixo no dia, como na API real (gravado uma vez)
    primeira_convocacao: dataLocal(20, 19),
    segunda_convocacao: dataLocal(20, 19).replace('T19:00', 'T19:30'),
    terceira_convocacao: dataLocal(20, 19).replace('T19:00', 'T20:00'),
    edital_texto:
      'ASAF - Associação Arca da Família\nEDITAL DE CONVOCAÇÃO PARA ASSEMBLEIA GERAL ORDINÁRIA\n\nLocal: Sede da ASAF, Rua Paulo Afonso, 150\nAssociados aptos para efeito de quórum: 12\n\nOrdem do dia:\nPrestação de contas do exercício anterior.\n',
    edital_sha256:
      'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12',
  },
]

// ---- Transparência (v5.4b): parcerias/emendas e documentos APROVADOS, como a API pública do sistema devolve.
// Todo título começa com "EXEMPLO" DE PROPÓSITO: o teste do estado vazio prova que nenhum exemplo chega ao build de
// produção (site de entidade que busca financiamento não pode exibir registro falso).
const dataIso = (dias) => soData(dias)

/** PDFs de teste: bytes pequenos, mas começam com `%PDF-` e têm o SHA-256 que a API "aprovou". */
const PDFS_DE_TESTE = {
  1: Buffer.from('%PDF-1.4\n% EXEMPLO - Estatuto Social registrado\n%%EOF\n'),
  2: Buffer.from('%PDF-1.4\n% EXEMPLO - Ata de eleicao\n%%EOF\n'),
  3: Buffer.from('%PDF-1.4\n% EXEMPLO - Plano de trabalho\n%%EOF\n'),
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Foto de etapa de teste: JPEG de verdade (800x600), como a API entrega (já regravada, sem metadado). */
const FOTO_DA_ETAPA_DE_TESTE = await sharp({
  create: { width: 800, height: 600, channels: 3, background: '#2f6f4f' },
})
  .jpeg()
  .toBuffer()

/** Estatuto TRANSCRITO (documento de formato TEXTO): o PDF registrado, com assinaturas, é um original interno e nem aparece aqui. */
const TEXTO_DO_ESTATUTO_DE_TESTE =
  'EXEMPLO – TRANSCRIÇÃO DO ESTATUTO\n\nART. 1 - A associação de teste é uma entidade civil sem fins lucrativos.\nParágrafo de teste na mesma linha.\n\nART. 2 - A associação de teste tem sede em Parauapebas.'

/** Relatório (documento de formato TEXTO) da edição passada do projeto principal de teste. */
const TEXTO_DO_RELATORIO_DE_TESTE =
  'EXEMPLO – RELATÓRIO DA 1ª EDIÇÃO DE TESTE\n\nTexto de teste do relatório da edição que já aconteceu.\n\nSegundo parágrafo de teste do relatório.'

/** v6.3a - a versão 1 (em texto, substituída) do estatuto registrado de teste: continua publicada, ligada à versão 2 (o PDF). */
const TEXTO_DO_ESTATUTO_ANTIGO_DE_TESTE =
  'EXEMPLO – ESTATUTO REGISTRADO (VERSÃO 1)\n\nTexto de teste da primeira versão do estatuto, depois substituída.'

/** v6.3b - o texto gerado das contas de teste do exercício de 2025 (o documento 7, aprovado: a mesma informação das tabelas). */
const TEXTO_DAS_CONTAS_DE_TESTE =
  'EXEMPLO – Prestação de contas do exercício 2025\n\nReceitas: R$ 1.500,00. Despesas: R$ 900,00. Resultado do exercício: R$ 600,00.'

/** v6.3c - o texto gerado do relatório anual de teste de 2025 (o documento 8, aprovado). */
const TEXTO_DO_RELATORIO_ANUAL_DE_TESTE =
  'EXEMPLO – Relatório anual de atividades 2025\n\nApresentação da diretoria\nEXEMPLO – Um ano de oficinas e de encontros com a comunidade.\n\nProjetos em andamento no ano: 1\nVoluntariado: 120,5 horas, de 8 voluntário(s)'

/** O texto de cada documento em formato TEXTO (o detalhe do documento devolve o texto; o PDF não tem). */
const TEXTOS_DE_TESTE = {
  4: TEXTO_DO_ESTATUTO_DE_TESTE,
  5: TEXTO_DO_RELATORIO_DE_TESTE,
  6: TEXTO_DO_ESTATUTO_ANTIGO_DE_TESTE,
  7: TEXTO_DAS_CONTAS_DE_TESTE,
  8: TEXTO_DO_RELATORIO_ANUAL_DE_TESTE,
}

/** v6.3a - quem aprovou a publicação (nome e cargo); o documento 3 foi aprovado por quem não tem cadastro de associado (sem nome). */
const PRESIDENTE_DE_TESTE = {
  nome: 'EXEMPLO Presidente de Teste',
  cargo: 'Presidente',
}

/** Fotos de evento de teste: JPEG de verdade (já regravado pela API, sem metadado), cada uma com o seu SHA-256. */
const jpegDeTeste = (largura, altura, cor) =>
  sharp({
    create: { width: largura, height: altura, channels: 3, background: cor },
  })
    .jpeg()
    .toBuffer()
const FOTOS_DE_EVENTO = [
  {
    id_foto: 11,
    id_evento: 4,
    alt: 'Participantes reunidos na quadra durante a 1ª edição de teste (foto de teste)',
    largura: 600,
    altura: 400,
    bytes: await jpegDeTeste(600, 400, '#145238'),
  },
  {
    id_foto: 12,
    id_evento: 4,
    alt: 'Mesa com os materiais da oficina da 1ª edição de teste (foto de teste)',
    largura: 400,
    altura: 600,
    bytes: await jpegDeTeste(400, 600, '#8a5a14'),
  },
]

/**
 * Fotos da Diretoria de teste (v5.7c): JPEG de verdade, cada um com o SHA-256 que a API declara. A da Presidente é de PÉ (300x400) e a da conselheira é
 * DEITADA (400x300), para a página provar que o círculo de proporção fixa aceita as duas. O texto alternativo é o que a API real gera ("Foto de <nome>, <cargo>").
 */
const FOTOS_DA_DIRETORIA = {
  PRESIDENTE: {
    id_foto: 21,
    alt: 'Foto de Maria de Teste da Silva, Presidente',
    largura: 300,
    altura: 400,
    bytes: await jpegDeTeste(300, 400, '#8a5a14'),
  },
  CONSELHO_FISCAL: {
    id_foto: 22,
    alt: 'Foto de Ana de Teste Lima, Conselheiro Fiscal',
    largura: 400,
    altura: 300,
    bytes: await jpegDeTeste(400, 300, '#145238'),
  },
}

/** A foto na forma pública da API (`null` = a pessoa não tem foto autorizada). */
const fotoPublicaDaDiretoria = (foto) =>
  foto
    ? {
        id_foto: foto.id_foto,
        alt: foto.alt,
        sha256: sha256(foto.bytes),
        largura: foto.largura,
        altura: foto.altura,
        arquivo: `/api/publico/diretoria/fotos/${foto.id_foto}`,
      }
    : null

const documentos = () =>
  [
    {
      id_documento: 1,
      tipo_codigo: 'ESTATUTO',
      tipo: 'Estatuto e alterações',
      titulo: 'EXEMPLO – Estatuto Social registrado',
      descricao: 'Texto de teste do estatuto.',
      data_documento: dataIso(-300),
      ano: 2024,
      versao: 2,
      vigente: true,
      grupo_versao: 'grupo-estatuto-registrado',
      paginas: 12,
      tamanho: PDFS_DE_TESTE[1].length,
      sha256: sha256(PDFS_DE_TESTE[1]),
      aprovado_em: dataIso(-20),
      formato: 'PDF',
      arquivo: '/api/publico/transparencia/documentos/1/arquivo',
    },
    {
      id_documento: 2,
      tipo_codigo: 'ATA',
      tipo: 'Ata',
      titulo: 'EXEMPLO – Ata de eleição da diretoria 2026-2028',
      descricao: null,
      data_documento: dataIso(-100),
      ano: 2026,
      versao: 1,
      vigente: true,
      aprovado_por: {
        nome: 'EXEMPLO Secretária de Teste',
        cargo: '1º Secretário',
      },
      paginas: 3,
      tamanho: PDFS_DE_TESTE[2].length,
      sha256: sha256(PDFS_DE_TESTE[2]),
      aprovado_em: dataIso(-10),
      formato: 'PDF',
      arquivo: '/api/publico/transparencia/documentos/2/arquivo',
    },
    {
      id_documento: 4,
      tipo_codigo: 'ESTATUTO',
      tipo: 'Estatuto e alterações',
      titulo: 'EXEMPLO – Estatuto Social transcrito',
      descricao: null,
      data_documento: dataIso(-400),
      ano: 2024,
      versao: 1,
      vigente: true,
      paginas: null,
      tamanho: Buffer.byteLength(TEXTO_DO_ESTATUTO_DE_TESTE, 'utf8'),
      sha256: sha256(Buffer.from(TEXTO_DO_ESTATUTO_DE_TESTE, 'utf8')),
      aprovado_em: dataIso(-3),
      formato: 'TEXTO',
      arquivo: null,
    },
    {
      id_documento: 3,
      tipo_codigo: 'PLANO_TRABALHO',
      tipo: 'Plano de trabalho',
      titulo: 'EXEMPLO – Plano de trabalho da Emenda 123/2026',
      descricao: null,
      data_documento: dataIso(-60),
      ano: 2026,
      versao: 1,
      vigente: true,
      paginas: 5,
      tamanho: PDFS_DE_TESTE[3].length,
      sha256: sha256(PDFS_DE_TESTE[3]),
      aprovado_em: dataIso(-5),
      formato: 'PDF',
      arquivo: '/api/publico/transparencia/documentos/3/arquivo',
      aprovado_por: null,
    },
    // v6.3a - a versão 1 do estatuto registrado, em texto: substituída pela versão 2 (o PDF acima), continua publicada no mesmo grupo
    {
      id_documento: 6,
      tipo_codigo: 'ESTATUTO',
      tipo: 'Estatuto e alterações',
      titulo: 'EXEMPLO – Estatuto Social registrado',
      descricao: null,
      data_documento: dataIso(-500),
      ano: 2024,
      versao: 1,
      vigente: false,
      paginas: null,
      tamanho: Buffer.byteLength(TEXTO_DO_ESTATUTO_ANTIGO_DE_TESTE, 'utf8'),
      sha256: sha256(Buffer.from(TEXTO_DO_ESTATUTO_ANTIGO_DE_TESTE, 'utf8')),
      aprovado_em: dataIso(-40),
      formato: 'TEXTO',
      arquivo: null,
      grupo_versao: 'grupo-estatuto-registrado',
    },
    // v6.3b - as contas de 2025, geradas pelo sistema e aprovadas para o site (a página das contas lê os números de /api/publico/transparencia/contas)
    {
      id_documento: 7,
      tipo_codigo: 'BALANCO',
      tipo: 'Balanço / prestação de contas anual',
      titulo: 'EXEMPLO – Prestação de contas do exercício 2025',
      descricao: null,
      data_documento: dataIso(-200),
      ano: 2025,
      versao: 1,
      vigente: true,
      paginas: null,
      tamanho: Buffer.byteLength(TEXTO_DAS_CONTAS_DE_TESTE, 'utf8'),
      sha256: sha256(Buffer.from(TEXTO_DAS_CONTAS_DE_TESTE, 'utf8')),
      aprovado_em: dataIso(-190),
      formato: 'TEXTO',
      arquivo: null,
    },
    // v6.3c - o relatório anual de 2025, gerado pelo sistema e aprovado (a página do relatório anual lê /api/publico/transparencia/relatorios-anuais)
    {
      id_documento: 8,
      tipo_codigo: 'RELATORIO_ANUAL',
      tipo: 'Relatório anual de atividades',
      titulo: 'EXEMPLO – Relatório anual de atividades 2025',
      descricao: null,
      data_documento: '2025-12-31',
      ano: 2025,
      versao: 1,
      vigente: true,
      paginas: null,
      tamanho: Buffer.byteLength(TEXTO_DO_RELATORIO_ANUAL_DE_TESTE, 'utf8'),
      sha256: sha256(Buffer.from(TEXTO_DO_RELATORIO_ANUAL_DE_TESTE, 'utf8')),
      aprovado_em: dataIso(-30),
      formato: 'TEXTO',
      arquivo: null,
    },
    // v5.5 - relatório da edição passada do projeto principal: documento aprovado, em TEXTO, ligado ao EVENTO 4.
    {
      id_documento: 5,
      tipo_codigo: 'RELATORIO_EVENTO',
      tipo: 'Relatório de evento ou de projeto',
      titulo: 'EXEMPLO – Relatório da 1ª edição do projeto principal de teste',
      descricao: null,
      data_documento: dataIso(-55),
      ano: 2026,
      versao: 1,
      vigente: true,
      paginas: null,
      tamanho: Buffer.byteLength(TEXTO_DO_RELATORIO_DE_TESTE, 'utf8'),
      sha256: sha256(Buffer.from(TEXTO_DO_RELATORIO_DE_TESTE, 'utf8')),
      aprovado_em: dataIso(-50),
      formato: 'TEXTO',
      arquivo: null,
      vinculo_tipo: 'evento',
      vinculo_id: 4,
    },
  ].map((d) => ({
    vinculo_tipo: null,
    vinculo_id: null,
    grupo_versao: `grupo-${d.id_documento}`,
    aprovado_por: PRESIDENTE_DE_TESTE,
    ...d,
  }))

/** v6.3b - as contas de cada exercício publicadas (os números gravados na geração, como foram aprovados). */
const contas = () => [
  {
    ano: 2025,
    id_documento: 7,
    titulo: 'EXEMPLO – Prestação de contas do exercício 2025',
    versao: 1,
    aprovado_em: dataIso(-190),
    aprovado_por: PRESIDENTE_DE_TESTE,
    dados: {
      ano: 2025,
      receitas: [
        { codigo: '3.1.01', conta: 'EXEMPLO – Mensalidades', valor: '1000.00' },
        { codigo: '3.1.02', conta: 'EXEMPLO – Doações', valor: '500.00' },
      ],
      despesas: [
        {
          codigo: '4.1.01',
          conta: 'EXEMPLO – Material de oficinas',
          valor: '900.00',
        },
      ],
      total_receitas: '1500.00',
      total_despesas: '900.00',
      resultado: '600.00',
      pareceres: [
        {
          tipo: 'Favorável',
          texto: 'EXEMPLO – Contas conferidas, sem ressalvas.',
          data: dataIso(-212),
        },
        {
          tipo: 'Com ressalva',
          texto: 'EXEMPLO – Faltou o comprovante de uma despesa pequena.',
          data: dataIso(-210),
        },
      ],
      aprovadas_em_assembleia_em: dataIso(-200),
    },
  },
]

/** v6.3c - o relatório anual de cada ano publicado (os números e a apresentação gravados na geração, como foram aprovados). */
const relatoriosAnuais = () => [
  {
    ano: 2025,
    id_documento: 8,
    titulo: 'EXEMPLO – Relatório anual de atividades 2025',
    versao: 1,
    aprovado_em: dataIso(-30),
    aprovado_por: PRESIDENTE_DE_TESTE,
    dados: {
      ano: 2025,
      apresentacao:
        'EXEMPLO – Um ano de oficinas e de encontros com a comunidade.\nObrigado a quem fez parte.',
      registros_desde: null,
      projetos: [
        { nome: 'EXEMPLO – Oficinas de música', situacao: 'Em execução' },
        { nome: 'EXEMPLO – Reforço escolar', situacao: 'Concluído' },
      ],
      eventos: [
        {
          titulo: 'EXEMPLO – Festival de fim de ano',
          data: '2025-12-06',
          inscritos: 120,
          presentes: 98,
        },
      ],
      eventos_totais: { inscritos: 120, presentes: 98 },
      beneficiarios: { pessoas: 'menos de 5', atendimentos: 37 },
      voluntariado: { horas: '120.5', voluntarios: 8 },
      associados_no_fim_do_ano: 42,
      indicadores: [
        {
          projeto: 'EXEMPLO – Oficinas de música',
          indicador: 'Crianças atendidas',
          periodo: '2025-12',
          valor: '35.00',
          unidade: 'crianças',
          meta: '40.00',
        },
      ],
      contas: {
        id_documento: 7,
        titulo: 'EXEMPLO – Prestação de contas do exercício 2025',
        total_receitas: '1500.00',
        total_despesas: '900.00',
        resultado: '600.00',
        aprovadas_em_assembleia_em: dataIso(-200),
      },
    },
  },
]

const parcerias = () => [
  {
    id_parceria: 1,
    tipo_codigo: 'EMENDA',
    tipo: 'Emenda parlamentar',
    ano: 2026,
    titulo: 'EXEMPLO – Emenda 123/2026 — Oficinas de música',
    objeto:
      'Oficinas de música e reforço escolar para crianças do bairro, com instrumentos e material didático.',
    esfera: 'Municipal',
    orgao_concedente: 'Secretaria Municipal de Assistência Social',
    numero_emenda: '123/2026',
    identificador_unico: 'EM-TESTE-0001',
    proponente: 'Vereador Exemplo',
    numero_termo: 'TF 009/2026',
    situacao: 'Em execução',
    valor_total: 50000,
    recebido: 10000,
    pago: 2015,
    data_assinatura: dataIso(-90),
    vigencia_inicio: dataIso(-90),
    vigencia_fim: dataIso(270),
    lancamentos_em_classificacao: 1,
    ultima_atualizacao: `${dataIso(-1)}T15:30:00.000000Z`,
  },
  {
    id_parceria: 2,
    tipo_codigo: 'EMENDA',
    tipo: 'Emenda parlamentar',
    ano: 2025,
    titulo: 'EXEMPLO – Emenda 77/2025 — Reforço escolar',
    objeto: 'Reforço escolar aos sábados para crianças de 6 a 12 anos.',
    esfera: 'Municipal',
    orgao_concedente: 'Secretaria Municipal de Educação',
    numero_emenda: '77/2025',
    identificador_unico: null,
    proponente: 'Vereadora Exemplo',
    numero_termo: 'TF 014/2025',
    situacao: 'Concluída',
    valor_total: 30000,
    recebido: 30000,
    pago: 30000,
    data_assinatura: dataIso(-500),
    vigencia_inicio: dataIso(-500),
    vigencia_fim: dataIso(-140),
    lancamentos_em_classificacao: 0,
    ultima_atualizacao: `${dataIso(-30)}T10:00:00.000000Z`,
  },
  {
    id_parceria: 3,
    tipo_codigo: 'TERMO_FOMENTO',
    tipo: 'Termo de fomento',
    ano: 2026,
    titulo: 'EXEMPLO – Termo de fomento 9/2026',
    objeto:
      'Atendimento a famílias em situação de vulnerabilidade, com cestas e oficinas.',
    esfera: 'Municipal',
    orgao_concedente: 'Secretaria Municipal de Assistência Social',
    numero_emenda: null,
    identificador_unico: null,
    proponente: null,
    numero_termo: 'TF 009/2026',
    situacao: 'Termo assinado',
    valor_total: 12000,
    recebido: 0,
    pago: 0,
    data_assinatura: dataIso(-20),
    vigencia_inicio: dataIso(-20),
    vigencia_fim: dataIso(340),
    lancamentos_em_classificacao: 0,
    ultima_atualizacao: `${dataIso(-2)}T09:00:00.000000Z`,
  },
]

function detalheDaParceria(id) {
  const base = parcerias().find((p) => p.id_parceria === id)
  if (!base) return null
  const vazio = {
    parcelas: [],
    recebimentos: [],
    pagamentos: [],
    etapas: [],
    relatorios: [],
    documentos: [],
  }
  if (id === 1) {
    return {
      ...base,
      parcelas: [
        {
          numero: 1,
          valor_previsto: 10000,
          data_prevista: dataIso(-80),
          valor_recebido: 10000,
        },
        {
          numero: 2,
          valor_previsto: 15000,
          data_prevista: dataIso(60),
          valor_recebido: 0,
        },
      ],
      recebimentos: [
        {
          data: dataIso(-75),
          valor: 10000,
          descricao: 'Repasse do recurso',
          parcela: 1,
        },
      ],
      pagamentos: [
        {
          data: dataIso(-40),
          valor: 1200,
          descricao: 'Pagamento mensal de oficineiro',
          categoria: 'EQUIPE',
          funcao: 'Oficineiro de música',
          fornecedor: null,
        },
        {
          data: dataIso(-35),
          valor: 800,
          descricao: 'Impressão de cartazes',
          categoria: 'FORNECEDOR',
          funcao: null,
          fornecedor: {
            razao_social: 'Gráfica Aurora ME',
            cnpj: '12345678000199',
          },
        },
        {
          data: dataIso(-30),
          valor: 15,
          descricao: 'Tarifa bancária',
          categoria: 'TARIFA',
          funcao: null,
          fornecedor: null,
        },
      ],
      etapas: [
        {
          titulo: 'Oficina de percussão',
          descricao: 'Primeira oficina com as turmas da manhã.',
          data_prevista: dataIso(-30),
          data_realizacao: dataIso(-28),
          local: 'Quadra da escola',
          publico_atendido: 40,
          situacao: 'Realizada',
          fotos: [
            {
              id_foto: 1,
              alt: 'Crianças tocando tambores na quadra da escola (foto de teste)',
              largura: 800,
              altura: 600,
              sha256: sha256(FOTO_DA_ETAPA_DE_TESTE),
              arquivo: '/api/publico/transparencia/parcerias/1/fotos/1',
            },
          ],
        },
        {
          titulo: 'Entrega de instrumentos',
          descricao: null,
          data_prevista: dataIso(40),
          data_realizacao: null,
          local: null,
          publico_atendido: null,
          situacao: 'Prevista',
          fotos: [],
        },
      ],
      relatorios: [
        {
          tipo_codigo: 'PARCIAL',
          tipo: 'Prestação de contas parcial',
          periodo_inicio: dataIso(-90),
          periodo_fim: dataIso(-30),
          data_prevista: dataIso(-20),
          data_apresentacao: dataIso(-18),
          prazo_analise_dias: 150,
          data_limite_analise: dataIso(132),
          resultado: 'Em análise',
          data_resultado: null,
        },
      ],
      documentos: [
        {
          id_documento: 3,
          titulo: 'EXEMPLO – Plano de trabalho da Emenda 123/2026',
          tipo: 'Plano de trabalho',
          data_documento: dataIso(-60),
          arquivo: '/api/publico/transparencia/documentos/3/arquivo',
        },
      ],
    }
  }
  if (id === 2) {
    return {
      ...base,
      ...vazio,
      parcelas: [
        {
          numero: 1,
          valor_previsto: 30000,
          data_prevista: dataIso(-480),
          valor_recebido: 30000,
        },
      ],
      recebimentos: [
        {
          data: dataIso(-470),
          valor: 30000,
          descricao: 'Repasse integral',
          parcela: 1,
        },
      ],
      relatorios: [
        {
          tipo_codigo: 'FINAL',
          tipo: 'Prestação de contas final',
          periodo_inicio: dataIso(-500),
          periodo_fim: dataIso(-140),
          data_prevista: dataIso(-110),
          data_apresentacao: dataIso(-120),
          prazo_analise_dias: 150,
          data_limite_analise: dataIso(30),
          resultado: 'Regulares com ressalvas',
          data_resultado: dataIso(-40),
        },
      ],
    }
  }
  return { ...base, ...vazio }
}

/** "AAAA-MM-DDT12:00:00Z" de `dias` atrás: fixo no dia, para a impressão digital não variar entre leituras. */
const instante = (dias) =>
  `${new Date(agora() - dias * 86_400_000).toISOString().slice(0, 10)}T12:00:00Z`

/**
 * Notícias como o Directus devolve. Inclui, de propósito, o que a validação do site precisa RECUSAR:
 * foto sem autorização, rascunho que "escapou" e agendada — o e2e confere que nenhuma aparece.
 */
function noticiasDoDirectus() {
  const publicada = {
    status: 'publicado',
    imagem: null,
    imagem_alt: null,
    autorizacao_imagem: false,
    projeto_id: null,
    evento_id: null,
    emenda_id: null,
  }
  return [
    {
      ...publicada,
      id: 'noticia-1',
      titulo: 'Notícia de teste com foto',
      slug: 'noticia-de-teste-com-foto',
      resumo:
        'Resumo da notícia de teste com foto, usado na lista e na prévia ao compartilhar.',
      corpo:
        '<h1>Título solto</h1><p>Primeiro parágrafo da <strong>notícia</strong> de teste.</p><script>window.__invasao = 1</script><p onclick="x()">Segundo parágrafo.</p><a href="javascript:alert(1)">link ruim</a> <a href="https://exemplo.org/">link bom</a><img src="/solta.png" alt="">',
      publicada_em: instante(2),
      date_updated: instante(1),
      imagem: { id: ID_DA_FOTO_DE_TESTE, width: 1280, height: 720 },
      imagem_alt: 'Crianças lendo livros no pátio da sede (foto de teste)',
      autorizacao_imagem: true,
    },
    {
      ...publicada,
      id: 'noticia-2',
      titulo: 'Notícia de teste sem foto',
      slug: 'noticia-de-teste-sem-foto',
      resumo: 'Resumo da notícia de teste que não tem nenhuma foto anexada.',
      corpo:
        '<p>Texto da notícia sem foto.</p><ul><li>Item um</li><li>Item dois</li></ul>',
      publicada_em: instante(5),
      date_updated: instante(5),
    },
    {
      ...publicada,
      id: 'noticia-3',
      titulo: 'NOTICIA RECUSADA foto sem autorização',
      slug: 'recusada-sem-autorizacao',
      resumo: 'Esta notícia tem foto, mas não pode ir ao ar sem a autorização.',
      corpo: '<p>Texto que não pode aparecer.</p>',
      publicada_em: instante(3),
      date_updated: instante(3),
      imagem: { id: ID_DA_FOTO_DE_TESTE, width: 1280, height: 720 },
      imagem_alt: 'Foto sem autorização de imagem',
      autorizacao_imagem: false,
    },
    {
      ...publicada,
      id: 'noticia-4',
      status: 'rascunho',
      titulo: 'NOTICIA RECUSADA rascunho',
      slug: 'recusada-rascunho',
      resumo:
        'Um rascunho jamais pode aparecer no site, mesmo que escape do filtro.',
      corpo: '<p>Rascunho.</p>',
      publicada_em: instante(4),
      date_updated: instante(4),
    },
    {
      ...publicada,
      id: 'noticia-5',
      titulo: 'NOTICIA RECUSADA agendada',
      slug: 'recusada-agendada',
      resumo:
        'Agendada para o futuro: só aparece depois da data de publicação.',
      corpo: '<p>Ainda não.</p>',
      publicada_em: instante(-10),
      date_updated: instante(-10),
    },
    // v5.5 - ligadas ao projeto principal (id 3) e à edição passada dele (evento 4), pelo número, como o editor faz.
    {
      ...publicada,
      id: 'noticia-6',
      titulo: 'Notícia de teste ligada ao projeto',
      slug: 'noticia-de-teste-ligada-ao-projeto',
      resumo:
        'Resumo da notícia de teste que está ligada ao projeto principal de teste.',
      corpo: '<p>Texto da notícia ligada ao projeto.</p>',
      publicada_em: instante(8),
      date_updated: instante(8),
      projeto_id: ID_DO_PROJETO_PRINCIPAL,
    },
    {
      ...publicada,
      id: 'noticia-7',
      titulo: 'Notícia de teste ligada ao evento',
      slug: 'noticia-de-teste-ligada-ao-evento',
      resumo:
        'Resumo da notícia de teste que está ligada à primeira edição do projeto principal.',
      corpo: '<p>Texto da notícia ligada ao evento.</p>',
      publicada_em: instante(9),
      date_updated: instante(9),
      evento_id: 4,
    },
    // Número que não existe: a notícia vai ao ar SEM a ligação (e o build avisa o editor).
    {
      ...publicada,
      id: 'noticia-8',
      titulo: 'Notícia de teste com ligação quebrada',
      slug: 'noticia-de-teste-com-ligacao-quebrada',
      resumo:
        'Resumo da notícia de teste ligada a um projeto e a um evento que não existem.',
      corpo: '<p>Texto da notícia com ligação quebrada.</p>',
      publicada_em: instante(10),
      date_updated: instante(10),
      projeto_id: 999,
      evento_id: 998,
      // v5.7h: a parceria 3 existe, mas é termo de fomento (não é emenda): a ligação também é desfeita
      emenda_id: 3,
    },
    // v5.7h - ligada à emenda 123/2026 (parceria 1), pelo número, como o editor faz.
    {
      ...publicada,
      id: 'noticia-9',
      titulo: 'Notícia de teste ligada à emenda',
      slug: 'noticia-de-teste-ligada-a-emenda',
      resumo:
        'Resumo da notícia de teste que está ligada a uma emenda parlamentar de teste.',
      corpo: '<p>Texto da notícia ligada à emenda.</p>',
      publicada_em: instante(11),
      date_updated: instante(11),
      emenda_id: 1,
    },
  ]
}

let fotoDeTeste
/** Uma foto WebP de verdade (1280x720, verde da ASAF), gerada uma vez. */
function fotoWebp() {
  fotoDeTeste ??= sharp({
    create: {
      width: 1280,
      height: 720,
      channels: 3,
      background: '#145238',
    },
  })
    .webp()
    .toBuffer()
  return fotoDeTeste
}

/** Campos que a API (v5.5) acrescentou: a API ANTIGA não os tem. */
const CAMPOS_NOVOS = {
  eventoDaLista: [
    'id_projeto',
    'status',
    'motivo_status',
    'data_hora_inicio_anterior',
  ],
  eventoDetalhado: [
    'id_projeto',
    'projeto',
    'edicoes',
    'documentos',
    'fotos',
    'status',
    'motivo_status',
    'data_hora_inicio_anterior',
  ],
  projetoDaLista: ['destaque'],
  projetoDetalhado: ['destaque', 'eventos', 'documentos', 'fotos'],
  documento: ['vinculo_tipo', 'vinculo_id', 'aprovado_por', 'grupo_versao'],
  noticia: ['projeto_id', 'evento_id', 'emenda_id'],
  membroDaDiretoria: ['foto'],
}

/** Tira os campos novos (lista ou objeto): é assim que a API antiga responderia. */
function semCampos(corpo, campos) {
  const limpar = (objeto) =>
    Object.fromEntries(
      Object.entries(objeto).filter(([chave]) => !campos.includes(chave)),
    )
  return Array.isArray(corpo) ? corpo.map(limpar) : limpar(corpo)
}

/** Pedidos de filiação que o formulário do site mandou ao mock (o teste confere o corpo que a API real receberia). */
const pedidosDeFiliacao = []
/** CPFs de teste que fazem o mock responder como a API real responderia a esses casos. */
export const CPF_QUE_JA_TEM_PEDIDO = '11144477735'
export const CPF_QUE_DERRUBA_A_API = '52998224725'
export const RECUSA_DE_DUPLICIDADE =
  'Já existe um pedido em andamento ou um cadastro com estes dados. Fale com a secretaria para saber a situação.'

/**
 * Fila única de atendimento (v5.5a): contato, pedido de informação e solicitação do titular de dados; na v5.5b, também o pedido para ser voluntário. O mock guarda o
 * corpo recebido (o teste confere o que a API real receberia), dá protocolos em sequência e responde como a API real. Nomes de teste fazem o mock responder aos dois
 * casos que só a API sabe provocar: o limite de pedidos por endereço (429) e o erro de servidor (500). (Prazos em dias iguais aos padrões do sistema.)
 */
const pedidosDeAtendimento = []
let protocolosDeAtendimento = 0
export const PRAZOS_DE_ATENDIMENTO = {
  CONTATO: 10,
  PEDIDO_INFORMACAO: 20,
  TITULAR_LGPD: 15,
  VOLUNTARIO: 10,
}

const cpfConfere = (texto) => {
  const d = String(texto).replace(/\D/g, '')
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const digito = (n) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10])
}

/**
 * O que o servidor recusa no pedido de voluntário (app/schemas/atendimento.py): data de nascimento obrigatória, que exista, que não seja no futuro e de 1900 em
 * diante; o CPF é opcional, mas, se vier, tem de conferir. Devolve a frase em português (ou `null`); a resposta sai no formato 422 do FastAPI.
 */
function recusaDoVoluntariado(corpo) {
  const nascimento = corpo.data_nascimento
  if (nascimento === undefined || nascimento === null || nascimento === '')
    return 'Informe a sua data de nascimento.'
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(nascimento))
  const data = partes
    ? new Date(
        Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])),
      )
    : null
  if (
    !partes ||
    data.getUTCFullYear() !== Number(partes[1]) ||
    data.getUTCMonth() !== Number(partes[2]) - 1 ||
    data.getUTCDate() !== Number(partes[3])
  )
    return 'Input should be a valid date or datetime, day value is outside expected range'
  const hoje = new Date(agora()).toISOString().slice(0, 10)
  if (String(nascimento) > hoje)
    return 'A data de nascimento não pode ser no futuro.'
  if (Number(partes[1]) < 1900) return 'Confira a data de nascimento.'
  if (corpo.cpf && String(corpo.cpf).trim() && !cpfConfere(corpo.cpf))
    return 'CPF inválido (dígito verificador não confere).'
  return null
}
export const NOME_QUE_ESTOURA_O_LIMITE = 'Teste Limite Por IP'
export const NOME_QUE_DERRUBA_O_ATENDIMENTO = 'Teste Erro De Servidor'
export const RECUSA_DE_LIMITE =
  'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.'
export const RECUSA_DE_AVISO_DESATUALIZADO =
  'O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.'
const VERSAO_DO_AVISO_DE_ATENDIMENTO = '2'

/**
 * Doar pelo site com Pix estático (v5.6a): as três rotas públicas, com o contrato do servidor (app/routers/doacao_online.py, app/services/doacao_online.py,
 * app/schemas/doacao_online.py e app/services/pix.py), incluindo as frases de recusa em português. O código "copia e cola" é um BR Code de verdade (CRC-16/CCITT-FALSE),
 * montado como o servidor monta. `semPix` (`MOCK_API_SEM_PIX=1` quando o mock roda direto) = a Presidência ainda não marcou a chave Pix "vai para o site": `pix_disponivel: false` e o 503 nos pedidos; `vazio` (a produção de
 * hoje) é a mesma coisa e, além disso, sem nenhuma campanha. API antiga: as rotas não existem (404).
 */
export const CHAVE_PIX_DE_TESTE = '123e4567-e89b-12d3-a456-426614174000'
export const BENEFICIARIO_DE_TESTE = 'ASAF TESTE'
export const CIDADE_DE_TESTE = 'PARAUAPEBAS'
export const VERSAO_DO_AVISO_DE_DOACAO = '2'
export const DIAS_DE_VALIDADE_DA_DOACAO = 15
export const VALOR_MAXIMO_DA_DOACAO = 1_000_000
export const RECUSA_DE_PIX_INDISPONIVEL =
  'A doação pelo site ainda não está disponível. Fale com a secretaria da associação.'
export const RECUSA_DE_CAMPANHA_ENCERRADA =
  'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.'
export const RECUSA_DE_AVISO_NAO_ACEITO =
  'Para continuar é preciso ler e aceitar o aviso de privacidade.'

const campoDoPix = (id, valor) =>
  `${id}${String(valor.length).padStart(2, '0')}${valor}`

/** CRC-16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF, sem reflexão), como app/services/pix.py::_crc16_ccitt_false. */
function crc16DoPix(texto) {
  let resultado = 0xffff
  for (const byte of Buffer.from(texto, 'utf8')) {
    resultado ^= byte << 8
    for (let i = 0; i < 8; i++)
      resultado =
        resultado & 0x8000
          ? ((resultado << 1) ^ 0x1021) & 0xffff
          : (resultado << 1) & 0xffff
  }
  return resultado.toString(16).toUpperCase().padStart(4, '0')
}

const semAcentoParaOPix = (texto, maximo) =>
  (
    texto
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .trim() || 'NA'
  ).slice(0, maximo)

/**
 * O "copia e cola" de um Pix estático (app/services/pix.py::gerar_payload_pix). Sem `valor`, o campo do valor não existe e quem paga o digita no aplicativo do banco.
 * @param {{ chave: string, beneficiario: string, cidade: string, valor?: number | null, txid: string, descricao?: string | null }} dados
 */
export function gerarPayloadPix({
  chave,
  beneficiario,
  cidade,
  valor = null,
  txid,
  descricao = null,
}) {
  const txidNormalizado =
    [...txid]
      .filter((c) => /[A-Za-z0-9]/.test(c))
      .join('')
      .slice(0, 25) || '***'
  let conta =
    campoDoPix('00', 'br.gov.bcb.pix') + campoDoPix('01', chave.trim())
  if (descricao) conta += campoDoPix('02', semAcentoParaOPix(descricao, 40))
  const campos =
    campoDoPix('00', '01') +
    campoDoPix('26', conta) +
    campoDoPix('52', '0000') +
    campoDoPix('53', '986') +
    (valor === null ? '' : campoDoPix('54', Number(valor).toFixed(2))) +
    campoDoPix('58', 'BR') +
    campoDoPix('59', semAcentoParaOPix(beneficiario, 25)) +
    campoDoPix('60', semAcentoParaOPix(cidade, 15)) +
    campoDoPix('62', campoDoPix('05', txidNormalizado))
  return `${campos}6304${crc16DoPix(`${campos}6304`)}`
}

/** As campanhas em andamento (a API só manda essas): uma com um quarto da meta, uma que passou da meta (120%, sem prazo) e uma recém-aberta, com prazo. */
const campanhasDeDoacao = () => [
  {
    id_campanha: 1,
    titulo: 'Campanha de teste — cestas básicas',
    descricao:
      'Descrição de teste da campanha de cestas básicas para famílias da comunidade.',
    meta_valor: 10000,
    valor_arrecadado: 2500,
    valor_aplicado: 1800.5,
    percentual: 25,
    prazo: soData(60),
  },
  {
    id_campanha: 2,
    titulo: 'Campanha de teste — meta ultrapassada',
    descricao: null,
    meta_valor: 5000,
    valor_arrecadado: 6000,
    valor_aplicado: null,
    percentual: 120,
    prazo: null,
  },
  {
    id_campanha: 3,
    titulo: 'Campanha de teste — recém-aberta',
    descricao: 'Ainda sem nenhuma doação confirmada.',
    meta_valor: 800,
    valor_arrecadado: 0,
    valor_aplicado: 0,
    percentual: 0,
    prazo: soData(10),
  },
]

/** `GET /api/publico/doacao`. */
function dadosDaDoacao({ vazio, semPix }) {
  const aberta = !vazio && !semPix
  return {
    pix_disponivel: aberta,
    chave_pix: aberta ? CHAVE_PIX_DE_TESTE : null,
    beneficiario: aberta ? BENEFICIARIO_DE_TESTE : null,
    cidade: aberta ? CIDADE_DE_TESTE : null,
    campanhas: vazio ? [] : campanhasDeDoacao(),
    versao_aviso_de_privacidade: VERSAO_DO_AVISO_DE_DOACAO,
    dias_de_validade_do_pedido: DIAS_DE_VALIDADE_DA_DOACAO,
  }
}

const doisDecimais = (n) => Math.round(Number(n) * 100) / 100

/** A frase do servidor para um valor fora do que vale (`validar_valor_da_doacao`), ou `null` se o valor serve. */
function recusaDoValorDaDoacao(valor) {
  if (valor <= 0) return 'O valor da doação precisa ser maior que zero.'
  if (valor > VALOR_MAXIMO_DA_DOACAO)
    return 'Esse valor é alto demais para o Pix pelo site: fale com a secretaria.'
  return null
}

const campanhaQueRecebe = (id) =>
  campanhasDeDoacao().find((c) => c.id_campanha === id) ?? null

/**
 * `GET /api/publico/doacao/pix?valor=&id_campanha=`: o código para doar SEM se identificar. Ordem do servidor: o formato da consulta (422), o Pix disponível (503),
 * o valor (400) e a campanha (400). Devolve `[status HTTP, corpo]`.
 */
function pixDaDoacaoAnonima(consulta, { vazio, semPix }) {
  const bruto = consulta.get('valor')
  const brutoDaCampanha = consulta.get('id_campanha')
  const comValor = bruto !== null && bruto !== ''
  const comCampanha = brutoDaCampanha !== null && brutoDaCampanha !== ''
  const formato = []
  if (comValor && !/^[+-]?\d+(\.\d+)?$/.test(bruto))
    formato.push({
      type: 'decimal_parsing',
      loc: ['query', 'valor'],
      msg: 'Input should be a valid decimal',
      input: bruto,
    })
  if (comCampanha && !/^[+-]?\d+$/.test(brutoDaCampanha))
    formato.push({
      type: 'int_parsing',
      loc: ['query', 'id_campanha'],
      msg: 'Input should be a valid integer, unable to parse string as an integer',
      input: brutoDaCampanha,
    })
  if (formato.length > 0) return [422, { detail: formato }]
  if (vazio || semPix) return [503, { detail: RECUSA_DE_PIX_INDISPONIVEL }]
  const valor = comValor ? Number(bruto) : null
  if (valor !== null) {
    const recusa = recusaDoValorDaDoacao(valor)
    if (recusa) return [400, { detail: recusa }]
  }
  const idDaCampanha = comCampanha ? Number(brutoDaCampanha) : null
  if (idDaCampanha !== null && !campanhaQueRecebe(idDaCampanha))
    return [400, { detail: RECUSA_DE_CAMPANHA_ENCERRADA }]
  const valorDoCodigo = valor === null ? null : doisDecimais(valor)
  return [
    200,
    {
      copia_e_cola: gerarPayloadPix({
        chave: CHAVE_PIX_DE_TESTE,
        beneficiario: BENEFICIARIO_DE_TESTE,
        cidade: CIDADE_DE_TESTE,
        valor: valorDoCodigo,
        txid: idDaCampanha === null ? 'ASAFDOACAO' : `ASAFCAMP${idDaCampanha}`,
        descricao: 'Doacao ASAF',
      }),
      valor: valorDoCodigo,
      id_campanha: idDaCampanha,
      chave_pix: CHAVE_PIX_DE_TESTE,
      beneficiario: BENEFICIARIO_DE_TESTE,
      cidade: CIDADE_DE_TESTE,
    },
  ]
}

/** Os corpos dos pedidos identificados que o formulário mandou ao mock (o teste confere o que a API real receberia) e os protocolos já dados (o mesmo pedido devolve o mesmo). */
const pedidosDeDoacao = []
const intencoesDeDoacao = new Map()
let protocolosDeDoacao = 0

/** O que o pydantic do servidor recusa no corpo (IntencaoDeDoacaoCriar), com as mesmas frases, no formato 422 do FastAPI: uma entrada por campo. */
function errosDoPedidoDeDoacao(corpo) {
  const erros = []
  const recusa = (campo, msg) =>
    erros.push({
      type: 'value_error',
      loc: ['body', campo],
      msg: `Value error, ${msg}`,
      input: corpo[campo] ?? null,
    })
  const faltando = (campo) =>
    erros.push({
      type: 'missing',
      loc: ['body', campo],
      msg: 'Field required',
      input: corpo,
    })
  if (typeof corpo.nome_completo !== 'string') faltando('nome_completo')
  else {
    const letras = [
      ...corpo.nome_completo.split(/\s+/).filter(Boolean).join(' '),
    ].length
    if (letras < 3) recusa('nome_completo', 'Informe o seu nome completo.')
    else if (letras > 120)
      recusa('nome_completo', 'O nome ficou grande demais: confira.')
  }
  if (typeof corpo.email !== 'string') faltando('email')
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corpo.email.trim()))
    recusa(
      'email',
      'Esse e-mail não parece certo: confira se está escrito sem erro.',
    )
  if (
    corpo.cpf !== undefined &&
    corpo.cpf !== null &&
    String(corpo.cpf).trim() !== '' &&
    !cpfConfere(corpo.cpf)
  )
    recusa(
      'cpf',
      'Esse CPF não confere: confira os números ou deixe em branco.',
    )
  if (corpo.valor !== undefined && corpo.valor !== null) {
    const numero = typeof corpo.valor === 'number' ? corpo.valor : Number.NaN
    if (!Number.isFinite(numero))
      erros.push({
        type: 'decimal_parsing',
        loc: ['body', 'valor'],
        msg: 'Input should be a valid decimal',
        input: corpo.valor,
      })
    else {
      const frase = recusaDoValorDaDoacao(numero)
      if (frase) recusa('valor', frase)
    }
  }
  return erros
}

/** `POST /api/publico/doacoes/intencoes`: devolve `[status HTTP, corpo]`. Ordem do servidor: validação (422) -> armadilha de robô -> limite por endereço (429) -> Pix (503) -> aviso (400, 422) -> campanha (400) -> pedido novo ou o mesmo de antes. */
function registrarIntencaoDeDoacao(corpo, { vazio, semPix }) {
  pedidosDeDoacao.push(corpo)
  const erros = errosDoPedidoDeDoacao(corpo)
  if (erros.length > 0) return [422, { detail: erros }]
  if (corpo.pagina_web)
    return [
      200,
      {
        mensagem: 'Pedido recebido.',
        protocolo: null,
        valor: null,
        copia_e_cola: null,
        expira_em: null,
      },
    ]
  if (corpo.nome_completo === NOME_QUE_ESTOURA_O_LIMITE)
    return [429, { detail: RECUSA_DE_LIMITE }]
  if (corpo.nome_completo === NOME_QUE_DERRUBA_O_ATENDIMENTO)
    return [500, { detail: 'Erro interno do servidor.' }]
  if (vazio || semPix) return [503, { detail: RECUSA_DE_PIX_INDISPONIVEL }]
  if (!corpo.consentimento_lgpd)
    return [400, { detail: RECUSA_DE_AVISO_NAO_ACEITO }]
  if (corpo.versao_texto_consentimento !== VERSAO_DO_AVISO_DE_DOACAO)
    return [422, { detail: RECUSA_DE_AVISO_DESATUALIZADO }]
  const idDaCampanha = corpo.id_campanha ?? null
  if (idDaCampanha !== null && !campanhaQueRecebe(idDaCampanha))
    return [400, { detail: RECUSA_DE_CAMPANHA_ENCERRADA }]

  const valor =
    corpo.valor === undefined || corpo.valor === null
      ? null
      : doisDecimais(corpo.valor)
  const impressao = [
    corpo.nome_completo.split(/\s+/).filter(Boolean).join(' ').toLowerCase(),
    corpo.email.trim().toLowerCase(),
    String(corpo.cpf ?? '').replace(/\D/g, ''),
    valor ?? '',
    idDaCampanha ?? '',
  ].join('|')
  let intencao = intencoesDeDoacao.get(impressao)
  if (!intencao) {
    protocolosDeDoacao += 1
    intencao = {
      protocolo: `DOA-${new Date(agora()).getUTCFullYear()}-${String(protocolosDeDoacao).padStart(5, '0')}`,
      expiraEm: new Date(agora() + DIAS_DE_VALIDADE_DA_DOACAO * 86_400_000)
        .toISOString()
        .replace(/Z$/, ''),
    }
    intencoesDeDoacao.set(impressao, intencao)
  }
  return [
    200,
    {
      mensagem: 'Pedido recebido.',
      protocolo: intencao.protocolo,
      valor,
      id_campanha: idDaCampanha,
      copia_e_cola: gerarPayloadPix({
        chave: CHAVE_PIX_DE_TESTE,
        beneficiario: BENEFICIARIO_DE_TESTE,
        cidade: CIDADE_DE_TESTE,
        valor,
        txid: `ASAF${intencao.protocolo}`,
        descricao: 'Doacao ASAF',
      }),
      chave_pix: CHAVE_PIX_DE_TESTE,
      beneficiario: BENEFICIARIO_DE_TESTE,
      cidade: CIDADE_DE_TESTE,
      expira_em: intencao.expiraEm,
    },
  ]
}

/**
 * Inscrição em evento pelo site (v5.5c): consentimento, inscrever-se, resumo do link e cancelar/confirmar, com as regras do servidor
 * (app/services/eventos.py, vagas.py e inscricao.py). O mock guarda o corpo recebido (o teste confere o que a API real receberia) e cada inscrição criada (a
 * página do link a encontra pelo código). Casos que só a API sabe provocar, por dado de teste: o limite por endereço (429) e o erro de servidor (500) — os
 * mesmos nomes do atendimento —, o CPF já inscrito (400), o nome que cai na lista de espera, o e-mail que não consegue enviar. Evento sem vaga livre manda
 * para a lista de espera. E os códigos "fixo-..." têm situação fixa e NUNCA mudam (cancelar/confirmar só respondem): os testes da página do link não se atrapalham.
 */
export const VERSAO_DO_CONSENTIMENTO_DE_EVENTO = '3'
export const TEXTO_DO_CONSENTIMENTO_DE_EVENTO =
  'Texto de teste do consentimento da inscrição (versão 3).\nSegunda linha do texto de teste.'
// v7.1a: a API manda também os parágrafos com os links marcados ([texto](/endereco/)); o `texto` continua sem a marcação
export const PARAGRAFOS_DO_AVISO_DE_EVENTO = [
  'Texto de teste do consentimento da inscrição (versão 3).',
  'Segunda linha do texto de teste. Leia a [Política de Privacidade](/privacidade/).',
]
export const CPF_JA_INSCRITO_NO_EVENTO = '12345678062'
export const RECUSA_DE_INSCRICAO_REPETIDA =
  "Esta pessoa já está inscrita neste contexto (status 'Pré-inscrito')."
export const RECUSA_DE_EVENTO_ENCERRADO =
  'As inscrições deste evento já foram encerradas: o evento já aconteceu.'
/** As recusas do servidor (app/services/status_do_evento.py) a quem tenta se inscrever em evento cancelado, adiado ou realizado. */
export const RECUSAS_POR_SITUACAO = {
  Cancelado: 'Este evento foi cancelado: não recebe inscrições.',
  Adiado:
    'Este evento foi adiado: as inscrições reabrem quando a nova data for definida.',
  Realizado: 'Este evento já foi realizado: as inscrições estão encerradas.',
}
export const RECUSA_DE_CONSENTIMENTO_NOVO =
  'O texto de consentimento LGPD foi atualizado - recarregue a página e aceite a versão atual.'
export const NOME_QUE_VAI_PARA_A_LISTA_DE_ESPERA = 'Teste Lista De Espera'
export const EMAIL_QUE_NAO_RECEBE = 'sem-envio@example.com'
export const AVISO_DA_LISTA_NO_CONFIRMAR =
  'Você ainda está na lista de espera: avisamos por e-mail quando uma vaga abrir.'

/** Os corpos de inscrição que o formulário mandou ao mock. */
const inscricoesDeEvento = []
/** As inscrições criadas pelo mock, por código de cancelamento (o código é o que a página do link usa). */
const inscricoesPorCodigo = new Map()
let sequenciaDeInscricoes = 0

const horasDaquiAUtc = (horas) =>
  new Date(agora() + horas * 3_600_000).toISOString().replace(/Z$/, '')

/** As inscrições de situação fixa, para testar a página do link: só o código "fixo-..." as chama e nada as altera. */
const INSCRICOES_FIXAS = {
  'fixo-reservada': { status: 'Pré-inscrito', idEvento: 7, codigo: 'A1B2C3D4' },
  'fixo-promovida': {
    status: 'Pré-inscrito',
    idEvento: 7,
    idSessao: 71,
    codigo: 'B2C3D4E5',
    prazo: () => horasDaquiAUtc(20),
  },
  'fixo-confirmada': { status: 'Confirmado', idEvento: 2, codigo: '0F1E2D3C' },
  'fixo-lista-de-espera': { status: 'Lista de Espera', idEvento: 8 },
  'fixo-cancelada': { status: 'Cancelado', idEvento: 2 },
  'fixo-encerrada': { status: 'Confirmado', idEvento: 1, codigo: 'C3D4E5F6' },
  'fixo-com-reembolso': {
    status: 'Confirmado',
    idEvento: 3,
    codigo: 'D4E5F6A7',
    reembolso: 50,
  },
  'fixo-falha-ao-cancelar': {
    status: 'Confirmado',
    idEvento: 2,
    codigo: 'E5F6A7B8',
    falhaAoAgir: 500,
  },
  'fixo-falha-ao-confirmar': {
    status: 'Pré-inscrito',
    idEvento: 2,
    codigo: 'F6A7B8C9',
    falhaAoAgir: 429,
  },
  // v5.5d - quem abre o link de um evento cancelado (vaga reservada, ainda sem confirmar) ou adiado (vaga confirmada)
  'fixo-evento-cancelado': {
    status: 'Pré-inscrito',
    idEvento: 10,
    codigo: 'A7B8C9D0',
  },
  'fixo-evento-adiado': {
    status: 'Confirmado',
    idEvento: 11,
    codigo: 'B8C9D0E1',
  },
  'fixo-limite-de-consultas': { consulta: 429 },
  'fixo-erro-de-servidor': { consulta: 500 },
}

const encerrado = (evento) =>
  Date.parse(`${evento.data_hora_fim ?? evento.data_hora_inicio}Z`) < agora()

function inscricaoPorCodigo(codigo) {
  const criada = inscricoesPorCodigo.get(codigo)
  if (criada) return { ...criada, persistida: true }
  const fixa = INSCRICOES_FIXAS[codigo]
  return fixa
    ? { nome: 'Maria de Teste Silva', ...fixa, persistida: false }
    : null
}

// v6.2b - os links de descadastro que o mock reconhece (a assinatura é de mentira: o servidor de verdade confere com o segredo dele)
export const TOKEN_DE_DESCADASTRO =
  '101.avisos.0123456789abcdef0123456789abcdef'
export const TOKEN_JA_DESCADASTRADO =
  '102.lembretes_de_mensalidade.fedcba9876543210fedcba9876543210'
const TOKENS_DE_DESCADASTRO = {
  [TOKEN_DE_DESCADASTRO]: 'avisos',
  [TOKEN_JA_DESCADASTRADO]: 'lembretes_de_mensalidade',
}
const ROTULOS_DE_DESCADASTRO = {
  avisos: 'Avisos do mural da ASAF que não são obrigatórios (por e-mail)',
  lembretes_de_mensalidade: 'Lembretes de mensalidade',
}
const escolhasDeDescadastro = new Map()

/** O que `GET /api/publico/inscricoes/{código}` devolve: as mesmas regras do servidor (cancelar e confirmar dependem da situação e de o evento ter acontecido). */
function resumoDaInscricao(inscricao) {
  const evento = eventos().find((e) => e.id_evento === inscricao.idEvento)
  const sessao = inscricao.idSessao
    ? sessoesDoEvento(inscricao.idEvento).find(
        (x) => x.id_sessao === inscricao.idSessao,
      )
    : null
  const acabou = encerrado(evento)
  const tem =
    inscricao.status === 'Pré-inscrito' || inscricao.status === 'Confirmado'
  const prazo =
    typeof inscricao.prazo === 'function'
      ? inscricao.prazo()
      : (inscricao.prazo ?? null)
  return {
    status: inscricao.status,
    primeiro_nome: inscricao.nome.split(' ')[0],
    evento: {
      titulo: evento.titulo,
      data_hora_inicio: evento.data_hora_inicio,
      data_hora_fim: evento.data_hora_fim,
      endereco_avulso: evento.endereco_avulso,
      // v5.5d - quem abre o link de um evento cancelado ou adiado precisa ver isso antes de qualquer coisa
      status: evento.status,
      motivo_status: evento.motivo_status,
    },
    sessao: sessao
      ? { titulo: sessao.titulo, data_hora_inicio: sessao.data_hora_inicio }
      : null,
    codigo_checkin: tem ? (inscricao.codigo ?? null) : null,
    prazo_confirmacao: tem ? prazo : null,
    evento_encerrado: acabou,
    pode_cancelar:
      ['Pré-inscrito', 'Confirmado', 'Lista de Espera'].includes(
        inscricao.status,
      ) && !acabou,
    // como o servidor: em evento cancelado não há o que confirmar (o cancelar continua)
    pode_confirmar:
      inscricao.status === 'Pré-inscrito' &&
      !acabou &&
      evento.status !== 'Cancelado',
  }
}

const DIGITOS_HEX = '0123456789ABCDEF'
/** Código de check-in de 8 caracteres hexadecimais maiúsculos, como o do servidor. */
const codigoDeCheckin = (n) =>
  Array.from(
    { length: 8 },
    (_, i) => DIGITOS_HEX[(n * 7 + i * 5 + n) % 16],
  ).join('')

/** `POST /api/publico/eventos/{id}/inscrever-se`: devolve `[status HTTP, corpo]`. */
function inscreverNoEvento(idEvento, corpo) {
  const evento = eventos().find((e) => e.id_evento === idEvento)
  if (!evento) return [404, { detail: 'Evento não encontrado.' }]
  inscricoesDeEvento.push({ idEvento, ...corpo })
  // armadilha de robô disparada: finge sucesso, sem participantes e sem código
  if (corpo.pagina_web)
    return [
      200,
      {
        mensagem: 'Inscrição registrada.',
        codigo_checkin: null,
        email_enviado: false,
      },
    ]
  if (corpo.nome_completo === NOME_QUE_ESTOURA_O_LIMITE)
    return [429, { detail: RECUSA_DE_LIMITE }]
  if (corpo.nome_completo === NOME_QUE_DERRUBA_O_ATENDIMENTO)
    return [500, { detail: 'Erro interno do servidor.' }]
  if (RECUSAS_POR_SITUACAO[evento.status])
    return [400, { detail: RECUSAS_POR_SITUACAO[evento.status] }]
  if (encerrado(evento)) return [400, { detail: RECUSA_DE_EVENTO_ENCERRADO }]
  if (corpo.versao_texto_consentimento !== VERSAO_DO_CONSENTIMENTO_DE_EVENTO)
    return [422, { detail: RECUSA_DE_CONSENTIMENTO_NOVO }]
  const pessoas = [
    {
      nome_completo: corpo.nome_completo,
      cpf: corpo.cpf,
      respostas: corpo.respostas ?? {},
    },
    ...(corpo.participantes_adicionais ?? []),
  ]
  for (const pessoa of pessoas) {
    for (const pergunta of perguntasDoEvento(idEvento)) {
      const valor = (pessoa.respostas ?? {})[String(pergunta.id_pergunta)]
      const emBranco =
        valor === undefined ||
        valor === null ||
        valor === '' ||
        (Array.isArray(valor) && valor.length === 0)
      if (pergunta.obrigatoria && emBranco)
        return [
          422,
          { detail: `A pergunta "${pergunta.enunciado}" é obrigatória.` },
        ]
    }
    if (pessoa.cpf === CPF_JA_INSCRITO_NO_EVENTO)
      return [400, { detail: RECUSA_DE_INSCRICAO_REPETIDA }]
  }
  const sessao = corpo.id_sessao
    ? sessoesDoEvento(idEvento).find((x) => x.id_sessao === corpo.id_sessao)
    : null
  if (corpo.id_sessao && !sessao)
    return [404, { detail: 'Sessão não encontrada.' }]
  const semVaga = (sessao ?? evento).vagas_livres === 0
  const grupo = pessoas.length > 1 ? `grupo-${++sequenciaDeInscricoes}` : null
  const participantes = pessoas.map((pessoa) => {
    const n = ++sequenciaDeInscricoes
    const status =
      semVaga || pessoa.nome_completo === NOME_QUE_VAI_PARA_A_LISTA_DE_ESPERA
        ? 'Lista de Espera'
        : 'Pré-inscrito'
    const codigo = `mock-${n}-${Math.random().toString(36).slice(2, 12)}`
    const codigoDeEntrada = codigoDeCheckin(n)
    inscricoesPorCodigo.set(codigo, {
      status,
      nome: pessoa.nome_completo,
      idEvento,
      idSessao: sessao?.id_sessao ?? null,
      codigo: codigoDeEntrada,
    })
    return {
      nome_completo: pessoa.nome_completo,
      id_inscricao: n,
      status,
      // como o servidor: o código de check-in existe para todos, mas só quem tem vaga o usa (o resumo só o mostra a quem tem vaga)
      codigo_checkin: codigoDeEntrada,
      token_cancelamento: codigo,
      email_enviado: corpo.email !== EMAIL_QUE_NAO_RECEBE,
      valor_cobrado: null,
    }
  })
  const primeiro = participantes[0]
  return [
    200,
    {
      mensagem: 'Inscrição registrada.',
      identificador_grupo: grupo,
      participantes,
      id_inscricao: primeiro.id_inscricao,
      status: primeiro.status,
      codigo_checkin: primeiro.codigo_checkin,
      token_cancelamento: primeiro.token_cancelamento,
      email_enviado: primeiro.email_enviado,
      valor_cobrado: null,
    },
  ]
}

/** `POST /api/publico/inscricoes/{código}/cancelar|confirmar`: devolve `[status HTTP, corpo]`. */
function agirNaInscricao(codigo, acao) {
  const inscricao = inscricaoPorCodigo(codigo)
  if (!inscricao)
    return [
      404,
      {
        detail:
          acao === 'cancelar'
            ? 'Link de cancelamento inválido.'
            : 'Link de confirmação inválido.',
      },
    ]
  if (inscricao.falhaAoAgir === 500)
    return [500, { detail: 'Erro interno do servidor.' }]
  if (inscricao.falhaAoAgir === 429) return [429, { detail: RECUSA_DE_LIMITE }]
  const mudar = (status) => {
    if (inscricao.persistida) inscricoesPorCodigo.get(codigo).status = status
  }
  if (acao === 'cancelar') {
    if (inscricao.status === 'Cancelado')
      return [400, { detail: 'Esta inscrição já estava cancelada.' }]
    if (
      !['Pré-inscrito', 'Confirmado', 'Lista de Espera'].includes(
        inscricao.status,
      )
    )
      return [
        400,
        {
          detail: `Não é possível cancelar uma inscrição com status '${inscricao.status}'.`,
        },
      ]
    mudar('Cancelado')
    return [
      200,
      {
        mensagem: 'Inscrição cancelada.',
        status: 'Cancelado',
        reembolso: inscricao.reembolso
          ? { id_titulo: 99, valor: inscricao.reembolso }
          : null,
      },
    ]
  }
  if (inscricao.status === 'Lista de Espera')
    return [400, { detail: AVISO_DA_LISTA_NO_CONFIRMAR }]
  if (inscricao.status !== 'Pré-inscrito')
    return [
      400,
      {
        detail: `Não é possível confirmar uma inscrição com status '${inscricao.status}'.`,
      },
    ]
  mudar('Confirmado')
  return [200, { mensagem: 'Inscrição confirmada.', status: 'Confirmado' }]
}

/**
 * `vazio`: a produção sem nenhum dado cadastrado. `antiga`: a API ANTES da v5.5 — mesmos dados, mas sem destaque, sem
 * projeto no evento, sem edições, relatórios nem fotos e sem os campos de ligação das notícias (o site precisa
 * continuar construindo se for publicado antes da API nova). `instituicaoPreenchida`: a diretoria preencheu a Instituição (v5.4h);
 * sem isso, a Instituição é a da produção de hoje (nome e o CNPJ de exemplo, que é inválido).
 */
// ---- Conta do visitante (v5.6b): o mock repete as regras do servidor que a página precisa ver. Os e-mails de teste mandam no resultado: só `visitante@example.com` tem vínculo (o código
// é sempre 123456); `limite@example.com` é recusado pelo limite de pedidos (429); `falha@example.com` dá erro de servidor (500); `sessao-curta@example.com` entra e logo depois a sessão
// "acaba" (a próxima leitura da conta dá 401). Qualquer outro e-mail recebe a MESMA resposta de sempre e nenhum código vale (o servidor real não diz se há vínculo).
const MENSAGEM_DO_PEDIDO_DE_CODIGO =
  'Se houver inscrição em evento, pedido de doação ou solicitação do titular de dados feitos pelo site com este e-mail, tentamos enviar um código de 6 números. Ele vale por 10 minutos e só pode ser usado uma vez. Se não chegar em alguns minutos, olhe também a caixa de spam.'
const MENSAGEM_DO_CODIGO_INVALIDO =
  'Código inválido ou vencido: confira os números ou peça um novo código.'
const CODIGO_DO_VISITANTE = '123456'
const MINUTOS_DA_SESSAO_DO_VISITANTE = 60
const TENTATIVAS_POR_CODIGO_DO_VISITANTE = 5
const sessoesDeVisitante = new Map()
const tentativasDeVisitante = new Map()
const eventosDoVisitante = []
let sequenciaDeSessoes = 0
const pedidosDeApagamentoDosVisitantes = new Map()

/** Quem tem vínculo: `visitante@example.com`, `sessao-curta@example.com` e as variações com um sufixo (`visitante.abc@example.com`), para cada teste de navegador ter o seu e-mail e o seu contador de tentativas. */
const TEM_VINCULO = /^(visitante|sessao-curta)(\.[a-z0-9-]+)?@example\.com$/
const EMAIL_PARECE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const dataUtcDaquiA = (minutos) =>
  new Date(agora() + minutos * 60_000).toISOString().replace(/\.\d+Z$/, '')

/** O que `GET /api/visitante/minha-conta` devolve para `visitante@example.com`: três inscrições (vaga reservada, evento encerrado e evento cancelado), um certificado e duas doações. */
function contaDoVisitante(email, expiraEm) {
  const inscricoes = [
    'fixo-reservada',
    'fixo-evento-cancelado',
    'fixo-encerrada',
  ].map((codigo) => {
    const inscricao = inscricaoPorCodigo(codigo)
    const resumo = resumoDaInscricao(inscricao)
    return {
      ...resumo,
      token: resumo.pode_cancelar || resumo.pode_confirmar ? codigo : null,
      inscrito_em: horasDaquiAUtc(-240),
    }
  })
  return {
    email,
    sessao_expira_em: expiraEm,
    inscricoes,
    certificados: [
      {
        tipo_documento: 'Certificado de participação',
        atividade: 'Encontro de Famílias',
        primeiro_nome: 'Maria',
        emitida_em: horasDaquiAUtc(-120),
        codigo_verificacao: '9F8E7D6C5B4A3210',
        arquivo: '/uploads/documentos/9F8E7D6C5B4A3210.pdf',
      },
    ],
    doacoes: [
      {
        protocolo: 'DOA-2026-00012',
        situacao: 'PENDENTE',
        pedida_em: horasDaquiAUtc(-5),
        valor_informado: 30,
        campanha: null,
        expira_em: horasDaquiAUtc(24 * 14),
        valor_recebido: null,
        data_da_doacao: null,
        numero_do_recibo: null,
        recibo_enviado_por_email: null,
      },
      {
        protocolo: 'DOA-2026-00007',
        situacao: 'CONFIRMADA',
        pedida_em: horasDaquiAUtc(-72),
        valor_informado: 50,
        campanha: 'Cestas de Natal',
        expira_em: horasDaquiAUtc(24 * 11),
        valor_recebido: 45,
        data_da_doacao: horasDaquiAUtc(-48),
        numero_do_recibo: 12,
        recibo_enviado_por_email: false,
      },
    ],
    // v5.7f: as solicitações do titular de dados feitas com este e-mail; a resposta só é entregue aqui (nunca por e-mail), e o pedido encerrado mostra o motivo
    pedidos_do_titular: [
      {
        protocolo: 'ASAF-2026-00031',
        o_que_pediu: 'Acessar os dados que a associação tem sobre mim',
        situacao: 'Respondido',
        pedido_em: horasDaquiAUtc(-96),
        prazo_em: horasDaquiAUtc(24 * 11),
        respondido_em: horasDaquiAUtc(-24),
        resposta:
          'Guardamos o seu <strong>nome</strong>, o seu e-mail e o histórico das suas inscrições.\nNão guardamos o seu CPF completo.',
        encerrado_em: null,
        motivo_do_encerramento: null,
      },
      {
        protocolo: 'ASAF-2026-00040',
        o_que_pediu: 'Corrigir dados incompletos, inexatos ou desatualizados',
        situacao: 'Em atendimento',
        pedido_em: horasDaquiAUtc(-10),
        prazo_em: horasDaquiAUtc(24 * 14),
        respondido_em: null,
        resposta: null,
        encerrado_em: null,
        motivo_do_encerramento: null,
      },
      {
        protocolo: 'ASAF-2026-00022',
        o_que_pediu:
          'Receber meus dados para levar a outra entidade (portabilidade)',
        situacao: 'Encerrado',
        pedido_em: horasDaquiAUtc(-240),
        prazo_em: horasDaquiAUtc(24 * 5),
        respondido_em: null,
        resposta: null,
        encerrado_em: horasDaquiAUtc(-200),
        motivo_do_encerramento:
          'Não foi possível conferir a identidade de quem fez o pedido.',
      },
    ],
    pedido_de_apagamento: pedidosDeApagamentoDosVisitantes.get(email) ?? null,
  }
}

/** `POST /api/publico/visitante/codigo`: devolve `[status HTTP, corpo]`. */
function pedirCodigoDoVisitante(corpo) {
  const email = String(corpo?.email ?? '')
    .trim()
    .toLowerCase()
  if (!EMAIL_PARECE.test(email))
    return [
      422,
      {
        detail: [
          {
            loc: ['body', 'email'],
            msg: 'Value error, Esse e-mail não parece certo: confira se está escrito sem erro.',
          },
        ],
      },
    ]
  if (corpo.pagina_web) {
    eventosDoVisitante.push({ tipo: 'armadilha', email })
    return [
      200,
      { mensagem: MENSAGEM_DO_PEDIDO_DE_CODIGO, minutos_de_validade: 10 },
    ]
  }
  if (email === 'limite@example.com')
    return [
      429,
      {
        detail:
          'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.',
      },
    ]
  if (email === 'falha@example.com') return [500, { detail: 'Erro interno.' }]
  eventosDoVisitante.push({ tipo: 'codigo', email })
  tentativasDeVisitante.set(email, 0)
  return [
    200,
    { mensagem: MENSAGEM_DO_PEDIDO_DE_CODIGO, minutos_de_validade: 10 },
  ]
}

/** `POST /api/publico/visitante/entrar`: devolve `[status HTTP, corpo]`. */
function entrarDoVisitante(corpo) {
  const email = String(corpo?.email ?? '')
    .trim()
    .toLowerCase()
  const codigo = String(corpo?.codigo ?? '')
  const tentativas = tentativasDeVisitante.get(email)
  const comVinculo = TEM_VINCULO.test(email)
  if (
    tentativas === undefined ||
    tentativas >= TENTATIVAS_POR_CODIGO_DO_VISITANTE
  )
    return [400, { detail: MENSAGEM_DO_CODIGO_INVALIDO }]
  tentativasDeVisitante.set(email, tentativas + 1)
  if (!comVinculo || codigo !== CODIGO_DO_VISITANTE)
    return [400, { detail: MENSAGEM_DO_CODIGO_INVALIDO }]
  tentativasDeVisitante.delete(email)
  const token = `sessao-de-teste-${(sequenciaDeSessoes += 1)}-${email.split('@')[0]}`
  const expiraEm = dataUtcDaquiA(MINUTOS_DA_SESSAO_DO_VISITANTE)
  sessoesDeVisitante.set(token, { email, expiraEm, leituras: 0 })
  eventosDoVisitante.push({ tipo: 'entrou', email })
  return [200, { token, expira_em: expiraEm }]
}

const sessaoDoCabecalho = (req) => {
  const cabecalho = String(req.headers.authorization ?? '')
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : ''
  return { token, sessao: sessoesDeVisitante.get(token) ?? null }
}

export function criarServidor({
  vazio = false,
  antiga = false,
  instituicaoPreenchida = false,
  fotoDaDiretoriaAdulterada = false,
  semPix = false,
} = {}) {
  const lista = (dados) => (vazio ? [] : dados())
  const comoVier = (corpo, campos) =>
    antiga ? semCampos(corpo, campos) : corpo
  return createServer((req, res) => {
    const origem = req.headers.origin
    const cors = ORIGENS_PERMITIDAS.has(origem ?? '')
      ? { 'Access-Control-Allow-Origin': origem, Vary: 'Origin' }
      : {}

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
      })
      res.end()
      return
    }

    const responder = (corpo, status = 200) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(corpo))
    }

    // ---- Pedido de filiação (v5.4h): o formulário do site manda um POST; o mock guarda o corpo e responde como a API real.
    if (
      req.method === 'POST' &&
      (req.url ?? '').split('?')[0] === '/api/filiacao/propor'
    ) {
      let texto = ''
      req.on('data', (parte) => (texto += parte))
      req.on('end', () => {
        let corpo
        try {
          corpo = JSON.parse(texto)
        } catch {
          return responder({ detail: 'Corpo inválido.' }, 422)
        }
        pedidosDeFiliacao.push(corpo)
        if (corpo.cpf === CPF_QUE_JA_TEM_PEDIDO)
          return responder({ detail: RECUSA_DE_DUPLICIDADE }, 400)
        if (corpo.cpf === CPF_QUE_DERRUBA_A_API)
          return responder({ detail: 'Erro interno do servidor.' }, 500)
        return responder({
          mensagem: 'Proposta de filiação recebida.',
          id_proposta: pedidosDeFiliacao.length,
        })
      })
      return
    }
    if (
      req.method === 'GET' &&
      (req.url ?? '').split('?')[0] === '/__pedidos-de-filiacao'
    ) {
      return responder(pedidosDeFiliacao)
    }

    // ---- Pedido de atendimento (v5.5a): contato, pedido de informação, solicitação do titular. API ANTIGA: a rota não existe (cai no 404 do fim).
    if (
      !antiga &&
      req.method === 'POST' &&
      (req.url ?? '').split('?')[0] === '/api/publico/atendimentos'
    ) {
      let texto = ''
      req.on('data', (parte) => (texto += parte))
      req.on('end', () => {
        let corpo
        try {
          corpo = JSON.parse(texto)
        } catch {
          return responder({ detail: 'Corpo inválido.' }, 422)
        }
        pedidosDeAtendimento.push(corpo)
        // armadilha de robô disparada: finge sucesso, sem protocolo e sem gravar nada
        if (corpo.pagina_web)
          return responder({
            mensagem: 'Pedido recebido.',
            protocolo: null,
            prazo_dias: null,
            prazo_em: null,
          })
        const dias = PRAZOS_DE_ATENDIMENTO[corpo.tipo]
        if (!dias)
          return responder(
            {
              detail: [
                {
                  type: 'literal_error',
                  loc: ['body', 'tipo'],
                  msg: "Input should be 'CONTATO', 'PEDIDO_INFORMACAO', 'TITULAR_LGPD' or 'VOLUNTARIO'",
                },
              ],
            },
            422,
          )
        if (corpo.tipo === 'VOLUNTARIO') {
          const recusa = recusaDoVoluntariado(corpo)
          if (recusa)
            return responder(
              {
                detail: [
                  {
                    type: 'value_error',
                    loc: ['body'],
                    msg: `Value error, ${recusa}`,
                  },
                ],
              },
              422,
            )
        }
        if (corpo.nome_completo === NOME_QUE_ESTOURA_O_LIMITE)
          return responder({ detail: RECUSA_DE_LIMITE }, 429)
        if (corpo.nome_completo === NOME_QUE_DERRUBA_O_ATENDIMENTO)
          return responder({ detail: 'Erro interno do servidor.' }, 500)
        if (!corpo.consentimento_lgpd)
          return responder(
            {
              detail:
                'Para enviar o pedido é preciso ler e aceitar o aviso de privacidade.',
            },
            400,
          )
        if (corpo.versao_texto_consentimento !== VERSAO_DO_AVISO_DE_ATENDIMENTO)
          return responder({ detail: RECUSA_DE_AVISO_DESATUALIZADO }, 422)
        protocolosDeAtendimento += 1
        const ano = new Date(agora()).getUTCFullYear()
        // `prazo_em` como a API real devolve: UTC, sem fuso na ponta
        const prazoEm = new Date(agora() + dias * 86_400_000)
          .toISOString()
          .replace(/Z$/, '')
        return responder({
          mensagem: 'Pedido recebido.',
          protocolo: `ASAF-${ano}-${String(protocolosDeAtendimento).padStart(5, '0')}`,
          prazo_dias: dias,
          prazo_em: prazoEm,
        })
      })
      return
    }
    if (
      req.method === 'GET' &&
      (req.url ?? '').split('?')[0] === '/__pedidos-de-atendimento'
    ) {
      return responder(pedidosDeAtendimento)
    }

    // ---- Descadastro (v6.2b): o link assinado do fim dos e-mails que se podem desligar. Só os tokens de TOKENS_DE_DESCADASTRO valem (como o servidor, qualquer
    // outro é 404); a escolha fica na memória do mock, por token. API ANTIGA: a rota não existe.
    if (
      !antiga &&
      (req.url ?? '').split('?')[0] === '/api/publico/descadastro'
    ) {
      if (req.method === 'GET') {
        const token =
          new URL(req.url ?? '', 'http://x').searchParams.get('token') ?? ''
        const tipo = TOKENS_DE_DESCADASTRO[token]
        if (!tipo)
          return responder({ detail: 'Link inválido ou incompleto.' }, 404)
        return responder({
          tipo,
          rotulo: ROTULOS_DE_DESCADASTRO[tipo],
          recebe:
            escolhasDeDescadastro.get(token) ??
            token !== TOKEN_JA_DESCADASTRADO,
        })
      }
      if (req.method === 'POST') {
        let texto = ''
        req.on('data', (parte) => (texto += parte))
        req.on('end', () => {
          let corpo
          try {
            corpo = JSON.parse(texto)
          } catch {
            return responder({ detail: 'Corpo inválido.' }, 422)
          }
          const tipo = TOKENS_DE_DESCADASTRO[corpo.token]
          if (!tipo)
            return responder({ detail: 'Link inválido ou incompleto.' }, 404)
          escolhasDeDescadastro.set(corpo.token, corpo.recebe === true)
          return responder({
            tipo,
            rotulo: ROTULOS_DE_DESCADASTRO[tipo],
            recebe: corpo.recebe === true,
          })
        })
        return
      }
    }

    // ---- Conta do visitante (v5.6b). API ANTIGA: as rotas não existem (caem no 404 do fim).
    if (!antiga) {
      const caminhoDoVisitante = (req.url ?? '').split('?')[0]
      if (
        req.method === 'POST' &&
        (caminhoDoVisitante === '/api/publico/visitante/codigo' ||
          caminhoDoVisitante === '/api/publico/visitante/entrar')
      ) {
        let texto = ''
        req.on('data', (parte) => (texto += parte))
        req.on('end', () => {
          let corpo
          try {
            corpo = JSON.parse(texto)
          } catch {
            return responder({ detail: 'Corpo inválido.' }, 422)
          }
          const [status, resposta] =
            caminhoDoVisitante === '/api/publico/visitante/codigo'
              ? pedirCodigoDoVisitante(corpo)
              : entrarDoVisitante(corpo)
          return responder(resposta, status)
        })
        return
      }
      if (caminhoDoVisitante.startsWith('/api/visitante/')) {
        const { token, sessao } = sessaoDoCabecalho(req)
        const vencida =
          sessao &&
          sessao.email.startsWith('sessao-curta') &&
          sessao.leituras >= 1
        if (!sessao || vencida) {
          if (token) sessoesDeVisitante.delete(token)
          return responder(
            { detail: 'A sua sessão acabou: peça um novo código para entrar.' },
            401,
          )
        }
        if (
          req.method === 'GET' &&
          caminhoDoVisitante === '/api/visitante/minha-conta'
        ) {
          sessao.leituras += 1
          return responder(contaDoVisitante(sessao.email, sessao.expiraEm))
        }
        if (
          req.method === 'POST' &&
          caminhoDoVisitante === '/api/visitante/sair'
        ) {
          sessoesDeVisitante.delete(token)
          eventosDoVisitante.push({ tipo: 'saiu', email: sessao.email })
          return responder({ mensagem: 'Sessão encerrada.' })
        }
        if (
          req.method === 'POST' &&
          caminhoDoVisitante === '/api/visitante/pedir-apagamento'
        ) {
          const jaExistia = pedidosDeApagamentoDosVisitantes.has(sessao.email)
          if (!jaExistia)
            pedidosDeApagamentoDosVisitantes.set(sessao.email, {
              protocolo: 'ASAF-2026-00042',
              prazo_em: dataUtcDaquiA(15 * 24 * 60),
              status: 'Novo',
            })
          const pedido = pedidosDeApagamentoDosVisitantes.get(sessao.email)
          if (!jaExistia)
            eventosDoVisitante.push({ tipo: 'apagamento', email: sessao.email })
          return responder({
            mensagem: 'Pedido recebido.',
            protocolo: pedido.protocolo,
            prazo_dias: 15,
            prazo_em: pedido.prazo_em,
            ja_existia: jaExistia,
          })
        }
      }
      if (req.method === 'GET' && caminhoDoVisitante === '/__visitante') {
        return responder(eventosDoVisitante)
      }
    }

    // ---- Inscrição em evento pelo site (v5.5c): inscrever-se, cancelar e confirmar pelo código do link. API ANTIGA: as rotas não existem (caem no 404 do fim).
    if (!antiga && req.method === 'POST') {
      const caminhoPost = (req.url ?? '').split('?')[0]
      const inscrever = /^\/api\/publico\/eventos\/(\d+)\/inscrever-se$/.exec(
        caminhoPost,
      )
      const agir =
        /^\/api\/publico\/inscricoes\/([^/]+)\/(cancelar|confirmar)$/.exec(
          caminhoPost,
        )
      if (inscrever || agir) {
        let texto = ''
        req.on('data', (parte) => (texto += parte))
        req.on('end', () => {
          if (agir) {
            const [status, resposta] = agirNaInscricao(
              decodeURIComponent(agir[1]),
              agir[2],
            )
            return responder(resposta, status)
          }
          let corpo
          try {
            corpo = JSON.parse(texto)
          } catch {
            return responder({ detail: 'Corpo inválido.' }, 422)
          }
          const [status, resposta] = inscreverNoEvento(
            Number(inscrever[1]),
            corpo,
          )
          return responder(resposta, status)
        })
        return
      }
    }
    if (
      !antiga &&
      req.method === 'GET' &&
      (req.url ?? '').split('?')[0] === '/__inscricoes-de-evento'
    ) {
      return responder(inscricoesDeEvento)
    }

    // ---- Doar pelo site (v5.6a): o pedido identificado (protocolo e código Pix). API ANTIGA: a rota não existe (cai no 404 do fim).
    if (
      !antiga &&
      req.method === 'POST' &&
      (req.url ?? '').split('?')[0] === '/api/publico/doacoes/intencoes'
    ) {
      let texto = ''
      req.on('data', (parte) => (texto += parte))
      req.on('end', () => {
        let corpo
        try {
          corpo = JSON.parse(texto)
        } catch {
          return responder({ detail: 'Corpo inválido.' }, 422)
        }
        const [status, resposta] = registrarIntencaoDeDoacao(corpo, {
          vazio,
          semPix,
        })
        return responder(resposta, status)
      })
      return
    }
    if (
      !antiga &&
      req.method === 'GET' &&
      (req.url ?? '').split('?')[0] === '/__pedidos-de-doacao'
    ) {
      return responder(pedidosDeDoacao)
    }

    // ---- Directus simulado (v5.3): `Authorization: Bearer <token>` obrigatório, como no real.
    if (
      req.method === 'GET' &&
      (req.url ?? '').startsWith(PREFIXO_DO_DIRECTUS + '/')
    ) {
      const caminhoDirectus = (req.url ?? '')
        .slice(PREFIXO_DO_DIRECTUS.length)
        .split('?')[0]
      if (req.headers.authorization !== `Bearer ${TOKEN_DO_MOCK}`) {
        return responder(
          { errors: [{ message: 'Invalid user credentials.' }] },
          401,
        )
      }
      if (caminhoDirectus === '/items/noticias') {
        return responder({
          data: vazio
            ? []
            : comoVier(noticiasDoDirectus(), CAMPOS_NOVOS.noticia),
        })
      }
      if (caminhoDirectus === `/assets/${ID_DA_FOTO_DE_TESTE}`) {
        fotoWebp().then((bytes) => {
          res.writeHead(200, { ...cors, 'Content-Type': 'image/webp' })
          res.end(bytes)
        })
        return
      }
      return responder({ errors: [{ message: 'Não encontrado.' }] }, 404)
    }

    if (req.method === 'GET') {
      const caminho = (req.url ?? '').split('?')[0]
      // v5.4h - os dados da Instituição marcados "vai para o site". Como na produção de hoje: o nome e o CNPJ de exemplo (inválido: o site o ignora); com
      // `instituicaoPreenchida`, a diretoria "preencheu" (para o teste provar que o site passa a mostrar). API antiga: a rota não existe.
      if (caminho === '/api/publico/instituicao') {
        if (antiga) return responder({ detail: 'Not Found' }, 404)
        return responder(
          instituicaoPreenchida
            ? {
                NOME_INSTITUICAO: 'ASAF - Associação Arca da Família',
                CNPJ: '11.222.333/0001-81',
                TELEFONE_INSTITUCIONAL: '(94) 99999-8888',
                EMAIL_INSTITUCIONAL: 'contato.teste@asaf.org.br',
                HORARIO_ATENDIMENTO: 'Segunda a sexta, das 8h às 17h',
                SITE_INSTAGRAM: '@asaf.teste',
                SITE_FACEBOOK: 'https://www.facebook.com/asaf.teste',
              }
            : {
                NOME_INSTITUICAO: 'ASAF - Associação Arca da Família',
                CNPJ: '00.000.000/0001-00',
                COR_PRIMARIA: '#1D4ED8',
                COR_SECUNDARIA: '#64748B',
              },
        )
      }
      // v5.5a - os prazos de resposta de cada tipo de pedido, em dias. API antiga: a rota não existe.
      if (caminho === '/api/publico/atendimentos/prazos') {
        if (antiga) return responder({ detail: 'Not Found' }, 404)
        return responder(PRAZOS_DE_ATENDIMENTO)
      }
      // v5.6a - doar pelo site: o Pix da associação, as campanhas e a versão do aviso; e o código Pix para doar sem se identificar. API antiga: as rotas não existem.
      if (!antiga && caminho === '/api/publico/doacao')
        return responder(dadosDaDoacao({ vazio, semPix }))
      if (!antiga && caminho === '/api/publico/doacao/pix') {
        const [status, resposta] = pixDaDoacaoAnonima(
          new URL(req.url ?? '', 'http://mock').searchParams,
          { vazio, semPix },
        )
        return responder(resposta, status)
      }
      // v5.5c - o texto do consentimento da inscrição e a versão que a API confere; e o resumo de uma inscrição pelo código do link. API antiga: não existem.
      if (!antiga && caminho === '/api/publico/eventos/consentimento-lgpd')
        return responder({
          texto: TEXTO_DO_CONSENTIMENTO_DE_EVENTO,
          versao: VERSAO_DO_CONSENTIMENTO_DE_EVENTO,
          paragrafos: PARAGRAFOS_DO_AVISO_DE_EVENTO,
        })
      const inscricaoDoLink = /^\/api\/publico\/inscricoes\/([^/]+)$/.exec(
        caminho,
      )
      if (!antiga && inscricaoDoLink) {
        const inscricao = inscricaoPorCodigo(
          decodeURIComponent(inscricaoDoLink[1]),
        )
        if (inscricao?.consulta === 429)
          return responder({ detail: RECUSA_DE_LIMITE }, 429)
        if (inscricao?.consulta === 500)
          return responder({ detail: 'Erro interno do servidor.' }, 500)
        return inscricao
          ? responder(resumoDaInscricao(inscricao))
          : responder(
              {
                detail: 'Link inválido: confira o endereço que veio no e-mail.',
              },
              404,
            )
      }
      if (caminho === '/api/publico/eventos')
        return responder(comoVier(lista(eventos), CAMPOS_NOVOS.eventoDaLista))
      if (caminho === '/api/publico/projetos')
        return responder(comoVier(lista(projetos), CAMPOS_NOVOS.projetoDaLista))
      const projeto = /^\/api\/publico\/projetos\/(\d+)$/.exec(caminho)
      if (projeto) {
        const detalhe = vazio ? null : detalheDoProjeto(Number(projeto[1]))
        return detalhe
          ? responder(comoVier(detalhe, CAMPOS_NOVOS.projetoDetalhado))
          : responder({ detail: 'Projeto não encontrado.' }, 404)
      }
      if (caminho === '/api/publico/diretoria')
        return responder(
          comoVier(lista(diretoria), CAMPOS_NOVOS.membroDaDiretoria),
        )
      // Foto de quem está na Diretoria (v5.7c): o JPEG já regravado, com o mesmo SHA-256 que a lista declara. API antiga: a rota não existe.
      // `fotoDaDiretoriaAdulterada`: serve um arquivo DIFERENTE do declarado (o build tem de recusar a foto, e só ela).
      const fotoDaDiretoria = /^\/api\/publico\/diretoria\/fotos\/(\d+)$/.exec(
        caminho,
      )
      if (fotoDaDiretoria) {
        const foto =
          vazio || antiga
            ? undefined
            : Object.values(FOTOS_DA_DIRETORIA).find(
                (f) => f.id_foto === Number(fotoDaDiretoria[1]),
              )
        if (!foto) return responder({ detail: 'Foto não encontrada.' }, 404)
        const bytes = fotoDaDiretoriaAdulterada
          ? Buffer.concat([foto.bytes, Buffer.from([0])])
          : foto.bytes
        res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' })
        res.end(bytes)
        return
      }
      if (caminho === '/api/publico/assembleias') {
        return responder(lista(assembleias))
      }
      if (caminho === '/api/publico/transparencia/parcerias')
        return responder(lista(parcerias))
      // v6.3b - as contas do exercício publicadas; a API antiga não tem a rota (o build segue sem contas)
      if (caminho === '/api/publico/transparencia/contas')
        return antiga
          ? responder({ detail: 'Not Found' }, 404)
          : responder(lista(contas))
      // v6.3c - o relatório anual publicado; a API antiga não tem a rota (o build segue sem relatório)
      if (caminho === '/api/publico/transparencia/relatorios-anuais')
        return antiga
          ? responder({ detail: 'Not Found' }, 404)
          : responder(lista(relatoriosAnuais))
      if (caminho === '/api/publico/transparencia/documentos')
        return responder(comoVier(lista(documentos), CAMPOS_NOVOS.documento))
      const parceria = /^\/api\/publico\/transparencia\/parcerias\/(\d+)$/.exec(
        caminho,
      )
      if (parceria) {
        const detalhe = vazio ? null : detalheDaParceria(Number(parceria[1]))
        return detalhe
          ? responder(detalhe)
          : responder({ detail: 'Parceria não encontrada.' }, 404)
      }
      const detalheDoDocumento =
        /^\/api\/publico\/transparencia\/documentos\/(\d+)$/.exec(caminho)
      if (detalheDoDocumento) {
        const documento = vazio
          ? undefined
          : documentos().find(
              (d) => d.id_documento === Number(detalheDoDocumento[1]),
            )
        if (!documento)
          return responder({ detail: 'Documento não encontrado.' }, 404)
        return responder(
          comoVier(
            {
              ...documento,
              texto:
                documento.formato === 'TEXTO'
                  ? TEXTOS_DE_TESTE[documento.id_documento]
                  : null,
            },
            CAMPOS_NOVOS.documento,
          ),
        )
      }
      if (
        !vazio &&
        /^\/api\/publico\/transparencia\/parcerias\/1\/fotos\/1$/.test(caminho)
      ) {
        res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' })
        res.end(FOTO_DA_ETAPA_DE_TESTE)
        return
      }
      const arquivoDoDocumento =
        /^\/api\/publico\/transparencia\/documentos\/(\d+)\/arquivo$/.exec(
          caminho,
        )
      if (arquivoDoDocumento) {
        const bytes = vazio ? undefined : PDFS_DE_TESTE[arquivoDoDocumento[1]]
        if (!bytes)
          return responder({ detail: 'Documento não encontrado.' }, 404)
        res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf' })
        res.end(bytes)
        return
      }
      // Foto de um evento (v5.5): o JPEG já regravado, com o mesmo SHA-256 que o detalhe declara.
      const fotoDeEvento =
        /^\/api\/publico\/eventos\/(\d+)\/fotos\/(\d+)$/.exec(caminho)
      if (fotoDeEvento) {
        const foto =
          vazio || antiga
            ? undefined
            : FOTOS_DE_EVENTO.find(
                (f) =>
                  f.id_evento === Number(fotoDeEvento[1]) &&
                  f.id_foto === Number(fotoDeEvento[2]),
              )
        if (!foto) return responder({ detail: 'Foto não encontrada.' }, 404)
        res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg' })
        res.end(foto.bytes)
        return
      }
      const evento = /^\/api\/publico\/eventos\/(\d+)$/.exec(caminho)
      if (evento) {
        const detalhe = vazio ? null : detalheDoEvento(Number(evento[1]))
        return detalhe
          ? responder(comoVier(detalhe, CAMPOS_NOVOS.eventoDetalhado))
          : responder({ detail: 'Evento não encontrado.' }, 404)
      }
    }

    responder({ detail: 'Não encontrado.' }, 404)
  })
}

// Executado direto (`node scripts/mock-api.mjs`, como o Playwright faz): sobe na porta do mock.
const executadoDireto =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (executadoDireto) {
  criarServidor({
    vazio: process.env.MOCK_API_VAZIO === '1',
    antiga: process.env.MOCK_API_ANTIGA === '1',
    instituicaoPreenchida: process.env.MOCK_INSTITUICAO_PREENCHIDA === '1',
    fotoDaDiretoriaAdulterada:
      process.env.MOCK_FOTO_DA_DIRETORIA_ADULTERADA === '1',
    semPix: process.env.MOCK_API_SEM_PIX === '1',
  }).listen(PORTA_DO_MOCK, '127.0.0.1', () =>
    console.log(`mock-api em http://127.0.0.1:${PORTA_DO_MOCK}`),
  )
}
