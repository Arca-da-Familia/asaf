import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { AuditoriaFinanceiraPage } from '@/pages/AuditoriaFinanceira'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAuditoriaFinanceira: vi.fn(),
  decidirTituloNaAuditoria: vi.fn(),
  aprovarEmLoteNaAuditoria: vi.fn(),
  listarPlanoContas: vi.fn(),
}))

const titulo = (
  id: number,
  descricao: string,
  extra: Partial<api.TituloNaAuditoria> = {},
): api.TituloNaAuditoria => ({
  id_titulo: id,
  tipo_titulo: 'A Pagar',
  descricao,
  conta_contabil: 'Material de escritório',
  beneficiario: 'Papelaria Central',
  valor_original: 120,
  saldo_devedor: 120,
  data_vencimento: '2026-10-10',
  status: 'Pendente',
  situacao: 'Pendente',
  aprovacoes: 0,
  quorum: 2,
  minha_decisao: null,
  sou_parte: false,
  decisoes: [],
  ...extra,
})

function lista(
  itens: api.TituloNaAuditoria[],
  pode_decidir = true,
): api.ListaDaAuditoriaFinanceira {
  return {
    itens,
    total: itens.length,
    pagina: 1,
    por_pagina: 25,
    resumo: {
      Pendente: itens.filter((i) => i.situacao === 'Pendente').length,
      Suspenso: itens.filter((i) => i.situacao === 'Suspenso').length,
      Aprovado: itens.filter((i) => i.situacao === 'Aprovado').length,
      total: itens.length,
    },
    quorum: 2,
    pode_decidir,
  }
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/?mes=2026-10']}>
        <AuditoriaFinanceiraPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const cartao = (descricao: string) =>
  screen
    .getByText(new RegExp(`— ${descricao}$`))
    .closest('div.rounded-md') as HTMLElement

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarPlanoContas).mockResolvedValue([])
  vi.mocked(api.decidirTituloNaAuditoria).mockResolvedValue({
    id_auditoria: 1,
    decisao: 'Aprovado',
    situacao: 'Pendente',
    aprovacoes: 1,
    quorum: 2,
    id_questionamento: null,
  })
})

describe('Auditoria financeira', () => {
  it('mostra o resumo do mês, a situação de cada título e quantos conselheiros precisam concordar; passa no axe', async () => {
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([
        titulo(1, 'Resma de papel'),
        titulo(2, 'Toner', {
          situacao: 'Suspenso',
          decisoes: [
            {
              id_auditoria: 5,
              conselheiro: 'Heitor',
              decisao: 'Com ressalva',
              observacao: 'Falta a nota fiscal.',
              em: null,
              vigente: true,
              questionamento: 'Aberto',
            },
          ],
        }),
        titulo(3, 'Café', { situacao: 'Aprovado', aprovacoes: 2 }),
      ]),
    )
    const { container } = desenhar()
    expect(await screen.findByText(/— Resma de papel$/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /3 título\(s\) no mês · 1 pendente\(s\) · 1 suspenso\(s\) · 1 aprovado\(s\) · Para aprovar, 2 conselheiros precisam concordar\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Pendente: 0 de 2 aprovações')).toBeInTheDocument()
    expect(
      screen.getByText('Suspenso: aguardando a resposta da tesouraria'),
    ).toBeInTheDocument()
    expect(screen.getByText('Aprovado (2 de 2) — travado')).toBeInTheDocument()
    expect(screen.getByText(/Heitor/).closest('li')).toHaveTextContent(
      /Falta a nota fiscal\.” \(pergunta aberta\)/,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('quem só lê (tesouraria, diretoria) não vê botão de decidir nem o lote', async () => {
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([titulo(1, 'Resma de papel')], false),
    )
    desenhar()
    await screen.findByText(/— Resma de papel$/)
    expect(screen.queryByRole('button', { name: /Aprovar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Reprovar/ })).toBeNull()
  })

  it('o conselheiro aprova com um clique, e a resposta recarrega a lista', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([titulo(1, 'Resma de papel')]),
    )
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Aprovar: Resma de papel' }),
    )
    await waitFor(() =>
      expect(api.decidirTituloNaAuditoria).toHaveBeenCalledWith(1, {
        decisao: 'Aprovado',
      }),
    )
    await waitFor(() =>
      expect(vi.mocked(api.listarAuditoriaFinanceira).mock.calls.length).toBe(
        2,
      ),
    )
  })

  it('ressalva e reprovação só seguem com a explicação (10 letras ou mais) e a enviam', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([titulo(1, 'Resma de papel')]),
    )
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Com ressalva: Resma de papel',
      }),
    )
    const confirmar = screen.getByRole('button', { name: 'Confirmar ressalva' })
    expect(confirmar).toBeDisabled()
    const explicacao = screen.getByLabelText('Explicação (obrigatória)')
    await u.type(explicacao, 'curto')
    expect(confirmar).toBeDisabled()
    await u.type(explicacao, ' demais, falta a nota fiscal')
    expect(confirmar).toBeEnabled()
    await u.click(confirmar)
    await waitFor(() =>
      expect(api.decidirTituloNaAuditoria).toHaveBeenCalledWith(1, {
        decisao: 'Com ressalva',
        observacao: 'curto demais, falta a nota fiscal',
      }),
    )
  })

  it('cancelar a explicação não envia nada', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([titulo(1, 'Resma de papel')]),
    )
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Reprovar: Resma de papel' }),
    )
    await u.type(
      screen.getByLabelText('Explicação (obrigatória)'),
      'não concordo com o valor',
    )
    await u.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Explicação (obrigatória)')).toBeNull()
    expect(api.decidirTituloNaAuditoria).not.toHaveBeenCalled()
  })

  it('a recusa do servidor aparece no próprio título, em português', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([titulo(1, 'Resma de papel')]),
    )
    vi.mocked(api.decidirTituloNaAuditoria).mockRejectedValue(
      new Error(
        'Este título já foi aprovado pelo Conselho Fiscal e está travado.',
      ),
    )
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Aprovar: Resma de papel' }),
    )
    expect(
      await within(cartao('Resma de papel')).findByRole('alert'),
    ).toHaveTextContent('está travado')
  })

  it('título em que o conselheiro é parte não tem botões e diz por quê; o aprovado só oferece reabrir', async () => {
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([
        titulo(1, 'Meu reembolso', { sou_parte: true }),
        titulo(2, 'Café', { situacao: 'Aprovado', aprovacoes: 2 }),
      ]),
    )
    desenhar()
    await screen.findByText(/— Meu reembolso$/)
    expect(
      within(cartao('Meu reembolso')).getByText(
        'Você é parte deste título e não o audita.',
      ),
    ).toBeInTheDocument()
    expect(within(cartao('Meu reembolso')).queryByRole('button')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Reabrir auditoria: Café' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar: Café' })).toBeNull()
  })

  it('aprovar em lote pede confirmação, vale para o mês do filtro e conta o que foi pulado', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarAuditoriaFinanceira).mockResolvedValue(
      lista([titulo(1, 'Resma de papel'), titulo(2, 'Toner')]),
    )
    vi.mocked(api.aprovarEmLoteNaAuditoria).mockResolvedValue({
      aprovados: 2,
      ignorados: {
        ja_aprovados_por_voce: 0,
        suspensos: 1,
        ja_travados: 0,
        seus: 0,
        com_decisao_sua_diferente: 0,
      },
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Aprovar os pendentes do filtro',
      }),
    )
    expect(api.aprovarEmLoteNaAuditoria).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Aprovar de uma vez os títulos pendentes de 2026-10\?/),
    ).toBeInTheDocument()
    await u.click(
      screen.getByRole('button', { name: 'Confirmar aprovação em lote' }),
    )
    await waitFor(() =>
      expect(api.aprovarEmLoteNaAuditoria).toHaveBeenCalledWith({
        mes: '2026-10',
        tipo_titulo: undefined,
        id_conta_contabil: undefined,
        busca: undefined,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '2 título(s) aprovado(s) por você. Pulados: 1 suspenso(s).',
    )
  })
})
