// v9.6b - os LUGARES da Visão geral do Financeiro (escolha do Presidente, rodada 7b, `fin-inicio-2`): 6 no computador e 4 no celular, que mudam sozinhos.
// A ordem: 1º o que está em atraso, 2º o que precisa de você, depois as telas que a pessoa mais abriu nos últimos 30 dias e, se ainda sobrar lugar (o
// primeiro dia, outro navegador), os atalhos de sempre. As pendências vêm de `GET /api/financeiro/pendencias`; os mais usados, de lib/mais-usados.ts.
import type { LucideIcon } from 'lucide-react'
import {
  Coins,
  Landmark,
  MessageCircleQuestion,
  QrCode,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react'

import type { CompraParaAprovar, PendenciasDoFinanceiro } from './api'
import { COR_DA_AREA } from './areas'
import { formatarDia } from './datas'
import { DIAS_DOS_MAIS_USADOS, maisUsados } from './mais-usados'
import { nomeCurtoDoMes, nomeDoMes } from './meses'
import type { AreaDoModulo, ItemModulo } from './modulos'

export const LUGARES_NO_COMPUTADOR = 6
export const LUGARES_NO_CELULAR = 4

export function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export const plural = (n: number, um: string, varios: string) =>
  `${n} ${n === 1 ? um : varios}`

export type EstadoDoLugar = 'atraso' | 'pend' | 'usado' | 'atalho'

const COR_DO_PERIGO = 'bg-perigo-tinta text-destructive'
const AREA_DO_GRUPO: Record<string, AreaDoModulo> = {
  'Dia a dia': 'dinheiro',
  'Rotina do mês': 'pessoas',
  Cadastros: 'administracao',
  Relatórios: 'associacao',
  Controle: 'associacao',
}

// quando a pessoa ainda não usou telas bastantes para encher os lugares (o primeiro dia, outro navegador), os que sobram mostram estes atalhos
const ATALHOS_PADRAO: { rota: string; linha: string }[] = [
  {
    rota: '/financeiro/registrar-saida',
    linha: 'Uma despesa já paga, com a nota',
  },
  {
    rota: '/financeiro/entradas',
    linha: 'Mensalidades, doações e taxas do mês',
  },
  {
    rota: '/financeiro/saidas',
    linha: 'Despesas, compras e reembolsos do mês',
  },
  { rota: '/financeiro/relatorios', linha: 'Balancete, receitas e despesas' },
  {
    rota: '/financeiro/gerar-cobrancas',
    linha: 'As cobranças do mês, de uma vez',
  },
  { rota: '/financeiro/doacoes', linha: 'As doações e o Pix do site' },
]

export type Lugar = {
  chave: string
  estado: EstadoDoLugar
  icone: LucideIcon
  cor: string
  titulo: string
  linha: string
  acao: string
  // a tela que a ação abre; sem ela, a ação é "Aprovar" (a janela das compras)
  para?: string
  // a tela de que o lugar fala: não aparece de novo como "mais usado"
  tela: string
}

function linhaDasCompras(itens: CompraParaAprovar[], total: number): string {
  const nomes = itens.slice(0, 2).map((c) => c.descricao)
  const resto = total - nomes.length
  if (resto > 0) return `${nomes.join(', ')} e mais ${resto}`
  return nomes.join(' e ')
}

function linhaDosNomes(nomes: string[]): string {
  const mostrados = nomes.slice(0, 2)
  const resto = nomes.length - mostrados.length
  return resto > 0
    ? `${mostrados.join(', ')} e mais ${resto}`
    : mostrados.join(' e ')
}

/** A ordem dos lugares: 1º o que está em atraso, 2º o que precisa de você, depois os mais usados da pessoa e, se ainda sobrar lugar, os atalhos. */
export function montarLugares(
  pendencias: PendenciasDoFinanceiro | undefined,
  itens: ItemModulo[],
  aberturas: Record<string, number>,
  quantos = LUGARES_NO_COMPUTADOR,
): Lugar[] {
  const lugares: Lugar[] = []
  if (pendencias) {
    const m = pendencias.mensalidades_em_atraso
    if (m.titulos > 0)
      lugares.push({
        chave: 'mensalidades',
        estado: 'atraso',
        icone: TriangleAlert,
        cor: COR_DO_PERIGO,
        titulo: `${plural(m.titulos, 'mensalidade', 'mensalidades')} em atraso`,
        linha: `${formatarReais(m.soma)} · ${plural(m.associados, 'associado', 'associados')}`,
        acao: 'Ver quem',
        para: '/financeiro/entradas?vencidos=1',
        tela: '/financeiro/entradas',
      })
    const p = pendencias.a_pagar_vencidas
    if (p.total > 0 && p.mais_antiga) {
      const venceu = formatarDia(p.mais_antiga.vencimento).slice(0, 5)
      lugares.push({
        chave: 'a-pagar',
        estado: 'atraso',
        icone: TriangleAlert,
        cor: COR_DO_PERIGO,
        titulo:
          p.total === 1
            ? `${p.mais_antiga.descricao} venceu em ${venceu}`
            : `${p.total} contas a pagar vencidas`,
        linha:
          p.total === 1
            ? [p.mais_antiga.fornecedor, formatarReais(p.mais_antiga.valor)]
                .filter(Boolean)
                .join(' · ')
            : `${formatarReais(p.soma)} · a mais antiga venceu em ${venceu}`,
        acao: 'Dar baixa',
        para: '/financeiro/saidas?vencidos=1',
        tela: '/financeiro/saidas',
      })
    }
    const c = pendencias.compras_para_aprovar
    if (c.total > 0)
      lugares.push({
        chave: 'compras',
        estado: 'pend',
        icone: ShoppingCart,
        cor: COR_DA_AREA.dinheiro,
        titulo: `${plural(c.total, 'compra', 'compras')} para aprovar`,
        linha: linhaDasCompras(c.itens, c.total),
        acao: 'Aprovar',
        tela: '/financeiro/compras',
      })
    const pix = pendencias.pix_do_site
    if (pix.a_conferir > 0)
      lugares.push({
        chave: 'pix',
        estado: 'pend',
        icone: QrCode,
        cor: COR_DA_AREA.pessoas,
        titulo: `${pix.a_conferir} Pix do site para conferir`,
        linha: 'Procure no extrato do banco',
        acao: 'Conferir',
        para: '/financeiro/doacoes?aba=site',
        tela: '/financeiro/doacoes',
      })
    const r = pendencias.reembolsos_para_decidir
    if (r.total > 0)
      lugares.push({
        chave: 'reembolsos',
        estado: 'pend',
        icone: Coins,
        cor: COR_DA_AREA.dinheiro,
        titulo: `${plural(r.total, 'reembolso', 'reembolsos')} para decidir`,
        linha: 'Aprove ou recuse o pedido',
        acao: 'Decidir',
        para: '/financeiro/reembolso-despesa',
        tela: '/financeiro/reembolso-despesa',
      })
    const q = pendencias.perguntas_sem_resposta
    if (q.total > 0) {
      const naAuditoria = q.da_auditoria && q.mes_mais_antigo
      lugares.push({
        chave: 'perguntas',
        estado: 'pend',
        icone: MessageCircleQuestion,
        cor: COR_DA_AREA.associacao,
        titulo: `${plural(q.total, 'pergunta', 'perguntas')} do Conselho sem resposta`,
        linha: q.mes_mais_antigo
          ? `A mais antiga é de um título de ${nomeDoMes(q.mes_mais_antigo).toLowerCase()}`
          : 'O Conselho Fiscal espera a resposta da tesouraria',
        acao: 'Responder',
        para: naAuditoria
          ? `/financeiro/auditoria-financeira?mes=${q.mes_mais_antigo}&situacao=Suspenso`
          : '/financeiro/conselho-fiscal',
        tela: naAuditoria
          ? '/financeiro/auditoria-financeira'
          : '/financeiro/conselho-fiscal',
      })
    }
    const e = pendencias.extrato_sem_fechar
    if (e.contas > 0)
      lugares.push({
        chave: 'extrato',
        estado: 'pend',
        icone: Landmark,
        cor: COR_DA_AREA.pessoas,
        titulo: `Extrato de ${nomeCurtoDoMes(e.competencia).toLowerCase()} sem fechar`,
        linha: linhaDosNomes(e.nomes),
        acao: 'Fechar o mês',
        para: '/financeiro/conciliacao',
        tela: '/financeiro/conciliacao',
      })
  }

  const usadas = new Set(lugares.map((l) => l.tela))
  const grupoDe = (item: ItemModulo) =>
    item.grupo ? COR_DA_AREA[AREA_DO_GRUPO[item.grupo] ?? 'associacao'] : ''
  // todas as telas abertas, na ordem das mais abertas: as que já viraram lugar de uma pendência são puladas e a próxima entra
  for (const item of maisUsados(itens, aberturas, itens.length)) {
    if (lugares.length >= quantos) break
    if (usadas.has(item.rota)) continue
    usadas.add(item.rota)
    const vezes = aberturas[item.rota] ?? 0
    lugares.push({
      chave: `usado:${item.rota}`,
      estado: 'usado',
      icone: item.icone,
      cor: grupoDe(item),
      titulo: item.rotulo,
      linha: `Você abriu ${plural(vezes, 'vez', 'vezes')} nos últimos ${DIAS_DOS_MAIS_USADOS} dias`,
      acao: 'Abrir',
      para: item.rota,
      tela: item.rota,
    })
  }
  for (const atalho of ATALHOS_PADRAO) {
    if (lugares.length >= quantos) break
    const item = itens.find((i) => i.rota === atalho.rota)
    if (!item || usadas.has(item.rota)) continue
    usadas.add(item.rota)
    lugares.push({
      chave: `atalho:${item.rota}`,
      estado: 'atalho',
      icone: item.icone,
      cor: grupoDe(item),
      titulo: item.rotulo,
      linha: atalho.linha,
      acao: 'Abrir',
      para: item.rota,
      tela: item.rota,
    })
  }
  return lugares.slice(0, quantos)
}
