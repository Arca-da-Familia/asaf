import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditoriaPage } from '@/pages/Auditoria'

import { renderizar } from './fabricas-despertai'

// v9.3f (pedido do Presidente, 06/11: "tem muita coisa que é tela de sistema, que não é para aparecer" — o sublinhado "dá a entender que aquilo
// é nome de uma tabela"): a Auditoria mostra o assunto e a ação em português; os filtros escolhem da lista, sem digitar nome técnico.

const api = vi.hoisted(() => ({
  listarAuditoria: vi.fn(),
  listarAcoesAuditoria: vi.fn(),
  listarTabelasAuditoria: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  ...api,
}))

beforeEach(() => {
  vi.clearAllMocks()
  api.listarAuditoria.mockResolvedValue({
    total: 1,
    pagina: 1,
    por_pagina: 25,
    entradas: [
      {
        id_log: 1,
        id_usuario: 3,
        nome_usuario: 'Ana Lúcia',
        tabela_afetada: 'titulos_financeiros',
        rotulo_tabela: 'Títulos financeiros',
        id_registro_afetado: 42,
        acao: 'BAIXA_TITULO',
        rotulo_acao: 'Pagamento de título registrado',
        ip_origem: '10.0.0.1',
        timestamp: '2026-11-06T13:00:00',
      },
    ],
  })
  api.listarAcoesAuditoria.mockResolvedValue([
    { valor: 'BAIXA_TITULO', rotulo: 'Pagamento de título registrado' },
  ])
  api.listarTabelasAuditoria.mockResolvedValue([
    { valor: 'titulos_financeiros', rotulo: 'Títulos financeiros' },
  ])
})

describe('Auditoria em português', () => {
  it('a linha mostra o nome em português, nunca o código', async () => {
    renderizar(<AuditoriaPage />, '/auditoria')
    const linha = (
      await screen.findByRole('cell', {
        name: 'Pagamento de título registrado',
      })
    ).closest('tr')!
    expect(within(linha).getByText('Títulos financeiros')).toBeInTheDocument()
    expect(linha).not.toHaveTextContent('BAIXA_TITULO')
    expect(linha).not.toHaveTextContent('titulos_financeiros')
    // o código fica num atributo, para a conferência automática
    expect(linha.querySelector('[data-acao="BAIXA_TITULO"]')).not.toBeNull()
  })

  it('os filtros são listas em português; escolher filtra pelo código', async () => {
    const user = userEvent.setup()
    renderizar(<AuditoriaPage />, '/auditoria')
    const assunto = await screen.findByLabelText('Assunto')
    await screen.findByRole('option', { name: 'Títulos financeiros' })
    await user.selectOptions(assunto, 'titulos_financeiros')
    expect(api.listarAuditoria).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabela_afetada: 'titulos_financeiros' }),
    )
    await screen.findByRole('option', {
      name: 'Pagamento de título registrado',
    })
    await user.selectOptions(
      screen.getByLabelText('O que aconteceu'),
      'BAIXA_TITULO',
    )
    expect(api.listarAuditoria).toHaveBeenLastCalledWith(
      expect.objectContaining({ acao: 'BAIXA_TITULO' }),
    )
  })

  it('o assunto pode vir no endereço', async () => {
    renderizar(<AuditoriaPage />, '/auditoria?tabela=titulos_financeiros')
    await screen.findByRole('cell', { name: 'Pagamento de título registrado' })
    expect(api.listarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ tabela_afetada: 'titulos_financeiros' }),
    )
  })

  it('a tela passa no axe', async () => {
    const { container } = renderizar(<AuditoriaPage />, '/auditoria')
    await screen.findByRole('cell', { name: 'Pagamento de título registrado' })
    expect(await axe(container)).toHaveNoViolations()
  })
})
