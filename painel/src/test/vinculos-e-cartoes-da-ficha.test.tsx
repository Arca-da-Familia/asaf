import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CompletudeDoCadastro,
  SituacaoGuardadaECalculada,
} from '@/components/associados/CompletudeECategoria'
import { VinculosDaPessoa } from '@/components/associados/VinculosDaPessoa'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  obterTermoVigente: vi.fn(),
  registrarTermoDeVoluntario: vi.fn(),
  listarFuncionarios: vi.fn(),
  cadastrarFuncionario: vi.fn(),
  marcarContatoSuspeito: vi.fn(),
  redefinirSegundoPasso: vi.fn(),
  obterCompletude: vi.fn(),
  obterCategoriaCalculada: vi.fn(),
  confirmarMeusDados: vi.fn(),
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

function desenhar(
  elemento: React.ReactElement,
  permissoes: string[] = ['associados'],
) {
  vi.mocked(api.me).mockResolvedValue(eu(permissoes))
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>{elemento}</QueryClientProvider>,
  )
}

const vinculos = (idUsuario: number | null = 7) => (
  <VinculosDaPessoa idPessoa={5} idUsuario={idUsuario} nome="Maria de Teste" />
)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.obterTermoVigente).mockResolvedValue({ vigente: false })
  vi.mocked(api.listarFuncionarios).mockResolvedValue([])
})

describe('Vínculos da pessoa (v5.4c: a tela que faltava para as rotas da v1.6 e v1.8)', () => {
  it('sem termo e sem vínculo de funcionário, explica o que isso significa', async () => {
    desenhar(vinculos())
    expect(
      await screen.findByText(/Sem termo de adesão vigente/),
    ).toBeInTheDocument()
    expect(await screen.findByText(/Não é funcionário/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar termo de adesão' }),
    ).toBeInTheDocument()
  })

  it('com termo vigente mostra os dados e oferece renovar', async () => {
    vi.mocked(api.obterTermoVigente).mockResolvedValue({
      vigente: true,
      id_termo: 1,
      atividade: 'Oficina de música',
      carga_horaria_semanal: 4,
      data_fim_vigencia: '2027-01-31T00:00:00',
      versao: 2,
    })
    desenhar(vinculos())
    expect(await screen.findByTestId('termo-vigente')).toHaveTextContent(
      'Oficina de música, 4 h por semana, até 31/01/2027 (versão 2)',
    )
    expect(
      screen.getByRole('button', { name: 'Renovar termo de adesão' }),
    ).toBeInTheDocument()
  })

  it('registrar termo: barra campo vazio e envia a carga com vírgula como número', async () => {
    const u = userEvent.setup()
    vi.mocked(api.registrarTermoDeVoluntario).mockResolvedValue({
      mensagem: 'Termo de adesão registrado.',
      id_termo: 9,
      versao: 1,
    })
    desenhar(vinculos())
    await u.click(
      await screen.findByRole('button', { name: 'Registrar termo de adesão' }),
    )
    await u.click(
      screen.getByRole('button', { name: 'Confirmar termo de adesão' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preencha: Atividade, Carga horária, Fim.',
    )
    expect(api.registrarTermoDeVoluntario).not.toHaveBeenCalled()

    await u.type(screen.getByLabelText('Atividade *'), 'Apoio na cozinha')
    await u.type(screen.getByLabelText('Carga horária semanal *'), '3,5')
    await u.type(screen.getByLabelText('Fim da vigência *'), '2027-06-30')
    await u.click(
      screen.getByRole('button', { name: 'Confirmar termo de adesão' }),
    )
    await waitFor(() =>
      expect(api.registrarTermoDeVoluntario).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          atividade: 'Apoio na cozinha',
          carga_horaria_semanal: 3.5,
          data_fim_vigencia: '2027-06-30',
        }),
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Termo de adesão registrado. Versão 1.',
    )
  })

  it('funcionário já cadastrado aparece e não oferece cadastrar de novo; novo é cadastrado com cargo e admissão', async () => {
    const u = userEvent.setup()
    vi.mocked(api.cadastrarFuncionario).mockResolvedValue({
      mensagem: 'Funcionário cadastrado.',
      id_funcionario: 1,
    })
    const { unmount } = desenhar(vinculos())
    await u.click(
      await screen.findByRole('button', {
        name: 'Cadastrar como funcionário(a)',
      }),
    )
    await u.type(screen.getByLabelText('Cargo *'), 'Cozinheira')
    await u.click(
      screen.getByRole('button', {
        name: 'Confirmar cadastro de funcionário(a)',
      }),
    )
    await waitFor(() =>
      expect(api.cadastrarFuncionario).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ cargo: 'Cozinheira' }),
      ),
    )
    unmount()

    vi.mocked(api.listarFuncionarios).mockResolvedValue([
      {
        id_funcionario: 1,
        id_pessoa: 5,
        cargo: 'Cozinheira',
        id_conta_centro_custo: null,
        data_admissao: '2026-03-02T00:00:00',
        ativo: true,
      },
    ])
    desenhar(vinculos())
    expect(
      await screen.findByTestId('funcionario-cadastrado'),
    ).toHaveTextContent('Cozinheira, admitido(a) em 02/03/2026')
    expect(
      screen.queryByRole('button', { name: 'Cadastrar como funcionário(a)' }),
    ).not.toBeInTheDocument()
  })

  it('e-mail suspeito exige dizer o que aconteceu e manda para a fila', async () => {
    const u = userEvent.setup()
    vi.mocked(api.marcarContatoSuspeito).mockResolvedValue({
      mensagem: 'Contato marcado como suspeito.',
      id_fila: 3,
    })
    desenhar(vinculos())
    await u.click(
      await screen.findByRole('button', {
        name: 'Marcar e-mail como suspeito (devolveu)',
      }),
    )
    await u.click(
      screen.getByRole('button', { name: 'Confirmar e-mail suspeito' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Preencha: Motivo.',
    )
    await u.type(
      screen.getByLabelText('O que aconteceu? *'),
      'voltou inexistente',
    )
    await u.click(
      screen.getByRole('button', { name: 'Confirmar e-mail suspeito' }),
    )
    await waitFor(() =>
      expect(api.marcarContatoSuspeito).toHaveBeenCalledWith(
        5,
        'voltou inexistente',
      ),
    )
  })

  it('redefinir o segundo passo só aparece para quem gerencia o acesso e pede confirmação', async () => {
    const u = userEvent.setup()
    vi.mocked(api.redefinirSegundoPasso).mockResolvedValue({
      mensagem: 'MFA do usuário resetado.',
    })
    const sem = desenhar(vinculos(), ['associados'])
    await screen.findByText(/Sem termo de adesão vigente/)
    expect(
      screen.queryByRole('button', { name: 'Redefinir o segundo passo (MFA)' }),
    ).not.toBeInTheDocument()
    sem.unmount()

    desenhar(vinculos(7), ['associados', 'gerenciar_acesso'])
    await u.click(
      await screen.findByRole('button', {
        name: 'Redefinir o segundo passo (MFA)',
      }),
    )
    expect(api.redefinirSegundoPasso).not.toHaveBeenCalled()
    expect(
      await screen.findByText('Redefinir o segundo passo de Maria de Teste?'),
    ).toBeInTheDocument()
    await u.click(
      screen.getByRole('button', { name: 'Redefinir segundo passo' }),
    )
    await waitFor(() =>
      expect(api.redefinirSegundoPasso).toHaveBeenCalledWith(7),
    )
  })

  it('quem não tem acesso ao painel não tem o que redefinir', async () => {
    desenhar(vinculos(null), ['associados', 'gerenciar_acesso'])
    expect(
      await screen.findByText(/ainda não tem acesso ao painel/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Redefinir o segundo passo (MFA)' }),
    ).not.toBeInTheDocument()
  })

  it('não tem violação de acessibilidade (axe) com o formulário aberto', async () => {
    const u = userEvent.setup()
    const { container } = desenhar(vinculos())
    await u.click(
      await screen.findByRole('button', { name: 'Registrar termo de adesão' }),
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Completude e situação calculada (v1.1)', () => {
  it('mostra o percentual e o que falta, com nome de gente', async () => {
    vi.mocked(api.obterCompletude).mockResolvedValue({
      percentual: 70,
      campos_faltando: ['profissao', 'naturalidade', 'foto'],
    })
    desenhar(<CompletudeDoCadastro idAssociado={1} />)
    expect(
      await screen.findByTestId('completude-percentual'),
    ).toHaveTextContent('70%')
    expect(
      screen.getByText('Falta: profissão, naturalidade, foto.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '70',
    )
  })

  it('cadastro completo diz que nada falta', async () => {
    vi.mocked(api.obterCompletude).mockResolvedValue({
      percentual: 100,
      campos_faltando: [],
    })
    desenhar(<CompletudeDoCadastro idAssociado={1} />)
    expect(
      await screen.findByText('Nada falta: o cadastro está completo.'),
    ).toBeInTheDocument()
  })

  it('situação guardada diferente da calculada avisa; igual, confirma', async () => {
    vi.mocked(api.obterCategoriaCalculada).mockResolvedValueOnce({
      status_arrolamento_materializado: 'Ativo - Em Dia',
      categoria_calculada_agora: 'Ativo - Inadimplente',
      desatualizado: true,
    })
    const { unmount } = desenhar(<SituacaoGuardadaECalculada idAssociado={1} />)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'desatualizada em relação ao financeiro',
    )
    unmount()
    vi.mocked(api.obterCategoriaCalculada).mockResolvedValueOnce({
      status_arrolamento_materializado: 'Ativo - Em Dia',
      categoria_calculada_agora: 'Ativo - Em Dia',
      desatualizado: false,
    })
    desenhar(<SituacaoGuardadaECalculada idAssociado={1} />)
    expect(await screen.findByText(/As duas batem/)).toBeInTheDocument()
  })
})

describe('Confirmar meus dados (v1.8: recadastramento do próprio associado)', () => {
  it('confirmar chama o servidor e mostra a data; falha do servidor aparece', async () => {
    const { ConfirmarMeusDados } =
      await import('@/components/associados/ConfirmarMeusDados')
    const u = userEvent.setup()
    vi.mocked(api.confirmarMeusDados).mockRejectedValueOnce(
      new Error('Sem associado vinculado.'),
    )
    desenhar(<ConfirmarMeusDados />)
    const botao = screen.getByRole('button', {
      name: 'Confirmo que meus dados estão corretos',
    })
    await u.click(botao)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sem associado vinculado.',
    )

    vi.mocked(api.confirmarMeusDados).mockResolvedValueOnce({
      mensagem: 'Dados confirmados.',
      data_ultima_confirmacao: '2026-10-06T15:00:00',
    })
    await u.click(botao)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Dados confirmados em 06/10/2026.',
    )
  })
})
