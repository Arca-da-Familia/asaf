import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  editarRegraDoSistema,
  listarConfiguracoes,
  type RegraDoSistema,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

const TEXTOS_LONGOS = new Set(['TEXTO_CONSENTIMENTO_LGPD_INSCRICAO'])

function RegraLinha({ regra }: { regra: RegraDoSistema }) {
  const queryClient = useQueryClient()
  const [valor, setValor] = useState(regra.valor)
  const [salvo, setSalvo] = useState(false)

  const salvar = useMutation({
    mutationFn: () => editarRegraDoSistema(regra.chave, valor),
    onSuccess: () => {
      setSalvo(true)
      queryClient.invalidateQueries({ queryKey: ['regras-do-sistema'] })
    },
    onError: () => setSalvo(false),
  })

  const id = `regra-${regra.chave}`
  const numerica = regra.tipo === 'numero'
  const mudou = valor !== regra.valor
  const classe =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <li
      aria-label={regra.chave}
      className="rounded-md border border-border p-3"
    >
      <label htmlFor={id} className="text-sm font-medium">
        {regra.descricao ?? regra.chave}
      </label>
      <p className="mb-2 text-xs text-muted-foreground">{regra.chave}</p>
      <div className="flex flex-wrap items-start gap-2">
        {TEXTOS_LONGOS.has(regra.chave) ? (
          <textarea
            id={id}
            rows={4}
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setSalvo(false)
            }}
            className={`${classe} flex-1`}
          />
        ) : (
          <input
            id={id}
            type={numerica ? 'number' : 'text'}
            inputMode={numerica ? 'decimal' : undefined}
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setSalvo(false)
            }}
            className={`${classe} h-9 ${numerica ? 'w-40' : 'flex-1'}`}
          />
        )}
        <Button
          size="sm"
          disabled={!mudou || salvar.isPending}
          onClick={() => salvar.mutate()}
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      {salvar.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {(salvar.error as Error).message}
        </p>
      )}
      {salvo && !salvar.isError && (
        <p role="status" className="mt-1 text-xs text-green-600">
          Salvo.
        </p>
      )}
      {regra.atualizado_em && (
        <p className="mt-1 text-xs text-muted-foreground">
          Última alteração em{' '}
          {formatarData(regra.atualizado_em, { comHora: true })}
        </p>
      )}
    </li>
  )
}

// Regras do sistema: os limites e prazos que o sistema usa (quantos dias vale um lembrete, a partir de quanto um lançamento tardio vira alerta, o horário do
// expediente...). Cada um tem um valor padrão de fábrica; a presidência ajusta aqui, e cada mudança fica na Auditoria (valor antes e depois).
export function RegrasDoSistemaPage() {
  const { data: regras, isLoading } = useQuery({
    queryKey: ['regras-do-sistema'],
    queryFn: listarConfiguracoes,
    select: (todas) => todas.filter((c) => c.categoria === 'regras'),
  })

  return (
    <>
      <PageHeader
        titulo="Regras do sistema"
        descricao="Os limites e prazos que o sistema usa. Cada mudança vale na hora e fica na Auditoria."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Regras do sistema' },
        ]}
      />
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {!isLoading && (regras ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma regra ajustável encontrada.
        </p>
      )}
      <ul className="v3-space-y-3" aria-label="Regras ajustáveis">
        {(regras ?? []).map((regra) => (
          <RegraLinha key={regra.chave} regra={regra} />
        ))}
      </ul>
    </>
  )
}
