import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CartaoDesenhado } from '@/components/credencial/CartaoDesenhado'
import * as api from '@/lib/api'
import {
  EXEMPLO,
  avisosDoDesenho,
  contraste,
  type Desenho,
} from '@/lib/credencial-desenho'
import { CriadorDeCredencialPage } from '@/pages/CriadorDeCredencial'
import { EditorDeCredencialPage } from '@/pages/EditorDeCredencial'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarModelosDeCredencial: vi.fn(),
  obterModeloDeCredencial: vi.fn(),
  guardarModeloDeCredencial: vi.fn(),
  alterarModeloDeCredencial: vi.fn(),
  usarModeloDeCredencial: vi.fn(),
  apagarModeloDeCredencial: vi.fn(),
}))

// o pronto "Faixa no alto" (o mesmo de app/services/modelo_credencial.py)
const FAIXA_NO_ALTO: Desenho = {
  fundo: '#ffffff',
  partes: [
    {
      id: 'faixa',
      tipo: 'faixa',
      x: 0,
      y: 0,
      largura: 85.6,
      altura: 10,
      cor: '#14532d',
    },
    { id: 'logo', tipo: 'logo', x: 3, y: 1.5, largura: 8, altura: 7 },
    {
      id: 'asaf',
      tipo: 'texto',
      x: 13,
      y: 1.3,
      largura: 40,
      altura: 4.4,
      tamanho: 9,
      negrito: true,
      cor: '#ffffff',
      texto: 'ASAF',
    },
    { id: 'foto', tipo: 'foto', x: 3, y: 17, largura: 20, altura: 26 },
    {
      id: 'nome',
      tipo: 'nome',
      x: 25.5,
      y: 17,
      largura: 33.5,
      altura: 10.5,
      tamanho: 9,
      negrito: true,
      cor: '#0b1611',
    },
    {
      id: 'matricula',
      tipo: 'matricula',
      x: 25.5,
      y: 28,
      largura: 33.5,
      altura: 3.8,
      tamanho: 7.5,
      cor: '#0b1611',
    },
    {
      id: 'desde',
      tipo: 'desde',
      x: 25.5,
      y: 36.2,
      largura: 33.5,
      altura: 3.4,
      tamanho: 6.5,
      cor: '#525252',
    },
    { id: 'qr', tipo: 'qr', x: 61, y: 17, largura: 22, altura: 22 },
  ],
}
const copia = () => structuredClone(FAIXA_NO_ALTO)

function desenhar(no: React.ReactNode, endereco: string, caminho: string) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[endereco]}>
        <Routes>
          <Route path={caminho} element={no} />
          <Route
            path="/associados/credenciais/criador"
            element={<p>a galeria</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const guardado = (id: number, nome: string, emUso = false) => ({
  id_modelo: id,
  nome,
  desenho: copia(),
  em_uso: emUso,
  usado_desde: emUso ? '2026-11-19T12:00:00' : null,
  atualizado_em: '2026-11-19T12:00:00',
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarModelosDeCredencial).mockResolvedValue({
    em_uso: {
      id_modelo: 1,
      nome: 'Verde de 2026',
      desenho: copia(),
      pronto: null,
    },
    guardados: [
      guardado(1, 'Verde de 2026', true),
      guardado(2, 'Azul de teste'),
    ],
    prontos: [
      { chave: 'faixa-no-alto', nome: 'Faixa no alto', desenho: copia() },
      { chave: 'faixa-do-lado', nome: 'Faixa do lado', desenho: copia() },
    ],
    maximo_guardados: 30,
  })
})

describe('Criador de credencial: a página inicial (v9.5k)', () => {
  it('mostra o modelo em uso, os guardados e os prontos; "Usar para todos" pede confirmação', async () => {
    const u = userEvent.setup()
    vi.mocked(api.usarModeloDeCredencial).mockResolvedValue({
      mensagem: 'Pronto: "Azul de teste" é o desenho de todas as credenciais.',
      em_uso: {
        id_modelo: 2,
        nome: 'Azul de teste',
        desenho: copia(),
        pronto: null,
      },
    })
    const { container } = desenhar(
      <CriadorDeCredencialPage />,
      '/associados/credenciais/criador',
      '/associados/credenciais/criador',
    )
    expect(
      await screen.findByRole('heading', { name: 'Verde de 2026' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Prévia do modelo Verde de 2026' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Editar uma cópia' }),
    ).toHaveAttribute('href', '/associados/credenciais/criador/novo?de=1')
    // o em uso não aparece de novo em "guardados"
    const guardados = screen
      .getByRole('heading', { name: 'Modelos guardados' })
      .closest('section')!
    expect(within(guardados).getAllByRole('listitem')).toHaveLength(1)
    expect(
      screen.getByRole('link', { name: 'Começar do modelo Faixa do lado' }),
    ).toHaveAttribute(
      'href',
      '/associados/credenciais/criador/novo?de=faixa-do-lado',
    )

    await u.click(
      within(guardados).getByRole('button', { name: 'Usar para todos' }),
    )
    expect(api.usarModeloDeCredencial).not.toHaveBeenCalled()
    expect(
      within(guardados).getByText(/O QR de cada uma não muda/),
    ).toBeInTheDocument()
    await u.click(
      within(guardados).getByRole('button', { name: 'Sim, usar para todos' }),
    )
    await waitFor(() =>
      expect(api.usarModeloDeCredencial).toHaveBeenCalledWith(2),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'é o desenho de todas as credenciais',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('"Apagar" também pede confirmação', async () => {
    const u = userEvent.setup()
    vi.mocked(api.apagarModeloDeCredencial).mockResolvedValue({
      mensagem: 'Modelo apagado.',
    })
    desenhar(
      <CriadorDeCredencialPage />,
      '/associados/credenciais/criador',
      '/associados/credenciais/criador',
    )
    await u.click(
      await screen.findByRole('button', { name: 'Apagar Azul de teste' }),
    )
    expect(api.apagarModeloDeCredencial).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Sim, apagar' }))
    await waitFor(() =>
      expect(api.apagarModeloDeCredencial).toHaveBeenCalledWith(2),
    )
  })
})

describe('Criador de credencial: o editor (v9.5k)', () => {
  const abrirNovo = (de = 'faixa-no-alto') =>
    desenhar(
      <EditorDeCredencialPage />,
      `/associados/credenciais/criador/novo?de=${de}`,
      '/associados/credenciais/criador/:id',
    )

  it('as setas movem a parte escolhida; a cor difícil de ler trava o Guardar; Desfazer volta', async () => {
    const u = userEvent.setup()
    const { container } = abrirNovo()
    const nome = await screen.findByRole('button', {
      name: /^Nome: 25,5 mm da esquerda, 17,0 mm do alto$/,
    })
    expect(nome).toHaveAttribute('aria-pressed', 'true')
    nome.focus()
    await u.keyboard('{ArrowRight}')
    expect(
      screen.getByRole('button', { name: /^Nome: 26,0 mm da esquerda/ }),
    ).toBeInTheDocument()
    await u.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(
      screen.getByRole('button', {
        name: /^Nome: 26,0 mm da esquerda, 19,0 mm do alto$/,
      }),
    ).toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: /Tudo certo/ }),
    ).toBeInTheDocument()
    await u.click(
      within(screen.getByRole('group', { name: 'Cor da letra' })).getByRole(
        'button',
        { name: 'Branca' },
      ),
    )
    expect(
      await screen.findByRole('heading', {
        name: 'Antes de guardar, corrija 1 ponto:',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Nome: contraste 1,0 : 1/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Guardar como modelo novo' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Guardar e usar para todos' }),
    ).toBeDisabled()

    await u.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(
      screen.getByRole('heading', { name: /Tudo certo/ }),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o QR menor que 18 mm é recusado na hora; os números do painel ajustam', async () => {
    const u = userEvent.setup()
    abrirNovo()
    await u.click(
      await screen.findByRole('button', { name: /^QR de conferência:/ }),
    )
    const lado = screen.getByLabelText('Lado (mm)')
    fireEvent.change(lado, { target: { value: '15' } })
    expect(
      await screen.findByText(
        /QR de conferência: pequeno demais para o celular ler/,
      ),
    ).toBeInTheDocument()
    fireEvent.change(lado, { target: { value: '20' } })
    expect(
      await screen.findByRole('heading', { name: /Tudo certo/ }),
    ).toBeInTheDocument()
  })

  it('guarda como modelo novo com o nome "Cópia de..." e a parte acrescentada', async () => {
    const u = userEvent.setup()
    vi.mocked(api.guardarModeloDeCredencial).mockImplementation(
      async (nome, desenho) => ({
        id_modelo: 9,
        nome,
        desenho,
        em_uso: false,
        usado_desde: null,
        atualizado_em: '2026-11-19T12:00:00',
      }),
    )
    vi.mocked(api.obterModeloDeCredencial).mockResolvedValue(
      guardado(9, 'Cópia de Faixa no alto'),
    )
    abrirNovo()
    await screen.findByRole('button', { name: /^Nome:/ })
    expect(screen.getByLabelText('Nome do modelo')).toHaveValue(
      'Cópia de Faixa no alto',
    )
    await u.selectOptions(screen.getByLabelText('Acrescentar parte'), 'texto')
    await u.click(screen.getByRole('button', { name: 'Acrescentar' }))
    const texto = screen.getByLabelText('O texto')
    await u.clear(texto)
    await u.type(texto, 'Válida em todo o Brasil')
    await u.click(
      screen.getByRole('button', { name: 'Guardar como modelo novo' }),
    )
    await waitFor(() =>
      expect(api.guardarModeloDeCredencial).toHaveBeenCalled(),
    )
    const [nome, desenho] = vi.mocked(api.guardarModeloDeCredencial).mock
      .calls[0]!
    expect(nome).toBe('Cópia de Faixa no alto')
    expect(
      desenho.partes.find(
        (p) => p.tipo === 'texto' && p.texto === 'Válida em todo o Brasil',
      ),
    ).toBeTruthy()
    expect(api.usarModeloDeCredencial).not.toHaveBeenCalled()
  })

  it('o modelo em uso abre com o aviso e só guarda como modelo novo', async () => {
    vi.mocked(api.obterModeloDeCredencial).mockResolvedValue(
      guardado(1, 'Verde de 2026', true),
    )
    desenhar(
      <EditorDeCredencialPage />,
      '/associados/credenciais/criador/1',
      '/associados/credenciais/criador/:id',
    )
    expect(
      await screen.findByText(/Este é o modelo em uso/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Guardar como modelo novo' }),
    ).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Guardar' }),
    ).not.toBeInTheDocument()
  })
})

describe('O cartão desenhado e as regras (v9.5k)', () => {
  it('mostra os dados da pessoa nas partes e nada de situação', () => {
    render(
      <CartaoDesenhado
        desenho={copia()}
        dados={EXEMPLO}
        mmPx={4}
        rotulo="Cartão de exemplo"
      />,
    )
    const cartao = screen.getByRole('img', { name: 'Cartão de exemplo' })
    expect(
      within(cartao).getByText('Maria das Graças de Exemplo'),
    ).toBeInTheDocument()
    expect(within(cartao).getByText('Matrícula nº 123')).toBeInTheDocument()
    expect(
      within(cartao).getByText('Associado desde 03/2019'),
    ).toBeInTheDocument()
    expect(
      within(cartao).queryByText(/Ativo|Em Dia|situação/i),
    ).not.toBeInTheDocument()
  })

  it('as mesmas regras do servidor: nome e QR, QR quadrado e sem nada em cima, contraste', () => {
    expect(avisosDoDesenho(copia())).toEqual([])
    const semQr = copia()
    semQr.partes = semQr.partes.filter((p) => p.tipo !== 'qr')
    expect(avisosDoDesenho(semQr)[0]!.texto).toMatch(
      /todo cartão tem o nome e o QR/,
    )
    const emCima = copia()
    emCima.partes.find((p) => p.id === 'nome')!.x = 60
    expect(
      avisosDoDesenho(emCima)
        .map((a) => a.texto)
        .join(' '),
    ).toMatch(/está em cima do QR/)
    // o texto branco que sai da faixa e encosta no fundo branco
    const meio = copia()
    meio.partes.find((p) => p.id === 'asaf')!.y = 8
    expect(
      avisosDoDesenho(meio)
        .map((a) => a.texto)
        .join(' '),
    ).toMatch(/contraste/)
    expect(Math.round(contraste('#ffffff', '#000000'))).toBe(21)
  })
})
