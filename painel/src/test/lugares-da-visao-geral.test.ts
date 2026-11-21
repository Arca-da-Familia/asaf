import { describe, expect, it } from 'vitest'

import type { PendenciasDoFinanceiro } from '@/lib/api'
import {
  LUGARES_NO_CELULAR,
  LUGARES_NO_COMPUTADOR,
  montarLugares,
} from '@/lib/lugares-da-visao-geral'
import { itensVisiveis, modulos } from '@/lib/modulos'

// v9.6b: a regra dos lugares da Visão geral do Financeiro (a tela está em visao-geral-do-financeiro.test.tsx)
const financeiro = modulos.find((m) => m.rota === '/financeiro')!
const itens = itensVisiveis(financeiro, ['financeiro'])

function pendencias(
  extra: Partial<PendenciasDoFinanceiro> = {},
): PendenciasDoFinanceiro {
  return {
    hoje: '2026-11-21',
    compras_para_aprovar: { total: 0, itens: [] },
    pix_do_site: { a_conferir: 0, vencidos: 0 },
    mensalidades_em_atraso: { titulos: 0, associados: 0, soma: 0 },
    a_pagar_vencidas: { total: 0, soma: 0, mais_antiga: null },
    reembolsos_para_decidir: { total: 0 },
    perguntas_sem_resposta: {
      total: 0,
      mes_mais_antigo: null,
      da_auditoria: false,
    },
    extrato_sem_fechar: { competencia: '2026-10', contas: 0, nomes: [] },
    contadores: { compras: 0, doacoes: 0, reembolsos: 0, conciliacao: 0 },
    ...extra,
  }
}

describe('os lugares da Visão geral (v9.6b)', () => {
  it('são 6 no computador e 4 no celular', () => {
    expect(LUGARES_NO_COMPUTADOR).toBe(6)
    expect(LUGARES_NO_CELULAR).toBe(4)
    expect(montarLugares(pendencias(), itens, {})).toHaveLength(6)
    expect(montarLugares(pendencias(), itens, {}, 4)).toHaveLength(4)
  })

  it('várias contas a pagar vencidas viram um lugar só, com a soma e o dia da mais antiga', () => {
    const [lugar] = montarLugares(
      pendencias({
        a_pagar_vencidas: {
          total: 3,
          soma: 1234.5,
          mais_antiga: {
            id_titulo: 1,
            descricao: 'Água',
            fornecedor: null,
            valor: 80,
            vencimento: '2026-10-02T00:00:00',
          },
        },
      }),
      itens,
      {},
    )
    expect(lugar).toMatchObject({
      chave: 'a-pagar',
      estado: 'atraso',
      titulo: '3 contas a pagar vencidas',
      // o Intl separa o R$ do número com um espaço que não quebra
      linha: expect.stringMatching(
        /^R\$\s1\.234,50 · a mais antiga venceu em 02\/10$/,
      ),
      acao: 'Dar baixa',
      para: '/financeiro/saidas?vencidos=1',
    })
  })

  it('a pergunta que não veio da auditoria leva ao Conselho Fiscal; o extrato diz o mês e as contas', () => {
    const lugares = montarLugares(
      pendencias({
        perguntas_sem_resposta: {
          total: 1,
          mes_mais_antigo: null,
          da_auditoria: false,
        },
        extrato_sem_fechar: {
          competencia: '2026-10',
          contas: 3,
          nomes: ['Banco do Brasil', 'Caixa', 'Sicredi'],
        },
      }),
      itens,
      {},
    )
    expect(lugares[0]).toMatchObject({
      chave: 'perguntas',
      titulo: '1 pergunta do Conselho sem resposta',
      para: '/financeiro/conselho-fiscal',
    })
    expect(lugares[1]).toMatchObject({
      chave: 'extrato',
      titulo: 'Extrato de outubro sem fechar',
      linha: 'Banco do Brasil, Caixa e mais 1',
      para: '/financeiro/conciliacao',
    })
  })

  it('as compras para aprovar não são link (abrem a janela) e citam os pedidos', () => {
    const compra = (id: number, descricao: string) => ({
      id_solicitacao: id,
      descricao,
      valor: 10,
      fornecedor: null,
      data_solicitacao: null,
      solicitante: null,
      alcada: { valor_minimo: 0, valor_maximo: null, cargos: '', exigidas: 1 },
      assinaturas: [],
      faltam_cotacoes: 0,
    })
    const [lugar] = montarLugares(
      pendencias({
        compras_para_aprovar: {
          total: 3,
          itens: [compra(1, 'Toner'), compra(2, 'Cadeiras'), compra(3, 'Mesa')],
        },
      }),
      itens,
      {},
    )
    expect(lugar).toMatchObject({
      estado: 'pend',
      titulo: '3 compras para aprovar',
      linha: 'Toner, Cadeiras e mais 1',
      acao: 'Aprovar',
    })
    expect(lugar?.para).toBeUndefined()
  })

  it('a tela mais usada que já é lugar de uma pendência dá a vez à próxima, e nenhum lugar se repete', () => {
    const lugares = montarLugares(
      pendencias({ pix_do_site: { a_conferir: 2, vencidos: 0 } }),
      itens,
      {
        '/financeiro/doacoes': 20,
        '/financeiro/entradas': 9,
        '/financeiro/registrar-saida': 4,
      },
    )
    expect(lugares.map((l) => l.chave)).toEqual([
      'pix',
      'usado:/financeiro/entradas',
      'usado:/financeiro/registrar-saida',
      'atalho:/financeiro/saidas',
      'atalho:/financeiro/relatorios',
      'atalho:/financeiro/gerar-cobrancas',
    ])
    expect(new Set(lugares.map((l) => l.tela)).size).toBe(lugares.length)
  })

  it('sem as pendências (a rota falhou), só os mais usados e os atalhos', () => {
    const lugares = montarLugares(undefined, itens, {
      '/financeiro/exercicios': 2,
    })
    expect(lugares[0]).toMatchObject({
      estado: 'usado',
      titulo: 'Exercícios',
      linha: 'Você abriu 2 vezes nos últimos 30 dias',
    })
    expect(lugares.slice(1).every((l) => l.estado === 'atalho')).toBe(true)
  })
})
