import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StatusDoEvento } from '@/components/eventos/StatusDoEvento'
import {
  ApiError,
  type Evento,
  type ResultadoDaMudancaDeStatusDoEvento,
} from '@/lib/api'
import { formatarData, paraDataHoraLocalInput } from '@/lib/datas'
import { EventosPage } from '@/pages/Eventos'

import {
  evento,
  renderizar,
  simularRedeSemResposta,
} from './fabricas-despertai'

// v5.5d - Situação do evento no painel: o selo (com texto), os botões de cada situação, os formulários embutidos (motivo,
// data nova), a confirmação em dois passos do cancelamento, o painel de resultado (avisos por e-mail, cobrança, sessões) e o
// erro do servidor. O servidor decide as regras; aqui se prova que o painel envia o que deve e não envia o que não deve.

const permissoes = vi.hoisted(() => ({
  atuais: ['projetos'] as string[],
}))
vi.mock('@/lib/use-me', () => ({
  useMe: () => ({ data: { permissoes: permissoes.atuais }, isLoading: false }),
}))

const api = vi.hoisted(() => ({
  listarEventos: vi.fn(),
  alterarStatusDoEvento: vi.fn(),
  listarProjetos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  listarEspacos: vi.fn(),
  listarAssociados: vi.fn(),
  listarFotosDoEvento: vi.fn(),
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

const DIA = 86_400_000
// Instante relativo a "agora", no formato que o servidor devolve (UTC sem fuso).
const momento = (dias: number): string =>
  new Date(Date.now() + dias * DIA).toISOString().slice(0, 19)
// O mesmo instante como o campo de data e hora do navegador o mostra (hora local, sem fuso).
const noCampo = (dias: number): string => paraDataHoraLocalInput(momento(dias))

const MOTIVO = 'Chuva forte no dia'

const programado = () => evento({ data_hora_inicio: momento(10) })
const jaComecou = () => evento({ data_hora_inicio: momento(-2) })
// Evento que começa daqui a 10 dias, com a situação (e o que a acompanha) trocada.
const comSituacao = (sobrescrever: Partial<Evento>) =>
  evento({ data_hora_inicio: momento(10), ...sobrescrever })

function resposta(
  sobrescrever: Partial<ResultadoDaMudancaDeStatusDoEvento> = {},
): ResultadoDaMudancaDeStatusDoEvento {
  return {
    mensagem: 'Evento adiado.',
    evento: evento(),
    avisos: null,
    sessoes_deslocadas: 0,
    inscricoes_com_cobranca: 0,
    ...sobrescrever,
  }
}

function montar(e: Evento, podeAlterar = true) {
  const resultado = renderizar(
    <StatusDoEvento evento={e} podeAlterar={podeAlterar} />,
  )
  return { usuario: userEvent.setup(), ...resultado }
}

const botao = (nome: string) => screen.getByRole('button', { name: nome })
const nomesDosBotoes = () =>
  screen.queryAllByRole('button').map((b) => b.textContent)
const preencher = (rotulo: RegExp | string, valor: string) =>
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } })

beforeEach(() => {
  vi.clearAllMocks()
  permissoes.atuais = ['projetos']
  simularRedeSemResposta()
  URL.createObjectURL = vi.fn(() => 'blob:foto-de-teste')
  URL.revokeObjectURL = vi.fn()
  api.apiFetchBlob.mockResolvedValue({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    nomeSugerido: null,
  })
  api.listarEventos.mockResolvedValue([programado()])
  api.listarProjetos.mockResolvedValue([])
  api.listarOpcoesCatalogo.mockResolvedValue([])
  api.listarEspacos.mockResolvedValue([])
  api.listarAssociados.mockResolvedValue([])
  api.listarFotosDoEvento.mockResolvedValue([])
  documentos.listarDocumentos.mockResolvedValue([])
  api.alterarStatusDoEvento.mockResolvedValue(resposta())
})

// ---------------------------------------------------------------------------------------- o selo e os botões de cada situação
describe('o selo e os botões de cada situação', () => {
  it('Programado: Adiar, Cancelar evento, Remarcar e Marcar como realizado', () => {
    montar(programado())
    const secao = screen.getByRole('region', { name: 'Situação do evento' })
    expect(within(secao).getByText('Programado')).toBeInTheDocument()
    expect(nomesDosBotoes()).toEqual([
      'Adiar',
      'Cancelar evento',
      'Remarcar',
      'Marcar como realizado',
    ])
  })

  it('Adiado com a data original ainda no futuro: Voltar para a data original, Remarcar (definir nova data) e Cancelar evento', () => {
    montar(comSituacao({ status: 'Adiado', motivo_status: 'Obra no salão' }))
    expect(screen.getByText('Adiado')).toBeInTheDocument()
    expect(screen.getByText('Motivo: Obra no salão')).toBeInTheDocument()
    expect(nomesDosBotoes()).toEqual([
      'Voltar para a data original',
      'Remarcar (definir nova data)',
      'Cancelar evento',
    ])
    expect(screen.queryByText(/A data original já passou/)).toBeNull()
  })

  it('Adiado com a data original já passada: sem "Voltar para a data original", com a dica de definir uma nova data', () => {
    montar(
      evento({
        data_hora_inicio: momento(-3),
        status: 'Adiado',
        motivo_status: 'Obra no salão',
      }),
    )
    expect(nomesDosBotoes()).toEqual([
      'Remarcar (definir nova data)',
      'Cancelar evento',
    ])
    expect(
      screen.getByText('A data original já passou: defina uma nova data.'),
    ).toBeInTheDocument()
  })

  it('quem não gerencia eventos não vê a dica nem os botões do evento adiado', () => {
    montar(evento({ data_hora_inicio: momento(-3), status: 'Adiado' }), false)
    expect(nomesDosBotoes()).toEqual([])
    expect(screen.queryByText(/A data original já passou/)).toBeNull()
  })

  it('Cancelado: só Reativar o evento, e o motivo aparece', () => {
    montar(comSituacao({ status: 'Cancelado', motivo_status: MOTIVO }))
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    expect(screen.getByText(`Motivo: ${MOTIVO}`)).toBeInTheDocument()
    expect(nomesDosBotoes()).toEqual(['Reativar o evento'])
  })

  it('Realizado: nenhum botão, só o texto de que não volta atrás', () => {
    montar(comSituacao({ status: 'Realizado' }))
    expect(screen.getByText('Realizado')).toBeInTheDocument()
    expect(nomesDosBotoes()).toEqual([])
    expect(
      screen.getByText('Um evento realizado não volta atrás.'),
    ).toBeInTheDocument()
  })

  it('quem não gerencia eventos vê a situação, mas não os botões', () => {
    montar(comSituacao({ status: 'Cancelado', motivo_status: MOTIVO }), false)
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    expect(screen.getByText(`Motivo: ${MOTIVO}`)).toBeInTheDocument()
    expect(nomesDosBotoes()).toEqual([])
  })

  it('evento remarcado mostra a data anterior; evento que nunca foi remarcado, não', () => {
    const anterior = momento(3)
    const { unmount } = montar(
      evento({
        data_hora_inicio: momento(10),
        data_hora_inicio_anterior: anterior,
      }),
    )
    expect(
      screen.getByText(
        `Remarcado: a data anterior era ${formatarData(anterior, { comHora: true })}`,
      ),
    ).toBeInTheDocument()
    unmount()

    montar(programado())
    expect(screen.queryByText(/Remarcado:/)).not.toBeInTheDocument()
  })

  it('o motivo de uma situação Programado remarcada com motivo também aparece', () => {
    montar(
      evento({
        data_hora_inicio: momento(10),
        motivo_status: 'Mudamos para o sábado',
        data_hora_inicio_anterior: momento(3),
      }),
    )
    expect(
      screen.getByText('Motivo: Mudamos para o sábado'),
    ).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------- marcar como realizado
describe('Marcar como realizado', () => {
  it('fica desabilitado enquanto o evento não começou, com a dica "só depois do início"', () => {
    montar(programado())
    const b = botao('Marcar como realizado')
    expect(b).toBeDisabled()
    expect(b).toHaveAccessibleDescription(/só depois do início/)
  })

  it('depois do início fica habilitado, pede a confirmação e envia só { status: "Realizado" }', async () => {
    api.alterarStatusDoEvento.mockResolvedValue(
      resposta({ mensagem: 'Evento marcado como realizado.' }),
    )
    const { usuario } = montar(jaComecou())
    expect(botao('Marcar como realizado')).toBeEnabled()
    expect(screen.queryByText(/só depois do início/)).not.toBeInTheDocument()

    await usuario.click(botao('Marcar como realizado'))
    expect(
      screen.getByRole('form', { name: 'Marcar o evento como realizado' }),
    ).toBeInTheDocument()
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()

    await usuario.click(botao('Sim, marcar como realizado'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Realizado',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Evento marcado como realizado.',
    )
  })
})

// ---------------------------------------------------------------------------------------- adiar e cancelar exigem motivo
describe('Adiar e Cancelar exigem o motivo', () => {
  it('Adiar sem motivo, só com espaços ou com motivo curto NÃO envia e mostra o erro', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Adiar'))
    expect(
      screen.getByRole('form', { name: 'Adiar o evento' }),
    ).toBeInTheDocument()

    await usuario.click(botao('Confirmar adiamento'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Diga o motivo do adiamento: pelo menos 5 letras.',
    )

    await usuario.type(screen.getByLabelText(/^Motivo do adiamento/), '     ')
    await usuario.click(botao('Confirmar adiamento'))
    expect(screen.getByRole('alert')).toHaveTextContent(/motivo do adiamento/)

    await usuario.clear(screen.getByLabelText(/^Motivo do adiamento/))
    await usuario.type(screen.getByLabelText(/^Motivo do adiamento/), 'Chuv')
    await usuario.click(botao('Confirmar adiamento'))
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 5 letras/)

    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()
  })

  it('Adiar com motivo envia { status: "Adiado", motivo } (sem espaços nas pontas)', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Adiar'))
    await usuario.type(
      screen.getByLabelText(/^Motivo do adiamento/),
      '  Obra no salão  ',
    )
    await usuario.click(botao('Confirmar adiamento'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Adiado',
      motivo: 'Obra no salão',
    })
  })

  it('Cancelar sem motivo ou com motivo curto NÃO envia, nem chega à confirmação', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Cancelar evento'))

    await usuario.click(botao('Continuar'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Diga o motivo do cancelamento: pelo menos 5 letras.',
    )

    await usuario.type(screen.getByLabelText(/^Motivo do cancelamento/), 'Chuv')
    await usuario.click(botao('Continuar'))
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 5 letras/)

    expect(screen.queryByText(/Cancelar o evento\?/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sim, cancelar o evento' }),
    ).not.toBeInTheDocument()
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()
  })

  it('evento Público avisa que o motivo aparece no site; evento Interno, não', async () => {
    const { usuario, unmount } = montar(programado())
    await usuario.click(botao('Adiar'))
    expect(
      screen.getByText(
        'Em evento público, este motivo aparece na página do evento no site.',
      ),
    ).toBeInTheDocument()
    unmount()

    const outro = montar(
      evento({ data_hora_inicio: momento(10), visibilidade: 'Interna' }),
    )
    await outro.usuario.click(botao('Adiar'))
    expect(screen.queryByText(/aparece na página do evento/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------- cancelar em dois passos
describe('Cancelar o evento em dois passos', () => {
  it('só envia depois da confirmação, e então manda { status: "Cancelado", motivo }', async () => {
    api.alterarStatusDoEvento.mockResolvedValue(
      resposta({ mensagem: 'Evento cancelado.' }),
    )
    const { usuario } = montar(programado())
    await usuario.click(botao('Cancelar evento'))
    await usuario.type(screen.getByLabelText(/^Motivo do cancelamento/), MOTIVO)
    await usuario.click(botao('Continuar'))

    // passo 2: a pergunta aparece e NADA foi enviado ainda
    expect(
      screen.getByText(
        'Cancelar o evento? Quem está inscrito será avisado por e-mail.',
      ),
    ).toBeInTheDocument()
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()

    await usuario.click(botao('Sim, cancelar o evento'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Cancelado',
      motivo: MOTIVO,
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Evento cancelado.',
    )
    expect(
      screen.queryByRole('form', { name: 'Cancelar o evento' }),
    ).not.toBeInTheDocument()
  })

  it('"Voltar" na confirmação volta ao motivo (com o texto) sem cancelar nada', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Cancelar evento'))
    await usuario.type(screen.getByLabelText(/^Motivo do cancelamento/), MOTIVO)
    await usuario.click(botao('Continuar'))
    await usuario.click(botao('Voltar'))

    expect(screen.queryByText(/Cancelar o evento\?/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Motivo do cancelamento/)).toHaveValue(MOTIVO)
    expect(botao('Continuar')).toBeInTheDocument()
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()
  })

  it('o segundo passo não aceita mexer no motivo já confirmado', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Cancelar evento'))
    await usuario.type(screen.getByLabelText(/^Motivo do cancelamento/), MOTIVO)
    await usuario.click(botao('Continuar'))
    expect(screen.getByLabelText(/^Motivo do cancelamento/)).toHaveAttribute(
      'readonly',
    )
  })
})

// ---------------------------------------------------------------------------------------- remarcar
describe('Remarcar', () => {
  it('envia status Programado + a data nova em UTC (e o fim, se informado)', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Remarcar'))
    expect(
      screen.getByRole('form', { name: 'Remarcar o evento' }),
    ).toBeInTheDocument()
    const inicio = noCampo(20)
    const fim = noCampo(21)
    preencher(/^Nova data de início/, inicio)
    preencher(/^Novo fim/, fim)
    await usuario.click(botao('Confirmar nova data'))

    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Programado',
      nova_data_hora_inicio: new Date(inicio).toISOString(),
      nova_data_hora_fim: new Date(fim).toISOString(),
    })
  })

  it('sem fim e sem motivo não manda esses campos; com motivo opcional, manda', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Remarcar'))
    const inicio = noCampo(20)
    preencher(/^Nova data de início/, inicio)
    await usuario.click(botao('Confirmar nova data'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    const corpo = api.alterarStatusDoEvento.mock.calls[0]![1] as Record<
      string,
      unknown
    >
    expect(Object.keys(corpo).sort()).toEqual([
      'nova_data_hora_inicio',
      'status',
    ])

    await usuario.click(await screen.findByRole('button', { name: 'Remarcar' }))
    preencher(/^Nova data de início/, noCampo(25))
    await usuario.type(
      screen.getByLabelText(/^Motivo \(opcional\)/),
      'Mudamos para o sábado',
    )
    await usuario.click(botao('Confirmar nova data'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(2),
    )
    expect(api.alterarStatusDoEvento.mock.calls[1]![1]).toMatchObject({
      status: 'Programado',
      motivo: 'Mudamos para o sábado',
    })
  })

  it('recusa sem data, data no passado, igual à atual e fim antes do início - sem enviar nada', async () => {
    const { usuario } = montar(programado())
    await usuario.click(botao('Remarcar'))

    await usuario.click(botao('Confirmar nova data'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe a nova data de início do evento.',
    )

    preencher(/^Nova data de início/, noCampo(-1))
    await usuario.click(botao('Confirmar nova data'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A nova data precisa estar no futuro.',
    )

    preencher(
      /^Nova data de início/,
      paraDataHoraLocalInput(programado().data_hora_inicio),
    )
    await usuario.click(botao('Confirmar nova data'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A nova data é igual à atual: não há o que remarcar.',
    )

    preencher(/^Nova data de início/, noCampo(20))
    preencher(/^Novo fim/, noCampo(19))
    await usuario.click(botao('Confirmar nova data'))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'O fim do evento precisa ser depois do início.',
    )

    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()
  })

  it('evento adiado: "Remarcar (definir nova data)" volta a Programado com a data nova', async () => {
    const { usuario } = montar(
      comSituacao({ status: 'Adiado', motivo_status: 'Obra no salão' }),
    )
    await usuario.click(botao('Remarcar (definir nova data)'))
    const inicio = noCampo(40)
    preencher(/^Nova data de início/, inicio)
    await usuario.click(botao('Confirmar nova data'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Programado',
      nova_data_hora_inicio: new Date(inicio).toISOString(),
    })
  })

  it('evento adiado pode escolher a MESMA data de antes: não recusa e manda o começo exato de antes (com os segundos)', async () => {
    // o servidor trata data igual à atual, em evento adiado, como a retomada na mesma data - mas só se for IGUAL ao instante;
    // o campo só tem minutos, então vai o valor original, não o truncado
    const original = momento(10)
    const { usuario } = montar(
      evento({
        data_hora_inicio: original,
        status: 'Adiado',
        motivo_status: 'Obra no salão',
      }),
    )
    await usuario.click(botao('Remarcar (definir nova data)'))
    preencher(/^Nova data de início/, paraDataHoraLocalInput(original))
    await usuario.click(botao('Confirmar nova data'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Programado',
      nova_data_hora_inicio: `${original}Z`,
    })
  })

  it('o campo "Novo fim" explica que a duração é mantida só quando o evento tem fim', async () => {
    const { usuario, unmount } = montar(
      evento({ data_hora_inicio: momento(10), data_hora_fim: momento(10.1) }),
    )
    await usuario.click(botao('Remarcar'))
    expect(
      screen.getByText('Em branco: o evento mantém a mesma duração.'),
    ).toBeInTheDocument()
    unmount()

    const outro = montar(programado())
    await outro.usuario.click(botao('Remarcar'))
    expect(screen.queryByText(/mantém a mesma duração/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------- voltar para a data original
describe('Voltar para a data original (evento adiado)', () => {
  const adiado = () =>
    comSituacao({ status: 'Adiado', motivo_status: 'Obra no salão' })

  it('abre a confirmação com a data de volta, não envia antes de confirmar e então manda só { status: "Programado" }', async () => {
    api.alterarStatusDoEvento.mockResolvedValue(
      resposta({ mensagem: 'Evento programado.' }),
    )
    const e = adiado()
    const { usuario } = montar(e)
    await usuario.click(botao('Voltar para a data original'))
    expect(
      screen.getByRole('form', { name: 'Voltar para a data original' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        `O evento volta a ser programado para ${formatarData(e.data_hora_inicio, { comHora: true })}. Quem está inscrito será avisado por e-mail.`,
      ),
    ).toBeInTheDocument()
    // não pede data nem motivo: é a mesma data
    expect(screen.queryByLabelText(/^Nova data de início/)).toBeNull()
    expect(screen.queryByLabelText(/^Motivo/)).toBeNull()
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()

    await usuario.click(botao('Confirmar volta à data original'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Programado',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Evento programado.',
    )
    expect(
      screen.queryByRole('form', { name: 'Voltar para a data original' }),
    ).not.toBeInTheDocument()
  })

  it('"Voltar" fecha o formulário sem enviar nada', async () => {
    const { usuario } = montar(adiado())
    await usuario.click(botao('Voltar para a data original'))
    await usuario.click(botao('Voltar'))
    expect(
      screen.queryByRole('form', { name: 'Voltar para a data original' }),
    ).not.toBeInTheDocument()
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()
  })

  it('o que o servidor recusar aparece no formulário (ex.: a data já passou entre abrir e confirmar)', async () => {
    api.alterarStatusDoEvento.mockRejectedValue(
      new ApiError(422, 'A data do evento já passou: informe a nova data.'),
    )
    const { usuario } = montar(adiado())
    await usuario.click(botao('Voltar para a data original'))
    await usuario.click(botao('Confirmar volta à data original'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A data do evento já passou: informe a nova data.',
    )
    expect(
      screen.getByRole('form', { name: 'Voltar para a data original' }),
    ).toBeInTheDocument()
  })

  it('o evento Programado e o Cancelado não têm essa opção', () => {
    const { unmount } = montar(programado())
    expect(
      screen.queryByRole('button', { name: 'Voltar para a data original' }),
    ).toBeNull()
    unmount()
    montar(comSituacao({ status: 'Cancelado', motivo_status: MOTIVO }))
    expect(
      screen.queryByRole('button', { name: 'Voltar para a data original' }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------- reativar
describe('Reativar o evento cancelado', () => {
  it('se a data já passou, o formulário pede a data nova e não envia sem ela', async () => {
    const { usuario } = montar(
      evento({
        data_hora_inicio: momento(-5),
        status: 'Cancelado',
        motivo_status: MOTIVO,
      }),
    )
    await usuario.click(botao('Reativar o evento'))
    expect(
      screen.getByRole('form', { name: 'Reativar o evento' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/A data deste evento já passou: informe a nova data/),
    ).toBeInTheDocument()

    await usuario.click(botao('Confirmar reativação'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe a nova data de início do evento.',
    )
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()

    const inicio = noCampo(30)
    preencher(/^Nova data de início/, inicio)
    await usuario.click(botao('Confirmar reativação'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Programado',
      nova_data_hora_inicio: new Date(inicio).toISOString(),
    })
  })

  it('se a data ainda não passou, não pede data: volta na mesma data, só { status: "Programado" }', async () => {
    const futuro = momento(10)
    const { usuario } = montar(
      evento({
        data_hora_inicio: futuro,
        status: 'Cancelado',
        motivo_status: MOTIVO,
      }),
    )
    await usuario.click(botao('Reativar o evento'))
    expect(screen.queryByLabelText(/^Nova data de início/)).toBeNull()
    expect(
      screen.getByText(
        `O evento volta a ser programado para ${formatarData(futuro, { comHora: true })}. Quem está inscrito será avisado por e-mail.`,
      ),
    ).toBeInTheDocument()

    await usuario.click(botao('Confirmar reativação'))
    await waitFor(() =>
      expect(api.alterarStatusDoEvento).toHaveBeenCalledTimes(1),
    )
    expect(api.alterarStatusDoEvento).toHaveBeenCalledWith(12, {
      status: 'Programado',
    })
  })

  it('reativar com data nova recusa data no passado', async () => {
    const { usuario } = montar(
      evento({
        data_hora_inicio: momento(-5),
        status: 'Cancelado',
        motivo_status: MOTIVO,
      }),
    )
    await usuario.click(botao('Reativar o evento'))
    preencher(/^Nova data de início/, noCampo(-1))
    await usuario.click(botao('Confirmar reativação'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A nova data precisa estar no futuro.',
    )
    expect(api.alterarStatusDoEvento).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------------------- o painel de resultado
describe('o painel de resultado depois de mudar a situação', () => {
  async function adiarEVer(resultado: ResultadoDaMudancaDeStatusDoEvento) {
    api.alterarStatusDoEvento.mockResolvedValue(resultado)
    const { usuario } = montar(programado())
    await usuario.click(botao('Adiar'))
    await usuario.type(screen.getByLabelText(/^Motivo do adiamento/), MOTIVO)
    await usuario.click(botao('Confirmar adiamento'))
    return within(await screen.findByRole('status'))
  }

  it('mostra a mensagem, os e-mails que saíram, os sem e-mail, a programação e a cobrança', async () => {
    const painel = await adiarEVer(
      resposta({
        mensagem: 'Evento cancelado.',
        avisos: {
          inscricoes_a_avisar: 4,
          avisos_enviados: 2,
          inscritos_sem_email: 1,
          enderecos: 3,
        },
        sessoes_deslocadas: 2,
        inscricoes_com_cobranca: 3,
      }),
    )
    expect(painel.getByText('Evento cancelado.')).toBeInTheDocument()
    expect(
      painel.getByText('Aviso por e-mail: 2 de 3 endereço(s) avisado(s).'),
    ).toBeInTheDocument()
    expect(
      painel.getByText(
        'Alguns e-mails não saíram: avise essas pessoas por outro meio.',
      ),
    ).toBeInTheDocument()
    expect(
      painel.getByText('1 inscrição(ões) sem e-mail cadastrado.'),
    ).toBeInTheDocument()
    expect(
      painel.getByText('A programação (2 sessão(ões)) acompanhou a nova data.'),
    ).toBeInTheDocument()
    expect(
      painel.getByText(
        'Há 3 inscrição(ões) paga(s) neste evento. Quem desistir pelo link do e-mail recebe o valor inteiro de volta; para os demais, confira o Financeiro.',
      ),
    ).toBeInTheDocument()
  })

  it('todos os e-mails saíram: não há o aviso de "alguns não saíram"', async () => {
    const painel = await adiarEVer(
      resposta({
        avisos: {
          inscricoes_a_avisar: 3,
          avisos_enviados: 3,
          inscritos_sem_email: 0,
          enderecos: 3,
        },
      }),
    )
    expect(
      painel.getByText('Aviso por e-mail: 3 de 3 endereço(s) avisado(s).'),
    ).toBeInTheDocument()
    expect(painel.queryByText(/Alguns e-mails não saíram/)).toBeNull()
    expect(painel.queryByText(/sem e-mail cadastrado/)).toBeNull()
    expect(painel.queryByText(/acompanhou a nova data/)).toBeNull()
    expect(painel.queryByText(/paga\(s\)/)).toBeNull()
  })

  it('ninguém inscrito (ou sem aviso, como ao marcar realizado): não fala de e-mail', async () => {
    const painel = await adiarEVer(
      resposta({
        avisos: {
          inscricoes_a_avisar: 0,
          avisos_enviados: 0,
          inscritos_sem_email: 0,
          enderecos: 0,
        },
      }),
    )
    expect(painel.getByText('Evento adiado.')).toBeInTheDocument()
    expect(painel.queryByText(/Aviso por e-mail/)).toBeNull()
  })

  it('o formulário fecha e o resultado pode ser fechado', async () => {
    const painel = await adiarEVer(resposta())
    expect(
      screen.queryByRole('form', { name: 'Adiar o evento' }),
    ).not.toBeInTheDocument()
    await userEvent.click(painel.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------- erro do servidor
describe('o que o servidor recusar aparece no formulário', () => {
  it('422 com detail em português aparece em role=alert e o formulário continua aberto, com o texto', async () => {
    api.alterarStatusDoEvento.mockRejectedValue(
      new ApiError(
        422,
        'O motivo não pode ter e-mail, CPF ou telefone: ele aparece no site.',
      ),
    )
    const { usuario } = montar(programado())
    await usuario.click(botao('Adiar'))
    await usuario.type(
      screen.getByLabelText(/^Motivo do adiamento/),
      'Ligue para 91 99999-0000',
    )
    await usuario.click(botao('Confirmar adiamento'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O motivo não pode ter e-mail, CPF ou telefone: ele aparece no site.',
    )
    expect(
      screen.getByRole('form', { name: 'Adiar o evento' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/^Motivo do adiamento/)).toHaveValue(
      'Ligue para 91 99999-0000',
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('erro ao confirmar o cancelamento volta ao motivo e mostra o erro', async () => {
    api.alterarStatusDoEvento.mockRejectedValue(
      new ApiError(400, 'Um evento realizado não volta atrás.'),
    )
    const { usuario } = montar(programado())
    await usuario.click(botao('Cancelar evento'))
    await usuario.type(screen.getByLabelText(/^Motivo do cancelamento/), MOTIVO)
    await usuario.click(botao('Continuar'))
    await usuario.click(botao('Sim, cancelar o evento'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Um evento realizado não volta atrás.',
    )
    expect(screen.queryByText(/Cancelar o evento\?/)).not.toBeInTheDocument()
    expect(botao('Continuar')).toBeInTheDocument()
  })

  it('falha sem motivo do servidor (rede) vira texto padrão em português', async () => {
    api.alterarStatusDoEvento.mockRejectedValue(
      new TypeError('Failed to fetch'),
    )
    const { usuario } = montar(jaComecou())
    await usuario.click(botao('Marcar como realizado'))
    await usuario.click(botao('Sim, marcar como realizado'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível mudar a situação do evento. Tente de novo.',
    )
  })
})

// ---------------------------------------------------------------------------------------- acessibilidade
describe('acessibilidade', () => {
  it('a seção com o formulário de remarcar e a confirmação do cancelamento não têm violação', async () => {
    const { usuario, container } = montar(programado())
    await usuario.click(botao('Remarcar'))
    expect(await axe(container)).toHaveNoViolations()

    await usuario.click(botao('Cancelar evento'))
    await usuario.type(screen.getByLabelText(/^Motivo do cancelamento/), MOTIVO)
    await usuario.click(botao('Continuar'))
    expect(await axe(container)).toHaveNoViolations()
  })

  it('o resultado e os selos não têm violação', async () => {
    api.alterarStatusDoEvento.mockResolvedValue(
      resposta({
        avisos: {
          inscricoes_a_avisar: 2,
          avisos_enviados: 1,
          inscritos_sem_email: 1,
          enderecos: 2,
        },
      }),
    )
    const { usuario, container } = montar(programado())
    await usuario.click(botao('Adiar'))
    await usuario.type(screen.getByLabelText(/^Motivo do adiamento/), MOTIVO)
    await usuario.click(botao('Confirmar adiamento'))
    await screen.findByRole('status')
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ---------------------------------------------------------------------------------------- a página de Eventos
describe('na página de Eventos', () => {
  it('a lista mostra o selo de quem não está Programado (com o texto); Programado não ganha selo', async () => {
    api.listarEventos.mockResolvedValue([
      evento({
        id_evento: 12,
        titulo: 'Evento em dia',
        data_hora_inicio: momento(10),
      }),
      evento({
        id_evento: 13,
        titulo: 'Evento cancelado',
        status: 'Cancelado',
      }),
      evento({ id_evento: 14, titulo: 'Evento adiado', status: 'Adiado' }),
      evento({ id_evento: 15, titulo: 'Evento feito', status: 'Realizado' }),
    ])
    renderizar(<EventosPage />)
    const linha = async (titulo: string) =>
      within(
        (await screen.findByText(titulo)).closest(
          '[role="button"]',
        ) as HTMLElement,
      )
    expect(
      (await linha('Evento cancelado')).getByText('Cancelado'),
    ).toBeVisible()
    expect((await linha('Evento adiado')).getByText('Adiado')).toBeVisible()
    expect((await linha('Evento feito')).getByText('Realizado')).toBeVisible()
    // o texto do selo aparece junto da visibilidade
    expect((await linha('Evento cancelado')).getByText('Pública')).toBeVisible()
    expect((await linha('Evento em dia')).queryByText('Programado')).toBeNull()
  })

  it('o detalhe do evento traz a situação e os botões; quem não gerencia eventos só vê o selo', async () => {
    api.listarEventos.mockResolvedValue([
      evento({ status: 'Cancelado', motivo_status: MOTIVO }),
    ])
    const { unmount } = renderizar(<EventosPage />, '/eventos?evento=12')
    const secao = within(
      await screen.findByRole('region', { name: 'Situação do evento' }),
    )
    expect(secao.getByText('Cancelado')).toBeInTheDocument()
    expect(secao.getByText(`Motivo: ${MOTIVO}`)).toBeInTheDocument()
    expect(
      secao.getByRole('button', { name: 'Reativar o evento' }),
    ).toBeInTheDocument()
    unmount()

    permissoes.atuais = ['documentos']
    renderizar(<EventosPage />, '/eventos?evento=12')
    const secaoSemPermissao = within(
      await screen.findByRole('region', { name: 'Situação do evento' }),
    )
    expect(secaoSemPermissao.getByText('Cancelado')).toBeInTheDocument()
    expect(
      secaoSemPermissao.queryByRole('button', { name: 'Reativar o evento' }),
    ).toBeNull()
  })

  it('depois de mudar a situação, o selo da lista e o do detalhe atualizam sem recarregar a página', async () => {
    const usuario = userEvent.setup()
    const antes = evento({ data_hora_inicio: momento(10) })
    api.listarEventos.mockResolvedValue([antes])
    renderizar(<EventosPage />, '/eventos?evento=12')

    const secao = await screen.findByRole('region', {
      name: 'Situação do evento',
    })
    expect(within(secao).getByText('Programado')).toBeInTheDocument()
    await usuario.click(within(secao).getByRole('button', { name: 'Adiar' }))
    await usuario.type(screen.getByLabelText(/^Motivo do adiamento/), MOTIVO)

    // o servidor passa a devolver o evento adiado
    api.listarEventos.mockResolvedValue([
      { ...antes, status: 'Adiado', motivo_status: MOTIVO },
    ])
    await usuario.click(
      within(secao).getByRole('button', { name: 'Confirmar adiamento' }),
    )

    await waitFor(() =>
      expect(within(secao).getByText('Adiado')).toBeInTheDocument(),
    )
    expect(within(secao).getByText(`Motivo: ${MOTIVO}`)).toBeInTheDocument()
    // e a linha da lista ganhou o selo
    // (o título aparece na lista e no detalhe: a linha é a que tem role="button")
    const linha = screen
      .getAllByText('Despertai 2026')
      .map((t) => t.closest('[role="button"]'))
      .find((l) => l !== null) as HTMLElement
    expect(within(linha).getByText('Adiado')).toBeVisible()
    expect(api.listarEventos.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(
      within(secao).getByRole('button', {
        name: 'Remarcar (definir nova data)',
      }),
    ).toBeInTheDocument()
  })
})
