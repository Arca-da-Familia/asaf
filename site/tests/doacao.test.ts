import { describe, expect, it } from 'vitest'

import { ApiError } from '../src/lib/api'
import {
  campanhasEmAndamento,
  falhaDoCodigo,
  falhaDoEnvio,
  formatarCpf,
  formatarReais,
  fraseDeValidade,
  frasePercentual,
  frasePrazo,
  idDaCampanha,
  lerDadosDoPix,
  lerDoacaoPublica,
  lerRespostaDoPedido,
  lerValorDigitado,
  montarCorpoDaDoacao,
  validarDoacao,
  valorDaBarra,
  valorParaConsulta,
  type CampanhaPublica,
  type ValoresDaDoacao,
} from '../src/lib/doacao'

const campanha = (extra: Partial<CampanhaPublica> = {}): CampanhaPublica => ({
  id_campanha: 1,
  titulo: 'Cestas básicas',
  descricao: null,
  meta_valor: 10000,
  valor_arrecadado: 2500,
  percentual: 25,
  prazo: '2026-12-31',
  ...extra,
})

const semEspacoEspecial = (texto: string) => texto.replace(/\s/g, ' ')

describe('lerDoacaoPublica', () => {
  const aberta = {
    pix_disponivel: true,
    chave_pix: '123e4567-e89b-12d3-a456-426614174000',
    beneficiario: 'ASAF TESTE',
    cidade: 'PARAUAPEBAS',
    campanhas: [
      {
        id_campanha: 1,
        titulo: 'Cestas básicas',
        descricao: 'Para famílias da comunidade.',
        meta_valor: 10000,
        valor_arrecadado: 2500,
        percentual: 25,
        prazo: '2026-12-31',
      },
    ],
    versao_aviso_de_privacidade: '1',
    dias_de_validade_do_pedido: 15,
  }

  it('Pix aberto: lê o Pix, as campanhas, a versão do aviso e os dias do pedido', () => {
    expect(lerDoacaoPublica(aberta)).toEqual({
      ...aberta,
      campanhas: [aberta.campanhas[0]],
    })
  })

  it('Pix indisponível: só isso importa (sem chave, sem campanha, sem versão)', () => {
    expect(
      lerDoacaoPublica({ ...aberta, pix_disponivel: false, chave_pix: null }),
    ).toEqual({
      pix_disponivel: false,
      chave_pix: null,
      beneficiario: null,
      cidade: null,
      campanhas: [],
      versao_aviso_de_privacidade: null,
      dias_de_validade_do_pedido: null,
    })
  })

  it('resposta fora do formato vira null (a página mostra "tentar de novo", nunca um formulário pela metade)', () => {
    for (const ruim of [
      null,
      'texto',
      [],
      {},
      { pix_disponivel: 'sim' },
      { ...aberta, chave_pix: null },
      { ...aberta, beneficiario: '  ' },
      { ...aberta, cidade: undefined },
      { ...aberta, versao_aviso_de_privacidade: null },
      { ...aberta, versao_aviso_de_privacidade: '' },
      { ...aberta, campanhas: 'nenhuma' },
    ])
      expect(lerDoacaoPublica(ruim), JSON.stringify(ruim)).toBeNull()
  })

  it('campanha com dado quebrado é descartada; as outras ficam', () => {
    const lida = lerDoacaoPublica({
      ...aberta,
      campanhas: [
        aberta.campanhas[0],
        { ...aberta.campanhas[0], id_campanha: 'x' },
        { ...aberta.campanhas[0], titulo: '' },
        { ...aberta.campanhas[0], meta_valor: 'muito' },
        { ...aberta.campanhas[0], valor_arrecadado: -1 },
        null,
        { ...aberta.campanhas[0], id_campanha: 2, titulo: 'Segunda' },
      ],
    })
    expect(lida?.campanhas.map((c) => c.id_campanha)).toEqual([1, 2])
  })

  it('campanha sem percentual ou sem prazo válido: o percentual é calculado e o prazo some', () => {
    const lida = lerDoacaoPublica({
      ...aberta,
      campanhas: [
        { ...aberta.campanhas[0], percentual: undefined, prazo: '31/12/2026' },
      ],
    })
    expect(lida?.campanhas[0]).toMatchObject({ percentual: 25, prazo: null })
  })

  it('dias do pedido ausente ou inválido: sem número (a página não fala em prazo)', () => {
    for (const dias of [undefined, null, 0, -3, 1.5, '15'])
      expect(
        lerDoacaoPublica({ ...aberta, dias_de_validade_do_pedido: dias })
          ?.dias_de_validade_do_pedido,
      ).toBeNull()
  })

  it('a descrição e o título são texto: tags continuam tags (a página só usa textContent)', () => {
    const lida = lerDoacaoPublica({
      ...aberta,
      campanhas: [
        {
          ...aberta.campanhas[0],
          titulo: '<img src=x onerror=alert(1)>',
          descricao: '<b>forte</b>',
        },
      ],
    })
    expect(lida?.campanhas[0]).toMatchObject({
      titulo: '<img src=x onerror=alert(1)>',
      descricao: '<b>forte</b>',
    })
  })
})

describe('campanhasEmAndamento', () => {
  const hoje = new Date('2026-10-16T02:00:00Z')
  it('nunca oferece campanha cujo prazo já passou; o dia do prazo ainda vale; sem prazo vale sempre', () => {
    const lista = [
      campanha({ id_campanha: 1, prazo: '2026-10-15' }),
      campanha({ id_campanha: 2, prazo: '2026-10-16' }),
      campanha({ id_campanha: 3, prazo: '2026-10-17' }),
      campanha({ id_campanha: 4, prazo: null }),
    ]
    expect(campanhasEmAndamento(lista, hoje).map((c) => c.id_campanha)).toEqual(
      [2, 3, 4],
    )
  })
})

describe('dinheiro e CPF', () => {
  it('formatarReais usa o real brasileiro', () => {
    expect(semEspacoEspecial(formatarReais(1234.5))).toBe('R$ 1.234,50')
    expect(semEspacoEspecial(formatarReais(0))).toBe('R$ 0,00')
    expect(semEspacoEspecial(formatarReais(10000))).toBe('R$ 10.000,00')
  })

  it('formatarCpf só mexe em onze números', () => {
    expect(formatarCpf('39053344705')).toBe('390.533.447-05')
    expect(formatarCpf('390.533.447-05')).toBe('390.533.447-05')
    expect(formatarCpf(' 390 533 447 05 ')).toBe('390.533.447-05')
    expect(formatarCpf('3905334470')).toBe('3905334470')
    expect(formatarCpf('abc')).toBe('abc')
    expect(formatarCpf('')).toBe('')
  })

  it('valorParaConsulta: sempre com ponto e duas casas', () => {
    expect(valorParaConsulta(25.5)).toBe('25.50')
    expect(valorParaConsulta(50)).toBe('50.00')
    expect(valorParaConsulta(1000000)).toBe('1000000.00')
  })
})

describe('lerValorDigitado (o valor como se escreve no Brasil)', () => {
  const certo = (texto: string, valor: number | null) =>
    expect(lerValorDigitado(texto), `"${texto}"`).toEqual({ ok: true, valor })

  it('em branco vale: o valor é opcional', () => {
    certo('', null)
    certo('   ', null)
  })

  it('inteiros, centavos com vírgula, milhar com ponto, "R$" na frente', () => {
    certo('50', 50)
    certo('50,00', 50)
    certo('25,5', 25.5)
    certo('25,50', 25.5)
    certo('0,50', 0.5)
    certo('1.000', 1000)
    certo('1.000,50', 1000.5)
    certo('R$ 25,50', 25.5)
    certo('r$25,5', 25.5)
    certo(' 1 000 ', 1000)
  })

  it('o ponto com um ou dois dígitos depois vale como centavos', () => {
    certo('25.5', 25.5)
    certo('25.50', 25.5)
    certo('1000000', 1000000)
  })

  it('a vírgula nunca é lida como milhar (25,50 não é 2550) e o ponto de milhar não vira centavos', () => {
    certo('25,50', 25.5)
    certo('1.000', 1000)
    certo('100.000', 100000)
  })

  it('o que não é número é recusado, sem adivinhar', () => {
    for (const ruim of [
      'abc',
      '12abc',
      '1,2,3',
      '50,000',
      '1,000',
      '1.00,5',
      '50.',
      '--5',
      '-5',
      '5-',
      '1e3',
      ',50',
      '50,',
      '25,5,',
    ])
      expect(lerValorDigitado(ruim), `"${ruim}"`).toMatchObject({
        ok: false,
        erro: expect.stringContaining('Confira o valor'),
      })
  })

  it('zero e o que passa de um milhão têm as frases do servidor', () => {
    expect(lerValorDigitado('0')).toEqual({
      ok: false,
      erro: 'O valor da doação precisa ser maior que zero.',
    })
    expect(lerValorDigitado('0,00')).toMatchObject({
      erro: 'O valor da doação precisa ser maior que zero.',
    })
    expect(lerValorDigitado('1.000.000,01')).toEqual({
      ok: false,
      erro: 'Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
    })
    expect(lerValorDigitado('1.000.000')).toEqual({ ok: true, valor: 1000000 })
  })
})

describe('o que a página escreve de cada campanha', () => {
  it('frasePercentual: sempre em texto; passando de 100%, diz que a meta foi ultrapassada', () => {
    expect(frasePercentual(campanha({ percentual: 25 }))).toBe('25% da meta.')
    expect(frasePercentual(campanha({ percentual: 0 }))).toBe('0% da meta.')
    expect(frasePercentual(campanha({ percentual: 100 }))).toBe(
      '100% da meta: a meta foi alcançada.',
    )
    expect(frasePercentual(campanha({ percentual: 120 }))).toBe(
      '120% da meta: a meta já foi ultrapassada.',
    )
    expect(frasePercentual(campanha({ meta_valor: 0, percentual: 0 }))).toBe(
      'Esta campanha não tem uma meta em dinheiro.',
    )
  })

  it('valorDaBarra nunca passa do máximo', () => {
    expect(valorDaBarra(campanha())).toBe(2500)
    expect(
      valorDaBarra(campanha({ valor_arrecadado: 6000, meta_valor: 5000 })),
    ).toBe(5000)
  })

  it('frasePrazo: o dia do prazo (sem virar o dia anterior) ou sem prazo', () => {
    expect(frasePrazo('2026-12-31')).toBe('Até 31/12/2026')
    expect(frasePrazo('2026-01-01')).toBe('Até 01/01/2026')
    expect(frasePrazo(null)).toBe('Sem prazo definido')
  })

  it('fraseDeValidade: os dias vêm da API; sem eles, sem frase', () => {
    expect(fraseDeValidade(15, '2026-10-31T13:00:00.123456')).toBe(
      'O pedido vale por 15 dias (até 31 de outubro de 2026).',
    )
    expect(fraseDeValidade(1, null)).toBe('O pedido vale por 1 dia.')
    expect(fraseDeValidade(null, '2026-10-31T13:00:00')).toBeNull()
  })

  it('fraseDeValidade conta o dia no horário de Belém (01h UTC ainda é o dia anterior)', () => {
    expect(fraseDeValidade(15, '2026-11-01T01:00:00')).toBe(
      'O pedido vale por 15 dias (até 31 de outubro de 2026).',
    )
  })
})

const preenchido = (extra: Partial<ValoresDaDoacao> = {}): ValoresDaDoacao => ({
  nome_completo: 'Maria de Teste',
  email: 'maria@example.com',
  cpf: '',
  valor: '',
  id_campanha: '',
  consentimento_lgpd: true,
  ...extra,
})

describe('validarDoacao (as frases são as do servidor)', () => {
  it('pedido mínimo certo: nome, e-mail e o aceite', () => {
    expect(validarDoacao(preenchido(), [])).toEqual({})
  })

  it('em branco: nome, e-mail e aceite faltam; CPF, valor e campanha são opcionais', () => {
    expect(
      validarDoacao(
        preenchido({
          nome_completo: '',
          email: '',
          consentimento_lgpd: false,
        }),
        [],
      ),
    ).toEqual({
      nome_completo: 'Informe o seu nome completo.',
      email: 'Esse e-mail não parece certo: confira se está escrito sem erro.',
      consentimento_lgpd:
        'Para continuar, é preciso ler e aceitar o aviso de privacidade.',
    })
  })

  it('nome: pelo menos 3 letras (espaços sobrando não contam) e no máximo 120', () => {
    expect(
      validarDoacao(preenchido({ nome_completo: '  Ma   ' }), []).nome_completo,
    ).toBe('Informe o seu nome completo.')
    expect(
      validarDoacao(preenchido({ nome_completo: 'Ana' }), []).nome_completo,
    ).toBeUndefined()
    expect(
      validarDoacao(preenchido({ nome_completo: 'a'.repeat(121) }), [])
        .nome_completo,
    ).toBe('O nome ficou grande demais: confira.')
    expect(
      validarDoacao(preenchido({ nome_completo: 'a'.repeat(120) }), [])
        .nome_completo,
    ).toBeUndefined()
  })

  it('e-mail sem arroba ou sem ponto é recusado', () => {
    for (const ruim of ['sem-arroba', 'a@b', 'a b@c.com', '@c.com'])
      expect(validarDoacao(preenchido({ email: ruim }), []).email, ruim).toBe(
        'Esse e-mail não parece certo: confira se está escrito sem erro.',
      )
    expect(
      validarDoacao(preenchido({ email: ' maria@example.com ' }), []).email,
    ).toBeUndefined()
  })

  it('CPF: opcional; preenchido, tem de conferir (com ou sem pontuação)', () => {
    expect(validarDoacao(preenchido({ cpf: '' }), []).cpf).toBeUndefined()
    expect(
      validarDoacao(preenchido({ cpf: '390.533.447-05' }), []).cpf,
    ).toBeUndefined()
    expect(
      validarDoacao(preenchido({ cpf: '39053344705' }), []).cpf,
    ).toBeUndefined()
    expect(validarDoacao(preenchido({ cpf: '111.444.777-36' }), []).cpf).toBe(
      'Esse CPF não confere: confira os números ou deixe em branco.',
    )
    expect(validarDoacao(preenchido({ cpf: '123' }), []).cpf).toBeDefined()
  })

  it('valor: opcional; o que vale (e o que não vale) é o de lerValorDigitado', () => {
    expect(validarDoacao(preenchido({ valor: '' }), []).valor).toBeUndefined()
    expect(
      validarDoacao(preenchido({ valor: '25,50' }), []).valor,
    ).toBeUndefined()
    expect(validarDoacao(preenchido({ valor: '0' }), []).valor).toBe(
      'O valor da doação precisa ser maior que zero.',
    )
    expect(validarDoacao(preenchido({ valor: 'dez' }), []).valor).toContain(
      'Confira o valor',
    )
  })

  it('campanha: só uma da lista; "" é sem campanha', () => {
    expect(
      validarDoacao(preenchido({ id_campanha: '' }), [1, 2]).id_campanha,
    ).toBeUndefined()
    expect(
      validarDoacao(preenchido({ id_campanha: '2' }), [1, 2]).id_campanha,
    ).toBeUndefined()
    expect(
      validarDoacao(preenchido({ id_campanha: '9' }), [1, 2]).id_campanha,
    ).toBe('Escolha uma campanha da lista ou doe sem campanha.')
    expect(
      validarDoacao(preenchido({ id_campanha: 'x' }), [1, 2]).id_campanha,
    ).toBeDefined()
  })
})

describe('montarCorpoDaDoacao', () => {
  it('pedido mínimo: sem CPF, sem valor e sem campanha no corpo; a versão é a que a página leu; a armadilha vai vazia', () => {
    expect(montarCorpoDaDoacao(preenchido(), '1')).toEqual({
      nome_completo: 'Maria de Teste',
      email: 'maria@example.com',
      consentimento_lgpd: true,
      versao_texto_consentimento: '1',
      pagina_web: '',
    })
  })

  it('pedido completo: CPF só com dígitos, valor como número (25,50 -> 25.5), campanha como número, nome sem espaços sobrando', () => {
    expect(
      montarCorpoDaDoacao(
        preenchido({
          nome_completo: '  Maria   de  Teste ',
          email: ' maria@example.com ',
          cpf: '390.533.447-05',
          valor: 'R$ 1.025,50',
          id_campanha: '3',
        }),
        '7',
        'http://spam.example',
      ),
    ).toEqual({
      nome_completo: 'Maria de Teste',
      email: 'maria@example.com',
      cpf: '39053344705',
      valor: 1025.5,
      id_campanha: 3,
      consentimento_lgpd: true,
      versao_texto_consentimento: '7',
      pagina_web: 'http://spam.example',
    })
  })

  it('a versão do aviso é exatamente a recebida (nunca um número escrito no código)', () => {
    for (const versao of ['1', '2', '17', '3.1'])
      expect(
        montarCorpoDaDoacao(preenchido(), versao).versao_texto_consentimento,
      ).toBe(versao)
  })

  it('nunca manda valor ou campanha em branco ou ilegível', () => {
    const corpo = montarCorpoDaDoacao(
      preenchido({ valor: 'abc', id_campanha: '' }),
      '1',
    )
    expect(corpo).not.toHaveProperty('valor')
    expect(corpo).not.toHaveProperty('id_campanha')
    expect(corpo).not.toHaveProperty('cpf')
  })

  it('idDaCampanha', () => {
    expect(idDaCampanha('12')).toBe(12)
    expect(idDaCampanha('')).toBeNull()
    expect(idDaCampanha('x1')).toBeNull()
    expect(idDaCampanha('1.5')).toBeNull()
  })
})

describe('lerDadosDoPix e lerRespostaDoPedido', () => {
  const pix = {
    copia_e_cola: '000201...6304ABCD',
    chave_pix: '123e4567',
    beneficiario: 'ASAF TESTE',
    cidade: 'PARAUAPEBAS',
    valor: 50,
    id_campanha: 1,
  }

  it('lê o código e os dados de quem recebe; valor e campanha podem ser nulos', () => {
    expect(lerDadosDoPix(pix)).toEqual(pix)
    expect(lerDadosDoPix({ ...pix, valor: null, id_campanha: null })).toEqual({
      ...pix,
      valor: null,
      id_campanha: null,
    })
  })

  it('código incompleto nunca vai para a tela', () => {
    for (const campo of ['copia_e_cola', 'chave_pix', 'beneficiario', 'cidade'])
      expect(lerDadosDoPix({ ...pix, [campo]: '' }), campo).toBeNull()
    expect(lerDadosDoPix(null)).toBeNull()
    expect(lerDadosDoPix('texto')).toBeNull()
  })

  it('resposta do pedido: protocolo, código e validade', () => {
    expect(
      lerRespostaDoPedido({
        ...pix,
        mensagem: 'Pedido recebido.',
        protocolo: 'DOA-2026-00001',
        expira_em: '2026-10-31T13:00:00',
      }),
    ).toEqual({
      protocolo: 'DOA-2026-00001',
      pix,
      expira_em: '2026-10-31T13:00:00',
    })
  })

  it('armadilha de robô (protocolo nulo): sem protocolo e sem código, nada para mostrar', () => {
    expect(
      lerRespostaDoPedido({
        mensagem: 'Pedido recebido.',
        protocolo: null,
        valor: null,
        copia_e_cola: null,
        expira_em: null,
      }),
    ).toEqual({ protocolo: null, pix: null, expira_em: null })
  })

  it('protocolo sem o código inteiro (ou resposta torta) é falha, não sucesso pela metade', () => {
    expect(() =>
      lerRespostaDoPedido({ protocolo: 'DOA-2026-00001', copia_e_cola: '' }),
    ).toThrow(ApiError)
    expect(() => lerRespostaDoPedido('texto')).toThrow(ApiError)
    expect(() => lerRespostaDoPedido(null)).toThrow(ApiError)
  })
})

describe('falhaDoEnvio (o que a pessoa lê quando a API recusa)', () => {
  it('422 de validação: cada motivo vai para o seu campo, em português', () => {
    const erro = new ApiError(
      'A API respondeu 422.',
      422,
      'Informe o seu nome completo.',
      [
        { campo: 'nome_completo', mensagem: 'Informe o seu nome completo.' },
        {
          campo: 'email',
          mensagem:
            'Esse e-mail não parece certo: confira se está escrito sem erro.',
        },
        {
          campo: 'valor',
          mensagem: 'O valor da doação precisa ser maior que zero.',
        },
      ],
    )
    expect(falhaDoEnvio(erro)).toEqual({
      porCampo: {
        nome_completo: 'Informe o seu nome completo.',
        email:
          'Esse e-mail não parece certo: confira se está escrito sem erro.',
        valor: 'O valor da doação precisa ser maior que zero.',
      },
      geral: null,
    })
  })

  it('campo que a página não tem vira frase geral; nenhuma mensagem se perde', () => {
    const erro = new ApiError('A API respondeu 422.', 422, 'Field required', [
      { campo: 'versao_texto_consentimento', mensagem: 'Field required' },
    ])
    expect(falhaDoEnvio(erro)).toEqual({
      porCampo: {},
      geral: 'Field required',
    })
    const misto = new ApiError('x', 422, 'Informe o seu nome completo.', [
      { campo: 'nome_completo', mensagem: 'Informe o seu nome completo.' },
      { campo: 'desconhecido', mensagem: 'Algo mais.' },
    ])
    expect(falhaDoEnvio(misto)).toEqual({
      porCampo: { nome_completo: 'Informe o seu nome completo.' },
      geral: 'Algo mais.',
    })
  })

  it('429: a frase da API (com o tempo de espera) e a saída pela secretaria', () => {
    const f = falhaDoEnvio(
      new ApiError(
        'x',
        429,
        'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.',
      ),
    )
    expect(f.porCampo).toEqual({})
    expect(f.geral).toBe(
      'Muitas tentativas - aguarde 60 minutos antes de tentar novamente. Se preferir, fale com a secretaria.',
    )
    expect(falhaDoEnvio(new ApiError('x', 429)).geral).toContain(
      'fale com a secretaria',
    )
  })

  it('503, aviso desatualizado e campanha encerrada: a frase da API, sem engolir', () => {
    for (const [status, detalhe] of [
      [
        503,
        'A doação pelo site ainda não está disponível. Fale com a secretaria da associação.',
      ],
      [
        422,
        'O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.',
      ],
      [
        400,
        'Essa campanha não está recebendo doações. Escolha outra ou doe sem campanha.',
      ],
      [400, 'Para continuar é preciso ler e aceitar o aviso de privacidade.'],
    ] as const)
      expect(falhaDoEnvio(new ApiError('x', status, detalhe))).toEqual({
        porCampo: {},
        geral: detalhe,
      })
  })

  it('sem rede ou erro sem motivo: orientação humana, com a garantia do mesmo protocolo e a secretaria', () => {
    for (const erro of [
      new ApiError('Não foi possível falar com a API.'),
      new ApiError('A API respondeu 500.', 500),
      new Error('qualquer coisa'),
      'texto solto',
    ]) {
      const f = falhaDoEnvio(erro)
      expect(f.porCampo).toEqual({})
      expect(f.geral).toContain('Não foi possível enviar o seu pedido agora')
      expect(f.geral).toContain('você recebe o mesmo protocolo')
      expect(f.geral).toContain('fale com a secretaria')
    }
  })
})

describe('falhaDoCodigo', () => {
  it('a frase da API quando ela deu uma; senão uma nossa', () => {
    expect(
      falhaDoCodigo(
        new ApiError('x', 400, 'O valor da doação precisa ser maior que zero.'),
      ),
    ).toBe('O valor da doação precisa ser maior que zero.')
    expect(
      falhaDoCodigo(new ApiError('Não foi possível falar com a API.')),
    ).toBe(
      'Não foi possível gerar o código agora. Tente de novo em alguns instantes. Se continuar, fale com a secretaria.',
    )
  })
})
