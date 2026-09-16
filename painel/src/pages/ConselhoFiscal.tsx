import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarQuestionamento,
  emitirParecer,
  listarCaixaConselhoFiscal,
  listarPareceres,
  listarQuestionamentos,
  listarRespostas,
  listarTitulosConselhoFiscal,
  responderQuestionamento,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  parecerCriarSchema,
  questionamentoCriarSchema,
  respostaQuestionamentoSchema,
} from '@/lib/schemas'

// `valor_original`/`saldo_devedor`/`valor` chegam em reais (não centavos - ver o comentário em
// lib/api.ts::TituloFinanceiroCF), então formata direto, sem o formatarMoeda(centavos) da datas.ts.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// v2.5.5 (FASE 2.5 - Painel) - Conselho Fiscal com poder real (backend v2.6): leitura
// irrestrita do financeiro (auditada a cada consulta pelo próprio backend, nunca aqui), parecer
// sobre prestação de contas e fila de questionamentos sobre lançamento. Vive dentro do módulo
// Financeiro (permissão `financeiro`), NUNCA dentro de Governança - o nível "Conselho Fiscal"
// (v0.1.5) só tem `financeiro`/`auditoria`, nunca `governanca`; colocar esta tela atrás da
// permissão errada a deixaria invisível pra quem mais precisa dela. Emitir parecer/questionar
// exige além disso `NivelAcesso.is_conselho_fiscal` - o backend checa isso (`_exigir_conselho_
// fiscal`), o painel não tenta adivinhar (não existe esse campo em `/auth/me`) e só mostra a
// mensagem de erro real (403) se alguém sem essa marca tentar.
function BlocoQuestionamentos({ idTitulo }: { idTitulo: number }) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: questionamentos } = useQuery({
    queryKey: ['questionamentos', idTitulo],
    queryFn: () => listarQuestionamentos(idTitulo),
  })

  const perguntar = useMutation({
    mutationFn: (v: z.infer<typeof questionamentoCriarSchema>) =>
      criarQuestionamento(idTitulo, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questionamentos', idTitulo] })
      setMostrarForm(false)
    },
  })

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Questionamentos ({(questionamentos ?? []).length})
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Questionar'}
        </Button>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof questionamentoCriarSchema>>
          schema={questionamentoCriarSchema}
          defaultValues={{ pergunta: '' }}
          onSubmit={(v) => perguntar.mutateAsync(v)}
          className="mt-2 space-y-2"
        >
          {(form) => (
            <>
              <input
                {...form.register('pergunta')}
                placeholder="O que você quer questionar sobre este lançamento?"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.pergunta?.message} />
              <Button type="submit" size="sm" disabled={perguntar.isPending}>
                {perguntar.isPending ? 'Enviando…' : 'Enviar questionamento'}
              </Button>
              {perguntar.isError && (
                <p className="text-sm text-destructive">
                  {(perguntar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="mt-2 space-y-2">
        {(questionamentos ?? []).map((q) => (
          <BlocoRespostas key={q.id_questionamento} questionamento={q} />
        ))}
      </div>
    </div>
  )
}

function BlocoRespostas({
  questionamento,
}: {
  questionamento: { id_questionamento: number; pergunta: string; status: string }
}) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: respostas } = useQuery({
    queryKey: ['respostas', questionamento.id_questionamento],
    queryFn: () => listarRespostas(questionamento.id_questionamento),
  })

  const responder = useMutation({
    mutationFn: (v: z.infer<typeof respostaQuestionamentoSchema>) =>
      responderQuestionamento(questionamento.id_questionamento, v),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['respostas', questionamento.id_questionamento],
      })
      queryClient.invalidateQueries({ queryKey: ['questionamentos'] })
      setMostrarForm(false)
    },
  })

  return (
    <div className="rounded-md border border-border bg-muted/20 p-2 text-xs">
      <div className="flex items-center justify-between">
        <p className="font-medium">{questionamento.pergunta}</p>
        <span
          className={
            questionamento.status === 'Respondido'
              ? 'text-green-600'
              : 'text-amber-600'
          }
        >
          {questionamento.status}
        </span>
      </div>
      {(respostas ?? []).map((r) => (
        <p key={r.id_resposta} className="mt-1 text-muted-foreground">
          → {r.texto}
        </p>
      ))}
      {questionamento.status !== 'Respondido' && (
        <div className="mt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Responder (tesouraria)'}
          </Button>
          {mostrarForm && (
            <FormShell<z.infer<typeof respostaQuestionamentoSchema>>
              schema={respostaQuestionamentoSchema}
              defaultValues={{ texto: '' }}
              onSubmit={(v) => responder.mutateAsync(v)}
              className="mt-2 space-y-2"
            >
              {(form) => (
                <>
                  <input
                    {...form.register('texto')}
                    placeholder="Resposta"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={responder.isPending}
                  >
                    Responder
                  </Button>
                  {responder.isError && (
                    <p className="text-destructive">
                      {(responder.error as Error).message}
                    </p>
                  )}
                </>
              )}
            </FormShell>
          )}
        </div>
      )}
    </div>
  )
}

function BlocoTitulos() {
  const [status, setStatus] = useState('')
  const [expandido, setExpandido] = useState<number | null>(null)
  const { data: titulos } = useQuery({
    queryKey: ['cf-titulos', status],
    queryFn: () => listarTitulosConselhoFiscal(status || undefined),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Títulos financeiros (leitura irrestrita)</h2>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="Pendente">Pendente</option>
          <option value="Pago">Pago</option>
          <option value="Cancelado">Cancelado</option>
        </select>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Toda consulta aqui é registrada em auditoria - o Conselho Fiscal lê tudo, mas nunca sem
        deixar rastro de quem viu o quê.
      </p>
      <div className="space-y-2">
        {(titulos ?? []).map((t) => (
          <div
            key={t.id_titulo}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {t.tipo_titulo} — {t.descricao}
              </p>
              <span className="text-muted-foreground">{t.status}</span>
            </div>
            <p className="text-muted-foreground">
              Original {formatarReais(t.valor_original)} · Saldo{' '}
              {formatarReais(t.saldo_devedor)} · Vencimento{' '}
              {formatarData(t.data_vencimento)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() =>
                setExpandido((v) => (v === t.id_titulo ? null : t.id_titulo))
              }
            >
              {expandido === t.id_titulo
                ? 'Ocultar questionamentos'
                : 'Ver questionamentos'}
            </Button>
            {expandido === t.id_titulo && (
              <BlocoQuestionamentos idTitulo={t.id_titulo} />
            )}
          </div>
        ))}
        {(titulos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum título encontrado.
          </p>
        )}
      </div>
    </section>
  )
}

function BlocoCaixa() {
  const { data: lancamentos } = useQuery({
    queryKey: ['cf-caixa'],
    queryFn: listarCaixaConselhoFiscal,
  })

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-2 font-semibold">Razão contábil (leitura irrestrita)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2">Nº</th>
              <th className="py-1 pr-2">Data</th>
              <th className="py-1 pr-2">Histórico</th>
              <th className="py-1 pr-2">Partidas (débito/crédito)</th>
              <th className="py-1 pr-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {(lancamentos ?? []).map((l) => (
              <tr key={l.id_lancamento} className="border-b border-border/50">
                <td className="py-1 pr-2">{l.numero_sequencial}</td>
                <td className="py-1 pr-2">{formatarData(l.data_lancamento)}</td>
                <td className="py-1 pr-2">{l.historico}</td>
                <td className="py-1 pr-2">
                  {l.partidas
                    .map((p) => `${p.tipo_partida} ${formatarReais(p.valor)}`)
                    .join(' · ')}
                </td>
                <td className="py-1 pr-2">
                  {l.estornado ? (
                    <span className="text-destructive">Estornado</span>
                  ) : (
                    <span className="text-muted-foreground">Normal</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(lancamentos ?? []).length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Nenhum lançamento registrado ainda.
          </p>
        )}
      </div>
    </section>
  )
}

function BlocoPareceres() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()
  const { data: pareceres } = useQuery({
    queryKey: ['pareceres'],
    queryFn: () => listarPareceres(),
  })

  const emitir = useMutation({
    mutationFn: (v: z.infer<typeof parecerCriarSchema>) => emitirParecer(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pareceres'] })
      setMostrarForm(false)
    },
  })

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Pareceres sobre prestação de contas</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Emitir parecer'}
        </Button>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof parecerCriarSchema>>
          schema={parecerCriarSchema}
          defaultValues={{
            ano_exercicio: new Date().getFullYear(),
            tipo: 'Favorável',
            texto: '',
          }}
          onSubmit={(v) => emitir.mutateAsync(v)}
          className="mb-4 space-y-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="number"
                  {...form.register('ano_exercicio')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <select
                  {...form.register('tipo')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="Favorável">Favorável</option>
                  <option value="Com ressalva">Com ressalva</option>
                  <option value="Contrário">Contrário</option>
                </select>
              </div>
              <textarea
                {...form.register('texto')}
                placeholder="Texto do parecer"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.texto?.message} />
              <Button type="submit" size="sm" disabled={emitir.isPending}>
                {emitir.isPending ? 'Emitindo…' : 'Emitir parecer'}
              </Button>
              {emitir.isError && (
                <p className="text-sm text-destructive">
                  {(emitir.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(pareceres ?? []).map((p) => (
          <div
            key={p.id_parecer}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">Exercício {p.ano_exercicio}</p>
              <span className="text-muted-foreground">{p.tipo}</span>
            </div>
            <p className="text-muted-foreground">{p.texto}</p>
            <p className="text-xs text-muted-foreground">
              {formatarData(p.criado_em, { comHora: true })}
            </p>
          </div>
        ))}
        {(pareceres ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum parecer emitido ainda.
          </p>
        )}
      </div>
    </section>
  )
}

export function ConselhoFiscalPage() {
  return (
    <>
      <PageHeader
        titulo="Conselho Fiscal"
        descricao="Leitura financeira auditada, pareceres e questionamentos."
        trilha={[{ rotulo: 'Financeiro', href: '/financeiro' }, { rotulo: 'Conselho Fiscal' }]}
      />
      <BlocoTitulos />
      <BlocoCaixa />
      <BlocoPareceres />
    </>
  )
}
