// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { iniciarDoacao } from '../src/lib/doacao-vivo'

// v5.6a — a ilha da página de doação, em cada estado, com a API trocada por uma resposta de mentira. O HTML abaixo repete os "ganchos" (data-...) do componente
// src/components/DoacaoAoVivo.astro; a página de verdade, montada, é conferida pelo e2e/doacao.spec.ts.

const PAGINA = `
<div data-doacao-vivo data-api-url="https://api.teste" aria-busy="true">
  <p data-estado="carregando">Carregando</p>
  <div data-estado="erro" hidden><button type="button" data-tentar-de-novo>Tentar de novo</button></div>
  <div data-estado="indisponivel" hidden>Indisponível</div>
  <div data-estado="pronto" hidden>
    <section>
      <p data-sem-campanhas hidden>Sem campanhas</p>
      <ul data-campanhas></ul>
      <p data-nota-recebido hidden>Nota do recebido</p>
    </section>
    <form data-doacao-anonima novalidate>
      <select name="id_campanha" data-campo-campanha><option value="">Para a associação, sem campanha</option></select>
      <p data-erro="id_campanha" hidden></p>
      <input name="valor" />
      <p data-erro="valor" hidden></p>
      <p data-falha-do-envio role="alert" tabindex="-1" hidden></p>
      <button type="submit" data-enviar>Mostrar o código Pix</button>
    </form>
    <div data-resultado-anonimo tabindex="-1" hidden><div data-painel></div></div>
    <form data-doacao-identificada novalidate>
      <p data-resumo-de-erros role="alert" hidden></p>
      <input name="nome_completo" /><p data-erro="nome_completo" hidden></p>
      <input name="email" /><p data-erro="email" hidden></p>
      <input name="cpf" /><p data-erro="cpf" hidden></p>
      <select name="id_campanha" data-campo-campanha><option value="">Para a associação, sem campanha</option></select><p data-erro="id_campanha" hidden></p>
      <input name="valor" /><p data-erro="valor" hidden></p>
      <span data-versao-do-aviso></span>
      <input type="checkbox" name="consentimento_lgpd" /><p data-erro="consentimento_lgpd" hidden></p>
      <input type="text" name="pagina_web" />
      <p data-falha-do-envio role="alert" tabindex="-1" hidden></p>
      <button type="submit" data-enviar>Enviar e ver o código Pix</button>
    </form>
    <div data-confirmacao-identificada tabindex="-1" hidden>
      <div data-bloco-do-protocolo hidden><strong data-protocolo></strong><button type="button" data-copiar-protocolo>Copiar</button><span data-aviso-da-copia-do-protocolo></span></div>
      <div data-aviso-de-pagamento hidden>Ainda falta pagar</div>
      <p data-validade hidden></p>
      <p data-aviso-do-vencimento hidden>Prazo vencido, ainda pode confirmar</p>
      <p data-aviso-do-email hidden>Se o e-mail chegar</p>
      <div data-painel></div>
    </div>
  </div>
</div>`

const AGORA = new Date('2026-10-16T15:00:00Z')

const CODIGO_LIVRE =
  '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF5204000053039865802BR5910ASAF TESTE6011PARAUAPEBAS62140510ASAFDOACAO6304C407'
const CODIGO_DO_PEDIDO =
  '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF520400005303986540525.505802BR5910ASAF TESTE6011PARAUAPEBAS62200516ASAFDOA202600007630415EC'

const campanhas = () => [
  {
    id_campanha: 1,
    titulo: 'Cestas básicas',
    descricao: 'Para famílias da comunidade.',
    meta_valor: 10000,
    valor_arrecadado: 2500,
    valor_aplicado: 1800.5,
    percentual: 25,
    prazo: '2026-12-31',
  },
  {
    id_campanha: 2,
    titulo: 'Reforma do telhado',
    descricao: null,
    meta_valor: 5000,
    valor_arrecadado: 6000,
    valor_aplicado: null,
    percentual: 120,
    prazo: null,
  },
]

const doacao = (extra: Record<string, unknown> = {}) => ({
  pix_disponivel: true,
  chave_pix: '123e4567-e89b-12d3-a456-426614174000',
  beneficiario: 'ASAF TESTE',
  cidade: 'PARAUAPEBAS',
  campanhas: campanhas(),
  versao_aviso_de_privacidade: '1',
  dias_de_validade_do_pedido: 15,
  ...extra,
})

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type Chamada = { url: string; metodo: string; corpo: any }

/** Uma API de mentira: responde pelo caminho e guarda o que recebeu. */
function api(respostas: Record<string, () => Response | Promise<Response>>): {
  fetchImpl: typeof fetch
  chamadas: Chamada[]
} {
  const chamadas: Chamada[] = []
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const endereco = String(url)
      const caminho = endereco.replace('https://api.teste', '').split('?')[0]!
      chamadas.push({
        url: endereco,
        metodo: init?.method ?? 'GET',
        corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      const resposta = respostas[caminho]
      if (!resposta) return json({ detail: 'Não encontrado.' }, 404)
      return resposta()
    },
  ) as unknown as typeof fetch
  return { fetchImpl, chamadas }
}

function montar(): HTMLElement {
  document.body.innerHTML = PAGINA
  return document.querySelector<HTMLElement>('[data-doacao-vivo]')!
}

const visivel = (raiz: ParentNode, seletor: string) =>
  !raiz.querySelector<HTMLElement>(seletor)!.hidden
const estadoVisivel = (raiz: HTMLElement) =>
  [...raiz.querySelectorAll<HTMLElement>(':scope > [data-estado]')]
    .filter((e) => !e.hidden)
    .map((e) => e.dataset.estado)
const campo = (form: Element, nome: string) =>
  form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${nome}"]`)!
const preencher = (form: Element, nome: string, valor: string) => {
  const c = campo(form, nome)
  c.value = valor
  c.dispatchEvent(new Event('input', { bubbles: true }))
}
const enviar = (form: Element) =>
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const esperar = () => new Promise((r) => setTimeout(r, 0))

async function iniciar(
  respostas: Record<string, () => Response | Promise<Response>>,
  opcoes: Parameters<typeof iniciarDoacao>[1] = {},
) {
  const raiz = montar()
  const { fetchImpl, chamadas } = api(respostas)
  await iniciarDoacao(raiz, {
    fetchImpl,
    agora: () => AGORA,
    esperaEntreTentativasMs: 0,
    clipboard: null,
    ...opcoes,
  })
  return { raiz, chamadas }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('os estados da ilha', () => {
  it('Pix aberto: só o estado "pronto" aparece, com as campanhas, a versão do aviso e o fim do aria-busy', async () => {
    const { raiz, chamadas } = await iniciar({
      '/api/publico/doacao': () => json(doacao()),
    })
    expect(estadoVisivel(raiz)).toEqual(['pronto'])
    expect(raiz.getAttribute('aria-busy')).toBe('false')
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.url).toBe('https://api.teste/api/publico/doacao')
    expect(raiz.querySelector('[data-versao-do-aviso]')!.textContent).toBe('1')
    expect(visivel(raiz, '[data-nota-recebido]')).toBe(true)
    expect(
      raiz.querySelector('[data-sem-campanhas]')!.hasAttribute('hidden'),
    ).toBe(true)
  })

  it('cada campanha: título, descrição, meta, quanto já foi recebido e o prazo, com a barra e o percentual em TEXTO', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () => json(doacao()),
    })
    const itens = raiz.querySelectorAll('[data-campanha]')
    expect(itens).toHaveLength(2)
    const [a, b] = itens as unknown as [HTMLElement, HTMLElement]
    expect(a.querySelector('h4')!.textContent).toBe('Cestas básicas')
    expect(a.textContent).toContain('Para famílias da comunidade.')
    const limpo = (s: string | null | undefined) =>
      (s ?? '').replace(/\s/g, ' ')
    expect(limpo(a.querySelector('[data-meta]')!.textContent)).toBe(
      'R$ 10.000,00',
    )
    expect(limpo(a.querySelector('[data-recebido]')!.textContent)).toBe(
      'R$ 2.500,00',
    )
    expect(a.querySelector('[data-prazo]')!.textContent).toBe('Até 31/12/2026')
    // v5.7g: o aplicado é o total gasto no centro de custo da campanha; sem centro de custo, a página diz que o gasto não é acompanhado à parte
    expect(limpo(a.querySelector('[data-aplicado]')!.textContent)).toBe(
      'R$ 1.800,50',
    )
    expect(limpo(b.querySelector('[data-aplicado]')!.textContent)).toBe(
      'não acompanhado à parte',
    )
    expect(a.querySelector('[data-percentual]')!.textContent).toBe(
      '25% da meta.',
    )
    const barra = a.querySelector('progress')!
    expect(barra.max).toBe(10000)
    expect(barra.value).toBe(2500)
    expect(barra.getAttribute('aria-labelledby')).toBe(
      a.querySelector('h4')!.id,
    )
    expect(barra.getAttribute('aria-valuetext')).toBe('25% da meta.')
    // meta ultrapassada: a barra fica cheia e o texto diz o percentual real; campanha sem prazo diz isso
    expect(b.querySelector('[data-percentual]')!.textContent).toBe(
      '120% da meta: a meta já foi ultrapassada.',
    )
    expect(b.querySelector('progress')!.value).toBe(5000)
    expect(b.querySelector('progress')!.max).toBe(5000)
    expect(b.querySelector('[data-prazo]')!.textContent).toBe(
      'Sem prazo definido',
    )
    expect(b.textContent).not.toContain('Para famílias')
  })

  it('v5.7g: aplicado zero aparece como R$ 0,00; API sem o dado (antiga) não fala de aplicado', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () =>
        json(
          doacao({
            campanhas: [
              { ...campanhas()[0], valor_aplicado: 0 },
              (({ valor_aplicado: _ignorado, ...resto }) => resto)(
                campanhas()[1] as Record<string, unknown> & {
                  valor_aplicado: unknown
                },
              ),
            ],
          }),
        ),
    })
    const [a, b] = raiz.querySelectorAll('[data-campanha]') as unknown as [
      HTMLElement,
      HTMLElement,
    ]
    expect(
      (a.querySelector('[data-aplicado]')!.textContent ?? '').replace(
        /\s/g,
        ' ',
      ),
    ).toBe('R$ 0,00')
    expect(b.querySelector('[data-aplicado]')).toBeNull()
    expect(b.textContent).not.toContain('Já aplicado')
  })

  it('as listas "Para onde vai a sua doação" dos dois formulários trazem as campanhas depois de "sem campanha"', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () => json(doacao()),
    })
    for (const escolha of raiz.querySelectorAll<HTMLSelectElement>('select')) {
      expect([...escolha.options].map((o) => [o.value, o.textContent])).toEqual(
        [
          ['', 'Para a associação, sem campanha'],
          ['1', 'Cestas básicas'],
          ['2', 'Reforma do telhado'],
        ],
      )
    }
  })

  it('nunca mostra campanha cujo prazo já passou, mesmo que a API a mande', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () =>
        json(
          doacao({
            campanhas: [
              {
                ...campanhas()[0],
                id_campanha: 7,
                titulo: 'Encerrada',
                prazo: '2026-10-15',
              },
              {
                ...campanhas()[0],
                id_campanha: 8,
                titulo: 'Último dia',
                prazo: '2026-10-16',
              },
            ],
          }),
        ),
    })
    const titulos = [...raiz.querySelectorAll('[data-campanha] h4')].map(
      (h) => h.textContent,
    )
    expect(titulos).toEqual(['Último dia'])
    expect(raiz.querySelector('select')!.textContent).not.toContain('Encerrada')
  })

  it('sem campanha em andamento: a frase de "doe sem campanha" aparece e a nota do recebido some', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () => json(doacao({ campanhas: [] })),
    })
    expect(estadoVisivel(raiz)).toEqual(['pronto'])
    expect(visivel(raiz, '[data-sem-campanhas]')).toBe(true)
    expect(visivel(raiz, '[data-nota-recebido]')).toBe(false)
    expect(raiz.querySelectorAll('[data-campanha]')).toHaveLength(0)
  })

  it('título e descrição são texto: HTML escrito neles não executa nem vira elemento', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () =>
        json(
          doacao({
            campanhas: [
              {
                ...campanhas()[0],
                titulo: '<img src=x onerror="window.__invasao=1">',
                descricao: '<script>window.__invasao=2</script><b>x</b>',
              },
            ],
          }),
        ),
    })
    expect(raiz.querySelector('[data-campanha] img')).toBeNull()
    expect(raiz.querySelector('[data-campanha] script')).toBeNull()
    expect(raiz.querySelector('[data-campanha] b')).toBeNull()
    expect(raiz.querySelector('[data-campanha] h4')!.textContent).toBe(
      '<img src=x onerror="window.__invasao=1">',
    )
    expect((window as any).__invasao).toBeUndefined()
  })

  it('Pix ainda não aberto para o site: só o aviso gentil, nenhuma campanha e nenhum formulário visível', async () => {
    const { raiz } = await iniciar({
      '/api/publico/doacao': () =>
        json({
          ...doacao(),
          pix_disponivel: false,
          chave_pix: null,
          beneficiario: null,
          cidade: null,
        }),
    })
    expect(estadoVisivel(raiz)).toEqual(['indisponivel'])
    expect(raiz.getAttribute('aria-busy')).toBe('false')
    expect(raiz.querySelectorAll('[data-campanha]')).toHaveLength(0)
  })

  it('API antiga (a rota responde 404): também é "ainda não está disponível", sem repetir a chamada', async () => {
    const { raiz, chamadas } = await iniciar({})
    expect(estadoVisivel(raiz)).toEqual(['indisponivel'])
    expect(chamadas).toHaveLength(1)
  })

  it('API fora do ar: o estado de erro, depois de uma nova tentativa; "Tentar de novo" recupera quando ela volta', async () => {
    let no_ar = false
    const { raiz, chamadas } = await iniciar({
      '/api/publico/doacao': () => {
        if (!no_ar) throw new TypeError('Failed to fetch')
        return json(doacao())
      },
    })
    expect(estadoVisivel(raiz)).toEqual(['erro'])
    expect(raiz.getAttribute('aria-busy')).toBe('false')
    expect(chamadas).toHaveLength(2) // a primeira e a nova tentativa (a API acorda devagar)
    no_ar = true
    raiz.querySelector<HTMLButtonElement>('[data-tentar-de-novo]')!.click()
    expect(estadoVisivel(raiz)).toEqual(['carregando'])
    await vi.waitFor(() => expect(estadoVisivel(raiz)).toEqual(['pronto']))
  })

  it('erro de servidor (500) e resposta fora do formato: erro, nunca um formulário pela metade', async () => {
    const a = await iniciar({
      '/api/publico/doacao': () => json({ detail: 'quebrou' }, 500),
    })
    expect(estadoVisivel(a.raiz)).toEqual(['erro'])
    const b = await iniciar({
      '/api/publico/doacao': () => json({ pix_disponivel: true }),
    })
    expect(estadoVisivel(b.raiz)).toEqual(['erro'])
    const c = await iniciar({ '/api/publico/doacao': () => json([1, 2, 3]) })
    expect(estadoVisivel(c.raiz)).toEqual(['erro'])
  })
})

describe('doar sem se identificar', () => {
  const respostas = (extra: Record<string, () => Response> = {}) => ({
    '/api/publico/doacao': () => json(doacao()),
    '/api/publico/doacao/pix': () =>
      json({
        copia_e_cola: CODIGO_LIVRE,
        valor: null,
        id_campanha: null,
        chave_pix: '123e4567-e89b-12d3-a456-426614174000',
        beneficiario: 'ASAF TESTE',
        cidade: 'PARAUAPEBAS',
      }),
    ...extra,
  })

  it('sem valor nem campanha: consulta sem parâmetros e mostra o código, o QR e os dados de quem recebe', async () => {
    const { raiz, chamadas } = await iniciar(respostas())
    const form = raiz.querySelector('[data-doacao-anonima]')!
    enviar(form)
    await vi.waitFor(() =>
      expect(visivel(raiz, '[data-resultado-anonimo]')).toBe(true),
    )
    expect(chamadas.at(-1)!.url).toBe(
      'https://api.teste/api/publico/doacao/pix',
    )
    expect(chamadas.at(-1)!.metodo).toBe('GET')
    const resultado = raiz.querySelector('[data-resultado-anonimo]')!
    expect(resultado.querySelector('[data-codigo-pix]')!.textContent).toBe(
      CODIGO_LIVRE,
    )
    expect(resultado.querySelector('svg')).not.toBeNull()
    expect(resultado.querySelector('[data-beneficiario]')!.textContent).toBe(
      'ASAF TESTE',
    )
    expect(document.activeElement).toBe(resultado)
  })

  it('com valor e campanha: o valor vai com ponto e duas casas e a campanha como número', async () => {
    const { raiz, chamadas } = await iniciar(respostas())
    const form = raiz.querySelector('[data-doacao-anonima]')!
    preencher(form, 'id_campanha', '1')
    preencher(form, 'valor', 'R$ 1.025,5')
    enviar(form)
    await vi.waitFor(() => expect(chamadas).toHaveLength(2))
    expect(chamadas[1]!.url).toBe(
      'https://api.teste/api/publico/doacao/pix?valor=1025.50&id_campanha=1',
    )
  })

  it('valor ilegível ou fora do limite: aponta o campo, foca nele e nem chama a API', async () => {
    const { raiz, chamadas } = await iniciar(respostas())
    const form = raiz.querySelector('[data-doacao-anonima]')!
    for (const [texto, trecho] of [
      ['dez reais', 'Confira o valor'],
      ['0', 'maior que zero'],
      ['1.000.000,01', 'alto demais'],
    ] as const) {
      preencher(form, 'valor', texto)
      enviar(form)
      const erro = form.querySelector<HTMLElement>('[data-erro="valor"]')!
      expect(erro.hidden, texto).toBe(false)
      expect(erro.textContent, texto).toContain(trecho)
      expect(campo(form, 'valor').getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(campo(form, 'valor'))
    }
    expect(chamadas).toHaveLength(1) // só a da lista de campanhas
    preencher(form, 'valor', '50')
    expect(form.querySelector<HTMLElement>('[data-erro="valor"]')!.hidden).toBe(
      true,
    )
    expect(campo(form, 'valor').hasAttribute('aria-invalid')).toBe(false)
  })

  it('campanha que saiu da lista não é aceita', async () => {
    const { raiz, chamadas } = await iniciar(respostas())
    const form = raiz.querySelector('[data-doacao-anonima]')!
    const intrusa = document.createElement('option')
    intrusa.value = '99'
    campo(form, 'id_campanha').append(intrusa)
    preencher(form, 'id_campanha', '99')
    enviar(form)
    expect(form.querySelector('[data-erro="id_campanha"]')!.textContent).toBe(
      'Escolha uma campanha da lista ou doe sem campanha.',
    )
    expect(chamadas).toHaveLength(1)
  })

  it('mexer na campanha ou no valor tira da tela o código antigo (nunca fica um código que não combina com o que está escrito)', async () => {
    const { raiz } = await iniciar(respostas())
    const form = raiz.querySelector('[data-doacao-anonima]')!
    enviar(form)
    await vi.waitFor(() =>
      expect(visivel(raiz, '[data-resultado-anonimo]')).toBe(true),
    )
    preencher(form, 'valor', '10')
    expect(visivel(raiz, '[data-resultado-anonimo]')).toBe(false)
  })

  it('a API recusa (400 com a frase): a pessoa lê a frase da API, num alerta; o botão volta', async () => {
    const { raiz } = await iniciar(
      respostas({
        '/api/publico/doacao/pix': () =>
          json(
            {
              detail:
                'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
            },
            400,
          ),
      }),
    )
    const form = raiz.querySelector('[data-doacao-anonima]')!
    enviar(form)
    const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')!
    await vi.waitFor(() => expect(falha.hidden).toBe(false))
    expect(falha.textContent).toBe(
      'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
    )
    expect(document.activeElement).toBe(falha)
    expect(visivel(raiz, '[data-resultado-anonimo]')).toBe(false)
    const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')!
    expect(botao.disabled).toBe(false)
    expect(botao.textContent).toBe('Mostrar o código Pix')
  })

  it('sem rede: orientação com a secretaria; resposta sem o código inteiro também é falha', async () => {
    const semRede = await iniciar(
      respostas({
        '/api/publico/doacao/pix': () => {
          throw new TypeError('Failed to fetch')
        },
      }),
    )
    const form = semRede.raiz.querySelector('[data-doacao-anonima]')!
    enviar(form)
    const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')!
    await vi.waitFor(() => expect(falha.hidden).toBe(false))
    expect(falha.textContent).toContain('Não foi possível gerar o código agora')
    expect(falha.textContent).toContain('fale com a secretaria')

    const torta = await iniciar(
      respostas({
        '/api/publico/doacao/pix': () => json({ copia_e_cola: '' }),
      }),
    )
    const outro = torta.raiz.querySelector('[data-doacao-anonima]')!
    enviar(outro)
    await vi.waitFor(() =>
      expect(
        outro.querySelector<HTMLElement>('[data-falha-do-envio]')!.hidden,
      ).toBe(false),
    )
    expect(visivel(torta.raiz, '[data-resultado-anonimo]')).toBe(false)
  })

  it('duplo clique: uma consulta só, e o botão fica desligado enquanto espera', async () => {
    let liberar!: (r: Response) => void
    const { raiz, chamadas } = await iniciar(
      respostas({
        '/api/publico/doacao/pix': () =>
          new Promise<Response>((resolver) => (liberar = resolver)) as any,
      }),
    )
    const form = raiz.querySelector('[data-doacao-anonima]')!
    const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')!
    enviar(form)
    enviar(form)
    expect(botao.disabled).toBe(true)
    expect(botao.textContent).toBe('Gerando…')
    expect(form.getAttribute('aria-busy')).toBe('true')
    await esperar()
    expect(chamadas.filter((c) => c.url.includes('/doacao/pix'))).toHaveLength(
      1,
    )
    liberar(
      json({
        copia_e_cola: CODIGO_LIVRE,
        chave_pix: 'k',
        beneficiario: 'ASAF',
        cidade: 'X',
        valor: null,
        id_campanha: null,
      }),
    )
    await vi.waitFor(() => expect(botao.disabled).toBe(false))
    expect(form.hasAttribute('aria-busy')).toBe(false)
  })
})

describe('doar se identificando', () => {
  const PEDIDO_OK = {
    mensagem: 'Pedido recebido.',
    protocolo: 'DOA-2026-00007',
    valor: 25.5,
    id_campanha: 1,
    copia_e_cola: CODIGO_DO_PEDIDO,
    chave_pix: '123e4567-e89b-12d3-a456-426614174000',
    beneficiario: 'ASAF TESTE',
    cidade: 'PARAUAPEBAS',
    expira_em: '2026-10-31T13:00:00.123456',
  }
  const respostas = (
    pedido: () => Response | Promise<Response> = () => json(PEDIDO_OK),
    lista: () => Response = () => json(doacao()),
  ) => ({
    '/api/publico/doacao': lista,
    '/api/publico/doacoes/intencoes': pedido,
  })

  async function preparar(
    pedido?: () => Response | Promise<Response>,
    lista?: () => Response,
  ) {
    const r = await iniciar(respostas(pedido, lista))
    const form = r.raiz.querySelector('[data-doacao-identificada]')!
    return { ...r, form }
  }

  function preencherTudo(form: Element, extra: Record<string, string> = {}) {
    preencher(form, 'nome_completo', extra.nome ?? 'Maria de Teste')
    preencher(form, 'email', extra.email ?? 'maria@example.com')
    if (extra.cpf) preencher(form, 'cpf', extra.cpf)
    if (extra.campanha) preencher(form, 'id_campanha', extra.campanha)
    if (extra.valor) preencher(form, 'valor', extra.valor)
    const aceite = campo(form, 'consentimento_lgpd') as HTMLInputElement
    aceite.checked = extra.sem_aceite !== 'sim'
    aceite.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('em branco: avisa cada campo que falta, resume, foca o primeiro e nem chama a API', async () => {
    const { form, chamadas } = await preparar()
    enviar(form)
    for (const [campoComErro, trecho] of [
      ['nome_completo', 'Informe o seu nome completo.'],
      ['email', 'Esse e-mail não parece certo'],
      ['consentimento_lgpd', 'ler e aceitar o aviso de privacidade'],
    ] as const) {
      const erro = form.querySelector<HTMLElement>(
        `[data-erro="${campoComErro}"]`,
      )!
      expect(erro.hidden, campoComErro).toBe(false)
      expect(erro.textContent).toContain(trecho)
      expect(campo(form, campoComErro).getAttribute('aria-invalid')).toBe(
        'true',
      )
    }
    // CPF, valor e campanha são opcionais: em branco não vira erro
    for (const opcional of ['cpf', 'valor', 'id_campanha'])
      expect(
        form.querySelector<HTMLElement>(`[data-erro="${opcional}"]`)!.hidden,
      ).toBe(true)
    expect(form.querySelector('[data-resumo-de-erros]')!.textContent).toBe(
      'Há 3 campos para corrigir.',
    )
    expect(document.activeElement).toBe(campo(form, 'nome_completo'))
    expect(chamadas).toHaveLength(1)
  })

  it('o foco procura o erro na ordem da página: nome, e-mail, CPF, campanha, valor, aceite', async () => {
    const { form } = await preparar()
    preencherTudo(form, {
      cpf: '111.444.777-36',
      valor: 'x',
      sem_aceite: 'sim',
    })
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'cpf'))
    expect(form.querySelector('[data-erro="cpf"]')!.textContent).toBe(
      'Esse CPF não confere: confira os números ou deixe em branco.',
    )
    preencher(form, 'cpf', '')
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'valor'))
    preencher(form, 'valor', '')
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'consentimento_lgpd'))
  })

  it('corrigir um campo faz o aviso dele sumir na hora e o resumo acompanhar', async () => {
    const { form } = await preparar()
    enviar(form)
    expect(form.querySelector('[data-resumo-de-erros]')!.textContent).toBe(
      'Há 3 campos para corrigir.',
    )
    preencher(form, 'nome_completo', 'Maria de Teste')
    expect(
      form.querySelector<HTMLElement>('[data-erro="nome_completo"]')!.hidden,
    ).toBe(true)
    expect(form.querySelector('[data-resumo-de-erros]')!.textContent).toBe(
      'Há 2 campos para corrigir.',
    )
  })

  it('pedido certo: o corpo tem os dados limpos, a versão do aviso que a API mandou ler e a armadilha vazia', async () => {
    const { form, chamadas } = await preparar(undefined, () =>
      json(doacao({ versao_aviso_de_privacidade: '7' })),
    )
    preencherTudo(form, {
      nome: '  Maria   de  Teste ',
      cpf: '390.533.447-05',
      campanha: '1',
      valor: '25,50',
    })
    enviar(form)
    await vi.waitFor(() =>
      expect(visivel(document.body, '[data-confirmacao-identificada]')).toBe(
        true,
      ),
    )
    const envio = chamadas.at(-1)!
    expect(envio.url).toBe('https://api.teste/api/publico/doacoes/intencoes')
    expect(envio.metodo).toBe('POST')
    expect(envio.corpo).toEqual({
      nome_completo: 'Maria de Teste',
      email: 'maria@example.com',
      cpf: '39053344705',
      valor: 25.5,
      id_campanha: 1,
      consentimento_lgpd: true,
      versao_texto_consentimento: '7',
      pagina_web: '',
    })
    // nenhum dado pessoal na URL
    expect(envio.url).not.toMatch(/maria|390|@/i)
  })

  it('o pedido mínimo (só nome, e-mail e aceite) vai sem CPF, valor nem campanha', async () => {
    const { form, chamadas } = await preparar()
    preencherTudo(form)
    enviar(form)
    await vi.waitFor(() => expect(chamadas).toHaveLength(2))
    expect(Object.keys(chamadas[1]!.corpo).sort()).toEqual(
      [
        'consentimento_lgpd',
        'email',
        'nome_completo',
        'pagina_web',
        'versao_texto_consentimento',
      ].sort(),
    )
  })

  it('o CPF é formatado ao sair do campo', async () => {
    const { form } = await preparar()
    const cpf = campo(form, 'cpf')
    cpf.value = '39053344705'
    cpf.dispatchEvent(new Event('blur'))
    expect(cpf.value).toBe('390.533.447-05')
  })

  it('sucesso: protocolo em destaque, aviso de que ainda falta pagar, validade, aviso do e-mail (com "se chegar") e o painel com o código', async () => {
    const { raiz, form } = await preparar()
    preencherTudo(form, { valor: '25,50', campanha: '1' })
    enviar(form)
    const confirmacao = raiz.querySelector<HTMLElement>(
      '[data-confirmacao-identificada]',
    )!
    await vi.waitFor(() => expect(confirmacao.hidden).toBe(false))
    expect((form as HTMLElement).hidden).toBe(true)
    expect(document.activeElement).toBe(confirmacao)
    expect(confirmacao.querySelector('[data-protocolo]')!.textContent).toBe(
      'DOA-2026-00007',
    )
    expect(visivel(confirmacao, '[data-bloco-do-protocolo]')).toBe(true)
    expect(visivel(confirmacao, '[data-aviso-de-pagamento]')).toBe(true)
    expect(confirmacao.querySelector('[data-validade]')!.textContent).toBe(
      'O pedido vale por 15 dias (até 31 de outubro de 2026).',
    )
    expect(visivel(confirmacao, '[data-aviso-do-vencimento]')).toBe(true)
    expect(visivel(confirmacao, '[data-aviso-do-email]')).toBe(true)
    expect(confirmacao.querySelector('[data-codigo-pix]')!.textContent).toBe(
      CODIGO_DO_PEDIDO,
    )
    expect(confirmacao.querySelector('svg')).not.toBeNull()
    const limpo = (
      confirmacao.querySelector('[data-valor-pix]')!.textContent ?? ''
    ).replace(/\s/g, ' ')
    expect(limpo).toBe('Valor: R$ 25,50. Ele já está dentro do código.')
  })

  it('o protocolo tem um botão para copiar', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined)
    const raiz = montar()
    const { fetchImpl } = api(respostas())
    await iniciarDoacao(raiz, {
      fetchImpl,
      agora: () => AGORA,
      clipboard: { writeText: escrever },
    })
    const form = raiz.querySelector('[data-doacao-identificada]')!
    preencherTudo(form)
    enviar(form)
    const confirmacao = raiz.querySelector<HTMLElement>(
      '[data-confirmacao-identificada]',
    )!
    await vi.waitFor(() => expect(confirmacao.hidden).toBe(false))
    confirmacao
      .querySelector<HTMLButtonElement>('[data-copiar-protocolo]')!
      .click()
    await vi.waitFor(() =>
      expect(
        confirmacao.querySelector('[data-aviso-da-copia-do-protocolo]')!
          .textContent,
      ).toContain('Copiado'),
    )
    expect(escrever).toHaveBeenCalledWith('DOA-2026-00007')
  })

  it('sem os dias de validade na API, a página não fala em prazo (nada inventado)', async () => {
    const { raiz, form } = await preparar(undefined, () =>
      json(doacao({ dias_de_validade_do_pedido: null })),
    )
    preencherTudo(form)
    enviar(form)
    const confirmacao = raiz.querySelector<HTMLElement>(
      '[data-confirmacao-identificada]',
    )!
    await vi.waitFor(() => expect(confirmacao.hidden).toBe(false))
    expect(visivel(confirmacao, '[data-validade]')).toBe(false)
    expect(visivel(confirmacao, '[data-aviso-do-vencimento]')).toBe(false)
    expect(visivel(confirmacao, '[data-aviso-de-pagamento]')).toBe(true)
  })

  it('armadilha de robô preenchida: o corpo leva o que foi escrito e a tela de sucesso aparece SEM protocolo, sem código e sem promessa', async () => {
    const { raiz, form, chamadas } = await preparar(() =>
      json({
        mensagem: 'Pedido recebido.',
        protocolo: null,
        valor: null,
        copia_e_cola: null,
        expira_em: null,
      }),
    )
    preencherTudo(form)
    campo(form, 'pagina_web').value = 'http://spam.example'
    enviar(form)
    const confirmacao = raiz.querySelector<HTMLElement>(
      '[data-confirmacao-identificada]',
    )!
    await vi.waitFor(() => expect(confirmacao.hidden).toBe(false))
    expect(chamadas.at(-1)!.corpo.pagina_web).toBe('http://spam.example')
    for (const gancho of [
      '[data-bloco-do-protocolo]',
      '[data-aviso-de-pagamento]',
      '[data-validade]',
      '[data-aviso-do-vencimento]',
      '[data-aviso-do-email]',
    ])
      expect(visivel(confirmacao, gancho), gancho).toBe(false)
    expect(confirmacao.querySelector('[data-painel]')!.children).toHaveLength(0)
  })

  it('duplo clique: UM pedido só, botão desligado e "Enviando…" enquanto espera', async () => {
    let liberar!: (r: Response) => void
    const { form, chamadas } = await preparar(
      () => new Promise<Response>((resolver) => (liberar = resolver)),
    )
    preencherTudo(form)
    const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')!
    enviar(form)
    enviar(form)
    enviar(form)
    expect(botao.disabled).toBe(true)
    expect(botao.textContent).toBe('Enviando…')
    await esperar()
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(1)
    liberar(json(PEDIDO_OK))
    await vi.waitFor(() => expect(botao.disabled).toBe(false))
    expect(botao.textContent).toBe('Enviar e ver o código Pix')
  })

  it('a API recusa por validação (422): cada motivo vai para o seu campo, o foco vai ao primeiro e o que foi digitado fica', async () => {
    const { form } = await preparar(() =>
      json(
        {
          detail: [
            {
              type: 'value_error',
              loc: ['body', 'email'],
              msg: 'Value error, Esse e-mail não parece certo: confira se está escrito sem erro.',
            },
            {
              type: 'value_error',
              loc: ['body', 'valor'],
              msg: 'Value error, O valor da doação precisa ser maior que zero.',
            },
          ],
        },
        422,
      ),
    )
    preencherTudo(form, { valor: '50' })
    enviar(form)
    await vi.waitFor(() =>
      expect(
        form.querySelector<HTMLElement>('[data-erro="email"]')!.hidden,
      ).toBe(false),
    )
    expect(form.querySelector('[data-erro="email"]')!.textContent).toBe(
      'Esse e-mail não parece certo: confira se está escrito sem erro.',
    )
    expect(form.querySelector('[data-erro="valor"]')!.textContent).toBe(
      'O valor da doação precisa ser maior que zero.',
    )
    expect(campo(form, 'email').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(campo(form, 'email'))
    expect(campo(form, 'nome_completo').value).toBe('Maria de Teste')
    expect(form.querySelector('[data-resumo-de-erros]')!.textContent).toBe(
      'Há 2 campos para corrigir.',
    )
  })

  for (const [rotulo, status, detalhe, esperado] of [
    [
      '429 (limite por hora)',
      429,
      'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.',
      'Muitas tentativas - aguarde 60 minutos antes de tentar novamente. Se preferir, fale com a secretaria.',
    ],
    [
      '503 (Pix fechado depois que a página abriu)',
      503,
      'A doação pelo site ainda não está disponível. Fale com a secretaria da associação.',
      'A doação pelo site ainda não está disponível. Fale com a secretaria da associação.',
    ],
    [
      'aviso desatualizado',
      422,
      'O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.',
      'O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.',
    ],
    [
      'campanha encerrada',
      400,
      'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
      'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
    ],
  ] as const) {
    it(`${rotulo}: a frase humana num alerta, o foco nele, e dá para tentar de novo sem perder nada`, async () => {
      const { form } = await preparar(() => json({ detail: detalhe }, status))
      preencherTudo(form)
      enviar(form)
      const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')!
      await vi.waitFor(() => expect(falha.hidden).toBe(false))
      expect(falha.textContent).toBe(esperado)
      expect(falha.getAttribute('role')).toBe('alert')
      expect(document.activeElement).toBe(falha)
      expect(campo(form, 'nome_completo').value).toBe('Maria de Teste')
      expect(
        form.querySelector<HTMLButtonElement>('[data-enviar]')!.disabled,
      ).toBe(false)
      expect((form as HTMLElement).hidden).toBe(false)
    })
  }

  it('sem rede: orientação humana com a garantia do mesmo protocolo e a saída pela secretaria', async () => {
    const { form } = await preparar(() => {
      throw new TypeError('Failed to fetch')
    })
    preencherTudo(form)
    enviar(form)
    const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')!
    await vi.waitFor(() => expect(falha.hidden).toBe(false))
    expect(falha.textContent).toContain(
      'Não foi possível enviar o seu pedido agora',
    )
    expect(falha.textContent).toContain('você recebe o mesmo protocolo')
    expect(falha.textContent).toContain('fale com a secretaria')
  })

  it('a falha some quando a pessoa envia de novo', async () => {
    let tentativa = 0
    const { raiz, form } = await preparar(() =>
      ++tentativa === 1
        ? json({ detail: 'Erro interno do servidor.' }, 500)
        : json(PEDIDO_OK),
    )
    preencherTudo(form)
    enviar(form)
    const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')!
    await vi.waitFor(() => expect(falha.hidden).toBe(false))
    enviar(form)
    expect(falha.hidden).toBe(true)
    await vi.waitFor(() =>
      expect(visivel(raiz, '[data-confirmacao-identificada]')).toBe(true),
    )
  })

  it('o aviso de privacidade não aceito não envia e nada vai para localStorage', async () => {
    const { form, chamadas } = await preparar()
    preencherTudo(form, { sem_aceite: 'sim' })
    enviar(form)
    expect(
      form.querySelector('[data-erro="consentimento_lgpd"]')!.textContent,
    ).toContain('aceitar o aviso de privacidade')
    expect(document.activeElement).toBe(campo(form, 'consentimento_lgpd'))
    expect(chamadas).toHaveLength(1)
    expect(localStorage.length + sessionStorage.length).toBe(0)
  })
})
