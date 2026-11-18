import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiPortaria from '@/lib/api-portaria'
import { ErroPortaria } from '@/lib/api-portaria'
import {
  enfileirarCheckin,
  HORAS_NO_APARELHO,
  listarFilaPortaria,
  soOFimDaCredencial,
  sincronizarFilaPortaria,
} from '@/lib/portaria-queue'

// v9.5i (conferência independente da Política 2.19): com o QR da credencial que não vence, o aparelho da portaria não pode ficar com o código inteiro de
// quem passou (ele abre a página de conferência daquela pessoa). Enviado OU recusado, fica só o fim; e o que terminou sai do aparelho depois de umas horas.

vi.mock('@/lib/api-portaria', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-portaria')>()),
  registrarCheckin: vi.fn(),
  registrarCheckout: vi.fn(),
}))

const CODIGO = 'AbCdEfGhIjKlMnOpQrStUv'
const LIDO = `https://painel.asaf.org.br/credencial/${CODIGO}`

async function esperarTerminar() {
  for (let i = 0; i < 50; i++) {
    await sincronizarFilaPortaria()
    const itens = await listarFilaPortaria()
    if (itens.every((x) => x.status === 'sincronizado' || x.status === 'erro'))
      return itens
    await new Promise((r) => setTimeout(r, 10))
  }
  return listarFilaPortaria()
}

beforeEach(async () => {
  vi.resetAllMocks()
  // cada teste começa com a fila vazia (o banco do navegador simulado vive entre os testes)
  // (antes, deixa terminar o envio em segundo plano que o teste anterior disparou: ele regravaria o item depois da limpeza)
  await new Promise((r) => setTimeout(r, 100))
  const { openDB } = await import('idb')
  const db = await openDB('asaf-portaria-fila', 1, {
    upgrade(banco) {
      banco
        .createObjectStore('fila', { keyPath: 'chave_idempotencia' })
        .createIndex('criado_em', 'criado_em')
    },
  })
  await db.clear('fila')
  db.close()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Fila da portaria (v9.5i)', () => {
  it('enviado: fica só o fim do código da credencial, e a saída pede para ler o QR de novo', async () => {
    vi.mocked(apiPortaria.registrarCheckin).mockResolvedValue({} as never)
    await enfileirarCheckin('token-da-portaria', {
      metodo: 'carteirinha',
      token_carteirinha: LIDO,
    })
    const [item] = await esperarTerminar()
    expect(apiPortaria.registrarCheckin).toHaveBeenCalledWith(
      'token-da-portaria',
      expect.objectContaining({ token_carteirinha: LIDO }),
    )
    expect(item!.status).toBe('sincronizado')
    expect(item!.payload.token_carteirinha).toBe('credencial ····StUv')
    expect(JSON.stringify(item)).not.toContain(CODIGO)
    expect(soOFimDaCredencial(item!)).toBe(true)
  })

  it('recusado pelo servidor: também fica só o fim do código', async () => {
    vi.mocked(apiPortaria.registrarCheckin).mockRejectedValue(
      new ErroPortaria(400, 'Já tem check-in.'),
    )
    await enfileirarCheckin('token-da-portaria', {
      metodo: 'carteirinha',
      token_carteirinha: LIDO,
    })
    const [item] = await esperarTerminar()
    expect(item!.status).toBe('erro')
    expect(JSON.stringify(item)).not.toContain(CODIGO)
    expect(soOFimDaCredencial(item!)).toBe(true)
  })

  it('sem internet: o código inteiro fica até ser enviado (é ele que vai ao servidor)', async () => {
    vi.mocked(apiPortaria.registrarCheckin).mockRejectedValue(
      new ErroPortaria(apiPortaria.STATUS_FALHA_DE_REDE, 'sem rede'),
    )
    await enfileirarCheckin('token-da-portaria', {
      metodo: 'carteirinha',
      token_carteirinha: LIDO,
    })
    await sincronizarFilaPortaria()
    const [item] = await listarFilaPortaria()
    expect(item!.status).toBe('pendente')
    expect(item!.payload.token_carteirinha).toBe(LIDO)
  })

  it(`o que terminou sai do aparelho depois de ${HORAS_NO_APARELHO} horas; o que não foi enviado fica`, async () => {
    vi.mocked(apiPortaria.registrarCheckin).mockResolvedValue({} as never)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() - (HORAS_NO_APARELHO + 1) * 3_600_000))
    await enfileirarCheckin('token-da-portaria', {
      metodo: 'codigo',
      codigo: 'ABCD1234',
    })
    await esperarTerminar()
    vi.mocked(apiPortaria.registrarCheckin).mockRejectedValue(
      new ErroPortaria(apiPortaria.STATUS_FALHA_DE_REDE, 'sem rede'),
    )
    await enfileirarCheckin('token-da-portaria', {
      metodo: 'codigo',
      codigo: 'EFGH5678',
    })
    await sincronizarFilaPortaria()
    vi.useRealTimers()
    const itens = await listarFilaPortaria()
    expect(itens.map((i) => i.payload.codigo)).toEqual(['EFGH5678'])
  })
})
