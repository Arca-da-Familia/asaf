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
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PORTA_DO_MOCK = Number(process.env.MOCK_API_PORT ?? 4322)
// Mesmas origens que a API real libera para o site em desenvolvimento (app/main.py).
const ORIGENS_PERMITIDAS = new Set([
  'http://127.0.0.1:4321',
  'http://localhost:4321',
])

/** "AAAA-MM-DDT19:00:00" daqui a `dias` dias — formato sem fuso, como a API real devolve. */
function dataLocal(dias, hora = 19) {
  const d = new Date(Date.now() + dias * 86_400_000)
  const dia = d.toISOString().slice(0, 10)
  return `${dia}T${String(hora).padStart(2, '0')}:00:00`
}

const soData = (dias) => dataLocal(dias).slice(0, 10)

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
  ]
}

function detalheDoEvento(id) {
  const evento = eventos().find((e) => e.id_evento === id)
  if (!evento) return null
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
  return { ...evento, sessoes, perguntas: [] }
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
  },
]

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
    cargo: 'Secretário',
    nome: 'João de Teste Souza',
    data_inicio: soData(-100),
    data_fim_previsto: soData(1360),
  },
  {
    orgao_codigo: 'CONSELHO_FISCAL',
    orgao: 'Conselho Fiscal',
    cargo_codigo: 'CONSELHO_FISCAL',
    cargo: 'Conselho Fiscal',
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

export function criarServidor({ vazio = false } = {}) {
  const lista = (dados) => (vazio ? [] : dados())
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

    if (req.method === 'GET') {
      const caminho = (req.url ?? '').split('?')[0]
      if (caminho === '/api/publico/eventos') return responder(lista(eventos))
      if (caminho === '/api/publico/projetos') return responder(lista(projetos))
      if (caminho === '/api/publico/diretoria')
        return responder(lista(diretoria))
      if (caminho === '/api/publico/assembleias') {
        return responder(lista(assembleias))
      }
      const evento = /^\/api\/publico\/eventos\/(\d+)$/.exec(caminho)
      if (evento) {
        const detalhe = vazio ? null : detalheDoEvento(Number(evento[1]))
        return detalhe
          ? responder(detalhe)
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
  criarServidor({ vazio: process.env.MOCK_API_VAZIO === '1' }).listen(
    PORTA_DO_MOCK,
    '127.0.0.1',
    () => console.log(`mock-api em http://127.0.0.1:${PORTA_DO_MOCK}`),
  )
}
