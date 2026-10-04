import { describe, expect, it } from 'vitest'

import type {
  DocumentoPublico,
  PagamentoPublico,
  ParceriaPublica,
} from '../scripts/lib/conteudo-publico.mjs'
import {
  COLUNAS_DOS_DADOS_ABERTOS,
  agruparDocumentosPorTipo,
  agruparPorAno,
  beneficiarioDoPagamento,
  caminhoDoPdf,
  celulaCsv,
  ehEmenda,
  formatarCnpj,
  formatarReais,
  linhasDosDadosAbertos,
  nomeDoPdf,
  paraCsv,
  saldoDaParceria,
  slugDoTitulo,
} from '../src/lib/transparencia'

const parceria = (extra: Partial<ParceriaPublica> = {}): ParceriaPublica => ({
  id_parceria: 1,
  tipo_codigo: 'EMENDA',
  tipo: 'Emenda parlamentar',
  ano: 2026,
  titulo: 'Emenda 123/2026',
  objeto: 'Oficinas, de música',
  esfera: 'Municipal',
  orgao_concedente: 'Secretaria',
  numero_emenda: '123/2026',
  identificador_unico: null,
  proponente: 'Vereador Exemplo',
  numero_termo: null,
  situacao: 'Em execução',
  valor_total: 50000,
  recebido: 10000.1,
  pago: 2000.2,
  data_assinatura: null,
  vigencia_inicio: null,
  vigencia_fim: null,
  lancamentos_em_classificacao: 0,
  ultima_atualizacao: '2026-10-04T01:00:00Z',
  ...extra,
})

const documento = (
  extra: Partial<DocumentoPublico> = {},
): DocumentoPublico => ({
  id_documento: 12,
  tipo_codigo: 'ATA',
  tipo: 'Ata',
  titulo: 'Ata de eleição',
  descricao: null,
  data_documento: null,
  ano: 2026,
  versao: 1,
  vigente: true,
  paginas: 2,
  tamanho: 100,
  sha256: 'a'.repeat(64),
  aprovado_em: null,
  arquivo: '/api/publico/transparencia/documentos/12/arquivo',
  ...extra,
})

describe('slugDoTitulo / endereço do PDF', () => {
  it('tira acento e símbolo, e só deixa letras, números e hífen', () => {
    expect(slugDoTitulo('Ata de Eleição — Diretoria 2026-2028!')).toBe(
      'ata-de-eleicao-diretoria-2026-2028',
    )
    expect(slugDoTitulo('  Prestação / de contas  ')).toBe(
      'prestacao-de-contas',
    )
  })
  it('nunca devolve vazio nem passa de 60 caracteres', () => {
    expect(slugDoTitulo('!!!')).toBe('documento')
    const longo = slugDoTitulo('palavra '.repeat(40))
    expect(longo.length).toBeLessThanOrEqual(60)
    expect(longo.endsWith('-')).toBe(false)
  })
  it('o endereço do PDF é permanente: começa pelo id, então um título editado nunca colide', () => {
    expect(caminhoDoPdf(documento())).toBe(
      '/arquivos/transparencia/12-ata-de-eleicao.pdf',
    )
    expect(
      nomeDoPdf(documento({ id_documento: 13, titulo: 'Ata de eleição' })),
    ).toBe('13-ata-de-eleicao')
  })
})

describe('formatarReais / saldo', () => {
  it('formata em pt-BR', () => {
    expect(formatarReais(50000).replace(/\s/g, ' ')).toBe('R$ 50.000,00')
    expect(formatarReais(0.3).replace(/\s/g, ' ')).toBe('R$ 0,30')
  })
  it('o saldo não carrega erro de ponto flutuante', () => {
    expect(saldoDaParceria({ recebido: 0.3, pago: 0.1 })).toBe(0.2)
    expect(saldoDaParceria(parceria())).toBe(7999.9)
  })
})

describe('agruparPorAno', () => {
  it('do ano mais novo ao mais antigo e NUNCA descarta um ano', () => {
    const grupos = agruparPorAno([
      parceria({ id_parceria: 1, ano: 2024 }),
      parceria({ id_parceria: 2, ano: 2026 }),
      parceria({ id_parceria: 3, ano: 2024 }),
      parceria({ id_parceria: 4, ano: 2025 }),
    ])
    expect(grupos.map((g) => g.ano)).toEqual([2026, 2025, 2024])
    expect(
      grupos.flatMap((g) => g.itens.map((i) => i.id_parceria)).sort(),
    ).toEqual([1, 2, 3, 4])
    expect(grupos[2]!.itens).toHaveLength(2)
  })
  it('lista vazia dá nenhum grupo', () => {
    expect(agruparPorAno([])).toEqual([])
  })
})

describe('pagamentos: o nome de quem recebeu como equipe nunca aparece', () => {
  const base: PagamentoPublico = {
    data: '2026-08-10',
    valor: 100,
    descricao: 'x',
    categoria: 'OUTRO',
    funcao: null,
    fornecedor: null,
  }
  it('fornecedor: razão social e CNPJ formatado', () => {
    expect(
      beneficiarioDoPagamento({
        ...base,
        categoria: 'FORNECEDOR',
        fornecedor: {
          razao_social: 'Gráfica Aurora ME',
          cnpj: '12345678000199',
        },
      }),
    ).toBe('Gráfica Aurora ME (CNPJ 12.345.678/0001-99)')
  })
  it('equipe: só a função', () => {
    expect(
      beneficiarioDoPagamento({
        ...base,
        categoria: 'EQUIPE',
        funcao: 'Oficineiro de música',
      }),
    ).toBe('Equipe: Oficineiro de música')
  })
  it('demais: traço', () => {
    expect(beneficiarioDoPagamento(base)).toBe('—')
  })
  it('CNPJ fora do padrão volta como veio', () => {
    expect(formatarCnpj('123')).toBe('123')
  })
})

describe('CSV dos dados abertos', () => {
  it('põe entre aspas o que tem vírgula, aspas ou quebra de linha, e dobra as aspas', () => {
    expect(celulaCsv('a,b')).toBe('"a,b"')
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""')
    expect(celulaCsv('linha1\nlinha2')).toBe('"linha1\nlinha2"')
    expect(celulaCsv('simples')).toBe('simples')
  })
  it('vazio e nulo viram célula vazia; número fica como está', () => {
    expect(celulaCsv(null)).toBe('')
    expect(celulaCsv(undefined)).toBe('')
    expect(celulaCsv(50000.5)).toBe('50000.5')
    expect(celulaCsv(-3)).toBe('-3')
  })
  it('texto que a planilha executaria como fórmula ganha um apóstrofo', () => {
    expect(celulaCsv('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    )
    expect(celulaCsv('+55 94')).toBe("'+55 94")
    expect(celulaCsv('@soma')).toBe("'@soma")
    expect(celulaCsv('-1+1')).toBe("'-1+1")
  })
  it('paraCsv: cabeçalho, uma linha por registro, CRLF no fim de cada uma', () => {
    const csv = paraCsv(
      ['a', 'b'],
      [
        { a: 1, b: 'x,y' },
        { a: 2, b: null },
      ],
    )
    expect(csv).toBe('a,b\r\n1,"x,y"\r\n2,\r\n')
  })
  it('linhas das parcerias trazem o saldo, a página e as colunas combinadas', () => {
    const [linha] = linhasDosDadosAbertos(
      [parceria()],
      (p) => `https://asaf.org.br/transparencia/emendas/${p.id_parceria}/`,
    )
    expect(Object.keys(linha!)).toEqual([...COLUNAS_DOS_DADOS_ABERTOS])
    expect(linha!.saldo).toBe(7999.9)
    expect(linha!.pagina).toBe('https://asaf.org.br/transparencia/emendas/1/')
    const csv = paraCsv(COLUNAS_DOS_DADOS_ABERTOS, [linha!])
    expect(csv.split('\r\n')[0]).toBe(COLUNAS_DOS_DADOS_ABERTOS.join(','))
    expect(csv).toContain('"Oficinas, de música"')
  })
})

describe('tipos e documentos', () => {
  it('emenda é a parceria do tipo EMENDA; as demais vão para a página de parcerias', () => {
    expect(ehEmenda(parceria())).toBe(true)
    expect(ehEmenda(parceria({ tipo_codigo: 'TERMO_FOMENTO' }))).toBe(false)
  })
  it('documentos por tipo (ordem alfabética) e, dentro do tipo, o ano mais novo primeiro', () => {
    const grupos = agruparDocumentosPorTipo([
      documento({ id_documento: 1, tipo: 'Ata', titulo: 'Ata B', ano: 2025 }),
      documento({
        id_documento: 2,
        tipo: 'Certidão',
        titulo: 'Certidão',
        ano: 2026,
      }),
      documento({ id_documento: 3, tipo: 'Ata', titulo: 'Ata A', ano: 2026 }),
    ])
    expect(grupos.map((g) => g.tipo)).toEqual(['Ata', 'Certidão'])
    expect(grupos[0]!.documentos.map((d) => d.id_documento)).toEqual([3, 1])
  })
})
