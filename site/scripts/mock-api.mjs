// API simulada só para teste e CI (v5.0): responde `GET /api/publico/eventos` com o mesmo formato
// da API real, na porta 4322. Existe para que o Playwright e o Lighthouse CI testem o site
// SEM depender da API de produção — dependência externa em portão de qualidade é flakiness
// (a API escala a zero) e, no primeiro deploy, a rota de CORS do site ainda nem estaria no ar.
//
// O fetch do site é de verdade (navegador -> HTTP -> JSON -> DOM); só o servidor é falso.
// Datas são sempre relativas a "hoje", para o teste nunca envelhecer.
import { createServer } from 'node:http'

const PORTA = Number(process.env.MOCK_API_PORT ?? 4322)
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

const servidor = createServer((req, res) => {
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

  if (req.method === 'GET' && req.url === '/api/publico/eventos') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' })
    res.end(JSON.stringify(eventos()))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ detail: 'Não encontrado.' }))
})

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`mock-api em http://127.0.0.1:${PORTA}`)
})
