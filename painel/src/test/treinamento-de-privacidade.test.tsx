import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AvisoDoTreinamento } from '@/components/layout/AvisoDoTreinamento'
import * as privacidade from '@/lib/privacidade'
import { MeuTreinamentoDePrivacidadePage } from '@/pages/MeuTreinamentoDePrivacidade'
import { QuadroDeTreinamentosPage } from '@/pages/QuadroDeTreinamentos'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterMeuTreinamento: vi.fn(),
  concluirMeuTreinamento: vi.fn(),
  obterQuadroDeTreinamentos: vi.fn(),
}))

const material: privacidade.MaterialDePrivacidade = {
  versao: '1',
  titulo: 'Cuidados com os dados das pessoas na ASAF',
  itens: [
    { titulo: 'O que é dado pessoal', texto: 'É qualquer informação...' },
    {
      titulo: 'Use só o que a sua tarefa pede',
      texto: 'O painel já mostra...',
    },
  ],
}

const situacao = (
  extra: Partial<privacidade.SituacaoDoTreinamento> = {},
): privacidade.SituacaoDoTreinamento => ({
  precisa: true,
  pendente: true,
  ultimo_em: null,
  valido_ate: null,
  fazer_ate: '2026-12-02T00:00:00',
  atrasado: false,
  intervalo_dias: 730,
  com_mandato: true,
  ...extra,
})

function desenhar(no: React.ReactNode, rota = '/') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[rota]}>{no}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Treinamento de privacidade (v7.5a)', () => {
  it('o material com a versão e o "Li e entendi" que registra; passa no axe', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.obterMeuTreinamento).mockResolvedValue({
      material,
      situacao: situacao(),
    })
    vi.mocked(privacidade.concluirMeuTreinamento).mockResolvedValue({
      material,
      situacao: situacao({
        pendente: false,
        fazer_ate: null,
        ultimo_em: '2026-11-02T12:00:00',
        valido_ate: '2028-11-01T12:00:00',
      }),
    })
    const { container } = desenhar(<MeuTreinamentoDePrivacidadePage />)
    expect(
      await screen.findByRole('region', { name: material.titulo }),
    ).toHaveTextContent('(versão 1)')
    expect(screen.getByTestId('situacao-do-treinamento')).toHaveTextContent(
      'vale por 2 anos (Diretoria Executiva e Conselho Fiscal)',
    )
    expect(await axe(container)).toHaveNoViolations()
    await u.click(screen.getByRole('button', { name: 'Li e entendi' }))
    expect(privacidade.concluirMeuTreinamento).toHaveBeenCalled()
    expect(
      await screen.findByText(/Treinamento feito em 02\/11\/2026/),
    ).toBeVisible()
  })

  it('o aviso aparece para quem está pendente e some na própria tela do treinamento', async () => {
    vi.mocked(privacidade.obterMeuTreinamento).mockResolvedValue({
      material,
      situacao: situacao({ atrasado: true }),
    })
    const { unmount } = desenhar(<AvisoDoTreinamento />)
    expect(await screen.findByTestId('aviso-do-treinamento')).toHaveTextContent(
      'O seu treinamento de privacidade está atrasado',
    )
    unmount()
    desenhar(<AvisoDoTreinamento />, '/treinamento-de-privacidade')
    await Promise.resolve()
    expect(screen.queryByTestId('aviso-do-treinamento')).toBeNull()
  })

  it('quem não precisa não vê aviso', async () => {
    vi.mocked(privacidade.obterMeuTreinamento).mockResolvedValue({
      material,
      situacao: situacao({ precisa: false, pendente: false }),
    })
    desenhar(<AvisoDoTreinamento />)
    await vi.waitFor(() =>
      expect(privacidade.obterMeuTreinamento).toHaveBeenCalled(),
    )
    expect(screen.queryByTestId('aviso-do-treinamento')).toBeNull()
  })

  it('o quadro mostra quem está atrasado, pendente e feito', async () => {
    vi.mocked(privacidade.obterQuadroDeTreinamentos).mockResolvedValue({
      itens: [
        {
          ...situacao({ atrasado: true }),
          id_usuario: 1,
          nome: 'Ana',
          nivel: null,
        },
        {
          ...situacao({
            pendente: false,
            ultimo_em: '2026-11-02T12:00:00',
            valido_ate: '2027-11-02T12:00:00',
            com_mandato: false,
          }),
          id_usuario: 2,
          nome: 'Bruno',
          nivel: 'Diretoria',
        },
      ],
      versao_material: '1',
      dias_com_mandato: 730,
      dias_sem_mandato: 365,
      dias_para_fazer: 30,
      pode_gerir: true,
    })
    desenhar(<QuadroDeTreinamentosPage />)
    const ana = await screen.findByRole('row', { name: /Ana/ })
    expect(ana).toHaveAttribute('data-situacao', 'atrasado')
    expect(ana).toHaveTextContent('Cargo: a cada 2 anos')
    expect(screen.getByRole('row', { name: /Bruno/ })).toHaveTextContent(
      'Feito em 02/11/2026; vale até 02/11/2027',
    )
  })
})
