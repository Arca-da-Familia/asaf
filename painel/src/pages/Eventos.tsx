import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarEvento,
  criarNovaEdicaoEvento,
  criarSessaoEvento,
  listarAssociados,
  listarEdicoesEvento,
  listarEspacos,
  listarEventos,
  listarInscricoesDoContexto,
  listarOpcoesCatalogo,
  listarSessoesEvento,
  type Evento,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  eventoCriarSchema,
  novaEdicaoEventoCriarSchema,
  sessaoEventoCriarSchema,
} from '@/lib/schemas'

// v4.5 (FASE 4) - Evento como entidade única e pontual: UM registro só (nunca duas tabelas),
// consumido por esta tela de gestão e pelo endpoint público (`/api/publico/eventos`) que o site
// institucional lê. Sessões são a programação (congresso de um dia, várias atividades sem
// precisar criar "vários eventos"); edições recorrentes ficam ligadas entre si por
// `id_edicao_anterior`. Inscrição reaproveita o motor genérico da v4.0 (`/api/inscricoes/`) -
// autoatendimento do próprio associado (`/api/eventos/{id}/inscricao`) é consumido por outra
// tela, esta aqui é a visão de gestão.
function FormularioEvento({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: categorias } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_evento'],
    queryFn: () => listarOpcoesCatalogo('tipo_evento'),
  })
  const { data: espacos } = useQuery({
    queryKey: ['espacos'],
    queryFn: listarEspacos,
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof eventoCriarSchema>) => criarEvento(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof eventoCriarSchema>>
      schema={eventoCriarSchema}
      defaultValues={{
        titulo: '',
        categoria: '',
        data_hora_inicio: '',
        data_hora_fim: '',
        descricao: '',
        endereco_avulso: '',
        gratuito: true,
        visibilidade: 'Interna',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div className="sm:col-span-2">
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
              <option value="">Categoria…</option>
              {(categorias ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.categoria?.message} />
          </div>
          <div>
            <select
              {...form.register('visibilidade')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Interna">Interna</option>
              <option value="Pública">Pública (site institucional)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Início
            </label>
            <input
              type="datetime-local"
              {...form.register('data_hora_inicio')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.data_hora_inicio?.message}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Fim (opcional)
            </label>
            <input
              type="datetime-local"
              {...form.register('data_hora_fim')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <select
              {...form.register('id_espaco')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem espaço próprio…</option>
              {(espacos ?? []).map((e) => (
                <option key={e.id_espaco} value={e.id_espaco}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              {...form.register('endereco_avulso')}
              placeholder="Ou endereço avulso"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <select
              {...form.register('id_associado_responsavel')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Responsável…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              type="number"
              min={1}
              {...form.register('vagas')}
              placeholder="Vagas (opcional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <textarea
              {...form.register('descricao')}
              placeholder="Descrição"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('gratuito')} />
            Evento gratuito
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Criar evento'}
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

function SecaoSessoes({ idEvento }: { idEvento: number }) {
  const queryClient = useQueryClient()
  const { data: sessoes } = useQuery({
    queryKey: ['sessoes-evento', idEvento],
    queryFn: () => listarSessoesEvento(idEvento),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof sessaoEventoCriarSchema>) =>
      criarSessaoEvento(idEvento, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['sessoes-evento', idEvento],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Programação (sessões/atividades)
      </h3>
      <FormShell<z.infer<typeof sessaoEventoCriarSchema>>
        schema={sessaoEventoCriarSchema}
        defaultValues={{ titulo: '', data_hora_inicio: '', data_hora_fim: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div className="flex-1">
              <input
                {...form.register('titulo')}
                placeholder="Título da sessão"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.titulo?.message} />
            </div>
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
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar
            </Button>
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(sessoes ?? []).map((s) => (
          <div
            key={s.id_sessao}
            className="rounded-md border border-border p-2 text-sm"
          >
            {s.titulo} — {formatarData(s.data_hora_inicio, { comHora: true })}
          </div>
        ))}
        {(sessoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma sessão cadastrada — evento simples, sem programação.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoEdicoes({ evento }: { evento: Evento }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data: edicoes } = useQuery({
    queryKey: ['edicoes-evento', evento.id_evento],
    queryFn: () => listarEdicoesEvento(evento.id_evento),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof novaEdicaoEventoCriarSchema>) =>
      criarNovaEdicaoEvento(evento.id_evento, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      queryClient.invalidateQueries({
        queryKey: ['edicoes-evento', evento.id_evento],
      })
      setMostrarForm(false)
    },
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Edições recorrentes (ligadas entre si)
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Criar nova edição'}
        </Button>
      </div>
      {mostrarForm && (
        <FormShell<z.infer<typeof novaEdicaoEventoCriarSchema>>
          schema={novaEdicaoEventoCriarSchema}
          defaultValues={{
            titulo: '',
            data_hora_inicio: '',
            data_hora_fim: '',
          }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <input
                {...form.register('titulo')}
                placeholder="Título da nova edição (opcional)"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="datetime-local"
                {...form.register('data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" size="sm" disabled={criar.isPending}>
                Criar
              </Button>
            </>
          )}
        </FormShell>
      )}
      <div className="space-y-1">
        {(edicoes ?? []).map((e) => (
          <div
            key={e.id_evento}
            className={`rounded-md border p-2 text-sm ${e.id_evento === evento.id_evento ? 'border-primary' : 'border-border'}`}
          >
            {e.titulo} — {formatarData(e.data_hora_inicio)}
            {e.id_evento === evento.id_evento && ' (esta edição)'}
          </div>
        ))}
      </div>
    </div>
  )
}

function SecaoInscritos({ evento }: { evento: Evento }) {
  const { data: inscritos } = useQuery({
    queryKey: ['inscricoes', 'Evento', evento.id_evento],
    queryFn: () => listarInscricoesDoContexto('Evento', evento.id_evento),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Inscritos no evento (autoatendimento pelo painel)
      </h3>
      <div className="space-y-1">
        {(inscritos ?? []).map((i) => (
          <div
            key={i.id_inscricao}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            <span>Pessoa #{i.id_pessoa}</span>
            <span className="text-muted-foreground">{i.status}</span>
          </div>
        ))}
        {(inscritos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma inscrição registrada ainda.
          </p>
        )}
      </div>
    </div>
  )
}

function DetalheEvento({ evento }: { evento: Evento }) {
  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-semibold">{evento.titulo}</h2>
        {evento.descricao && (
          <p className="text-sm text-muted-foreground">{evento.descricao}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {formatarData(evento.data_hora_inicio, { comHora: true })}
          {evento.data_hora_fim &&
            ` até ${formatarData(evento.data_hora_fim, { comHora: true })}`}{' '}
          · {evento.categoria} · {evento.visibilidade} ·{' '}
          {evento.gratuito ? 'Gratuito' : 'Pago'}
          {evento.vagas != null && ` · ${evento.vagas} vaga(s)`}
        </p>
      </div>
      <SecaoSessoes idEvento={evento.id_evento} />
      <SecaoEdicoes evento={evento} />
      <SecaoInscritos evento={evento} />
    </div>
  )
}

export function EventosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [idSelecionado, setIdSelecionado] = useState<number | null>(null)
  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: listarEventos,
  })

  const eventoSelecionado =
    (eventos ?? []).find((e) => e.id_evento === idSelecionado) ?? null

  return (
    <>
      <PageHeader
        titulo="Eventos"
        descricao="Evento como entidade única e pontual — programação por sessões, edições recorrentes ligadas entre si, o mesmo registro lido pelo site institucional."
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Todos os eventos</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo evento'}
          </Button>
        </div>
        {mostrarForm && (
          <FormularioEvento onCancelar={() => setMostrarForm(false)} />
        )}
        <div className="space-y-2">
          {(eventos ?? []).map((e) => (
            <div
              key={e.id_evento}
              className="cursor-pointer rounded-md border border-border p-3 text-sm hover:bg-muted/30"
              onClick={() =>
                setIdSelecionado(
                  e.id_evento === idSelecionado ? null : e.id_evento,
                )
              }
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{e.titulo}</p>
                <span className="text-muted-foreground">{e.visibilidade}</span>
              </div>
              <p className="text-muted-foreground">
                {formatarData(e.data_hora_inicio, { comHora: true })} ·{' '}
                {e.categoria}
              </p>
            </div>
          ))}
          {(eventos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum evento cadastrado.
            </p>
          )}
        </div>
      </section>

      {eventoSelecionado && <DetalheEvento evento={eventoSelecionado} />}
    </>
  )
}
