import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarEventoCalendario,
  listarOpcoesCatalogo,
  obterCalendario,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'
import { eventoCalendarioCriarSchema } from '@/lib/schemas'

// v2.5.7 (FASE 2.5 - Painel) - calendário institucional único (backend v2.9): agrega, na
// leitura, o que já é dado real de outros módulos (AGO/eleição estatutária, assembleia
// convocada, mandato vencendo, prazo de deliberação, projeto/evento) mais evento avulso
// cadastrado aqui - "nunca descobrir em dezembro que devia ter feito algo em abril". Leitura
// liberada a QUALQUER usuário autenticado no backend (nunca `exigir_permissao`), por isso mora
// numa rota global (`/calendario`, ver App.tsx/Shell.tsx), fora do módulo Governança - terceira
// vez nesta fase que uma tela evita travar atrás de uma permissão mais estrita do que o backend
// exige (depois de Conselho Fiscal e Disciplina). Só "agendar evento" exige `governanca`.
const ROTULOS_TIPO: Record<string, string> = {
  AGO_ESTATUTARIA: 'Assembleia Geral Ordinária',
  ELEICAO_DIRETORIA: 'Eleição',
  ASSEMBLEIA_CONVOCADA: 'Assembleia convocada',
  MANDATO_VENCENDO: 'Fim de mandato',
  DELIBERACAO_PRAZO: 'Prazo de deliberação',
  PROJETO_EVENTO: 'Projeto/evento',
  EVENTO_INSTITUCIONAL: 'Evento institucional',
}

function corPorDiasRestantes(dias: number): string {
  if (dias <= 7) return 'border-l-4 border-l-destructive'
  if (dias <= 30) return 'border-l-4 border-l-amber-500'
  return 'border-l-4 border-l-border'
}

export function CalendarioPage() {
  const { data: me } = useMe()
  const podeAgendar = me?.permissoes.includes('governanca') ?? false
  const [diasAntecedencia, setDiasAntecedencia] = useState(90)
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: itens } = useQuery({
    queryKey: ['calendario', diasAntecedencia],
    queryFn: () => obterCalendario(diasAntecedencia),
  })
  const { data: categorias } = useQuery({
    queryKey: ['opcoes-catalogo', 'categoria_evento_calendario'],
    queryFn: () => listarOpcoesCatalogo('categoria_evento_calendario'),
    enabled: podeAgendar,
  })

  const agendar = useMutation({
    mutationFn: (v: z.infer<typeof eventoCalendarioCriarSchema>) =>
      criarEventoCalendario({
        ...v,
        descricao: v.descricao || undefined,
        data_fim: v.data_fim || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendario'] })
      setMostrarForm(false)
    },
  })

  return (
    <>
      <PageHeader
        titulo="Calendário institucional"
        descricao="Obrigações estatutárias, mandatos, deliberações e eventos - tudo num só lugar."
        acoes={
          podeAgendar && (
            <Button onClick={() => setMostrarForm((v) => !v)}>
              {mostrarForm ? 'Cancelar' : 'Agendar evento'}
            </Button>
          )
        }
      />

      <div className="mb-4 flex items-center gap-2 text-sm">
        <label htmlFor="dias-antecedencia" className="text-muted-foreground">
          Ver os próximos
        </label>
        <select
          id="dias-antecedencia"
          value={diasAntecedencia}
          onChange={(e) => setDiasAntecedencia(Number(e.target.value))}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
          <option value={180}>180 dias</option>
          <option value={365}>365 dias</option>
        </select>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof eventoCalendarioCriarSchema>>
          schema={eventoCalendarioCriarSchema}
          defaultValues={{
            titulo: '',
            descricao: '',
            categoria: '',
            data_inicio: '',
            data_fim: '',
          }}
          onSubmit={(v) => agendar.mutateAsync(v)}
          className="mb-6 grid gap-2 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"
        >
          {(form) => (
            <>
              <div>
                <input
                  {...form.register('titulo')}
                  placeholder="Título do evento"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.titulo?.message} />
              </div>
              <div>
                <select
                  {...form.register('categoria')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione a categoria…</option>
                  {(categorias ?? []).map((o) => (
                    <option key={o.codigo} value={o.codigo}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={form.formState.errors.categoria?.message}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Início</label>
                <input
                  type="datetime-local"
                  {...form.register('data_inicio')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.data_inicio?.message}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Fim (opcional)</label>
                <input
                  type="datetime-local"
                  {...form.register('data_fim')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <textarea
                  {...form.register('descricao')}
                  placeholder="Descrição (opcional)"
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={agendar.isPending}>
                  {agendar.isPending ? 'Agendando…' : 'Agendar evento'}
                </Button>
                {agendar.isError && (
                  <p className="mt-2 text-sm text-destructive">
                    {(agendar.error as Error).message}
                  </p>
                )}
              </div>
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(itens ?? []).map((item, i) => (
          <div
            key={`${item.tipo}-${item.data}-${i}`}
            className={`rounded-md border border-border bg-card p-3 text-sm ${corPorDiasRestantes(item.dias_restantes)}`}
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">{item.titulo}</p>
              <span
                className={
                  item.dias_restantes <= 7
                    ? 'font-medium text-destructive'
                    : item.dias_restantes <= 30
                      ? 'font-medium text-amber-600'
                      : 'text-muted-foreground'
                }
              >
                {item.dias_restantes === 0
                  ? 'Hoje'
                  : item.dias_restantes > 0
                    ? `Em ${item.dias_restantes} dia(s)`
                    : `Atrasado há ${-item.dias_restantes} dia(s)`}
              </span>
            </div>
            <p className="text-muted-foreground">
              {ROTULOS_TIPO[item.tipo] ?? item.tipo} · {formatarData(item.data)}
              {item.artigo_origem && ` · ${item.artigo_origem}`}
            </p>
          </div>
        ))}
        {(itens ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nada no calendário para os próximos {diasAntecedencia} dias.
          </p>
        )}
      </div>
    </>
  )
}
