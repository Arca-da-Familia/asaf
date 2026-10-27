import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FotoDaDiretoria } from '@/components/mandatos/FotoDaDiretoria'
import type { FotoDaDiretoria as DadosDaFoto } from '@/lib/api'
import { MandatosPage } from '@/pages/Mandatos'

import { renderizar } from './fabricas-despertai'

// v5.7c - "Foto no site" de quem tem mandato vigente (tela Mandatos). Os testes falam com um servidor de mentira que segue
// o contrato real (rotas, campos do formulário, recusa sem a autorização): assim o que sai do painel é conferido de verdade,
// não só a chamada a uma função simulada.

const permissoes = vi.hoisted(() => ({
  atuais: ['governanca'] as string[],
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: permissoes.atuais }, isLoading: false }),
}))

// só a lista de mandatos e o que a tela inteira pede ao lado são simulados; tudo o que é da foto passa pelo `fetch` falso
const api = vi.hoisted(() => ({
  listarMandatos: vi.fn(),
  listarMandatosVencendo: vi.fn(),
  listarConflitosInteresse: vi.fn(),
  listarAssociados: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
}))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  ...api,
}))

const ALT = 'Foto de Fábio de Teste, Tesoureiro'
const SEM_AUTORIZACAO =
  'Sem a autorização de uso de imagem a foto não é aceita: confirme que as pessoas que aparecem (ou os responsáveis, no caso de criança e adolescente) autorizaram.'
const CAIXA =
  'Esta pessoa assinou o termo de autorização de uso da imagem dela no site da ASAF'

function fotoDe(sobrescrever: Partial<DadosDaFoto> = {}): DadosDaFoto {
  return {
    id_foto: 4,
    consentimento: null,
    alt: ALT,
    largura: 600,
    altura: 800,
    tamanho: 52000,
    autorizacao_imagem: true,
    id_documento_autorizacao: null,
    criado_em: '2026-10-15T12:00:00',
    ...sobrescrever,
  }
}

const TERMO = {
  termo: 'IMAGEM_DIRETORIA',
  versao: '2',
  nome: 'Autorização de uso de imagem: foto da Diretoria e do Conselho no site',
  texto: 'Eu, identificado(a) abaixo, autorizo...',
  meios: [
    {
      codigo: 'termo_em_papel',
      rotulo: 'Termo assinado em papel, guardado pela secretaria',
    },
    {
      codigo: 'termo_digitalizado',
      rotulo: 'Termo assinado e digitalizado na biblioteca de Documentos',
    },
  ],
}

// ----------------------------------------------------------------------------------------------- servidor de mentira
type Chamada = {
  metodo: string
  caminho: string
  corpo: BodyInit | null | undefined
}

const servidor = {
  fotos: new Map<number, DadosDaFoto>(),
  vigentes: new Set<number>([7]),
  recusarEnvio: null as string | null,
  falharConsulta: false,
  envios: 0,
}
let chamadas: Chamada[] = []

const ROTA = /^\/api\/mandatos\/associados\/(\d+)\/foto-publica(\/arquivo)?$/

function json(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function situacaoDe(id: number) {
  const foto = servidor.fotos.get(id) ?? null
  return { foto, aparece_no_site: foto !== null && servidor.vigentes.has(id) }
}

async function responder(entrada: string, init: RequestInit = {}) {
  const url = new URL(entrada, 'http://localhost')
  const metodo = (init.method ?? 'GET').toUpperCase()
  chamadas.push({
    metodo,
    caminho: url.pathname + url.search,
    corpo: init.body,
  })
  // v7.1b: o termo de imagem em vigor (a versão volta no envio)
  if (url.pathname === '/api/consentimentos/termo-da-tela/foto_da_diretoria')
    return json(200, TERMO)
  const casou = ROTA.exec(url.pathname)
  if (!casou) return json(404, { detail: 'Rota fora do contrato do teste.' })
  const id = Number(casou[1])
  const arquivo = casou[2] !== undefined

  if (arquivo) {
    if (!servidor.fotos.has(id))
      return json(404, {
        detail: 'Esta pessoa não tem foto cadastrada para o site.',
      })
    return new Response('x', { headers: { 'content-type': 'image/jpeg' } })
  }
  if (metodo === 'GET') {
    if (servidor.falharConsulta)
      return json(500, { detail: 'Falha no servidor.' })
    return json(200, situacaoDe(id))
  }
  if (metodo === 'POST') {
    const form = init.body as FormData
    if (form.get('autorizacao_imagem') !== 'true')
      return json(400, { detail: SEM_AUTORIZACAO })
    if (
      form.get('meio') !== 'termo_em_papel' ||
      form.get('versao_do_termo') !== TERMO.versao
    )
      return json(400, { detail: 'Faltou o termo (meio e versão).' })
    if (servidor.recusarEnvio)
      return json(400, { detail: servidor.recusarEnvio })
    servidor.envios += 1
    servidor.fotos.set(
      id,
      fotoDe({ criado_em: `2026-10-15T12:00:0${servidor.envios}` }),
    )
    return json(201, situacaoDe(id))
  }
  if (metodo === 'DELETE') {
    if (!servidor.fotos.has(id))
      return json(404, {
        detail: 'Esta pessoa não tem foto cadastrada para o site.',
      })
    servidor.fotos.delete(id)
    return json(200, { mensagem: 'Foto apagada.' })
  }
  return json(405, { detail: 'Método fora do contrato do teste.' })
}

const envios = () => chamadas.filter((c) => c.metodo === 'POST')
const apagamentos = () => chamadas.filter((c) => c.metodo === 'DELETE')
const miniaturas = () => chamadas.filter((c) => c.caminho.includes('/arquivo'))

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['governanca']
  servidor.fotos = new Map()
  servidor.vigentes = new Set([7])
  servidor.recusarEnvio = null
  servidor.falharConsulta = false
  servidor.envios = 0
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: string, init?: RequestInit) => responder(entrada, init)),
  )
  URL.createObjectURL = vi.fn(() => 'blob:foto-de-teste')
  URL.revokeObjectURL = vi.fn()
})

const arquivo = () => new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
const botao = (nome: string) => screen.getByRole('button', { name: nome })

function abrir() {
  return renderizar(<FotoDaDiretoria idAssociado={7} nome="Fábio de Teste" />)
}

async function esperarMiniatura() {
  await waitFor(() =>
    expect(screen.getByRole('img', { name: ALT })).toBeInstanceOf(
      HTMLImageElement,
    ),
  )
}

async function abrirFormulario(
  usuario: ReturnType<typeof userEvent.setup>,
  rotulo = 'Enviar foto de Fábio de Teste',
) {
  await usuario.click(await screen.findByRole('button', { name: rotulo }))
  return screen.getByRole('form', {
    name: 'Formulário da foto no site de Fábio de Teste',
  })
}

// ----------------------------------------------------------------------------------------------- o que a tela mostra
describe('Foto no site: situação', () => {
  it('sem foto: diz que o site mostra só o nome e o cargo, oferece "Enviar foto" e não oferece apagar', async () => {
    abrir()
    expect(
      await screen.findByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeInTheDocument()
    expect(botao('Enviar foto de Fábio de Teste')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trocar foto/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Apagar/ })).toBeNull()
    expect(screen.queryByText('Aparece no site')).toBeNull()
    // nada a buscar: a miniatura só é pedida quando há foto
    expect(miniaturas()).toHaveLength(0)
  })

  it('com foto e mandato vigente: miniatura buscada com o token e "Aparece no site"', async () => {
    servidor.fotos.set(7, fotoDe())
    abrir()
    await esperarMiniatura()
    expect(screen.getByText('Aparece no site')).toBeInTheDocument()
    expect(screen.queryByText(/Cadastrada, mas não aparece no site/)).toBeNull()
    expect(miniaturas()).toHaveLength(1)
    expect(miniaturas()[0]!.caminho).toBe(
      '/api/mandatos/associados/7/foto-publica/arquivo?v=2026-10-15T12%3A00%3A00',
    )
    expect(botao('Trocar foto de Fábio de Teste')).toBeInTheDocument()
    expect(
      botao('Apagar a foto (retirou a autorização) de Fábio de Teste'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeNull()
  })

  it('com foto mas SEM mandato vigente: diz que está cadastrada e não aparece no site', async () => {
    servidor.fotos.set(7, fotoDe())
    servidor.vigentes = new Set()
    abrir()
    expect(
      await screen.findByText(
        'Cadastrada, mas não aparece no site (a pessoa não tem mandato vigente)',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Aparece no site')).toBeNull()
    // a foto continua podendo ser trocada ou apagada (quem retira a autorização não depende do mandato)
    expect(botao('Trocar foto de Fábio de Teste')).toBeInTheDocument()
    expect(
      botao('Apagar a foto (retirou a autorização) de Fábio de Teste'),
    ).toBeInTheDocument()
  })

  it('se não conseguir ver a foto, mostra o erro e deixa tentar de novo (sem oferecer o envio às cegas)', async () => {
    const usuario = userEvent.setup()
    servidor.falharConsulta = true
    abrir()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível ver a foto de Fábio de Teste. Tente de novo.',
    )
    expect(screen.queryByRole('button', { name: /Enviar foto/ })).toBeNull()
    servidor.falharConsulta = false
    await usuario.click(botao('Tentar de novo'))
    expect(
      await screen.findByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('quem não tem a permissão não vê botão nenhum e o painel nem pede a foto ao servidor', async () => {
    permissoes.atuais = ['documentos']
    abrir()
    expect(
      await screen.findByText(
        'Você não tem permissão para ver a foto de Fábio de Teste no site.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('form')).toBeNull()
    expect(chamadas).toHaveLength(0)
  })
})

// ----------------------------------------------------------------------------------------------- enviar e trocar
describe('Foto no site: enviar e trocar', () => {
  it('o formulário explica a autorização e o que fazer se ela for retirada, e pode ser cancelado', async () => {
    const usuario = userEvent.setup()
    const { container } = abrir()
    const formulario = await abrirFormulario(usuario)
    expect(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    ).not.toBeChecked()
    expect(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    ).toHaveAccessibleDescription(
      /A foto fica pública na página Diretoria\. Se ela retirar a autorização, use “Apagar a foto”: some do sistema na hora e do site na próxima publicação\./,
    )
    expect(
      within(formulario).getByLabelText(
        'Número do termo digitalizado (documento do sistema)',
        { exact: false },
      ),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
    // o botão de abrir some enquanto o formulário está aberto; cancelar fecha sem enviar nada
    expect(screen.queryByRole('button', { name: /Enviar foto de/ })).toBeNull()
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Cancelar' }),
    )
    expect(screen.queryByRole('form')).toBeNull()
    expect(botao('Enviar foto de Fábio de Teste')).toBeInTheDocument()
    expect(envios()).toHaveLength(0)
  })

  it('sem escolher a foto NÃO envia: "Escolha a foto."', async () => {
    const usuario = userEvent.setup()
    abrir()
    const formulario = await abrirFormulario(usuario)
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Escolha a foto.',
    )
    expect(envios()).toHaveLength(0)
  })

  it('sem marcar a autorização de imagem a foto NÃO é enviada e a frase aparece', async () => {
    const usuario = userEvent.setup()
    abrir()
    const formulario = await abrirFormulario(usuario)
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      arquivo(),
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Sem a autorização de uso de imagem a foto não é aceita/,
    )
    // NADA saiu do navegador: nem a foto, nem o cadastro
    expect(envios()).toHaveLength(0)
    expect(servidor.fotos.size).toBe(0)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('com a caixa marcada envia o formulário com autorizacao_imagem "true" e o arquivo, e o selo atualiza sem recarregar', async () => {
    const usuario = userEvent.setup()
    const { container } = abrir()
    const formulario = await abrirFormulario(usuario)
    const escolhida = arquivo()
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      escolhida,
    )
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.type(
      within(formulario).getByLabelText(/^Número do termo/),
      '4x7',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )

    await waitFor(() => expect(envios()).toHaveLength(1))
    const envio = envios()[0]!
    expect(envio.caminho).toBe('/api/mandatos/associados/7/foto-publica')
    const corpo = envio.corpo as FormData
    expect(corpo).toBeInstanceOf(FormData)
    expect(corpo.get('autorizacao_imagem')).toBe('true')
    expect((corpo.get('arquivo') as File).name).toBe('foto.jpg')
    expect(corpo.get('id_documento_autorizacao')).toBe('47') // só números

    // o selo e a miniatura atualizam, o botão vira "Trocar foto" e o formulário fica limpo com o aviso
    expect(await screen.findByText('Aparece no site')).toBeInTheDocument()
    await esperarMiniatura()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Foto enviada. Ela aparece no site na próxima publicação',
    )
    expect(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    ).not.toBeChecked()
    expect(within(formulario).getByLabelText(/^Número do termo/)).toHaveValue(
      '',
    )
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.files,
    ).toHaveLength(0)
    expect(
      within(formulario).getByRole('button', { name: 'Fechar' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeNull()
  })

  it('sem número do termo, o campo nem vai no formulário (é opcional)', async () => {
    const usuario = userEvent.setup()
    abrir()
    const formulario = await abrirFormulario(usuario)
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      arquivo(),
    )
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )
    await waitFor(() => expect(envios()).toHaveLength(1))
    expect(
      (envios()[0]!.corpo as FormData).has('id_documento_autorizacao'),
    ).toBe(false)
  })

  it('se a pessoa não tem mandato vigente, o aviso do envio diz que ela não aparece no site', async () => {
    const usuario = userEvent.setup()
    servidor.vigentes = new Set()
    abrir()
    const formulario = await abrirFormulario(usuario)
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      arquivo(),
    )
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Foto enviada, mas ela não aparece no site: a pessoa não tem mandato vigente.',
    )
    expect(
      await screen.findByText(
        'Cadastrada, mas não aparece no site (a pessoa não tem mandato vigente)',
      ),
    ).toBeInTheDocument()
  })

  it('o motivo da recusa do servidor aparece como veio, e nada muda na tela', async () => {
    const usuario = userEvent.setup()
    servidor.recusarEnvio = 'Formato não suportado. Use foto JPG, PNG ou WEBP.'
    abrir()
    const formulario = await abrirFormulario(usuario)
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      arquivo(),
    )
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Formato não suportado. Use foto JPG, PNG ou WEBP.',
    )
    expect(screen.queryByRole('status')).toBeNull()
    // o que foi marcado fica (não precisa refazer), e a pessoa continua sem foto
    expect(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    ).toBeChecked()
    expect(
      screen.getByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeInTheDocument()
  })

  it('"Trocar foto" substitui a foto e a miniatura é buscada de novo com a versão nova (não vem da cópia antiga)', async () => {
    const usuario = userEvent.setup()
    servidor.fotos.set(7, fotoDe())
    abrir()
    await esperarMiniatura()
    const formulario = await abrirFormulario(
      usuario,
      'Trocar foto de Fábio de Teste',
    )
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      arquivo(),
    )
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )
    await waitFor(() => expect(miniaturas()).toHaveLength(2))
    const [antes, depois] = miniaturas().map((c) => c.caminho)
    expect(antes).toContain('?v=2026-10-15T12%3A00%3A00')
    expect(depois).toContain('?v=2026-10-15T12%3A00%3A01')
    expect(depois).not.toBe(antes)
  })
})

// ----------------------------------------------------------------------------------------------- apagar
describe('Foto no site: apagar (a pessoa retirou a autorização)', () => {
  const rotuloApagar = 'Apagar a foto (retirou a autorização) de Fábio de Teste'

  it('só apaga depois de dois passos: o primeiro clique abre a confirmação e não chama o servidor', async () => {
    const usuario = userEvent.setup()
    servidor.fotos.set(7, fotoDe())
    abrir()
    await esperarMiniatura()
    await usuario.click(botao(rotuloApagar))
    const dialogo = await screen.findByRole('alertdialog')
    expect(dialogo).toHaveTextContent('Apagar a foto de Fábio de Teste?')
    expect(dialogo).toHaveTextContent(
      /some do sistema na hora, e do site na próxima publicação/,
    )
    expect(apagamentos()).toHaveLength(0)

    // cancelar não apaga
    await usuario.click(
      within(dialogo).getByRole('button', { name: 'Cancelar' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(apagamentos()).toHaveLength(0)
    expect(screen.getByText('Aparece no site')).toBeInTheDocument()

    // confirmar apaga, a tela volta para "sem foto" e avisa que saiu do sistema
    await usuario.click(botao(rotuloApagar))
    await usuario.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Apagar a foto',
      }),
    )
    await waitFor(() => expect(apagamentos()).toHaveLength(1))
    expect(apagamentos()[0]!.caminho).toBe(
      '/api/mandatos/associados/7/foto-publica',
    )
    expect(
      await screen.findByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Foto apagada. Ela saiu do sistema na hora e some do site na próxima publicação',
    )
    expect(screen.queryByRole('button', { name: /Apagar/ })).toBeNull()
    expect(botao('Enviar foto de Fábio de Teste')).toBeInTheDocument()
    expect(servidor.fotos.size).toBe(0)
  })

  it('se o servidor recusar (a foto já tinha sido apagada em outra aba), o motivo aparece fora do diálogo', async () => {
    const usuario = userEvent.setup()
    servidor.fotos.set(7, fotoDe())
    abrir()
    await esperarMiniatura()
    await usuario.click(botao(rotuloApagar))
    // outra aba apagou no meio do caminho
    servidor.fotos.delete(7)
    await usuario.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Apagar a foto',
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta pessoa não tem foto cadastrada para o site.',
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // a tela confere de novo e passa a mostrar a verdade
    expect(
      await screen.findByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------------------------------------- tela Mandatos inteira
describe('Tela Mandatos: onde o bloco aparece', () => {
  const associado = (id: number, nome: string) => ({
    id_associado: id,
    nome_completo: nome,
  })
  const mandato = (id: number, idAssociado: number, vigente: boolean) => ({
    id_mandato: id,
    id_associado: idAssociado,
    orgao_codigo: 'DIRETORIA_EXECUTIVA',
    cargo_codigo: 'TESOUREIRO',
    data_inicio: '2026-01-15T00:00:00',
    data_fim_previsto: '2030-01-15T00:00:00',
    data_fim_efetivo: vigente ? null : '2026-06-01T00:00:00',
    motivo_encerramento: vigente ? null : 'Renúncia',
    ato_origem: null,
    vigente,
  })

  beforeEach(() => {
    api.listarAssociados.mockResolvedValue([
      associado(7, 'Fábio de Teste'),
      associado(3, 'Marta de Teste'),
      associado(4, 'Júlia de Teste'),
    ])
    api.listarOpcoesCatalogo.mockResolvedValue([])
    api.listarMandatosVencendo.mockResolvedValue([])
    api.listarConflitosInteresse.mockResolvedValue([])
  })

  it('só quem tem mandato vigente ganha o bloco, e uma vez só por pessoa (a foto é da pessoa, não do mandato)', async () => {
    api.listarMandatos.mockResolvedValue([
      mandato(5, 7, true),
      mandato(8, 7, true), // a mesma pessoa em dois mandatos vigentes
      mandato(9, 3, false), // encerrado: sem bloco
      mandato(10, 4, true),
    ])
    servidor.vigentes = new Set([7, 4])
    renderizar(<MandatosPage />)
    expect(
      await screen.findByRole('region', {
        name: 'Foto no site de Fábio de Teste',
      }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('region', {
        name: 'Foto no site de Júlia de Teste',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Marta de Teste/ })).toBeNull()
    expect(
      screen.getAllByRole('heading', { name: 'Foto no site' }),
    ).toHaveLength(2)
    const consultas = chamadas
      .filter((c) => c.metodo === 'GET')
      .map((c) => c.caminho)
    expect(consultas.filter((c) => c.includes('/associados/7/'))).toHaveLength(
      1,
    )
    expect(consultas.filter((c) => c.includes('/associados/4/'))).toHaveLength(
      1,
    )
    expect(consultas.filter((c) => c.includes('/associados/3/'))).toHaveLength(
      0,
    )
  })

  it('na tela inteira: depois de enviar a foto, a situação passa de "sem foto" para "Aparece no site"', async () => {
    const usuario = userEvent.setup()
    api.listarMandatos.mockResolvedValue([mandato(5, 7, true)])
    renderizar(<MandatosPage />)
    const bloco = await screen.findByRole('region', {
      name: 'Foto no site de Fábio de Teste',
    })
    expect(
      await within(bloco).findByText(
        'Sem foto: o site mostra só o nome e o cargo',
      ),
    ).toBeInTheDocument()

    await usuario.click(
      within(bloco).getByRole('button', {
        name: 'Enviar foto de Fábio de Teste',
      }),
    )
    const formulario = within(bloco).getByRole('form')
    await usuario.upload(
      within(formulario).getByLabelText(/^Foto \(JPG/),
      arquivo(),
    )
    await usuario.click(
      within(formulario).getByRole('checkbox', { name: CAIXA }),
    )
    await usuario.selectOptions(
      await within(formulario).findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    await usuario.click(
      within(formulario).getByRole('button', { name: 'Enviar a foto' }),
    )

    expect(
      await within(bloco).findByText('Aparece no site'),
    ).toBeInTheDocument()
    expect(
      within(bloco).queryByText('Sem foto: o site mostra só o nome e o cargo'),
    ).toBeNull()
    await waitFor(() =>
      expect(within(bloco).getByRole('img', { name: ALT })).toBeInstanceOf(
        HTMLImageElement,
      ),
    )
    expect(envios()).toHaveLength(1)
  })
})
