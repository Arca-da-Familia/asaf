import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  abrirDiscussaoItem,
  abrirVotacaoItem,
  credenciar,
  credenciarManual,
  criarItemPauta,
  criarVotacao,
  encerrarItemPauta,
  encerrarVotacao,
  impugnarVotacao,
  listarAssociados,
  listarCredenciamentos,
  listarHabilitados,
  listarImpugnacoes,
  listarItensPauta,
  listarOcorrencias,
  listarVotacoesDoItem,
  obterAssembleia,
  obterCodigoChamada,
  obterQuorum,
  obterVotacao,
  registrarOcorrencia,
  registrarSaidaCredenciamento,
  resolverEmpateVotacao,
  resolverImpugnacao,
  votar,
  type ItemPauta,
  type Votacao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'
import {
  credenciarSchema,
  impugnacaoCriarSchema,
  itemPautaCriarSchema,
  ocorrenciaCriarSchema,
  resolverEmpateSchema,
  resolverImpugnacaoSchema,
  votacaoAbrirSchema,
  votoSchema,
} from '@/lib/schemas'

const CORES_STATUS_ITEM: Record<string, string> = {
  Aguardando: 'text-muted-foreground',
  'Em discussão': 'text-blue-600',
  'Em votação': 'text-amber-600',
  Encerrado: 'text-green-600',
}

const OPCOES_RESERVADAS = ['Abstenção', 'Branco']

function BlocoCodigoChamada({ idAssembleia }: { idAssembleia: number }) {
  const [mostrar, setMostrar] = useState(false)
  const { data } = useQuery({
    queryKey: ['codigo-chamada', idAssembleia],
    queryFn: () => obterCodigoChamada(idAssembleia),
    enabled: mostrar,
  })

  return (
    <div className="mb-4 rounded-lg border border-border p-4">
      {mostrar && data ? (
        <>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Código de chamada — anuncie ou projete na sala
          </p>
          <p className="mt-1 text-4xl font-bold tracking-widest">
            {data.codigo_chamada}
          </p>
        </>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setMostrar(true)}>
          Mostrar código de chamada
        </Button>
      )}
    </div>
  )
}

function BlocoCredenciamento({
  idAssembleia,
  statusAssembleia,
}: {
  idAssembleia: number
  statusAssembleia: string
}) {
  const emAndamento = statusAssembleia === 'Em andamento'
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: credenciados } = useQuery({
    queryKey: ['credenciamentos', idAssembleia],
    queryFn: () => listarCredenciamentos(idAssembleia),
  })
  // "Chamada" (presença/falta, v2.5.3b - achado do usuário: "onde fica a chamada?"). O
  // credenciamento acima JÁ É a chamada; o que faltava era mostrar quem ainda não foi chamado -
  // habilitados a votar (v2.2, lista congelada na convocação) menos quem já se credenciou.
  const { data: habilitados } = useQuery({
    queryKey: ['habilitados', idAssembleia],
    queryFn: () => listarHabilitados(idAssembleia, true),
  })
  const { data: quorum } = useQuery({
    queryKey: ['quorum', idAssembleia],
    queryFn: () => obterQuorum(idAssembleia),
    refetchInterval: emAndamento ? 5000 : false,
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['credenciamentos', idAssembleia],
    })
    queryClient.invalidateQueries({ queryKey: ['quorum', idAssembleia] })
  }

  // Depois de encerrada, o credenciamento comum (`credenciar`) não aceita mais escrita (v2.3) -
  // a correção do secretário usa `credenciarManual`, endpoint próprio que aceita 'Realizada'
  // além de 'Em andamento' (achado do usuário: "app pode ter falhado, secretário corrige depois").
  const registrar = useMutation({
    mutationFn: async (v: z.infer<typeof credenciarSchema>) => {
      if (emAndamento) await credenciar(idAssembleia, v)
      else await credenciarManual(idAssembleia, v)
    },
    onSuccess: invalidar,
  })
  const saida = useMutation({
    mutationFn: (idCredenciamento: number) =>
      registrarSaidaCredenciamento(idAssembleia, idCredenciamento),
    onSuccess: invalidar,
  })

  const nomesPorId = new Map(
    (associados ?? []).map((a) => [a.id_associado, a.nome_completo]),
  )
  const idsCredenciados = new Set(
    (credenciados ?? []).map((c) => c.id_associado),
  )
  const faltantes = (habilitados ?? []).filter(
    (h) => !idsCredenciados.has(h.id_associado),
  )

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-1 font-semibold">Chamada — credenciamento e quórum</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        A chamada é este credenciamento: cada associado que comparece é marcado
        presente aqui — pela mesa (busca manual abaixo) ou por autochamada do
        próprio celular, com o código da sessão. Quem não aparece na lista de
        presentes está, por omissão, em falta (ou falta justificada, se aceita —
        ver detalhe da assembleia).
        {!emAndamento &&
          ' A sessão já foi encerrada: isto aqui é só correção manual.'}
      </p>

      {emAndamento && <BlocoCodigoChamada idAssembleia={idAssembleia} />}

      {quorum && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Convocação aplicável
            </p>
            <p className="mt-1 text-2xl font-bold">
              {quorum.convocacao_aplicavel}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Credenciados / mínimo exigido
            </p>
            <p className="mt-1 text-2xl font-bold">
              {quorum.credenciados_habilitados} / {quorum.minimo_exigido}
            </p>
          </div>
          <div
            className={`rounded-lg border p-4 ${
              quorum.quorum_atingido
                ? 'border-green-600/30 bg-green-600/10'
                : 'border-amber-600/30 bg-amber-600/10'
            }`}
          >
            <p className="text-xs font-medium uppercase text-muted-foreground">
              Quórum de instalação ({quorum.quorum_regra})
            </p>
            <p
              className={`mt-1 text-2xl font-bold ${
                quorum.quorum_atingido ? 'text-green-600' : 'text-amber-600'
              }`}
            >
              {quorum.quorum_atingido ? 'Atingido' : 'Não atingido'}
            </p>
          </div>
        </div>
      )}

      <FormShell<z.infer<typeof credenciarSchema>>
        schema={credenciarSchema}
        defaultValues={{ id_associado: 0, modalidade: 'Presencial' }}
        onSubmit={(v) => registrar.mutateAsync(v)}
        className="flex flex-wrap items-end gap-3"
      >
        {(form) => (
          <>
            <div className="min-w-[16rem] flex-1">
              <label className="text-sm font-medium">Associado</label>
              <select
                {...form.register('id_associado')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Selecione…</option>
                {(associados ?? []).map((a) => (
                  <option key={a.id_associado} value={a.id_associado}>
                    {a.nome_completo}
                  </option>
                ))}
              </select>
              <ErroCampo
                mensagem={form.formState.errors.id_associado?.message}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Modalidade</label>
              <select
                {...form.register('modalidade')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Presencial">Presencial</option>
                <option value="Remoto">Remoto</option>
              </select>
            </div>
            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending ? 'Credenciando…' : 'Credenciar'}
            </Button>
          </>
        )}
      </FormShell>
      {registrar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(registrar.error as Error).message}
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-green-600">
            Presentes ({(credenciados ?? []).length})
          </h3>
          <div className="space-y-1">
            {(credenciados ?? []).map((c) => (
              <div
                key={c.id_credenciamento}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  {nomesPorId.get(c.id_associado) ??
                    c.nome_completo ??
                    `Associado #${c.id_associado}`}{' '}
                  · {c.modalidade} · entrou{' '}
                  {formatarData(c.hora_entrada, { comHora: true })}
                </span>
                {c.hora_saida ? (
                  <span className="text-muted-foreground">
                    saiu {formatarData(c.hora_saida, { comHora: true })}
                  </span>
                ) : (
                  emAndamento && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saida.isPending}
                      onClick={() => saida.mutate(c.id_credenciamento)}
                    >
                      Registrar saída
                    </Button>
                  )
                )}
              </div>
            ))}
            {(credenciados ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ninguém credenciado ainda.
              </p>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-destructive">
            Faltantes até agora ({faltantes.length})
          </h3>
          <div className="space-y-1">
            {faltantes.map((h) => (
              <div
                key={h.id_associado}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>
                  {nomesPorId.get(h.id_associado) ??
                    `Associado #${h.id_associado}`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={registrar.isPending}
                  onClick={() =>
                    registrar.mutate({
                      id_associado: h.id_associado,
                      modalidade: 'Presencial',
                    })
                  }
                >
                  Marcar presença
                </Button>
              </div>
            ))}
            {faltantes.length === 0 && (habilitados ?? []).length > 0 && (
              <p className="text-sm text-muted-foreground">
                Todos os habilitados já foram chamados.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function BlocoImpugnacoes({ idVotacao }: { idVotacao: number }) {
  const { data: me } = useMe()
  const podeGerir = me?.permissoes.includes('governanca') ?? false
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: impugnacoes } = useQuery({
    queryKey: ['impugnacoes', idVotacao],
    queryFn: () => listarImpugnacoes(idVotacao),
    enabled: podeGerir,
  })

  const impugnar = useMutation({
    mutationFn: (v: z.infer<typeof impugnacaoCriarSchema>) =>
      impugnarVotacao(idVotacao, v.motivo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['impugnacoes', idVotacao] })
      setMostrarForm(false)
    },
  })

  const resolver = useMutation({
    mutationFn: ({
      idImpugnacao,
      resolucao,
    }: {
      idImpugnacao: number
      resolucao: string
    }) => resolverImpugnacao(idImpugnacao, resolucao),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['impugnacoes', idVotacao] }),
  })

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Impugnações</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Impugnar voto'}
        </Button>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof impugnacaoCriarSchema>>
          schema={impugnacaoCriarSchema}
          defaultValues={{ motivo: '' }}
          onSubmit={(v) => impugnar.mutateAsync(v)}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div className="min-w-[14rem] flex-1">
                <input
                  {...form.register('motivo')}
                  placeholder="Motivo da impugnação"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              </div>
              <Button type="submit" size="sm" disabled={impugnar.isPending}>
                {impugnar.isPending ? 'Enviando…' : 'Enviar'}
              </Button>
            </>
          )}
        </FormShell>
      )}

      {podeGerir && (
        <div className="mt-2 space-y-2">
          {(impugnacoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma impugnação registrada.
            </p>
          )}
          {(impugnacoes ?? []).map((i) => (
            <div
              key={i.id_impugnacao}
              className="rounded-md border border-border p-2 text-sm"
            >
              <p>{i.motivo}</p>
              <p className="text-xs text-muted-foreground">
                {formatarData(i.criado_em, { comHora: true })}
                {i.resolvida ? ` · Resolvida: ${i.resolucao}` : ' · Pendente'}
              </p>
              {!i.resolvida && (
                <FormShell<z.infer<typeof resolverImpugnacaoSchema>>
                  schema={resolverImpugnacaoSchema}
                  defaultValues={{ resolucao: '' }}
                  onSubmit={(v) =>
                    resolver.mutateAsync({
                      idImpugnacao: i.id_impugnacao,
                      resolucao: v.resolucao,
                    })
                  }
                  className="mt-2 flex flex-wrap items-end gap-2"
                >
                  {(form) => (
                    <>
                      <input
                        {...form.register('resolucao')}
                        placeholder="Resolução"
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={resolver.isPending}
                      >
                        Resolver
                      </Button>
                    </>
                  )}
                </FormShell>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CardVotacao({ votacaoInicial }: { votacaoInicial: Votacao }) {
  const { data: me } = useMe()
  const podeGerir = me?.permissoes.includes('governanca') ?? false
  const queryClient = useQueryClient()

  const { data: votacao } = useQuery({
    queryKey: ['votacao', votacaoInicial.id_votacao],
    queryFn: () => obterVotacao(votacaoInicial.id_votacao),
    initialData: votacaoInicial,
    refetchInterval: (query) =>
      query.state.data?.status === 'Aberta' ? 5000 : false,
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['votacao', votacaoInicial.id_votacao],
    })
    queryClient.invalidateQueries({
      queryKey: ['votacoes-item', votacao.id_item_pauta],
    })
  }

  const votarMutation = useMutation({
    mutationFn: (v: z.infer<typeof votoSchema>) =>
      votar(votacao.id_votacao, v.opcao),
    onSuccess: invalidar,
  })
  const encerrar = useMutation({
    mutationFn: () => encerrarVotacao(votacao.id_votacao),
    onSuccess: invalidar,
  })
  const resolverEmpate = useMutation({
    mutationFn: (v: z.infer<typeof resolverEmpateSchema>) =>
      resolverEmpateVotacao(votacao.id_votacao, v),
    onSuccess: invalidar,
  })

  const todasOpcoes = [...votacao.opcoes_validas, ...OPCOES_RESERVADAS]
  const aberta = votacao.status === 'Aberta'

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{votacao.titulo}</p>
          <p className="text-xs text-muted-foreground">
            {votacao.tipo} · {votacao.escrutinio}
            {votacao.fracao_qualificada
              ? ` (${votacao.fracao_qualificada})`
              : ''}
          </p>
        </div>
        <span
          className={`shrink-0 text-sm font-medium ${
            aberta ? 'text-amber-600' : 'text-green-600'
          }`}
        >
          {votacao.status}
        </span>
      </div>

      {aberta ? (
        <>
          <FormShell<z.infer<typeof votoSchema>>
            schema={votoSchema}
            defaultValues={{ opcao: '' }}
            onSubmit={(v) => votarMutation.mutateAsync(v)}
            className="mt-3 flex flex-wrap items-end gap-2"
          >
            {(form) => (
              <>
                <select
                  {...form.register('opcao')}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Escolha sua opção…</option>
                  {todasOpcoes.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  size="sm"
                  disabled={votarMutation.isPending}
                >
                  {votarMutation.isPending ? 'Votando…' : 'Votar'}
                </Button>
              </>
            )}
          </FormShell>
          {votarMutation.isError && (
            <p className="mt-1 text-sm text-destructive">
              {(votarMutation.error as Error).message}
            </p>
          )}
          {podeGerir && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={encerrar.isPending}
              onClick={() => encerrar.mutate()}
            >
              {encerrar.isPending ? 'Apurando…' : 'Apurar e encerrar votação'}
            </Button>
          )}
        </>
      ) : (
        <div className="mt-3 space-y-1 text-sm">
          {votacao.resultado_contagem &&
            Object.entries(votacao.resultado_contagem).map(([opcao, qtd]) => (
              <div key={opcao} className="flex justify-between">
                <span>{opcao}</span>
                <span className="font-medium">{qtd}</span>
              </div>
            ))}
          <p className="pt-1">
            {votacao.empate ? (
              <span className="font-medium text-amber-600">
                Empate — aguardando resolução.
              </span>
            ) : (
              <>
                Vencedor: <strong>{votacao.vencedor ?? '—'}</strong> ·{' '}
                {votacao.aprovado ? 'Aprovada' : 'Reprovada'}
              </>
            )}
          </p>
          {votacao.resultado_hash && (
            <p className="break-all text-xs text-muted-foreground">
              Hash de integridade: {votacao.resultado_hash}
            </p>
          )}
        </div>
      )}

      {votacao.empate && podeGerir && (
        <FormShell<z.infer<typeof resolverEmpateSchema>>
          schema={resolverEmpateSchema}
          defaultValues={{ vencedor: '', justificativa: '' }}
          onSubmit={(v) => resolverEmpate.mutateAsync(v)}
          className="mt-3 space-y-2 border-t border-border pt-3"
        >
          {(form) => (
            <>
              <select
                {...form.register('vencedor')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Escolha o vencedor do desempate…</option>
                {votacao.opcoes_validas.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <input
                {...form.register('justificativa')}
                placeholder="Justificativa"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.justificativa?.message}
              />
              <Button
                type="submit"
                size="sm"
                disabled={resolverEmpate.isPending}
              >
                Resolver empate
              </Button>
            </>
          )}
        </FormShell>
      )}

      <BlocoImpugnacoes idVotacao={votacao.id_votacao} />
    </div>
  )
}

function BlocoVotacoesDoItem({
  idItem,
  podeAbrir,
}: {
  idItem: number
  podeAbrir: boolean
}) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: votacoes } = useQuery({
    queryKey: ['votacoes-item', idItem],
    queryFn: () => listarVotacoesDoItem(idItem),
  })

  const abrir = useMutation({
    mutationFn: (v: z.infer<typeof votacaoAbrirSchema>) =>
      criarVotacao(idItem, {
        ...v,
        opcoes: v.opcoes
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
        fracao_qualificada: v.fracao_qualificada || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['votacoes-item', idItem] })
      setMostrarForm(false)
    },
  })

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      {(votacoes ?? []).map((v) => (
        <CardVotacao key={v.id_votacao} votacaoInicial={v} />
      ))}

      {podeAbrir && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Abrir votação'}
          </Button>
          {mostrarForm && (
            <FormShell<z.infer<typeof votacaoAbrirSchema>>
              schema={votacaoAbrirSchema}
              defaultValues={{
                titulo: '',
                tipo: 'Aberta/Nominal',
                escrutinio: 'Maioria simples',
                opcoes: '',
                fracao_qualificada: '',
              }}
              onSubmit={(v) => abrir.mutateAsync(v)}
              className="space-y-2 rounded-md border border-border p-3"
            >
              {(form) => (
                <>
                  <div>
                    <label className="text-sm font-medium">Título</label>
                    <input
                      {...form.register('titulo')}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <ErroCampo
                      mensagem={form.formState.errors.titulo?.message}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium">Tipo</label>
                      <select
                        {...form.register('tipo')}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="Aberta/Nominal">Aberta/Nominal</option>
                        <option value="Secreta">Secreta</option>
                        <option value="Aclamação">Aclamação</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Escrutínio</label>
                      <select
                        {...form.register('escrutinio')}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="Maioria simples">Maioria simples</option>
                        <option value="Maioria absoluta">
                          Maioria absoluta
                        </option>
                        <option value="Qualificada">Qualificada</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Opções (separadas por vírgula)
                    </label>
                    <input
                      {...form.register('opcoes')}
                      placeholder="Sim, Não"
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <ErroCampo
                      mensagem={form.formState.errors.opcoes?.message}
                    />
                  </div>
                  {form.watch('escrutinio') === 'Qualificada' && (
                    <div>
                      <label className="text-sm font-medium">
                        Fração qualificada
                      </label>
                      <input
                        {...form.register('fracao_qualificada')}
                        placeholder="2/3"
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      />
                    </div>
                  )}
                  <Button type="submit" size="sm" disabled={abrir.isPending}>
                    {abrir.isPending ? 'Abrindo…' : 'Abrir votação'}
                  </Button>
                  {abrir.isError && (
                    <p className="text-sm text-destructive">
                      {(abrir.error as Error).message}
                    </p>
                  )}
                </>
              )}
            </FormShell>
          )}
        </>
      )}
    </div>
  )
}

function LinhaItemPauta({
  idAssembleia,
  item,
}: {
  idAssembleia: number
  item: ItemPauta
}) {
  const queryClient = useQueryClient()
  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['itens-pauta', idAssembleia] })
  }
  const abrirDiscussao = useMutation({
    mutationFn: () => abrirDiscussaoItem(idAssembleia, item.id_item),
    onSuccess: invalidar,
  })
  const abrirVotacao = useMutation({
    mutationFn: () => abrirVotacaoItem(idAssembleia, item.id_item),
    onSuccess: invalidar,
  })
  const encerrar = useMutation({
    mutationFn: () => encerrarItemPauta(idAssembleia, item.id_item),
    onSuccess: invalidar,
  })

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{item.titulo}</p>
          {item.descricao && (
            <p className="text-sm text-muted-foreground">{item.descricao}</p>
          )}
        </div>
        <span
          className={`shrink-0 text-sm font-medium ${CORES_STATUS_ITEM[item.status] ?? ''}`}
        >
          {item.status}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        {item.status === 'Aguardando' && (
          <Button
            variant="outline"
            size="sm"
            disabled={abrirDiscussao.isPending}
            onClick={() => abrirDiscussao.mutate()}
          >
            Abrir discussão
          </Button>
        )}
        {(item.status === 'Aguardando' || item.status === 'Em discussão') && (
          <Button
            variant="outline"
            size="sm"
            disabled={abrirVotacao.isPending}
            onClick={() => abrirVotacao.mutate()}
          >
            Abrir votação
          </Button>
        )}
        {item.status !== 'Encerrado' && (
          <Button
            variant="outline"
            size="sm"
            disabled={encerrar.isPending}
            onClick={() => encerrar.mutate()}
          >
            Encerrar item
          </Button>
        )}
      </div>

      <BlocoVotacoesDoItem
        idItem={item.id_item}
        podeAbrir={item.status === 'Em votação'}
      />
    </div>
  )
}

function BlocoPauta({ idAssembleia }: { idAssembleia: number }) {
  const queryClient = useQueryClient()
  const { data: itens } = useQuery({
    queryKey: ['itens-pauta', idAssembleia],
    queryFn: () => listarItensPauta(idAssembleia),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof itemPautaCriarSchema>) =>
      criarItemPauta(idAssembleia, {
        ...v,
        tempo_fala_minutos: v.tempo_fala_minutos || undefined,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['itens-pauta', idAssembleia],
      }),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Itens de pauta</h2>

      <FormShell<z.infer<typeof itemPautaCriarSchema>>
        schema={itemPautaCriarSchema}
        defaultValues={{ titulo: '', descricao: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        {(form) => (
          <>
            <div className="min-w-[14rem] flex-1">
              <label className="text-sm font-medium">Título</label>
              <input
                {...form.register('titulo')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.titulo?.message} />
            </div>
            <div className="w-32">
              <label className="text-sm font-medium">Tempo (min)</label>
              <input
                type="number"
                {...form.register('tempo_fala_minutos')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Adicionando…' : 'Adicionar item'}
            </Button>
          </>
        )}
      </FormShell>

      <div className="space-y-2">
        {(itens ?? []).map((item) => (
          <LinhaItemPauta
            key={item.id_item}
            idAssembleia={idAssembleia}
            item={item}
          />
        ))}
      </div>
    </section>
  )
}

function BlocoOcorrencias({ idAssembleia }: { idAssembleia: number }) {
  const queryClient = useQueryClient()
  const { data: ocorrencias } = useQuery({
    queryKey: ['ocorrencias', idAssembleia],
    queryFn: () => listarOcorrencias(idAssembleia),
  })

  const registrar = useMutation({
    mutationFn: (v: z.infer<typeof ocorrenciaCriarSchema>) =>
      registrarOcorrencia(idAssembleia, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['ocorrencias', idAssembleia],
      }),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Ocorrências</h2>

      <FormShell<z.infer<typeof ocorrenciaCriarSchema>>
        schema={ocorrenciaCriarSchema}
        defaultValues={{ descricao: '' }}
        onSubmit={(v) => registrar.mutateAsync(v)}
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        {(form) => (
          <>
            <div className="min-w-[16rem] flex-1">
              <label className="text-sm font-medium">Descrição</label>
              <input
                {...form.register('descricao')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.descricao?.message} />
            </div>
            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending ? 'Registrando…' : 'Registrar ocorrência'}
            </Button>
          </>
        )}
      </FormShell>

      <div className="space-y-1">
        {(ocorrencias ?? []).map((o) => (
          <div
            key={o.id_ocorrencia}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="text-muted-foreground">
              {formatarData(o.criado_em, { comHora: true })} ·{' '}
            </span>
            {o.descricao}
          </div>
        ))}
      </div>
    </section>
  )
}

// v2.5.2 (FASE 2.5 - Painel) - painel da sessão em andamento (Art. 6º/9º): credenciamento com
// quórum em tempo real, pauta item a item e ocorrências. Só faz sentido com a assembleia "Em
// andamento" (o backend já recusa qualquer escrita fora disso - ver
// app/routers/sessao_assembleia.py) - se o status for outro, a tela mostra só o aviso.
export function SessaoAssembleiaPage() {
  const { id } = useParams<{ id: string }>()
  const idAssembleia = Number(id)

  const { data: assembleia, isLoading } = useQuery({
    queryKey: ['assembleia', idAssembleia],
    queryFn: () => obterAssembleia(idAssembleia),
  })

  if (isLoading || !assembleia) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  return (
    <>
      <PageHeader
        titulo={`Sessão — Assembleia ${assembleia.tipo}`}
        descricao="Credenciamento, quórum, pauta, votação e ocorrências."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          {
            rotulo: `Assembleia ${assembleia.tipo}`,
            href: `/governanca/${idAssembleia}`,
          },
          { rotulo: 'Sessão' },
        ]}
      />

      {assembleia.status === 'Em andamento' && (
        <div className="space-y-6">
          <BlocoCredenciamento
            idAssembleia={idAssembleia}
            statusAssembleia={assembleia.status}
          />
          <BlocoPauta idAssembleia={idAssembleia} />
          <BlocoOcorrencias idAssembleia={idAssembleia} />
        </div>
      )}

      {assembleia.status === 'Realizada' && (
        // Sessão já encerrada: pauta/votação/ocorrências ficam travadas (regra do backend,
        // v2.3) - só a correção de presença continua disponível, pro secretário lançar quem
        // não conseguiu se autochamar por falha do app (achado do usuário 2026-09-15).
        <BlocoCredenciamento
          idAssembleia={idAssembleia}
          statusAssembleia={assembleia.status}
        />
      )}

      {assembleia.status !== 'Em andamento' &&
        assembleia.status !== 'Realizada' && (
          <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Esta assembleia está &quot;{assembleia.status}&quot; — a condução da
            sessão só vale a partir de &quot;Em andamento&quot;.
          </p>
        )}
    </>
  )
}
