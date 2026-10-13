// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../src/lib/api'
import {
  acoesDisponiveis,
  caminhoDeCancelar,
  caminhoDeConfirmar,
  explicacaoDaSituacao,
  falhaDaConsulta,
  iniciarPaginaDeInscricao,
  lerResumo,
  lerToken,
  MENSAGEM_DE_LINK_INVALIDO,
  mensagemDaConsulta,
  mensagemDeFalhaDaAcao,
  perguntaDoCancelamento,
  prazoEmPalavras,
  quandoDoEvento,
  rotuloDaAcaoCruzada,
  situacaoDoLink,
  valorEmReais,
  type ModoDoLink,
  type ResumoDaInscricao,
} from '../src/lib/inscricao-link'

const TOKEN = 'tok-abc_123-XYZ'

const resumo = (extra: Partial<ResumoDaInscricao> = {}): ResumoDaInscricao => ({
  status: 'Pré-inscrito',
  primeiro_nome: 'Maria',
  evento: {
    titulo: 'Encontro de teste',
    data_hora_inicio: '2026-10-10T19:00:00',
    data_hora_fim: '2026-10-10T21:00:00',
    endereco_avulso: 'Salão de teste, Parauapebas',
  },
  sessao: null,
  codigo_checkin: 'A1B2C3D4',
  prazo_confirmacao: null,
  evento_encerrado: false,
  pode_cancelar: true,
  pode_confirmar: true,
  ...extra,
})

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('o código do endereço', () => {
  it('sem ?token= (ou em branco) a página diz que falta o link; com lixo, que o link não vale', () => {
    expect(lerToken('')).toEqual({ estado: 'ausente' })
    expect(lerToken('?outro=1')).toEqual({ estado: 'ausente' })
    expect(lerToken('?token=')).toEqual({ estado: 'ausente' })
    expect(lerToken('?token=%20%20')).toEqual({ estado: 'ausente' })
    for (const ruim of [
      'curto',
      '../../x',
      'a/b/c/d/e/f',
      'a b c d e f g h',
      'x'.repeat(200),
    ]) {
      expect(lerToken(`?token=${encodeURIComponent(ruim)}`), ruim).toEqual({
        estado: 'invalido',
      })
    }
  })

  it('código no formato do sistema (letras, números, "-" e "_") é aceito, com ou sem outros parâmetros', () => {
    expect(lerToken(`?token=${TOKEN}`)).toEqual({ estado: 'ok', token: TOKEN })
    expect(lerToken(`?utm=1&token=${TOKEN}`)).toEqual({
      estado: 'ok',
      token: TOKEN,
    })
  })

  it('os endereços das duas páginas levam o código na query', () => {
    expect(caminhoDeCancelar(TOKEN)).toBe(`/cancelar-inscricao/?token=${TOKEN}`)
    expect(caminhoDeConfirmar(TOKEN)).toBe(
      `/confirmar-inscricao/?token=${TOKEN}`,
    )
  })
})

describe('o que a API devolveu', () => {
  it('lê o resumo; sem a situação (resposta torta) não é um resumo', () => {
    expect(
      lerResumo({
        status: 'Confirmado',
        primeiro_nome: 'Maria',
        evento: {
          titulo: 'Encontro',
          data_hora_inicio: '2026-10-10T19:00:00',
          data_hora_fim: null,
          endereco_avulso: null,
        },
        sessao: { titulo: 'Oficina', data_hora_inicio: '2026-10-10T20:00:00' },
        codigo_checkin: 'AA',
        prazo_confirmacao: null,
        evento_encerrado: false,
        pode_cancelar: true,
        pode_confirmar: false,
      }),
    ).toEqual({
      status: 'Confirmado',
      primeiro_nome: 'Maria',
      evento: {
        titulo: 'Encontro',
        data_hora_inicio: '2026-10-10T19:00:00',
        data_hora_fim: null,
        endereco_avulso: null,
      },
      sessao: { titulo: 'Oficina', data_hora_inicio: '2026-10-10T20:00:00' },
      codigo_checkin: 'AA',
      prazo_confirmacao: null,
      evento_encerrado: false,
      pode_cancelar: true,
      pode_confirmar: false,
    })
    expect(lerResumo(null)).toBeNull()
    expect(lerResumo('x')).toBeNull()
    expect(lerResumo({ primeiro_nome: 'Maria' })).toBeNull()
    // o que não vem vira "não pode": nunca se oferece uma ação por engano
    expect(lerResumo({ status: 'Confirmado' })).toMatchObject({
      pode_cancelar: false,
      pode_confirmar: false,
      evento_encerrado: false,
      evento: { titulo: null },
      sessao: null,
    })
  })

  it('a situação, o quando e o prazo em palavras simples (horário de Parauapebas/Belém)', () => {
    expect(situacaoDoLink('Pré-inscrito')).toBe('Vaga reservada')
    expect(situacaoDoLink('Confirmado')).toBe('Vaga confirmada')
    expect(situacaoDoLink('Lista de Espera')).toBe('Na lista de espera')
    expect(situacaoDoLink('Cancelado')).toBe('Inscrição cancelada')
    expect(situacaoDoLink('Presente')).toBe('Presença registrada')
    expect(situacaoDoLink('Ausente')).toBe('Ausência registrada')
    expect(situacaoDoLink('Outra')).toBe('Outra')
    expect(quandoDoEvento('2026-10-10T19:00:00')).toBe(
      'sábado, 10 de outubro de 2026, às 19:00',
    )
    expect(quandoDoEvento(null)).toBeNull()
    // o prazo chega em UTC sem fuso: 14:30 UTC são 11:30 em Belém
    expect(prazoEmPalavras('2026-10-10T14:30:00')).toBe(
      '10/10/2026 11:30 (horário de Belém)',
    )
    expect(prazoEmPalavras('2026-10-10T14:30:00.123456')).toBe(
      '10/10/2026 11:30 (horário de Belém)',
    )
    expect(prazoEmPalavras(null)).toBeNull()
  })

  it('o valor a devolver chega como número ou como texto', () => {
    expect(valorEmReais(50)).toMatch(/^R\$\s50,00$/)
    expect(valorEmReais('50.00')).toMatch(/^R\$\s50,00$/)
    expect(valorEmReais(1234.5)).toMatch(/^R\$\s1\.234,50$/)
    expect(valorEmReais(null)).toBeNull()
    expect(valorEmReais('abc')).toBeNull()
  })
})

describe('o que a página oferece em cada situação', () => {
  const cancelar: ModoDoLink = 'cancelar'
  const confirmar: ModoDoLink = 'confirmar'

  it('cancelada, evento que já aconteceu e situação que não muda: explicação, sem botão', () => {
    expect(
      explicacaoDaSituacao(
        resumo({
          status: 'Cancelado',
          pode_cancelar: false,
          pode_confirmar: false,
        }),
        cancelar,
      ),
    ).toBe('Esta inscrição já foi cancelada.')
    expect(
      explicacaoDaSituacao(
        resumo({
          status: 'Cancelado',
          pode_cancelar: false,
          pode_confirmar: false,
        }),
        confirmar,
      ),
    ).toBe('Esta inscrição foi cancelada: não há o que confirmar.')
    expect(
      explicacaoDaSituacao(
        resumo({
          evento_encerrado: true,
          pode_cancelar: false,
          pode_confirmar: false,
        }),
        cancelar,
      ),
    ).toContain('já aconteceu')
    expect(
      explicacaoDaSituacao(
        resumo({
          evento_encerrado: true,
          pode_cancelar: false,
          pode_confirmar: false,
        }),
        confirmar,
      ),
    ).toContain('já aconteceu')
    expect(
      explicacaoDaSituacao(
        resumo({
          status: 'Presente',
          pode_cancelar: false,
          pode_confirmar: false,
        }),
        cancelar,
      ),
    ).toContain('Fale com a secretaria')
  })

  it('lista de espera: na página de confirmar, a frase da fila; na de cancelar, nada a explicar (há o botão)', () => {
    const fila = resumo({
      status: 'Lista de Espera',
      codigo_checkin: null,
      pode_confirmar: false,
    })
    expect(explicacaoDaSituacao(fila, confirmar)).toBe(
      'Você ainda está na lista de espera; avisamos por e-mail quando uma vaga abrir.',
    )
    expect(explicacaoDaSituacao(fila, cancelar)).toBeNull()
  })

  it('confirmada: a página de confirmar diz que a vaga está confirmada; vaga reservada: nada a explicar', () => {
    const confirmada = resumo({ status: 'Confirmado', pode_confirmar: false })
    expect(explicacaoDaSituacao(confirmada, confirmar)).toBe(
      'A sua vaga está confirmada.',
    )
    expect(explicacaoDaSituacao(confirmada, cancelar)).toBeNull()
    expect(explicacaoDaSituacao(resumo(), confirmar)).toBeNull()
    expect(explicacaoDaSituacao(resumo(), cancelar)).toBeNull()
  })

  it('cada página tem o seu botão e o caminho para a outra só quando faz sentido', () => {
    // cancelar: o botão aparece se pode cancelar; o caminho para confirmar só para quem foi chamado da fila (tem prazo)
    expect(acoesDisponiveis(resumo(), cancelar)).toEqual({
      principal: true,
      cruzada: null,
    })
    expect(
      acoesDisponiveis(
        resumo({ prazo_confirmacao: '2026-10-10T14:30:00' }),
        cancelar,
      ),
    ).toEqual({ principal: true, cruzada: 'confirmar' })
    expect(
      acoesDisponiveis(resumo({ pode_cancelar: false }), cancelar),
    ).toEqual({ principal: false, cruzada: null })
    // confirmar: o botão aparece se pode confirmar; o caminho para cancelar, se pode cancelar
    expect(acoesDisponiveis(resumo(), confirmar)).toEqual({
      principal: true,
      cruzada: 'cancelar',
    })
    expect(
      acoesDisponiveis(
        resumo({ status: 'Lista de Espera', pode_confirmar: false }),
        confirmar,
      ),
    ).toEqual({ principal: false, cruzada: 'cancelar' })
    expect(
      acoesDisponiveis(
        resumo({
          status: 'Cancelado',
          pode_cancelar: false,
          pode_confirmar: false,
        }),
        confirmar,
      ),
    ).toEqual({ principal: false, cruzada: null })
  })

  it('a etapa antes de cancelar diz o que se perde; os links cruzados dizem o que fazem', () => {
    expect(perguntaDoCancelamento(resumo())).toBe(
      'Tem certeza? Você perde a vaga.',
    )
    expect(perguntaDoCancelamento(resumo({ status: 'Lista de Espera' }))).toBe(
      'Tem certeza? Você sai da lista de espera.',
    )
    expect(rotuloDaAcaoCruzada('confirmar', resumo())).toContain('confirmar')
    expect(rotuloDaAcaoCruzada('cancelar', resumo())).toBe(
      'Não vou poder ir: cancelar a minha inscrição',
    )
    expect(
      rotuloDaAcaoCruzada('cancelar', resumo({ status: 'Lista de Espera' })),
    ).toBe('Cancelar a minha inscrição')
  })
})

describe('mensagens de falha', () => {
  it('consulta: código que não existe, limite de consultas e o resto', () => {
    expect(falhaDaConsulta(new ApiError('x', 404))).toBe('invalido')
    expect(falhaDaConsulta(new ApiError('x', 429))).toBe('limite')
    expect(falhaDaConsulta(new ApiError('x', 500))).toBe('rede')
    expect(falhaDaConsulta(new ApiError('x'))).toBe('rede')
    expect(mensagemDaConsulta('invalido')).toBe(MENSAGEM_DE_LINK_INVALIDO)
    expect(MENSAGEM_DE_LINK_INVALIDO).toBe(
      'Esse link não é válido: confira o endereço que veio no e-mail.',
    )
    expect(mensagemDaConsulta('limite')).toContain('Aguarde alguns minutos')
    expect(mensagemDaConsulta('rede')).toContain(
      'Tente de novo em alguns instantes',
    )
  })

  it('cancelar/confirmar: o motivo da API quando há; erro de servidor e rede com orientação', () => {
    expect(mensagemDeFalhaDaAcao(new ApiError('x', 404), 'cancelar')).toBe(
      MENSAGEM_DE_LINK_INVALIDO,
    )
    expect(
      mensagemDeFalhaDaAcao(
        new ApiError(
          'x',
          400,
          'Você ainda está na lista de espera: avisamos por e-mail quando uma vaga abrir.',
        ),
        'confirmar',
      ),
    ).toBe(
      'Você ainda está na lista de espera: avisamos por e-mail quando uma vaga abrir.',
    )
    expect(
      mensagemDeFalhaDaAcao(
        new ApiError(
          'x',
          429,
          'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.',
        ),
        'cancelar',
      ),
    ).toContain('Muitas tentativas')
    expect(mensagemDeFalhaDaAcao(new ApiError('x', 429), 'cancelar')).toContain(
      'Aguarde alguns minutos',
    )
    expect(
      mensagemDeFalhaDaAcao(
        new ApiError('x', 500, 'Internal Server Error'),
        'cancelar',
      ),
    ).toBe(
      'Não foi possível cancelar agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.',
    )
    expect(mensagemDeFalhaDaAcao(new ApiError('x'), 'confirmar')).toContain(
      'Não foi possível confirmar agora',
    )
    expect(mensagemDeFalhaDaAcao(new Error('x'), 'confirmar')).toContain(
      'Não foi possível confirmar agora',
    )
  })
})

/* ---------------------------------------------------------------------------------------------------------------------------- */
/* A página no navegador (jsdom): o mesmo contrato de HTML que `GerenciarInscricao.astro` produz                                  */
/* ---------------------------------------------------------------------------------------------------------------------------- */

function montar(modo: ModoDoLink): HTMLElement {
  const linha = (nome: string, interior: string) =>
    `<div data-linha><dt>${nome}</dt><dd ${interior}></dd></div>`
  document.body.innerHTML = `
    <div data-inscricao-link data-modo="${modo}" data-api-url="https://api.teste">
      <p data-estado="carregando">Buscando…</p>
      <div data-estado="sem-token" hidden>sem token</div>
      <div data-estado="invalido" hidden>inválido</div>
      <div data-estado="erro" hidden><p data-mensagem></p><button type="button" data-tentar-de-novo>Tentar de novo</button></div>
      <div data-estado="resumo" hidden>
        <div data-resultado-da-acao role="status" tabindex="-1" hidden><div data-frases></div></div>
        <dl>
          ${linha('Evento', 'data-evento-titulo')}${linha('Quando', 'data-quando')}${linha('Onde', 'data-onde')}
          ${linha('Sessão', 'data-sessao')}${linha('Inscrição de', 'data-inscrito')}${linha('Situação', 'data-situacao')}
          ${linha('Código', 'data-codigo')}${linha('Confirme até', 'data-prazo')}
        </dl>
        <p data-explicacao hidden></p>
        <div data-acoes>
          ${
            modo === 'cancelar'
              ? `<button type="button" data-cancelar>Cancelar a minha inscrição</button>
                 <div data-passo-de-confirmacao hidden>
                   <p data-pergunta-do-cancelamento></p>
                   <button type="button" data-confirmar-cancelamento>Sim, cancelar a minha inscrição</button>
                   <button type="button" data-voltar>Não, voltar</button>
                 </div>`
              : '<button type="button" data-confirmar>Confirmar a minha vaga</button>'
          }
          <a data-acao-cruzada hidden href="/"></a>
          <p data-falha-da-acao role="alert" tabindex="-1" hidden></p>
        </div>
      </div>
    </div>`
  return document.querySelector<HTMLElement>('[data-inscricao-link]')!
}

const estadoVisivel = () =>
  [...document.querySelectorAll<HTMLElement>('[data-estado]')]
    .filter((e) => !e.hidden)
    .map((e) => e.dataset.estado)
const el = <T extends HTMLElement = HTMLElement>(seletor: string) =>
  document.querySelector<T>(seletor)!
const esperar = () => new Promise((r) => setTimeout(r, 0))
const esperarVarias = async (n = 5) => {
  for (let i = 0; i < n; i++) await esperar()
}
const aberto = (seletor: string) => !el(seletor).hidden

function abrir(
  modo: ModoDoLink,
  fetchImpl: ReturnType<typeof vi.fn>,
  busca = `?token=${TOKEN}`,
) {
  const raiz = montar(modo)
  iniciarPaginaDeInscricao(raiz, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    busca,
    esperaEntreTentativasMs: 0,
  })
  return raiz
}

describe('a página dos links do e-mail', () => {
  it('sem código no endereço: diz que falta o link e NÃO chama a API', () => {
    const fetchImpl = vi.fn()
    abrir('cancelar', fetchImpl, '')
    expect(estadoVisivel()).toEqual(['sem-token'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('código torto: link inválido, sem chamar a API (nada estranho vai para o caminho da API)', () => {
    const fetchImpl = vi.fn()
    abrir('cancelar', fetchImpl, '?token=../../admin')
    expect(estadoVisivel()).toEqual(['invalido'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('consulta a inscrição pelo código e mostra o evento (dia e hora de Parauapebas), o local, o primeiro nome e a situação', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta(
        resumo({
          sessao: {
            titulo: 'Oficina da manhã',
            data_hora_inicio: '2026-10-10T09:00:00',
          },
        }),
      ),
    )
    abrir('cancelar', fetchImpl)
    expect(estadoVisivel()).toEqual(['carregando'])
    await esperarVarias()
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      `https://api.teste/api/publico/inscricoes/${TOKEN}`,
    )
    expect(estadoVisivel()).toEqual(['resumo'])
    expect(el('[data-evento-titulo]').textContent).toBe('Encontro de teste')
    expect(el('[data-quando]').textContent).toBe(
      'sábado, 10 de outubro de 2026, às 19:00',
    )
    expect(el('[data-onde]').textContent).toBe('Salão de teste, Parauapebas')
    expect(el('[data-sessao]').textContent).toBe(
      'Oficina da manhã, sábado, 10 de outubro de 2026, às 09:00',
    )
    expect(el('[data-inscrito]').textContent).toBe('Maria')
    expect(el('[data-situacao]').textContent).toBe('Vaga reservada')
    expect(el('[data-codigo]').textContent).toBe('A1B2C3D4')
    // sem prazo, a linha do prazo não aparece
    expect(
      el('[data-prazo]').closest<HTMLElement>('[data-linha]')!.hidden,
    ).toBe(true)
  })

  it('linha sem valor some (sem sessão, sem local, sem código): nada de "null" na tela', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta(
        resumo({
          status: 'Lista de Espera',
          codigo_checkin: null,
          evento: {
            titulo: 'Encontro',
            data_hora_inicio: '2026-10-10T19:00:00',
            data_hora_fim: null,
            endereco_avulso: null,
          },
        }),
      ),
    )
    abrir('cancelar', fetchImpl)
    await esperarVarias()
    for (const seletor of ['[data-onde]', '[data-sessao]', '[data-codigo]']) {
      expect(
        el(seletor).closest<HTMLElement>('[data-linha]')!.hidden,
        seletor,
      ).toBe(true)
    }
    expect(document.body.textContent).not.toMatch(/null|undefined/)
  })

  it('código que não existe (404): "Esse link não é válido"; API fora do ar ou limite: mensagem e "Tentar de novo" que funciona', async () => {
    const naoExiste = vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404))
    abrir('cancelar', naoExiste)
    await esperarVarias()
    expect(estadoVisivel()).toEqual(['invalido'])
    expect(naoExiste).toHaveBeenCalledTimes(1) // 4xx não se repete

    const limite = vi
      .fn()
      .mockResolvedValueOnce(resposta({ detail: 'x' }, 429))
      .mockResolvedValueOnce(resposta(resumo()))
    abrir('cancelar', limite)
    await esperarVarias()
    expect(estadoVisivel()).toEqual(['erro'])
    expect(el('[data-estado="erro"] [data-mensagem]').textContent).toContain(
      'Muitas consultas',
    )
    el('[data-tentar-de-novo]').click()
    await esperarVarias()
    expect(estadoVisivel()).toEqual(['resumo'])

    const caiu = vi.fn().mockRejectedValue(new TypeError('rede'))
    abrir('confirmar', caiu)
    await esperarVarias(8)
    expect(estadoVisivel()).toEqual(['erro'])
    expect(el('[data-estado="erro"] [data-mensagem]').textContent).toContain(
      'Não foi possível buscar a sua inscrição agora',
    )
  })

  it('resposta torta (sem a situação) é tratada como falha, não como inscrição vazia', async () => {
    abrir('cancelar', vi.fn().mockResolvedValue(resposta({ foo: 1 })))
    await esperarVarias()
    expect(estadoVisivel()).toEqual(['erro'])
  })
})

describe('cancelar', () => {
  it('o botão leva a uma etapa de confirmação ("Tem certeza? Você perde a vaga."); "Não, voltar" desfaz sem chamar a API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(resumo()))
    abrir('cancelar', fetchImpl)
    await esperarVarias()
    expect(aberto('[data-cancelar]')).toBe(true)
    expect(aberto('[data-passo-de-confirmacao]')).toBe(false)
    el('[data-cancelar]').click()
    expect(aberto('[data-passo-de-confirmacao]')).toBe(true)
    expect(aberto('[data-cancelar]')).toBe(false)
    expect(el('[data-pergunta-do-cancelamento]').textContent).toBe(
      'Tem certeza? Você perde a vaga.',
    )
    expect(document.activeElement).toBe(el('[data-confirmar-cancelamento]'))
    el('[data-voltar]').click()
    expect(aberto('[data-passo-de-confirmacao]')).toBe(false)
    expect(aberto('[data-cancelar]')).toBe(true)
    expect(document.activeElement).toBe(el('[data-cancelar]'))
    expect(fetchImpl).toHaveBeenCalledTimes(1) // só a consulta
  })

  it('quem está na lista de espera lê "Você sai da lista de espera"', async () => {
    abrir(
      'cancelar',
      vi.fn().mockResolvedValue(
        resposta(
          resumo({
            status: 'Lista de Espera',
            codigo_checkin: null,
            pode_confirmar: false,
          }),
        ),
      ),
    )
    await esperarVarias()
    el('[data-cancelar]').click()
    expect(el('[data-pergunta-do-cancelamento]').textContent).toBe(
      'Tem certeza? Você sai da lista de espera.',
    )
  })

  it('confirmado o cancelamento: POST na rota certa, mensagem de sucesso, situação atualizada, sem mais botões', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resposta(resumo()))
      .mockResolvedValueOnce(
        resposta({
          mensagem: 'Inscrição cancelada.',
          status: 'Cancelado',
          reembolso: null,
        }),
      )
    abrir('cancelar', fetchImpl)
    await esperarVarias()
    el('[data-cancelar]').click()
    el('[data-confirmar-cancelamento]').click()
    await esperarVarias()
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(
      `https://api.teste/api/publico/inscricoes/${TOKEN}/cancelar`,
    )
    expect(init.method).toBe('POST')
    const resultado = el('[data-resultado-da-acao]')
    expect(resultado.hidden).toBe(false)
    expect(resultado.textContent).toBe('A sua inscrição foi cancelada.')
    expect(document.activeElement).toBe(resultado)
    expect(el('[data-situacao]').textContent).toBe('Inscrição cancelada')
    expect(
      el('[data-codigo]').closest<HTMLElement>('[data-linha]')!.hidden,
    ).toBe(true)
    expect(aberto('[data-acoes]')).toBe(false)
  })

  it('com reembolso, diz o valor a devolver e que a secretaria cuida do pagamento', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        resposta(resumo({ status: 'Confirmado', pode_confirmar: false })),
      )
      .mockResolvedValueOnce(
        resposta({
          mensagem: 'Inscrição cancelada.',
          status: 'Cancelado',
          reembolso: { id_titulo: 9, valor: 50 },
        }),
      )
    abrir('cancelar', fetchImpl)
    await esperarVarias()
    el('[data-cancelar]').click()
    el('[data-confirmar-cancelamento]').click()
    await esperarVarias()
    const frases = [...el('[data-frases]').querySelectorAll('p')].map(
      (p) => p.textContent,
    )
    expect(frases[0]).toBe('A sua inscrição foi cancelada.')
    expect(frases[1]).toMatch(
      /^Foi registrado um valor a devolver de R\$\s50,00; a secretaria cuida do pagamento\.$/,
    )
  })

  it('falha ao cancelar: o motivo aparece, o botão volta e dá para tentar de novo', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resposta(resumo()))
      .mockResolvedValueOnce(
        resposta({ detail: 'Erro interno do servidor.' }, 500),
      )
    abrir('cancelar', fetchImpl)
    await esperarVarias()
    el('[data-cancelar]').click()
    el('[data-confirmar-cancelamento]').click()
    await esperarVarias()
    const falha = el('[data-falha-da-acao]')
    expect(falha.hidden).toBe(false)
    expect(falha.textContent).toContain('Não foi possível cancelar agora')
    expect(document.activeElement).toBe(falha)
    expect(
      el<HTMLButtonElement>('[data-confirmar-cancelamento]').disabled,
    ).toBe(false)
    expect(
      el<HTMLButtonElement>('[data-confirmar-cancelamento]').textContent,
    ).toBe('Sim, cancelar a minha inscrição')
    expect(el('[data-resultado-da-acao]').hidden).toBe(true)
  })

  it('já cancelada ou evento que já aconteceu: explicação e nenhum botão de cancelar', async () => {
    abrir(
      'cancelar',
      vi.fn().mockResolvedValue(
        resposta(
          resumo({
            status: 'Cancelado',
            codigo_checkin: null,
            pode_cancelar: false,
            pode_confirmar: false,
          }),
        ),
      ),
    )
    await esperarVarias()
    expect(el('[data-explicacao]').textContent).toBe(
      'Esta inscrição já foi cancelada.',
    )
    expect(aberto('[data-cancelar]')).toBe(false)
    expect(aberto('[data-acoes]')).toBe(false)

    abrir(
      'cancelar',
      vi.fn().mockResolvedValue(
        resposta(
          resumo({
            evento_encerrado: true,
            pode_cancelar: false,
            pode_confirmar: false,
          }),
        ),
      ),
    )
    await esperarVarias()
    expect(el('[data-explicacao]').textContent).toContain('já aconteceu')
    expect(aberto('[data-cancelar]')).toBe(false)
  })

  it('quem foi chamado da lista de espera (tem prazo) vê o prazo em horário de Belém e um caminho para confirmar', async () => {
    abrir(
      'cancelar',
      vi
        .fn()
        .mockResolvedValue(
          resposta(resumo({ prazo_confirmacao: '2026-10-10T14:30:00' })),
        ),
    )
    await esperarVarias()
    expect(el('[data-prazo]').textContent).toBe(
      '10/10/2026 11:30 (horário de Belém)',
    )
    const cruzado = el<HTMLAnchorElement>('[data-acao-cruzada]')
    expect(cruzado.hidden).toBe(false)
    expect(cruzado.getAttribute('href')).toBe(
      `/confirmar-inscricao/?token=${TOKEN}`,
    )
  })
})

describe('confirmar', () => {
  it('vaga reservada: botão "Confirmar a minha vaga", e o caminho para cancelar', async () => {
    abrir(
      'confirmar',
      vi
        .fn()
        .mockResolvedValue(
          resposta(resumo({ prazo_confirmacao: '2026-10-10T14:30:00' })),
        ),
    )
    await esperarVarias()
    expect(aberto('[data-confirmar]')).toBe(true)
    expect(el('[data-prazo]').textContent).toBe(
      '10/10/2026 11:30 (horário de Belém)',
    )
    const cruzado = el<HTMLAnchorElement>('[data-acao-cruzada]')
    expect(cruzado.hidden).toBe(false)
    expect(cruzado.getAttribute('href')).toBe(
      `/cancelar-inscricao/?token=${TOKEN}`,
    )
    expect(cruzado.textContent).toBe(
      'Não vou poder ir: cancelar a minha inscrição',
    )
  })

  it('confirmar: POST na rota certa e "A sua vaga está confirmada." com o código de check-in à vista', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resposta(resumo()))
      .mockResolvedValueOnce(
        resposta({ mensagem: 'Inscrição confirmada.', status: 'Confirmado' }),
      )
    abrir('confirmar', fetchImpl)
    await esperarVarias()
    el('[data-confirmar]').click()
    expect(el<HTMLButtonElement>('[data-confirmar]').disabled).toBe(true)
    await esperarVarias()
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(
      `https://api.teste/api/publico/inscricoes/${TOKEN}/confirmar`,
    )
    expect(init.method).toBe('POST')
    expect(el('[data-resultado-da-acao]').textContent).toBe(
      'A sua vaga está confirmada.',
    )
    expect(el('[data-situacao]').textContent).toBe('Vaga confirmada')
    expect(el('[data-codigo]').textContent).toBe('A1B2C3D4')
    expect(aberto('[data-acoes]')).toBe(false)
  })

  it('lista de espera: a frase da fila, sem botão de confirmar, com o botão para cancelar', async () => {
    abrir(
      'confirmar',
      vi.fn().mockResolvedValue(
        resposta(
          resumo({
            status: 'Lista de Espera',
            codigo_checkin: null,
            pode_confirmar: false,
          }),
        ),
      ),
    )
    await esperarVarias()
    expect(el('[data-explicacao]').textContent).toBe(
      'Você ainda está na lista de espera; avisamos por e-mail quando uma vaga abrir.',
    )
    expect(aberto('[data-confirmar]')).toBe(false)
    const cruzado = el<HTMLAnchorElement>('[data-acao-cruzada]')
    expect(cruzado.hidden).toBe(false)
    expect(cruzado.textContent).toBe('Cancelar a minha inscrição')
    expect(cruzado.getAttribute('href')).toBe(
      `/cancelar-inscricao/?token=${TOKEN}`,
    )
  })

  it('já confirmada: diz que está confirmada e mostra o código', async () => {
    abrir(
      'confirmar',
      vi
        .fn()
        .mockResolvedValue(
          resposta(resumo({ status: 'Confirmado', pode_confirmar: false })),
        ),
    )
    await esperarVarias()
    expect(el('[data-explicacao]').textContent).toBe(
      'A sua vaga está confirmada.',
    )
    expect(el('[data-codigo]').textContent).toBe('A1B2C3D4')
    expect(aberto('[data-confirmar]')).toBe(false)
  })

  it('a API recusa (400 com o motivo): a pessoa lê o motivo e o botão volta', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resposta(resumo()))
      .mockResolvedValueOnce(
        resposta(
          {
            detail:
              "Não é possível confirmar uma inscrição com status 'Cancelado'.",
          },
          400,
        ),
      )
    abrir('confirmar', fetchImpl)
    await esperarVarias()
    el('[data-confirmar]').click()
    await esperarVarias()
    expect(el('[data-falha-da-acao]').textContent).toBe(
      "Não é possível confirmar uma inscrição com status 'Cancelado'.",
    )
    expect(el<HTMLButtonElement>('[data-confirmar]').disabled).toBe(false)
    expect(el<HTMLButtonElement>('[data-confirmar]').textContent).toBe(
      'Confirmar a minha vaga',
    )
  })

  it('um segundo clique enquanto o primeiro está a caminho é ignorado', async () => {
    let soltar: (r: Response) => void = () => {}
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resposta(resumo()))
      .mockImplementationOnce(() => new Promise<Response>((r) => (soltar = r)))
    abrir('confirmar', fetchImpl)
    await esperarVarias()
    el('[data-confirmar]').click()
    el('[data-confirmar]').click()
    await esperarVarias()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    soltar(
      resposta({ mensagem: 'Inscrição confirmada.', status: 'Confirmado' }),
    )
    await esperarVarias()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
