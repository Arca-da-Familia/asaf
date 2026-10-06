import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { AtaAssembleiaPage } from '@/pages/Ata'
import { CalendarioPage } from '@/pages/Calendario'
import { ProcessoDisciplinarDetalhePage } from '@/pages/Disciplina'
import { ProcessoDissolucaoDetalhePage } from '@/pages/Dissolucao'
import { MandatosPage } from '@/pages/Mandatos'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  listarAssociados: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  // mandatos
  listarMandatos: vi.fn(),
  listarMandatosVencendo: vi.fn(),
  listarConflitosInteresse: vi.fn(),
  encerrarMandato: vi.fn(),
  // dissolução
  obterProcessoDissolucao: vi.fn(),
  cancelarProcessoDissolucao: vi.fn(),
  // disciplina
  obterProcessoDisciplinar: vi.fn(),
  verManifestacoes: vi.fn(),
  // calendário
  obterCalendario: vi.fn(),
  removerEventoCalendario: vi.fn(),
  // ata
  obterAssembleia: vi.fn(),
  obterAtaDaAssembleia: vi.fn(),
  obterAta: vi.fn(),
  listarAtas: vi.fn(),
  listarDeliberacoesDaAta: vi.fn(),
  listarCertidoes: vi.fn(),
  concluirDeliberacao: vi.fn(),
  gerarAta: vi.fn(),
}))

function desenhar(rota: string, caminho: string, pagina: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[caminho]}>
        <Routes>
          <Route path={rota} element={pagina} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const usuario = (idAssociado: number, permissoes: string[]) => ({
  id_usuario: 1,
  id_associado: idAssociado,
  nome_completo: 'Quem Usa',
  email: 'q@teste.local',
  nivel: 'Diretoria',
  mfa_ativado: false,
  mfa_obrigatorio: false,
  mfa_pendente: false,
  permissoes,
})

const associado = (id: number, nome: string) =>
  ({ id_associado: id, nome_completo: nome }) as Awaited<
    ReturnType<typeof api.listarAssociados>
  >[number]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.me).mockResolvedValue(usuario(1, ['governanca']))
  vi.mocked(api.listarAssociados).mockResolvedValue([
    associado(1, 'Marta de Teste'),
    associado(2, 'Fábio de Teste'),
  ])
  vi.mocked(api.listarOpcoesCatalogo).mockResolvedValue([])
})

describe('Mandatos', () => {
  const mandato = {
    id_mandato: 5,
    id_associado: 2,
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    cargo_codigo: 'TESOUREIRO',
    data_inicio: '2026-01-15T00:00:00',
    data_fim_previsto: '2030-01-15T00:00:00',
    data_fim_efetivo: null,
    motivo_encerramento: null,
    ato_origem: null,
    vigente: true,
  }

  beforeEach(() => {
    vi.mocked(api.listarMandatos).mockResolvedValue([mandato])
    vi.mocked(api.listarMandatosVencendo).mockResolvedValue([
      { ...mandato, id_mandato: 6, dias_restantes: 12 },
    ])
    vi.mocked(api.listarConflitosInteresse).mockResolvedValue([])
  })

  it('mostra o DIA gravado (15/01) mesmo no fuso de Belém, e os mandatos que vencem na janela', async () => {
    const fusoAntes = process.env.TZ
    process.env.TZ = 'America/Belem'
    try {
      desenhar('/governanca/mandatos', '/governanca/mandatos', <MandatosPage />)
      expect(
        await screen.findByText('15/01/2026 até 15/01/2030'),
      ).toBeInTheDocument()
      const vencendo = (
        await screen.findByRole('heading', { name: 'Mandatos vencendo' })
      ).parentElement!.parentElement!
      expect(
        await within(vencendo).findByText('Em 12 dia(s)'),
      ).toBeInTheDocument()
      expect(api.listarMandatosVencendo).toHaveBeenCalledWith(90)
    } finally {
      process.env.TZ = fusoAntes
    }
  })

  it('trocar a janela de vencimento refaz a consulta; sem nenhum, diz que nenhum vence', async () => {
    const u = userEvent.setup()
    vi.mocked(api.listarMandatosVencendo).mockResolvedValue([])
    desenhar('/governanca/mandatos', '/governanca/mandatos', <MandatosPage />)
    expect(
      await screen.findByText('Nenhum mandato vence nos próximos 90 dias.'),
    ).toBeInTheDocument()
    await u.selectOptions(
      screen.getByLabelText('Janela de vencimento dos mandatos'),
      '30',
    )
    expect(
      await screen.findByText('Nenhum mandato vence nos próximos 30 dias.'),
    ).toBeInTheDocument()
  })

  it('o aviso da vacância (Art. 26) NÃO some com o bloco: continua na tela depois de encerrar', async () => {
    const u = userEvent.setup()
    vi.mocked(api.encerrarMandato).mockResolvedValue({
      ...mandato,
      vigente: false,
      vaga_aberta: true,
      pendencia: 'Vaga sem substituto: convocar assembleia para eleger.',
    })
    desenhar('/governanca/mandatos', '/governanca/mandatos', <MandatosPage />)
    await u.click(
      await screen.findByRole('button', { name: 'Encerrar mandato' }),
    )
    await u.click(
      screen.getByRole('button', { name: 'Confirmar encerramento' }),
    )
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(
      'Vaga aberta: Vaga sem substituto: convocar assembleia para eleger.',
    )
    // o bloco de encerramento fechou, o aviso ficou
    expect(
      screen.queryByRole('button', { name: 'Confirmar encerramento' }),
    ).not.toBeInTheDocument()
  })

  it('a recusa ao encerrar (outra aba já encerrou) aparece UMA vez', async () => {
    const u = userEvent.setup()
    vi.mocked(api.encerrarMandato).mockRejectedValue(
      new Error('Mandato já não está vigente.'),
    )
    desenhar('/governanca/mandatos', '/governanca/mandatos', <MandatosPage />)
    await u.click(
      await screen.findByRole('button', { name: 'Encerrar mandato' }),
    )
    await u.click(
      screen.getByRole('button', { name: 'Confirmar encerramento' }),
    )
    expect(
      await screen.findAllByText('Mandato já não está vigente.'),
    ).toHaveLength(1)
  })
})

describe('Dissolução (nada irreversível sem confirmar)', () => {
  const processo = {
    id_processo_dissolucao: 3,
    motivo: 'Motivo de teste de uma dissolução simulada.',
    status: 'Aberto',
    id_deliberacao: null,
    deliberada_em: null,
    liquidacao_concluida_em: null,
    entidade_destinataria_nome: null,
    entidade_destinataria_cnpj: null,
    patrimonio_destinado_em: null,
    baixa_cadastral_em: null,
    motivo_cancelamento: null,
  } as unknown as Awaited<ReturnType<typeof api.obterProcessoDissolucao>>

  it('cancelar o processo valida o motivo, pede confirmação e só então chama o servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(api.obterProcessoDissolucao).mockResolvedValue(processo)
    vi.mocked(api.cancelarProcessoDissolucao).mockResolvedValue({
      ...processo,
      status: 'Cancelado',
    })
    desenhar(
      '/governanca/dissolucao/:id',
      '/governanca/dissolucao/3',
      <ProcessoDissolucaoDetalhePage />,
    )
    const botao = await screen.findByRole('button', {
      name: 'Cancelar processo',
    })
    // motivo vazio: o erro aparece no campo, sem diálogo
    await u.click(botao)
    expect(
      await screen.findByText('Descreva o motivo do cancelamento.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await u.type(
      screen.getByLabelText('Motivo do cancelamento'),
      'Criado por engano no teste',
    )
    await u.click(botao)
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent('não pode ser reaberto')
    expect(api.cancelarProcessoDissolucao).not.toHaveBeenCalled()

    await u.click(
      within(dialogo).getByRole('button', { name: 'Cancelar processo' }),
    )
    await waitFor(() =>
      expect(api.cancelarProcessoDissolucao).toHaveBeenCalledWith(
        3,
        'Criado por engano no teste',
      ),
    )
  })

  it('processo que não existe (ou sem permissão) mostra o erro e o caminho de volta, não "Carregando…" para sempre', async () => {
    vi.mocked(api.obterProcessoDissolucao).mockRejectedValue(
      new api.ApiError(404, 'Processo de dissolução não encontrado.'),
    )
    desenhar(
      '/governanca/dissolucao/:id',
      '/governanca/dissolucao/999',
      <ProcessoDissolucaoDetalhePage />,
    )
    expect(
      await screen.findByText('Processo de dissolução não encontrado.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar/ })).toBeInTheDocument()
  })
})

describe('Disciplina', () => {
  const processo = {
    id_processo: 8,
    id_associado: 1,
    motivo_codigo: 'COMPORTAMENTO_ANTISSOCIAL',
    descricao: 'Fatos relatados no processo de teste.',
    status: 'Aberto',
    data_abertura: '2026-10-06T15:00:00',
    prazo_defesa_ate: '2026-10-21T15:00:00',
    defesa_apresentada_em: '2026-10-06T16:00:00',
    pena_aplicada: null,
    escalada_automatica: false,
    suspensao_dias: null,
    data_fim_suspensao: null,
    decidido_em: null,
    homologado_em: null,
  } as unknown as Awaited<ReturnType<typeof api.obterProcessoDisciplinar>>

  it('o acusado que é diretor NÃO vê manifestação nem decisão do próprio processo', async () => {
    vi.mocked(api.me).mockResolvedValue(usuario(1, ['governanca'])) // associado 1 = o acusado
    vi.mocked(api.obterProcessoDisciplinar).mockResolvedValue(processo)
    desenhar(
      '/processos-disciplinares/:id',
      '/processos-disciplinares/8',
      <ProcessoDisciplinarDetalhePage />,
    )
    expect(
      await screen.findByRole('heading', { name: 'Processo disciplinar #8' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Decidir' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: 'Manifestações da Diretoria Executiva',
      }),
    ).not.toBeInTheDocument()
  })

  it('quem julga (outro diretor) vê manifestação e decisão, com os campos nomeados', async () => {
    vi.mocked(api.me).mockResolvedValue(usuario(2, ['governanca']))
    vi.mocked(api.obterProcessoDisciplinar).mockResolvedValue(processo)
    vi.mocked(api.verManifestacoes).mockResolvedValue({
      manifestacoes: 0,
      quorum_minimo: 3,
      diretores_aptos: 5,
      quorum_atingido: false,
      resultado: null,
    } as unknown as Awaited<ReturnType<typeof api.verManifestacoes>>)
    desenhar(
      '/processos-disciplinares/:id',
      '/processos-disciplinares/8',
      <ProcessoDisciplinarDetalhePage />,
    )
    expect(
      await screen.findByRole('heading', { name: 'Decidir' }),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Fundamentação da decisão'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Pena proposta')).toBeInTheDocument()
  })

  it('processo confidencial (404) mostra "não encontrado" e o caminho de volta', async () => {
    vi.mocked(api.me).mockResolvedValue(usuario(9, []))
    vi.mocked(api.obterProcessoDisciplinar).mockRejectedValue(
      new api.ApiError(404, 'Processo não encontrado.'),
    )
    desenhar(
      '/processos-disciplinares/:id',
      '/processos-disciplinares/8',
      <ProcessoDisciplinarDetalhePage />,
    )
    expect(
      await screen.findByText('Processo não encontrado.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar/ })).toHaveAttribute(
      'href',
      '/meus-processos-disciplinares',
    )
  })
})

describe('Calendário', () => {
  it('remover um evento institucional pede confirmação e só então chama o servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(api.obterCalendario).mockResolvedValue([
      {
        id_evento: 11,
        tipo: 'EVENTO_INSTITUCIONAL',
        titulo: 'Reunião agendada por engano',
        data: '2026-10-20',
        dias_restantes: 14,
        artigo_origem: null,
      },
      {
        tipo: 'AGO_ESTATUTARIA',
        titulo: 'Assembleia Geral Ordinária (fevereiro)',
        data: '2027-02-01',
        dias_restantes: 118,
        artigo_origem: 'Art. 5º, I',
      },
    ])
    vi.mocked(api.removerEventoCalendario).mockResolvedValue({ mensagem: 'ok' })
    desenhar('/calendario', '/calendario', <CalendarioPage />)

    // só o evento avulso tem o botão (a AGO é obrigação calculada, não se remove)
    const botoes = await screen.findAllByRole('button', {
      name: 'Remover evento',
    })
    expect(botoes).toHaveLength(1)
    await u.click(botoes[0]!)
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent('Reunião agendada por engano')
    expect(api.removerEventoCalendario).not.toHaveBeenCalled()
    await u.click(
      within(dialogo).getByRole('button', { name: 'Remover evento' }),
    )
    await waitFor(() =>
      expect(api.removerEventoCalendario).toHaveBeenCalledWith(11),
    )
  })

  it('quem não tem governança não vê o botão de remover', async () => {
    vi.mocked(api.me).mockResolvedValue(usuario(2, []))
    vi.mocked(api.obterCalendario).mockResolvedValue([
      {
        id_evento: 11,
        tipo: 'EVENTO_INSTITUCIONAL',
        titulo: 'Reunião aberta a todos',
        data: '2026-10-20',
        dias_restantes: 14,
        artigo_origem: null,
      },
    ])
    desenhar('/calendario', '/calendario', <CalendarioPage />)
    expect(
      await screen.findByText('Reunião aberta a todos'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remover evento' }),
    ).not.toBeInTheDocument()
  })
})

describe('Ata', () => {
  const ata = {
    id_ata: 40,
    id_assembleia: 7,
    numero_sequencial: null,
    corpo_texto: 'Corpo gerado da ata de teste.',
    relato_secretaria: null,
    status: 'Rascunho',
    assinada_em: null,
    id_ata_retificada: null,
    motivo_retificacao: null,
    arquivo_documento_assinado: null,
    numero_protocolo_cartorio: null,
    data_protocolo_cartorio: null,
  } as unknown as Awaited<ReturnType<typeof api.obterAtaDaAssembleia>>

  beforeEach(() => {
    vi.mocked(api.obterAssembleia).mockResolvedValue({
      id_assembleia: 7,
      tipo: 'Ordinária',
      status: 'Realizada',
    } as Awaited<ReturnType<typeof api.obterAssembleia>>)
    vi.mocked(api.listarAtas).mockResolvedValue([])
    vi.mocked(api.listarDeliberacoesDaAta).mockResolvedValue([])
  })

  it('"Gerar ata" recusado pelo servidor mostra a recusa e MANTÉM o botão (antes a página ficava em branco)', async () => {
    const u = userEvent.setup()
    vi.mocked(api.obterAtaDaAssembleia).mockRejectedValue(
      new api.ApiError(404, 'Esta assembleia ainda não tem ata gerada.'),
    )
    vi.mocked(api.gerarAta).mockRejectedValue(
      new api.ApiError(400, 'Esta assembleia já tem ata em rascunho.'),
    )
    desenhar('/governanca/:id/ata', '/governanca/7/ata', <AtaAssembleiaPage />)
    await u.click(await screen.findByRole('button', { name: 'Gerar ata' }))
    expect(
      await screen.findByText('Esta assembleia já tem ata em rascunho.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Gerar ata' }),
    ).toBeInTheDocument()
  })

  it('depois de uma retificação, as versões aparecem e a original abre pelo ?ata=', async () => {
    vi.mocked(api.obterAta).mockResolvedValue({
      ...ata,
      id_ata: 39,
      status: 'Assinada',
      numero_sequencial: 5,
    })
    vi.mocked(api.listarAtas).mockResolvedValue([
      { ...ata, id_ata: 39, status: 'Assinada' },
      { ...ata, id_ata: 40, id_ata_retificada: 39 },
    ] as unknown as Awaited<ReturnType<typeof api.listarAtas>>)
    desenhar(
      '/governanca/:id/ata',
      '/governanca/7/ata?ata=39',
      <AtaAssembleiaPage />,
    )
    const versoes = await screen.findByRole('navigation', {
      name: 'Versões da ata',
    })
    expect(
      within(versoes).getByRole('link', { name: /Original/ }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(versoes).getByRole('link', { name: /Retificação/ }),
    ).toHaveAttribute('href', '/governanca/7/ata?ata=40')
    expect(api.obterAta).toHaveBeenCalledWith(39)
  })

  it('o que ainda falta fazer depois de concluir uma deliberação fica visível na linha', async () => {
    const u = userEvent.setup()
    vi.mocked(api.obterAtaDaAssembleia).mockResolvedValue(ata)
    vi.mocked(api.listarDeliberacoesDaAta).mockResolvedValue([
      {
        id_deliberacao: 12,
        id_ata: 40,
        tipo: 'Reforma de estatuto',
        texto: 'Alterar o quórum da primeira convocação',
        ano_exercicio: null,
        status_execucao: 'Pendente',
        id_associado_responsavel: null,
        prazo_execucao: null,
        concluida_em: null,
        observacao_conclusao: null,
      },
    ])
    vi.mocked(api.concluirDeliberacao).mockResolvedValue({
      id_deliberacao: 12,
      pendencia:
        'Registrar a reforma no cartório e atualizar as regras do estatuto.',
    } as unknown as Awaited<ReturnType<typeof api.concluirDeliberacao>>)
    desenhar('/governanca/:id/ata', '/governanca/7/ata', <AtaAssembleiaPage />)
    await u.click(await screen.findByRole('button', { name: 'Concluir' }))
    await u.click(screen.getByRole('button', { name: 'Concluir deliberação' }))
    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(
      'Falta fazer: Registrar a reforma no cartório',
    )
  })
})
