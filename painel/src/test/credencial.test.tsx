import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CredencialDoAssociado } from '@/components/associados/CredencialDoAssociado'
import { MenuPessoal } from '@/components/layout/MenuPessoal'
import * as api from '@/lib/api'
import { ApiError } from '@/lib/api'
import { ConferirCredencialPage } from '@/pages/ConferirCredencial'
import { MinhaCarteirinhaPage } from '@/pages/MinhaCarteirinha'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  obterMinhaCredencial: vi.fn(),
  conferirCredencial: vi.fn(),
  obterCredencialDoAssociado: vi.fn(),
  emitirOutraCredencial: vi.fn(),
}))

const CODIGO = 'AbCdEfGhIjKlMnOpQrStUv'

function desenhar(no: React.ReactNode, endereco = '/') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>{no}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('Minha carteirinha (v9.5i)', () => {
  it('mostra o cartão com a foto, os dados e o QR da página de conferência; no celular vira para o QR', async () => {
    vi.mocked(api.obterMinhaCredencial).mockResolvedValue({
      codigo: CODIGO,
      pagina: `/credencial/${CODIGO}`,
      emitida_em: '2026-11-18T12:00:00',
      nome_completo: 'Raimundo Nonato da Silva',
      matricula: 12,
      categoria: 'Efetivo',
      situacao: 'Ativo - Em Dia',
      associado_desde: '2019-03-01',
      foto: null,
    })
    const u = userEvent.setup()
    const { container } = desenhar(<MinhaCarteirinhaPage />)
    expect(
      await screen.findByText('Raimundo Nonato da Silva'),
    ).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Associado desde 03/2019')).toBeInTheDocument()
    expect(screen.getByText('Ativo - Em Dia')).toBeInTheDocument()
    // o QR leva ao endereço da página de conferência (o mesmo painel), com o código da credencial
    expect(
      screen.getByRole('img', { name: /QR da sua carteirinha/ }),
    ).toBeInTheDocument()
    const botao = screen.getByRole('button', { name: 'Mostrar o QR' })
    await u.click(botao)
    expect(
      screen.getByRole('button', { name: 'Ver a frente' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Imprimir a carteirinha' }),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-impressao="carteirinha"]'),
    ).not.toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('quem não tem cadastro de associado recebe a explicação', async () => {
    vi.mocked(api.obterMinhaCredencial).mockRejectedValue(
      new ApiError(404, 'sem cadastro'),
    )
    desenhar(<MinhaCarteirinhaPage />)
    expect(
      await screen.findByText('A carteirinha é de associado'),
    ).toBeInTheDocument()
  })
})

describe('Conferência da credencial, sem login (v9.5i)', () => {
  function abrir() {
    return desenhar(
      <Routes>
        <Route
          path="/credencial/:codigo"
          element={<ConferirCredencialPage />}
        />
      </Routes>,
      `/credencial/${CODIGO}`,
    )
  }

  it('em dia: a foto, a situação em letras grandes e os dados, com a hora de Belém', async () => {
    vi.mocked(api.conferirCredencial).mockResolvedValue({
      estado: 'em_dia',
      titulo: 'Associado em dia',
      detalhe: 'Situação conferida agora',
      conferido_em: '2026-11-18T17:32:00+00:00',
      nome_completo: 'Raimundo Nonato da Silva',
      matricula: 12,
      categoria: 'Efetivo',
      situacao: 'Ativo - Em Dia',
      foto: `/api/publico/credencial/${CODIGO}/foto`,
    })
    const { container } = abrir()
    expect(await screen.findByText('Associado em dia')).toBeInTheDocument()
    expect(api.conferirCredencial).toHaveBeenCalledWith(CODIGO)
    expect(
      screen.getByRole('img', { name: 'Foto de Raimundo Nonato da Silva' }),
    ).toHaveAttribute(
      'src',
      expect.stringContaining(`/api/publico/credencial/${CODIGO}/foto`),
    )
    expect(
      screen.getByRole('region', { name: 'Situação de agora' }),
    ).toHaveAttribute('data-estado', 'em_dia')
    expect(
      screen.getByText(
        /Conferido em 18\/11\/2026 às 14:32 \(horário de Belém\)/,
      ),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('não vale: nem foto nem nome', async () => {
    vi.mocked(api.conferirCredencial).mockResolvedValue({
      estado: 'nao_vale',
      titulo: 'Esta credencial não vale',
      detalhe: 'Foi substituída por outra, ou a pessoa não é mais associada',
      conferido_em: '2026-11-18T17:32:00+00:00',
    })
    abrir()
    expect(
      await screen.findByText('Esta credencial não vale'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Sem foto: a credencial não vale'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText(/Matrícula/)).not.toBeInTheDocument()
  })

  it('sem internet: explica e deixa tentar de novo', async () => {
    vi.mocked(api.conferirCredencial).mockRejectedValue(new Error('rede'))
    abrir()
    expect(
      await screen.findByText('Não consegui conferir agora.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Tentar de novo' }),
    ).toBeInTheDocument()
  })
})

describe('A credencial na ficha do associado (v9.5i)', () => {
  it('"Emitir outra" pede confirmação e avisa que a anterior deixou de valer', async () => {
    vi.mocked(api.obterCredencialDoAssociado).mockResolvedValue({
      codigo: CODIGO,
      pagina: `/credencial/${CODIGO}`,
      emitida_em: '2026-11-01T12:00:00',
    })
    vi.mocked(api.emitirOutraCredencial).mockResolvedValue({
      mensagem: 'Credencial nova emitida. A anterior deixou de valer.',
      codigo: 'NovoCodigoDaCredencial12',
      pagina: '/credencial/NovoCodigoDaCredencial12',
      emitida_em: '2026-11-18T12:00:00',
    })
    const u = userEvent.setup()
    desenhar(<CredencialDoAssociado idAssociado={7} desligado={false} />)
    expect(await screen.findByText('01/11/2026')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Abrir a página de conferência' }),
    ).toHaveAttribute('href', `/credencial/${CODIGO}`)
    await u.click(
      screen.getByRole('button', { name: 'Emitir outra credencial' }),
    )
    expect(api.emitirOutraCredencial).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Sim, emitir outra' }))
    await waitFor(() =>
      expect(api.emitirOutraCredencial).toHaveBeenCalledWith(7),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'A anterior deixou de valer.',
    )
    expect(screen.getByText('18/11/2026')).toBeInTheDocument()
  })

  it('desligado: diz que não vale e não busca nada', () => {
    desenhar(<CredencialDoAssociado idAssociado={7} desligado />)
    expect(
      screen.getByText(/Desligado: a credencial não vale/),
    ).toBeInTheDocument()
    expect(api.obterCredencialDoAssociado).not.toHaveBeenCalled()
  })
})

describe('Menu pessoal (v9.5i)', () => {
  it('"Minha carteirinha" só aparece para quem tem cadastro de associado', async () => {
    const u = userEvent.setup()
    const { unmount } = desenhar(<MenuPessoal nome="Quem Usa" associado />)
    await u.click(screen.getByRole('button', { name: /menu pessoal/i }))
    expect(
      screen.getByRole('link', { name: /Minha carteirinha/ }),
    ).toHaveAttribute('href', '/minha-carteirinha')
    unmount()
    desenhar(<MenuPessoal nome="Quem Usa" />)
    await u.click(screen.getByRole('button', { name: /menu pessoal/i }))
    expect(
      screen.queryByRole('link', { name: /Minha carteirinha/ }),
    ).not.toBeInTheDocument()
  })
})

describe('Portaria (v9.5i)', () => {
  it('depois de enviada, a fila do aparelho guarda só o fim do código da credencial', async () => {
    const { mascararCredencial } = await import('@/lib/portaria-queue')
    expect(mascararCredencial(CODIGO)).toBe('credencial ····StUv')
    expect(
      mascararCredencial(
        `https://painel.asaf.org.br/credencial/${CODIGO}/?x=1`,
      ),
    ).toBe('credencial ····StUv')
    expect(mascararCredencial(` /credencial/${CODIGO}#a `)).toBe(
      'credencial ····StUv',
    )
  })
})
