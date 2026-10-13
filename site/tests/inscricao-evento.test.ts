// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import type { PerguntaDoEvento } from '../scripts/lib/conteudo-publico.mjs'
import { ApiError } from '../src/lib/api'
import {
  aplicarVagasAoVivo,
  AVISO_DA_LISTA_DE_ESPERA,
  AVISO_SEM_VAGAS,
  buscarConsentimento,
  caminhoDoLinkDaInscricao,
  chaveDaPergunta,
  chaveDoCpf,
  chaveDoNome,
  consentimentoDesatualizado,
  erroDaResposta,
  erroDoCpf,
  erroDoEmail,
  erroDoNome,
  erroDoTelefone,
  escolhaUnicaEmRadios,
  esconderComoParticipar,
  fraseDoEmail,
  iniciarFormularioDeInscricao,
  lerResposta,
  mensagemDeFalhaDoEnvio,
  montarCorpo,
  opcoesDaPergunta,
  pedeArquivo,
  perguntasOrdenadas,
  respostasDoParticipante,
  rotuloDeVagasDaSessao,
  situacaoEmPalavras,
  textoDaOpcaoDaSessao,
  validarInscricao,
  type ParticipanteInscrito,
  type ValoresDaInscricao,
} from '../src/lib/inscricao-evento'

const CPF_A = '390.533.447-05'
const CPF_B = '111.444.777-35'

const pergunta = (
  id: number,
  tipo: string,
  extra: Partial<PerguntaDoEvento> = {},
): PerguntaDoEvento => ({
  id_pergunta: id,
  enunciado: `Pergunta ${id}`,
  tipo,
  opcoes: null,
  obrigatoria: true,
  ordem: id,
  ...extra,
})

const PERGUNTAS: PerguntaDoEvento[] = [
  pergunta(1, 'SELECAO_UNICA', { opcoes: 'Sim,Não' }),
  pergunta(2, 'NUMERO'),
  pergunta(3, 'TEXTO_CURTO'),
  pergunta(4, 'TEXTO_LONGO', { obrigatoria: false }),
  pergunta(5, 'SELECAO_MULTIPLA', { opcoes: 'Café,Almoço,Jantar' }),
  pergunta(6, 'DATA', { obrigatoria: false }),
]

const respostasOk = () => ({
  '1': 'Sim',
  '2': '30',
  '3': 'Maria',
  '5': ['Café', 'Jantar'],
})

const valoresOk = (
  extra: Partial<ValoresDaInscricao> = {},
): ValoresDaInscricao => ({
  participantes: [
    {
      indice: 0,
      nome_completo: 'Maria de Teste Silva',
      cpf: CPF_A,
      respostas: respostasOk(),
    },
  ],
  email: 'maria@example.com',
  telefone: '(91) 98888-7777',
  id_sessao: '',
  consentimento_lgpd: true,
  ...extra,
})

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('as opções e o tipo de escolha das perguntas', () => {
  it('as opções vêm em CSV: sem espaços sobrando, sem vazias e sem repetidas', () => {
    expect(opcoesDaPergunta({ opcoes: ' A , B,,C ,A' })).toEqual([
      'A',
      'B',
      'C',
    ])
    expect(opcoesDaPergunta({ opcoes: null })).toEqual([])
    expect(opcoesDaPergunta({ opcoes: '' })).toEqual([])
  })

  it('até 5 opções a escolha única vira botões de marcar; com mais, uma lista', () => {
    expect(escolhaUnicaEmRadios({ opcoes: 'a,b,c,d,e' })).toBe(true)
    expect(escolhaUnicaEmRadios({ opcoes: 'a,b,c,d,e,f' })).toBe(false)
  })

  it('pergunta de arquivo faz o evento ir para a secretaria', () => {
    expect(pedeArquivo(PERGUNTAS)).toBe(false)
    expect(pedeArquivo([...PERGUNTAS, pergunta(9, 'ARQUIVO')])).toBe(true)
  })

  it('as perguntas saem na ordem da API (`ordem`, depois o número)', () => {
    const baguncadas = [
      pergunta(3, 'TEXTO_CURTO', { ordem: 2 }),
      pergunta(2, 'TEXTO_CURTO', { ordem: 2 }),
      pergunta(1, 'TEXTO_CURTO', { ordem: 9 }),
    ]
    expect(perguntasOrdenadas(baguncadas).map((p) => p.id_pergunta)).toEqual([
      2, 3, 1,
    ])
  })
})

describe('vagas das sessões', () => {
  it('diz as vagas livres, ou a lista de espera, e fica quieto quando não há limite', () => {
    expect(rotuloDeVagasDaSessao(12)).toBe('12 vagas')
    expect(rotuloDeVagasDaSessao(1)).toBe('1 vaga')
    expect(rotuloDeVagasDaSessao(0)).toBe('sem vagas: lista de espera')
    expect(rotuloDeVagasDaSessao(null)).toBe('')
    expect(rotuloDeVagasDaSessao(undefined)).toBe('')
    expect(textoDaOpcaoDaSessao('Oficina', 3)).toBe('Oficina — 3 vagas')
    expect(textoDaOpcaoDaSessao('Oficina', null)).toBe('Oficina')
  })
})

describe('validação campo a campo', () => {
  it('nome: pelo menos 3 letras, no máximo 150', () => {
    expect(erroDoNome('')).toBe('Informe o nome completo.')
    expect(erroDoNome('  Al  ')).toBe('Informe o nome completo.')
    expect(erroDoNome('Maria de Teste')).toBeUndefined()
    expect(erroDoNome('a'.repeat(151))).toContain('comprido demais')
  })

  it('CPF: em branco, que não confere e certo (com ou sem pontuação)', () => {
    expect(erroDoCpf('')).toBe('Informe o CPF.')
    expect(erroDoCpf('111.111.111-11')).toContain('não confere')
    expect(erroDoCpf('123')).toContain('não confere')
    expect(erroDoCpf(CPF_A)).toBeUndefined()
    expect(erroDoCpf('39053344705')).toBeUndefined()
  })

  it('e-mail e telefone (DDD + número) como a API os confere', () => {
    expect(erroDoEmail('')).toBe('Informe o seu e-mail.')
    expect(erroDoEmail('sem-arroba')).toContain('não parece certo')
    expect(erroDoEmail('maria@example.com')).toBeUndefined()
    expect(erroDoTelefone('')).toContain('Informe o telefone')
    expect(erroDoTelefone('123')).toContain('10 ou 11 dígitos')
    expect(erroDoTelefone('(91) 98888-7777')).toBeUndefined()
    expect(erroDoTelefone('91 3333-4444')).toBeUndefined()
    // celular de 11 dígitos tem de começar com 9 depois do DDD
    expect(erroDoTelefone('91 88888-7777')).toContain('10 ou 11 dígitos')
  })

  it('pergunta obrigatória em branco: cada tipo com as suas palavras; a opcional em branco passa', () => {
    const cada = (tipo: string, opcoes: string | null = null) =>
      erroDaResposta(
        pergunta(1, tipo, { opcoes }),
        tipo === 'SELECAO_MULTIPLA' ? [] : '',
      )
    expect(cada('TEXTO_CURTO')).toBe('Responda a esta pergunta.')
    expect(cada('TEXTO_LONGO')).toBe('Responda a esta pergunta.')
    expect(cada('NUMERO')).toBe('Informe um número.')
    expect(cada('DATA')).toBe('Informe a data.')
    expect(cada('SELECAO_UNICA', 'a,b')).toBe('Escolha uma opção.')
    expect(cada('SELECAO_MULTIPLA', 'a,b')).toBe('Escolha ao menos uma opção.')
    expect(
      erroDaResposta(pergunta(1, 'TEXTO_CURTO', { obrigatoria: false }), '  '),
    ).toBeUndefined()
    expect(
      erroDaResposta(
        pergunta(1, 'SELECAO_MULTIPLA', { opcoes: 'a,b', obrigatoria: false }),
        [],
      ),
    ).toBeUndefined()
  })

  it('número aceita vírgula ou ponto e recusa letras; data tem de existir', () => {
    const numero = pergunta(1, 'NUMERO')
    for (const bom of ['30', '3,5', '3.5', '-2', ' 7 ']) {
      expect(erroDaResposta(numero, bom), bom).toBeUndefined()
    }
    for (const ruim of ['abc', '1,2,3', '3,', '1e5']) {
      expect(erroDaResposta(numero, ruim), ruim).toContain('Use só números')
    }
    const data = pergunta(1, 'DATA')
    expect(erroDaResposta(data, '2026-02-28')).toBeUndefined()
    expect(erroDaResposta(data, '2026-02-30')).toBe('Confira a data.')
    expect(erroDaResposta(data, '28/02/2026')).toBe('Confira a data.')
  })

  it('a escolha tem de ser uma das opções', () => {
    const unica = pergunta(1, 'SELECAO_UNICA', { opcoes: 'Sim,Não' })
    expect(erroDaResposta(unica, 'Sim')).toBeUndefined()
    expect(erroDaResposta(unica, 'Talvez')).toBe('Escolha uma das opções.')
    const multipla = pergunta(1, 'SELECAO_MULTIPLA', { opcoes: 'A,B,C' })
    expect(erroDaResposta(multipla, ['A', 'C'])).toBeUndefined()
    expect(erroDaResposta(multipla, ['A', 'Z'])).toBe(
      'Escolha só entre as opções.',
    )
  })

  it('texto muito comprido é apontado (200 letras no curto, 2.000 no longo)', () => {
    expect(
      erroDaResposta(pergunta(1, 'TEXTO_CURTO'), 'a'.repeat(200)),
    ).toBeUndefined()
    expect(
      erroDaResposta(pergunta(1, 'TEXTO_CURTO'), 'a'.repeat(201)),
    ).toContain('comprida demais (até 200 letras)')
    expect(
      erroDaResposta(pergunta(1, 'TEXTO_LONGO'), 'a'.repeat(2000)),
    ).toBeUndefined()
    expect(
      erroDaResposta(pergunta(1, 'TEXTO_LONGO'), 'a'.repeat(2001)),
    ).toContain('comprida demais (até 2.000 letras)')
  })
})

describe('validarInscricao', () => {
  it('tudo certo: nenhum erro', () => {
    expect(validarInscricao(valoresOk(), PERGUNTAS)).toEqual({})
  })

  it('em branco: os erros saem na ORDEM DA PÁGINA (nome, CPF, e-mail, telefone, perguntas, aceite)', () => {
    const vazio: ValoresDaInscricao = {
      participantes: [{ indice: 0, nome_completo: '', cpf: '', respostas: {} }],
      email: '',
      telefone: '',
      id_sessao: '',
      consentimento_lgpd: false,
    }
    expect(Object.keys(validarInscricao(vazio, PERGUNTAS))).toEqual([
      chaveDoNome(0),
      chaveDoCpf(0),
      'email',
      'telefone',
      chaveDaPergunta(0, 1),
      chaveDaPergunta(0, 2),
      chaveDaPergunta(0, 3),
      chaveDaPergunta(0, 5),
      'consentimento',
    ])
  })

  it('pergunta de arquivo nunca é cobrada (o evento com ela nem mostra o formulário)', () => {
    expect(
      validarInscricao(valoresOk(), [...PERGUNTAS, pergunta(9, 'ARQUIVO')]),
    ).toEqual({})
  })

  it('em grupo, as perguntas obrigatórias valem para CADA pessoa e cada erro leva o número da pessoa', () => {
    const v = valoresOk({
      participantes: [
        ...valoresOk().participantes,
        { indice: 3, nome_completo: '', cpf: CPF_B, respostas: { '1': 'Sim' } },
      ],
    })
    expect(Object.keys(validarInscricao(v, PERGUNTAS))).toEqual([
      chaveDoNome(3),
      chaveDaPergunta(3, 2),
      chaveDaPergunta(3, 3),
      chaveDaPergunta(3, 5),
    ])
  })

  it('o mesmo CPF duas vezes na mesma inscrição é apontado na segunda pessoa (com ou sem pontuação)', () => {
    const v = valoresOk({
      participantes: [
        ...valoresOk().participantes,
        {
          indice: 1,
          nome_completo: 'Outra Pessoa',
          cpf: '39053344705',
          respostas: respostasOk(),
        },
      ],
    })
    const erros = validarInscricao(v, PERGUNTAS)
    expect(Object.keys(erros)).toEqual([chaveDoCpf(1)])
    expect(erros[chaveDoCpf(1)]).toContain('já foi informado')
  })

  it('o consentimento: carregando, falhou ou não aceito — sempre o último erro', () => {
    expect(validarInscricao(valoresOk(), PERGUNTAS, 'carregando')).toEqual({
      consentimento: 'Aguarde: o texto do consentimento ainda está carregando.',
    })
    expect(
      validarInscricao(valoresOk(), PERGUNTAS, 'falhou').consentimento,
    ).toContain('Tentar carregar de novo')
    expect(
      validarInscricao(valoresOk({ consentimento_lgpd: false }), PERGUNTAS)
        .consentimento,
    ).toContain('ler e aceitar o texto de consentimento')
  })
})

describe('respostasDoParticipante e montarCorpo', () => {
  it('cada tipo no seu formato: número como número (vírgula vira ponto), seleção múltipla como lista, em branco não vai', () => {
    expect(
      respostasDoParticipante(PERGUNTAS, {
        '1': 'Sim',
        '2': '3,5',
        '3': '  Maria   da  Silva ',
        '4': '  linha 1\nlinha 2  ',
        '5': ['Café', 'Jantar'],
        '6': '',
      }),
    ).toEqual({
      '1': 'Sim',
      '2': 3.5,
      '3': 'Maria da Silva',
      '4': 'linha 1\nlinha 2',
      '5': ['Café', 'Jantar'],
    })
  })

  it('inscrição individual: dados limpos (CPF e telefone só com dígitos), sem sessão, sem cupom e sem pessoas adicionais', () => {
    const corpo = montarCorpo(valoresOk(), PERGUNTAS, '3')
    expect(corpo).toEqual({
      nome_completo: 'Maria de Teste Silva',
      cpf: '39053344705',
      email: 'maria@example.com',
      telefone: '91988887777',
      respostas: { '1': 'Sim', '2': 30, '3': 'Maria', '5': ['Café', 'Jantar'] },
      participantes_adicionais: [],
      consentimento_lgpd: true,
      versao_texto_consentimento: '3',
      pagina_web: '',
    })
    expect(corpo).not.toHaveProperty('id_sessao')
    expect(corpo).not.toHaveProperty('codigo_cupom')
  })

  it('com sessão, vai o número dela; a versão do consentimento é a que veio da API (texto, nunca fixa)', () => {
    const corpo = montarCorpo(valoresOk({ id_sessao: '71' }), PERGUNTAS, '12')
    expect(corpo.id_sessao).toBe(71)
    expect(corpo.versao_texto_consentimento).toBe('12')
  })

  it('em grupo: a principal vai no topo e as outras em `participantes_adicionais`, cada uma com as suas respostas', () => {
    const v = valoresOk({
      participantes: [
        ...valoresOk().participantes,
        {
          indice: 1,
          nome_completo: ' Pedro  de Teste ',
          cpf: CPF_B,
          respostas: { '1': 'Não', '2': '8', '3': 'Pedro', '5': ['Almoço'] },
        },
      ],
    })
    expect(montarCorpo(v, PERGUNTAS, '3').participantes_adicionais).toEqual([
      {
        nome_completo: 'Pedro de Teste',
        cpf: '11144477735',
        respostas: { '1': 'Não', '2': 8, '3': 'Pedro', '5': ['Almoço'] },
      },
    ])
  })

  it('a armadilha de robô vai no corpo (vazia para gente de verdade)', () => {
    expect(
      montarCorpo(valoresOk(), PERGUNTAS, '3', 'http://spam').pagina_web,
    ).toBe('http://spam')
  })
})

describe('mensagens de falha', () => {
  it('a API manda o motivo em português nos erros de quem preenche (4xx): é mostrado como veio', () => {
    expect(
      mensagemDeFalhaDoEnvio(
        new ApiError('x', 422, 'A pergunta "Qual?" é obrigatória.'),
      ),
    ).toBe('A pergunta "Qual?" é obrigatória.')
    expect(
      mensagemDeFalhaDoEnvio(
        new ApiError(
          'x',
          400,
          'As inscrições deste evento já foram encerradas: o evento já aconteceu.',
        ),
      ),
    ).toBe(
      'As inscrições deste evento já foram encerradas: o evento já aconteceu.',
    )
  })

  it('429: o motivo da API (ou, sem ele, um aviso para esperar)', () => {
    expect(
      mensagemDeFalhaDoEnvio(
        new ApiError(
          'x',
          429,
          'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.',
        ),
      ),
    ).toBe('Muitas tentativas - aguarde 60 minutos antes de tentar novamente.')
    expect(mensagemDeFalhaDoEnvio(new ApiError('x', 429))).toContain(
      'Aguarde um pouco',
    )
  })

  it('erro de servidor e queda de rede: orientação sem culpar a pessoa; a queda avisa que a inscrição pode ter sido feita', () => {
    const servidor = mensagemDeFalhaDoEnvio(
      new ApiError('x', 500, 'Internal Server Error'),
    )
    expect(servidor).toContain('Não foi possível enviar a inscrição agora')
    expect(servidor).not.toContain('Internal Server Error')
    const rede = mensagemDeFalhaDoEnvio(new ApiError('x'))
    expect(rede).toContain('Não foi possível enviar a inscrição agora')
    expect(rede).toContain('pode ter sido registrada')
    expect(mensagemDeFalhaDoEnvio(new Error('x'))).toContain('Tente de novo')
  })

  it('CPF já inscrito: a frase da API mais o que fazer; em grupo, avisa que parte do grupo pode já estar inscrita', () => {
    const repetida = new ApiError(
      'x',
      400,
      "Esta pessoa já está inscrita neste contexto (status 'Pré-inscrito').",
    )
    const sozinha = mensagemDeFalhaDoEnvio(repetida, 1)
    expect(sozinha).toContain(
      "já está inscrita neste contexto (status 'Pré-inscrito').",
    )
    expect(sozinha).toContain(
      'Confira o CPF digitado ou fale com a secretaria.',
    )
    expect(sozinha).not.toContain('várias pessoas')
    expect(mensagemDeFalhaDoEnvio(repetida, 3)).toContain(
      'Como são várias pessoas',
    )
  })

  it('só o 422 do consentimento é "texto atualizado"', () => {
    const novo = new ApiError(
      'x',
      422,
      'O texto de consentimento LGPD foi atualizado - recarregue a página e aceite a versão atual.',
    )
    expect(consentimentoDesatualizado(novo)).toBe(true)
    expect(
      consentimentoDesatualizado(
        new ApiError('x', 422, 'A pergunta "Qual?" é obrigatória.'),
      ),
    ).toBe(false)
    expect(
      consentimentoDesatualizado(new ApiError('x', 400, 'consentimento')),
    ).toBe(false)
    expect(consentimentoDesatualizado(new Error('x'))).toBe(false)
  })
})

describe('buscarConsentimento', () => {
  const opcoes = (fetchImpl: typeof fetch) => ({
    baseUrl: 'https://api.teste',
    fetchImpl,
    esperaEntreTentativasMs: 0,
  })

  it('devolve o texto exatamente como veio e a versão, da rota certa', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        resposta({ texto: '  Linha 1\nLinha 2  ', versao: '7' }),
      )
    const lido = await buscarConsentimento(opcoes(fetchImpl))
    expect(lido).toEqual({ texto: '  Linha 1\nLinha 2  ', versao: '7' })
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.teste/api/publico/eventos/consentimento-lgpd',
    )
  })

  it('versão numérica vira texto', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(resposta({ texto: 'x', versao: 2 }))
    expect((await buscarConsentimento(opcoes(fetchImpl))).versao).toBe('2')
  })

  it('texto em branco, sem versão ou resposta torta: erro (aceitar o que não se leu não vale)', async () => {
    for (const corpo of [
      { texto: '   ', versao: '1' },
      { texto: '', versao: '1' },
      { texto: 'x' },
      { texto: 'x', versao: '' },
      { texto: 5, versao: '1' },
      null,
    ]) {
      const fetchImpl = vi.fn().mockResolvedValue(resposta(corpo))
      await expect(
        buscarConsentimento(opcoes(fetchImpl)),
      ).rejects.toBeInstanceOf(ApiError)
    }
  })

  it('API fora do ar ou antiga (404): erro; o 5xx tem uma segunda tentativa, o 404 não', async () => {
    const antiga = vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404))
    await expect(buscarConsentimento(opcoes(antiga))).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(antiga).toHaveBeenCalledTimes(1)
    const caiu = vi
      .fn()
      .mockResolvedValueOnce(resposta({ detail: 'x' }, 502))
      .mockResolvedValueOnce(resposta({ texto: 'x', versao: '1' }))
    expect((await buscarConsentimento(opcoes(caiu))).versao).toBe('1')
    expect(caiu).toHaveBeenCalledTimes(2)
  })
})

describe('a resposta da inscrição', () => {
  const pessoa = (
    extra: Partial<ParticipanteInscrito> = {},
  ): ParticipanteInscrito => ({
    nome_completo: 'Maria',
    status: 'Pré-inscrito',
    codigo_checkin: 'A1B2C3D4',
    token_cancelamento: 'tok-1',
    email_enviado: true,
    ...extra,
  })

  it('lê cada participante (nome, situação, código, link, e-mail)', () => {
    const lidas = lerResposta({
      mensagem: 'Inscrição registrada.',
      participantes: [
        {
          nome_completo: 'Maria',
          status: 'Pré-inscrito',
          codigo_checkin: 'A1B2C3D4',
          token_cancelamento: 'tok-1',
          email_enviado: true,
          id_inscricao: 1,
          valor_cobrado: null,
        },
        {
          nome_completo: 'Pedro',
          status: 'Lista de Espera',
          codigo_checkin: 'B',
          token_cancelamento: 'tok-2',
          email_enviado: false,
        },
      ],
    })
    expect(lidas).toEqual([
      pessoa(),
      pessoa({
        nome_completo: 'Pedro',
        status: 'Lista de Espera',
        codigo_checkin: 'B',
        token_cancelamento: 'tok-2',
        email_enviado: false,
      }),
    ])
  })

  it('armadilha de robô: sucesso sem participantes e sem código = lista vazia (a tela mostra só o título)', () => {
    expect(
      lerResposta({
        mensagem: 'Inscrição registrada.',
        codigo_checkin: null,
        email_enviado: false,
      }),
    ).toEqual([])
    expect(lerResposta(null)).toEqual([])
    expect(lerResposta('torta')).toEqual([])
  })

  it('sem a lista `participantes`, vale o que vem no topo (uma pessoa só)', () => {
    expect(
      lerResposta(
        {
          status: 'Pré-inscrito',
          codigo_checkin: 'AA',
          token_cancelamento: 'tok',
          email_enviado: true,
        },
        'Maria',
      ),
    ).toEqual([pessoa({ codigo_checkin: 'AA', token_cancelamento: 'tok' })])
  })

  it('a situação em palavras simples', () => {
    expect(situacaoEmPalavras('Pré-inscrito')).toEqual({
      rotulo: 'Vaga reservada',
      listaDeEspera: false,
    })
    expect(situacaoEmPalavras('Lista de Espera')).toEqual({
      rotulo: 'Lista de espera',
      listaDeEspera: true,
    })
    expect(situacaoEmPalavras('Confirmado').rotulo).toBe('Vaga confirmada')
    expect(situacaoEmPalavras('Outra').rotulo).toBe('Outra')
  })

  it('o link da inscrição leva o código na query (e o protege)', () => {
    expect(caminhoDoLinkDaInscricao('abc-DEF_123')).toBe(
      '/cancelar-inscricao/?token=abc-DEF_123',
    )
    expect(caminhoDoLinkDaInscricao('a b&c')).toBe(
      '/cancelar-inscricao/?token=a%20b%26c',
    )
  })

  it('a frase do e-mail: enviado para todos, para ninguém ou misto (aí cada pessoa diz o seu)', () => {
    expect(fraseDoEmail([pessoa()], 'maria@example.com')).toBe(
      'Enviamos um e-mail para maria@example.com com o código e o link.',
    )
    expect(
      fraseDoEmail([pessoa({ status: 'Lista de Espera' })], 'm@e.co'),
    ).toBe('Enviamos um e-mail para m@e.co com o código e o link.')
    expect(
      fraseDoEmail(
        [pessoa({ codigo_checkin: null, status: 'Lista de Espera' })],
        'm@e.co',
      ),
    ).toBe('Enviamos um e-mail para m@e.co com o link.')
    expect(fraseDoEmail([pessoa({ email_enviado: false })], 'm@e.co')).toBe(
      'Não conseguimos enviar o e-mail: guarde o código e o link desta tela.',
    )
    expect(
      fraseDoEmail([pessoa(), pessoa({ email_enviado: false })], 'm@e.co'),
    ).toBeNull()
    expect(fraseDoEmail([], 'm@e.co')).toBeNull()
  })
})

/* ---------------------------------------------------------------------------------------------------------------------------- */
/* O formulário no navegador (jsdom): o mesmo contrato de HTML que `FormularioDeInscricao.astro` produz                         */
/* ---------------------------------------------------------------------------------------------------------------------------- */

const erroP = (chave: string) =>
  `<p data-erro="${chave}" id="erro-${chave}" hidden></p>`

function controleDaPergunta(
  indice: number | string,
  p: PerguntaDoEvento,
): string {
  const chave = chaveDaPergunta(indice, p.id_pergunta)
  const id = `i-p${indice}-q${p.id_pergunta}`
  const opcoes = opcoesDaPergunta(p)
  if (p.tipo === 'SELECAO_UNICA' && escolhaUnicaEmRadios(p))
    return `<fieldset role="radiogroup" data-campo="${chave}">${opcoes
      .map(
        (o) =>
          `<label><input type="radio" name="${id}" value="${o}">${o}</label>`,
      )
      .join('')}${erroP(chave)}</fieldset>`
  if (p.tipo === 'SELECAO_UNICA')
    return `<select id="${id}" data-campo="${chave}"><option value="">Escolha</option>${opcoes
      .map((o) => `<option value="${o}">${o}</option>`)
      .join('')}</select>${erroP(chave)}`
  if (p.tipo === 'SELECAO_MULTIPLA')
    return `<fieldset data-campo="${chave}">${opcoes
      .map(
        (o) =>
          `<label><input type="checkbox" name="${id}" value="${o}">${o}</label>`,
      )
      .join('')}${erroP(chave)}</fieldset>`
  if (p.tipo === 'TEXTO_LONGO')
    return `<textarea id="${id}" data-campo="${chave}"></textarea>${erroP(chave)}`
  return `<input id="${id}" type="${p.tipo === 'DATA' ? 'date' : 'text'}" data-campo="${chave}">${erroP(chave)}`
}

interface Montagem {
  secao: HTMLElement
  form: HTMLFormElement
  resultado: HTMLElement
}

function montar(
  opcoes: {
    perguntas?: PerguntaDoEvento[]
    sessoes?: Array<{ id: number; rotulo: string; livres: number | null }>
    vagasLivres?: number | null
  } = {},
): Montagem {
  const perguntas = opcoes.perguntas ?? PERGUNTAS
  const sessoes = opcoes.sessoes ?? []
  const idDe = (chave: string) => `x-${chave}`
  document.body.innerHTML = `
    <div data-como-participar>
    <section data-inscricao-formulario data-api-url="https://api.teste" data-id-evento="7"
      ${opcoes.vagasLivres !== undefined && opcoes.vagasLivres !== null ? `data-vagas-livres="${opcoes.vagasLivres}"` : ''}>
      <p data-introducao>Preencha os dados.</p>
      <p data-aviso-esgotado role="status" ${opcoes.vagasLivres === 0 ? '' : 'hidden'}>${AVISO_SEM_VAGAS}</p>
      <form data-inscricao-form data-perguntas='${JSON.stringify(perguntas)}' novalidate>
        <p data-resumo-de-erros role="alert" hidden></p>
        <div data-participante data-indice="0">
          <input id="${idDe('nome')}" data-campo="${chaveDoNome(0)}">${erroP(chaveDoNome(0))}
          <input id="${idDe('cpf')}" data-campo="${chaveDoCpf(0)}">${erroP(chaveDoCpf(0))}
          <input id="${idDe('email')}" data-campo="email">${erroP('email')}
          <input id="${idDe('telefone')}" data-campo="telefone">${erroP('telefone')}
          ${
            sessoes.length > 0
              ? `<select id="${idDe('sessao')}" data-campo="sessao"><option value="">Todo o evento</option>${sessoes
                  .map(
                    (s) =>
                      `<option value="${s.id}" data-sessao="${s.id}" data-rotulo="${s.rotulo}" ${s.livres === null ? '' : `data-vagas-livres="${s.livres}"`}>${textoDaOpcaoDaSessao(s.rotulo, s.livres)}</option>`,
                  )
                  .join('')}</select>`
              : ''
          }
          ${perguntas
            .filter((p) => p.tipo !== 'ARQUIVO')
            .map((p) => controleDaPergunta(0, p))
            .join('')}
        </div>
        <div data-grupo>
          <div data-participantes-adicionais></div>
          <button type="button" data-adicionar-participante>Inscrever mais uma pessoa</button>
          <p data-limite-de-pessoas hidden>Limite</p>
        </div>
        <div>
          <p data-consentimento-estado>Carregando…</p>
          <button type="button" data-recarregar-consentimento hidden>Tentar carregar de novo</button>
          <div data-consentimento-texto hidden></div>
          <input type="checkbox" data-campo="consentimento" disabled>${erroP('consentimento')}
        </div>
        <input type="text" name="pagina_web" tabindex="-1">
        <p data-falha-do-envio role="alert" tabindex="-1" hidden></p>
        <button type="submit" data-enviar>Enviar inscrição</button>
      </form>
      <template data-modelo-participante>
        <fieldset data-participante data-indice="__N__">
          <legend data-titulo-da-pessoa>Pessoa</legend>
          <input id="x-nome-__N__" data-campo="${chaveDoNome('__N__')}">${erroP(chaveDoNome('__N__'))}
          <input id="x-cpf-__N__" data-campo="${chaveDoCpf('__N__')}">${erroP(chaveDoCpf('__N__'))}
          ${perguntas
            .filter((p) => p.tipo !== 'ARQUIVO')
            .map((p) => controleDaPergunta('__N__', p))
            .join('')}
          <button type="button" data-remover-participante>Remover esta pessoa</button>
        </fieldset>
      </template>
      <div data-resultado role="status" tabindex="-1" hidden>
        <p data-resultado-email hidden></p>
        <ul data-resultado-lista></ul>
      </div>
    </section></div>`
  return {
    secao: document.querySelector<HTMLElement>('[data-inscricao-formulario]')!,
    form: document.querySelector<HTMLFormElement>('form')!,
    resultado: document.querySelector<HTMLElement>('[data-resultado]')!,
  }
}

const CONSENTIMENTO = {
  texto: 'Texto do consentimento.\nSegunda linha.',
  versao: '3',
}
const consentimentoOk = () => resposta(CONSENTIMENTO)
const esperar = () => new Promise((r) => setTimeout(r, 0))
const esperarVarias = async (n = 4) => {
  for (let i = 0; i < n; i++) await esperar()
}
const enviar = (form: HTMLFormElement) =>
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
const el = <T extends HTMLElement = HTMLElement>(seletor: string) =>
  document.querySelector<T>(seletor)!
const campo = <T extends HTMLElement = HTMLInputElement>(chave: string) =>
  document.querySelector<T>(`[data-campo="${chave}"]`)!
const digitar = (chave: string, valor: string) => {
  const c = campo<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    chave,
  )
  c.value = valor
  c.dispatchEvent(new Event('input', { bubbles: true }))
}
const marcar = (chave: string, ...valores: string[]) => {
  for (const caixa of campo<HTMLElement>(
    chave,
  ).querySelectorAll<HTMLInputElement>('input')) {
    caixa.checked = valores.includes(caixa.value)
    caixa.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

/** Preenche a pessoa de índice `indice` com respostas certas às `PERGUNTAS`. */
function preencherPessoa(indice: number | string, nome: string, cpf: string) {
  digitar(chaveDoNome(indice), nome)
  digitar(chaveDoCpf(indice), cpf)
  marcar(chaveDaPergunta(indice, 1), 'Sim')
  digitar(chaveDaPergunta(indice, 2), '30')
  digitar(chaveDaPergunta(indice, 3), 'Apelido')
  marcar(chaveDaPergunta(indice, 5), 'Café', 'Jantar')
}

function preencherTudo() {
  preencherPessoa(0, 'Maria de Teste Silva', CPF_A)
  digitar('email', 'maria@example.com')
  digitar('telefone', '(91) 98888-7777')
  campo('consentimento').click()
}

const respostaDaInscricao = (extra: Record<string, unknown> = {}) => ({
  mensagem: 'Inscrição registrada.',
  identificador_grupo: null,
  participantes: [
    {
      nome_completo: 'Maria de Teste Silva',
      id_inscricao: 1,
      status: 'Pré-inscrito',
      codigo_checkin: 'A1B2C3D4',
      token_cancelamento: 'tok-maria-0001',
      email_enviado: true,
      valor_cobrado: null,
    },
  ],
  status: 'Pré-inscrito',
  codigo_checkin: 'A1B2C3D4',
  token_cancelamento: 'tok-maria-0001',
  email_enviado: true,
  ...extra,
})

/** `fetchImpl` que atende a consulta do consentimento e deixa o envio ao `envio`. */
function api(envio: () => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const endereco = String(url)
    if (endereco.endsWith('/consentimento-lgpd')) return consentimentoOk()
    return envio()
  })
  return fetchImpl as unknown as typeof fetch & ReturnType<typeof vi.fn>
}
const envios = (fetchImpl: ReturnType<typeof vi.fn>) =>
  fetchImpl.mock.calls.filter(
    ([url]) => !String(url).endsWith('/consentimento-lgpd'),
  )

describe('o consentimento no formulário', () => {
  it('mostra o texto da API exatamente como veio e só então libera a caixa "Li e aceito"', async () => {
    montar()
    iniciarFormularioDeInscricao(el('[data-inscricao-formulario]'), {
      fetchImpl: api(() => resposta({})),
    })
    expect(campo<HTMLInputElement>('consentimento').disabled).toBe(true)
    expect(el('[data-consentimento-estado]').textContent).toBe(
      'Carregando o texto do consentimento…',
    )
    await esperarVarias()
    expect(el('[data-consentimento-texto]').textContent).toBe(
      CONSENTIMENTO.texto,
    )
    expect(el('[data-consentimento-texto]').hidden).toBe(false)
    expect(el('[data-consentimento-estado]').hidden).toBe(true)
    expect(campo<HTMLInputElement>('consentimento').disabled).toBe(false)
  })

  it('a busca falhou: erro claro, caixa travada, "Tentar de novo" e NÃO envia; ao voltar, libera', async () => {
    const { form } = montar()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(resposta({ detail: 'x' }, 404))
      .mockResolvedValueOnce(consentimentoOk())
    iniciarFormularioDeInscricao(el('[data-inscricao-formulario]'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await esperarVarias()
    expect(el('[data-consentimento-estado]').textContent).toContain(
      'Não foi possível carregar o texto do consentimento',
    )
    expect(el('[data-recarregar-consentimento]').hidden).toBe(false)
    expect(campo<HTMLInputElement>('consentimento').disabled).toBe(true)
    // preenche tudo e tenta enviar: sem texto lido, não vai
    preencherPessoa(0, 'Maria de Teste Silva', CPF_A)
    digitar('email', 'maria@example.com')
    digitar('telefone', '91988887777')
    enviar(form)
    expect(el('[data-erro="consentimento"]').textContent).toContain(
      'Tentar carregar de novo',
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // "Tentar de novo" busca outra vez
    el('[data-recarregar-consentimento]').click()
    await esperarVarias()
    expect(el('[data-consentimento-texto]').textContent).toBe(
      CONSENTIMENTO.texto,
    )
    expect(campo<HTMLInputElement>('consentimento').disabled).toBe(false)
    expect(el('[data-recarregar-consentimento]').hidden).toBe(true)
  })
})

describe('enviar a inscrição', () => {
  it('em branco: não chama a API, mostra o resumo, liga cada aviso ao campo e foca o primeiro', async () => {
    const { form } = montar()
    const fetchImpl = api(() => resposta({}))
    iniciarFormularioDeInscricao(el('[data-inscricao-formulario]'), {
      fetchImpl,
    })
    await esperarVarias()
    enviar(form)
    expect(envios(fetchImpl)).toHaveLength(0)
    const resumo = el('[data-resumo-de-erros]')
    expect(resumo.hidden).toBe(false)
    expect(resumo.textContent).toBe('Há 9 campos para corrigir.')
    expect(el(`[data-erro="${chaveDoNome(0)}"]`).textContent).toBe(
      'Informe o nome completo.',
    )
    expect(campo(chaveDoNome(0)).getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(campo(chaveDoNome(0)))
    // o grupo de botões leva o aviso e a marca de inválido no grupo
    expect(
      campo<HTMLElement>(chaveDaPergunta(0, 1)).getAttribute('aria-invalid'),
    ).toBe('true')
  })

  it('quem corrige um campo vê o aviso dele sumir e o resumo acompanhar', async () => {
    const { form } = montar()
    iniciarFormularioDeInscricao(el('[data-inscricao-formulario]'), {
      fetchImpl: api(() => resposta({})),
    })
    await esperarVarias()
    enviar(form)
    digitar(chaveDoNome(0), 'Maria de Teste')
    expect(el(`[data-erro="${chaveDoNome(0)}"]`).hidden).toBe(true)
    expect(campo(chaveDoNome(0)).hasAttribute('aria-invalid')).toBe(false)
    expect(el('[data-resumo-de-erros]').textContent).toBe(
      'Há 8 campos para corrigir.',
    )
    // marcar um botão do grupo limpa o aviso do grupo
    marcar(chaveDaPergunta(0, 1), 'Sim')
    expect(el(`[data-erro="${chaveDaPergunta(0, 1)}"]`).hidden).toBe(true)
    expect(el('[data-resumo-de-erros]').textContent).toBe(
      'Há 7 campos para corrigir.',
    )
  })

  it('inscrição certa: corpo limpo para a rota do evento, e a tela mostra nome, situação, código em destaque e link para cancelar', async () => {
    const { form, secao, resultado } = montar()
    const fetchImpl = api(() => resposta(respostaDaInscricao()))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    enviar(form)
    await esperarVarias()
    const [[url, init]] = envios(fetchImpl) as [[string, RequestInit]]
    expect(url).toBe('https://api.teste/api/publico/eventos/7/inscrever-se')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      nome_completo: 'Maria de Teste Silva',
      cpf: '39053344705',
      email: 'maria@example.com',
      telefone: '91988887777',
      respostas: {
        '1': 'Sim',
        '2': 30,
        '3': 'Apelido',
        '5': ['Café', 'Jantar'],
      },
      participantes_adicionais: [],
      consentimento_lgpd: true,
      versao_texto_consentimento: '3',
      pagina_web: '',
    })
    expect(form.hidden).toBe(true)
    expect(el('[data-introducao]').hidden).toBe(true)
    expect(resultado.hidden).toBe(false)
    expect(document.activeElement).toBe(resultado)
    expect(secao.hasAttribute('data-concluida')).toBe(true)
    expect(el('[data-resultado-email]').textContent).toBe(
      'Enviamos um e-mail para maria@example.com com o código e o link.',
    )
    const itens = resultado.querySelectorAll('[data-resultado-lista] li')
    expect(itens).toHaveLength(1)
    const item = itens[0]!
    expect(item.textContent).toContain('Maria de Teste Silva')
    expect(item.textContent).toContain('Situação: Vaga reservada')
    expect(item.querySelector('[data-codigo]')!.textContent).toBe('A1B2C3D4')
    expect(item.textContent).toContain(
      'Apresente este código na entrada do evento.',
    )
    expect(item.textContent).toContain(
      'Guarde este link: é por ele que você cancela ou confirma a sua vaga.',
    )
    expect(item.querySelector('a')!.getAttribute('href')).toBe(
      '/cancelar-inscricao/?token=tok-maria-0001',
    )
    expect(item.textContent).not.toContain(AVISO_DA_LISTA_DE_ESPERA)
  })

  it('lista de espera: sem código (mesmo que a API o mande), com a frase de aviso por e-mail e o link', async () => {
    const { form, secao, resultado } = montar()
    iniciarFormularioDeInscricao(secao, {
      fetchImpl: api(() =>
        resposta(
          respostaDaInscricao({
            participantes: [
              {
                nome_completo: 'Maria de Teste Silva',
                status: 'Lista de Espera',
                codigo_checkin: 'A1B2C3D4',
                token_cancelamento: 'tok-maria-0001',
                email_enviado: true,
              },
            ],
          }),
        ),
      ),
    })
    await esperarVarias()
    preencherTudo()
    enviar(form)
    await esperarVarias()
    const item = resultado.querySelector('[data-resultado-lista] li')!
    expect(item.textContent).toContain('Situação: Lista de espera')
    expect(item.textContent).toContain(
      'Você será avisado(a) por e-mail se uma vaga abrir.',
    )
    expect(item.querySelector('[data-codigo]')).toBeNull()
    expect(item.textContent).not.toContain('Código de check-in')
    expect(item.querySelector('a')!.getAttribute('href')).toBe(
      '/cancelar-inscricao/?token=tok-maria-0001',
    )
  })

  it('e-mail que não saiu: a tela manda guardar o código e o link; a armadilha de robô mostra só o título, sem código', async () => {
    const { form, secao, resultado } = montar()
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/consentimento-lgpd')
        ? consentimentoOk()
        : resposta(
            respostaDaInscricao({
              participantes: [
                {
                  nome_completo: 'Maria',
                  status: 'Pré-inscrito',
                  codigo_checkin: 'AA11BB22',
                  token_cancelamento: 'tok-1-xxxxxxxx',
                  email_enviado: false,
                },
              ],
            }),
          ),
    )
    iniciarFormularioDeInscricao(secao, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await esperarVarias()
    preencherTudo()
    enviar(form)
    await esperarVarias()
    expect(el('[data-resultado-email]').textContent).toBe(
      'Não conseguimos enviar o e-mail: guarde o código e o link desta tela.',
    )
    expect(resultado.querySelector('[data-codigo]')!.textContent).toBe(
      'AA11BB22',
    )

    // robô: 200 sem participantes
    const robo = montar()
    iniciarFormularioDeInscricao(robo.secao, {
      fetchImpl: api(() =>
        resposta({
          mensagem: 'Inscrição registrada.',
          codigo_checkin: null,
          email_enviado: false,
        }),
      ),
    })
    await esperarVarias()
    preencherTudo()
    enviar(robo.form)
    await esperarVarias()
    expect(robo.resultado.hidden).toBe(false)
    expect(robo.resultado.querySelectorAll('li')).toHaveLength(0)
    expect(robo.resultado.querySelector('[data-codigo]')).toBeNull()
  })

  it('a armadilha preenchida vai no corpo (a API a descarta); o campo some da tabulação', async () => {
    const { form, secao } = montar()
    const fetchImpl = api(() => resposta(respostaDaInscricao()))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    el<HTMLInputElement>('input[name="pagina_web"]').value = 'http://spam'
    enviar(form)
    await esperarVarias()
    const [[, init]] = envios(fetchImpl) as [[string, RequestInit]]
    expect(JSON.parse(String(init.body)).pagina_web).toBe('http://spam')
  })

  it('um segundo envio enquanto o primeiro está a caminho é ignorado e o botão fica travado', async () => {
    const { form, secao } = montar()
    let soltar: (r: Response) => void = () => {}
    const fetchImpl = api(() => new Promise<Response>((r) => (soltar = r)))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    enviar(form)
    await esperarVarias()
    const botao = el<HTMLButtonElement>('[data-enviar]')
    expect(botao.disabled).toBe(true)
    expect(botao.textContent).toBe('Enviando…')
    enviar(form)
    await esperarVarias()
    expect(envios(fetchImpl)).toHaveLength(1)
    soltar(resposta(respostaDaInscricao()))
    await esperarVarias()
    expect(envios(fetchImpl)).toHaveLength(1)
  })

  it.each([
    [
      422,
      'A pergunta "Qual?" é obrigatória.',
      'A pergunta "Qual?" é obrigatória.',
    ],
    [
      429,
      'Muitas tentativas - aguarde 60 minutos antes de tentar novamente.',
      'Muitas tentativas - aguarde 60 minutos',
    ],
    [
      500,
      'Erro interno do servidor.',
      'Não foi possível enviar a inscrição agora',
    ],
    [
      400,
      'As inscrições deste evento já foram encerradas: o evento já aconteceu.',
      'já foram encerradas',
    ],
  ])(
    'falha %i: a pessoa lê o motivo, não perde o que digitou e pode tentar de novo',
    async (status, detalhe, esperado) => {
      const { form, secao } = montar()
      iniciarFormularioDeInscricao(secao, {
        fetchImpl: api(() => resposta({ detail: detalhe }, status)),
      })
      await esperarVarias()
      preencherTudo()
      enviar(form)
      await esperarVarias()
      const falha = el('[data-falha-do-envio]')
      expect(falha.hidden).toBe(false)
      expect(falha.textContent).toContain(esperado)
      expect(document.activeElement).toBe(falha)
      expect(campo(chaveDoNome(0)).value).toBe('Maria de Teste Silva')
      expect(el<HTMLButtonElement>('[data-enviar]').disabled).toBe(false)
      expect(el<HTMLButtonElement>('[data-enviar]').textContent).toBe(
        'Enviar inscrição',
      )
      expect(form.hidden).toBe(false)
    },
  )

  it('sem rede: orientação, e o que foi digitado fica', async () => {
    const { form, secao } = montar()
    iniciarFormularioDeInscricao(secao, {
      fetchImpl: vi.fn(async (url: string) => {
        if (String(url).endsWith('/consentimento-lgpd'))
          return consentimentoOk()
        throw new TypeError('rede')
      }) as unknown as typeof fetch,
    })
    await esperarVarias()
    preencherTudo()
    enviar(form)
    await esperarVarias()
    expect(el('[data-falha-do-envio]').textContent).toContain(
      'pode ter sido registrada',
    )
    expect(campo(chaveDoCpf(0)).value).toBe(CPF_A)
  })

  it('o texto do consentimento mudou (422): busca o novo, desmarca a caixa e pede o aceite de novo', async () => {
    const { form, secao } = montar()
    let consulta = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith('/consentimento-lgpd'))
        return resposta(
          ++consulta === 1
            ? CONSENTIMENTO
            : { texto: 'Texto NOVO.', versao: '4' },
        )
      return resposta(
        {
          detail:
            'O texto de consentimento LGPD foi atualizado - recarregue a página e aceite a versão atual.',
        },
        422,
      )
    })
    iniciarFormularioDeInscricao(secao, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await esperarVarias()
    preencherTudo()
    enviar(form)
    await esperarVarias(6)
    expect(el('[data-consentimento-texto]').textContent).toBe('Texto NOVO.')
    expect(campo<HTMLInputElement>('consentimento').checked).toBe(false)
    expect(el('[data-falha-do-envio]').textContent).toContain('foi atualizado')
    expect(el<HTMLButtonElement>('[data-enviar]').disabled).toBe(false)
    // aceita a versão nova: o corpo leva a versão nova
    campo('consentimento').click()
    fetchImpl.mockImplementation(async (url: string) =>
      String(url).endsWith('/consentimento-lgpd')
        ? resposta({ texto: 'Texto NOVO.', versao: '4' })
        : resposta(respostaDaInscricao()),
    )
    enviar(form)
    await esperarVarias()
    const ultima = fetchImpl.mock.calls.at(-1)! as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(ultima[1].body)).versao_texto_consentimento).toBe(
      '4',
    )
  })
})

describe('inscrição em grupo', () => {
  it('"Inscrever mais uma pessoa" acrescenta um bloco com ids únicos, as mesmas perguntas e título "Pessoa 2"', async () => {
    const { secao } = montar()
    iniciarFormularioDeInscricao(secao, { fetchImpl: api(() => resposta({})) })
    await esperarVarias()
    el('[data-adicionar-participante]').click()
    el('[data-adicionar-participante]').click()
    const blocos = document.querySelectorAll<HTMLElement>(
      '[data-participantes-adicionais] [data-participante]',
    )
    expect(blocos).toHaveLength(2)
    expect([...blocos].map((b) => b.dataset.indice)).toEqual(['1', '2'])
    expect(
      [...blocos].map(
        (b) => b.querySelector('[data-titulo-da-pessoa]')!.textContent,
      ),
    ).toEqual(['Pessoa 2', 'Pessoa 3'])
    // cada campo tem a chave da sua pessoa, e nenhum id se repete
    expect(campo(chaveDoNome(2))).toBeTruthy()
    expect(campo(chaveDaPergunta(1, 5))).toBeTruthy()
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    // o foco vai para o nome da pessoa nova
    expect(document.activeElement).toBe(campo(chaveDoNome(2)))
    expect(el('[data-participantes-adicionais]').innerHTML).not.toContain(
      '__N__',
    )
  })

  it('remover renumera as outras e devolve o foco ao botão de adicionar; o número do bloco nunca é reaproveitado', async () => {
    const { secao } = montar()
    iniciarFormularioDeInscricao(secao, { fetchImpl: api(() => resposta({})) })
    await esperarVarias()
    el('[data-adicionar-participante]').click()
    el('[data-adicionar-participante]').click()
    el<HTMLButtonElement>(
      '[data-participante][data-indice="1"] [data-remover-participante]',
    ).click()
    const restantes = document.querySelectorAll<HTMLElement>(
      '[data-participantes-adicionais] [data-participante]',
    )
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.dataset.indice).toBe('2')
    expect(
      restantes[0]!.querySelector('[data-titulo-da-pessoa]')!.textContent,
    ).toBe('Pessoa 2')
    expect(
      restantes[0]!.querySelector('[data-remover-participante]')!.textContent,
    ).toBe('Remover a pessoa 2')
    expect(document.activeElement).toBe(el('[data-adicionar-participante]'))
    el('[data-adicionar-participante]').click()
    expect(
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-participantes-adicionais] [data-participante]',
        ),
      ].map((b) => b.dataset.indice),
    ).toEqual(['2', '3'])
  })

  it('o limite é 9 pessoas adicionais: o botão trava e o aviso aparece; remover destrava', async () => {
    const { secao } = montar()
    iniciarFormularioDeInscricao(secao, { fetchImpl: api(() => resposta({})) })
    await esperarVarias()
    const adicionar = el<HTMLButtonElement>('[data-adicionar-participante]')
    for (let i = 0; i < 12; i++) adicionar.click()
    expect(
      document.querySelectorAll(
        '[data-participantes-adicionais] [data-participante]',
      ),
    ).toHaveLength(9)
    expect(adicionar.disabled).toBe(true)
    expect(el('[data-limite-de-pessoas]').hidden).toBe(false)
    el<HTMLButtonElement>('[data-remover-participante]').click()
    expect(adicionar.disabled).toBe(false)
    expect(el('[data-limite-de-pessoas]').hidden).toBe(true)
  })

  it('o aviso de cada pessoa é dela; o foco vai ao primeiro erro NA ORDEM DA PÁGINA (a principal antes das outras)', async () => {
    const { form, secao } = montar()
    const fetchImpl = api(() => resposta({}))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    el('[data-adicionar-participante]').click()
    enviar(form)
    expect(envios(fetchImpl)).toHaveLength(0)
    // a pessoa 2 está em branco: nome, CPF e as 4 perguntas obrigatórias
    expect(el('[data-resumo-de-erros]').textContent).toBe(
      'Há 6 campos para corrigir.',
    )
    expect(el(`[data-erro="${chaveDoNome(1)}"]`).hidden).toBe(false)
    expect(el(`[data-erro="${chaveDoNome(0)}"]`).hidden).toBe(true)
    expect(document.activeElement).toBe(campo(chaveDoNome(1)))
  })

  it('corpo do grupo: a principal no topo e a outra em `participantes_adicionais`; a tela mostra cada pessoa, com o seu código e o seu link', async () => {
    const { form, secao, resultado } = montar()
    const fetchImpl = api(() =>
      resposta(
        respostaDaInscricao({
          identificador_grupo: 'grupo-1',
          participantes: [
            {
              nome_completo: 'Maria de Teste Silva',
              id_inscricao: 1,
              status: 'Pré-inscrito',
              codigo_checkin: 'A1B2C3D4',
              token_cancelamento: 'tok-maria-0001',
              email_enviado: true,
            },
            {
              nome_completo: 'Pedro de Teste',
              id_inscricao: 2,
              status: 'Lista de Espera',
              codigo_checkin: 'E5F6A7B8',
              token_cancelamento: 'tok-pedro-0002',
              email_enviado: true,
            },
          ],
        }),
      ),
    )
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    el('[data-adicionar-participante]').click()
    preencherPessoa(1, 'Pedro de Teste', CPF_B)
    enviar(form)
    await esperarVarias()
    const [[, init]] = envios(fetchImpl) as [[string, RequestInit]]
    const corpo = JSON.parse(String(init.body))
    expect(corpo.nome_completo).toBe('Maria de Teste Silva')
    expect(corpo.participantes_adicionais).toEqual([
      {
        nome_completo: 'Pedro de Teste',
        cpf: '11144477735',
        respostas: {
          '1': 'Sim',
          '2': 30,
          '3': 'Apelido',
          '5': ['Café', 'Jantar'],
        },
      },
    ])
    const itens = resultado.querySelectorAll('[data-resultado-lista] li')
    expect(itens).toHaveLength(2)
    expect(itens[0]!.querySelector('[data-codigo]')!.textContent).toBe(
      'A1B2C3D4',
    )
    expect(itens[1]!.querySelector('[data-codigo]')).toBeNull()
    expect(itens[1]!.textContent).toContain('Lista de espera')
    expect(
      [...resultado.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual([
      '/cancelar-inscricao/?token=tok-maria-0001',
      '/cancelar-inscricao/?token=tok-pedro-0002',
    ])
    // e-mail enviado para todos: uma frase só, no topo
    expect(el('[data-resultado-email]').textContent).toBe(
      'Enviamos um e-mail para maria@example.com com o código e o link.',
    )
  })

  it('o mesmo CPF na principal e na outra pessoa é apontado antes de enviar', async () => {
    const { form, secao } = montar()
    const fetchImpl = api(() => resposta({}))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    el('[data-adicionar-participante]').click()
    preencherPessoa(1, 'Pedro de Teste', CPF_A)
    enviar(form)
    expect(envios(fetchImpl)).toHaveLength(0)
    expect(el(`[data-erro="${chaveDoCpf(1)}"]`).textContent).toContain(
      'já foi informado',
    )
    expect(document.activeElement).toBe(campo(chaveDoCpf(1)))
  })
})

describe('perguntas em controles diferentes', () => {
  it('escolha única com mais de 5 opções (lista) e sem pergunta nenhuma também funcionam', async () => {
    const perguntas = [
      pergunta(1, 'SELECAO_UNICA', { opcoes: 'PP,P,M,G,GG,XG' }),
      pergunta(2, 'TEXTO_LONGO', { obrigatoria: false }),
    ]
    const { form, secao } = montar({ perguntas })
    const fetchImpl = api(() => resposta(respostaDaInscricao()))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    digitar(chaveDoNome(0), 'Maria de Teste')
    digitar(chaveDoCpf(0), CPF_A)
    digitar('email', 'maria@example.com')
    digitar('telefone', '91988887777')
    campo('consentimento').click()
    enviar(form)
    expect(el(`[data-erro="${chaveDaPergunta(0, 1)}"]`).textContent).toBe(
      'Escolha uma opção.',
    )
    digitar(chaveDaPergunta(0, 1), 'GG')
    digitar(chaveDaPergunta(0, 2), 'Sem glúten')
    enviar(form)
    await esperarVarias()
    const [[, init]] = envios(fetchImpl) as [[string, RequestInit]]
    expect(JSON.parse(String(init.body)).respostas).toEqual({
      '1': 'GG',
      '2': 'Sem glúten',
    })

    const semPerguntas = montar({ perguntas: [] })
    iniciarFormularioDeInscricao(semPerguntas.secao, {
      fetchImpl: api(() => resposta(respostaDaInscricao())),
    })
    await esperarVarias()
    expect(
      semPerguntas.form.querySelectorAll('[data-campo*="pergunta"]'),
    ).toHaveLength(0)
  })

  it('a sessão escolhida vai no corpo como número', async () => {
    const { form, secao } = montar({
      sessoes: [{ id: 71, rotulo: 'Oficina', livres: 6 }],
    })
    const fetchImpl = api(() => resposta(respostaDaInscricao()))
    iniciarFormularioDeInscricao(secao, { fetchImpl })
    await esperarVarias()
    preencherTudo()
    digitar('sessao', '71')
    enviar(form)
    await esperarVarias()
    const [[, init]] = envios(fetchImpl) as [[string, RequestInit]]
    expect(JSON.parse(String(init.body)).id_sessao).toBe(71)
  })
})

describe('vagas ao vivo e o bloco "Como participar"', () => {
  const sessoes = [
    { id: 71, rotulo: 'Oficina da manhã', livres: 6 },
    { id: 72, rotulo: 'Oficina da tarde', livres: 0 },
  ]

  it('evento sem vaga livre no build já mostra o aviso; com vaga, o aviso fica escondido', () => {
    montar({ vagasLivres: 0 })
    iniciarFormularioDeInscricao(el('[data-inscricao-formulario]'), {
      fetchImpl: api(() => resposta({})),
    })
    expect(el('[data-aviso-esgotado]').hidden).toBe(false)
    expect(el('[data-aviso-esgotado]').textContent).toBe(AVISO_SEM_VAGAS)
    montar({ vagasLivres: 12 })
    iniciarFormularioDeInscricao(el('[data-inscricao-formulario]'), {
      fetchImpl: api(() => resposta({})),
    })
    expect(el('[data-aviso-esgotado]').hidden).toBe(true)
  })

  it('as vagas de AGORA mandam: o número do build é velho (aparece o aviso, some o aviso, e o texto das sessões muda)', () => {
    const { secao } = montar({ vagasLivres: 12, sessoes })
    iniciarFormularioDeInscricao(secao, { fetchImpl: api(() => resposta({})) })
    const raiz = el('[data-como-participar]')
    aplicarVagasAoVivo(raiz, {
      vagas_livres: 0,
      sessoes: [
        { id_sessao: 71, vagas_livres: 2 },
        { id_sessao: 72, vagas_livres: 0 },
      ],
    })
    expect(el('[data-aviso-esgotado]').hidden).toBe(false)
    expect(el('option[data-sessao="71"]').textContent).toBe(
      'Oficina da manhã — 2 vagas',
    )
    aplicarVagasAoVivo(raiz, { vagas_livres: 3 })
    expect(el('[data-aviso-esgotado]').hidden).toBe(true)
    // sessão que acaba de esgotar
    aplicarVagasAoVivo(raiz, {
      vagas_livres: 3,
      sessoes: [{ id_sessao: 71, vagas_livres: 0 }],
    })
    expect(el('option[data-sessao="71"]').textContent).toBe(
      'Oficina da manhã — sem vagas: lista de espera',
    )
  })

  it('vale a sessão escolhida: sessão esgotada mostra o aviso; "todo o evento" volta às vagas do evento', () => {
    const { secao } = montar({ vagasLivres: 12, sessoes })
    iniciarFormularioDeInscricao(secao, { fetchImpl: api(() => resposta({})) })
    const select = campo<HTMLSelectElement>('sessao')
    select.value = '72'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el('[data-aviso-esgotado]').hidden).toBe(false)
    select.value = '71'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el('[data-aviso-esgotado]').hidden).toBe(true)
    select.value = ''
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el('[data-aviso-esgotado]').hidden).toBe(true)
  })

  it('vagas sem limite (null) e resposta sem sessões não quebram', () => {
    montar({ vagasLivres: 12, sessoes })
    const raiz = el('[data-como-participar]')
    aplicarVagasAoVivo(raiz, { vagas_livres: null })
    expect(
      el('[data-inscricao-formulario]').dataset.vagasLivres,
    ).toBeUndefined()
    aplicarVagasAoVivo(raiz, {})
    aplicarVagasAoVivo(document.createElement('div'), { vagas_livres: 0 })
  })

  it('evento que já aconteceu ou foi retirado: o bloco "Como participar" some — menos se a pessoa acabou de se inscrever', () => {
    montar()
    esconderComoParticipar(document.body)
    expect(el('[data-como-participar]').hidden).toBe(true)
    montar()
    el('[data-inscricao-formulario]').setAttribute('data-concluida', '')
    esconderComoParticipar(document.body)
    expect(el('[data-como-participar]').hidden).toBe(false)
  })
})
