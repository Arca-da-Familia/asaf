import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronRight,
  Gavel,
  Headset,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import {
  listarDeliberacoesPendentes,
  listarSolicitacoesCompra,
  resumirAtendimentos,
  resumirTitulos,
} from '@/lib/api'
import { cn } from '@/lib/utils'

/** AAAA-MM-DD do dia no aparelho de quem usa (o mesmo cálculo da tela inicial do Financeiro). */
function diaLocal(data: Date): string {
  const d = (n: number) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${d(data.getMonth() + 1)}-${d(data.getDate())}`
}

type Pendencia = {
  chave: string
  numero: string
  texto: string
  rota: string
  icone: LucideIcon
  cor: string
  forte?: boolean
}

// v9.5b - "Precisa de você" do Início (desenho aprovado pelo Presidente, rodada 2): o que espera uma ação, cada item só para quem tem a permissão do módulo
// dele (o servidor também recusa a quem não tem) e só quando há algo. As consultas são as mesmas das telas de cada módulo (mesmas chaves de cache).
export function PrecisaDeVoce({ permissoes }: { permissoes: string[] }) {
  const temFinanceiro = permissoes.includes('financeiro')
  const temAtendimento = permissoes.includes('atendimento')
  const temGovernanca = permissoes.includes('governanca')
  // calculado uma vez ao abrir a tela (a regra de pureza do React não aceita ler o relógio a cada desenho)
  const [hoje] = useState(() => diaLocal(new Date()))

  const compras = useQuery({
    queryKey: ['solicitacoes-compra', 'Aguardando Aprovação'],
    queryFn: () => listarSolicitacoesCompra('Aguardando Aprovação'),
    enabled: temFinanceiro,
  })
  const vencidos = useQuery({
    queryKey: ['titulos', 'resumo', 'vencidos-a-receber', hoje],
    queryFn: () =>
      resumirTitulos({
        status: 'Pendente',
        tipo_titulo: 'A Receber',
        data_ate: hoje,
      }),
    enabled: temFinanceiro,
  })
  const fila = useQuery({
    queryKey: ['atendimentos', 'resumo'],
    queryFn: () => resumirAtendimentos(),
    enabled: temAtendimento,
  })
  const deliberacoes = useQuery({
    queryKey: ['deliberacoes', 'pendentes'],
    queryFn: listarDeliberacoesPendentes,
    enabled: temGovernanca,
  })

  const itens: Pendencia[] = []
  const nCompras = compras.data?.length ?? 0
  if (nCompras > 0)
    itens.push({
      chave: 'compras',
      numero: `${nCompras} ${nCompras === 1 ? 'compra' : 'compras'}`,
      texto: 'esperando aprovação',
      rota: '/financeiro/compras',
      icone: ShoppingCart,
      cor: 'bg-ouro-tinta text-ouro-texto',
    })
  const nNovos = fila.data?.novos ?? 0
  if (nNovos > 0)
    itens.push({
      chave: 'fila',
      numero: `${nNovos} ${nNovos === 1 ? 'pedido novo' : 'pedidos novos'}`,
      texto: 'na fila de atendimento',
      rota: '/atendimentos',
      icone: Headset,
      cor: 'bg-azul-tinta text-azul-texto',
    })
  const nDeliberacoes = deliberacoes.data?.length ?? 0
  if (nDeliberacoes > 0)
    itens.push({
      chave: 'deliberacoes',
      numero: `${nDeliberacoes} ${nDeliberacoes === 1 ? 'deliberação' : 'deliberações'}`,
      texto: 'da Assembleia por cumprir',
      rota: '/governanca/deliberacoes',
      icone: Gavel,
      cor: 'bg-verde-tinta text-verde-texto',
    })
  const nVencidos = vencidos.data?.total ?? 0
  if (nVencidos > 0)
    itens.push({
      chave: 'vencidos',
      numero: `${nVencidos} ${nVencidos === 1 ? 'conta a receber' : 'contas a receber'}`,
      texto: nVencidos === 1 ? 'já vencida' : 'já vencidas',
      rota: '/financeiro/entradas',
      icone: AlertTriangle,
      cor: 'bg-perigo-tinta text-destructive',
      forte: true,
    })

  return (
    <section
      aria-labelledby="titulo-precisa-de-voce"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <h2 id="titulo-precisa-de-voce" className="text-[17px] font-extrabold">
        Precisa de você
      </h2>
      {itens.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nada esperando por você agora.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {itens.map((item) => (
            <li
              key={item.chave}
              className="border-t border-border first:border-t-0"
            >
              <Link
                to={item.rota}
                className="flex min-h-14 items-center gap-3 rounded-lg py-2 hover:bg-accent/60"
              >
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-[11px]',
                    item.cor,
                  )}
                >
                  <item.icone className="size-5" aria-hidden="true" />
                </span>
                <span className="flex-1 text-sm">
                  <strong
                    className={item.forte ? 'text-destructive' : undefined}
                  >
                    {item.numero}
                  </strong>{' '}
                  {item.texto}
                </span>
                <ChevronRight
                  className="size-[18px] shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
