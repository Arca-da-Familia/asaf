import { AlertTriangle, XCircle } from 'lucide-react'

import { CLASSE_DO_ALERTA, moeda, type ParceriaDetalhe } from '@/lib/parcerias'

// Os quatro números da parceria. Todos vêm do livro-caixa, exceto o valor total (que é o da parceria).
export function ResumoFinanceiro({ d }: { d: ParceriaDetalhe }) {
  const itens = [
    { rotulo: 'Valor da parceria', valor: d.valor_total },
    { rotulo: 'Recebido', valor: d.recebido },
    { rotulo: 'Pago', valor: d.pago },
    { rotulo: 'Saldo em conta', valor: d.saldo },
  ]
  return (
    <section aria-label="Resumo financeiro">
      <dl className="grid gap-3 sm:grid-cols-4">
        {itens.map((i) => (
          <div key={i.rotulo} className="rounded-md border border-border p-3">
            <dt className="text-xs uppercase text-muted-foreground">
              {i.rotulo}
            </dt>
            <dd className="mt-1 text-lg font-semibold">{moeda(i.valor)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Recebido, pago e saldo são lidos do livro-caixa (centro de custo{' '}
        {d.codigo_centro_custo}). Ninguém digita esses valores.
      </p>
    </section>
  )
}

// Pendências que TRAVAM a publicação (vermelho) e avisos para a equipe (amarelo).
export function PendenciasDaParceria({ d }: { d: ParceriaDetalhe }) {
  const { bloqueios, avisos } = d.consistencia
  if (bloqueios.length === 0 && avisos.length === 0) return null
  return (
    <section aria-label="Pendências e avisos" className="space-y-2">
      {bloqueios.length > 0 && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${CLASSE_DO_ALERTA.bloqueio}`}
        >
          <p className="flex items-center gap-2 font-semibold">
            <XCircle aria-hidden="true" className="h-4 w-4" />
            Pendências que impedem a publicação
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {bloqueios.map((b) => (
              <li key={b.codigo}>{b.mensagem}</li>
            ))}
          </ul>
        </div>
      )}
      {avisos.length > 0 && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${CLASSE_DO_ALERTA.aviso}`}
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            Avisos
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {avisos.map((a, i) => (
              <li key={`${a.codigo}-${i}`}>{a.mensagem}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
