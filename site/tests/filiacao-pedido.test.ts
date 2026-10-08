// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { ApiError, enviarJson } from '../src/lib/api'
import {
  cpfValido,
  idadeEm,
  iniciarFormularioDeFiliacao,
  mensagemDeFalhaDoEnvio,
  montarCorpo,
  precisaDeAutorizacao,
  validarPedido,
  VERSAO_DO_AVISO_DE_PRIVACIDADE,
  type ValoresDoPedido,
} from '../src/lib/filiacao-pedido'

// 8/out/2026, meio-dia em Parauapebas.
const HOJE = new Date(2026, 9, 8, 12, 0, 0)

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const valoresOk = (extra: Partial<ValoresDoPedido> = {}): ValoresDoPedido => ({
  nome_completo: 'Maria de Teste Silva',
  cpf: '111.444.777-35',
  data_nascimento: '1990-05-10',
  email_contato: 'maria@example.com',
  telefone_whatsapp: '(91) 98888-7777',
  autorizacao_responsavel: false,
  consentimento_lgpd: true,
  ...extra,
})

describe('cpfValido', () => {
  it('aceita CPF com ou sem pontuação e recusa dígito errado, repetido e curto', () => {
    expect(cpfValido('111.444.777-35')).toBe(true)
    expect(cpfValido('11144477735')).toBe(true)
    expect(cpfValido('111.444.777-36')).toBe(false)
    expect(cpfValido('11111111111')).toBe(false)
    expect(cpfValido('1114447773')).toBe(false)
    expect(cpfValido('')).toBe(false)
  })
})

describe('idadeEm / precisaDeAutorizacao', () => {
  it('conta o aniversário só quando chega', () => {
    expect(idadeEm('2008-10-08', HOJE)).toBe(18)
    expect(idadeEm('2008-10-09', HOJE)).toBe(17)
    expect(idadeEm('2010-10-08', HOJE)).toBe(16)
    expect(idadeEm('2010-10-09', HOJE)).toBe(15)
  })

  it('data que não existe ou que está no futuro não é idade', () => {
    expect(idadeEm('2026-02-30', HOJE)).toBeNull()
    expect(idadeEm('2027-01-01', HOJE)).toBeNull()
    expect(idadeEm('10/05/1990', HOJE)).toBeNull()
    expect(idadeEm('', HOJE)).toBeNull()
  })

  it('só de 16 a 17 anos precisa da autorização dos responsáveis', () => {
    expect(precisaDeAutorizacao('2010-10-08', HOJE)).toBe(true)
    expect(precisaDeAutorizacao('2008-10-09', HOJE)).toBe(true)
    expect(precisaDeAutorizacao('2008-10-08', HOJE)).toBe(false)
    expect(precisaDeAutorizacao('2010-10-09', HOJE)).toBe(false)
    expect(precisaDeAutorizacao('', HOJE)).toBe(false)
  })
})

describe('validarPedido', () => {
  it('pedido certo não tem erro', () => {
    expect(validarPedido(valoresOk(), HOJE)).toEqual({})
  })

  it('aponta cada campo que está errado, em português', () => {
    const erros = validarPedido(
      valoresOk({
        nome_completo: 'Ma',
        cpf: '123',
        data_nascimento: '',
        email_contato: 'sem-arroba',
        telefone_whatsapp: '123',
        consentimento_lgpd: false,
      }),
      HOJE,
    )
    expect(Object.keys(erros).sort()).toEqual(
      [
        'consentimento_lgpd',
        'cpf',
        'data_nascimento',
        'email_contato',
        'nome_completo',
        'telefone_whatsapp',
      ].sort(),
    )
    expect(erros.nome_completo).toContain('nome completo')
    expect(erros.consentimento_lgpd).toContain('aviso de privacidade')
  })

  it('pede pelo menos um contato: o e-mail ou o telefone', () => {
    const erros = validarPedido(
      valoresOk({ email_contato: '', telefone_whatsapp: '' }),
      HOJE,
    )
    expect(erros.contato).toContain('e-mail ou um telefone')
    expect(validarPedido(valoresOk({ email_contato: '' }), HOJE)).toEqual({})
    expect(validarPedido(valoresOk({ telefone_whatsapp: '' }), HOJE)).toEqual(
      {},
    )
  })

  it('telefone: 10 dígitos (fixo) ou 11 com 9 depois do DDD (celular)', () => {
    const t = (telefone_whatsapp: string) =>
      validarPedido(valoresOk({ telefone_whatsapp }), HOJE).telefone_whatsapp
    expect(t('9133334444')).toBeUndefined()
    expect(t('91988887777')).toBeUndefined()
    expect(t('91388887777')).toBeDefined()
    expect(t('0988887777')).toBeDefined()
  })

  it('menor de 16 anos não passa, nem com a declaração', () => {
    const erros = validarPedido(
      valoresOk({
        data_nascimento: '2010-10-09',
        autorizacao_responsavel: true,
      }),
      HOJE,
    )
    expect(erros.data_nascimento).toContain('a partir dos 16 anos')
  })

  it('de 16 a 17 anos só com a declaração da autorização', () => {
    const sem = validarPedido(
      valoresOk({ data_nascimento: '2010-10-08' }),
      HOJE,
    )
    expect(sem.autorizacao_responsavel).toContain('pais ou responsáveis')
    const com = validarPedido(
      valoresOk({
        data_nascimento: '2010-10-08',
        autorizacao_responsavel: true,
      }),
      HOJE,
    )
    expect(com).toEqual({})
  })
})

describe('montarCorpo', () => {
  it('manda só dígitos no CPF e no telefone, a versão do aviso e a armadilha vazia', () => {
    const corpo = montarCorpo(valoresOk({ nome_completo: '  Maria   Silva ' }))
    expect(corpo).toMatchObject({
      nome_completo: 'Maria Silva',
      cpf: '11144477735',
      telefone_whatsapp: '91988887777',
      email_contato: 'maria@example.com',
      data_nascimento: '1990-05-10',
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO_DE_PRIVACIDADE,
      autorizacao_responsavel: false,
      pagina_web: '',
    })
  })

  it('o que ficou em branco não vai no corpo', () => {
    const corpo = montarCorpo(valoresOk({ email_contato: '  ' }))
    expect(corpo).not.toHaveProperty('email_contato')
  })
})

describe('enviarJson', () => {
  it('manda POST com JSON, sem cookie, e devolve a resposta', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta({ ok: true }))
    const dados = await enviarJson(
      '/api/x',
      { a: 1 },
      {
        baseUrl: 'https://api.teste',
        fetchImpl,
      },
    )
    expect(dados).toEqual({ ok: true })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.teste/api/x')
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      body: '{"a":1}',
    })
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })

  it('o motivo que a API dá (texto) vira `detalhe` do erro', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(resposta({ detail: 'Já existe um pedido.' }, 400))
    const erro = await enviarJson(
      '/x',
      {},
      {
        baseUrl: 'https://a.org',
        fetchImpl,
      },
    ).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ApiError)
    expect((erro as ApiError).status).toBe(400)
    expect((erro as ApiError).detalhe).toBe('Já existe um pedido.')
  })

  it('erro de validação (lista) fica com a primeira mensagem, sem o prefixo em inglês', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta(
        {
          detail: [
            {
              msg: 'Value error, CPF inválido (dígito verificador não confere).',
            },
          ],
        },
        422,
      ),
    )
    const erro = (await enviarJson(
      '/x',
      {},
      {
        baseUrl: 'https://a.org',
        fetchImpl,
      },
    ).catch((e: unknown) => e)) as ApiError
    expect(erro.detalhe).toBe('CPF inválido (dígito verificador não confere).')
  })

  it('NÃO repete o envio quando dá erro de servidor (repetir criaria pedido duplicado)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta({}, 503))
    await expect(
      enviarJson('/x', {}, { baseUrl: 'https://a.org', fetchImpl }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falha de rede e tempo esgotado viram ApiError, sem detalhe', async () => {
    const rede = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const erroDeRede = (await enviarJson(
      '/x',
      {},
      {
        baseUrl: 'https://a.org',
        fetchImpl: rede,
      },
    ).catch((e: unknown) => e)) as ApiError
    expect(erroDeRede.detalhe).toBeUndefined()
    const lenta = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, falha) =>
          init?.signal?.addEventListener('abort', () =>
            falha(new DOMException('abortado', 'AbortError')),
          ),
        ),
    )
    await expect(
      enviarJson(
        '/x',
        {},
        {
          baseUrl: 'https://a.org',
          fetchImpl: lenta,
          timeoutMs: 20,
        },
      ),
    ).rejects.toThrow('demorou demais')
  })
})

describe('mensagemDeFalhaDoEnvio', () => {
  it('mostra o motivo da API quando há; senão, uma orientação que não culpa a pessoa', () => {
    expect(
      mensagemDeFalhaDoEnvio(new ApiError('x', 400, 'Já existe um pedido.')),
    ).toBe('Já existe um pedido.')
    expect(mensagemDeFalhaDoEnvio(new ApiError('x', 429))).toContain(
      'Muitos pedidos',
    )
    expect(mensagemDeFalhaDoEnvio(new ApiError('x', 503))).toContain(
      'fale com a secretaria',
    )
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// O formulário no DOM (o HTML real é o de FormularioDeFiliacao.astro; aqui só os pontos que o comportamento usa)
function montar(): { form: HTMLFormElement; confirmacao: HTMLElement } {
  document.body.innerHTML = `
    <form data-api-url="https://api.teste" data-confirmacao="#enviado" novalidate>
      <p data-resumo-de-erros role="alert" hidden></p>
      <input name="nome_completo"><p data-erro="nome_completo" hidden></p>
      <input name="cpf"><p data-erro="cpf" hidden></p>
      <input name="data_nascimento" type="date"><p data-erro="data_nascimento" hidden></p>
      <div data-bloco-autorizacao hidden>
        <input name="autorizacao_responsavel" type="checkbox"><p data-erro="autorizacao_responsavel" hidden></p>
      </div>
      <input name="email_contato"><p data-erro="email_contato" hidden></p>
      <input name="telefone_whatsapp"><p data-erro="telefone_whatsapp" hidden></p>
      <p data-erro="contato" hidden></p>
      <input name="consentimento_lgpd" type="checkbox"><p data-erro="consentimento_lgpd" hidden></p>
      <input name="pagina_web" tabindex="-1">
      <p data-falha-do-envio hidden tabindex="-1"></p>
      <button type="submit" data-enviar>Enviar pedido de filiação</button>
    </form>
    <div id="enviado" tabindex="-1" hidden></div>`
  return {
    form: document.querySelector('form')!,
    confirmacao: document.querySelector<HTMLElement>('#enviado')!,
  }
}

function preencher(form: HTMLFormElement, v: ValoresDoPedido): void {
  const c = (n: string) => form.elements.namedItem(n) as HTMLInputElement
  c('nome_completo').value = v.nome_completo
  c('cpf').value = v.cpf
  c('data_nascimento').value = v.data_nascimento
  c('data_nascimento').dispatchEvent(new Event('input'))
  c('email_contato').value = v.email_contato
  c('telefone_whatsapp').value = v.telefone_whatsapp
  c('autorizacao_responsavel').checked = v.autorizacao_responsavel
  c('consentimento_lgpd').checked = v.consentimento_lgpd
}

const enviar = (form: HTMLFormElement) =>
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
const esperar = () => new Promise((r) => setTimeout(r, 0))
const textoDe = (seletor: string) =>
  document.querySelector<HTMLElement>(seletor)!

describe('iniciarFormularioDeFiliacao', () => {
  it('com erro no preenchimento não chama a API: mostra o resumo, as mensagens e foca o primeiro campo errado', () => {
    const { form } = montar()
    const fetchImpl = vi.fn()
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl })
    enviar(form)
    expect(fetchImpl).not.toHaveBeenCalled()
    const resumo = textoDe('[data-resumo-de-erros]')
    expect(resumo.hidden).toBe(false)
    expect(resumo.textContent).toMatch(/^Há \d+ campos para corrigir\.$/)
    expect(textoDe('[data-erro="cpf"]').textContent).toContain('CPF')
    const nome = form.elements.namedItem('nome_completo') as HTMLInputElement
    expect(nome.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(nome)
  })

  it('quem corrige um campo vê o aviso dele sumir e o resumo acompanhar, sem esperar o próximo envio', () => {
    const { form } = montar()
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl: vi.fn() })
    enviar(form)
    const resumo = textoDe('[data-resumo-de-erros]')
    const total = Number(/\d+/.exec(resumo.textContent ?? '')![0])
    const nome = form.elements.namedItem('nome_completo') as HTMLInputElement
    nome.value = 'Maria de Teste'
    nome.dispatchEvent(new Event('input', { bubbles: true }))
    expect(textoDe('[data-erro="nome_completo"]').hidden).toBe(true)
    expect(nome.hasAttribute('aria-invalid')).toBe(false)
    expect(resumo.textContent).toBe(
      total - 1 === 1
        ? 'Há 1 campo para corrigir.'
        : `Há ${total - 1} campos para corrigir.`,
    )
    // o erro "sem contato" some quando se digita em qualquer um dos dois campos de contato
    const email = form.elements.namedItem('email_contato') as HTMLInputElement
    email.value = 'a@b.co'
    email.dispatchEvent(new Event('input', { bubbles: true }))
    expect(textoDe('[data-erro="contato"]').hidden).toBe(true)
  })

  it('só mostra a declaração da autorização para quem tem 16 ou 17 anos', () => {
    const { form } = montar()
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl: vi.fn() })
    const bloco = textoDe('[data-bloco-autorizacao]')
    const nascimento = form.elements.namedItem(
      'data_nascimento',
    ) as HTMLInputElement
    nascimento.value = '2010-10-08'
    nascimento.dispatchEvent(new Event('input'))
    expect(bloco.hidden).toBe(false)
    nascimento.value = '1990-05-10'
    nascimento.dispatchEvent(new Event('input'))
    expect(bloco.hidden).toBe(true)
  })

  it('pedido certo: manda o corpo à API, esconde o formulário e mostra a confirmação', async () => {
    const { form, confirmacao } = montar()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(resposta({ mensagem: 'ok', id_proposta: 7 }))
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl })
    preencher(form, valoresOk())
    enviar(form)
    await esperar()
    await esperar()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.teste/api/filiacao/propor')
    expect(JSON.parse(init.body as string)).toMatchObject({
      cpf: '11144477735',
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO_DE_PRIVACIDADE,
      pagina_web: '',
    })
    expect(form.hidden).toBe(true)
    expect(confirmacao.hidden).toBe(false)
    expect(document.activeElement).toBe(confirmacao)
  })

  it('quem marcou a autorização e depois corrigiu a data para maior de idade não manda a marca', async () => {
    const { form } = montar()
    const fetchImpl = vi.fn().mockResolvedValue(resposta({ id_proposta: 1 }))
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl })
    preencher(form, valoresOk({ autorizacao_responsavel: true }))
    enviar(form)
    await esperar()
    await esperar()
    expect(
      JSON.parse(fetchImpl.mock.calls[0]![1].body as string)
        .autorizacao_responsavel,
    ).toBe(false)
  })

  it('o campo escondido preenchido por um robô segue no corpo, para a API descartar', async () => {
    const { form } = montar()
    const fetchImpl = vi.fn().mockResolvedValue(resposta({ id_proposta: null }))
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl })
    preencher(form, valoresOk())
    ;(form.elements.namedItem('pagina_web') as HTMLInputElement).value =
      'http://spam.example'
    enviar(form)
    await esperar()
    await esperar()
    expect(
      JSON.parse(fetchImpl.mock.calls[0]![1].body as string).pagina_web,
    ).toBe('http://spam.example')
  })

  it('a API recusa: mostra o motivo, mantém o formulário preenchido e libera o botão', async () => {
    const { form, confirmacao } = montar()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        resposta({ detail: 'Já existe um pedido em andamento.' }, 400),
      )
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl })
    preencher(form, valoresOk())
    enviar(form)
    await esperar()
    await esperar()
    const falha = textoDe('[data-falha-do-envio]')
    expect(falha.hidden).toBe(false)
    expect(falha.textContent).toBe('Já existe um pedido em andamento.')
    expect(form.hidden).toBe(false)
    expect(confirmacao.hidden).toBe(true)
    expect(
      (form.elements.namedItem('nome_completo') as HTMLInputElement).value,
    ).toBe('Maria de Teste Silva')
    const botao = textoDe('[data-enviar]') as HTMLButtonElement
    expect(botao.disabled).toBe(false)
    expect(botao.textContent).toBe('Enviar pedido de filiação')
  })

  it('enquanto envia, o botão fica travado (um clique duplo não cria dois pedidos)', async () => {
    const { form } = montar()
    let liberar: (r: Response) => void = () => undefined
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolver) => (liberar = resolver)),
    )
    iniciarFormularioDeFiliacao(form, { hoje: () => HOJE, fetchImpl })
    preencher(form, valoresOk())
    enviar(form)
    const botao = textoDe('[data-enviar]') as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(botao.textContent).toBe('Enviando…')
    expect(form.getAttribute('aria-busy')).toBe('true')
    liberar(resposta({ id_proposta: 1 }))
    await esperar()
    await esperar()
    expect(form.hasAttribute('aria-busy')).toBe(false)
  })
})
