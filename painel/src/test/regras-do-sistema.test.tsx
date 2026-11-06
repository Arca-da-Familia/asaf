import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { RegrasDoSistemaPage } from '@/pages/RegrasDoSistema'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarConfiguracoes: vi.fn(),
  editarRegraDoSistema: vi.fn(),
}))

const configuracao = (
  chave: string,
  valor: string,
  extra: Partial<api.RegraDoSistema> = {},
): api.RegraDoSistema => ({
  chave,
  valor,
  tipo: 'numero',
  categoria: 'regras',
  descricao: `Descrição de ${chave}`,
  atualizado_em: null,
  ...extra,
})

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <RegrasDoSistemaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('Regras do sistema', () => {
  it('lista só as configurações da categoria "regras", cada uma com a descrição e o valor, sem o nome técnico (v9.3g); passa no axe', async () => {
    vi.mocked(api.listarConfiguracoes).mockResolvedValue([
      configuracao('DIAS_ALERTA_LANCAMENTO_TARDIO', '5'),
      configuracao('HORA_INICIO_EXPEDIENTE', '7'),
      configuracao('DATA_MAGNA', '10/02', {
        categoria: 'identidade',
        tipo: 'texto',
      }),
    ])
    const { container } = desenhar()
    const itens = await screen.findAllByRole('listitem')
    expect(itens).toHaveLength(2)
    const tardio = within(
      screen.getByRole('listitem', {
        name: 'Descrição de DIAS_ALERTA_LANCAMENTO_TARDIO',
      }),
    )
    expect(
      tardio.getByText('Descrição de DIAS_ALERTA_LANCAMENTO_TARDIO'),
    ).toBeInTheDocument()
    expect(
      tardio.getByLabelText('Descrição de DIAS_ALERTA_LANCAMENTO_TARDIO'),
    ).toHaveValue(5)
    expect(screen.queryByText(/DATA_MAGNA/)).toBeNull()
    expect(screen.queryByText('DIAS_ALERTA_LANCAMENTO_TARDIO')).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('v9.3b: procurar pelo nome ou pelo código filtra a lista e diz quantas sobraram', async () => {
    vi.mocked(api.listarConfiguracoes).mockResolvedValue([
      configuracao('DIAS_ALERTA_LANCAMENTO_TARDIO', '5'),
      configuracao('HORA_INICIO_EXPEDIENTE', '7'),
    ])
    const usuario = userEvent.setup()
    desenhar()
    await screen.findAllByRole('listitem')
    await usuario.type(screen.getByLabelText('Procurar regra'), 'expediente')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(
      screen.getByRole('listitem', {
        name: 'Descrição de HORA_INICIO_EXPEDIENTE',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2 regras.')
  })

  it('só deixa salvar o que mudou, grava o valor novo e avisa', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarConfiguracoes).mockResolvedValue([
      configuracao('DIAS_ALERTA_LANCAMENTO_TARDIO', '5'),
    ])
    vi.mocked(api.editarRegraDoSistema).mockResolvedValue({
      chave: 'DIAS_ALERTA_LANCAMENTO_TARDIO',
      valor: '7',
    })
    desenhar()
    const item = within(
      await screen.findByRole('listitem', {
        name: 'Descrição de DIAS_ALERTA_LANCAMENTO_TARDIO',
      }),
    )
    const salvar = item.getByRole('button', { name: 'Salvar' })
    expect(salvar).toBeDisabled()
    const campo = item.getByLabelText(
      'Descrição de DIAS_ALERTA_LANCAMENTO_TARDIO',
    )
    await u.clear(campo)
    await u.type(campo, '7')
    expect(salvar).toBeEnabled()
    await u.click(salvar)
    await waitFor(() =>
      expect(api.editarRegraDoSistema).toHaveBeenCalledWith(
        'DIAS_ALERTA_LANCAMENTO_TARDIO',
        '7',
      ),
    )
    expect(await item.findByRole('status')).toHaveTextContent('Salvo.')
  })

  it('o servidor recusa o valor: a tela mostra o motivo e não diz que salvou', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarConfiguracoes).mockResolvedValue([
      configuracao('HORA_INICIO_EXPEDIENTE', '7', { tipo: 'texto' }),
    ])
    vi.mocked(api.editarRegraDoSistema).mockRejectedValue(
      new Error('Valor inválido: use um número.'),
    )
    desenhar()
    const item = within(
      await screen.findByRole('listitem', {
        name: 'Descrição de HORA_INICIO_EXPEDIENTE',
      }),
    )
    const campo = item.getByLabelText('Descrição de HORA_INICIO_EXPEDIENTE')
    await u.clear(campo)
    await u.type(campo, 'muitas')
    await u.click(item.getByRole('button', { name: 'Salvar' }))
    expect(await item.findByRole('alert')).toHaveTextContent(
      'Valor inválido: use um número.',
    )
    expect(item.queryByRole('status')).toBeNull()
  })
})
