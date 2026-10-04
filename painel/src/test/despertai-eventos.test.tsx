import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ContextoDoEvento } from '@/components/eventos/ContextoDoEvento'
import { EditarEvento } from '@/components/eventos/EditarEvento'
import { ApiError, type Evento } from '@/lib/api'
import { paraDataHoraLocalInput } from '@/lib/datas'
import { EventosPage } from '@/pages/Eventos'

import {
  evento,
  foto,
  projeto,
  relatorio,
  renderizar,
  simularRedeSemResposta,
} from './fabricas-despertai'

// Despertai e o contexto do evento (v5.5) - lado dos EVENTOS: criar e editar com projeto, e a seção "Contexto do evento"
// (projeto, relatórios, fotos com autorização de imagem e notícias ligadas pelo número).

const permissoes = vi.hoisted(() => ({
  atuais: ['projetos', 'documentos'] as string[],
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: permissoes.atuais }, isLoading: false }),
}))

const api = vi.hoisted(() => ({
  listarEventos: vi.fn(),
  listarProjetos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarEspacos: vi.fn(),
  listarAssociados: vi.fn(),
  criarEvento: vi.fn(),
  editarEvento: vi.fn(),
  listarFotosDoEvento: vi.fn(),
  enviarFotoDoEvento: vi.fn(),
  apagarFotoDoEvento: vi.fn(),
  apiFetchBlob: vi.fn(),
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

const ALT = 'Crianças tocando tambores na quadra da escola'

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['projetos', 'documentos']
  simularRedeSemResposta()
  URL.createObjectURL = vi.fn(() => 'blob:foto-de-teste')
  URL.revokeObjectURL = vi.fn()
  api.apiFetchBlob.mockResolvedValue({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    nomeSugerido: null,
  })
  api.listarEventos.mockResolvedValue([
    evento(),
    evento({ id_evento: 13, titulo: 'Encontro sem projeto', id_projeto: null }),
  ])
  api.listarProjetos.mockResolvedValue([
    projeto(),
    projeto({
      id_projeto: 4,
      nome_projeto: 'Reunião da diretoria',
      visibilidade: 'Interna',
      destaque_no_site: false,
    }),
  ])
  api.listarOpcoesCatalogo.mockImplementation(async (chave: string) =>
    chave === 'tipo_evento'
      ? [
          { codigo: 'PALESTRA', rotulo: 'Palestra' },
          { codigo: 'OFICINA', rotulo: 'Oficina' },
        ]
      : [],
  )
  api.listarEspacos.mockResolvedValue([])
  api.listarAssociados.mockResolvedValue([])
  api.listarFotosDoEvento.mockResolvedValue([foto()])
  documentos.listarDocumentos.mockResolvedValue([])
})

// ----------------------------------------------------------------------------------------------- criar evento
describe('criar evento com projeto', () => {
  async function abrirFormulario() {
    const usuario = userEvent.setup()
    const resultado = renderizar(<EventosPage />)
    await screen.findByText('Despertai 2026')
    await usuario.click(screen.getByRole('button', { name: 'Novo evento' }))
    // o catálogo de categorias e a lista de projetos chegam depois de abrir o formulário
    await screen.findByRole('option', { name: 'Palestra' })
    await screen.findByRole('option', { name: 'Despertai (nº 3)' })
    return { usuario, ...resultado }
  }

  async function preencherObrigatorios(
    usuario: ReturnType<typeof userEvent.setup>,
  ) {
    await usuario.type(
      screen.getByLabelText('Título do evento'),
      'Despertai 2027',
    )
    await usuario.selectOptions(
      screen.getByLabelText('Categoria do evento'),
      'PALESTRA',
    )
    fireEvent.change(screen.getByLabelText(/^Início/), {
      target: { value: '2027-02-10T19:00' },
    })
  }

  it('o seletor "Projeto" lista os projetos, com "Sem projeto"; escolher um envia id_projeto', async () => {
    api.criarEvento.mockResolvedValue({ mensagem: 'ok', id_evento: 20 })
    const { usuario } = await abrirFormulario()
    const seletor = screen.getByLabelText(/^Projeto \(opcional\)/)
    expect(
      within(seletor).getByRole('option', { name: 'Sem projeto' }),
    ).toBeInTheDocument()
    await preencherObrigatorios(usuario)
    await usuario.selectOptions(seletor, '3')
    await usuario.click(screen.getByRole('button', { name: 'Criar evento' }))

    await waitFor(() => expect(api.criarEvento).toHaveBeenCalledTimes(1))
    expect(api.criarEvento.mock.calls[0]![0]).toMatchObject({
      titulo: 'Despertai 2027',
      categoria: 'PALESTRA',
      id_projeto: 3,
      data_hora_inicio: new Date('2027-02-10T19:00').toISOString(),
    })
  })

  it('sem escolher projeto (nem espaço, vagas ou responsável) não manda 0 nem texto vazio', async () => {
    api.criarEvento.mockResolvedValue({ mensagem: 'ok', id_evento: 20 })
    const { usuario } = await abrirFormulario()
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Criar evento' }))
    await waitFor(() => expect(api.criarEvento).toHaveBeenCalledTimes(1))
    const enviado = api.criarEvento.mock.calls[0]![0] as Record<string, unknown>
    // antes: o campo em branco virava 0 e o servidor respondia "Projeto/Espaço nº 0 não encontrado"
    for (const campo of [
      'id_projeto',
      'id_espaco',
      'id_associado_responsavel',
      'vagas',
    ]) {
      expect(enviado[campo]).toBeUndefined()
    }
  })

  it('o motivo do servidor aparece (projeto que não existe)', async () => {
    api.criarEvento.mockRejectedValue(
      new ApiError(404, 'Projeto nº 987654 não encontrado.'),
    )
    const { usuario } = await abrirFormulario()
    await preencherObrigatorios(usuario)
    await usuario.click(screen.getByRole('button', { name: 'Criar evento' }))
    const alertas = await screen.findAllByRole('alert')
    expect(alertas[0]).toHaveTextContent('Projeto nº 987654 não encontrado.')
  })

  it('o formulário aberto não tem violação de acessibilidade', async () => {
    const { container } = await abrirFormulario()
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ----------------------------------------------------------------------------------------------- editar evento
describe('editar evento', () => {
  function abrir(e: Evento = evento(), onFechar = vi.fn()) {
    const resultado = renderizar(
      <EditarEvento evento={e} onFechar={onFechar} />,
    )
    return { usuario: userEvent.setup(), onFechar, ...resultado }
  }
  const salvar = () => screen.getByRole('button', { name: 'Salvar alterações' })

  it('já vem com o que está cadastrado e envia SÓ o que mudou', async () => {
    api.editarEvento.mockResolvedValue(evento())
    const { usuario, onFechar } = abrir()
    expect(screen.getByLabelText('Título do evento')).toHaveValue(
      'Despertai 2026',
    )
    expect(screen.getByLabelText(/^Início/)).toHaveValue(
      paraDataHoraLocalInput('2026-11-10T22:00:00'),
    )
    expect(screen.getByLabelText(/^Quem pode ver o evento/)).toHaveValue(
      'Pública',
    )

    const titulo = screen.getByLabelText('Título do evento')
    await usuario.clear(titulo)
    await usuario.type(titulo, 'Despertai 2026 - 2ª edição')
    await usuario.click(salvar())

    await waitFor(() => expect(api.editarEvento).toHaveBeenCalledTimes(1))
    expect(api.editarEvento).toHaveBeenCalledWith(12, {
      titulo: 'Despertai 2026 - 2ª edição',
    })
    await waitFor(() => expect(onFechar).toHaveBeenCalled())
  })

  it('trocar de projeto manda o número novo; "Sem projeto" desliga (null)', async () => {
    api.editarEvento.mockResolvedValue(evento())
    const { usuario } = abrir()
    await screen.findByRole('option', { name: 'Reunião da diretoria (nº 4)' })
    await usuario.selectOptions(
      screen.getByLabelText(/^Projeto deste evento/),
      '4',
    )
    await usuario.click(salvar())
    await waitFor(() => expect(api.editarEvento).toHaveBeenCalledTimes(1))
    expect(api.editarEvento).toHaveBeenLastCalledWith(12, { id_projeto: 4 })

    await usuario.selectOptions(
      screen.getByLabelText(/^Projeto deste evento/),
      '',
    )
    await usuario.click(salvar())
    await waitFor(() => expect(api.editarEvento).toHaveBeenCalledTimes(2))
    expect(api.editarEvento).toHaveBeenLastCalledWith(12, { id_projeto: null })
  })

  it('evento sem projeto pode ganhar um', async () => {
    api.editarEvento.mockResolvedValue(evento())
    const { usuario } = abrir(evento({ id_projeto: null }))
    await screen.findByRole('option', { name: 'Despertai (nº 3)' })
    await usuario.selectOptions(
      screen.getByLabelText(/^Projeto deste evento/),
      '3',
    )
    await usuario.click(salvar())
    await waitFor(() => expect(api.editarEvento).toHaveBeenCalledTimes(1))
    expect(api.editarEvento).toHaveBeenCalledWith(12, { id_projeto: 3 })
  })

  it('início novo vai em UTC; vagas e descrição esvaziadas viram null', async () => {
    api.editarEvento.mockResolvedValue(evento())
    const { usuario } = abrir(evento({ vagas: 30, descricao: 'Texto antigo' }))
    fireEvent.change(screen.getByLabelText(/^Início/), {
      target: { value: '2026-12-01T19:00' },
    })
    await usuario.clear(screen.getByLabelText(/^Vagas/))
    await usuario.clear(screen.getByLabelText(/^Descrição/))
    await usuario.click(salvar())
    await waitFor(() => expect(api.editarEvento).toHaveBeenCalledTimes(1))
    expect(api.editarEvento).toHaveBeenCalledWith(12, {
      data_hora_inicio: new Date('2026-12-01T19:00').toISOString(),
      vagas: null,
      descricao: null,
    })
  })

  it('sem nenhuma mudança não chama o servidor e avisa', async () => {
    const { usuario } = abrir()
    await usuario.click(salvar())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nada foi alterado.',
    )
    expect(api.editarEvento).not.toHaveBeenCalled()
  })

  it('não envia título curto, fim antes do início nem vagas inválidas', async () => {
    const { usuario } = abrir()
    const titulo = screen.getByLabelText('Título do evento')
    await usuario.clear(titulo)
    await usuario.type(titulo, 'Ab')
    await usuario.click(salvar())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /título ao evento/,
    )

    await usuario.clear(titulo)
    await usuario.type(titulo, 'Despertai 2026')
    fireEvent.change(screen.getByLabelText(/^Fim/), {
      target: { value: '2026-11-01T10:00' },
    })
    await usuario.click(salvar())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /fim do evento precisa ser depois do início/,
    )

    fireEvent.change(screen.getByLabelText(/^Fim/), { target: { value: '' } })
    await usuario.type(screen.getByLabelText(/^Vagas/), '0')
    await usuario.click(salvar())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /número inteiro maior que zero/,
    )
    expect(api.editarEvento).not.toHaveBeenCalled()
  })

  it('o erro 422 do servidor aparece em português e o formulário continua aberto', async () => {
    api.editarEvento.mockRejectedValue(
      new ApiError(
        422,
        'O evento já tem 8 vagas ocupadas: o limite não pode ser menor que isso.',
      ),
    )
    const { usuario, onFechar } = abrir(evento({ vagas: 20 }))
    const vagas = screen.getByLabelText(/^Vagas/)
    await usuario.clear(vagas)
    await usuario.type(vagas, '5')
    await usuario.click(salvar())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O evento já tem 8 vagas ocupadas: o limite não pode ser menor que isso.',
    )
    expect(onFechar).not.toHaveBeenCalled()
  })

  it('evento Público avisa que o texto vai ao site e passa pela conferência de dado pessoal', () => {
    abrir()
    expect(
      screen.getByText(/passam por conferência de dado pessoal/),
    ).toBeInTheDocument()
  })

  it('sem violação de acessibilidade', async () => {
    const { container } = abrir()
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ----------------------------------------------------------------------------------------------- contexto do evento
describe('contexto do evento', () => {
  it('mostra o número do evento, o projeto atual e diz que aparece na página do projeto no site', async () => {
    renderizar(<ContextoDoEvento evento={evento()} />)
    expect(screen.getByText(/O número deste evento é/)).toHaveTextContent(
      /O número deste evento é\s*12\./,
    )
    expect(
      await screen.findByText(
        /Este evento e o projeto são Públicos: ele aparece na página do projeto “Despertai” no site\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Despertai', { selector: 'strong' }),
    ).toBeInTheDocument()
  })

  it('evento Interno ou projeto Interno: explica por que NÃO aparece na página do projeto', async () => {
    const { unmount } = renderizar(
      <ContextoDoEvento evento={evento({ visibilidade: 'Interna' })} />,
    )
    expect(
      await screen.findByText(/Este evento é Interno: ele não aparece no site/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Este evento é Interno e não tem página no site/),
    ).toBeInTheDocument()
    unmount()

    renderizar(<ContextoDoEvento evento={evento({ id_projeto: 4 })} />)
    expect(
      await screen.findByText(/O projeto “Reunião da diretoria” é Interno/),
    ).toBeInTheDocument()
  })

  it('evento sem projeto: diz isso, não mostra frase de publicação', async () => {
    renderizar(<ContextoDoEvento evento={evento({ id_projeto: null })} />)
    expect(
      screen.getByText('Este evento não está ligado a nenhum projeto.'),
    ).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Despertai (nº 3)' })
    expect(
      screen.queryByText(/aparece na página do projeto/),
    ).not.toBeInTheDocument()
  })

  it('o projeto se troca por aqui: o botão só liga quando mudou e manda o número novo', async () => {
    const usuario = userEvent.setup()
    api.editarEvento.mockResolvedValue(evento({ id_projeto: 4 }))
    renderizar(<ContextoDoEvento evento={evento()} />)
    await screen.findByRole('option', { name: 'Reunião da diretoria (nº 4)' })
    const botao = screen.getByRole('button', { name: 'Salvar projeto' })
    expect(botao).toBeDisabled()
    await usuario.selectOptions(
      screen.getByLabelText('Trocar o projeto deste evento'),
      '4',
    )
    expect(botao).toBeEnabled()
    await usuario.click(botao)
    await waitFor(() =>
      expect(api.editarEvento).toHaveBeenCalledWith(12, { id_projeto: 4 }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Projeto do evento atualizado.',
    )
  })

  it('erro ao trocar o projeto aparece em português', async () => {
    const usuario = userEvent.setup()
    api.editarEvento.mockRejectedValue(
      new ApiError(404, 'Projeto nº 4 não encontrado.'),
    )
    renderizar(<ContextoDoEvento evento={evento()} />)
    await screen.findByRole('option', { name: 'Reunião da diretoria (nº 4)' })
    await usuario.selectOptions(
      screen.getByLabelText('Trocar o projeto deste evento'),
      '4',
    )
    await usuario.click(screen.getByRole('button', { name: 'Salvar projeto' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Projeto nº 4 não encontrado.',
    )
  })

  describe('relatórios e documentos', () => {
    it('lista os documentos ligados ao evento, com a situação, e o botão leva ao cadastro já preenchido', async () => {
      documentos.listarDocumentos.mockResolvedValue([
        relatorio(),
        relatorio({
          id_documento: 6,
          titulo: 'Rascunho do relatório',
          situacao: 'Rascunho',
        }),
        relatorio({
          id_documento: 7,
          titulo: 'Relatório em revisão',
          situacao: 'Em revisão',
        }),
        relatorio({
          id_documento: 8,
          titulo: 'Relatório retirado',
          situacao: 'Retirado',
          versao: 2,
          vigente: false,
        }),
      ])
      const { container } = renderizar(<ContextoDoEvento evento={evento()} />)
      await waitFor(() =>
        expect(documentos.listarDocumentos).toHaveBeenCalledWith({
          vinculo_tipo: 'evento',
          vinculo_id: 12,
        }),
      )
      const link = await screen.findByRole('link', {
        name: 'Relatório do Despertai 2026',
      })
      expect(link).toHaveAttribute('href', '/documentos/5')
      const linha = link.closest('li') as HTMLElement
      expect(
        within(linha).getByText(/Relatório de evento ou de projeto/),
      ).toBeInTheDocument()
      expect(within(linha).getByText('Aprovado')).toBeInTheDocument()
      for (const situacao of ['Rascunho', 'Em revisão', 'Retirado']) {
        expect(screen.getByText(situacao)).toBeInTheDocument()
      }
      expect(screen.getByText(/versão 2 \(não vigente\)/)).toBeInTheDocument()

      expect(
        screen.getByRole('link', { name: /Novo relatório deste evento/ }),
      ).toHaveAttribute(
        'href',
        '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=evento&vinculo_id=12',
      )
      expect(await axe(container)).toHaveNoViolations()
    })

    it('sem documento ligado, diz isso', async () => {
      renderizar(<ContextoDoEvento evento={evento()} />)
      expect(
        await screen.findByText(
          'Nenhum relatório ou documento ligado a este evento ainda.',
        ),
      ).toBeInTheDocument()
    })

    it('só quem tem a permissão "documentos" vê o botão de novo relatório', async () => {
      permissoes.atuais = ['projetos', 'aprovar_publicacao']
      documentos.listarDocumentos.mockResolvedValue([relatorio()])
      renderizar(<ContextoDoEvento evento={evento()} />)
      expect(
        await screen.findByRole('link', {
          name: 'Relatório do Despertai 2026',
        }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /Novo relatório/ }),
      ).not.toBeInTheDocument()
    })

    it('quem não pode ler documentos não os pede ao servidor', async () => {
      permissoes.atuais = ['projetos']
      renderizar(<ContextoDoEvento evento={evento()} />)
      expect(
        await screen.findByText(
          'Você não tem permissão para ver os documentos.',
        ),
      ).toBeInTheDocument()
      expect(documentos.listarDocumentos).not.toHaveBeenCalled()
    })
  })

  describe('notícias deste evento', () => {
    it('explica que a notícia mora no editor do site e abre o editor em outra aba, com o número do evento', () => {
      renderizar(<ContextoDoEvento evento={evento()} />)
      const link = screen.getByRole('link', {
        name: /Escrever notícia deste evento/,
      })
      expect(link).toHaveAttribute(
        'href',
        'https://cms.asaf.org.br/admin/content/noticias/+',
      )
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
      expect(link).toHaveTextContent(/abre em outra aba/)
      const explicacao = screen.getByText(/digite/)
      expect(explicacao).toHaveTextContent(
        /No campo “Número do evento”, digite\s*12\./,
      )
      expect(explicacao).toHaveTextContent(/editor do site, não aqui/)
      expect(explicacao).toHaveTextContent(
        /sozinha na página do evento no site, em até 25 minutos/,
      )
    })
  })

  describe('fotos do evento (com autorização de imagem)', () => {
    const arquivo = () => new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    const enviar = () => screen.getByRole('button', { name: 'Enviar a foto' })

    async function abrir() {
      const usuario = userEvent.setup()
      const resultado = renderizar(<ContextoDoEvento evento={evento()} />)
      // a miniatura troca de caixa vazia para <img> quando a foto chega: espera estabilizar
      await waitFor(() =>
        expect(screen.getByRole('img', { name: ALT })).toBeInstanceOf(
          HTMLImageElement,
        ),
      )
      return { usuario, ...resultado }
    }

    it('mostra as fotos já enviadas (buscadas com o token) e o aviso de que a foto sai do site ao apagar', async () => {
      const { container } = await abrir()
      expect(api.listarFotosDoEvento).toHaveBeenCalledWith(12)
      expect(api.apiFetchBlob).toHaveBeenCalledWith(
        '/api/eventos/12/fotos/9/arquivo',
      )
      expect(
        screen.getByText(/guardada sem localização nem dados do aparelho/),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/ela sai do site e do armazenamento/),
      ).toBeInTheDocument()
      expect(await axe(container)).toHaveNoViolations()
    })

    it('sem marcar a autorização de imagem a foto NÃO é enviada e o motivo aparece', async () => {
      const { usuario } = await abrir()
      await usuario.upload(
        screen.getByLabelText(/Enviar foto \(JPG/),
        arquivo(),
      )
      await usuario.type(
        screen.getByLabelText(/Descrição da foto/),
        'Oficina de percussão na quadra',
      )
      await usuario.click(enviar())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /autorização de uso de imagem/,
      )
      expect(api.enviarFotoDoEvento).not.toHaveBeenCalled()
    })

    it('sem descrição (ou com menos de 10 letras) a foto NÃO é enviada', async () => {
      const { usuario } = await abrir()
      await usuario.upload(
        screen.getByLabelText(/Enviar foto \(JPG/),
        arquivo(),
      )
      await usuario.click(
        screen.getByRole('checkbox', {
          name: /Há autorização de uso de imagem/,
        }),
      )
      await usuario.click(enviar())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /Descreva a foto/,
      )
      await usuario.type(screen.getByLabelText(/Descrição da foto/), 'curta')
      await usuario.click(enviar())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        /pelo menos 10 letras/,
      )
      expect(api.enviarFotoDoEvento).not.toHaveBeenCalled()
    })

    it('sem escolher a foto não envia', async () => {
      const { usuario } = await abrir()
      await usuario.click(enviar())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Escolha a foto.',
      )
      expect(api.enviarFotoDoEvento).not.toHaveBeenCalled()
    })

    it('com tudo certo envia ao evento, mostra a foto nova e esvazia o formulário', async () => {
      const usuario = userEvent.setup()
      api.enviarFotoDoEvento.mockResolvedValue([
        foto(),
        foto({ id_foto: 10, alt: 'Roda de conversa no pátio da associação' }),
      ])
      const resultado = renderizar(<ContextoDoEvento evento={evento()} />)
      await screen.findByRole('img', { name: ALT })
      const arq = arquivo()
      await usuario.upload(screen.getByLabelText(/Enviar foto \(JPG/), arq)
      await usuario.type(
        screen.getByLabelText(/Descrição da foto/),
        'Roda de conversa no pátio da associação',
      )
      await usuario.click(
        screen.getByRole('checkbox', {
          name: /Há autorização de uso de imagem/,
        }),
      )
      await usuario.type(
        screen.getByLabelText(/Nº do documento do termo/),
        '4x7',
      )
      await usuario.click(enviar())

      await waitFor(() =>
        expect(api.enviarFotoDoEvento).toHaveBeenCalledTimes(1),
      )
      const [id, dados] = api.enviarFotoDoEvento.mock.calls[0]!
      expect(id).toBe(12)
      expect(dados).toMatchObject({
        arquivo: arq,
        alt: 'Roda de conversa no pátio da associação',
        autorizacaoImagem: true,
        idDocumentoAutorizacao: '47', // só números
      })
      expect(
        await screen.findByRole('img', {
          name: 'Roda de conversa no pátio da associação',
        }),
      ).toBeInTheDocument()
      await waitFor(() =>
        expect(screen.getByLabelText(/Descrição da foto/)).toHaveValue(''),
      )
      expect(
        screen.getByRole('checkbox', {
          name: /Há autorização de uso de imagem/,
        }),
      ).not.toBeChecked()
      expect(screen.getByRole('status')).toHaveTextContent('Foto enviada.')
      const arquivoNoCampo =
        resultado.container.querySelector<HTMLInputElement>(
          'input[type="file"]',
        )
      expect(arquivoNoCampo?.files).toHaveLength(0)
    })

    it('se o servidor recusar (ex.: dado pessoal na descrição), o motivo aparece e o texto digitado fica', async () => {
      api.enviarFotoDoEvento.mockRejectedValue(
        new ApiError(422, 'A descrição da foto tem dado pessoal (CPF).'),
      )
      const { usuario } = await abrir()
      await usuario.upload(
        screen.getByLabelText(/Enviar foto \(JPG/),
        arquivo(),
      )
      await usuario.type(
        screen.getByLabelText(/Descrição da foto/),
        'Foto da Maria, CPF 111.444.777-35',
      )
      await usuario.click(
        screen.getByRole('checkbox', {
          name: /Há autorização de uso de imagem/,
        }),
      )
      await usuario.click(enviar())
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'A descrição da foto tem dado pessoal (CPF).',
      )
      expect(screen.getByLabelText(/Descrição da foto/)).toHaveValue(
        'Foto da Maria, CPF 111.444.777-35',
      )
    })

    it('apagar tira a foto da lista (e do site, pelo servidor)', async () => {
      api.apagarFotoDoEvento.mockResolvedValue([])
      const { usuario } = await abrir()
      await usuario.click(
        screen.getByRole('button', {
          name: new RegExp(`Apagar a foto: ${ALT}`),
        }),
      )
      await waitFor(() =>
        expect(api.apagarFotoDoEvento).toHaveBeenCalledWith(12, 9),
      )
      expect(await screen.findByText('Nenhuma foto.')).toBeInTheDocument()
    })

    it('quem só pode ler o evento não vê o formulário de envio, o botão de apagar, nem pede as fotos', async () => {
      permissoes.atuais = ['documentos']
      renderizar(<ContextoDoEvento evento={evento()} />)
      expect(
        await screen.findByText(
          'Você não tem permissão para ver as fotos deste evento.',
        ),
      ).toBeInTheDocument()
      expect(api.listarFotosDoEvento).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: 'Enviar a foto' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Apagar/ }),
      ).not.toBeInTheDocument()
      // sem a permissão de projetos também não troca o projeto
      expect(
        screen.queryByRole('button', { name: 'Salvar projeto' }),
      ).not.toBeInTheDocument()
      // mas o botão de relatório (permissão "documentos") continua
      expect(
        screen.getByRole('link', { name: /Novo relatório deste evento/ }),
      ).toBeInTheDocument()
    })
  })
})

// ----------------------------------------------------------------------------------------------- a página
describe('página de Eventos', () => {
  it('a lista mostra o número de cada evento; ?evento=12 abre o evento com o Nº bem visível e o Contexto', async () => {
    const { container } = renderizar(<EventosPage />, '/eventos?evento=12')
    const numero = await screen.findByText('Nº do evento:', { exact: false })
    expect(numero).toHaveTextContent(/Nº do evento:\s*12/)
    expect(numero).toHaveTextContent(/editor do site/)
    expect(
      await screen.findByRole('heading', { name: 'Contexto do evento' }),
    ).toBeInTheDocument()
    expect(screen.getByText('nº 13')).toBeInTheDocument() // o outro evento, na lista
    expect(
      container.querySelector('[aria-label="Contexto do evento"]'),
    ).not.toBeNull()
  })

  it('"Editar evento" abre o formulário para quem gerencia projetos; quem não gerencia não vê o botão', async () => {
    const usuario = userEvent.setup()
    const { unmount } = renderizar(<EventosPage />, '/eventos?evento=12')
    await usuario.click(
      await screen.findByRole('button', { name: 'Editar evento' }),
    )
    expect(
      await screen.findByRole('form', { name: 'Editar evento' }),
    ).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(
      screen.queryByRole('form', { name: 'Editar evento' }),
    ).not.toBeInTheDocument()
    unmount()

    permissoes.atuais = ['documentos']
    renderizar(<EventosPage />, '/eventos?evento=12')
    await screen.findByText('Nº do evento:', { exact: false })
    expect(
      screen.queryByRole('button', { name: 'Editar evento' }),
    ).not.toBeInTheDocument()
  })

  it('o evento abre também pelo teclado', async () => {
    const usuario = userEvent.setup()
    renderizar(<EventosPage />)
    const linha = (await screen.findByText('Encontro sem projeto')).closest(
      '[role="button"]',
    ) as HTMLElement
    linha.focus()
    await usuario.keyboard('{Enter}')
    expect(
      await screen.findByText('Nº do evento:', { exact: false }),
    ).toHaveTextContent(/Nº do evento:\s*13/)
  })
})
