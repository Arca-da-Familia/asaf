import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { importarExtratoConciliacao, type SugestaoConciliacao } from '@/lib/api'

// v3.2 (FASE 3 - Financeiro) - conciliação bancária MANUAL a partir de extrato (OFX/CSV): a
// ASAF não tem orçamento pra API paga de PSP/banco, então a tesouraria baixa o extrato do
// próprio internet banking e sobe aqui. O sistema só SUGERE correspondência por valor+data -
// a baixa em si continua sempre em Financeiro › Títulos, confirmada por um humano.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

export function ConciliacaoPage() {
  const [transacoes, setTransacoes] = useState<SugestaoConciliacao[] | null>(
    null,
  )

  const importar = useMutation({
    mutationFn: (arquivo: File) => importarExtratoConciliacao(arquivo),
    onSuccess: (resultado) => setTransacoes(resultado.transacoes),
  })

  return (
    <>
      <PageHeader
        titulo="Conciliação Bancária"
        descricao="Importe um extrato (.ofx ou .csv) e veja sugestões de correspondência com títulos em aberto — a baixa é sempre confirmada manualmente em Títulos."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Conciliação' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4">
          <input
            type="file"
            accept=".ofx,.csv,.txt"
            disabled={importar.isPending}
            onChange={(e) => {
              const arquivo = e.target.files?.[0]
              if (arquivo) importar.mutate(arquivo)
            }}
            className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          {importar.isPending && (
            <p className="mt-1 text-xs text-muted-foreground">Processando…</p>
          )}
          {importar.isError && (
            <p className="mt-1 text-sm text-destructive">
              {(importar.error as Error).message}
            </p>
          )}
        </div>

        {transacoes && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {transacoes.length} transação(ões) encontrada(s) no extrato.
            </p>
            {transacoes.map((t) => (
              <div
                key={t.identificador}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">
                    {t.data} — {t.descricao || 'sem descrição'}
                  </p>
                  <p className="font-medium">{formatarReais(t.valor)}</p>
                </div>
                {t.sugestoes.length > 0 ? (
                  <ul className="mt-1 text-muted-foreground">
                    {t.sugestoes.map((s) => (
                      <li key={s.id_titulo}>
                        Sugestão: título #{s.id_titulo} — {s.descricao} (
                        {s.tipo_titulo}, saldo {formatarReais(s.saldo_devedor)})
                        — dê baixa em Financeiro › Títulos.
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nenhum título em aberto corresponde a este valor/data.
                  </p>
                )}
              </div>
            ))}
            {transacoes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma transação no arquivo.
              </p>
            )}
          </div>
        )}
      </section>
    </>
  )
}
