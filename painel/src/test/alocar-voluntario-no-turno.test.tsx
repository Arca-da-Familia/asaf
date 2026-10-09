import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AlocarVoluntarioNoTurno } from '@/components/projetos/AlocarVoluntarioNoTurno'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarAlocacoesDoProjeto: vi.fn(),
  listarVoluntariosParaSelecao: vi.fn(),
  alocarVoluntario: vi.fn(),
}))

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <AlocarVoluntarioNoTurno idProjeto={7} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarVoluntariosParaSelecao).mockResolvedValue([
    {
      id_pessoa: 101,
      id_associado: 11,
      nome_completo: 'Ana Souza',
      eh_associado: true,
      tem_termo_vigente: true,
    },
    {
      id_pessoa: 102,
      id_associado: 12,
      nome_completo: 'Bia Lima',
      eh_associado: true,
      tem_termo_vigente: true,
    },
    {
      id_pessoa: 103,
      id_associado: null,
      nome_completo: 'Caio Prado',
      eh_associado: false,
      tem_termo_vigente: true,
    },
    {
      id_pessoa: 104,
      id_associado: null,
      nome_completo: 'Duda Reis',
      eh_associado: false,
      tem_termo_vigente: false,
    },
    {
      id_pessoa: 105,
      id_associado: 15,
      nome_completo: 'Eli Santos',
      eh_associado: true,
      tem_termo_vigente: false,
    },
  ])
  vi.mocked(api.listarAlocacoesDoProjeto).mockResolvedValue([])
  vi.mocked(api.alocarVoluntario).mockResolvedValue({
    mensagem: 'Voluntário escalado com sucesso!',
  })
})

describe('Alocar voluntário direto num turno', () => {
  it('mostra a escala do projeto com o nome, o turno e a situação; passa no axe', async () => {
    vi.mocked(api.listarAlocacoesDoProjeto).mockResolvedValue([
      {
        id_alocacao: 1,
        id_projeto: 7,
        id_pessoa: 101,
        id_associado: 11,
        nome_voluntario: 'Ana Souza',
        nome_associado: 'Ana Souza',
        eh_associado: true,
        funcao_desempenhada: 'Recepção',
        id_vaga: null,
        turno_data_hora_inicio: '2026-11-02T08:00:00',
        turno_data_hora_fim: '2026-11-02T12:00:00',
        habilidades_exigidas: null,
        horas_previstas: 4,
        horas_realizadas: 0,
        status: 'CONFIRMADA',
      },
    ])
    const { container } = desenhar()
    const linha = await screen.findByText(/Ana Souza — Recepção/)
    expect(linha).toHaveTextContent('4 h previstas · CONFIRMADA')
    expect(linha).not.toHaveTextContent('não associado')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('na escala, quem não é associado aparece com o nome e a marca "(não associado)"', async () => {
    vi.mocked(api.listarAlocacoesDoProjeto).mockResolvedValue([
      {
        id_alocacao: 2,
        id_projeto: 7,
        id_pessoa: 103,
        id_associado: null,
        nome_voluntario: 'Caio Prado',
        nome_associado: 'Caio Prado',
        eh_associado: false,
        funcao_desempenhada: 'Apoio na cozinha',
        id_vaga: null,
        turno_data_hora_inicio: '2026-11-03T08:00:00',
        turno_data_hora_fim: '2026-11-03T12:00:00',
        habilidades_exigidas: null,
        horas_previstas: 4,
        horas_realizadas: 0,
        status: 'CONFIRMADA',
      },
    ])
    desenhar()
    const linha = await screen.findByText(
      /Caio Prado \(não associado\) — Apoio/,
    )
    expect(linha).toHaveTextContent(
      'Caio Prado (não associado) — Apoio na cozinha',
    )
    expect(linha).toHaveTextContent('4 h previstas · CONFIRMADA')
  })

  it('sem ninguém na escala, diz isso', async () => {
    desenhar()
    expect(
      await screen.findByText('Ninguém está na escala deste projeto ainda.'),
    ).toBeInTheDocument()
  })

  it('o formulário vazio mostra o que falta e não envia nada', async () => {
    const u = userEvent.setup()
    desenhar()
    await u.click(await screen.findByRole('button', { name: 'Alocar agora' }))
    expect(await screen.findByText('Escolha o voluntário.')).toBeInTheDocument()
    expect(screen.getByText('Informe a função.')).toBeInTheDocument()
    expect(screen.getByText('Informe o início do turno.')).toBeInTheDocument()
    expect(screen.getByText('Informe o fim do turno.')).toBeInTheDocument()
    expect(api.alocarVoluntario).not.toHaveBeenCalled()
  })

  it('escolhe a pessoa, a função e o turno e aloca', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('option', { name: 'Bia Lima' })
    await u.selectOptions(screen.getByLabelText('Voluntário'), 'Bia Lima')
    await u.type(
      screen.getByLabelText('Função do voluntário'),
      'Apoio na cozinha',
    )
    await u.type(
      screen.getByLabelText('Início do turno do voluntário'),
      '2026-11-02T13:00',
    )
    await u.type(
      screen.getByLabelText('Fim do turno do voluntário'),
      '2026-11-02T17:00',
    )
    await u.clear(screen.getByLabelText('Horas previstas do voluntário'))
    await u.type(screen.getByLabelText('Horas previstas do voluntário'), '4')
    await u.click(screen.getByRole('button', { name: 'Alocar agora' }))
    await waitFor(() => expect(api.alocarVoluntario).toHaveBeenCalledTimes(1))
    const enviado = vi.mocked(api.alocarVoluntario).mock.calls[0]![0]
    expect(enviado).toMatchObject({
      id_projeto: 7,
      id_pessoa: 102,
      funcao_desempenhada: 'Apoio na cozinha',
      horas_previstas: 4,
    })
    // quem manda é a pessoa: o servidor aceita o `id_associado` por compatibilidade, mas a tela não o envia
    expect(enviado).not.toHaveProperty('id_associado')
    expect(enviado.turno_data_hora_inicio).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // depois de alocar, a escala é lida de novo
    await waitFor(() =>
      expect(vi.mocked(api.listarAlocacoesDoProjeto).mock.calls.length).toBe(2),
    )
  })

  it('o seletor lista associados e não associados, avisa "(não associado)" e "— sem termo vigente" no FINAL do texto', async () => {
    desenhar()
    await screen.findByRole('option', { name: 'Ana Souza' })
    const opcoes = within(screen.getByLabelText('Voluntário')).getAllByRole(
      'option',
    )
    expect(opcoes.map((o) => o.textContent)).toEqual([
      'Escolha o voluntário',
      'Ana Souza',
      'Bia Lima',
      'Caio Prado (não associado)',
      'Duda Reis (não associado) — sem termo vigente',
      'Eli Santos — sem termo vigente',
    ])
    // o valor é a pessoa, não o associado
    expect(opcoes.map((o) => (o as HTMLOptionElement).value)).toEqual([
      '0',
      '101',
      '102',
      '103',
      '104',
      '105',
    ])
    // quem escolhe pelo trecho do nome continua achando a opção
    expect(
      screen.getByRole('option', { name: /^Duda Reis/ }),
    ).toBeInTheDocument()
  })

  it('aloca quem não é associado: manda só a pessoa (id_pessoa)', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('option', { name: 'Caio Prado (não associado)' })
    await u.selectOptions(
      screen.getByLabelText('Voluntário'),
      'Caio Prado (não associado)',
    )
    await u.type(screen.getByLabelText('Função do voluntário'), 'Recepção')
    await u.type(
      screen.getByLabelText('Início do turno do voluntário'),
      '2026-11-02T08:00',
    )
    await u.type(
      screen.getByLabelText('Fim do turno do voluntário'),
      '2026-11-02T12:00',
    )
    await u.click(screen.getByRole('button', { name: 'Alocar agora' }))
    await waitFor(() => expect(api.alocarVoluntario).toHaveBeenCalledTimes(1))
    const enviado = vi.mocked(api.alocarVoluntario).mock.calls[0]![0]
    expect(enviado).toMatchObject({ id_projeto: 7, id_pessoa: 103 })
    expect(enviado).not.toHaveProperty('id_associado')
  })

  it('a recusa do servidor (sem termo de voluntariado) aparece em português, mesmo para quem a lista já marcou "sem termo vigente"', async () => {
    const u = userEvent.setup()
    vi.mocked(api.alocarVoluntario).mockRejectedValue(
      new api.ApiError(
        403,
        'Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.',
      ),
    )
    desenhar()
    await screen.findByRole('option', { name: /^Duda Reis/ })
    await u.selectOptions(
      screen.getByLabelText('Voluntário'),
      'Duda Reis (não associado) — sem termo vigente',
    )
    await u.type(screen.getByLabelText('Função do voluntário'), 'Recepção')
    await u.type(
      screen.getByLabelText('Início do turno do voluntário'),
      '2026-11-02T08:00',
    )
    await u.type(
      screen.getByLabelText('Fim do turno do voluntário'),
      '2026-11-02T12:00',
    )
    await u.click(screen.getByRole('button', { name: 'Alocar agora' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Voluntário sem termo de adesão vigente - não pode ser alocado em projeto.',
    )
    expect(api.alocarVoluntario).toHaveBeenCalledWith(
      expect.objectContaining({ id_pessoa: 104 }),
    )
  })

  it('o formulário e o seletor, com a lista carregada, passam no axe', async () => {
    const { container } = desenhar()
    await screen.findByRole('option', { name: /^Duda Reis/ })
    expect(await axe(container)).toHaveNoViolations()
  })
})
