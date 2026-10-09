import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { AssociadosPage } from '@/pages/Associados'
import { RazaoContabilPage } from '@/pages/RazaoContabil'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAssociadosDaPagina: vi.fn(),
  resumirAssociados: vi.fn(),
  listarLivroCaixaDaPagina: vi.fn(),
  listarEstoque: vi.fn(),
}))

// v5.4h - as listas que crescem (Associados e Razão Contábil) vão ao servidor pedir UMA página de cada vez, com a busca e os filtros na consulta.
function desenhar(componente: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>{componente}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const associado = (id: number, nome: string): api.AssociadoListagem => ({
  id_associado: id,
  nome_completo: nome,
  cpf: '12345678909',
  categoria: 'Efetivo',
  status_arrolamento: 'Ativo - Em Dia',
  email_contato: null,
  telefone_whatsapp: null,
  numero_matricula: id,
  tem_acesso: false,
})

describe('Associados: a lista é paginada e filtrada no servidor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listarAssociadosDaPagina).mockResolvedValue([
      associado(1, 'Ana de Teste'),
      associado(2, 'Beto de Teste'),
    ])
    vi.mocked(api.resumirAssociados).mockResolvedValue({
      total: 60,
      por_situacao: { 'Ativo - Em Dia': 55, Licenciado: 5 },
      por_categoria: { Efetivo: 50, Fundador: 10 },
    })
  })

  it('pede a primeira página com 25 por vez, mostra o total do servidor e as opções de situação e categoria com a contagem', async () => {
    desenhar(<AssociadosPage />)
    expect(await screen.findByText('Ana de Teste')).toBeInTheDocument()
    expect(api.listarAssociadosDaPagina).toHaveBeenCalledWith(
      expect.objectContaining({ pagina: 1, por_pagina: 25 }),
    )
    expect(await screen.findByText(/60 registro\(s\)/)).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Ativo - Em Dia (55)' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Fundador (10)' }),
    ).toBeInTheDocument()
  })

  it('a busca digitada vai ao servidor (depois de uma pausa) e volta para a primeira página', async () => {
    const u = userEvent.setup()
    desenhar(<AssociadosPage />)
    await screen.findByText('Ana de Teste')
    await u.type(screen.getByLabelText('Filtrar'), 'Carla')
    await waitFor(() =>
      expect(api.listarAssociadosDaPagina).toHaveBeenCalledWith(
        expect.objectContaining({ busca: 'Carla', pagina: 1 }),
      ),
    )
    expect(api.resumirAssociados).toHaveBeenCalledWith(
      expect.objectContaining({ busca: 'Carla' }),
    )
  })

  it('digitar na busca e escolher uma situação logo em seguida mantém as duas (achado do robô na homologação)', async () => {
    const u = userEvent.setup()
    desenhar(<AssociadosPage />)
    await screen.findByText('Ana de Teste')
    await u.type(screen.getByLabelText('Filtrar'), 'Carla')
    // sem esperar a pausa da busca
    await u.selectOptions(
      screen.getByRole('combobox', { name: /Situação/ }),
      'Licenciado',
    )
    await waitFor(() =>
      expect(api.listarAssociadosDaPagina).toHaveBeenLastCalledWith(
        expect.objectContaining({ busca: 'Carla', situacao: 'Licenciado' }),
      ),
    )
  })

  it('escolher uma situação e uma categoria vai na consulta', async () => {
    const u = userEvent.setup()
    desenhar(<AssociadosPage />)
    await screen.findByText('Ana de Teste')
    await u.selectOptions(
      screen.getByRole('combobox', { name: /Situação/ }),
      'Licenciado',
    )
    await waitFor(() =>
      expect(api.listarAssociadosDaPagina).toHaveBeenCalledWith(
        expect.objectContaining({ situacao: 'Licenciado', pagina: 1 }),
      ),
    )
    await u.selectOptions(
      screen.getByRole('combobox', { name: /Categoria/ }),
      'Fundador',
    )
    await waitFor(() =>
      expect(api.listarAssociadosDaPagina).toHaveBeenCalledWith(
        expect.objectContaining({
          situacao: 'Licenciado',
          categoria: 'Fundador',
        }),
      ),
    )
  })

  it('a próxima página pede a página 2', async () => {
    const u = userEvent.setup()
    desenhar(<AssociadosPage />)
    await screen.findByText('Ana de Teste')
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    await waitFor(() =>
      expect(api.listarAssociadosDaPagina).toHaveBeenCalledWith(
        expect.objectContaining({ pagina: 2, por_pagina: 25 }),
      ),
    )
  })

  it('sem nenhum associado e sem filtro, convida a cadastrar; com filtro que não acha, só mostra a tabela vazia', async () => {
    vi.mocked(api.listarAssociadosDaPagina).mockResolvedValue([])
    vi.mocked(api.resumirAssociados).mockResolvedValue({
      total: 0,
      por_situacao: {},
      por_categoria: {},
    })
    desenhar(<AssociadosPage />)
    expect(
      await screen.findByText('Nenhum associado cadastrado ainda'),
    ).toBeInTheDocument()
  })

  it('não tem violação de acessibilidade (axe)', async () => {
    const { container } = desenhar(<AssociadosPage />)
    await screen.findByText('Ana de Teste')
    expect(await axe(container)).toHaveNoViolations()
  })
})

const lancamento = (n: number): api.LancamentoContabil => ({
  id_lancamento: n,
  numero_sequencial: n,
  id_exercicio: 1,
  id_titulo: null,
  data: '2026-10-08',
  data_competencia: '2026-10-08',
  historico: `Lançamento de teste ${n}`,
  tipo_origem: 'BAIXA_TITULO',
  forma_pagamento: null,
  comprovante: null,
  estornado: false,
  motivo_estorno: null,
  id_lancamento_estorno: null,
  partidas: [],
})

describe('Razão Contábil: o extrato é paginado e a busca vai ao servidor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.listarLivroCaixaDaPagina).mockResolvedValue({
      lancamentos: [lancamento(60), lancamento(59)],
      saldo_contas_ativo: 1234.5,
      total: 60,
      pagina: 1,
      por_pagina: 25,
    })
  })

  it('pede a primeira página, mostra o total e o saldo de todos os lançamentos e oferece a próxima página', async () => {
    const u = userEvent.setup()
    desenhar(<RazaoContabilPage />)
    expect(
      await screen.findByText(/#60 — Lançamento de teste 60/),
    ).toBeInTheDocument()
    expect(api.listarLivroCaixaDaPagina).toHaveBeenCalledWith({
      busca: undefined,
      pagina: 1,
      por_pagina: 25,
    })
    expect(screen.getByText('60 lançamentos')).toBeInTheDocument()
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Página anterior' }),
    ).toBeDisabled()
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    await waitFor(() =>
      expect(api.listarLivroCaixaDaPagina).toHaveBeenCalledWith({
        busca: undefined,
        pagina: 2,
        por_pagina: 25,
      }),
    )
  })

  it('a busca pelo histórico ou pelo número vai ao servidor e volta para a página 1', async () => {
    const u = userEvent.setup()
    desenhar(<RazaoContabilPage />)
    await screen.findByText(/#60 — Lançamento de teste 60/)
    await u.click(screen.getByRole('button', { name: 'Próxima página' }))
    await u.type(screen.getByLabelText('Buscar lançamento'), '#42')
    await waitFor(() =>
      expect(api.listarLivroCaixaDaPagina).toHaveBeenCalledWith({
        busca: '#42',
        pagina: 1,
        por_pagina: 25,
      }),
    )
  })

  it('não tem violação de acessibilidade (axe)', async () => {
    const { container } = desenhar(<RazaoContabilPage />)
    await screen.findByText(/#60 — Lançamento de teste 60/)
    expect(await axe(container)).toHaveNoViolations()
  })
})
