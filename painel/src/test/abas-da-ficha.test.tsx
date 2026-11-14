import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AbasADireita,
  AbasNoAlto,
  type AbaDaFicha,
} from '@/components/associados/AbasDaFicha'
import * as api from '@/lib/api'

// v9.5d (desenho aprovado pelo Presidente, rodadas 4 e 5): as abas da ficha no alto e, com o menu do módulo recolhido, numa coluna à direita com uma linha
// do que tem em cada parte. O nome de cada botão continua sendo só o da parte (os robôs e quem usa leitor de tela procuram por ele).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  obterCompletude: vi.fn(),
  listarCargos: vi.fn(),
  listarDependentesDaPessoa: vi.fn(),
}))

function Abas({ direita }: { direita: boolean }) {
  const [aba, setAba] = useState<AbaDaFicha>('dados')
  return direita ? (
    <AbasADireita
      aba={aba}
      aoEscolher={setAba}
      idAssociado={7}
      idPessoa={70}
      situacao="Ativo - Inadimplente"
    />
  ) : (
    <AbasNoAlto aba={aba} aoEscolher={setAba} />
  )
}

function desenhar(direita: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Abas direita={direita} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.obterCompletude).mockResolvedValue({
    percentual: 80,
  } as Awaited<ReturnType<typeof api.obterCompletude>>)
  vi.mocked(api.listarCargos).mockResolvedValue([
    {
      id_historico: 1,
      titulo_cargo: 'Conselheira Fiscal',
      data_posse: '2022-02-10',
      data_saida: '2026-01-31',
    },
    {
      id_historico: 2,
      titulo_cargo: '2ª Secretária',
      data_posse: '2026-02-01',
      data_saida: null,
    },
  ])
  vi.mocked(api.listarDependentesDaPessoa).mockResolvedValue([
    {},
    {},
    {},
  ] as Awaited<ReturnType<typeof api.listarDependentesDaPessoa>>)
})

describe('abas da ficha (v9.5d)', () => {
  it('no alto: as seis partes, a escolhida marcada; clicar troca', async () => {
    desenhar(false)
    const grupo = screen.getByRole('group', { name: 'Partes da ficha' })
    expect(
      within(grupo)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Dados e foto',
      'Ficha 360',
      'Cargos',
      'Família',
      'Situação',
      'Vínculos',
    ])
    expect(
      screen.getByRole('button', { name: 'Dados e foto' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Situação' }))
    expect(screen.getByRole('button', { name: 'Situação' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('à direita: cada parte com o resumo dela (preenchimento, cargo de agora, quantas pessoas, situação), sem mudar o nome do botão', async () => {
    desenhar(true)
    const coluna = screen.getByRole('navigation', { name: 'Partes da ficha' })
    expect(
      await within(coluna).findByRole('button', {
        name: 'Dados e foto',
        description: '80% preenchido',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      await within(coluna).findByRole('button', {
        name: 'Cargos',
        description: '2ª Secretária',
      }),
    ).toBeInTheDocument()
    expect(
      await within(coluna).findByRole('button', {
        name: 'Família',
        description: '3 pessoas',
      }),
    ).toBeInTheDocument()
    expect(
      within(coluna).getByRole('button', {
        name: 'Situação',
        description: 'Ativo - Inadimplente',
      }),
    ).toBeInTheDocument()
    await userEvent.click(
      within(coluna).getByRole('button', { name: 'Família' }),
    )
    expect(
      within(coluna).getByRole('button', { name: 'Família' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
