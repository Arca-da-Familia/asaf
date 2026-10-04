import { Globe, Lock } from 'lucide-react'

import {
  CLASSE_DA_SITUACAO,
  alertaDeValidade,
  type Classificacao,
  type Situacao,
} from '@/lib/documentos'

export function SeloDeSituacao({ situacao }: { situacao: Situacao }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CLASSE_DA_SITUACAO[situacao]}`}
    >
      {situacao}
    </span>
  )
}

export function SeloDeClassificacao({
  classificacao,
}: {
  classificacao: Classificacao
}) {
  const aberta = classificacao === 'Pública'
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {aberta ? (
        <Globe aria-hidden="true" className="h-3 w-3" />
      ) : (
        <Lock aria-hidden="true" className="h-3 w-3" />
      )}
      {classificacao}
    </span>
  )
}

export function SeloDeValidade({ validade }: { validade: string | null }) {
  const alerta = alertaDeValidade(validade)
  if (!validade) return null
  const [ano, mes, dia] = validade.split('-')
  const texto = `${dia}/${mes}/${ano}`
  if (alerta === 'vencida')
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-900">
        Vencida em {texto}
      </span>
    )
  if (alerta === 'vence-em-breve')
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
        Vence em {texto}
      </span>
    )
  return (
    <span className="text-xs text-muted-foreground">Válida até {texto}</span>
  )
}
