import { useQuery } from '@tanstack/react-query'
import { ListChecks } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  listarAssociados,
  listarAtas,
  listarDeliberacoesPendentes,
} from '@/lib/api'
import { formatarDia } from '@/lib/datas'

// v5.4d - painel da Diretoria (backend v2.5): tudo que as assembleias deliberaram e ainda não foi executado, de todas as assembleias juntas. A
// rota existia desde a v2.5 sem tela: a lista só aparecia dentro de cada ata. Concluir ou revogar continua sendo na ata (onde está o texto e os
// efeitos automáticos); aqui é a visão de quem cobra a execução.
export function DeliberacoesPendentesPage() {
  const { data: pendentes, isLoading } = useQuery({
    queryKey: ['deliberacoes-pendentes'],
    queryFn: listarDeliberacoesPendentes,
  })
  const { data: atas } = useQuery({ queryKey: ['atas'], queryFn: listarAtas })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const assembleiaDaAta = new Map(
    (atas ?? []).map((a) => [a.id_ata, a.id_assembleia]),
  )
  const nomes = new Map(
    (associados ?? []).map((a) => [a.id_associado, a.nome_completo]),
  )
  // dia local de hoje (aaaa-mm-dd): o prazo é um dia, sem hora
  const hoje = new Intl.DateTimeFormat('en-CA').format(new Date())

  return (
    <>
      <PageHeader
        titulo="Deliberações pendentes"
        descricao="O que as assembleias decidiram e ainda não foi executado."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: 'Deliberações pendentes' },
        ]}
      />

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {!isLoading && (pendentes ?? []).length === 0 && (
        <EmptyState
          icone={ListChecks}
          titulo="Nenhuma deliberação pendente"
          descricao="Tudo o que as assembleias decidiram já foi concluído ou revogado."
        />
      )}
      <div className="v3-space-y-2">
        {(pendentes ?? []).map((d) => {
          const idAssembleia = assembleiaDaAta.get(d.id_ata)
          const atrasada =
            !!d.prazo_execucao && d.prazo_execucao.slice(0, 10) < hoje
          return (
            <div
              key={d.id_deliberacao}
              className="rounded-md border border-border bg-card p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{d.tipo}</p>
                  <p className="text-muted-foreground">{d.texto}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.id_associado_responsavel
                      ? `Responsável: ${nomes.get(d.id_associado_responsavel) ?? `Associado #${d.id_associado_responsavel}`}`
                      : 'Sem responsável definido'}
                    {d.prazo_execucao &&
                      ` · prazo ${formatarDia(d.prazo_execucao)}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {atrasada && (
                    <p className="font-medium text-destructive">Atrasada</p>
                  )}
                  {idAssembleia && (
                    <Link
                      to={`/governanca/${idAssembleia}/ata?ata=${d.id_ata}`}
                      className="text-primary hover:underline"
                    >
                      Abrir a ata
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
