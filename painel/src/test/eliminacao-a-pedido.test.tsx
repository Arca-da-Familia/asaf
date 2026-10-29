import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EliminacaoAPedido } from '@/components/atendimentos/EliminacaoAPedido'
import { ApiError, type AtendimentoAberto } from '@/lib/api'
import * as privacidade from '@/lib/privacidade'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterPreviaDaEliminacao: vi.fn(),
  eliminarAPedido: vi.fn(),
}))

// v7.2d - a eliminação a pedido em dois passos: a prévia (o que sai e o que fica, com o fundamento), "conferi" e eliminar; o resultado sugerido vai para a resposta
const pedido = {
  id_atendimento: 52,
  protocolo: 'ASAF-2026-00052',
  tipo: 'TITULAR_LGPD',
  subtipo: 'ELIMINACAO',
  identidade_validada: true,
} as unknown as AtendimentoAberto
const PREVIA: privacidade.PreviaDaEliminacao = {
  impressao: 'c'.repeat(64),
  vinculos: [
    'está no quadro de associados (situação: Ativo - Em Dia): os dados servem ao vínculo enquanto ele durar',
  ],
  cadastro_sai: false,
  sai: ['2 pedido(s) antigo(s) feito(s) pelo site: o texto e os contatos'],
  fica: [
    {
      tabela: 'titulos_financeiros',
      registros: 3,
      fundamento: 'ESCRITURACAO_FINANCEIRA',
      por_que: 'A escrituração e os recibos são guardados por lei.',
      nome: 'Financeiro',
    },
  ],
  resultado_sugerido: 'ATENDIDO_EM_PARTE',
  fundamento_sugerido: 'VINCULO_ATIVO',
  pessoa: { id_pessoa: 9, nome_completo: 'Joana da Silva' },
  algum_corte: false,
}

function desenhar(aoEliminar = vi.fn()) {
  const r = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <EliminacaoAPedido a={pedido} aoEliminar={aoEliminar} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...r, aoEliminar }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(privacidade.obterPreviaDaEliminacao).mockResolvedValue(PREVIA)
})

describe('Eliminar a pedido', () => {
  it('a prévia só vem quando pedida e mostra o vínculo, o que sai e o que fica com o porquê; passa no axe', async () => {
    const u = userEvent.setup()
    const { container } = desenhar()
    expect(privacidade.obterPreviaDaEliminacao).not.toHaveBeenCalled()
    await u.click(
      screen.getByRole('button', { name: 'Ver o que sai e o que fica' }),
    )
    expect(await screen.findByText(/pedido\(s\) antigo/)).toBeInTheDocument()
    expect(
      screen.getByText(/O cadastro fica enquanto durar/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Financeiro \(3\): A escrituração e os recibos/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: 'Abrir o relatório completo desta pessoa',
      }),
    ).toHaveAttribute('href', '/privacidade/titulares?id_atendimento=52')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('só elimina depois de "conferi", manda a impressão da prévia e sugere o resultado para a resposta', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.eliminarAPedido).mockResolvedValue({
      sai: PREVIA.sai,
      fica: PREVIA.fica,
      cadastro_saiu: false,
      resultado_sugerido: 'ATENDIDO_EM_PARTE',
      fundamento_sugerido: 'VINCULO_ATIVO',
    })
    const { aoEliminar } = desenhar()
    await u.click(
      screen.getByRole('button', { name: 'Ver o que sai e o que fica' }),
    )
    const botao = await screen.findByRole('button', {
      name: 'Eliminar o que pode sair',
    })
    expect(botao).toBeDisabled()
    await u.click(
      screen.getByRole('checkbox', {
        name: 'Conferi o que sai e o que fica: a eliminação não tem volta',
      }),
    )
    await u.click(botao)
    expect(privacidade.eliminarAPedido).toHaveBeenCalledWith(
      52,
      PREVIA.impressao,
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Eliminado')
    expect(aoEliminar).toHaveBeenCalledWith(
      'ATENDIDO_EM_PARTE',
      'VINCULO_ATIVO',
    )
  })

  it('a prévia que mudou é recusada: o motivo aparece e a prévia é refeita', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.eliminarAPedido).mockRejectedValue(
      new ApiError(
        409,
        'Os dados mudaram desde que você conferiu a prévia: confira de novo.',
      ),
    )
    desenhar()
    await u.click(
      screen.getByRole('button', { name: 'Ver o que sai e o que fica' }),
    )
    await u.click(await screen.findByRole('checkbox'))
    await u.click(
      screen.getByRole('button', { name: 'Eliminar o que pode sair' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'confira de novo',
    )
    expect(privacidade.obterPreviaDaEliminacao).toHaveBeenCalledTimes(2)
  })

  it('sem nada que possa sair, o botão fica desligado e a tela diz por quê', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.obterPreviaDaEliminacao).mockResolvedValue({
      ...PREVIA,
      sai: [],
    })
    desenhar()
    await u.click(
      screen.getByRole('button', { name: 'Ver o que sai e o que fica' }),
    )
    expect(await screen.findByText(/Nada pode sair agora/)).toBeInTheDocument()
    await u.click(screen.getByRole('checkbox'))
    expect(
      screen.getByRole('button', { name: 'Eliminar o que pode sair' }),
    ).toBeDisabled()
  })
})
