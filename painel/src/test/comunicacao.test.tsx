import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MuralDeAvisos } from '@/components/comunicacao/MuralDeAvisos'
import { ApiError } from '@/lib/api'
import * as com from '@/lib/comunicacao'
import { moduloVisivel, modulos } from '@/lib/modulos'
import { AvisoDetalhePage } from '@/pages/AvisoDetalhe'
import { AvisoNovoPage } from '@/pages/AvisoNovo'
import { MeuAvisoPage } from '@/pages/MeuAviso'

// v6.1 - comunicação interna: o mural, o aviso recebido (ler e confirmar), publicar com a contagem conferida e o relatório de leitura.
vi.mock('@/lib/comunicacao', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/comunicacao')>()),
  listarMeusAvisos: vi.fn(),
  abrirMeuAviso: vi.fn(),
  confirmarMeuAviso: vi.fn(),
  opcoesDePublico: vi.fn(),
  conferirPublico: vi.fn(),
  publicarAviso: vi.fn(),
  detalharAviso: vi.fn(),
  incluirNovosNoAviso: vi.fn(),
  retirarAviso: vi.fn(),
}))

function desenhar(rota: string, caminho: string, elemento: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path={caminho} element={elemento} />
          <Route path="/comunicacao/:id" element={<p>relatório aberto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const meuAviso = (extra: Partial<com.MeuAviso> = {}): com.MeuAviso => ({
  id_aviso: 7,
  titulo: 'Assembleia ordinária',
  categoria_rotulo: 'Convocação',
  exige_confirmacao: true,
  valido_ate: '2026-11-30',
  publicado_em: '2026-10-20T12:00:00',
  autor: 'Ana Presidente',
  situacao: 'No mural',
  retirado_em: null,
  motivo_retirada: null,
  lido_em: '2026-10-20T13:00:00',
  confirmado_em: null,
  texto: 'Linha 1\nLinha 2 <b>sem negrito</b>',
  ...extra,
})

const destinatario = (
  extra: Partial<com.DestinatarioDoAviso> = {},
): com.DestinatarioDoAviso => ({
  id_destinatario: 1,
  nome: 'Bruno',
  tinha_acesso: true,
  tem_acesso_hoje: true,
  incluido_em: '2026-10-20T12:00:00',
  lido_em: null,
  confirmado_em: null,
  ...extra,
})

const avisoCompleto = (
  extra: Partial<com.AvisoCompleto> = {},
): com.AvisoCompleto => ({
  id_aviso: 7,
  titulo: 'Assembleia ordinária',
  categoria: 'CONVOCACAO',
  categoria_rotulo: 'Convocação',
  exige_confirmacao: true,
  valido_ate: '2026-11-30',
  publicado_em: '2026-10-20T12:00:00',
  publico_descricao: 'Associados em situação Ativo - Em Dia',
  autor: 'Ana Presidente',
  situacao: 'No mural',
  retirado_em: null,
  motivo_retirada: null,
  leitura_apagada_em: null,
  totais: { destinatarios: 3, lidos: 1, confirmados: 1, sem_acesso: 1 },
  texto: 'Convocamos todos.',
  nomes_ocultos: false,
  destinatarios: [
    destinatario({
      id_destinatario: 1,
      nome: 'Ana',
      lido_em: '2026-10-20T13:00:00',
      confirmado_em: '2026-10-20T13:01:00',
    }),
    destinatario({ id_destinatario: 2, nome: 'Bruno' }),
    destinatario({
      id_destinatario: 3,
      nome: 'Carla',
      tinha_acesso: false,
      tem_acesso_hoje: false,
    }),
  ],
  ...extra,
})

const OPCOES: com.OpcoesDePublico = {
  situacoes: ['Ativo - Em Dia', 'Ativo - Inadimplente'],
  categorias_de_associado: ['Efetivo', 'Fundador'],
  permissoes: [
    { codigo: 'financeiro', modulo: 'financeiro', descricao: 'Financeiro' },
  ],
  projetos: [{ id_projeto: 3, nome: 'Despertai' }],
  categorias_de_aviso: [
    { codigo: 'GERAL', rotulo: 'Geral' },
    { codigo: 'CONVOCACAO', rotulo: 'Convocação' },
  ],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(com.opcoesDePublico).mockResolvedValue(OPCOES)
})

describe('regras da tela', () => {
  it('o público enviado leva só os campos do tipo escolhido', () => {
    const misturado: com.PublicoDoAviso = {
      tipo: 'permissao',
      situacoes: ['Ativo - Em Dia'],
      categorias: ['Efetivo'],
      partes_do_projeto: ['equipe'],
      codigo_permissao: 'financeiro',
      id_projeto: 3,
    }
    expect(com.publicoParaEnviar(misturado)).toEqual({
      tipo: 'permissao',
      situacoes: [],
      categorias: [],
      partes_do_projeto: [],
      codigo_permissao: 'financeiro',
    })
    expect(com.publicoParaEnviar({ ...misturado, tipo: 'associados' })).toEqual(
      {
        tipo: 'associados',
        situacoes: ['Ativo - Em Dia'],
        categorias: ['Efetivo'],
        partes_do_projeto: [],
      },
    )
    expect(com.publicoParaEnviar({ ...misturado, tipo: 'projeto' })).toEqual({
      tipo: 'projeto',
      situacoes: ['Ativo - Em Dia'],
      categorias: ['Efetivo'],
      partes_do_projeto: ['equipe'],
      id_projeto: 3,
    })
  })

  it('diz o que falta escolher no grupo', () => {
    const base = com.PUBLICO_INICIAL
    expect(com.faltaNoPublico(base)).toBeNull()
    expect(com.faltaNoPublico({ ...base, tipo: 'permissao' })).toMatch(
      /permissão/,
    )
    expect(com.faltaNoPublico({ ...base, tipo: 'projeto' })).toMatch(/projeto/)
    expect(
      com.faltaNoPublico({
        ...base,
        tipo: 'projeto',
        id_projeto: 3,
        partes_do_projeto: [],
      }),
    ).toMatch(/equipe/)
  })

  it('o relatório diz quem não foi avisado por não ter acesso', () => {
    expect(com.textoDaLeitura(destinatario())).toBe('Ainda não leu')
    expect(
      com.textoDaLeitura(
        destinatario({ tinha_acesso: false, tem_acesso_hoje: false }),
      ),
    ).toBe('Sem acesso ao painel: não foi avisado')
    expect(
      com.textoDaLeitura(
        destinatario({ tinha_acesso: false, tem_acesso_hoje: true }),
      ),
    ).toBe('Ganhou acesso depois; ainda não leu')
    expect(
      com.textoDaLeitura(
        destinatario({ tinha_acesso: false, lido_em: '2026-10-21T10:00:00' }),
      ),
    ).toBe('Ganhou acesso depois e leu')
    const todos = avisoCompleto().destinatarios
    expect(
      com.filtrarDestinatarios(todos, 'nao_leram').map((d) => d.nome),
    ).toEqual(['Bruno', 'Carla'])
    expect(
      com.filtrarDestinatarios(todos, 'sem_acesso').map((d) => d.nome),
    ).toEqual(['Carla'])
  })

  it('confirmar vale até o aviso ser retirado; o selo de pendente, só no mural', () => {
    expect(com.podeConfirmar(meuAviso({ situacao: 'Vencido' }))).toBe(true)
    expect(com.confirmacaoPendente(meuAviso({ situacao: 'Vencido' }))).toBe(
      false,
    )
    expect(com.podeConfirmar(meuAviso({ situacao: 'Retirado' }))).toBe(false)
    expect(
      com.podeConfirmar(meuAviso({ confirmado_em: '2026-10-20T14:00:00' })),
    ).toBe(false)
    expect(com.podeConfirmar(meuAviso({ exige_confirmacao: false }))).toBe(
      false,
    )
  })

  it('o módulo Comunicação só aparece para quem tem comunicar', () => {
    const modulo = modulos.find((m) => m.rota === '/comunicacao')!
    expect(moduloVisivel(modulo, ['comunicar'])).toBe(true)
    expect(moduloVisivel(modulo, ['associados', 'gerenciar_acesso'])).toBe(
      false,
    )
  })
})

describe('o mural', () => {
  it('mostra os avisos e marca o que pede confirmação', async () => {
    vi.mocked(com.listarMeusAvisos).mockResolvedValue({
      nao_lidos: 1,
      confirmacoes_pendentes: 1,
      avisos: [
        meuAviso(),
        meuAviso({
          id_aviso: 8,
          titulo: 'Bazar',
          exige_confirmacao: false,
          lido_em: null,
        }),
      ],
    })
    desenhar('/', '/', <MuralDeAvisos />)
    expect(
      await screen.findByRole('link', { name: 'Assembleia ordinária' }),
    ).toHaveAttribute('href', '/meus-avisos/7')
    expect(screen.getAllByText('Pede a sua confirmação')).toHaveLength(1)
    expect(com.listarMeusAvisos).toHaveBeenCalledWith(true)
  })

  it('vazio, diz que não há aviso', async () => {
    vi.mocked(com.listarMeusAvisos).mockResolvedValue({
      nao_lidos: 0,
      confirmacoes_pendentes: 0,
      avisos: [],
    })
    desenhar('/', '/', <MuralDeAvisos />)
    expect(await screen.findByText('Nenhum aviso no mural.')).toBeVisible()
  })
})

describe('o aviso recebido', () => {
  it('mostra o texto como texto (nunca HTML) e confirma a leitura', async () => {
    vi.mocked(com.abrirMeuAviso).mockResolvedValue(meuAviso())
    vi.mocked(com.confirmarMeuAviso).mockResolvedValue(
      meuAviso({ confirmado_em: '2026-10-20T14:00:00' }),
    )
    const { container } = desenhar(
      '/meus-avisos/7',
      '/meus-avisos/:id',
      <MeuAvisoPage />,
    )
    expect(await screen.findByText(/<b>sem negrito<\/b>/)).toBeVisible()
    expect(container.querySelector('b')).toBeNull()
    expect(com.abrirMeuAviso).toHaveBeenCalledWith(7)
    expect(await axe(container)).toHaveNoViolations()
    await userEvent.click(
      screen.getByRole('button', { name: 'Li e estou ciente' }),
    )
    expect(com.confirmarMeuAviso).toHaveBeenCalledWith(7)
    expect(
      await screen.findByText(/Você confirmou que leu e está ciente/),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Li e estou ciente' }),
    ).toBeNull()
  })

  it('retirado: mostra o motivo e não oferece confirmar', async () => {
    vi.mocked(com.abrirMeuAviso).mockResolvedValue(
      meuAviso({
        situacao: 'Retirado',
        retirado_em: '2026-10-21T12:00:00',
        motivo_retirada: 'A data mudou, novo aviso a seguir.',
      }),
    )
    desenhar('/meus-avisos/7', '/meus-avisos/:id', <MeuAvisoPage />)
    expect(
      await screen.findByText(/Motivo: A data mudou, novo aviso a seguir\./),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Li e estou ciente' }),
    ).toBeNull()
  })

  it('aviso de outra pessoa (404): não encontrado', async () => {
    vi.mocked(com.abrirMeuAviso).mockRejectedValue(
      new ApiError(404, 'Aviso não encontrado.'),
    )
    desenhar('/meus-avisos/99', '/meus-avisos/:id', <MeuAvisoPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Aviso não encontrado.',
    )
  })
})

describe('publicar um aviso', () => {
  async function preencher() {
    await userEvent.type(
      await screen.findByLabelText('Título'),
      'Assembleia ordinária',
    )
    await userEvent.type(screen.getByLabelText(/^Texto/), 'Convocamos todos.')
  }

  it('só publica depois de conferir o grupo, com o total na confirmação', async () => {
    vi.mocked(com.conferirPublico).mockResolvedValue({
      descricao: 'Associados em situação Ativo - Em Dia',
      total: 2,
      sem_acesso: 1,
      pessoas: [
        { nome: 'Ana', tem_acesso: true },
        { nome: 'Carla', tem_acesso: false },
      ],
    })
    vi.mocked(com.publicarAviso).mockResolvedValue(avisoCompleto())
    const { container } = desenhar(
      '/comunicacao/novo',
      '/comunicacao/novo',
      <AvisoNovoPage />,
    )
    await preencher()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Ativo - Em Dia'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    expect(com.conferirPublico).toHaveBeenCalledWith({
      tipo: 'associados',
      situacoes: ['Ativo - Em Dia'],
      categorias: [],
      partes_do_projeto: [],
    })
    expect(await screen.findByText(/2 pessoas \(1 sem acesso/)).toBeVisible()
    expect(await axe(container)).toHaveNoViolations()

    await userEvent.click(
      screen.getByRole('button', { name: 'Publicar para 2 pessoas' }),
    )
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent('vai para 2 pessoas')
    await userEvent.click(
      within(dialogo).getByRole('button', { name: 'Publicar para 2 pessoas' }),
    )
    await waitFor(() =>
      expect(com.publicarAviso).toHaveBeenCalledWith(
        expect.objectContaining({
          titulo: 'Assembleia ordinária',
          texto: 'Convocamos todos.',
          total_confirmado: 2,
          publico: expect.objectContaining({ situacoes: ['Ativo - Em Dia'] }),
        }),
      ),
    )
    expect(await screen.findByText('relatório aberto')).toBeVisible()
  })

  it('mudar o grupo depois de conferir apaga a contagem', async () => {
    vi.mocked(com.conferirPublico).mockResolvedValue({
      descricao: 'Todos os associados (menos os desligados)',
      total: 5,
      sem_acesso: 0,
      pessoas: [],
    })
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await preencher()
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Publicar para 5 pessoas' }),
    ).toBeEnabled()
    await userEvent.click(screen.getByLabelText('Fundador'))
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('o grupo mudou no servidor (409): a contagem sai e a mensagem aparece', async () => {
    vi.mocked(com.conferirPublico).mockResolvedValue({
      descricao: 'Todos',
      total: 5,
      sem_acesso: 0,
      pessoas: [],
    })
    vi.mocked(com.publicarAviso).mockRejectedValue(
      new ApiError(409, 'O grupo mudou desde a conferência: agora são 6.'),
    )
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await preencher()
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Publicar para 5 pessoas' }),
    )
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Publicar para 5 pessoas',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O grupo mudou desde a conferência',
    )
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('por permissão e por projeto, pede a escolha antes de conferir', async () => {
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await userEvent.click(
      await screen.findByLabelText('Quem tem uma permissão'),
    )
    expect(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    ).toBeDisabled()
    expect(screen.getByText('Escolha a permissão.')).toBeVisible()
    await userEvent.click(
      screen.getByLabelText('Equipe e voluntários de um projeto'),
    )
    expect(screen.getByText('Escolha o projeto.')).toBeVisible()
  })
})

describe('o relatório de leitura', () => {
  it('mostra quem leu, confirmou e quem não foi avisado', async () => {
    vi.mocked(com.detalharAviso).mockResolvedValue(avisoCompleto())
    const { container } = desenhar(
      '/comunicacao/7',
      '/comunicacao/:id',
      <AvisoDetalhePage />,
    )
    expect(
      await screen.findByText('Sem acesso ao painel: não foi avisado'),
    ).toBeVisible()
    expect(
      screen.getByText(/Receberam: 3 \(1 sem acesso ao painel\)/),
    ).toBeVisible()
    expect(await axe(container)).toHaveNoViolations()
    await userEvent.selectOptions(screen.getByLabelText('Mostrar'), 'nao_leram')
    const linhas = screen.getAllByRole('row').slice(1)
    expect(
      linhas.map((l) => within(l).getAllByRole('cell')[0]?.textContent),
    ).toEqual(['Bruno', 'Carla'])
  })

  it('retirar exige o motivo e incluir diz quantos entraram', async () => {
    vi.mocked(com.detalharAviso).mockResolvedValue(avisoCompleto())
    vi.mocked(com.incluirNovosNoAviso).mockResolvedValue({
      incluidos: 2,
      aviso: avisoCompleto(),
    })
    const retirado = avisoCompleto({
      situacao: 'Retirado',
      retirado_em: '2026-10-21T12:00:00',
      motivo_retirada: 'A data mudou, novo aviso.',
    })
    // depois de retirar, a tela relê o aviso: o servidor já o devolve retirado
    vi.mocked(com.retirarAviso).mockImplementation(async () => {
      vi.mocked(com.detalharAviso).mockResolvedValue(retirado)
      return retirado
    })
    desenhar('/comunicacao/7', '/comunicacao/:id', <AvisoDetalhePage />)
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Incluir quem entrou no grupo depois',
      }),
    )
    expect(await screen.findByText('2 pessoas incluídas.')).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: 'Retirar do mural' }),
    )
    const retirar = screen.getByRole('button', { name: 'Retirar o aviso' })
    await userEvent.type(screen.getByLabelText(/Motivo da retirada/), 'curto')
    expect(retirar).toBeDisabled()
    await userEvent.type(
      screen.getByLabelText(/Motivo da retirada/),
      ' demais: a data mudou',
    )
    await userEvent.click(retirar)
    expect(com.retirarAviso).toHaveBeenCalledWith(
      7,
      'curto demais: a data mudou',
    )
    expect(await screen.findByText('Aviso retirado do mural.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Retirar do mural' }),
    ).toBeNull()
  })
})

// achados da conferência independente (2026-10-20)
describe('a conferência só vale para o grupo conferido', () => {
  it('uma resposta que chega depois de a pessoa mudar o grupo não habilita o publicar', async () => {
    let responder: (r: com.ConferenciaDoPublico) => void = () => {}
    vi.mocked(com.conferirPublico).mockImplementation(
      () =>
        new Promise((resolve) => {
          responder = resolve
        }),
    )
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    await userEvent.type(await screen.findByLabelText('Título'), 'Aviso')
    await userEvent.type(screen.getByLabelText(/^Texto/), 'Texto')
    await userEvent.click(
      screen.getByRole('button', { name: 'Conferir quem vai receber' }),
    )
    // muda o grupo ANTES de a resposta chegar
    await userEvent.click(screen.getByLabelText('Fundador'))
    responder({
      descricao: 'Todos os associados (menos os desligados)',
      total: 12,
      sem_acesso: 0,
      pessoas: [],
    })
    await waitFor(() => expect(com.conferirPublico).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /Publicar para/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('quem não pode ver a situação do associado não vê o filtro de situação', async () => {
    vi.mocked(com.opcoesDePublico).mockResolvedValue({
      ...OPCOES,
      situacoes: [],
    })
    desenhar('/comunicacao/novo', '/comunicacao/novo', <AvisoNovoPage />)
    expect(await screen.findByLabelText('Fundador')).toBeVisible()
    expect(screen.queryByText(/Situação do associado/)).toBeNull()
  })

  it('o relatório de um grupo por situação, para quem não pode ver a situação, mostra só os totais', async () => {
    vi.mocked(com.detalharAviso).mockResolvedValue(
      avisoCompleto({ nomes_ocultos: true, destinatarios: [] }),
    )
    desenhar('/comunicacao/7', '/comunicacao/:id', <AvisoDetalhePage />)
    expect(
      await screen.findByText(/Os nomes só aparecem para quem tem a permissão/),
    ).toBeVisible()
    expect(screen.getByText(/Receberam: 3/)).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
