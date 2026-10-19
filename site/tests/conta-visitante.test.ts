import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '../src/lib/api'
import {
  avisoDoReciboPorEmail,
  buscarConta,
  codigoTemOTamanhoCerto,
  diaEmPalavras,
  emailParece,
  entrarComCodigo,
  esquecerSessao,
  explicacaoDaDoacao,
  explicacaoDoPedidoDoTitular,
  frasePeloFimDaSessao,
  guardarSessao,
  instanteEmPalavras,
  instanteUtc,
  lerConta,
  lerSessaoGuardada,
  linhaDoRecibo,
  linksDaInscricao,
  MENSAGEM_DE_SESSAO_ACABOU,
  mensagemDaConta,
  mensagemDeEntrada,
  mensagemDoApagamento,
  mensagemDoPedidoDeCodigo,
  pedirApagamento,
  pedirCodigo,
  sairDaConta,
  sessaoAcabou,
  situacaoDaDoacao,
  situacaoDoPedidoDoTitular,
  soOsNumeros,
  type DoacaoDaConta,
  type InscricaoDaConta,
  type PedidoDoTitularDaConta,
} from '../src/lib/conta-visitante'

const SEM_NBSP = (texto: string | null) => texto?.replace(/ /g, ' ') ?? null

const inscricao = (
  extra: Partial<InscricaoDaConta> = {},
): InscricaoDaConta => ({
  status: 'Pré-inscrito',
  primeiro_nome: 'Maria',
  evento: {
    titulo: 'Encontro de teste',
    data_hora_inicio: '2026-10-10T22:00:00',
    data_hora_fim: null,
    endereco_avulso: 'Salão de teste',
    status: 'Programado',
    motivo_status: null,
  },
  sessao: null,
  codigo_checkin: 'A1B2C3D4',
  prazo_confirmacao: null,
  evento_encerrado: false,
  pode_cancelar: true,
  pode_confirmar: true,
  token: 'tok-abc_123-XYZ',
  ...extra,
})

const doacao = (extra: Partial<DoacaoDaConta> = {}): DoacaoDaConta => ({
  protocolo: 'DOA-2026-00012',
  situacao: 'PENDENTE',
  pedida_em: '2026-10-16T12:00:00',
  valor_informado: 30,
  campanha: null,
  valor_recebido: null,
  data_da_doacao: null,
  numero_do_recibo: null,
  recibo_enviado_por_email: null,
  ...extra,
})

const respostaJson = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** O que a página mandou: URL, método, cabeçalhos e corpo da última chamada. */
function ultimaChamada(fetchImpl: ReturnType<typeof vi.fn>) {
  const [url, inicio] = fetchImpl.mock.calls.at(-1) as [string, RequestInit]
  return {
    url,
    metodo: inicio.method ?? 'GET',
    cabecalhos: inicio.headers as Record<string, string>,
    corpo: inicio.body ? JSON.parse(inicio.body as string) : undefined,
    credenciais: inicio.credentials,
  }
}

describe('o que a pessoa digita', () => {
  it('confere só se parece um e-mail', () => {
    expect(emailParece('maria@example.com')).toBe(true)
    expect(emailParece('  maria@example.com ')).toBe(true)
    for (const torto of [
      '',
      'maria',
      'maria@',
      '@example.com',
      'maria@example',
      'a b@c.com',
    ])
      expect(emailParece(torto), torto).toBe(false)
  })
  it('o código como foi copiado vira só os números', () => {
    expect(soOsNumeros(' 123-456 ')).toBe('123456')
    expect(soOsNumeros('12 34 56')).toBe('123456')
    expect(codigoTemOTamanhoCerto('123 456')).toBe(true)
    expect(codigoTemOTamanhoCerto('12345')).toBe(false)
    expect(codigoTemOTamanhoCerto('1234567')).toBe(false)
    expect(codigoTemOTamanhoCerto('abcdef')).toBe(false)
  })
})

describe('lerConta', () => {
  const bruta = {
    email: 'maria@example.com',
    sessao_expira_em: '2026-10-16T18:00:00',
    inscricoes: [
      { ...inscricao(), token: 'tok-abc_123-XYZ' },
      { sem: 'status' },
      {
        ...inscricao({ pode_cancelar: false, pode_confirmar: false }),
        token: null,
      },
    ],
    certificados: [
      {
        tipo_documento: 'Certificado de participação',
        atividade: 'Encontro de Famílias',
        primeiro_nome: 'Maria',
        emitida_em: '2026-10-15T12:00:00',
        codigo_verificacao: '9F8E7D6C',
        arquivo: '/uploads/documentos/9F8E7D6C.pdf',
      },
      { tipo_documento: 'sem código' },
    ],
    doacoes: [
      { ...doacao(), situacao: 'CONFIRMADA', numero_do_recibo: 12 },
      { sem: 'protocolo' },
    ],
    pedidos_do_titular: [
      {
        protocolo: 'ASAF-2026-00031',
        o_que_pediu: 'Acessar os dados que a associação tem sobre mim',
        situacao: 'Respondido',
        pedido_em: '2026-10-10T12:00:00',
        prazo_em: '2026-10-25T12:00:00',
        respondido_em: '2026-10-12T12:00:00',
        resposta: 'Guardamos o seu nome.',
        encerrado_em: null,
        motivo_do_encerramento: null,
      },
      { situacao: 'Novo' },
    ],
    pedido_de_apagamento: {
      protocolo: 'ASAF-2026-00042',
      prazo_em: '2026-10-31T12:00:00',
      status: 'Novo',
    },
  }

  it('lê cada parte e descarta o item torto', () => {
    const conta = lerConta(bruta)!
    expect(conta.email).toBe('maria@example.com')
    expect(conta.inscricoes).toHaveLength(2)
    expect(conta.inscricoes[0]!.token).toBe('tok-abc_123-XYZ')
    expect(conta.inscricoes[1]!.token).toBeNull()
    expect(conta.certificados).toHaveLength(1)
    expect(conta.certificados[0]!.codigo_verificacao).toBe('9F8E7D6C')
    expect(conta.doacoes).toHaveLength(1)
    expect(conta.doacoes[0]!.numero_do_recibo).toBe(12)
    // v5.7f: o pedido do titular sem protocolo é descartado; o bom vem inteiro
    expect(conta.pedidos_do_titular).toHaveLength(1)
    expect(conta.pedidos_do_titular[0]).toEqual({
      protocolo: 'ASAF-2026-00031',
      o_que_pediu: 'Acessar os dados que a associação tem sobre mim',
      situacao: 'Respondido',
      pedido_em: '2026-10-10T12:00:00',
      prazo_em: '2026-10-25T12:00:00',
      respondido_em: '2026-10-12T12:00:00',
      resposta: 'Guardamos o seu nome.',
      encerrado_em: null,
      motivo_do_encerramento: null,
    })
    expect(conta.pedido_de_apagamento).toEqual({
      protocolo: 'ASAF-2026-00042',
      prazo_em: '2026-10-31T12:00:00',
    })
  })
  it('sem e-mail (resposta torta) não é uma conta', () => {
    for (const torto of [null, undefined, 'texto', 42, [], {}, { email: '' }])
      expect(lerConta(torto), JSON.stringify(torto)).toBeNull()
  })
  it('listas ausentes viram listas vazias e o pedido de apagamento some', () => {
    const conta = lerConta({ email: 'a@b.co' })!
    expect(conta.inscricoes).toEqual([])
    expect(conta.certificados).toEqual([])
    expect(conta.doacoes).toEqual([])
    expect(conta.pedidos_do_titular).toEqual([])
    expect(conta.pedido_de_apagamento).toBeNull()
  })
})

describe('as chamadas à API', () => {
  const opcoes = (fetchImpl: ReturnType<typeof vi.fn>, token?: string) => ({
    baseUrl: 'https://api.teste',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    token,
  })

  it('pedir o código manda o e-mail sem espaços e a armadilha, sem credencial', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        respostaJson({ mensagem: 'ok', minutos_de_validade: 10 }),
      )
    await pedirCodigo('  maria@example.com ', opcoes(f))
    const c = ultimaChamada(f)
    expect(c.url).toBe('https://api.teste/api/publico/visitante/codigo')
    expect(c.metodo).toBe('POST')
    expect(c.corpo).toEqual({ email: 'maria@example.com', pagina_web: '' })
    expect(c.cabecalhos.Authorization).toBeUndefined()
    expect(c.credenciais).toBe('omit')
  })

  it('entrar manda só os números do código, sem Authorization', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        respostaJson({ token: 't', expira_em: '2026-10-16T18:00:00' }),
      )
    await entrarComCodigo('maria@example.com', ' 123-456 ', opcoes(f))
    const c = ultimaChamada(f)
    expect(c.url).toBe('https://api.teste/api/publico/visitante/entrar')
    expect(c.corpo).toEqual({ email: 'maria@example.com', codigo: '123456' })
    expect(c.cabecalhos.Authorization).toBeUndefined()
  })

  it('ler a conta, sair e pedir o apagamento levam a sessão no cabeçalho Authorization (nunca na URL)', async () => {
    const f = vi.fn().mockImplementation(async () => respostaJson({}))
    await buscarConta('sessao-secreta', opcoes(f))
    let c = ultimaChamada(f)
    expect(c.url).toBe('https://api.teste/api/visitante/minha-conta')
    expect(c.metodo).toBe('GET')
    expect(c.cabecalhos.Authorization).toBe('Bearer sessao-secreta')
    expect(c.url).not.toContain('sessao-secreta')

    await sairDaConta('sessao-secreta', opcoes(f))
    c = ultimaChamada(f)
    expect(c.url).toBe('https://api.teste/api/visitante/sair')
    expect(c.metodo).toBe('POST')
    expect(c.cabecalhos.Authorization).toBe('Bearer sessao-secreta')

    await pedirApagamento('sessao-secreta', opcoes(f))
    c = ultimaChamada(f)
    expect(c.url).toBe('https://api.teste/api/visitante/pedir-apagamento')
    expect(c.cabecalhos.Authorization).toBe('Bearer sessao-secreta')
  })

  it('a falha da API chega como ApiError com o motivo em português', async () => {
    const f = vi.fn().mockResolvedValue(
      respostaJson(
        {
          detail:
            'Código inválido ou vencido: confira os números ou peça um novo código.',
        },
        400,
      ),
    )
    await expect(
      entrarComCodigo('a@b.co', '123456', opcoes(f)),
    ).rejects.toMatchObject({
      status: 400,
      detalhe:
        'Código inválido ou vencido: confira os números ou peça um novo código.',
    })
  })
})

describe('a sessão guardada na aba', () => {
  const guardaFalsa = () => {
    const dados = new Map<string, string>()
    return {
      dados,
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => void dados.set(k, v),
      removeItem: (k: string) => void dados.delete(k),
    }
  }
  const AGORA = Date.parse('2026-10-16T17:00:00Z')

  it('guarda e devolve a sessão que ainda vale', () => {
    const g = guardaFalsa()
    guardarSessao({ token: 'abc', expira_em: '2026-10-16T18:00:00' }, g)
    expect(lerSessaoGuardada(g, AGORA)).toEqual({
      token: 'abc',
      expira_em: '2026-10-16T18:00:00',
    })
  })
  it('a sessão vencida é apagada na leitura', () => {
    const g = guardaFalsa()
    guardarSessao({ token: 'abc', expira_em: '2026-10-16T16:59:59' }, g)
    expect(lerSessaoGuardada(g, AGORA)).toBeNull()
    expect(g.dados.size).toBe(0)
  })
  it('o guardado torto é apagado e vira nada', () => {
    for (const torto of [
      'não é json',
      '{}',
      '{"token":"x"}',
      '{"expira_em":"2026-10-16T18:00:00"}',
      '[]',
      'null',
    ]) {
      const g = guardaFalsa()
      g.dados.set('asaf-conta-visitante', torto)
      expect(lerSessaoGuardada(g, AGORA), torto).toBeNull()
      expect(g.dados.size, torto).toBe(0)
    }
  })
  it('esquecer apaga', () => {
    const g = guardaFalsa()
    guardarSessao({ token: 'abc', expira_em: '2026-10-16T18:00:00' }, g)
    esquecerSessao(g)
    expect(lerSessaoGuardada(g, AGORA)).toBeNull()
  })
  it('navegador que não deixa guardar não derruba a página', () => {
    const quebrado = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
      removeItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(() =>
      guardarSessao({ token: 'a', expira_em: '2026-10-16T18:00:00' }, quebrado),
    ).not.toThrow()
    expect(lerSessaoGuardada(quebrado, AGORA)).toBeNull()
    expect(() => esquecerSessao(quebrado)).not.toThrow()
    expect(lerSessaoGuardada(null, AGORA)).toBeNull()
  })
  it('lê o instante UTC sem fuso como UTC', () => {
    expect(instanteUtc('2026-10-16T18:00:00')).toBe(
      Date.parse('2026-10-16T18:00:00Z'),
    )
    expect(instanteUtc('2026-10-16T18:00:00Z')).toBe(
      Date.parse('2026-10-16T18:00:00Z'),
    )
    expect(instanteUtc('2026-10-16T15:00:00-03:00')).toBe(
      Date.parse('2026-10-16T18:00:00Z'),
    )
  })
})

describe('as frases', () => {
  const erro = (status?: number, detalhe?: string) =>
    new ApiError('x', status, detalhe)

  it('pedir o código: o motivo da API quando há, o limite explicado, o resto genérico', () => {
    expect(
      mensagemDoPedidoDeCodigo(
        erro(
          422,
          'Esse e-mail não parece certo: confira se está escrito sem erro.',
        ),
      ),
    ).toBe('Esse e-mail não parece certo: confira se está escrito sem erro.')
    expect(mensagemDoPedidoDeCodigo(erro(429))).toMatch(
      /Aguarde cerca de uma hora/,
    )
    expect(mensagemDoPedidoDeCodigo(erro(500))).toMatch(
      /Não foi possível pedir o código/,
    )
    expect(
      mensagemDoPedidoDeCodigo(
        new ApiError('Não foi possível falar com a API.'),
      ),
    ).toMatch(/Não foi possível pedir o código/)
  })
  it('entrar: repete a frase única do servidor para qualquer erro de código', () => {
    expect(
      mensagemDeEntrada(
        erro(
          400,
          'Código inválido ou vencido: confira os números ou peça um novo código.',
        ),
      ),
    ).toBe(
      'Código inválido ou vencido: confira os números ou peça um novo código.',
    )
    expect(mensagemDeEntrada(erro(429))).toMatch(/Aguarde alguns minutos/)
    expect(mensagemDeEntrada(erro(500))).toMatch(/Não foi possível entrar/)
  })
  it('sessão que acabou (401) é reconhecida e tem a sua frase', () => {
    expect(sessaoAcabou(erro(401))).toBe(true)
    expect(sessaoAcabou(erro(500))).toBe(false)
    expect(sessaoAcabou(new Error('x'))).toBe(false)
    expect(mensagemDaConta(erro(401))).toBe(MENSAGEM_DE_SESSAO_ACABOU)
    expect(mensagemDoApagamento(erro(401))).toBe(MENSAGEM_DE_SESSAO_ACABOU)
    expect(mensagemDaConta(erro(500))).toMatch(/fale com a secretaria/)
    expect(mensagemDoApagamento(erro(500))).toMatch(/fale com a secretaria/)
  })
  it('a hora do fim da sessão é a de Belém', () => {
    expect(frasePeloFimDaSessao('2026-10-16T18:00:00')).toContain('15:00')
    expect(frasePeloFimDaSessao('2026-10-16T18:00:00')).toContain(
      'horário de Belém',
    )
    expect(frasePeloFimDaSessao(null)).toBeNull()
    expect(instanteEmPalavras('2026-10-16T18:00:00')).toContain(
      '(horário de Belém)',
    )
    expect(instanteEmPalavras(null)).toBeNull()
    expect(diaEmPalavras('2026-10-16T02:00:00')).toBe('15 de outubro de 2026')
    expect(diaEmPalavras(null)).toBeNull()
  })
})

describe('as doações', () => {
  it('cada situação tem a sua frase; situação desconhecida aparece como veio', () => {
    expect(situacaoDaDoacao('PENDENTE')).toBe(
      'Aguardando a confirmação da tesouraria',
    )
    expect(situacaoDaDoacao('CONFIRMADA')).toBe('Doação confirmada')
    expect(situacaoDaDoacao('NAO_LOCALIZADA')).toMatch(/não localizado/)
    expect(situacaoDaDoacao('EXPIRADA')).toMatch(/Prazo vencido/)
    expect(situacaoDaDoacao('OUTRA')).toBe('OUTRA')
  })
  it('antes da confirmação não há recibo e a página diz isso; confirmada não precisa de explicação', () => {
    expect(explicacaoDaDoacao(doacao())).toMatch(/Até lá não há recibo/)
    expect(explicacaoDaDoacao(doacao({ situacao: 'NAO_LOCALIZADA' }))).toMatch(
      /citando o protocolo/,
    )
    expect(explicacaoDaDoacao(doacao({ situacao: 'EXPIRADA' }))).toMatch(
      /ainda é possível confirmar/,
    )
    expect(explicacaoDaDoacao(doacao({ situacao: 'CONFIRMADA' }))).toBeNull()
    expect(linhaDoRecibo(doacao())).toBeNull()
  })
  it('o recibo mostra o número, o valor RECEBIDO e o dia', () => {
    const confirmada = doacao({
      situacao: 'CONFIRMADA',
      numero_do_recibo: 12,
      valor_recebido: 45,
      data_da_doacao: '2026-10-14T15:00:00',
    })
    expect(SEM_NBSP(linhaDoRecibo(confirmada))).toBe(
      'Recibo nº 12: R$ 45,00 em 14 de outubro de 2026',
    )
    expect(linhaDoRecibo({ ...confirmada, numero_do_recibo: null })).toBeNull()
  })
  it('o e-mail do recibo que não saiu é avisado, e só na doação confirmada', () => {
    expect(
      avisoDoReciboPorEmail(
        doacao({ situacao: 'CONFIRMADA', recibo_enviado_por_email: false }),
      ),
    ).toMatch(/não saiu/)
    expect(
      avisoDoReciboPorEmail(
        doacao({ situacao: 'CONFIRMADA', recibo_enviado_por_email: true }),
      ),
    ).toBeNull()
    expect(
      avisoDoReciboPorEmail(
        doacao({ situacao: 'PENDENTE', recibo_enviado_por_email: false }),
      ),
    ).toBeNull()
  })
})

describe('os pedidos sobre dados pessoais (v5.7f)', () => {
  const pedido = (extra: Partial<PedidoDoTitularDaConta> = {}) => ({
    protocolo: 'ASAF-2026-00031',
    o_que_pediu: 'Acessar os dados que a associação tem sobre mim',
    situacao: 'Novo',
    pedido_em: '2026-10-10T12:00:00',
    prazo_em: '2026-10-25T12:00:00',
    respondido_em: null,
    resposta: null,
    encerrado_em: null,
    motivo_do_encerramento: null,
    ...extra,
  })

  it('só é "Respondido" quando há resposta; encerrado é encerrado; o resto está em andamento', () => {
    expect(situacaoDoPedidoDoTitular(pedido())).toBe('Em andamento')
    expect(
      situacaoDoPedidoDoTitular(pedido({ situacao: 'Em atendimento' })),
    ).toBe('Em andamento')
    expect(
      situacaoDoPedidoDoTitular(
        pedido({ situacao: 'Respondido', resposta: 'Guardamos o seu nome.' }),
      ),
    ).toBe('Respondido')
    // pedido de antes da v5.7f: respondido por e-mail, sem texto para mostrar aqui; continua "Respondido" (nunca "Em andamento")
    expect(situacaoDoPedidoDoTitular(pedido({ situacao: 'Respondido' }))).toBe(
      'Respondido',
    )
    expect(situacaoDoPedidoDoTitular(pedido({ situacao: 'Encerrado' }))).toBe(
      'Encerrado',
    )
  })

  it('a explicação diz que a associação confere quem pediu; respondido não precisa de explicação', () => {
    expect(explicacaoDoPedidoDoTitular(pedido())).toContain(
      'confere que quem pediu é o titular dos dados',
    )
    expect(explicacaoDoPedidoDoTitular(pedido())).toContain(
      'tenta avisar você por e-mail',
    )
    expect(
      explicacaoDoPedidoDoTitular(
        pedido({ situacao: 'Encerrado', motivo_do_encerramento: 'Sem prova.' }),
      ),
    ).toContain('O motivo está abaixo')
    // encerrado sem motivo para mostrar (pedido de antes da v5.7f): não manda olhar um motivo que não existe
    const semMotivo = explicacaoDoPedidoDoTitular(
      pedido({ situacao: 'Encerrado' }),
    )
    expect(semMotivo).toContain('sem responder com dados pessoais')
    expect(semMotivo).not.toContain('O motivo está abaixo')
    // respondido antes da v5.7f: diz que já foi respondido e onde pedir a cópia
    expect(
      explicacaoDoPedidoDoTitular(pedido({ situacao: 'Respondido' })),
    ).toContain('já foi respondido')
    expect(
      explicacaoDoPedidoDoTitular(
        pedido({ situacao: 'Respondido', resposta: 'Guardamos o seu nome.' }),
      ),
    ).toBeNull()
  })
})

describe('os links da inscrição', () => {
  it('cancelar e confirmar só aparecem com o link secreto e quando há o que fazer', () => {
    expect(linksDaInscricao(inscricao())).toEqual({
      cancelar: '/cancelar-inscricao/?token=tok-abc_123-XYZ',
      confirmar: '/confirmar-inscricao/?token=tok-abc_123-XYZ',
    })
    expect(linksDaInscricao(inscricao({ token: null }))).toEqual({
      cancelar: null,
      confirmar: null,
    })
    expect(
      linksDaInscricao(
        inscricao({ pode_cancelar: false, pode_confirmar: false }),
      ),
    ).toEqual({
      cancelar: null,
      confirmar: null,
    })
  })
  it('em evento cancelado só resta cancelar: nunca oferece confirmar a vaga', () => {
    const cancelado = inscricao({
      evento: { ...inscricao().evento, status: 'Cancelado' },
    })
    expect(linksDaInscricao(cancelado).confirmar).toBeNull()
    expect(linksDaInscricao(cancelado).cancelar).toContain(
      '/cancelar-inscricao/',
    )
  })
})
