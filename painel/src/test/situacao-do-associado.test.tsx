import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SituacaoDoAssociado } from '@/components/associados/SituacaoDoAssociado'
import * as api from '@/lib/api'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarHistoricoDeSituacao: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  registrarLicenca: vi.fn(),
  desligarAssociado: vi.fn(),
  readmitirAssociado: vi.fn(),
  anonimizarAssociado: vi.fn(),
}))

const opcao = (codigo: string, rotulo: string, id: number) => ({
  id_opcao: id,
  id_pai: null,
  codigo,
  rotulo,
  ordem: id,
  ativo: true,
  cor: null,
  icone: null,
})

function desenhar(situacao: string | null = 'Ativo em dia') {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <SituacaoDoAssociado
        idAssociado={17}
        nome="Maria de Teste"
        situacao={situacao}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarHistoricoDeSituacao).mockResolvedValue([
    {
      id_mudanca: 1,
      tipo: 'licenca',
      motivo: 'SAUDE',
      data_efetiva: '2026-03-01T00:00:00',
      data_fim_prevista: '2026-06-01T00:00:00',
      documento_referencia: 'Atestado 12',
    },
  ])
  vi.mocked(api.listarOpcoesCatalogo).mockImplementation(async (chave) =>
    chave === 'motivo_licenca'
      ? [opcao('SAUDE', 'Saúde', 1), opcao('ESTUDO', 'Estudo', 2)]
      : [opcao('PEDIDO_VOLUNTARIO', 'Pedido voluntário', 3)],
  )
})

describe('Situação do associado (v5.4c: a tela que faltava para as rotas da v1.4)', () => {
  it('mostra o DIA certo mesmo no fuso do Brasil (licença de 05/10 não vira 04/10)', async () => {
    const fusoAntes = process.env.TZ
    process.env.TZ = 'America/Belem'
    try {
      vi.mocked(api.listarHistoricoDeSituacao).mockResolvedValue([
        {
          id_mudanca: 1,
          tipo: 'licenca',
          motivo: 'SAUDE',
          data_efetiva: '2026-10-05T00:00:00',
          data_fim_prevista: '2026-11-03T00:00:00',
          documento_referencia: null,
        },
        {
          id_mudanca: 2,
          tipo: 'desligamento',
          motivo: 'PEDIDO_VOLUNTARIO',
          data_efetiva: '2026-10-05T00:00:00',
          data_fim_prevista: null,
          documento_referencia: null,
        },
      ])
      desenhar()
      expect(
        await screen.findByText(
          /Em 05\/10\/2026 · retorno previsto em 03\/11\/2026/,
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('Em 05/10/2026')).toBeInTheDocument()
    } finally {
      if (fusoAntes === undefined) delete process.env.TZ
      else process.env.TZ = fusoAntes
    }
  })

  it('mostra a situação atual e o histórico com o motivo por extenso', async () => {
    desenhar()
    expect(screen.getByTestId('situacao-atual')).toHaveTextContent(
      'Ativo em dia',
    )
    expect(await screen.findByText(/Licença — Saúde/)).toBeInTheDocument()
    expect(screen.getByText(/documento: Atestado 12/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Registrar licença' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Desligar associado' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Readmitir associado' }),
    ).not.toBeInTheDocument()
  })

  it('histórico vazio diz isso em vez de ficar em branco', async () => {
    vi.mocked(api.listarHistoricoDeSituacao).mockResolvedValue([])
    desenhar()
    expect(
      await screen.findByText('Nenhuma mudança de situação registrada'),
    ).toBeInTheDocument()
  })

  it('desligado: oferece readmitir e anonimizar, e não oferece licença nem desligar', async () => {
    desenhar('Desligado')
    expect(
      screen.getByRole('button', { name: 'Readmitir associado' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Anonimizar dado pessoal' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Registrar licença' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Desligar associado' }),
    ).not.toBeInTheDocument()
  })

  it('licença: recusa retorno antes do início, e registra com os dados certos', async () => {
    const u = userEvent.setup()
    vi.mocked(api.registrarLicenca).mockResolvedValue({
      mensagem: 'Licença registrada.',
      status_arrolamento: 'Licenciado',
    })
    desenhar()
    await u.click(screen.getByRole('button', { name: 'Registrar licença' }))
    await u.selectOptions(await screen.findByLabelText('Motivo *'), 'SAUDE')
    await u.clear(screen.getByLabelText('Início da licença *'))
    await u.type(screen.getByLabelText('Início da licença *'), '2026-11-10')
    await u.type(screen.getByLabelText('Retorno previsto *'), '2026-11-01')
    await u.click(screen.getByRole('button', { name: 'Confirmar licença' }))
    expect(
      await screen.findByText(
        'O retorno previsto precisa ser depois do início da licença.',
      ),
    ).toBeInTheDocument()
    expect(api.registrarLicenca).not.toHaveBeenCalled()

    await u.clear(screen.getByLabelText('Retorno previsto *'))
    await u.type(screen.getByLabelText('Retorno previsto *'), '2026-12-10')
    await u.type(
      screen.getByLabelText('Documento de referência'),
      'Atestado 99',
    )
    await u.click(screen.getByRole('button', { name: 'Confirmar licença' }))
    await waitFor(() =>
      expect(api.registrarLicenca).toHaveBeenCalledWith(17, {
        motivo: 'SAUDE',
        data_inicio: '2026-11-10',
        data_fim_prevista: '2026-12-10',
        documento_referencia: 'Atestado 99',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Licença registrada.',
    )
  })

  it('desligar: exige confirmar as consequências antes de chamar o servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(api.desligarAssociado).mockResolvedValue({
      mensagem: 'Desligamento registrado.',
      titulos_cancelados: 2,
    })
    desenhar()
    await u.click(screen.getByRole('button', { name: 'Desligar associado' }))
    await u.selectOptions(
      await screen.findByLabelText('Motivo *'),
      'PEDIDO_VOLUNTARIO',
    )
    await u.click(screen.getByRole('button', { name: 'Desligar associado…' }))

    // nada foi ao servidor ainda: abre a confirmação com as consequências
    expect(api.desligarAssociado).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/revoga o acesso ao painel/),
    ).toBeInTheDocument()
    expect(screen.getByText('Desligar Maria de Teste?')).toBeInTheDocument()

    const botoes = screen.getAllByRole('button', { name: 'Desligar associado' })
    await u.click(botoes[botoes.length - 1]!)
    await waitFor(() =>
      expect(api.desligarAssociado).toHaveBeenCalledWith(
        17,
        expect.objectContaining({ motivo: 'PEDIDO_VOLUNTARIO' }),
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Desligamento registrado. 2 cobrança(s) futura(s) cancelada(s).',
    )
  })

  it('anonimizar antes do prazo: mostra a recusa do servidor e não finge que deu certo', async () => {
    const u = userEvent.setup()
    vi.mocked(api.anonimizarAssociado).mockRejectedValue(
      new Error('Ainda não elegível - prazo de retenção vai até 2031-10-05.'),
    )
    desenhar('Desligado')
    await u.click(
      screen.getByRole('button', { name: 'Anonimizar dado pessoal' }),
    )
    const botoes = screen.getAllByRole('button', {
      name: 'Anonimizar dado pessoal',
    })
    await u.click(botoes[botoes.length - 1]!)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ainda não elegível',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('readmitir: manda só o que foi preenchido', async () => {
    const u = userEvent.setup()
    vi.mocked(api.readmitirAssociado).mockResolvedValue({
      mensagem: 'Associado readmitido.',
      status_arrolamento: 'Ativo em dia',
    })
    desenhar('Desligado')
    await u.click(screen.getByRole('button', { name: 'Readmitir associado' }))
    await u.click(screen.getByRole('button', { name: 'Confirmar readmissão' }))
    await waitFor(() =>
      expect(api.readmitirAssociado).toHaveBeenCalledWith(17, {
        cpf: undefined,
        email_contato: undefined,
        telefone_whatsapp: undefined,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Associado readmitido.',
    )
  })

  it('não tem violação de acessibilidade (axe) com o formulário aberto', async () => {
    const u = userEvent.setup()
    const { container } = desenhar()
    await u.click(screen.getByRole('button', { name: 'Registrar licença' }))
    await screen.findByLabelText('Motivo *')
    expect(await axe(container)).toHaveNoViolations()
  })
})
