// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../src/lib/api'
import {
  buscarPrazos,
  DIREITOS_DO_TITULAR,
  iniciarFormularioDeAtendimento,
  mensagemDeFalhaDoEnvio,
  montarCorpo,
  textoDoPrazo,
  validarPedido,
  VERSAO_DO_AVISO_DE_PRIVACIDADE_DO_ATENDIMENTO,
  type TipoDePedido,
  type ValoresDoPedido,
} from '../src/lib/atendimento-pedido'

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const PRAZOS = { CONTATO: 10, PEDIDO_INFORMACAO: 20, TITULAR_LGPD: 15 }

const valoresOk = (
  tipo: TipoDePedido,
  extra: Partial<ValoresDoPedido> = {},
): ValoresDoPedido => ({
  tipo,
  subtipo: tipo === 'TITULAR_LGPD' ? 'ACESSO' : '',
  assunto: tipo === 'TITULAR_LGPD' ? '' : 'Dúvida sobre os projetos',
  mensagem: 'Gostaria de saber mais sobre os projetos da associação.',
  nome_completo: 'Maria de Teste Silva',
  email_contato: 'maria@example.com',
  telefone_whatsapp: '(91) 98888-7777',
  cpf: tipo === 'TITULAR_LGPD' ? '111.444.777-35' : '',
  consentimento_lgpd: true,
  ...extra,
})

describe('versão do aviso de privacidade', () => {
  it('é a 1: a mesma que a API conhece (mudou o texto, muda o número nos dois lados)', () => {
    expect(VERSAO_DO_AVISO_DE_PRIVACIDADE_DO_ATENDIMENTO).toBe('1')
  })
})

describe('DIREITOS_DO_TITULAR', () => {
  it('são os oito pedidos da API, com os rótulos que a pessoa lê', () => {
    expect(DIREITOS_DO_TITULAR.map((d) => d.valor)).toEqual([
      'CONFIRMACAO',
      'ACESSO',
      'CORRECAO',
      'ELIMINACAO',
      'PORTABILIDADE',
      'COMPARTILHAMENTO',
      'REVOGACAO',
      'OUTRO',
    ])
    expect(DIREITOS_DO_TITULAR.map((d) => d.rotulo)).toEqual([
      'Confirmar se a associação trata dados meus',
      'Acessar os dados que a associação tem sobre mim',
      'Corrigir dados incompletos, inexatos ou desatualizados',
      'Anonimizar, bloquear ou eliminar dados desnecessários ou tratados sem base legal',
      'Receber meus dados para levar a outra entidade (portabilidade)',
      'Saber com quem a associação compartilhou meus dados',
      'Retirar um consentimento que dei',
      'Outro pedido sobre os meus dados pessoais',
    ])
  })
})

describe('validarPedido', () => {
  it('pedido certo, de cada tipo, não tem erro', () => {
    for (const tipo of [
      'CONTATO',
      'PEDIDO_INFORMACAO',
      'TITULAR_LGPD',
    ] as const) {
      expect(validarPedido(valoresOk(tipo))).toEqual({})
    }
  })

  it('contato e pedido de informação NÃO pedem CPF nem o direito do titular', () => {
    for (const tipo of ['CONTATO', 'PEDIDO_INFORMACAO'] as const) {
      expect(validarPedido(valoresOk(tipo, { cpf: '', subtipo: '' }))).toEqual(
        {},
      )
      // um CPF errado que sobrou no campo (de outro formulário) nem é olhado
      expect(validarPedido(valoresOk(tipo, { cpf: '123' }))).toEqual({})
    }
  })

  it('contato e pedido de informação exigem o assunto (3 a 150 letras)', () => {
    for (const tipo of ['CONTATO', 'PEDIDO_INFORMACAO'] as const) {
      expect(validarPedido(valoresOk(tipo, { assunto: '' })).assunto).toContain(
        'Informe o assunto',
      )
      expect(
        validarPedido(valoresOk(tipo, { assunto: '  ab  ' })).assunto,
      ).toBeDefined()
      expect(
        validarPedido(valoresOk(tipo, { assunto: 'abc' })).assunto,
      ).toBeUndefined()
      expect(
        validarPedido(valoresOk(tipo, { assunto: 'a'.repeat(150) })).assunto,
      ).toBeUndefined()
      expect(
        validarPedido(valoresOk(tipo, { assunto: 'a'.repeat(151) })).assunto,
      ).toContain('comprido demais')
    }
  })

  it('a solicitação do titular exige CPF com dígito verificador e o direito escolhido, mas não o assunto', () => {
    const t = (extra: Partial<ValoresDoPedido>) =>
      validarPedido(valoresOk('TITULAR_LGPD', extra))
    expect(t({ cpf: '' }).cpf).toBe('Informe o seu CPF.')
    expect(t({ cpf: '111.444.777-36' }).cpf).toContain('não confere')
    expect(t({ cpf: '11111111111' }).cpf).toContain('não confere')
    expect(t({ cpf: '11144477735' }).cpf).toBeUndefined()
    expect(t({ subtipo: '' }).subtipo).toContain('Escolha o que você quer')
    expect(t({ subtipo: 'APAGAR_TUDO' }).subtipo).toBeDefined()
    for (const direito of DIREITOS_DO_TITULAR) {
      expect(t({ subtipo: direito.valor }).subtipo).toBeUndefined()
    }
    expect(t({ assunto: '' }).assunto).toBeUndefined()
  })

  it('a mensagem tem de 10 a 4.000 letras (contadas como a API conta: um emoji vale uma)', () => {
    const m = (mensagem: string) =>
      validarPedido(valoresOk('CONTATO', { mensagem })).mensagem
    expect(m('')).toContain('pelo menos 10 letras')
    expect(m('123456789')).toContain('pelo menos 10 letras')
    expect(m('   123456789   ')).toBeDefined()
    expect(m('1234567890')).toBeUndefined()
    expect(m('😀'.repeat(10))).toBeUndefined()
    expect(m('a'.repeat(4000))).toBeUndefined()
    expect(m('😀'.repeat(4000))).toBeUndefined()
    expect(m('a'.repeat(4001))).toContain('4.000 letras')
  })

  it('o nome precisa de pelo menos 3 letras', () => {
    const n = (nome_completo: string) =>
      validarPedido(valoresOk('CONTATO', { nome_completo })).nome_completo
    expect(n('Ma')).toContain('nome completo')
    expect(n('  Ma  ')).toBeDefined()
    expect(n('Ana')).toBeUndefined()
    expect(n('a'.repeat(151))).toContain('comprido demais')
  })

  it('pede pelo menos um contato: o e-mail ou o telefone', () => {
    const erros = validarPedido(
      valoresOk('CONTATO', { email_contato: '', telefone_whatsapp: '' }),
    )
    expect(erros.contato).toContain('e-mail ou um telefone')
    expect(validarPedido(valoresOk('CONTATO', { email_contato: '' }))).toEqual(
      {},
    )
    expect(
      validarPedido(valoresOk('CONTATO', { telefone_whatsapp: '' })),
    ).toEqual({})
  })

  it('e-mail e telefone que não parecem certos são apontados', () => {
    const erros = validarPedido(
      valoresOk('CONTATO', {
        email_contato: 'sem-arroba',
        telefone_whatsapp: '123',
      }),
    )
    expect(erros.email_contato).toContain('e-mail')
    expect(erros.telefone_whatsapp).toContain('10 ou 11 dígitos')
    expect(erros.contato).toBeUndefined()
    const t = (telefone_whatsapp: string) =>
      validarPedido(valoresOk('CONTATO', { telefone_whatsapp }))
        .telefone_whatsapp
    expect(t('9133334444')).toBeUndefined()
    expect(t('91988887777')).toBeUndefined()
    expect(t('91388887777')).toBeDefined()
    expect(t('0988887777')).toBeDefined()
  })

  it('sem o aceite do aviso de privacidade não envia', () => {
    const erros = validarPedido(
      valoresOk('CONTATO', { consentimento_lgpd: false }),
    )
    expect(erros.consentimento_lgpd).toContain('aviso de privacidade')
  })

  it('formulário em branco aponta todos os campos do tipo, em português', () => {
    const vazio = (tipo: TipoDePedido): ValoresDoPedido => ({
      tipo,
      subtipo: '',
      assunto: '',
      mensagem: '',
      nome_completo: '',
      email_contato: '',
      telefone_whatsapp: '',
      cpf: '',
      consentimento_lgpd: false,
    })
    expect(Object.keys(validarPedido(vazio('CONTATO'))).sort()).toEqual([
      'assunto',
      'consentimento_lgpd',
      'contato',
      'mensagem',
      'nome_completo',
    ])
    expect(Object.keys(validarPedido(vazio('TITULAR_LGPD'))).sort()).toEqual([
      'consentimento_lgpd',
      'contato',
      'cpf',
      'mensagem',
      'nome_completo',
      'subtipo',
    ])
  })
})

describe('montarCorpo', () => {
  it('contato: assunto e mensagem limpos, só dígitos no telefone, versão do aviso e armadilha vazia; sem CPF nem subtipo', () => {
    const corpo = montarCorpo(
      valoresOk('CONTATO', {
        nome_completo: '  Maria   Silva ',
        assunto: '  Dúvida   geral ',
        mensagem: '  Olá,\n\ngostaria de ajudar.  ',
        cpf: '111.444.777-35',
        subtipo: 'ACESSO',
      }),
    )
    expect(corpo).toEqual({
      tipo: 'CONTATO',
      assunto: 'Dúvida geral',
      mensagem: 'Olá,\n\ngostaria de ajudar.',
      nome_completo: 'Maria Silva',
      email_contato: 'maria@example.com',
      telefone_whatsapp: '91988887777',
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO_DE_PRIVACIDADE_DO_ATENDIMENTO,
      pagina_web: '',
    })
  })

  it('pedido de informação segue o mesmo desenho do contato', () => {
    const corpo = montarCorpo(valoresOk('PEDIDO_INFORMACAO'))
    expect(corpo.tipo).toBe('PEDIDO_INFORMACAO')
    expect(corpo).toHaveProperty('assunto', 'Dúvida sobre os projetos')
    expect(corpo).not.toHaveProperty('cpf')
    expect(corpo).not.toHaveProperty('subtipo')
  })

  it('solicitação do titular: CPF só com dígitos e o direito escolhido, sem assunto', () => {
    const corpo = montarCorpo(valoresOk('TITULAR_LGPD', { assunto: 'x' }))
    expect(corpo).toMatchObject({
      tipo: 'TITULAR_LGPD',
      subtipo: 'ACESSO',
      cpf: '11144477735',
    })
    expect(corpo).not.toHaveProperty('assunto')
  })

  it('o que ficou em branco não vai no corpo', () => {
    const sem = montarCorpo(valoresOk('CONTATO', { email_contato: '  ' }))
    expect(sem).not.toHaveProperty('email_contato')
    const semTelefone = montarCorpo(
      valoresOk('CONTATO', { telefone_whatsapp: '' }),
    )
    expect(semTelefone).not.toHaveProperty('telefone_whatsapp')
  })

  it('leva o que está na armadilha de robô', () => {
    expect(
      montarCorpo(valoresOk('CONTATO'), 'http://spam.example'),
    ).toMatchObject({ pagina_web: 'http://spam.example' })
  })
})

describe('mensagemDeFalhaDoEnvio', () => {
  it('mostra o motivo da API quando há; senão, uma orientação que não culpa a pessoa', () => {
    expect(
      mensagemDeFalhaDoEnvio(new ApiError('x', 422, 'Informe o assunto.')),
    ).toBe('Informe o assunto.')
    expect(mensagemDeFalhaDoEnvio(new ApiError('x', 429))).toContain(
      'Muitos pedidos',
    )
    expect(mensagemDeFalhaDoEnvio(new ApiError('x', 503))).toContain(
      'fale com a associação',
    )
    expect(
      mensagemDeFalhaDoEnvio(new ApiError('Não foi possível falar com a API.')),
    ).toContain('Não foi possível enviar o pedido agora')
    expect(mensagemDeFalhaDoEnvio(new Error('qualquer coisa'))).toContain(
      'Não foi possível enviar o pedido agora',
    )
  })
})

describe('textoDoPrazo', () => {
  it('diz os dias e a data (no horário de Parauapebas, o prazo da API é UTC sem fuso)', () => {
    expect(textoDoPrazo(10, '2026-10-19T14:30:00.123456')).toBe(
      'Respondemos em até 10 dias (até 19 de outubro de 2026).',
    )
    // 1h da manhã em UTC ainda é o dia anterior em Parauapebas
    expect(textoDoPrazo(15, '2026-10-24T01:00:00')).toBe(
      'Respondemos em até 15 dias (até 23 de outubro de 2026).',
    )
  })

  it('sem a data, só os dias; um dia só no singular', () => {
    expect(textoDoPrazo(20)).toBe('Respondemos em até 20 dias.')
    expect(textoDoPrazo(1)).toBe('Respondemos em até 1 dia.')
    expect(textoDoPrazo(10, null)).toBe('Respondemos em até 10 dias.')
    expect(textoDoPrazo(10, 'lixo')).toBe('Respondemos em até 10 dias.')
  })

  it('sem um número de dias válido não há texto (nunca um prazo inventado)', () => {
    for (const dias of [null, undefined, 0, -3, 2.5, '10', Number.NaN]) {
      expect(textoDoPrazo(dias, '2026-10-19T14:30:00')).toBeNull()
    }
  })
})

describe('buscarPrazos', () => {
  it('devolve os dias de cada tipo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(PRAZOS))
    await expect(
      buscarPrazos({ baseUrl: 'https://api.teste', fetchImpl }),
    ).resolves.toEqual(PRAZOS)
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.teste/api/publico/atendimentos/prazos',
    )
  })

  it('só aceita número inteiro maior que zero; o resto fica de fora', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta({
        CONTATO: 10,
        PEDIDO_INFORMACAO: '20',
        TITULAR_LGPD: 0,
        VOLUNTARIO: 10,
      }),
    )
    await expect(
      buscarPrazos({ baseUrl: 'https://api.teste', fetchImpl }),
    ).resolves.toEqual({ CONTATO: 10 })
  })

  it('falha em silêncio: sem a API (ou com API antiga, 404) devolve um objeto vazio', async () => {
    const rede = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(
      buscarPrazos({
        baseUrl: 'https://api.teste',
        fetchImpl: rede,
        esperaEntreTentativasMs: 0,
      }),
    ).resolves.toEqual({})
    const antiga = vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404))
    await expect(
      buscarPrazos({ baseUrl: 'https://api.teste', fetchImpl: antiga }),
    ).resolves.toEqual({})
    expect(antiga).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// O formulário no DOM (o HTML real é o de FormularioDeAtendimento.astro; aqui só os pontos que o comportamento usa)
function montar(tipo: TipoDePedido = 'CONTATO'): {
  form: HTMLFormElement
  confirmacao: HTMLElement
} {
  const titular = tipo === 'TITULAR_LGPD'
  document.body.innerHTML = `
    <form data-tipo="${tipo}" data-api-url="https://api.teste" data-confirmacao="#enviado" novalidate>
      <p data-prazo hidden></p>
      <p data-resumo-de-erros role="alert" hidden></p>
      <input name="nome_completo"><p data-erro="nome_completo" hidden></p>
      <input name="email_contato"><p data-erro="email_contato" hidden></p>
      <input name="telefone_whatsapp"><p data-erro="telefone_whatsapp" hidden></p>
      <p data-erro="contato" hidden></p>
      ${titular ? '<input name="cpf"><p data-erro="cpf" hidden></p>' : ''}
      ${
        titular
          ? `<select name="subtipo"><option value="">Escolha</option>${DIREITOS_DO_TITULAR.map(
              (d) => `<option value="${d.valor}">${d.rotulo}</option>`,
            ).join('')}</select><p data-erro="subtipo" hidden></p>`
          : '<input name="assunto"><p data-erro="assunto" hidden></p>'
      }
      <textarea name="mensagem"></textarea>
      <p data-contador>0 de 4.000 letras</p>
      <p data-erro="mensagem" hidden></p>
      <input name="consentimento_lgpd" type="checkbox"><p data-erro="consentimento_lgpd" hidden></p>
      <input name="pagina_web" tabindex="-1">
      <p data-falha-do-envio hidden tabindex="-1"></p>
      <button type="submit" data-enviar>
        Enviar pedido
      </button>
    </form>
    <div id="enviado" tabindex="-1" hidden>
      <div data-bloco-do-protocolo hidden><strong data-protocolo></strong></div>
      <p data-prazo-da-resposta hidden></p>
    </div>`
  return {
    form: document.querySelector('form')!,
    confirmacao: document.querySelector<HTMLElement>('#enviado')!,
  }
}

function preencher(form: HTMLFormElement, v: ValoresDoPedido): void {
  const c = (n: string) =>
    form.elements.namedItem(n) as
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
  c('nome_completo')!.value = v.nome_completo
  c('email_contato')!.value = v.email_contato
  c('telefone_whatsapp')!.value = v.telefone_whatsapp
  if (c('cpf')) c('cpf')!.value = v.cpf
  if (c('subtipo')) c('subtipo')!.value = v.subtipo
  if (c('assunto')) c('assunto')!.value = v.assunto
  c('mensagem')!.value = v.mensagem
  ;(c('consentimento_lgpd') as HTMLInputElement).checked = v.consentimento_lgpd
}

const enviar = (form: HTMLFormElement) =>
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
const esperar = () => new Promise((r) => setTimeout(r, 0))
const textoDe = (seletor: string) =>
  document.querySelector<HTMLElement>(seletor)!
const campo = (form: HTMLFormElement, nome: string) =>
  form.elements.namedItem(nome) as HTMLInputElement

/** A consulta dos prazos vai separada do envio: o teste conta só o que importa. */
const prazosOk = () => vi.fn().mockResolvedValue(resposta(PRAZOS))

describe('iniciarFormularioDeAtendimento', () => {
  it('mostra "Respondemos em até N dias" com o prazo do tipo, vindo da API', async () => {
    for (const [tipo, dias] of Object.entries(PRAZOS)) {
      const { form } = montar(tipo as TipoDePedido)
      iniciarFormularioDeAtendimento(form, {
        fetchImpl: vi.fn(),
        fetchDosPrazos: prazosOk(),
      })
      await esperar()
      await esperar()
      const aviso = textoDe('[data-prazo]')
      expect(aviso.hidden).toBe(false)
      expect(aviso.textContent).toBe(`Respondemos em até ${dias} dias.`)
    }
  })

  it('sem o prazo (API fora do ar ou antiga), o texto some em silêncio e o formulário segue funcionando', async () => {
    const { form } = montar()
    iniciarFormularioDeAtendimento(form, {
      fetchImpl: vi.fn(),
      fetchDosPrazos: vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404)),
    })
    await esperar()
    await esperar()
    expect(textoDe('[data-prazo]').hidden).toBe(true)
    expect(textoDe('[data-prazo]').textContent).toBe('')
    enviar(form)
    expect(textoDe('[data-resumo-de-erros]').hidden).toBe(false)
  })

  it('com erro no preenchimento não chama a API: mostra o resumo, as mensagens e foca o primeiro campo errado', () => {
    const { form } = montar()
    const fetchImpl = vi.fn()
    iniciarFormularioDeAtendimento(form, {
      fetchImpl,
      fetchDosPrazos: prazosOk(),
    })
    enviar(form)
    expect(fetchImpl).not.toHaveBeenCalled()
    const resumo = textoDe('[data-resumo-de-erros]')
    expect(resumo.hidden).toBe(false)
    expect(resumo.textContent).toBe('Há 5 campos para corrigir.')
    expect(textoDe('[data-erro="assunto"]').textContent).toContain('assunto')
    expect(textoDe('[data-erro="mensagem"]').textContent).toContain(
      'pelo menos 10 letras',
    )
    expect(textoDe('[data-erro="contato"]').textContent).toContain(
      'e-mail ou um telefone',
    )
    expect(campo(form, 'nome_completo').getAttribute('aria-invalid')).toBe(
      'true',
    )
    // o erro "sem contato" marca os dois campos de contato
    expect(campo(form, 'email_contato').getAttribute('aria-invalid')).toBe(
      'true',
    )
    expect(document.activeElement).toBe(campo(form, 'nome_completo'))
  })

  it('o foco vai para o primeiro erro NA ORDEM DA PÁGINA (nome, contato, CPF, direito, mensagem, aceite)', () => {
    const { form } = montar('TITULAR_LGPD')
    iniciarFormularioDeAtendimento(form, {
      fetchImpl: vi.fn(),
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('TITULAR_LGPD', { cpf: '' }))
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'cpf'))
    preencher(form, valoresOk('TITULAR_LGPD', { subtipo: '' }))
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'subtipo'))
    preencher(
      form,
      valoresOk('TITULAR_LGPD', { email_contato: '', telefone_whatsapp: '' }),
    )
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'email_contato'))
    preencher(form, valoresOk('TITULAR_LGPD', { consentimento_lgpd: false }))
    enviar(form)
    expect(document.activeElement).toBe(campo(form, 'consentimento_lgpd'))
  })

  it('quem corrige um campo vê o aviso dele sumir e o resumo acompanhar, sem esperar o próximo envio', () => {
    const { form } = montar()
    iniciarFormularioDeAtendimento(form, {
      fetchImpl: vi.fn(),
      fetchDosPrazos: prazosOk(),
    })
    enviar(form)
    const nome = campo(form, 'nome_completo')
    nome.value = 'Maria de Teste'
    nome.dispatchEvent(new Event('input', { bubbles: true }))
    expect(textoDe('[data-erro="nome_completo"]').hidden).toBe(true)
    expect(nome.hasAttribute('aria-invalid')).toBe(false)
    expect(textoDe('[data-resumo-de-erros]').textContent).toBe(
      'Há 4 campos para corrigir.',
    )
    // o erro "sem contato" some quando se digita em qualquer um dos dois campos de contato
    const email = campo(form, 'email_contato')
    email.value = 'a@b.co'
    email.dispatchEvent(new Event('input', { bubbles: true }))
    expect(textoDe('[data-erro="contato"]').hidden).toBe(true)
    // e o da mensagem, no textarea
    const mensagem = campo(form, 'mensagem')
    mensagem.value = 'Uma mensagem com mais de dez letras.'
    mensagem.dispatchEvent(new Event('input', { bubbles: true }))
    expect(textoDe('[data-erro="mensagem"]').hidden).toBe(true)
  })

  it('o contador de letras acompanha o que se digita (conta como a API)', () => {
    const { form } = montar()
    iniciarFormularioDeAtendimento(form, {
      fetchImpl: vi.fn(),
      fetchDosPrazos: prazosOk(),
    })
    const contador = textoDe('[data-contador]')
    expect(contador.textContent).toBe('0 de 4.000 letras')
    const mensagem = campo(form, 'mensagem')
    mensagem.value = '  Olá 😀  '
    mensagem.dispatchEvent(new Event('input', { bubbles: true }))
    expect(contador.textContent).toBe('5 de 4.000 letras')
    mensagem.value = 'a'.repeat(1234)
    mensagem.dispatchEvent(new Event('input', { bubbles: true }))
    expect(contador.textContent).toBe('1.234 de 4.000 letras')
  })

  it('escolher o direito no select tira o aviso do campo', () => {
    const { form } = montar('TITULAR_LGPD')
    iniciarFormularioDeAtendimento(form, {
      fetchImpl: vi.fn(),
      fetchDosPrazos: prazosOk(),
    })
    enviar(form)
    expect(textoDe('[data-erro="subtipo"]').hidden).toBe(false)
    const select = form.elements.namedItem('subtipo') as HTMLSelectElement
    select.value = 'CORRECAO'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    expect(textoDe('[data-erro="subtipo"]').hidden).toBe(true)
  })

  it('pedido certo: manda o corpo à API, esconde o formulário e mostra a confirmação com protocolo e prazo', async () => {
    const { form, confirmacao } = montar()
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta({
        mensagem: 'Pedido recebido.',
        protocolo: 'ASAF-2026-00001',
        prazo_dias: 10,
        prazo_em: '2026-10-19T14:30:00.123456',
      }),
    )
    iniciarFormularioDeAtendimento(form, {
      fetchImpl,
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('CONTATO'))
    enviar(form)
    await esperar()
    await esperar()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.teste/api/publico/atendimentos')
    expect(JSON.parse(init.body as string)).toMatchObject({
      tipo: 'CONTATO',
      assunto: 'Dúvida sobre os projetos',
      telefone_whatsapp: '91988887777',
      consentimento_lgpd: true,
      versao_texto_consentimento: VERSAO_DO_AVISO_DE_PRIVACIDADE_DO_ATENDIMENTO,
      pagina_web: '',
    })
    expect(form.hidden).toBe(true)
    expect(confirmacao.hidden).toBe(false)
    expect(document.activeElement).toBe(confirmacao)
    expect(textoDe('[data-protocolo]').textContent).toBe('ASAF-2026-00001')
    expect(textoDe('[data-bloco-do-protocolo]').hidden).toBe(false)
    const prazo = textoDe('[data-prazo-da-resposta]')
    expect(prazo.hidden).toBe(false)
    expect(prazo.textContent).toBe(
      'Respondemos em até 10 dias (até 19 de outubro de 2026).',
    )
  })

  it('solicitação do titular: vai com o CPF só em dígitos e o direito escolhido', async () => {
    const { form } = montar('TITULAR_LGPD')
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta({
        protocolo: 'ASAF-2026-00002',
        prazo_dias: 15,
        prazo_em: '2026-10-24T12:00:00',
      }),
    )
    iniciarFormularioDeAtendimento(form, {
      fetchImpl,
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('TITULAR_LGPD', { subtipo: 'ELIMINACAO' }))
    enviar(form)
    await esperar()
    await esperar()
    const corpo = JSON.parse(fetchImpl.mock.calls[0]![1].body as string)
    expect(corpo).toMatchObject({
      tipo: 'TITULAR_LGPD',
      subtipo: 'ELIMINACAO',
      cpf: '11144477735',
    })
    expect(corpo).not.toHaveProperty('assunto')
  })

  it('a armadilha de robô disparou (protocolo nulo): a mesma tela de sucesso, sem o número nem o prazo', async () => {
    const { form, confirmacao } = montar()
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta({
        mensagem: 'Pedido recebido.',
        protocolo: null,
        prazo_dias: null,
        prazo_em: null,
      }),
    )
    iniciarFormularioDeAtendimento(form, {
      fetchImpl,
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('CONTATO'))
    ;(form.elements.namedItem('pagina_web') as HTMLInputElement).value =
      'http://spam.example'
    enviar(form)
    await esperar()
    await esperar()
    expect(
      JSON.parse(fetchImpl.mock.calls[0]![1].body as string).pagina_web,
    ).toBe('http://spam.example')
    expect(form.hidden).toBe(true)
    expect(confirmacao.hidden).toBe(false)
    expect(textoDe('[data-bloco-do-protocolo]').hidden).toBe(true)
    expect(textoDe('[data-prazo-da-resposta]').hidden).toBe(true)
  })

  it('a API recusa: mostra o motivo, mantém o formulário preenchido e libera o botão', async () => {
    const { form, confirmacao } = montar()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        resposta({ detail: 'Muitas tentativas - aguarde 60 minutos.' }, 429),
      )
    iniciarFormularioDeAtendimento(form, {
      fetchImpl,
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('CONTATO'))
    enviar(form)
    await esperar()
    await esperar()
    const falha = textoDe('[data-falha-do-envio]')
    expect(falha.hidden).toBe(false)
    expect(falha.textContent).toBe('Muitas tentativas - aguarde 60 minutos.')
    expect(document.activeElement).toBe(falha)
    expect(form.hidden).toBe(false)
    expect(confirmacao.hidden).toBe(true)
    expect(campo(form, 'nome_completo').value).toBe('Maria de Teste Silva')
    const botao = textoDe('[data-enviar]') as HTMLButtonElement
    expect(botao.disabled).toBe(false)
    expect(botao.textContent).toBe('Enviar pedido')
  })

  it('falha de rede: orientação sem culpar a pessoa', async () => {
    const { form } = montar()
    iniciarFormularioDeAtendimento(form, {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('CONTATO'))
    enviar(form)
    await esperar()
    await esperar()
    expect(textoDe('[data-falha-do-envio]').textContent).toContain(
      'Não foi possível enviar o pedido agora',
    )
  })

  it('enquanto envia, o botão fica travado (um clique duplo não cria dois pedidos)', async () => {
    const { form } = montar()
    let liberar: (r: Response) => void = () => undefined
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolver) => (liberar = resolver)),
    )
    iniciarFormularioDeAtendimento(form, {
      fetchImpl,
      fetchDosPrazos: prazosOk(),
    })
    preencher(form, valoresOk('CONTATO'))
    enviar(form)
    enviar(form)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const botao = textoDe('[data-enviar]') as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(botao.textContent).toBe('Enviando…')
    expect(form.getAttribute('aria-busy')).toBe('true')
    liberar(resposta({ protocolo: 'ASAF-2026-00003', prazo_dias: 10 }))
    await esperar()
    await esperar()
    expect(form.hasAttribute('aria-busy')).toBe(false)
  })

  it('um tipo que a página não conhece é erro de programação, não um pedido perdido', () => {
    const { form } = montar()
    form.dataset.tipo = 'OUTRO_TIPO'
    expect(() => iniciarFormularioDeAtendimento(form)).toThrow(
      'Tipo de pedido desconhecido',
    )
  })
})
