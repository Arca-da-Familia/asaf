import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { PropostaDeFiliacao } from '@/lib/api'
import { PropostasDeFiliacaoPage } from '@/pages/PropostasDeFiliacao'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  listarPropostasDeFiliacao: vi.fn(),
  conferirPropostaDeFiliacao: vi.fn(),
  recusarPropostaDeFiliacao: vi.fn(),
  aprovarPropostaDeFiliacao: vi.fn(),
  listarOpcoesLegado: vi.fn(),
}))

function proposta(
  sobrescrever: Partial<PropostaDeFiliacao> = {},
): PropostaDeFiliacao {
  return {
    id_proposta: 1,
    nome_completo: 'Joana de Teste',
    cpf: '52998224725',
    email_contato: 'joana@homologacao.example.com',
    telefone_whatsapp: '91988887777',
    status: 'Pendente',
    motivo_recusa: null,
    id_associado_efetivado: null,
    criado_em: '2026-10-05T12:00:00',
    total_propoem: 3,
    exigidos: 3,
    proponentes: [1, 2, 3].map((n) => ({
      id_associado: n,
      socio: `Sócio ${n}`,
      decisao: 'Propõe' as const,
      observacao: null,
      em: '2026-10-06T09:00:00',
    })),
    ...sobrescrever,
  }
}

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

function desenhar(permissoes: string[] = ['associados']) {
  vi.mocked(api.me).mockResolvedValue(eu(permissoes))
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <PropostasDeFiliacaoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarOpcoesLegado).mockResolvedValue([
    { id_opcao: 1, valor: 'Efetivo', ativo: true },
    { id_opcao: 2, valor: 'Contribuinte', ativo: true },
  ])
})

describe('Propostas de filiação (v5.4c: a caixa de entrada que faltava para as rotas da v1.2)', () => {
  it('cada situação oferece só os passos que fazem sentido', async () => {
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([
      proposta({ id_proposta: 1, nome_completo: 'Pendente de Teste' }),
      proposta({
        id_proposta: 2,
        nome_completo: 'Conferida de Teste',
        status: 'Em Conferência',
      }),
      proposta({
        id_proposta: 3,
        nome_completo: 'Aprovada de Teste',
        status: 'Aprovada',
        id_associado_efetivado: 42,
      }),
      proposta({
        id_proposta: 4,
        nome_completo: 'Recusada de Teste',
        status: 'Recusada',
        motivo_recusa: 'Documento ilegível',
      }),
    ])
    desenhar()
    const pendente = within(
      await screen.findByRole('listitem', {
        name: 'Proposta de Pendente de Teste',
      }),
    )
    expect(
      pendente.getByRole('button', { name: 'Marcar documentação conferida' }),
    ).toBeInTheDocument()
    expect(
      pendente.queryByRole('button', { name: 'Aprovar e efetivar' }),
    ).not.toBeInTheDocument()

    const conferida = within(
      screen.getByRole('listitem', { name: 'Proposta de Conferida de Teste' }),
    )
    expect(
      conferida.getByRole('button', { name: 'Aprovar e efetivar' }),
    ).toBeInTheDocument()
    expect(
      conferida.queryByRole('button', {
        name: 'Marcar documentação conferida',
      }),
    ).not.toBeInTheDocument()

    const aprovada = within(
      screen.getByRole('listitem', { name: 'Proposta de Aprovada de Teste' }),
    )
    expect(
      aprovada.getByRole('link', { name: 'Abrir o cadastro do associado' }),
    ).toHaveAttribute('href', '/associados/42')
    expect(
      aprovada.queryByRole('button', { name: 'Recusar proposta' }),
    ).not.toBeInTheDocument()

    const recusada = within(
      screen.getByRole('listitem', { name: 'Proposta de Recusada de Teste' }),
    )
    expect(
      recusada.getByText('Motivo da recusa: Documento ilegível'),
    ).toBeInTheDocument()
  })

  it('lista vazia explica o que esperar', async () => {
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([])
    desenhar()
    expect(
      await screen.findByText('Nenhuma proposta por aqui'),
    ).toBeInTheDocument()
  })

  it('o filtro pede ao servidor só a situação escolhida', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([])
    desenhar()
    await screen.findByText('Nenhuma proposta por aqui')
    await u.selectOptions(
      screen.getByLabelText('Situação da proposta'),
      'Recusada',
    )
    await waitFor(() =>
      expect(api.listarPropostasDeFiliacao).toHaveBeenLastCalledWith(
        'Recusada',
      ),
    )
  })

  it('recusar sem motivo é barrado na tela; com motivo, chama o servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([proposta()])
    vi.mocked(api.recusarPropostaDeFiliacao).mockResolvedValue({
      mensagem: 'Proposta recusada.',
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Recusar proposta' }),
    )
    await u.click(screen.getByRole('button', { name: 'Confirmar recusa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe o motivo da recusa.',
    )
    expect(api.recusarPropostaDeFiliacao).not.toHaveBeenCalled()

    await u.type(
      screen.getByLabelText('Motivo da recusa *'),
      'Documento ilegível',
    )
    await u.click(screen.getByRole('button', { name: 'Confirmar recusa' }))
    await waitFor(() =>
      expect(api.recusarPropostaDeFiliacao).toHaveBeenCalledWith(
        1,
        'Documento ilegível',
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Proposta recusada.',
    )
  })

  it('conferir a documentação chama o servidor e avisa', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([proposta()])
    vi.mocked(api.conferirPropostaDeFiliacao).mockResolvedValue({
      mensagem: 'Documentação marcada como conferida.',
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Marcar documentação conferida',
      }),
    )
    await waitFor(() =>
      expect(api.conferirPropostaDeFiliacao).toHaveBeenCalledWith(1),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Documentação marcada como conferida.',
    )
  })

  it('aprovar efetiva com a categoria escolhida e mostra a matrícula', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([
      proposta({ status: 'Em Conferência' }),
    ])
    vi.mocked(api.aprovarPropostaDeFiliacao).mockResolvedValue({
      mensagem: 'Associado efetivado com sucesso.',
      id_associado: 42,
      numero_matricula: 18,
      status_arrolamento: 'Em Experiência',
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Aprovar e efetivar' }),
    )
    await u.selectOptions(
      await screen.findByLabelText('Categoria *'),
      'Contribuinte',
    )
    await u.click(screen.getByRole('button', { name: 'Efetivar associado' }))
    await waitFor(() =>
      expect(api.aprovarPropostaDeFiliacao).toHaveBeenCalledWith(1, {
        categoria: 'Contribuinte',
        forcar: false,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Associado efetivado com sucesso. Matrícula 18.',
    )
  })

  it('cadastro parecido: sem a permissão só avisa; com a permissão do Presidente oferece aprovar mesmo assim', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([
      proposta({ status: 'Em Conferência' }),
    ])
    const parecido = new api.ApiError(
      409,
      "Já existe um cadastro parecido: 'Joana Antiga' - confirme que não é a mesma pessoa antes de aprovar.",
    )
    vi.mocked(api.aprovarPropostaDeFiliacao).mockRejectedValueOnce(parecido)

    const sem = desenhar(['associados'])
    await u.click(
      await screen.findByRole('button', { name: 'Aprovar e efetivar' }),
    )
    await u.click(screen.getByRole('button', { name: 'Efetivar associado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe um cadastro parecido',
    )
    expect(
      screen.queryByRole('button', { name: /Aprovar mesmo assim/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Só quem tem a permissão/)).toBeInTheDocument()
    sem.unmount()

    vi.mocked(api.aprovarPropostaDeFiliacao).mockRejectedValueOnce(parecido)
    vi.mocked(api.aprovarPropostaDeFiliacao).mockResolvedValueOnce({
      mensagem: 'Associado efetivado com sucesso.',
      id_associado: 43,
      numero_matricula: 19,
      status_arrolamento: 'Em Experiência',
    })
    desenhar(['associados', 'forcar_cadastro_duplicado'])
    await u.click(
      await screen.findByRole('button', { name: 'Aprovar e efetivar' }),
    )
    await u.click(screen.getByRole('button', { name: 'Efetivar associado' }))
    await u.click(
      await screen.findByRole('button', { name: /Aprovar mesmo assim/ }),
    )
    await waitFor(() =>
      expect(api.aprovarPropostaDeFiliacao).toHaveBeenLastCalledWith(1, {
        categoria: 'Efetivo',
        forcar: true,
      }),
    )
  })

  it('mostra quem propôs e quem recusou (com o motivo) e só libera "Aprovar e efetivar" com os 3 sócios', async () => {
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([
      proposta({
        id_proposta: 1,
        nome_completo: 'Faltam Sócios',
        status: 'Em Conferência',
        total_propoem: 2,
        proponentes: [
          {
            id_associado: 1,
            socio: 'Ana Sócia',
            decisao: 'Propõe',
            observacao: null,
            em: null,
          },
          {
            id_associado: 2,
            socio: 'Bruno Sócio',
            decisao: 'Propõe',
            observacao: null,
            em: null,
          },
          {
            id_associado: 3,
            socio: 'Carla Sócia',
            decisao: 'Recusa',
            observacao: 'Não conheço a família.',
            em: null,
          },
        ],
      }),
      proposta({
        id_proposta: 2,
        nome_completo: 'Já Completa',
        status: 'Em Conferência',
      }),
    ])
    desenhar()
    const incompleta = within(
      await screen.findByLabelText('Proposta de Faltam Sócios'),
    )
    expect(
      incompleta.getByText('Sócios que propõem: 2 de 3 — faltam 1.'),
    ).toBeInTheDocument()
    const lista = incompleta.getByRole('list', {
      name: 'Sócios sobre o pedido de Faltam Sócios',
    })
    expect(
      within(lista)
        .getByText(/Carla Sócia/)
        .closest('li'),
    ).toHaveTextContent('Recusa — “Não conheço a família.”')
    expect(
      incompleta.getByRole('button', { name: 'Aprovar e efetivar' }),
    ).toBeDisabled()
    expect(
      incompleta.getByRole('button', { name: 'Aprovar e efetivar' }),
    ).toHaveAttribute('title', expect.stringContaining('até agora 2'))
    const completa = within(screen.getByLabelText('Proposta de Já Completa'))
    expect(completa.getByText('Sócios que propõem: 3 de 3')).toBeInTheDocument()
    expect(
      completa.getByRole('button', { name: 'Aprovar e efetivar' }),
    ).toBeEnabled()
  })

  it('não tem violação de acessibilidade (axe)', async () => {
    vi.mocked(api.listarPropostasDeFiliacao).mockResolvedValue([
      proposta(),
      proposta({ id_proposta: 2, status: 'Em Conferência' }),
    ])
    const { container } = desenhar()
    await screen.findAllByRole('listitem')
    expect(await axe(container)).toHaveNoViolations()
  })
})
