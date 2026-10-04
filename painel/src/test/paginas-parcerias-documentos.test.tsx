import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentoDetalhePage } from '@/pages/DocumentoDetalhe'
import { DocumentoNovoPage } from '@/pages/DocumentoNovo'
import { DocumentosPage } from '@/pages/Documentos'
import { ParceriaDetalhePage } from '@/pages/ParceriaDetalhe'
import { ParceriaNovaPage } from '@/pages/ParceriaNova'
import { ParceriasPage } from '@/pages/Parcerias'
import type { Documento } from '@/lib/documentos'
import type { Opcoes, Parceria, ParceriaDetalhe } from '@/lib/parcerias'

// As telas completas nunca foram abertas num navegador por quem escreveu (o painel exige login com MFA). Este arquivo
// as RENDERIZA de verdade, com a API trocada por dados de teste, para pegar erro de execução e de acessibilidade.

vi.mock('@/lib/use-me', () => ({
  useMe: () => ({
    data: { permissoes: ['parcerias', 'documentos', 'aprovar_publicacao'] },
    isLoading: false,
  }),
}))

const documentos = vi.hoisted(() => ({
  listarDocumentos: vi.fn(),
  listarTiposDeDocumento: vi.fn(),
  obterDocumento: vi.fn(),
  listarHistoricoDoDocumento: vi.fn(),
}))
vi.mock('@/lib/documentos', async (original) => ({
  ...(await original<typeof import('@/lib/documentos')>()),
  ...documentos,
}))

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  apiFetchBlob: vi.fn().mockResolvedValue({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    nomeSugerido: null,
  }),
}))

const parcerias = vi.hoisted(() => ({
  enviarFoto: vi.fn(),
  apagarFoto: vi.fn(),
  listarParcerias: vi.fn(),
  opcoesDeParcerias: vi.fn(),
  obterParceria: vi.fn(),
  historicoDaParceria: vi.fn(),
}))
vi.mock('@/lib/parcerias', async (original) => ({
  ...(await original<typeof import('@/lib/parcerias')>()),
  ...parcerias,
}))

const opcoes: Opcoes = {
  tipos: [
    { codigo: 'EMENDA', rotulo: 'Emenda parlamentar' },
    { codigo: 'TERMO_FOMENTO', rotulo: 'Termo de fomento' },
  ],
  esferas: ['Municipal', 'Estadual', 'Federal'],
  situacoes: ['Proposta', 'Em execução', 'Concluída'],
  situacoes_de_publicacao: ['Rascunho', 'Em revisão', 'Aprovado', 'Retirado'],
  tipos_de_relatorio: [
    { codigo: 'PARCIAL', rotulo: 'Prestação de contas parcial' },
    { codigo: 'FINAL', rotulo: 'Prestação de contas final' },
  ],
  resultados: [
    'Em análise',
    'Regulares',
    'Regulares com ressalvas',
    'Irregulares',
  ],
  situacoes_de_etapa: ['Prevista', 'Realizada', 'Cancelada'],
  categorias_de_pagamento: [
    { codigo: 'FORNECEDOR', rotulo: 'Fornecedor' },
    { codigo: 'EQUIPE', rotulo: 'Equipe (só função e valor)' },
    { codigo: 'OUTRO', rotulo: 'Outro pagamento' },
  ],
}

const resumo: Parceria = {
  id_parceria: 7,
  tipo: 'EMENDA',
  tipo_rotulo: 'Emenda parlamentar',
  ano: 2026,
  titulo: 'Emenda 123/2026 — Oficinas de música',
  objeto: 'Oficinas de música para crianças do bairro.',
  esfera: 'Municipal',
  orgao_concedente: 'Secretaria Municipal de Assistência Social',
  numero_emenda: '123/2026',
  identificador_unico: 'EM-1',
  proponente: 'Vereador Exemplo',
  numero_termo: 'TF 009/2026',
  valor_total: 50000,
  data_assinatura: '2026-07-06',
  vigencia_inicio: '2026-07-06',
  vigencia_fim: '2027-07-01',
  situacao: 'Em execução',
  id_centro_custo: 3,
  codigo_centro_custo: 'PARC-0007',
  recebido: 10000,
  pago: 2015,
  saldo: 7985,
  situacao_publicacao: 'Em revisão',
  enviado_revisao_em: '2026-10-03T12:00:00',
  aprovado_em: null,
  motivo_recusa: null,
  recusado_em: null,
  motivo_retirada: null,
  retirado_em: null,
  criado_em: '2026-10-01T10:00:00',
  atualizado_em: '2026-10-03T12:00:00',
  pode_editar: true,
  pode_enviar_revisao: false,
  pode_aprovar: true,
  pode_retirar: false,
  pode_reabrir: false,
}

const detalhe: ParceriaDetalhe = {
  ...resumo,
  total_das_parcelas: 25000,
  parcelas: [
    {
      id_parcela: 1,
      numero: 1,
      valor_previsto: 10000,
      data_prevista: '2026-08-01',
      observacao: null,
      valor_recebido: 10000,
    },
    {
      id_parcela: 2,
      numero: 2,
      valor_previsto: 15000,
      data_prevista: null,
      observacao: null,
      valor_recebido: 0,
    },
  ],
  etapas: [
    {
      id_etapa: 1,
      titulo: 'Oficina de percussão',
      descricao: null,
      data_prevista: '2026-09-01',
      data_realizacao: null,
      local: 'Quadra',
      publico_atendido: null,
      situacao: 'Prevista',
      fotos: [
        {
          id_foto: 9,
          id_etapa: 1,
          alt: 'Crianças tocando tambores na quadra',
          largura: 800,
          altura: 600,
          tamanho: 1000,
          autorizacao_imagem: true,
          id_documento_autorizacao: null,
          criado_em: '2026-09-02T10:00:00',
        },
      ],
    },
  ],
  relatorios: [
    {
      id_relatorio: 1,
      tipo: 'PARCIAL',
      tipo_rotulo: 'Prestação de contas parcial',
      periodo_inicio: null,
      periodo_fim: null,
      data_prevista: '2026-10-30',
      data_apresentacao: '2026-11-03',
      prazo_analise_dias: 150,
      data_limite_analise: '2027-04-02',
      resultado: 'Em análise',
      data_resultado: null,
      observacao: null,
    },
  ],
  lancamentos: [
    {
      id_vinculo: 1,
      id_lancamento: 11,
      natureza: 'RECEBIMENTO',
      natureza_rotulo: 'Recebimento',
      categoria: null,
      categoria_rotulo: null,
      descricao_publica: 'Repasse da 1ª parcela',
      funcao: null,
      id_parcela: 1,
      parcela_numero: 1,
      data: '2026-07-21T12:00:00',
      valor: 10000,
      historico: 'Repasse',
      estornado: false,
      fornecedor: null,
    },
  ],
  lancamentos_sem_classificacao: [
    {
      id_lancamento: 12,
      numero: 12,
      data: '2026-09-02T12:00:00',
      historico: 'Compra de instrumentos',
      natureza: 'PAGAMENTO',
      natureza_rotulo: 'Pagamento',
      valor: 800,
    },
  ],
  consistencia: {
    bloqueios: [
      {
        codigo: 'LANCAMENTOS_SEM_CLASSIFICACAO',
        mensagem: 'Há 1 lançamento sem classificação.',
      },
    ],
    avisos: [
      {
        codigo: 'PARCELAS_ABAIXO_DO_VALOR',
        mensagem: 'As parcelas somam R$ 25.000,00 de R$ 50.000,00.',
      },
    ],
  },
}

const documento: Documento = {
  id_documento: 5,
  tipo: 'ATA',
  tipo_rotulo: 'Ata',
  titulo: 'Ata de eleição da diretoria 2026-2028',
  descricao: 'Eleição.',
  data_documento: '2026-05-20',
  ano: 2026,
  validade: null,
  classificacao: 'Restrita',
  publicar_no_site: true,
  vinculo_tipo: null,
  vinculo_id: null,
  grupo_versao: 'g1',
  versao: 1,
  vigente: true,
  tem_original: true,
  original_nome_arquivo: 'ata.pdf',
  original_tamanho: 20480,
  original_sha256: 'a'.repeat(64),
  tem_versao_publica: true,
  publico_formato: 'PDF',
  publico_tamanho: 10240,
  publico_paginas: 3,
  publico_sha256: 'b'.repeat(64),
  verificacao: {
    ok: true,
    paginas: 3,
    caracteres: 900,
    bloqueios: [],
    avisos: [],
  },
  verificacao_em: '2026-10-03T12:00:00',
  situacao: 'Em revisão',
  enviado_revisao_em: '2026-10-03T12:00:00',
  aprovado_em: null,
  motivo_recusa: null,
  recusado_em: null,
  motivo_retirada: null,
  retirado_em: null,
  criado_em: '2026-10-01T10:00:00',
  atualizado_em: '2026-10-03T12:00:00',
  pode_baixar_original: true,
  pode_editar: false,
  pode_aprovar: true,
  pode_retirar: false,
}

function renderizar(caminhoInicial: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminhoInicial]}>
        <Routes>
          <Route path="/parcerias" element={<ParceriasPage />} />
          <Route path="/parcerias/nova" element={<ParceriaNovaPage />} />
          <Route path="/parcerias/:id" element={<ParceriaDetalhePage />} />
          <Route path="/documentos" element={<DocumentosPage />} />
          <Route path="/documentos/novo" element={<DocumentoNovoPage />} />
          <Route path="/documentos/:id" element={<DocumentoDetalhePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  parcerias.opcoesDeParcerias.mockResolvedValue(opcoes)
  parcerias.listarParcerias.mockResolvedValue([resumo])
  parcerias.obterParceria.mockResolvedValue(detalhe)
  parcerias.historicoDaParceria.mockResolvedValue([
    {
      acao: 'CRIADO',
      rotulo: 'Cadastrada',
      quando: '2026-10-01T10:00:00',
      quem: 'tesouraria@asaf.org.br',
      detalhes: {},
    },
  ])
  documentos.listarTiposDeDocumento.mockResolvedValue({
    tipos: [{ codigo: 'ATA', rotulo: 'Ata' }],
    classificacoes: ['Pública', 'Interna', 'Restrita'],
    situacoes: ['Rascunho', 'Em revisão', 'Aprovado', 'Retirado'],
    vinculos: ['ata'],
  })
  documentos.listarDocumentos.mockResolvedValue([documento])
  documentos.obterDocumento.mockResolvedValue(documento)
  documentos.listarHistoricoDoDocumento.mockResolvedValue([
    {
      acao: 'CRIADO',
      rotulo: 'Cadastrado',
      quando: '2026-10-01T10:00:00',
      quem: 'secretaria@asaf.org.br',
      detalhes: {},
    },
  ])
})

describe('telas de Parcerias e emendas (renderizadas de verdade)', () => {
  it('lista: mostra a parceria, os valores do livro-caixa e o aviso de quem aguarda aprovação', async () => {
    const { container } = renderizar('/parcerias')
    // o link aparece duas vezes: no aviso "aguarda a sua aprovação" e na tabela
    expect(
      (await screen.findAllByRole('link', { name: /Emenda 123\/2026/ })).length,
    ).toBe(2)
    expect(screen.getByText(/aguarda a sua aprovação/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s?50\.000,00/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('nova: o formulário abre com os tipos vindos da API', async () => {
    const { container } = renderizar('/parcerias/nova')
    expect(
      await screen.findByRole('option', { name: 'Termo de fomento' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Cadastrar parceria' }),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('detalhe: dinheiro, pendência que trava, movimento a classificar, parcelas, etapas, relatórios e histórico', async () => {
    const { container } = renderizar('/parcerias/7')
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /Emenda 123\/2026/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Próximo passo/)).toBeInTheDocument()
    expect(
      screen.getByText('Pendências que impedem a publicação'),
    ).toBeInTheDocument()
    expect(screen.getByText('Valor da parceria')).toBeInTheDocument()
    expect(screen.getByText('Saldo (recebido menos pago)')).toBeInTheDocument()
    expect(
      screen.getAllByText(/Compra de instrumentos/).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByRole('heading', { name: 'Parcelas previstas' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Etapas de execução' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Relatórios e prestação de contas' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Histórico (quem fez o quê)' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/tesouraria@asaf\.org\.br/),
    ).toBeInTheDocument()
    // quem pode aprovar vê aprovar e recusar; não vê "Enviar para revisão"
    expect(
      screen.getByRole('button', { name: 'Aprovar a publicação' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Enviar para revisão' }),
    ).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('detalhe de quem só lê: nenhum botão de escrita aparece', async () => {
    parcerias.obterParceria.mockResolvedValue({
      ...detalhe,
      pode_editar: false,
      pode_aprovar: false,
      pode_enviar_revisao: false,
    })
    renderizar('/parcerias/7')
    await screen.findByRole('heading', { level: 1, name: /Emenda 123\/2026/ })
    for (const nome of [
      /Adicionar parcela/,
      /Adicionar etapa/,
      /Adicionar relatório/,
      /Editar os dados/,
      /Classificar para o site/,
      /Aprovar a publicação/,
    ]) {
      expect(
        screen.queryByRole('button', { name: nome }),
      ).not.toBeInTheDocument()
    }
  })
})

describe('telas de Documentos (renderizadas de verdade)', () => {
  it('biblioteca: agrupada por tipo, com selos de situação e classificação', async () => {
    const { container } = renderizar('/documentos')
    expect(
      await screen.findByRole('heading', { level: 2, name: /Ata/ }),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /Ata de eleição da diretoria/ })
        .length,
    ).toBe(2) // aviso de aprovação + tabela
    expect(screen.getAllByText('Em revisão').length).toBeGreaterThanOrEqual(1)
    // "Restrita" é o selo do documento e também uma opção do filtro
    expect(screen.getAllByText('Restrita').length).toBeGreaterThanOrEqual(2)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('novo: classificação explicada e envio do original em área privada', async () => {
    const { container } = renderizar('/documentos/novo')
    expect(
      await screen.findByRole('option', { name: 'Ata' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Ele fica em área privada|Fica em área privada/),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('detalhe: passo a passo, resultado da conferência, aprovação e histórico', async () => {
    const { container } = renderizar('/documentos/5')
    expect(
      await screen.findByRole('heading', { level: 1, name: /Ata de eleição/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Próximo passo/)).toBeInTheDocument()
    expect(
      screen.getByText('Passou na conferência automática'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Baixar o original/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Aprovar a publicação' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/secretaria@asaf\.org\.br/),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('versão pública em texto (renderizada de verdade)', () => {
  it('quem prepara vê o campo para colar o texto e, com texto aceito, o formato e o tamanho', async () => {
    documentos.obterDocumento.mockResolvedValue({
      ...documento,
      situacao: 'Rascunho',
      pode_editar: true,
      pode_aprovar: false,
      publico_formato: 'TEXTO',
      publico_paginas: null,
      verificacao: {
        ok: true,
        paginas: 0,
        caracteres: 1234,
        bloqueios: [],
        avisos: [],
      },
    })
    const { container } = renderizar('/documentos/5')
    expect(
      await screen.findByLabelText('Ou cole o texto da versão pública'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Enviar o texto e conferir/ }),
    ).toBeDisabled() // texto vazio: não envia
    expect(screen.getByText(/texto de 1234 caracteres/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('fotos das etapas (renderizadas de verdade)', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:foto-de-teste')
    URL.revokeObjectURL = vi.fn()
  })

  it('mostra a foto com a descrição e o aviso de que a imagem é regravada', async () => {
    const { container } = renderizar('/parcerias/7')
    // a miniatura troca de caixa vazia para <img> quando a foto chega: procura de novo até estabilizar
    await waitFor(
      () =>
        expect(
          screen.getByRole('img', {
            name: 'Crianças tocando tambores na quadra',
          }),
        ).toBeInstanceOf(HTMLImageElement),
      { timeout: 5000 },
    )
    expect(
      screen.getByText(/guardada sem localização nem dados do aparelho/),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sem marcar a autorização de imagem a foto NÃO é enviada e o motivo aparece', async () => {
    const usuario = userEvent.setup()
    renderizar('/parcerias/7')
    await screen.findByRole('heading', { name: 'Etapas de execução' })
    const arquivo = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    await usuario.upload(screen.getByLabelText(/Enviar foto \(JPG/), arquivo)
    await usuario.type(
      screen.getByLabelText(/Descrição da foto/),
      'Oficina de percussão na quadra da escola',
    )
    await usuario.click(screen.getByRole('button', { name: 'Enviar a foto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /autorização de uso de imagem/,
    )
    expect(parcerias.enviarFoto).not.toHaveBeenCalled()
  })

  it('sem descrição a foto NÃO é enviada; com tudo, é enviada com a confirmação', async () => {
    const usuario = userEvent.setup()
    parcerias.enviarFoto.mockResolvedValue(detalhe)
    renderizar('/parcerias/7')
    await screen.findByRole('heading', { name: 'Etapas de execução' })
    const arquivo = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    await usuario.upload(screen.getByLabelText(/Enviar foto \(JPG/), arquivo)
    await usuario.click(
      screen.getByRole('checkbox', { name: /Há autorização de uso de imagem/ }),
    )
    await usuario.click(screen.getByRole('button', { name: 'Enviar a foto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Descreva a foto/,
    )
    expect(parcerias.enviarFoto).not.toHaveBeenCalled()
    await usuario.type(
      screen.getByLabelText(/Descrição da foto/),
      'Oficina de percussão na quadra da escola',
    )
    await usuario.click(screen.getByRole('button', { name: 'Enviar a foto' }))
    expect(parcerias.enviarFoto).toHaveBeenCalledTimes(1)
    const [id, idEtapa, dados] = parcerias.enviarFoto.mock.calls[0]!
    expect([id, idEtapa]).toEqual([7, 1])
    expect(dados).toMatchObject({
      autorizacaoImagem: true,
      alt: 'Oficina de percussão na quadra da escola',
    })
  })

  it('quem só lê vê a foto, mas não o formulário de envio nem o botão de apagar', async () => {
    parcerias.obterParceria.mockResolvedValue({
      ...detalhe,
      pode_editar: false,
    })
    renderizar('/parcerias/7')
    await screen.findByRole('img', {
      name: 'Crianças tocando tambores na quadra',
    })
    expect(
      screen.queryByRole('button', { name: 'Enviar a foto' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Apagar a foto/ }),
    ).not.toBeInTheDocument()
  })

  it('apagar a foto chama o servidor', async () => {
    const usuario = userEvent.setup()
    parcerias.apagarFoto.mockResolvedValue(detalhe)
    renderizar('/parcerias/7')
    // procura só dentro do bloco das fotos (a consulta por papel em toda a tela é lenta no jsdom)
    const bloco = (await screen.findByText('Fotos da etapa')).parentElement!
    await usuario.click(
      within(bloco).getByText('Apagar', { selector: 'button' }),
    )
    expect(parcerias.apagarFoto).toHaveBeenCalledWith(7, 9)
  })
})
