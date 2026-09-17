import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  listarAssociados,
  listarNegociacoesDivida,
  listarTitulos,
  negociarDivida,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { negociacaoDividaCriarSchema } from '@/lib/schemas'

// v3.2.2 (FASE 3 - Financeiro) - negociação/parcelamento de débito em atraso: o título vencido
// nunca é editado/apagado (vira "Renegociado"), as parcelas novas nascem como título "A Receber"
// normal. Termo de confissão de dívida em TEXTO - assinatura eletrônica de verdade fica pra FASE
// 20, ainda não existe no sistema.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function NegociacaoDividaPage() {
  const queryClient = useQueryClient()
  const [idAssociado, setIdAssociado] = useState('')
  const [titulosSelecionados, setTitulosSelecionados] = useState<number[]>([])

  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: titulos } = useQuery({
    queryKey: ['titulos', 'Pendente', 'A Receber'],
    queryFn: () =>
      listarTitulos({ status: 'Pendente', tipo_titulo: 'A Receber' }),
  })
  const { data: negociacoes } = useQuery({
    queryKey: ['negociacoes-divida', idAssociado],
    queryFn: () =>
      listarNegociacoesDivida(idAssociado ? Number(idAssociado) : undefined),
    enabled: !!idAssociado,
  })

  const hoje = new Date()
  const titulosVencidosDoAssociado = (titulos ?? []).filter(
    (t) =>
      String(t.id_associado) === idAssociado &&
      new Date(t.data_vencimento) < hoje,
  )
  const valorSelecionado = titulosVencidosDoAssociado
    .filter((t) => titulosSelecionados.includes(t.id_titulo))
    .reduce((soma, t) => soma + t.saldo_devedor, 0)

  const negociar = useMutation({
    mutationFn: (v: z.infer<typeof negociacaoDividaCriarSchema>) =>
      negociarDivida({
        id_associado: Number(idAssociado),
        ids_titulos_originais: titulosSelecionados,
        quantidade_parcelas: v.quantidade_parcelas,
        termo: v.termo,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
      queryClient.invalidateQueries({
        queryKey: ['negociacoes-divida', idAssociado],
      })
      setTitulosSelecionados([])
    },
  })

  return (
    <>
      <PageHeader
        titulo="Negociação de Dívida"
        descricao="Parcelamento de débito em atraso — o título original vira 'Renegociado' (nunca editado), as parcelas novas são títulos normais."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Negociação de Dívida' },
        ]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4">
          <label className="mb-1 block text-xs text-muted-foreground">
            Associado
          </label>
          <select
            value={idAssociado}
            onChange={(e) => {
              setIdAssociado(e.target.value)
              setTitulosSelecionados([])
            }}
            className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Selecione o associado…</option>
            {(associados ?? []).map((a) => (
              <option key={a.id_associado} value={a.id_associado}>
                {a.nome_completo}
              </option>
            ))}
          </select>
        </div>

        {idAssociado && (
          <>
            <h2 className="mb-2 font-semibold">Títulos vencidos</h2>
            <div className="mb-4 space-y-1">
              {titulosVencidosDoAssociado.map((t) => (
                <label
                  key={t.id_titulo}
                  className="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={titulosSelecionados.includes(t.id_titulo)}
                    onChange={(e) =>
                      setTitulosSelecionados((sel) =>
                        e.target.checked
                          ? [...sel, t.id_titulo]
                          : sel.filter((id) => id !== t.id_titulo),
                      )
                    }
                  />
                  <span>
                    {t.descricao} — vencido em {formatarData(t.data_vencimento)}{' '}
                    — {formatarReais(t.saldo_devedor)}
                  </span>
                </label>
              ))}
              {titulosVencidosDoAssociado.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum título vencido para este associado.
                </p>
              )}
            </div>

            {titulosSelecionados.length > 0 && (
              <FormShell<z.infer<typeof negociacaoDividaCriarSchema>>
                schema={negociacaoDividaCriarSchema}
                defaultValues={{ quantidade_parcelas: 1, termo: '' }}
                onSubmit={(v) => negociar.mutateAsync(v)}
                className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3"
              >
                {(form) => (
                  <>
                    <div className="sm:col-span-3">
                      <p className="text-sm font-medium">
                        Valor total selecionado:{' '}
                        {formatarReais(valorSelecionado)}
                      </p>
                    </div>
                    <div>
                      <input
                        type="number"
                        {...form.register('quantidade_parcelas')}
                        placeholder="Quantidade de parcelas"
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      />
                      <ErroCampo
                        mensagem={
                          form.formState.errors.quantidade_parcelas?.message
                        }
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <textarea
                        {...form.register('termo')}
                        placeholder="Termos da negociação (ex.: associado compareceu à tesouraria em [data] e propôs parcelamento em N vezes, primeira parcela em [data]…) — este texto é o registro que substitui a confissão de dívida assinada, até a assinatura eletrônica existir no sistema."
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                      <ErroCampo
                        mensagem={form.formState.errors.termo?.message}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={negociar.isPending}
                      >
                        {negociar.isPending
                          ? 'Salvando…'
                          : 'Confirmar negociação'}
                      </Button>
                    </div>
                    {negociar.isError && (
                      <p className="text-sm text-destructive sm:col-span-3">
                        {(negociar.error as Error).message}
                      </p>
                    )}
                    {negociar.isSuccess && negociar.data && (
                      <p className="text-sm text-green-600 sm:col-span-3">
                        Negociação #{negociar.data.id_negociacao} confirmada —{' '}
                        {negociar.data.quantidade_parcelas} parcela(s), veja em
                        Financeiro › Títulos.
                      </p>
                    )}
                  </>
                )}
              </FormShell>
            )}
          </>
        )}
      </section>

      {idAssociado && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-semibold">Histórico de negociações</h2>
          <div className="space-y-2">
            {(negociacoes ?? []).map((n) => (
              <div
                key={n.id_negociacao}
                className="rounded-md border border-border p-3 text-sm"
              >
                <p className="font-medium">
                  {formatarReais(n.valor_total)} em {n.quantidade_parcelas}{' '}
                  parcela(s) — {n.data_negociacao}
                </p>
                <p className="text-muted-foreground">{n.termo}</p>
              </div>
            ))}
            {(negociacoes ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma negociação registrada para este associado.
              </p>
            )}
          </div>
        </section>
      )}
    </>
  )
}
