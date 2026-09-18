import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aprovarReserva,
  cancelarReserva,
  criarBloqueioEspaco,
  criarEspaco,
  criarReservaEspaco,
  criarReservaRecorrente,
  listarAssociados,
  listarBloqueiosEspaco,
  listarEspacos,
  listarOpcoesCatalogo,
  listarPlanoContas,
  listarReservasEspaco,
  marcarNaoCompareceu,
  obterChecklistReserva,
  recusarReserva,
  registrarDevolucaoEspaco,
  registrarRetiradaEspaco,
  type Espaco,
} from '@/lib/api'
import {
  bloqueioEspacoCriarSchema,
  devolucaoEspacoSchema,
  espacoCriarSchema,
  reservaEspacoCriarSchema,
  reservaRecorrenteCriarSchema,
  retiradaEspacoSchema,
} from '@/lib/schemas'

// v4.3 (FASE 4) - Reserva de espaço: fluxo instantâneo ou aprovação manual (por espaço),
// conflito de horário reaproveitando o motor de agenda (v4.0) - a garantia real sob concorrência
// é uma EXCLUDE constraint no Postgres, o painel só mostra a mensagem de erro quando ela dispara.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}

function FormularioEspaco({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: tipos } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_espaco'],
    queryFn: () => listarOpcoesCatalogo('tipo_espaco'),
  })
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const contasReceita = (contas ?? []).filter(
    (c) => c.tipo === 'Receita' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof espacoCriarSchema>) => criarEspaco(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['espacos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof espacoCriarSchema>>
      schema={espacoCriarSchema}
      defaultValues={{
        nome: '',
        tipo: '',
        exige_aprovacao: false,
        isento_para_associado_adimplente: true,
        prazo_cancelamento_horas: 24,
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <input
              {...form.register('nome')}
              placeholder="Nome do espaço"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.nome?.message} />
          </div>
          <div>
            <select
              {...form.register('tipo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Tipo…</option>
              {(tipos ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.tipo?.message} />
          </div>
          <div>
            <input
              type="number"
              {...form.register('capacidade')}
              placeholder="Capacidade"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor_reserva')}
              placeholder="Valor da reserva (R$, opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <select
              {...form.register('id_conta_contabil_receita')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Conta de receita (se onerosa)…</option>
              {contasReceita.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              type="number"
              {...form.register('prazo_cancelamento_horas')}
              placeholder="Prazo de cancelamento (horas)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('taxa_cancelamento_tardio')}
              placeholder="Taxa de cancelamento tardio (R$)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <input
              type="number"
              {...form.register('limite_no_show_bloqueio')}
              placeholder="Bloquear após N faltas (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('exige_aprovacao')} />
            Exige aprovação manual (senão, instantânea)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...form.register('isento_para_associado_adimplente')}
            />
            Isento para associado adimplente
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar espaço'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
          {criar.isError && (
            <p className="text-sm text-destructive sm:col-span-2">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

function PainelChecklist({ idReserva }: { idReserva: number }) {
  const queryClient = useQueryClient()
  const { data: checklist } = useQuery({
    queryKey: ['checklist-reserva', idReserva],
    queryFn: () => obterChecklistReserva(idReserva),
  })

  const retirada = useMutation({
    mutationFn: (v: z.infer<typeof retiradaEspacoSchema>) =>
      registrarRetiradaEspaco(idReserva, v.condicao_retirada),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['checklist-reserva', idReserva],
      }),
  })
  const devolucao = useMutation({
    mutationFn: (v: z.infer<typeof devolucaoEspacoSchema>) =>
      registrarDevolucaoEspaco(idReserva, v),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['checklist-reserva', idReserva],
      })
      queryClient.invalidateQueries({ queryKey: ['reservas-espaco'] })
    },
  })

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/10 p-2 text-xs">
      {!checklist?.data_retirada && (
        <FormShell<z.infer<typeof retiradaEspacoSchema>>
          schema={retiradaEspacoSchema}
          defaultValues={{ condicao_retirada: '' }}
          onSubmit={(v) => retirada.mutateAsync(v)}
          className="flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div className="flex-1">
                <input
                  {...form.register('condicao_retirada')}
                  placeholder="Condição na retirada"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                />
              </div>
              <Button type="submit" size="sm" disabled={retirada.isPending}>
                Registrar retirada
              </Button>
            </>
          )}
        </FormShell>
      )}
      {checklist?.data_retirada && !checklist?.data_devolucao && (
        <FormShell<z.infer<typeof devolucaoEspacoSchema>>
          schema={devolucaoEspacoSchema}
          defaultValues={{ condicao_devolucao: '', houve_avaria: false }}
          onSubmit={(v) => devolucao.mutateAsync(v)}
          className="flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div className="flex-1">
                <input
                  {...form.register('condicao_devolucao')}
                  placeholder="Condição na devolução"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                />
              </div>
              <label className="flex items-center gap-1">
                <input type="checkbox" {...form.register('houve_avaria')} />
                Houve avaria
              </label>
              <input
                {...form.register('descricao_avaria')}
                placeholder="Descrição da avaria"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              />
              <Button type="submit" size="sm" disabled={devolucao.isPending}>
                Registrar devolução
              </Button>
            </>
          )}
        </FormShell>
      )}
      {checklist?.data_devolucao && (
        <p>
          Devolvido em {formatarDataHora(checklist.data_devolucao)}
          {checklist.houve_avaria && ` — avaria: ${checklist.descricao_avaria}`}
        </p>
      )}
    </div>
  )
}

function SecaoReservas({ espaco }: { espaco: Espaco }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarFormRecorrente, setMostrarFormRecorrente] = useState(false)
  const [checklistAberto, setChecklistAberto] = useState<number | null>(null)
  const { data: reservas } = useQuery({
    queryKey: ['reservas-espaco', espaco.id_espaco],
    queryFn: () => listarReservasEspaco(espaco.id_espaco),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['reservas-espaco', espaco.id_espaco],
    })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof reservaEspacoCriarSchema>) =>
      criarReservaEspaco({ ...v, id_espaco: espaco.id_espaco }),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const criarRecorrente = useMutation({
    mutationFn: (v: z.infer<typeof reservaRecorrenteCriarSchema>) =>
      criarReservaRecorrente({ ...v, id_espaco: espaco.id_espaco }),
    onSuccess: () => {
      invalidar()
      setMostrarFormRecorrente(false)
    },
  })
  const aprovar = useMutation({
    mutationFn: aprovarReserva,
    onSuccess: invalidar,
  })
  const recusar = useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) =>
      recusarReserva(id, motivo),
    onSuccess: invalidar,
  })
  const cancelar = useMutation({
    mutationFn: ({ id, motivo }: { id: number; motivo: string }) =>
      cancelarReserva(id, motivo),
    onSuccess: invalidar,
  })
  const naoCompareceu = useMutation({
    mutationFn: marcarNaoCompareceu,
    onSuccess: invalidar,
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Reservas</h3>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova reserva'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarFormRecorrente((v) => !v)}
          >
            {mostrarFormRecorrente ? 'Cancelar' : 'Reserva recorrente'}
          </Button>
        </div>
      </div>
      {mostrarForm && (
        <FormShell<z.infer<typeof reservaEspacoCriarSchema>>
          schema={reservaEspacoCriarSchema}
          defaultValues={{
            id_associado_solicitante: 0,
            data_hora_inicio: '',
            data_hora_fim: '',
            finalidade: '',
          }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <select
                {...form.register('id_associado_solicitante')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Solicitante…</option>
                {(associados ?? []).map((a) => (
                  <option key={a.id_associado} value={a.id_associado}>
                    {a.nome_completo}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                {...form.register('data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="datetime-local"
                {...form.register('data_hora_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <div className="flex-1">
                <input
                  {...form.register('finalidade')}
                  placeholder="Finalidade"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.finalidade?.message}
                />
              </div>
              <Button type="submit" size="sm" disabled={criar.isPending}>
                Reservar
              </Button>
              {criar.isError && (
                <p className="w-full text-xs text-destructive">
                  {(criar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}
      {mostrarFormRecorrente && (
        <FormShell<z.infer<typeof reservaRecorrenteCriarSchema>>
          schema={reservaRecorrenteCriarSchema}
          defaultValues={{
            id_associado_solicitante: 0,
            data_hora_inicio: '',
            data_hora_fim: '',
            finalidade: '',
            quantidade_semanas: 4,
          }}
          onSubmit={(v) => criarRecorrente.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <select
                {...form.register('id_associado_solicitante')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Solicitante…</option>
                {(associados ?? []).map((a) => (
                  <option key={a.id_associado} value={a.id_associado}>
                    {a.nome_completo}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                {...form.register('data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="datetime-local"
                {...form.register('data_hora_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="number"
                {...form.register('quantidade_semanas')}
                placeholder="Semanas"
                className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
              />
              <div className="flex-1">
                <input
                  {...form.register('finalidade')}
                  placeholder="Finalidade"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={criarRecorrente.isPending}
              >
                Criar série
              </Button>
            </>
          )}
        </FormShell>
      )}
      {criarRecorrente.data && (
        <div className="mb-3 space-y-1 rounded-md border border-border p-2 text-xs">
          {criarRecorrente.data.ocorrencias.map((o) => (
            <p
              key={o.ocorrencia}
              className={o.sucesso ? 'text-green-600' : 'text-destructive'}
            >
              Semana {o.ocorrencia} ({formatarDataHora(o.data_hora_inicio)}):{' '}
              {o.sucesso ? 'reservada' : o.erro}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {(reservas ?? []).map((r) => (
          <div
            key={r.id_reserva}
            className="rounded-md border border-border p-2 text-sm"
          >
            <div className="flex items-center justify-between">
              <span>
                {formatarDataHora(r.data_hora_inicio)} — {r.finalidade}
              </span>
              <span
                className={
                  r.status === 'CONFIRMADA'
                    ? 'text-green-600'
                    : r.status === 'CANCELADA' ||
                        r.status === 'RECUSADA' ||
                        r.status === 'NAO_COMPARECEU'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
              >
                {r.status}
              </span>
            </div>
            {r.id_titulo_cobranca && (
              <p className="text-xs text-muted-foreground">
                Cobrança gerada (título #{r.id_titulo_cobranca})
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-2">
              {r.status === 'SOLICITADA' && (
                <>
                  <Button
                    size="sm"
                    onClick={() => aprovar.mutate(r.id_reserva)}
                  >
                    Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      recusar.mutate({
                        id: r.id_reserva,
                        motivo: 'Recusada pela administração.',
                      })
                    }
                  >
                    Recusar
                  </Button>
                </>
              )}
              {r.status === 'CONFIRMADA' && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      cancelar.mutate({
                        id: r.id_reserva,
                        motivo: 'Cancelada pelo solicitante.',
                      })
                    }
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => naoCompareceu.mutate(r.id_reserva)}
                  >
                    Não compareceu
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setChecklistAberto((v) =>
                        v === r.id_reserva ? null : r.id_reserva,
                      )
                    }
                  >
                    Checklist
                  </Button>
                </>
              )}
            </div>
            {checklistAberto === r.id_reserva && (
              <PainelChecklist idReserva={r.id_reserva} />
            )}
          </div>
        ))}
        {(reservas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma reserva para este espaço.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoBloqueios({ idEspaco }: { idEspaco: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data: bloqueios } = useQuery({
    queryKey: ['bloqueios-espaco', idEspaco],
    queryFn: () => listarBloqueiosEspaco(idEspaco),
  })
  const { data: motivos } = useQuery({
    queryKey: ['opcoes-catalogo', 'motivo_bloqueio_espaco'],
    queryFn: () => listarOpcoesCatalogo('motivo_bloqueio_espaco'),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof bloqueioEspacoCriarSchema>) =>
      criarBloqueioEspaco(idEspaco, v),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['bloqueios-espaco', idEspaco],
      })
      setMostrarForm(false)
    },
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Bloqueios</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Novo bloqueio'}
        </Button>
      </div>
      {mostrarForm && (
        <FormShell<z.infer<typeof bloqueioEspacoCriarSchema>>
          schema={bloqueioEspacoCriarSchema}
          defaultValues={{
            data_hora_inicio: '',
            data_hora_fim: '',
            motivo: '',
          }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <input
                type="datetime-local"
                {...form.register('data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="datetime-local"
                {...form.register('data_hora_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <select
                {...form.register('motivo')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Motivo…</option>
                {(motivos ?? []).map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" disabled={criar.isPending}>
                Bloquear
              </Button>
              {criar.isError && (
                <p className="w-full text-xs text-destructive">
                  {(criar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}
      <div className="space-y-1">
        {(bloqueios ?? []).map((b) => (
          <div
            key={b.id_bloqueio}
            className="rounded-md border border-border p-2 text-xs"
          >
            {formatarDataHora(b.data_hora_inicio)} —{' '}
            {formatarDataHora(b.data_hora_fim)} · {b.motivo}
          </div>
        ))}
        {(bloqueios ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum bloqueio registrado.
          </p>
        )}
      </div>
    </div>
  )
}

function DetalheEspaco({ espaco }: { espaco: Espaco }) {
  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-semibold">{espaco.nome}</h2>
        <p className="text-sm text-muted-foreground">
          {espaco.tipo}
          {espaco.capacidade && ` · capacidade ${espaco.capacidade}`} ·{' '}
          {espaco.exige_aprovacao
            ? 'Exige aprovação manual'
            : 'Confirmação instantânea'}
          {espaco.valor_reserva
            ? ` · ${formatarReais(espaco.valor_reserva)}`
            : ' · gratuito'}
        </p>
      </div>
      <SecaoBloqueios idEspaco={espaco.id_espaco} />
      <SecaoReservas espaco={espaco} />
    </div>
  )
}

export function EspacosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [idSelecionado, setIdSelecionado] = useState<number | null>(null)
  const { data: espacos } = useQuery({
    queryKey: ['espacos'],
    queryFn: listarEspacos,
  })

  const espacoSelecionado =
    (espacos ?? []).find((e) => e.id_espaco === idSelecionado) ?? null

  return (
    <>
      <PageHeader
        titulo="Reserva de Espaço"
        descricao="Espaços, bloqueios e reservas — conflito de horário reaproveita o motor de agenda (v4.0), com garantia real no banco em produção."
        trilha={[{ rotulo: 'Reserva de Espaço' }]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Espaços</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo espaço'}
          </Button>
        </div>
        {mostrarForm && (
          <FormularioEspaco onCancelar={() => setMostrarForm(false)} />
        )}
        <div className="space-y-2">
          {(espacos ?? []).map((e) => (
            <div
              key={e.id_espaco}
              className="cursor-pointer rounded-md border border-border p-3 text-sm hover:bg-muted/30"
              onClick={() =>
                setIdSelecionado(
                  e.id_espaco === idSelecionado ? null : e.id_espaco,
                )
              }
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{e.nome}</p>
                <span className="text-muted-foreground">{e.tipo}</span>
              </div>
            </div>
          ))}
          {(espacos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum espaço cadastrado.
            </p>
          )}
        </div>
      </section>

      {espacoSelecionado && <DetalheEspaco espaco={espacoSelecionado} />}
    </>
  )
}
