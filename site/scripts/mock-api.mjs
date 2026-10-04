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

/** "AAAA-MM-DDT19:00:00" daqui a `dias` dias — formato sem fuso, como a API real devolve. */
function dataLocal(dias, hora = 19) {
  const d = new Date(Date.now() + dias * 86_400_000)
  const dia = d.toISOString().slice(0, 10)
  return `${dia}T${String(hora).padStart(2, '0')}:00:00`
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
  ]
}

/** O mínimo de um evento nas listas de contexto (edições do projeto, cadeia de edições). */
const resumoDoEvento = (e) => ({
  id_evento: e.id_evento,
  titulo: e.titulo,
  categoria: e.categoria,
  data_hora_inicio: e.data_hora_inicio,
  data_hora_fim: e.data_hora_fim,
  endereco_avulso: e.endereco_avulso,
})

/** Cadeia de edições (nova-edicao): as duas edições do projeto principal. Evento sem cadeia = só ele mesmo. */
const CADEIA_DE_EDICOES = { 4: [4, 5], 5: [4, 5] }

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
  const sessoes =
    id === 2
      ? [
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
      : []
  return { ...evento, sessoes, perguntas: [], ...contexto }
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
  },
  {
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    orgao: 'Diretoria Executiva',
    cargo_codigo: 'SECRETARIO',
    cargo: '1º Secretário',
    nome: 'João de Teste Souza',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
  },
  {
    orgao_codigo: 'CONSELHO_FISCAL',
    orgao: 'Conselho Fiscal',
    cargo_codigo: 'CONSELHO_FISCAL',
    cargo: 'Conselheiro Fiscal',
    nome: 'Ana de Teste Lima',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
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

/** O texto de cada documento em formato TEXTO (o detalhe do documento devolve o texto; o PDF não tem). */
const TEXTOS_DE_TESTE = {
  4: TEXTO_DO_ESTATUTO_DE_TESTE,
  5: TEXTO_DO_RELATORIO_DE_TESTE,
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
      versao: 1,
      vigente: true,
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
  ].map((d) => ({ vinculo_tipo: null, vinculo_id: null, ...d }))

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
  `${new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)}T12:00:00Z`

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
  eventoDaLista: ['id_projeto'],
  eventoDetalhado: ['id_projeto', 'projeto', 'edicoes', 'documentos', 'fotos'],
  projetoDaLista: ['destaque'],
  projetoDetalhado: ['destaque', 'eventos', 'documentos', 'fotos'],
  documento: ['vinculo_tipo', 'vinculo_id'],
  noticia: ['projeto_id', 'evento_id'],
}

/** Tira os campos novos (lista ou objeto): é assim que a API antiga responderia. */
function semCampos(corpo, campos) {
  const limpar = (objeto) =>
    Object.fromEntries(
      Object.entries(objeto).filter(([chave]) => !campos.includes(chave)),
    )
  return Array.isArray(corpo) ? corpo.map(limpar) : limpar(corpo)
}

/**
 * `vazio`: a produção sem nenhum dado cadastrado. `antiga`: a API ANTES da v5.5 — mesmos dados, mas sem destaque, sem
 * projeto no evento, sem edições, relatórios nem fotos e sem os campos de ligação das notícias (o site precisa
 * continuar construindo se for publicado antes da API nova).
 */
export function criarServidor({ vazio = false, antiga = false } = {}) {
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type',
      })
      res.end()
      return
    }

    const responder = (corpo, status = 200) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' })
      res.end(JSON.stringify(corpo))
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
        return responder(lista(diretoria))
      if (caminho === '/api/publico/assembleias') {
        return responder(lista(assembleias))
      }
      if (caminho === '/api/publico/transparencia/parcerias')
        return responder(lista(parcerias))
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
  }).listen(PORTA_DO_MOCK, '127.0.0.1', () =>
    console.log(`mock-api em http://127.0.0.1:${PORTA_DO_MOCK}`),
  )
}
