import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  adicionarMembroEquipe,
  alterarStatusProjeto,
  concluirItemCronograma,
  criarItemCronograma,
  criarProjeto,
  encerrarParticipacaoEquipe,
  gerarRelatorioFinalProjeto,
  listarAssociados,
  listarCentrosCusto,
  listarCronograma,
  listarEquipeProjeto,
  listarOpcoesCatalogo,
  listarProjetos,
  listarRelatoriosFinaisProjeto,
  obterOrcamentoDoProjeto,
  type Projeto,
} from '@/lib/api'
import {
  equipeProjetoCriarSchema,
  itemCronogramaCriarSchema,
  projetoCriarSchema,
} from '@/lib/schemas'

// v4.1 (FASE 4) - Projeto como entidade única e configurável: tipo/status de catálogo,
// cronograma com status sempre derivado (nunca escolhido à mão), equipe com papel, orçamento via
// centro de custo (reaproveita o motor Orcamento, v3.5) e encerramento formal versionado.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function FormularioProjeto({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: tiposProjeto } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_projeto'],
    queryFn: () => listarOpcoesCatalogo('tipo_projeto'),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof projetoCriarSchema>) => criarProjeto(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projetos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof projetoCriarSchema>>
      schema={projetoCriarSchema}
      defaultValues={{
        nome_projeto: '',
        tipo_foco: '',
        necessita_alvara_bombeiros: false,
        data_inicio: '',
        data_fim_prevista: '',
        descricao: '',
        publico_alvo: '',
        visibilidade: 'Interna',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div className="sm:col-span-2">
            <input
              {...form.register('nome_projeto')}
              placeholder="Nome do projeto"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.nome_projeto?.message} />
          </div>
          <div>
            <input
              {...form.register('tipo_foco')}
              placeholder="Foco (ex.: Social, Educacional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.tipo_foco?.message} />
          </div>
          <div>
            <select
              {...form.register('tipo_projeto')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Tipo de projeto…</option>
              {(tiposProjeto ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Data de início
            </label>
            <input
              type="date"
              {...form.register('data_inicio')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.data_inicio?.message} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Data de fim prevista
            </label>
            <input
              type="date"
              {...form.register('data_fim_prevista')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.data_fim_prevista?.message}
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
            <select
              {...form.register('id_centro_custo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem centro de custo</option>
              {(centros ?? []).map((c) => (
                <option key={c.id_centro_custo} value={c.id_centro_custo}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <input
              {...form.register('publico_alvo')}
              placeholder="Público-alvo"
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
          <div>
            <select
              {...form.register('visibilidade')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Interna">Interna</option>
              <option value="Pública">Pública</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...form.register('necessita_alvara_bombeiros')}
            />
            Necessita alvará dos bombeiros
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Criar projeto'}
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

function SecaoCronograma({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const { data: cronograma } = useQuery({
    queryKey: ['cronograma-projeto', idProjeto],
    queryFn: () => listarCronograma(idProjeto),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof itemCronogramaCriarSchema>) =>
      criarItemCronograma(idProjeto, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['cronograma-projeto', idProjeto],
      }),
  })
  const concluir = useMutation({
    mutationFn: (idItem: number) => concluirItemCronograma(idItem),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['cronograma-projeto', idProjeto],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Cronograma</h3>
      <FormShell<z.infer<typeof itemCronogramaCriarSchema>>
        schema={itemCronogramaCriarSchema}
        defaultValues={{ tipo: 'Marco', titulo: '', prazo: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <select
              {...form.register('tipo')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Marco">Marco</option>
              <option value="Tarefa">Tarefa</option>
            </select>
            <div className="flex-1">
              <input
                {...form.register('titulo')}
                placeholder="Título"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.titulo?.message} />
            </div>
            <input
              type="date"
              {...form.register('prazo')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <select
              {...form.register('id_associado_responsavel')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Responsável…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar
            </Button>
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(cronograma ?? []).map((item) => (
          <div
            key={item.id_item}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            <span>
              [{item.tipo}] {item.titulo} — prazo {formatarData(item.prazo)}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={
                  item.status === 'Atrasado'
                    ? 'text-destructive'
                    : item.status === 'Concluído'
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                }
              >
                {item.status}
              </span>
              {item.status !== 'Concluído' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => concluir.mutate(item.id_item)}
                >
                  Concluir
                </Button>
              )}
            </div>
          </div>
        ))}
        {(cronograma ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum item de cronograma.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoEquipe({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const { data: equipe } = useQuery({
    queryKey: ['equipe-projeto', idProjeto],
    queryFn: () => listarEquipeProjeto(idProjeto),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: papeis } = useQuery({
    queryKey: ['opcoes-catalogo', 'papel_equipe_projeto'],
    queryFn: () => listarOpcoesCatalogo('papel_equipe_projeto'),
  })

  const adicionar = useMutation({
    mutationFn: (v: z.infer<typeof equipeProjetoCriarSchema>) =>
      adicionarMembroEquipe(idProjeto, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['equipe-projeto', idProjeto],
      }),
  })
  const encerrar = useMutation({
    mutationFn: (idMembro: number) => encerrarParticipacaoEquipe(idMembro),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['equipe-projeto', idProjeto],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Equipe</h3>
      <FormShell<z.infer<typeof equipeProjetoCriarSchema>>
        schema={equipeProjetoCriarSchema}
        defaultValues={{ id_associado: 0, papel: '' }}
        onSubmit={(v) => adicionar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <select
              {...form.register('id_associado')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Associado…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <select
              {...form.register('papel')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Papel…</option>
              {(papeis ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={adicionar.isPending}>
              Adicionar
            </Button>
            {adicionar.isError && (
              <p className="text-sm text-destructive">
                {(adicionar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(equipe ?? []).map((m) => {
          const associado = (associados ?? []).find(
            (a) => a.id_associado === m.id_associado,
          )
          return (
            <div
              key={m.id_membro}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span>
                {associado?.nome_completo ?? `Associado #${m.id_associado}`} —{' '}
                {m.papel}
                {m.data_fim && ' (encerrado)'}
              </span>
              {!m.data_fim && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => encerrar.mutate(m.id_membro)}
                >
                  Encerrar
                </Button>
              )}
            </div>
          )
        })}
        {(equipe ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum membro na equipe.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoOrcamentoRelatorio({ projeto }: { projeto: Projeto }) {
  const queryClient = useQueryClient()
  const { data: orcamentos } = useQuery({
    queryKey: ['orcamento-projeto', projeto.id_projeto],
    queryFn: () => obterOrcamentoDoProjeto(projeto.id_projeto),
    enabled: projeto.id_centro_custo != null,
  })
  const { data: relatorios } = useQuery({
    queryKey: ['relatorios-finais-projeto', projeto.id_projeto],
    queryFn: () => listarRelatoriosFinaisProjeto(projeto.id_projeto),
  })
  const [aberta, setAberta] = useState<number | null>(null)

  const gerar = useMutation({
    mutationFn: () => gerarRelatorioFinalProjeto(projeto.id_projeto),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['relatorios-finais-projeto', projeto.id_projeto],
      }),
  })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Orçamento (via centro de custo)
        </h3>
        {projeto.id_centro_custo == null && (
          <p className="text-sm text-muted-foreground">
            Projeto sem centro de custo vinculado.
          </p>
        )}
        <div className="space-y-1">
          {(orcamentos ?? []).map((o) => (
            <div
              key={o.id_orcamento}
              className="rounded-md border border-border p-2 text-sm"
            >
              <p>
                Previsto {formatarReais(o.valor_previsto)} — Realizado{' '}
                {formatarReais(o.realizado)}
              </p>
              <p
                className={o.estourado ? 'text-destructive' : 'text-green-600'}
              >
                {o.estourado ? 'Estourado' : 'Dentro do previsto'}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Encerramento formal (relatório final)
        </h3>
        <Button
          size="sm"
          disabled={gerar.isPending}
          onClick={() => gerar.mutate()}
        >
          {gerar.isPending ? 'Gerando…' : 'Gerar nova versão'}
        </Button>
        <div className="mt-2 space-y-1">
          {(relatorios ?? []).map((r) => (
            <div
              key={r.id_relatorio}
              className="rounded-md border border-border p-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span>Versão {r.versao}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAberta((v) =>
                      v === r.id_relatorio ? null : r.id_relatorio,
                    )
                  }
                >
                  {aberta === r.id_relatorio ? 'Fechar' : 'Ver'}
                </Button>
              </div>
              {aberta === r.id_relatorio && (
                <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2 text-xs">
                  {r.conteudo}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DetalheProjeto({ projeto }: { projeto: Projeto }) {
  const queryClient = useQueryClient()
  const { data: statusOpcoes } = useQuery({
    queryKey: ['opcoes-catalogo', 'status_projeto'],
    queryFn: () => listarOpcoesCatalogo('status_projeto'),
  })
  const alterarStatus = useMutation({
    mutationFn: (status: string) =>
      alterarStatusProjeto(projeto.id_projeto, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projetos'] }),
  })

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{projeto.nome_projeto}</h2>
          <select
            value={projeto.status}
            onChange={(e) => alterarStatus.mutate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {(statusOpcoes ?? []).map((o) => (
              <option key={o.codigo} value={o.codigo}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
        {projeto.descricao && (
          <p className="text-sm text-muted-foreground">{projeto.descricao}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {formatarData(projeto.data_inicio)} —{' '}
          {formatarData(projeto.data_fim_prevista)}
          {projeto.publico_alvo && ` · Público-alvo: ${projeto.publico_alvo}`}
        </p>
      </div>
      <SecaoCronograma idProjeto={projeto.id_projeto} />
      <SecaoEquipe idProjeto={projeto.id_projeto} />
      <SecaoOrcamentoRelatorio projeto={projeto} />
    </div>
  )
}

export function ProjetosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [idSelecionado, setIdSelecionado] = useState<number | null>(null)
  const { data: projetos } = useQuery({
    queryKey: ['projetos'],
    queryFn: listarProjetos,
  })

  const projetoSelecionado =
    (projetos ?? []).find((p) => p.id_projeto === idSelecionado) ?? null

  return (
    <>
      <PageHeader
        titulo="Projetos"
        descricao="Projeto como entidade única e configurável — cronograma, equipe, orçamento (via centro de custo) e encerramento formal."
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Todos os projetos</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo projeto'}
          </Button>
        </div>
        {mostrarForm && (
          <FormularioProjeto onCancelar={() => setMostrarForm(false)} />
        )}
        <div className="space-y-2">
          {(projetos ?? []).map((p) => (
            <div
              key={p.id_projeto}
              className="cursor-pointer rounded-md border border-border p-3 text-sm hover:bg-muted/30"
              onClick={() =>
                setIdSelecionado(
                  p.id_projeto === idSelecionado ? null : p.id_projeto,
                )
              }
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.nome_projeto}</p>
                <span className="text-muted-foreground">{p.status}</span>
              </div>
              <p className="text-muted-foreground">
                {p.tipo_projeto ?? p.tipo_foco} · {p.visibilidade}
              </p>
            </div>
          ))}
          {(projetos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum projeto cadastrado.
            </p>
          )}
        </div>
      </section>

      {projetoSelecionado && <DetalheProjeto projeto={projetoSelecionado} />}
    </>
  )
}
