import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  gerarCobrancaBloco,
  gerarCobrancas,
  listarAssociados,
  listarPlanosContribuicao,
  type PrevisaoCobranca,
} from '@/lib/api'
import { gerarCobrancaBlocoSchema, gerarCobrancasSchema } from '@/lib/schemas'

// v3.2 (FASE 3 - Financeiro) - Geração de cobrança em lote SEMPRE com prévia obrigatória antes
// de efetivar (quantas, para quem, total) - "Confirmar" é um clique separado, nunca a mesma
// ação. Rodar a geração duas vezes na mesma competência nunca duplica (idempotência garantida
// no banco - ver app/models/financeiro.py::TituloFinanceiro.uq_titulo_cobranca_por_competencia).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// v3.2.3 - Gerar cobrança em BLOCO (pagamento antecipado com desconto, semestral/anual…): ação
// explícita e separada da geração mensal normal acima (nunca detecção automática) - um único
// título, um PIX, um pagamento. O backend recusa se o mês não for gatilho de uma campanha
// vigente/ativa, ou se já existir título cobrindo algum mês do intervalo.
function FormularioCobrancaBloco() {
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: planos } = useQuery({
    queryKey: ['planos-contribuicao'],
    queryFn: listarPlanosContribuicao,
  })

  const gerar = useMutation({
    mutationFn: (v: z.infer<typeof gerarCobrancaBlocoSchema>) =>
      gerarCobrancaBloco(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
    },
  })

  return (
    <FormShell<z.infer<typeof gerarCobrancaBlocoSchema>>
      schema={gerarCobrancaBlocoSchema}
      defaultValues={{
        id_associado: 0,
        id_plano_contribuicao: 0,
        competencia_inicio: '',
      }}
      onSubmit={(v) => gerar.mutateAsync(v)}
      className="grid gap-2 sm:grid-cols-4"
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
              {...form.register('id_plano_contribuicao')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Selecione o plano…</option>
              {(planos ?? []).map((p) => (
                <option key={p.id_plano} value={p.id_plano}>
                  {p.categoria} — {p.descricao}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_plano_contribuicao?.message}
            />
          </div>
          <div>
            <input
              {...form.register('competencia_inicio')}
              placeholder="Mês-gatilho (ex.: 2026-07)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.competencia_inicio?.message}
            />
          </div>
          <Button type="submit" size="sm" disabled={gerar.isPending}>
            {gerar.isPending ? 'Gerando…' : 'Gerar cobrança em bloco'}
          </Button>
          {gerar.isError && (
            <p className="text-sm text-destructive sm:col-span-4">
              {(gerar.error as Error).message}
            </p>
          )}
          {gerar.isSuccess && gerar.data && (
            <p className="text-sm text-green-600 sm:col-span-4">
              Título-bloco #{gerar.data.id_titulo} gerado (
              {gerar.data.competencia} a {gerar.data.competencia_fim}) —{' '}
              {formatarReais(gerar.data.valor_original)}. Veja em Financeiro ›
              Títulos.
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

export function GerarCobrancasPage() {
  const [previa, setPrevia] = useState<PrevisaoCobranca | null>(null)
  const [confirmado, setConfirmado] = useState<PrevisaoCobranca | null>(null)
  const queryClient = useQueryClient()

  const gerarPrevia = useMutation({
    mutationFn: (v: z.infer<typeof gerarCobrancasSchema>) =>
      gerarCobrancas(v.competencia, false),
    onSuccess: (resultado) => {
      setPrevia(resultado)
      setConfirmado(null)
    },
  })

  const confirmar = useMutation({
    mutationFn: () => gerarCobrancas(previa!.competencia, true),
    onSuccess: (resultado) => {
      setConfirmado(resultado)
      setPrevia(null)
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
    },
  })

  return (
    <>
      <PageHeader
        titulo="Gerar Cobranças"
        descricao="Geração em lote das mensalidades de uma competência, com prévia obrigatória antes de efetivar."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Gerar Cobranças' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <FormShell<z.infer<typeof gerarCobrancasSchema>>
          schema={gerarCobrancasSchema}
          defaultValues={{ competencia: '' }}
          onSubmit={(v) => gerarPrevia.mutateAsync(v)}
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Competência (AAAA-MM)
                </label>
                <input
                  {...form.register('competencia')}
                  placeholder="2026-10"
                  className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.competencia?.message}
                />
              </div>
              <Button type="submit" size="sm" disabled={gerarPrevia.isPending}>
                {gerarPrevia.isPending ? 'Calculando…' : 'Ver prévia'}
              </Button>
            </>
          )}
        </FormShell>
        {gerarPrevia.isError && (
          <p className="text-sm text-destructive">
            {(gerarPrevia.error as Error).message}
          </p>
        )}

        {previa && (
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <p className="mb-2 font-semibold">
              Prévia — competência {previa.competencia}
            </p>
            <ul className="mb-3 space-y-1 text-sm text-muted-foreground">
              <li>
                {previa.total_gerados} cobrança(s) a gerar, totalizando{' '}
                {formatarReais(previa.valor_total)}
              </li>
              <li>
                {previa.total_ja_existentes} já existente(s) para esta
                competência (não serão duplicadas)
              </li>
              <li>
                {previa.total_dependentes_pulados} dependente(s) de família não
                cobrado(s) separadamente
              </li>
              <li>
                {previa.total_isentos_totais} isento(s) a 100% (nenhuma cobrança
                gerada)
              </li>
              <li>
                {previa.total_cobertos_por_bloco} já coberto(s) por título-bloco
                (pagamento antecipado)
              </li>
            </ul>
            {previa.detalhes.length > 0 && (
              <div className="mb-3 max-h-64 space-y-1 overflow-y-auto text-sm">
                {previa.detalhes.map((d, i) => (
                  <div
                    key={i}
                    className="flex justify-between border-b border-border py-1"
                  >
                    <span>
                      {d.nome} — {d.descricao_plano}
                    </span>
                    <span>{formatarReais(d.valor)}</span>
                  </div>
                ))}
              </div>
            )}
            {previa.total_gerados > 0 && (
              <Button
                size="sm"
                onClick={() => confirmar.mutate()}
                disabled={confirmar.isPending}
              >
                {confirmar.isPending
                  ? 'Gerando…'
                  : `Confirmar geração de ${previa.total_gerados} cobrança(s)`}
              </Button>
            )}
            {confirmar.isError && (
              <p className="mt-2 text-sm text-destructive">
                {(confirmar.error as Error).message}
              </p>
            )}
          </div>
        )}

        {confirmado && (
          <div className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm">
            <p className="font-semibold text-green-700">
              {confirmado.total_gerados} cobrança(s) geradas para a competência{' '}
              {confirmado.competencia}.
            </p>
            <p className="text-muted-foreground">
              Valor total: {formatarReais(confirmado.valor_total)} — veja em
              Financeiro › Títulos.
            </p>
            {confirmado.reconhecimentos_receita_diferida.length > 0 && (
              <p className="mt-1 text-muted-foreground">
                {confirmado.reconhecimentos_receita_diferida.length}{' '}
                reconhecimento(s) de receita diferida (título-bloco pago),
                totalizando{' '}
                {formatarReais(
                  confirmado.reconhecimentos_receita_diferida.reduce(
                    (soma, r) => soma + r.valor,
                    0,
                  ),
                )}{' '}
                — nunca mexe em caixa, só reclassifica de Passivo pra Receita.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-1 font-semibold">
          Gerar cobrança em bloco (pagamento antecipado)
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Um único título cobrindo o bloco inteiro (semestre/ano), com o
          desconto da campanha vigente no mês-gatilho escolhido — configurável
          em Financeiro › Planos de Contribuição.
        </p>
        <FormularioCobrancaBloco />
      </section>
    </>
  )
}
