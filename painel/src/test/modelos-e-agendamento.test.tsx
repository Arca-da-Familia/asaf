import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as com from '@/lib/comunicacao'
import { AvisoNovoPage } from '@/pages/AvisoNovo'
import { AvisosAgendadosPage } from '@/pages/AvisosAgendados'
import { ModelosDeAvisoPage } from '@/pages/ModelosDeAviso'

// v6.2c - modelos de aviso (versionados), variáveis no texto, pré-visualização, envio de teste e "publicar depois".
vi.mock('@/lib/comunicacao', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/comunicacao')>()),
  opcoesDePublico: vi.fn(),
  conferirPublico: vi.fn(),
  publicarAviso: vi.fn(),
  listarModelos: vi.fn(),
  criarModelo: vi.fn(),
  editarModelo: vi.fn(),
  arquivarModelo: vi.fn(),
  versoesDoModelo: vi.fn(),
  preVisualizarAviso: vi.fn(),
  enviarTesteDoAviso: vi.fn(),
  agendarAviso: vi.fn(),
  listarAgendados: vi.fn(),
  cancelarAgendado: vi.fn(),
}))

function desenhar(rota: string, caminho: string, elemento: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path={caminho} element={elemento} />
          <Route
            path="/comunicacao/agendados"
            element={<p>lista de agendados</p>}
          />
          <Route path="/comunicacao/:id" element={<p>relatório aberto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const OPCOES: com.OpcoesDePublico = {
  situacoes: [],
  categorias_de_associado: ['Efetivo'],
  permissoes: [],
  projetos: [],
  categorias_de_aviso: [
    { codigo: 'GERAL', rotulo: 'Geral', obrigatoria: false },
    { codigo: 'CONVOCACAO', rotulo: 'Convocação', obrigatoria: true },
  ],
}

const modelo = (extra: Partial<com.ModeloDeAviso> = {}): com.ModeloDeAviso => ({
  id_modelo: 5,
  grupo: 'g-1',
  versao: 2,
  nome: 'Convocação de assembleia',
  titulo: 'Assembleia ordinária',
  texto: 'Prezado(a) {primeiro_nome}, convocamos...',
  categoria: 'CONVOCACAO',
  exige_confirmacao: true,
  por_email: true,
  ativo: true,
  criado_em: '2026-10-21T12:00:00',
  ...extra,
})

const CONFERENCIA: com.ConferenciaDoPublico = {
  descricao: 'Todos os associados (menos os desligados)',
  total: 3,
  sem_acesso: 0,
  com_email: 3,
  desligaram_os_avisos: 0,
  pessoas: [],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(com.opcoesDePublico).mockResolvedValue(OPCOES)
  vi.mocked(com.listarModelos).mockResolvedValue([modelo()])
  vi.mocked(com.conferirPublico).mockResolvedValue(CONFERENCIA)
})

describe('o Novo aviso com modelo, variáveis, pré-visualização, teste e agendamento', () => {
  it('começar de um modelo preenche tudo e o aviso guarda a versão usada', async () => {
    vi.mocked(com.publicarAviso).mockResolvedValue({
      id_aviso: 9,
    } as com.AvisoCompleto)
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await userEvent.selectOptions(
      await screen.findByLabelText(/^Começar de um modelo/),
      '5',
    )
    expect(screen.getByLabelText('Título')).toHaveValue('Assembleia ordinária')
    expect(screen.getByLabelText(/^Texto/)).toHaveValue(
      'Prezado(a) {primeiro_nome}, convocamos...',
    )
    expect(
      screen.getByRole('checkbox', { name: /Pedir confirmação/ }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /Também por e-mail/ }),
    ).toBeChecked()
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Publicar para 3 pessoas' }),
    )
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Publicar para 3 pessoas',
      }),
    )
    await waitFor(() =>
      expect(com.publicarAviso).toHaveBeenCalledWith(
        expect.objectContaining({
          id_modelo: 5,
          categoria: 'CONVOCACAO',
          exige_confirmacao: true,
          por_email: true,
        }),
      ),
    )
  })

  it('variável que não existe trava o publicar e diz quais existem', async () => {
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await userEvent.type(await screen.findByLabelText('Título'), 'Aviso')
    await userEvent.type(screen.getByLabelText(/^Texto/), 'Oi {{apelido}')
    expect(
      await screen.findByText(/Variável que não existe: \{apelido\}/),
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Publicar para 3 pessoas' }),
    ).toBeDisabled()
  })

  it('pré-visualiza com uma pessoa do grupo e manda o teste para o próprio e-mail', async () => {
    vi.mocked(com.preVisualizarAviso).mockResolvedValue({
      para: 'Ana Souza',
      titulo: 'Aviso',
      texto: 'Oi, Ana!',
    })
    vi.mocked(com.enviarTesteDoAviso).mockResolvedValue({
      enviado_para: 'secretaria@exemplo.org',
    })
    const { container } = desenhar(
      '/comunicacao/novo',
      '/comunicacao/novo',
      <AvisoNovoPage />,
    )
    await userEvent.type(await screen.findByLabelText('Título'), 'Aviso')
    await userEvent.type(
      screen.getByLabelText(/^Texto/),
      'Oi, {{primeiro_nome}!',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Pré-visualizar' }),
    )
    expect(await screen.findByText('Como chega para Ana Souza:')).toBeVisible()
    expect(screen.getByText('Oi, Ana!')).toBeVisible()
    expect(com.preVisualizarAviso).toHaveBeenCalledWith(
      expect.objectContaining({
        titulo: 'Aviso',
        texto: 'Oi, {primeiro_nome}!',
      }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Enviar um teste para o meu e-mail' }),
    )
    expect(
      await screen.findByText(/Teste enviado para secretaria@exemplo.org/),
    ).toBeVisible()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('publicar depois: o botão diz Agendar, manda a hora em UTC e leva à lista de agendados', async () => {
    vi.mocked(com.agendarAviso).mockResolvedValue({
      id_agendado: 1,
    } as com.AvisoAgendado)
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await userEvent.type(await screen.findByLabelText('Título'), 'Aviso')
    await userEvent.type(screen.getByLabelText(/^Texto/), 'Texto')
    await userEvent.click(screen.getByLabelText('Depois (agendar)'))
    await userEvent.type(
      screen.getByLabelText(/^Data e hora da publicação/),
      '2026-11-02T08:30',
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Agendar para 3 pessoas' }),
    )
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent('com o grupo calculado naquela hora')
    await userEvent.click(
      within(dialogo).getByRole('button', { name: 'Agendar para 3 pessoas' }),
    )
    await waitFor(() =>
      expect(com.agendarAviso).toHaveBeenCalledWith(
        expect.objectContaining({
          publicar_em: new Date('2026-11-02T08:30').toISOString(),
          total_confirmado: 3,
        }),
      ),
    )
    expect(com.publicarAviso).not.toHaveBeenCalled()
    expect(await screen.findByText('lista de agendados')).toBeVisible()
  })
})

describe('os modelos de aviso', () => {
  it('editar salva como versão nova e mostra o histórico', async () => {
    vi.mocked(com.editarModelo).mockResolvedValue(
      modelo({ versao: 3, id_modelo: 6 }),
    )
    vi.mocked(com.versoesDoModelo).mockResolvedValue([
      modelo(),
      modelo({ id_modelo: 4, versao: 1, ativo: false, texto: 'Texto antigo' }),
    ])
    const { container } = desenhar(
      '/comunicacao/modelos',
      '/comunicacao/modelos',
      <ModelosDeAvisoPage />,
    )
    expect(
      await screen.findByRole('heading', { name: 'Convocação de assembleia' }),
    ).toBeVisible()
    expect(await axe(container)).toHaveNoViolations()
    await userEvent.click(screen.getByRole('button', { name: 'Ver versões' }))
    expect(await screen.findByText(/Texto antigo/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const texto = screen.getByLabelText(/^Texto do aviso/)
    await userEvent.clear(texto)
    await userEvent.type(texto, 'Texto novo')
    await userEvent.click(
      screen.getByRole('button', { name: 'Salvar como versão nova' }),
    )
    expect(com.editarModelo).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ texto: 'Texto novo' }),
    )
    expect(
      await screen.findByText(
        /salvo como versão 3; a anterior ficou no histórico/,
      ),
    ).toBeVisible()
  })
})

describe('os avisos agendados', () => {
  it('cancelar exige motivo', async () => {
    vi.mocked(com.listarAgendados).mockResolvedValue([
      {
        id_agendado: 7,
        publicar_em: '2026-11-02T11:30:00',
        situacao: 'Agendado',
        titulo: 'Reunião',
        categoria: 'GERAL',
        valido_ate: '2026-11-10',
        exige_confirmacao: false,
        por_email: false,
        publico_descricao: 'Todos',
        total_conferido: 3,
        id_aviso: null,
        motivo: null,
        criado_em: '2026-10-21T12:00:00',
      },
    ])
    vi.mocked(com.cancelarAgendado).mockResolvedValue({} as com.AvisoAgendado)
    desenhar(
      '/comunicacao/agendados',
      '/comunicacao/agendados',
      <AvisosAgendadosPage />,
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancelar' }),
    )
    const confirmar = screen.getByRole('button', {
      name: 'Cancelar o agendamento',
    })
    expect(confirmar).toBeDisabled()
    await userEvent.type(
      screen.getByLabelText(/Motivo do cancelamento/),
      'A reunião mudou de data.',
    )
    await userEvent.click(confirmar)
    expect(com.cancelarAgendado).toHaveBeenCalledWith(
      7,
      'A reunião mudou de data.',
    )
    expect(await screen.findByText(/o aviso não será publicado/)).toBeVisible()
  })
})
