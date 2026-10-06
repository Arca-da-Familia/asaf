import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportarAssociados } from '@/components/associados/ExportarAssociados'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  exportarAssociados: vi.fn(),
}))

function eu(permissoes: string[]) {
  return {
    id_usuario: 1,
    id_associado: 1,
    nome_completo: 'Quem Atende',
    email: 'a@b.c',
    nivel: 'Presidente',
    mfa_ativado: false,
    mfa_obrigatorio: false,
    mfa_pendente: false,
    permissoes,
  }
}

function desenhar(permissoes: string[]) {
  vi.mocked(api.me).mockResolvedValue(eu(permissoes))
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <ExportarAssociados />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('Exportar dados dos associados (v5.4c: a tela que faltava para a exportação da v1.3)', () => {
  it('quem não tem a permissão própria não vê nada', async () => {
    desenhar(['associados'])
    await waitFor(() => expect(api.me).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: 'Exportar dados dos associados' }),
    ).not.toBeInTheDocument()
  })

  it('escolhe colunas, gera e mostra as linhas; avisa que a Auditoria registra', async () => {
    const u = userEvent.setup()
    vi.mocked(api.exportarAssociados).mockResolvedValue({
      colunas: ['nome_completo', 'cpf'],
      linhas: [
        { nome_completo: 'Ana de Teste', cpf: '11122233344' },
        { nome_completo: 'Beto de Teste', cpf: null },
      ],
    })
    desenhar(['associados', 'exportar_dados_pessoais'])
    await u.click(
      await screen.findByRole('button', {
        name: 'Exportar dados dos associados',
      }),
    )
    expect(
      screen.getByText(/ficam? registrad|fica registrada/i),
    ).toBeInTheDocument()
    // padrão: nome, categoria e situação; troca categoria e situação por CPF
    await u.click(screen.getByLabelText('Categoria'))
    await u.click(screen.getByLabelText('Situação'))
    await u.click(screen.getByLabelText('CPF'))
    await u.click(screen.getByRole('button', { name: 'Gerar exportação' }))
    await waitFor(() =>
      expect(api.exportarAssociados).toHaveBeenCalledWith([
        'nome_completo',
        'cpf',
      ]),
    )
    expect(await screen.findByTestId('exportacao-total')).toHaveTextContent('2')
    expect(screen.getByText('Ana de Teste')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Baixar CSV' }),
    ).toBeInTheDocument()
  })

  it('sem nenhuma coluna não deixa gerar', async () => {
    const u = userEvent.setup()
    desenhar(['exportar_dados_pessoais'])
    await u.click(
      await screen.findByRole('button', {
        name: 'Exportar dados dos associados',
      }),
    )
    for (const nome of ['Nome completo', 'Categoria', 'Situação'])
      await u.click(screen.getByLabelText(nome))
    expect(
      screen.getByRole('button', { name: 'Gerar exportação' }),
    ).toBeDisabled()
  })

  it('a recusa do servidor aparece', async () => {
    const u = userEvent.setup()
    vi.mocked(api.exportarAssociados).mockRejectedValue(
      new Error("Sem permissão 'exportar_dados_pessoais'."),
    )
    desenhar(['exportar_dados_pessoais'])
    await u.click(
      await screen.findByRole('button', {
        name: 'Exportar dados dos associados',
      }),
    )
    await u.click(screen.getByRole('button', { name: 'Gerar exportação' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão')
  })

  it('não tem violação de acessibilidade (axe)', async () => {
    const u = userEvent.setup()
    const { container } = desenhar(['exportar_dados_pessoais'])
    await u.click(
      await screen.findByRole('button', {
        name: 'Exportar dados dos associados',
      }),
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
