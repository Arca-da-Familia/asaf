import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextoDoProjeto } from '@/components/projetos/ContextoDoProjeto'
import { EditarProjeto } from '@/components/projetos/EditarProjeto'
import { ApiError, type Projeto } from '@/lib/api'
import { ProjetosPage } from '@/pages/Projetos'

import {
  evento,
  projeto,
  relatorio,
  renderizar,
  simularRedeSemResposta,
} from './fabricas-despertai'

// Despertai e o contexto do evento (v5.5) - lado dos PROJETOS: o projeto principal em destaque, o formulário de edição, o
// número que se digita no editor do site e o contexto (eventos, relatórios, notícias) do projeto.

const permissoes = vi.hoisted(() => ({
  atuais: ['projetos', 'documentos'] as string[],
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: permissoes.atuais }, isLoading: false }),
}))

const api = vi.hoisted(() => ({
  listarProjetos: vi.fn(),
  listarEventos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarAssociados: vi.fn(),
  listarCentrosCusto: vi.fn(),
  criarProjeto: vi.fn(),
  editarProjeto: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  ...api,
}))

const documentos = vi.hoisted(() => ({ listarDocumentos: vi.fn() }))
vi.mock('@/lib/documentos', async (original) => ({
  ...(await original<typeof import('@/lib/documentos')>()),
  ...documentos,
}))

const relatorioDoProjeto = (
  sobrescrever: Parameters<typeof relatorio>[0] = {},
) => relatorio({ vinculo_tipo: 'projeto', vinculo_id: 3, ...sobrescrever })

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['projetos', 'documentos']
  simularRedeSemResposta()
  api.listarProjetos.mockResolvedValue([
    projeto(),
    projeto({
      id_projeto: 4,
      nome_projeto: 'Reunião da diretoria',
      visibilidade: 'Interna',
      destaque_no_site: false,
    }),
  ])
  api.listarEventos.mockResolvedValue([
    evento(),
    evento({ id_evento: 13, titulo: 'Outro projeto', id_projeto: 4 }),
    evento({ id_evento: 14, titulo: 'Sem projeto', id_projeto: null }),
  ])
  api.listarOpcoesCatalogo.mockImplementation(async (chave: string) =>
    chave === 'tipo_projeto'
      ? [{ codigo: 'SOCIAL', rotulo: 'Social' }]
      : chave === 'status_projeto'
        ? [{ codigo: 'PLANEJAMENTO', rotulo: 'Planejamento' }]
        : [],
  )
  api.listarAssociados.mockResolvedValue([])
  api.listarCentrosCusto.mockResolvedValue([])
  documentos.listarDocumentos.mockResolvedValue([])
})

describe('lista de projetos', () => {
  it('mostra o número, "Público/Interno" e o selo "Em destaque no site" em texto', async () => {
    const { container } = renderizar(<ProjetosPage />)
    const linha = (await screen.findByText('Despertai')).closest(
      '[role="button"]',
    ) as HTMLElement
    expect(within(linha).getByText('nº 3')).toBeInTheDocument()
    expect(within(linha).getByText('Público')).toBeInTheDocument()
    expect(within(linha).getByText('Em destaque no site')).toBeInTheDocument()

    const interno = screen
      .getByText('Reunião da diretoria')
      .closest('[role="button"]') as HTMLElement
    expect(within(interno).getByText('Interno')).toBeInTheDocument()
    expect(
      within(interno).queryByText('Em destaque no site'),
    ).not.toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o projeto abre também pelo teclado e pelo endereço ?projeto=3, com o Nº do projeto bem visível', async () => {
    const usuario = userEvent.setup()
    renderizar(<ProjetosPage />, '/projetos?projeto=3')
    // aberto pelo endereço
    const numero = await screen.findByText('Nº do projeto:', { exact: false })
    expect(numero).toHaveTextContent(/Nº do projeto:\s*3/)
    expect(numero).toHaveTextContent(/editor do site/)
    // teclado: Enter na linha do projeto interno abre o detalhe dele
    const interno = (await screen.findByText('Reunião da diretoria')).closest(
      '[role="button"]',
    ) as HTMLElement
    interno.focus()
    await usuario.keyboard('{Enter}')
    await waitFor(() =>
      expect(
        screen.getByText('Nº do projeto:', { exact: false }),
      ).toHaveTextContent(/Nº do projeto:\s*4/),
    )
  })
})

describe('criar projeto: destaque na página inicial', () => {
  async function abrirFormulario() {
    const usuario = userEvent.setup()
    const resultado = renderizar(<ProjetosPage />)
    await screen.findByText('Despertai')
    await usuario.click(screen.getByRole('button', { name: 'Novo projeto' }))
    return { usuario, ...resultado }
  }
  const caixaDeDestaque = () =>
    screen.getByRole('checkbox', {
      name: /Mostrar em destaque na página inicial do site/,
    })

  it('a caixa só fica habilitada com visibilidade Pública, e some a marca ao voltar para Interna', async () => {
    const { usuario } = await abrirFormulario()
    const visibilidade = screen.getByLabelText('Quem pode ver o projeto')
    expect(caixaDeDestaque()).toBeDisabled()
    expect(
      screen.getByText(/Só projeto Público pode ficar em destaque/),
    ).toBeInTheDocument()

    await usuario.selectOptions(visibilidade, 'Pública')
    expect(caixaDeDestaque()).toBeEnabled()
    expect(
      screen.getByText(/passam por conferência de dado pessoal/),
    ).toBeInTheDocument()

    await usuario.click(caixaDeDestaque())
    expect(caixaDeDestaque()).toBeChecked()

    await usuario.selectOptions(visibilidade, 'Interna')
    expect(caixaDeDestaque()).not.toBeChecked()
    expect(caixaDeDestaque()).toBeDisabled()
  })

  it('envia destaque_no_site e NÃO envia campo em branco como "" nem como 0', async () => {
    api.criarProjeto.mockResolvedValue({ mensagem: 'ok', id_projeto: 9 })
    const { usuario } = await abrirFormulario()
    await usuario.type(screen.getByLabelText('Nome do projeto'), 'Despertai')
    await usuario.type(screen.getByLabelText('Foco do projeto'), 'Social')
    await usuario.type(screen.getByLabelText(/^Data de início/), '2026-10-01')
    await usuario.type(
      screen.getByLabelText(/^Data de fim prevista/),
      '2026-12-31',
    )
    await usuario.selectOptions(
      screen.getByLabelText('Quem pode ver o projeto'),
      'Pública',
    )
    await usuario.click(caixaDeDestaque())
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))

    await waitFor(() => expect(api.criarProjeto).toHaveBeenCalledTimes(1))
    const enviado = api.criarProjeto.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(enviado).toMatchObject({
      nome_projeto: 'Despertai',
      visibilidade: 'Pública',
      destaque_no_site: true,
    })
    // antes: o select em branco virava 0 / "" e o servidor respondia "não encontrado" / "tipo inválido"
    expect(enviado.id_centro_custo).toBeUndefined()
    expect(enviado.id_associado_responsavel).toBeUndefined()
    expect(enviado.tipo_projeto).toBeUndefined()
  })

  it('projeto Interno é criado sem destaque', async () => {
    api.criarProjeto.mockResolvedValue({ mensagem: 'ok', id_projeto: 9 })
    const { usuario } = await abrirFormulario()
    await usuario.type(screen.getByLabelText('Nome do projeto'), 'Interno')
    await usuario.type(screen.getByLabelText('Foco do projeto'), 'Social')
    await usuario.type(screen.getByLabelText(/^Data de início/), '2026-10-01')
    await usuario.type(
      screen.getByLabelText(/^Data de fim prevista/),
      '2026-12-31',
    )
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))
    await waitFor(() => expect(api.criarProjeto).toHaveBeenCalledTimes(1))
    expect(api.criarProjeto.mock.calls[0]![0]).toMatchObject({
      visibilidade: 'Interna',
      destaque_no_site: false,
    })
  })

  it('o motivo do servidor (422, em português) aparece na tela', async () => {
    api.criarProjeto.mockRejectedValue(
      new ApiError(
        422,
        'O descrição tem dado pessoal (CPF). Tire o dado e salve de novo.',
      ),
    )
    const { usuario } = await abrirFormulario()
    await usuario.type(screen.getByLabelText('Nome do projeto'), 'Despertai')
    await usuario.type(screen.getByLabelText('Foco do projeto'), 'Social')
    await usuario.type(screen.getByLabelText(/^Data de início/), '2026-10-01')
    await usuario.type(
      screen.getByLabelText(/^Data de fim prevista/),
      '2026-12-31',
    )
    await usuario.click(screen.getByRole('button', { name: 'Criar projeto' }))
    const alertas = await screen.findAllByRole('alert')
    expect(alertas[0]).toHaveTextContent(/tem dado pessoal/)
  })

  it('o formulário aberto não tem violação de acessibilidade (todo campo tem nome)', async () => {
    const { container } = await abrirFormulario()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('editar projeto', () => {
  function abrir(p: Projeto = projeto(), onFechar = vi.fn()) {
    const resultado = renderizar(
      <EditarProjeto projeto={p} onFechar={onFechar} />,
    )
    return { usuario: userEvent.setup(), onFechar, ...resultado }
  }

  it('já vem com o que está cadastrado e envia SÓ o que mudou', async () => {
    api.editarProjeto.mockResolvedValue(projeto())
    const { usuario, onFechar } = abrir()
    expect(screen.getByLabelText('Nome do projeto')).toHaveValue('Despertai')
    expect(screen.getByLabelText(/^Data de início/)).toHaveValue('2026-10-01')
    expect(screen.getByLabelText(/^Data de fim prevista/)).toHaveValue(
      '2026-12-31',
    )
    expect(screen.getByLabelText(/^Quem pode ver o projeto/)).toHaveValue(
      'Pública',
    )

    const descricao = screen.getByLabelText(/^Descrição/)
    await usuario.clear(descricao)
    await usuario.type(descricao, 'Novo texto sobre o programa.')
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )

    await waitFor(() => expect(api.editarProjeto).toHaveBeenCalledTimes(1))
    expect(api.editarProjeto).toHaveBeenCalledWith(3, {
      descricao: 'Novo texto sobre o programa.',
    })
    await waitFor(() => expect(onFechar).toHaveBeenCalled())
  })

  it('sem nenhuma mudança não chama o servidor e avisa', async () => {
    const { usuario } = abrir()
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nada foi alterado.',
    )
    expect(api.editarProjeto).not.toHaveBeenCalled()
  })

  it('a data só vai quando mudou, no formato AAAA-MM-DD; campo esvaziado vira null', async () => {
    api.editarProjeto.mockResolvedValue(projeto())
    const { usuario } = abrir()
    fireEvent.change(screen.getByLabelText(/^Data de fim prevista/), {
      target: { value: '2027-03-15' },
    })
    await usuario.clear(screen.getByLabelText(/^Público-alvo/))
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    await waitFor(() => expect(api.editarProjeto).toHaveBeenCalledTimes(1))
    expect(api.editarProjeto).toHaveBeenCalledWith(3, {
      data_fim_prevista: '2027-03-15',
      publico_alvo: null,
    })
  })

  it('o destaque só existe para projeto Público: Interno desabilita e desmarca; a combinação vai junto', async () => {
    api.editarProjeto.mockResolvedValue(projeto())
    const { usuario } = abrir(
      projeto({ visibilidade: 'Interna', destaque_no_site: false }),
    )
    const caixa = () =>
      screen.getByRole('checkbox', {
        name: /Mostrar em destaque na página inicial do site/,
      })
    expect(caixa()).toBeDisabled()

    await usuario.selectOptions(
      screen.getByLabelText(/^Quem pode ver o projeto/),
      'Pública',
    )
    expect(caixa()).toBeEnabled()
    await usuario.click(caixa())
    expect(caixa()).toBeChecked()
    // voltar a Interno desmarca (o servidor recusaria Interno + destaque)
    await usuario.selectOptions(
      screen.getByLabelText(/^Quem pode ver o projeto/),
      'Interna',
    )
    expect(caixa()).not.toBeChecked()
    await usuario.selectOptions(
      screen.getByLabelText(/^Quem pode ver o projeto/),
      'Pública',
    )
    await usuario.click(caixa())
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    await waitFor(() => expect(api.editarProjeto).toHaveBeenCalledTimes(1))
    expect(api.editarProjeto).toHaveBeenCalledWith(3, {
      visibilidade: 'Pública',
      destaque_no_site: true,
    })
  })

  it('mostra o aviso de que o texto de projeto Público vai ao site e passa pela conferência de dado pessoal', () => {
    abrir()
    expect(
      screen.getByText(/vão ao site e passam por conferência de dado pessoal/),
    ).toBeInTheDocument()
  })

  it('o erro 422 do servidor aparece em português e o formulário continua aberto', async () => {
    api.editarProjeto.mockRejectedValue(
      new ApiError(
        422,
        'Só um projeto Público pode ficar em destaque no site: mude a visibilidade para Pública.',
      ),
    )
    const { usuario, onFechar } = abrir()
    const nome = screen.getByLabelText('Nome do projeto')
    await usuario.clear(nome)
    await usuario.type(nome, 'Despertai 2')
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Só um projeto Público pode ficar em destaque no site: mude a visibilidade para Pública.',
    )
    expect(onFechar).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    ).toBeEnabled()
  })

  it('não envia nome curto nem término antes do início', async () => {
    const { usuario } = abrir()
    const nome = screen.getByLabelText('Nome do projeto')
    await usuario.clear(nome)
    await usuario.type(nome, 'Ab')
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /nome ao projeto/,
    )

    await usuario.clear(nome)
    await usuario.type(nome, 'Despertai')
    fireEvent.change(screen.getByLabelText(/^Data de fim prevista/), {
      target: { value: '2026-09-01' },
    })
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /fim precisa ser depois/,
    )
    expect(api.editarProjeto).not.toHaveBeenCalled()
  })

  it('sem violação de acessibilidade', async () => {
    const { container } = abrir()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('contexto do projeto (eventos, relatórios, notícias)', () => {
  it('mostra o número, os eventos DESTE projeto, a situação dos relatórios e o link do editor do site', async () => {
    documentos.listarDocumentos.mockResolvedValue([
      relatorioDoProjeto(),
      relatorioDoProjeto({
        id_documento: 6,
        titulo: 'Rascunho de relatório',
        situacao: 'Rascunho',
      }),
    ])
    const { container } = renderizar(<ContextoDoProjeto projeto={projeto()} />)

    expect(screen.getByText(/O número deste projeto é/)).toHaveTextContent(
      /O número deste projeto é\s*3/,
    )
    expect(
      screen.getByText(/está em destaque na página inicial do site/),
    ).toBeInTheDocument()

    // só o evento ligado a este projeto (nº 12), com link para abri-lo
    const evento12 = await screen.findByRole('link', { name: 'Despertai 2026' })
    expect(evento12).toHaveAttribute('href', '/eventos?evento=12')
    expect(
      screen.queryByRole('link', { name: 'Outro projeto' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Sem projeto' }),
    ).not.toBeInTheDocument()

    // relatórios do PROJETO
    await waitFor(() =>
      expect(documentos.listarDocumentos).toHaveBeenCalledWith({
        vinculo_tipo: 'projeto',
        vinculo_id: 3,
      }),
    )
    const relatorioLink = await screen.findByRole('link', {
      name: 'Relatório do Despertai 2026',
    })
    expect(relatorioLink).toHaveAttribute('href', '/documentos/5')
    expect(screen.getByText('Aprovado')).toBeInTheDocument()
    expect(screen.getByText('Rascunho')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Novo relatório deste projeto/ }),
    ).toHaveAttribute(
      'href',
      '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=projeto&vinculo_id=3',
    )

    // notícias: editor do site, em outra aba, com o número do projeto
    const noticia = screen.getByRole('link', {
      name: /Escrever notícia deste projeto/,
    })
    expect(noticia).toHaveAttribute(
      'href',
      'https://cms.asaf.org.br/admin/content/noticias/+',
    )
    expect(noticia).toHaveAttribute('target', '_blank')
    expect(noticia).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText(/digite/)).toHaveTextContent(
      /“Número do projeto”, digite\s*3\./,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('projeto Interno: avisa que não tem página no site; sem evento, orienta a ligar um', async () => {
    api.listarEventos.mockResolvedValue([])
    renderizar(
      <ContextoDoProjeto
        projeto={projeto({
          visibilidade: 'Interna',
          destaque_no_site: false,
        })}
      />,
    )
    expect(
      screen.getByText(/Este projeto é Interno: não aparece no site/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Este projeto é Interno e não tem página no site/),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/Nenhum evento ligado a este projeto/),
    ).toBeInTheDocument()
  })

  it('quem não tem a permissão de documentos vê a lista, mas não o botão de novo relatório', async () => {
    permissoes.atuais = ['projetos', 'aprovar_publicacao']
    documentos.listarDocumentos.mockResolvedValue([relatorioDoProjeto()])
    renderizar(<ContextoDoProjeto projeto={projeto()} />)
    expect(
      await screen.findByRole('link', { name: 'Relatório do Despertai 2026' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Novo relatório/ }),
    ).not.toBeInTheDocument()
  })

  it('quem não pode nem ler documentos não os pede ao servidor', async () => {
    permissoes.atuais = ['projetos']
    renderizar(<ContextoDoProjeto projeto={projeto()} />)
    expect(
      await screen.findByText('Você não tem permissão para ver os documentos.'),
    ).toBeInTheDocument()
    expect(documentos.listarDocumentos).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('link', { name: /Novo relatório/ }),
    ).not.toBeInTheDocument()
  })
})

describe('detalhe do projeto com permissão', () => {
  it('quem gerencia projetos vê "Editar projeto" e abre o formulário; quem não gerencia não vê', async () => {
    const usuario = userEvent.setup()
    const { unmount } = renderizar(<ProjetosPage />, '/projetos?projeto=3')
    await usuario.click(
      await screen.findByRole('button', { name: 'Editar projeto' }),
    )
    expect(
      await screen.findByRole('form', { name: 'Editar projeto' }),
    ).toBeInTheDocument()
    unmount()

    permissoes.atuais = ['documentos']
    renderizar(<ProjetosPage />, '/projetos?projeto=3')
    await screen.findByText('Nº do projeto:', { exact: false })
    expect(
      screen.queryByRole('button', { name: 'Editar projeto' }),
    ).not.toBeInTheDocument()
  })
})
