import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  alternarCampanhaDescontoAntecipado,
  criarCampanhaDescontoAntecipado,
  criarIsencaoContribuicao,
  criarPlanoContribuicao,
  listarAssociados,
  listarCampanhasDescontoAntecipado,
  listarIsencoesContribuicao,
  listarOpcoesCatalogo,
  listarPlanoContas,
  listarPlanosContribuicao,
  reajustarPlanoContribuicao,
} from '@/lib/api'
import {
  campanhaDescontoAntecipadoCriarSchema,
  isencaoContribuicaoCriarSchema,
  planoContribuicaoCriarSchema,
  reajustePlanoContribuicaoSchema,
} from '@/lib/schemas'

// v3.2 (FASE 3 - Financeiro) - Planos de Contribuição (mensalidade por categoria), reajuste
// versionado (o valor anterior nunca é apagado, só encerrado - histórico completo) e isenções.
// "Cobrança" propriamente dita nasce em `/financeiro/gerar-cobrancas` (tela separada).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioPlano({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: periodicidades } = useQuery({
    queryKey: ['opcoes-catalogo', 'periodicidade_contribuicao'],
    queryFn: () => listarOpcoesCatalogo('periodicidade_contribuicao'),
  })
  const contasReceita = (contas ?? []).filter(
    (c) => c.tipo === 'Receita' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof planoContribuicaoCriarSchema>) =>
      criarPlanoContribuicao(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planos-contribuicao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof planoContribuicaoCriarSchema>>
      schema={planoContribuicaoCriarSchema}
      defaultValues={{
        categoria: '',
        descricao: '',
        periodicidade: 'Mensal',
        dia_vencimento: 10,
        cobranca_por_nucleo_familiar: false,
        id_conta_contabil: 0,
        valor_inicial: 0,
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              {...form.register('categoria')}
              placeholder="Categoria (ex.: Efetivo)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.categoria?.message} />
          </div>
          <div>
            <input
              {...form.register('descricao')}
              placeholder="Descrição"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.descricao?.message} />
          </div>
          <div>
            <select
              {...form.register('periodicidade')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {(periodicidades ?? []).map((p) => (
                <option key={p.id_opcao} value={p.rotulo}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              type="number"
              {...form.register('dia_vencimento')}
              placeholder="Dia de vencimento"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.dia_vencimento?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_conta_contabil')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta contábil (Receita)…</option>
              {contasReceita.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_conta_contabil?.message}
            />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor_inicial')}
              placeholder="Valor inicial"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.valor_inicial?.message}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              {...form.register('cobranca_por_nucleo_familiar')}
            />
            Cobrança por família (dependente cadastrado não recebe cobrança
            própria)
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar'}
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
            <p className="text-sm text-destructive sm:col-span-3">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

function FormularioReajuste({
  idPlano,
  onCancelar,
}: {
  idPlano: number
  onCancelar: () => void
}) {
  const queryClient = useQueryClient()
  const reajustar = useMutation({
    mutationFn: (v: z.infer<typeof reajustePlanoContribuicaoSchema>) =>
      reajustarPlanoContribuicao(idPlano, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planos-contribuicao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof reajustePlanoContribuicaoSchema>>
      schema={reajustePlanoContribuicaoSchema}
      defaultValues={{ valor: 0, data_vigencia_inicio: '', motivo: '' }}
      onSubmit={(v) => reajustar.mutateAsync(v)}
      className="mt-2 grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('valor')}
              placeholder="Novo valor"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor?.message} />
          </div>
          <div>
            <input
              type="date"
              {...form.register('data_vigencia_inicio')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.data_vigencia_inicio?.message}
            />
          </div>
          <div>
            <input
              {...form.register('motivo')}
              placeholder="Motivo do reajuste"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.motivo?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={reajustar.isPending}>
              {reajustar.isPending ? 'Salvando…' : 'Confirmar reajuste'}
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
          {reajustar.isError && (
            <p className="text-sm text-destructive sm:col-span-3">
              {(reajustar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

function FormularioIsencao({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: planos } = useQuery({
    queryKey: ['planos-contribuicao'],
    queryFn: listarPlanosContribuicao,
  })
  const { data: motivos } = useQuery({
    queryKey: ['opcoes-catalogo', 'motivo_isencao_contribuicao'],
    queryFn: () => listarOpcoesCatalogo('motivo_isencao_contribuicao'),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof isencaoContribuicaoCriarSchema>) =>
      criarIsencaoContribuicao(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['isencoes-contribuicao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof isencaoContribuicaoCriarSchema>>
      schema={isencaoContribuicaoCriarSchema}
      defaultValues={{
        id_associado: 0,
        id_plano: undefined,
        motivo: '',
        percentual_desconto: 100,
        data_fim: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_associado')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Selecione o associado…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.id_associado?.message} />
          </div>
          <div>
            <select
              {...form.register('id_plano')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos os planos do associado</option>
              {(planos ?? []).map((p) => (
                <option key={p.id_plano} value={p.id_plano}>
                  {p.descricao}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              {...form.register('motivo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione o motivo…</option>
              {(motivos ?? []).map((m) => (
                <option key={m.id_opcao} value={m.codigo}>
                  {m.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.motivo?.message} />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('percentual_desconto')}
              placeholder="% de desconto (100 = isenção total)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.percentual_desconto?.message}
            />
          </div>
          <div>
            <input
              type="date"
              {...form.register('data_fim')}
              title="Data de fim (opcional - vazia = por prazo indeterminado)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar isenção'}
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
            <p className="text-sm text-destructive sm:col-span-3">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

// v3.2.3 - Campanha de Desconto por Pagamento Antecipado em Bloco (semestral/anual), decisão de
// assembleia: percentual, quantidade de meses do bloco e meses-gatilho totalmente configuráveis,
// versionada como reajuste - cadastrar uma nova NUNCA edita a anterior, só encerra a vigência
// dela (título-bloco já gerado guarda a referência congelada, então mudar aqui nunca afeta quem
// já pagou).
function FormularioCampanha({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const contasPassivo = (contas ?? []).filter(
    (c) => c.tipo === 'Passivo' && !c.sintetica,
  )

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof campanhaDescontoAntecipadoCriarSchema>) =>
      criarCampanhaDescontoAntecipado({
        ...v,
        meses_gatilho: v.meses_gatilho
          .split(',')
          .map((m) => Number(m.trim()))
          .filter((m) => !Number.isNaN(m)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['campanhas-desconto-antecipado'],
      })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof campanhaDescontoAntecipadoCriarSchema>>
      schema={campanhaDescontoAntecipadoCriarSchema}
      defaultValues={{
        percentual_desconto: 0,
        quantidade_meses: 6,
        meses_gatilho: '',
        id_conta_contabil_receita_diferida: 0,
        motivo: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('percentual_desconto')}
              placeholder="% de desconto"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.percentual_desconto?.message}
            />
          </div>
          <div>
            <input
              type="number"
              {...form.register('quantidade_meses')}
              placeholder="Meses do bloco (ex.: 6)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.quantidade_meses?.message}
            />
          </div>
          <div>
            <input
              {...form.register('meses_gatilho')}
              placeholder="Meses-gatilho (ex.: 1,7)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.meses_gatilho?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_conta_contabil_receita_diferida')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Conta de receita diferida (Passivo)…</option>
              {contasPassivo.map((c) => (
                <option key={c.id_conta} value={c.id_conta}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={
                form.formState.errors.id_conta_contabil_receita_diferida
                  ?.message
              }
            />
          </div>
          <div className="sm:col-span-2">
            <input
              {...form.register('motivo')}
              placeholder="Motivo (ex.: Ata da assembleia de 2026-09-17)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar campanha'}
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
            <p className="text-sm text-destructive sm:col-span-3">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

export function PlanosContribuicaoPage() {
  const [mostrarFormPlano, setMostrarFormPlano] = useState(false)
  const [mostrarFormIsencao, setMostrarFormIsencao] = useState(false)
  const [mostrarFormCampanha, setMostrarFormCampanha] = useState(false)
  const [reajustando, setReajustando] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const { data: planos } = useQuery({
    queryKey: ['planos-contribuicao'],
    queryFn: listarPlanosContribuicao,
  })
  const { data: isencoes } = useQuery({
    queryKey: ['isencoes-contribuicao'],
    queryFn: () => listarIsencoesContribuicao(),
  })
  const { data: campanhas } = useQuery({
    queryKey: ['campanhas-desconto-antecipado'],
    queryFn: listarCampanhasDescontoAntecipado,
  })

  const alternarCampanha = useMutation({
    mutationFn: ({ id, ativo }: { id: number; ativo: boolean }) =>
      alternarCampanhaDescontoAntecipado(id, ativo),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['campanhas-desconto-antecipado'],
      }),
  })

  return (
    <>
      <PageHeader
        titulo="Planos de Contribuição"
        descricao="Mensalidade por categoria de associado, reajuste versionado e isenções."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Planos de Contribuição' },
        ]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Planos cadastrados</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarFormPlano((v) => !v)}
          >
            {mostrarFormPlano ? 'Cancelar' : 'Novo plano'}
          </Button>
        </div>

        {mostrarFormPlano && (
          <FormularioPlano onCancelar={() => setMostrarFormPlano(false)} />
        )}

        <div className="space-y-2">
          {(planos ?? []).map((p) => (
            <div
              key={p.id_plano}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {p.categoria} — {p.descricao}
                </p>
                <p className="font-medium">
                  {p.valor_vigente != null
                    ? formatarReais(p.valor_vigente)
                    : 'sem valor vigente'}
                </p>
              </div>
              <p className="text-muted-foreground">
                {p.periodicidade} · vencimento dia {p.dia_vencimento}
                {p.cobranca_por_nucleo_familiar && ' · cobrança por família'}
                {!p.ativo && ' · inativo'}
              </p>
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setReajustando((v) =>
                      v === p.id_plano ? null : p.id_plano,
                    )
                  }
                >
                  {reajustando === p.id_plano ? 'Cancelar' : 'Reajustar'}
                </Button>
                {reajustando === p.id_plano && (
                  <FormularioReajuste
                    idPlano={p.id_plano}
                    onCancelar={() => setReajustando(null)}
                  />
                )}
              </div>
            </div>
          ))}
          {(planos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum plano de contribuição cadastrado.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Isenções</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarFormIsencao((v) => !v)}
          >
            {mostrarFormIsencao ? 'Cancelar' : 'Nova isenção'}
          </Button>
        </div>

        {mostrarFormIsencao && (
          <FormularioIsencao onCancelar={() => setMostrarFormIsencao(false)} />
        )}

        <div className="space-y-2">
          {(isencoes ?? []).map((i) => (
            <div
              key={i.id_isencao}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium">
                Associado #{i.id_associado} — {i.percentual_desconto}% de
                desconto
              </p>
              <p className="text-muted-foreground">
                {i.motivo} · desde {i.data_inicio}
                {i.data_fim ? ` até ${i.data_fim}` : ' · sem data de fim'}
              </p>
            </div>
          ))}
          {(isencoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma isenção cadastrada.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">
              Campanha de Desconto por Pagamento Antecipado
            </h2>
            <p className="text-sm text-muted-foreground">
              Bloco de meses (semestral, anual…) pago de uma vez, com desconto —
              decisão de assembleia, totalmente configurável.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarFormCampanha((v) => !v)}
          >
            {mostrarFormCampanha ? 'Cancelar' : 'Nova vigência'}
          </Button>
        </div>

        {mostrarFormCampanha && (
          <FormularioCampanha
            onCancelar={() => setMostrarFormCampanha(false)}
          />
        )}

        <div className="space-y-2">
          {(campanhas ?? []).map((c) => (
            <div
              key={c.id_campanha}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {c.percentual_desconto}% de desconto — bloco de{' '}
                  {c.quantidade_meses} meses
                </p>
                <span
                  className={
                    c.ativo && !c.data_vigencia_fim
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {!c.data_vigencia_fim
                    ? c.ativo
                      ? 'Vigente'
                      : 'Vigente (inativa)'
                    : 'Encerrada'}
                </span>
              </div>
              <p className="text-muted-foreground">
                Meses-gatilho: {c.meses_gatilho.join(', ')} · desde{' '}
                {c.data_vigencia_inicio}
                {c.data_vigencia_fim && ` até ${c.data_vigencia_fim}`}
              </p>
              {c.motivo && <p className="text-muted-foreground">{c.motivo}</p>}
              {!c.data_vigencia_fim && (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alternarCampanha.isPending}
                    onClick={() =>
                      alternarCampanha.mutate({
                        id: c.id_campanha,
                        ativo: !c.ativo,
                      })
                    }
                  >
                    {c.ativo ? 'Inativar' : 'Reativar'}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {(campanhas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha cadastrada.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
