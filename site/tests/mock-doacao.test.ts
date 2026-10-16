import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import {
  BENEFICIARIO_DE_TESTE,
  CHAVE_PIX_DE_TESTE,
  CIDADE_DE_TESTE,
  NOME_QUE_ESTOURA_O_LIMITE,
  RECUSA_DE_AVISO_DESATUALIZADO,
  RECUSA_DE_CAMPANHA_ENCERRADA,
  RECUSA_DE_LIMITE,
  RECUSA_DE_PIX_INDISPONIVEL,
  criarServidor,
  gerarPayloadPix,
} from '../scripts/mock-api.mjs'

// A API simulada é a base de todos os testes de navegador da doação pelo site (v5.6a): se ela se afastasse do servidor de verdade (app/routers/doacao_online.py), os testes
// passariam por um motivo errado. Aqui ela é conferida contra o contrato do servidor e, no código Pix, contra os códigos que o PRÓPRIO servidor gera
// (app/services/pix.py::gerar_payload_pix; os vetores abaixo foram gerados rodando essa função).

type Opcoes = Parameters<typeof criarServidor>[0]

async function comServidor<T>(
  opcoes: Opcoes,
  funcao: (url: string) => Promise<T>,
): Promise<T> {
  const servidor = criarServidor(opcoes)
  await new Promise<void>((resolver) =>
    servidor.listen(0, '127.0.0.1', resolver),
  )
  const { port } = servidor.address() as AddressInfo
  try {
    return await funcao(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolver) => servidor.close(resolver))
  }
}

const pegar = async (url: string, caminho: string) => {
  const resposta = await fetch(`${url}${caminho}`)
  return { status: resposta.status, corpo: (await resposta.json()) as any }
}
const enviar = async (url: string, corpo: unknown) => {
  const resposta = await fetch(`${url}/api/publico/doacoes/intencoes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  return { status: resposta.status, corpo: (await resposta.json()) as any }
}
const pedido = (extra: Record<string, unknown> = {}) => ({
  nome_completo: 'Maria de Teste',
  email: 'maria@example.com',
  consentimento_lgpd: true,
  versao_texto_consentimento: '1',
  pagina_web: '',
  ...extra,
})

describe('gerarPayloadPix (o mesmo código que app/services/pix.py gera)', () => {
  const chave = '123e4567-e89b-12d3-a456-426614174000'
  it('sem valor (doação livre), com a descrição', () => {
    expect(
      gerarPayloadPix({
        chave,
        beneficiario: 'ASAF TESTE',
        cidade: 'PARAUAPEBAS',
        txid: 'ASAFDOACAO',
        descricao: 'Doacao ASAF',
      }),
    ).toBe(
      '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF5204000053039865802BR5910ASAF TESTE6011PARAUAPEBAS62140510ASAFDOACAO6304C407',
    )
  })
  it('com valor e campanha', () => {
    expect(
      gerarPayloadPix({
        chave,
        beneficiario: 'ASAF TESTE',
        cidade: 'PARAUAPEBAS',
        valor: 50,
        txid: 'ASAFCAMP1',
        descricao: 'Doacao ASAF',
      }),
    ).toBe(
      '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF520400005303986540550.005802BR5910ASAF TESTE6011PARAUAPEBAS62130509ASAFCAMP163046DB5',
    )
  })
  it('o protocolo vira o txid sem os traços; centavos com duas casas', () => {
    expect(
      gerarPayloadPix({
        chave,
        beneficiario: 'ASAF TESTE',
        cidade: 'PARAUAPEBAS',
        valor: 25.5,
        txid: 'ASAFDOA-2026-00007',
        descricao: 'Doacao ASAF',
      }),
    ).toBe(
      '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF520400005303986540525.505802BR5910ASAF TESTE6011PARAUAPEBAS62200516ASAFDOA202600007630415EC',
    )
  })
  it('chave com espaços, nome e cidade com acento são cortados e sem acento (25 e 15 letras)', () => {
    expect(
      gerarPayloadPix({
        chave: '  17631942000170 ',
        beneficiario: 'Associação Arca da Família Pará',
        cidade: 'São Luís do Maranhão',
        valor: 1234.5,
        txid: 'x',
      }),
    ).toBe(
      '00020126360014br.gov.bcb.pix01141763194200017052040000530398654071234.505802BR5925Associacao Arca da Famili6015Sao Luis do Mar62050501x6304D0E1',
    )
  })
  it('sem txid válido, vale "***"', () => {
    expect(
      gerarPayloadPix({
        chave,
        beneficiario: 'Fulano de Tal',
        cidade: 'BRASILIA',
        txid: '***',
      }),
    ).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304EE18',
    )
  })
})

describe('mock — GET /api/publico/doacao', () => {
  it('Pix aberto: chave, beneficiário, cidade, as três campanhas, a versão do aviso e os dias do pedido', async () => {
    const { status, corpo } = await comServidor({}, (url) =>
      pegar(url, '/api/publico/doacao'),
    )
    expect(status).toBe(200)
    expect(corpo).toMatchObject({
      pix_disponivel: true,
      chave_pix: CHAVE_PIX_DE_TESTE,
      beneficiario: BENEFICIARIO_DE_TESTE,
      cidade: CIDADE_DE_TESTE,
      versao_aviso_de_privacidade: '1',
      dias_de_validade_do_pedido: 15,
    })
    expect(corpo.campanhas).toHaveLength(3)
    expect(corpo.campanhas[1]).toMatchObject({
      id_campanha: 2,
      meta_valor: 5000,
      valor_arrecadado: 6000,
      percentual: 120,
      prazo: null,
    })
    expect(corpo.campanhas[0].prazo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('--sem-pix: Pix indisponível (sem chave, beneficiário e cidade), as campanhas continuam como o servidor manda', async () => {
    const { corpo } = await comServidor({ semPix: true }, (url) =>
      pegar(url, '/api/publico/doacao'),
    )
    expect(corpo).toMatchObject({
      pix_disponivel: false,
      chave_pix: null,
      beneficiario: null,
      cidade: null,
    })
    expect(corpo.campanhas).toHaveLength(3)
  })
  it('vazio (a produção de hoje): sem Pix e sem campanha', async () => {
    const { corpo } = await comServidor({ vazio: true }, (url) =>
      pegar(url, '/api/publico/doacao'),
    )
    expect(corpo.pix_disponivel).toBe(false)
    expect(corpo.campanhas).toEqual([])
  })
  it('API antiga: a rota não existe', async () => {
    const { status } = await comServidor({ antiga: true }, (url) =>
      pegar(url, '/api/publico/doacao'),
    )
    expect(status).toBe(404)
  })
})

describe('mock — GET /api/publico/doacao/pix (doar sem se identificar)', () => {
  it('sem valor nem campanha: o código livre, igual ao do servidor', async () => {
    const { status, corpo } = await comServidor({}, (url) =>
      pegar(url, '/api/publico/doacao/pix'),
    )
    expect(status).toBe(200)
    expect(corpo).toMatchObject({
      valor: null,
      id_campanha: null,
      chave_pix: CHAVE_PIX_DE_TESTE,
    })
    expect(corpo.copia_e_cola).toBe(
      '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF5204000053039865802BR5910ASAF TESTE6011PARAUAPEBAS62140510ASAFDOACAO6304C407',
    )
  })
  it('com valor e campanha', async () => {
    const { corpo } = await comServidor({}, (url) =>
      pegar(url, '/api/publico/doacao/pix?valor=50.00&id_campanha=1'),
    )
    expect(corpo).toMatchObject({ valor: 50, id_campanha: 1 })
    expect(corpo.copia_e_cola).toContain('540550.00')
    expect(corpo.copia_e_cola).toContain('ASAFCAMP1')
  })
  it('valor zero, negativo ou alto demais: 400 com a frase do servidor', async () => {
    await comServidor({}, async (url) => {
      for (const [valor, frase] of [
        ['0', 'O valor da doação precisa ser maior que zero.'],
        ['-5', 'O valor da doação precisa ser maior que zero.'],
        [
          '1000000.01',
          'Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
        ],
      ] as const) {
        const r = await pegar(url, `/api/publico/doacao/pix?valor=${valor}`)
        expect(r.status, valor).toBe(400)
        expect(r.corpo.detail).toBe(frase)
      }
      expect(
        (await pegar(url, '/api/publico/doacao/pix?valor=1000000')).status,
      ).toBe(200)
    })
  })
  it('valor que não é número: 422 de validação, no formato do FastAPI', async () => {
    const r = await comServidor({}, (url) =>
      pegar(url, '/api/publico/doacao/pix?valor=abc'),
    )
    expect(r.status).toBe(422)
    expect(r.corpo.detail[0]).toMatchObject({ loc: ['query', 'valor'] })
  })
  it('campanha que não recebe: 400; Pix indisponível: 503', async () => {
    const encerrada = await comServidor({}, (url) =>
      pegar(url, '/api/publico/doacao/pix?id_campanha=999'),
    )
    expect(encerrada.status).toBe(400)
    expect(encerrada.corpo.detail).toBe(RECUSA_DE_CAMPANHA_ENCERRADA)
    const fechado = await comServidor({ semPix: true }, (url) =>
      pegar(url, '/api/publico/doacao/pix'),
    )
    expect(fechado.status).toBe(503)
    expect(fechado.corpo.detail).toBe(RECUSA_DE_PIX_INDISPONIVEL)
  })
})

describe('mock — POST /api/publico/doacoes/intencoes (doar identificando-se)', () => {
  it('pedido certo: protocolo DOA-AAAA-NNNNN, o valor, o código com o protocolo no txid e a validade', async () => {
    const r = await comServidor({}, (url) =>
      enviar(url, pedido({ valor: 25.5, id_campanha: 1, cpf: '39053344705' })),
    )
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({
      mensagem: 'Pedido recebido.',
      valor: 25.5,
      id_campanha: 1,
      chave_pix: CHAVE_PIX_DE_TESTE,
      beneficiario: BENEFICIARIO_DE_TESTE,
      cidade: CIDADE_DE_TESTE,
    })
    expect(r.corpo.protocolo).toMatch(
      new RegExp(`^DOA-${new Date().getUTCFullYear()}-\\d{5}$`),
    )
    expect(r.corpo.copia_e_cola).toContain('540525.50')
    expect(r.corpo.copia_e_cola).toContain(
      `ASAF${(r.corpo.protocolo as string).replace(/-/g, '')}`,
    )
    expect(r.corpo.expira_em).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/)
    expect(r.corpo.expira_em).not.toMatch(/Z$/)
  })
  it('o MESMO pedido mandado de novo devolve o mesmo protocolo; outro pedido, outro protocolo', async () => {
    await comServidor({}, async (url) => {
      const extra = { email: 'repetido@example.com' }
      const a = await enviar(url, pedido(extra))
      const b = await enviar(url, pedido(extra))
      const c = await enviar(url, pedido({ ...extra, valor: 10 }))
      expect(b.corpo.protocolo).toBe(a.corpo.protocolo)
      expect(c.corpo.protocolo).not.toBe(a.corpo.protocolo)
    })
  })
  it('o pedido sem valor leva o código livre (sem o campo do valor)', async () => {
    const r = await comServidor({}, (url) =>
      enviar(url, pedido({ email: 'livre@example.com' })),
    )
    expect(r.corpo.valor).toBeNull()
    expect(r.corpo.copia_e_cola).not.toMatch(/5406/)
  })
  it('validação: todas as frases do servidor, cada uma ligada ao seu campo', async () => {
    const r = await comServidor({}, (url) =>
      enviar(
        url,
        pedido({
          nome_completo: 'Ma',
          email: 'sem-arroba',
          cpf: '11144477736',
          valor: 0,
        }),
      ),
    )
    expect(r.status).toBe(422)
    const mensagens = Object.fromEntries(
      (r.corpo.detail as Array<{ loc: string[]; msg: string }>).map((e) => [
        e.loc.at(-1),
        e.msg,
      ]),
    )
    expect(mensagens).toEqual({
      nome_completo: 'Value error, Informe o seu nome completo.',
      email:
        'Value error, Esse e-mail não parece certo: confira se está escrito sem erro.',
      cpf: 'Value error, Esse CPF não confere: confira os números ou deixe em branco.',
      valor: 'Value error, O valor da doação precisa ser maior que zero.',
    })
  })
  it('valor alto demais e campo obrigatório que falta', async () => {
    await comServidor({}, async (url) => {
      const alto = await enviar(url, pedido({ valor: 1000001 }))
      expect(alto.corpo.detail[0].msg).toBe(
        'Value error, Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
      )
      const semNome = await enviar(url, { email: 'a@b.co' })
      expect(semNome.status).toBe(422)
      expect(semNome.corpo.detail[0]).toMatchObject({
        loc: ['body', 'nome_completo'],
        msg: 'Field required',
      })
    })
  })
  it('armadilha de robô: finge sucesso (sem protocolo nem código); a validação vem antes', async () => {
    await comServidor({}, async (url) => {
      const fingido = await enviar(
        url,
        pedido({ pagina_web: 'http://spam.example' }),
      )
      expect(fingido.status).toBe(200)
      expect(fingido.corpo).toEqual({
        mensagem: 'Pedido recebido.',
        protocolo: null,
        valor: null,
        copia_e_cola: null,
        expira_em: null,
      })
      const invalido = await enviar(
        url,
        pedido({ pagina_web: 'x', nome_completo: 'Ma' }),
      )
      expect(invalido.status).toBe(422)
    })
  })
  it('limite por endereço: 429; Pix fechado: 503; aviso não aceito: 400; aviso velho: 422; campanha encerrada: 400', async () => {
    await comServidor({}, async (url) => {
      const limite = await enviar(
        url,
        pedido({ nome_completo: NOME_QUE_ESTOURA_O_LIMITE }),
      )
      expect(limite.status).toBe(429)
      expect(limite.corpo.detail).toBe(RECUSA_DE_LIMITE)
      const semAceite = await enviar(url, pedido({ consentimento_lgpd: false }))
      expect(semAceite.status).toBe(400)
      expect(semAceite.corpo.detail).toBe(
        'Para continuar é preciso ler e aceitar o aviso de privacidade.',
      )
      const velho = await enviar(
        url,
        pedido({ versao_texto_consentimento: '0' }),
      )
      expect(velho.status).toBe(422)
      expect(velho.corpo.detail).toBe(RECUSA_DE_AVISO_DESATUALIZADO)
      const encerrada = await enviar(url, pedido({ id_campanha: 999 }))
      expect(encerrada.status).toBe(400)
      expect(encerrada.corpo.detail).toBe(RECUSA_DE_CAMPANHA_ENCERRADA)
    })
    const fechado = await comServidor({ semPix: true }, (url) =>
      enviar(url, pedido()),
    )
    expect(fechado.status).toBe(503)
    expect(fechado.corpo.detail).toBe(RECUSA_DE_PIX_INDISPONIVEL)
  })
  it('API antiga: a rota não existe', async () => {
    const r = await comServidor({ antiga: true }, (url) =>
      enviar(url, pedido()),
    )
    expect(r.status).toBe(404)
  })
})
