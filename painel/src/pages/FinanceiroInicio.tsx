import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import {
  listarContasFinanceiras,
  listarSolicitacoesCompra,
  listarTitulos,
  resumirTitulos,
} from '@/lib/api'
import { formatarDia } from '@/lib/datas'
import { modulos } from '@/lib/modulos'

/** AAAA-MM-DD do dia no aparelho de quem usa. */
function diaLocal(data: Date): string {
  const doisDigitos = (n: number) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`
}

function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// Início do módulo Financeiro: o retrato do dia (saldo, o que está vencido, o que vence nos próximos 30 dias, compras esperando aprovação) e
// os atalhos para cada tela do módulo. Os números vêm das mesmas rotas das telas de Títulos, Contas financeiras e Compras: nada guardado à parte.
export function FinanceiroInicioPage() {
  const { data: contas, isLoading: carregandoContas } = useQuery({
    queryKey: ['contas-financeiras'],
    queryFn: listarContasFinanceiras,
  })
  // v9.2b: as somas vêm prontas do servidor e só os 5 próximos vencimentos vêm inteiros (antes, TODOS os títulos em aberto, para somar aqui: a tela
  // ficava mais lenta a cada mês). "Hoje" é o dia no aparelho de quem usa (Belém).
  // calculados uma vez ao abrir a tela (a regra de pureza do React não aceita ler o relógio a cada desenho)
  const [{ hoje, daqui30 }] = useState(() => ({
    hoje: diaLocal(new Date()),
    daqui30: diaLocal(new Date(Date.now() + 30 * 24 * 3600 * 1000)),
  }))
  const { data: vencidos, isLoading: carregandoVencidos } = useQuery({
    queryKey: ['titulos', 'resumo', 'vencidos-a-receber', hoje],
    queryFn: () =>
      resumirTitulos({
        status: 'Pendente',
        tipo_titulo: 'A Receber',
        data_ate: hoje,
      }),
  })
  const { data: aPagar, isLoading: carregandoAPagar } = useQuery({
    queryKey: ['titulos', 'resumo', 'a-pagar-30-dias', daqui30],
    queryFn: () =>
      resumirTitulos({
        status: 'Pendente',
        tipo_titulo: 'A Pagar',
        data_ate: daqui30,
      }),
  })
  const { data: proximosVencimentos = [] } = useQuery({
    queryKey: ['titulos', 'proximos-vencimentos'],
    // com um período, a lista vem por vencimento (o mais antigo primeiro); o "até" bem longe pega todos os em aberto
    queryFn: () =>
      listarTitulos({
        status: 'Pendente',
        data_ate: '2999-12-31',
        pagina: 1,
        por_pagina: 5,
      }),
  })
  const { data: compras } = useQuery({
    queryKey: ['solicitacoes-compra', 'Aguardando Aprovação'],
    queryFn: () => listarSolicitacoesCompra('Aguardando Aprovação'),
  })

  const saldo = (contas ?? [])
    .filter((c) => c.ativo)
    .reduce((total, c) => total + c.saldo, 0)

  const atalhos =
    modulos
      .find((m) => m.rota === '/financeiro')
      ?.itens?.filter((i) => i.rota !== '/financeiro') ?? []

  return (
    <>
      <PageHeader
        titulo="Financeiro"
        descricao="O retrato do dia e o caminho para cada tela do módulo."
        trilha={[{ rotulo: 'Início', href: '/' }, { rotulo: 'Financeiro' }]}
      />

      <section
        aria-label="Resumo do dia"
        className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Saldo nas contas financeiras
          </p>
          <p className="mt-1 text-xl font-semibold">
            {carregandoContas ? '…' : formatarReais(saldo)}
          </p>
          <Link
            to="/financeiro/contas-financeiras"
            className="text-xs underline"
          >
            Ver contas financeiras
          </Link>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">A receber vencido</p>
          <p className="mt-1 text-xl font-semibold text-destructive">
            {carregandoVencidos
              ? '…'
              : formatarReais(vencidos?.soma_saldo ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            {vencidos?.total ?? 0} título(s) em atraso
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">A pagar até 30 dias</p>
          <p className="mt-1 text-xl font-semibold">
            {carregandoAPagar ? '…' : formatarReais(aPagar?.soma_saldo ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground">
            {aPagar?.total ?? 0} título(s) (inclui os já vencidos)
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            Compras aguardando aprovação
          </p>
          <p className="mt-1 text-xl font-semibold">{(compras ?? []).length}</p>
          <Link to="/financeiro/compras" className="text-xs underline">
            Abrir compras
          </Link>
        </div>
      </section>

      {proximosVencimentos.length > 0 && (
        <section className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">
            Próximos vencimentos em aberto
          </h2>
          <ul className="v3-space-y-1 text-sm">
            {proximosVencimentos.map((t) => (
              <li
                key={t.id_titulo}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  {t.tipo_titulo} — {t.descricao}
                </span>
                <span className="text-muted-foreground">
                  {formatarDia(t.data_vencimento)} ·{' '}
                  {formatarReais(t.saldo_devedor)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Telas do módulo">
        <h2 className="mb-2 text-sm font-semibold">Telas do módulo</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {atalhos.map((i) => (
            <Link
              key={i.rota}
              to={i.rota}
              className="flex items-center gap-2 rounded-md border border-border bg-card p-3 text-sm hover:bg-muted"
            >
              <i.icone className="h-4 w-4" aria-hidden="true" />
              {i.rotulo}
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
