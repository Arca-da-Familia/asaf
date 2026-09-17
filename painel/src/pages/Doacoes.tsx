import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  alternarCampanhaArrecadacao,
  criarCampanhaArrecadacao,
  listarCampanhasArrecadacao,
  listarCentrosCusto,
  listarDoacoes,
  listarPlanoContas,
  obterReciboDoacao,
  registrarDoacao,
} from '@/lib/api'
import {
  campanhaArrecadacaoCriarSchema,
  doacaoCriarSchema,
} from '@/lib/schemas'

// v3.4 (FASE 3 - Financeiro) - doações, captação e recibos. Doação monetária vira título +
// lançamento contábil de verdade (nunca um número solto) e um recibo numerado, emitido
// automaticamente no registro. Destinação específica só pode ser gasta ali (ver Centros de
// Custo › destinação restrita). Publicação de campanha no site institucional é a FASE 5, ainda
// não existe — por ora só a gestão administrativa.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioCampanha({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof campanhaArrecadacaoCriarSchema>) =>
      criarCampanhaArrecadacao(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campanhas-arrecadacao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof campanhaArrecadacaoCriarSchema>>
      schema={campanhaArrecadacaoCriarSchema}
      defaultValues={{ titulo: '', descricao: '', meta_valor: 0, prazo: '' }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div className="sm:col-span-2">
            <input
              {...form.register('titulo')}
              placeholder="Título da campanha"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.titulo?.message} />
          </div>
          <div>
            <input
              type="number"
              step="0.01"
              {...form.register('meta_valor')}
              placeholder="Meta (R$)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.meta_valor?.message} />
          </div>
          <div>
            <input
              type="date"
              {...form.register('prazo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <select
              {...form.register('id_centro_custo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem centro de custo vinculado</option>
              {(centros ?? []).map((c) => (
                <option key={c.id_centro_custo} value={c.id_centro_custo}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <textarea
              {...form.register('descricao')}
              placeholder="Descrição (opcional)"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Criar campanha'}
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

function FormularioDoacao({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const { data: campanhas } = useQuery({
    queryKey: ['campanhas-arrecadacao'],
    queryFn: listarCampanhasArrecadacao,
  })
  const contasReceita = (contas ?? []).filter(
    (c) => c.tipo === 'Receita' && !c.sintetica,
  )
  const contasCaixa = (contas ?? []).filter(
    (c) => c.tipo === 'Ativo' && !c.sintetica,
  )
  const [numeroRecibo, setNumeroRecibo] = useState<number | null>(null)

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof doacaoCriarSchema>) => registrarDoacao(v),
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: ['doacoes'] })
      queryClient.invalidateQueries({ queryKey: ['campanhas-arrecadacao'] })
      setNumeroRecibo(resultado.numero_recibo)
    },
  })

  return (
    <FormShell<z.infer<typeof doacaoCriarSchema>>
      schema={doacaoCriarSchema}
      defaultValues={{
        anonima: false,
        nome_doador: '',
        documento_doador: '',
        tipo_doacao: 'Monetaria',
        recorrente: false,
        valor: 0,
        descricao_bem: '',
        id_conta_contabil: 0,
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => {
        const anonima = form.watch('anonima')
        const tipoDoacao = form.watch('tipo_doacao')
        return (
          <>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" {...form.register('anonima')} />
              Doação anônima
            </label>
            {!anonima && (
              <>
                <div>
                  <input
                    {...form.register('nome_doador')}
                    placeholder="Nome do doador"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <input
                    {...form.register('documento_doador')}
                    placeholder="CPF/CNPJ do doador (opcional)"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </>
            )}
            <div>
              <select
                {...form.register('tipo_doacao')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Monetaria">Monetária</option>
                <option value="Bens">Em bens</option>
              </select>
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                {...form.register('valor')}
                placeholder={tipoDoacao === 'Bens' ? 'Valor avaliado' : 'Valor'}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.valor?.message} />
            </div>
            {tipoDoacao === 'Bens' && (
              <div className="sm:col-span-2">
                <input
                  {...form.register('descricao_bem')}
                  placeholder="Descrição do bem doado"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
            )}
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
            {tipoDoacao === 'Monetaria' && (
              <div>
                <select
                  {...form.register('id_conta_contabil_caixa')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Conta de caixa/banco que recebeu…</option>
                  {contasCaixa.map((c) => (
                    <option key={c.id_conta} value={c.id_conta}>
                      {c.codigo_contabil} — {c.descricao_conta}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <select
                {...form.register('id_campanha')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sem campanha vinculada</option>
                {(campanhas ?? []).map((c) => (
                  <option key={c.id_campanha} value={c.id_campanha}>
                    {c.titulo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <select
                {...form.register('id_centro_custo_destinacao')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sem destinação específica</option>
                {(centros ?? []).map((c) => (
                  <option key={c.id_centro_custo} value={c.id_centro_custo}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" {...form.register('recorrente')} />
              Doação recorrente
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={criar.isPending}>
                {criar.isPending ? 'Salvando…' : 'Registrar doação'}
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
            {numeroRecibo != null && (
              <p className="text-sm text-green-600 sm:col-span-2">
                Doação registrada — recibo nº {numeroRecibo}.
              </p>
            )}
          </>
        )
      }}
    </FormShell>
  )
}

function BotaoRecibo({ idDoacao }: { idDoacao: number }) {
  const [texto, setTexto] = useState<string | null>(null)
  const recibo = useMutation({
    mutationFn: () => obterReciboDoacao(idDoacao),
    onSuccess: (resultado) => setTexto(resultado.texto),
  })
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={recibo.isPending}
        onClick={() => recibo.mutate()}
      >
        Ver recibo
      </Button>
      {texto && (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-xs">
          {texto}
        </pre>
      )}
    </div>
  )
}

export function DoacoesPage() {
  const [mostrarFormCampanha, setMostrarFormCampanha] = useState(false)
  const [mostrarFormDoacao, setMostrarFormDoacao] = useState(false)
  const queryClient = useQueryClient()

  const { data: campanhas } = useQuery({
    queryKey: ['campanhas-arrecadacao'],
    queryFn: listarCampanhasArrecadacao,
  })
  const { data: doacoes } = useQuery({
    queryKey: ['doacoes'],
    queryFn: () => listarDoacoes(),
  })

  const alternarCampanha = useMutation({
    mutationFn: ({ id, ativa }: { id: number; ativa: boolean }) =>
      alternarCampanhaArrecadacao(id, ativa),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['campanhas-arrecadacao'] }),
  })

  return (
    <>
      <PageHeader
        titulo="Doações"
        descricao="Doações, captação e recibos — doação monetária vira título/lançamento de verdade, recibo numerado emitido automaticamente."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Doações' },
        ]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Campanhas de arrecadação</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarFormCampanha((v) => !v)}
          >
            {mostrarFormCampanha ? 'Cancelar' : 'Nova campanha'}
          </Button>
        </div>
        {mostrarFormCampanha && (
          <FormularioCampanha
            onCancelar={() => setMostrarFormCampanha(false)}
          />
        )}
        <div className="space-y-2">
          {(campanhas ?? []).map((c) => {
            const progresso = Math.min(
              100,
              (c.valor_arrecadado / c.meta_valor) * 100,
            )
            return (
              <div
                key={c.id_campanha}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">{c.titulo}</p>
                  <span
                    className={
                      c.ativa ? 'text-green-600' : 'text-muted-foreground'
                    }
                  >
                    {c.ativa ? 'Ativa' : 'Encerrada'}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  {formatarReais(c.valor_arrecadado)} de{' '}
                  {formatarReais(c.meta_valor)} ({progresso.toFixed(0)}%)
                </p>
                <div className="mt-1 h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${progresso}%` }}
                  />
                </div>
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alternarCampanha.isPending}
                    onClick={() =>
                      alternarCampanha.mutate({
                        id: c.id_campanha,
                        ativa: !c.ativa,
                      })
                    }
                  >
                    {c.ativa ? 'Encerrar' : 'Reativar'}
                  </Button>
                </div>
              </div>
            )
          })}
          {(campanhas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha cadastrada.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Doações registradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarFormDoacao((v) => !v)}
          >
            {mostrarFormDoacao ? 'Cancelar' : 'Registrar doação'}
          </Button>
        </div>
        {mostrarFormDoacao && (
          <FormularioDoacao onCancelar={() => setMostrarFormDoacao(false)} />
        )}
        <div className="space-y-2">
          {(doacoes ?? []).map((d) => (
            <div
              key={d.id_doacao}
              className="rounded-md border border-border p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {d.anonima ? 'Doador anônimo' : d.nome_doador} —{' '}
                  {formatarReais(d.valor)}
                </p>
                {d.numero_recibo && (
                  <span className="text-muted-foreground">
                    recibo nº {d.numero_recibo}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                {d.tipo_doacao === 'Bens'
                  ? `Em bens — ${d.descricao_bem}`
                  : 'Monetária'}
                {d.recorrente && ' · recorrente'}
                {d.data_doacao && ` · ${d.data_doacao}`}
              </p>
              <div className="mt-2">
                <BotaoRecibo idDoacao={d.id_doacao} />
              </div>
            </div>
          ))}
          {(doacoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma doação registrada.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
