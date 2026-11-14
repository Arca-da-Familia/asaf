import { useQuery } from '@tanstack/react-query'
import {
  Briefcase,
  CircleUserRound,
  Info,
  LayoutGrid,
  Link2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useId } from 'react'

import {
  listarCargos,
  listarDependentesDaPessoa,
  obterCompletude,
} from '@/lib/api'
import { cn } from '@/lib/utils'

export type AbaDaFicha =
  'dados' | 'ficha360' | 'cargos' | 'familia' | 'situacao' | 'vinculos'

const ABAS_DA_FICHA: {
  id: AbaDaFicha
  rotulo: string
  icone: LucideIcon
}[] = [
  { id: 'dados', rotulo: 'Dados e foto', icone: CircleUserRound },
  { id: 'ficha360', rotulo: 'Ficha 360', icone: LayoutGrid },
  { id: 'cargos', rotulo: 'Cargos', icone: Briefcase },
  { id: 'familia', rotulo: 'Família', icone: Users },
  { id: 'situacao', rotulo: 'Situação', icone: Info },
  { id: 'vinculos', rotulo: 'Vínculos', icone: Link2 },
]

type Props = {
  aba: AbaDaFicha
  aoEscolher: (aba: AbaDaFicha) => void
}

// v9.5d (desenho aprovado pelo Presidente, rodadas 4 e 5): as abas da ficha no alto, com o traço ouro na escolhida; no celular deslizam para o lado.
export function AbasNoAlto({
  aba,
  aoEscolher,
  className,
}: Props & { className?: string }) {
  return (
    <div
      role="group"
      aria-label="Partes da ficha"
      className={cn(
        'relative mb-6 flex gap-1 overflow-x-auto border-b border-border',
        className,
      )}
    >
      {ABAS_DA_FICHA.map((a) => {
        const ativa = aba === a.id
        return (
          <button
            key={a.id}
            type="button"
            aria-pressed={ativa}
            onClick={() => aoEscolher(a.id)}
            className={cn(
              '-mb-px min-h-11 shrink-0 border-b-[3px] px-4 text-sm whitespace-nowrap transition-colors',
              ativa
                ? 'border-brand-secondary font-extrabold text-foreground'
                : 'border-transparent font-semibold text-muted-foreground hover:text-foreground',
            )}
          >
            {a.rotulo}
          </button>
        )
      })}
    </div>
  )
}

// Com o menu do módulo recolhido (no notebook), as abas saem do alto e vão para uma coluna à direita, cada uma com uma linha do que tem nela (desenho
// aprovado na rodada 5, opção 2). A linha fica fora do nome do botão (aria-describedby): quem procura "Família" pelo nome continua achando.
export function AbasADireita({
  aba,
  aoEscolher,
  idAssociado,
  idPessoa,
  situacao,
}: Props & { idAssociado: number; idPessoa: number; situacao: string | null }) {
  const base = useId()
  const { data: completude } = useQuery({
    queryKey: ['completude', idAssociado],
    queryFn: () => obterCompletude(idAssociado),
  })
  const { data: cargos } = useQuery({
    queryKey: ['cargos', idAssociado],
    queryFn: () => listarCargos(idAssociado),
  })
  const { data: familia } = useQuery({
    queryKey: ['dependentes', idPessoa],
    queryFn: () => listarDependentesDaPessoa(idPessoa),
  })
  const cargoAtual = cargos?.find((c) => !c.data_saida)?.titulo_cargo
  const resumo: Record<AbaDaFicha, string> = {
    dados: completude
      ? `${completude.percentual}% preenchido`
      : 'Nome, contato, endereço e foto',
    ficha360: 'O resumo de tudo',
    cargos:
      cargoAtual ?? (cargos ? 'Nenhum cargo agora' : 'Diretoria e Conselho'),
    familia: familia
      ? familia.length === 1
        ? '1 pessoa'
        : `${familia.length} pessoas`
      : 'Cônjuge, filhos e outros',
    situacao: situacao ?? '—',
    vinculos: 'Voluntariado, projetos e acesso',
  }
  return (
    <nav
      aria-label="Partes da ficha"
      className="sticky top-20 w-56 shrink-0 self-start rounded-2xl border border-border bg-card p-2.5 shadow-card"
    >
      <p className="px-2 pb-1.5 text-[11.5px] font-extrabold tracking-wider text-muted-foreground uppercase">
        Nesta ficha
      </p>
      {ABAS_DA_FICHA.map((a) => {
        const ativa = aba === a.id
        const idResumo = `${base}-${a.id}`
        return (
          <button
            key={a.id}
            type="button"
            aria-pressed={ativa}
            aria-describedby={idResumo}
            onClick={() => aoEscolher(a.id)}
            className={cn(
              'flex min-h-[54px] w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors',
              ativa
                ? 'bg-brand-secondary text-brand-secondary-foreground'
                : 'text-foreground hover:bg-accent',
            )}
          >
            <a.icone
              aria-hidden="true"
              className={cn(
                'h-[18px] w-[18px] shrink-0',
                !ativa && 'text-muted-foreground',
              )}
            />
            <span className="flex min-w-0 flex-col">
              <span
                className={cn(
                  'text-sm',
                  ativa ? 'font-extrabold' : 'font-semibold',
                )}
              >
                {a.rotulo}
              </span>
              {/* fora do nome do botão (aria-hidden) e lido como descrição (aria-describedby) */}
              <span
                id={idResumo}
                aria-hidden="true"
                className={cn(
                  'truncate text-xs',
                  ativa
                    ? 'text-brand-secondary-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {resumo[a.id]}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
