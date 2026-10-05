import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { criarServidor } from '../scripts/mock-api.mjs'

// O mock usa datas relativas ao dia de hoje. A sincronização compara a API do build com a API de agora: se a virada do dia
// (UTC) cair entre as duas leituras, a API "mudaria" sozinha e o teste acusaria reconstrução sem parar (aconteceu no CI à
// meia-noite UTC de 2026-10-05). `MOCK_AGORA` fixa o dia de referência do mock.
const CAMINHOS = [
  '/api/publico/eventos',
  '/api/publico/projetos',
  '/api/publico/transparencia/documentos',
]

async function ler(): Promise<string> {
  const servidor = criarServidor()
  await new Promise<void>((resolver) =>
    servidor.listen(0, '127.0.0.1', resolver),
  )
  const { port } = servidor.address() as AddressInfo
  try {
    const partes: string[] = []
    for (const caminho of CAMINHOS) {
      const resposta = await fetch(`http://127.0.0.1:${port}${caminho}`)
      partes.push(await resposta.text())
    }
    return createHash('sha256').update(partes.join('\n')).digest('hex')
  } finally {
    await new Promise((resolver) => servidor.close(resolver))
  }
}

describe('mock da API: dia de referência', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.MOCK_AGORA
  })

  it('sem MOCK_AGORA as datas acompanham o relógio (vira o dia, mudam)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T23:59:30Z'))
    const antes = await ler()
    vi.setSystemTime(new Date('2026-10-05T00:00:30Z'))
    const depois = await ler()
    expect(depois).not.toBe(antes)
  })

  it('com MOCK_AGORA a virada do dia NÃO muda a API (o teste de sincronização fica estável)', async () => {
    process.env.MOCK_AGORA = '2026-10-04T23:59:30Z'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T23:59:30Z'))
    const antes = await ler()
    vi.setSystemTime(new Date('2026-10-05T00:01:30Z'))
    const depois = await ler()
    expect(depois).toBe(antes)
  })

  it('MOCK_AGORA diferente dá datas diferentes (a referência é mesmo usada)', async () => {
    process.env.MOCK_AGORA = '2026-01-10T10:00:00Z'
    const a = await ler()
    process.env.MOCK_AGORA = '2026-03-10T10:00:00Z'
    const b = await ler()
    expect(b).not.toBe(a)
  })
})
