import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  abrirPdfDoRelatorio,
  aprovarRelatorioDeImpacto,
  obterRelatoriosDeImpacto,
  salvarRelatorioDeImpacto,
  suspenderRelatorioDeImpacto,
  type RelatoriosDeImpacto,
  type TratamentoDeAltoRisco,
} from '@/lib/privacidade'

const CHAVE = ['privacidade', 'relatorios-de-impacto']

function Selo({ t }: { t: TratamentoDeAltoRisco }) {
  if (!t.ligado)
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Ainda não existe no sistema ({t.versao_do_plano})
      </span>
    )
  return t.liberado ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-900">
      Liberado (relatório aprovado)
    </span>
  ) : (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-900">
      Fechado: sem relatório aprovado
    </span>
  )
}

function Editar({
  t,
  dados,
  aoFechar,
}: {
  t: TratamentoDeAltoRisco
  dados: RelatoriosDeImpacto
  aoFechar: () => void
}) {
  const queryClient = useQueryClient()
  const inicial =
    t.rascunho?.secoes ??
    t.proposta ??
    t.aprovado?.secoes ??
    t.suspenso?.secoes ??
    {}
  const [secoes, setSecoes] = useState<Record<string, string>>(
    Object.fromEntries(
      dados.secoes.map((s) => [s.chave, inicial[s.chave] ?? '']),
    ),
  )
  const salvar = useMutation({
    mutationFn: () => salvarRelatorioDeImpacto(t.codigo, secoes),
    onSuccess: (novo) => {
      queryClient.setQueryData(CHAVE, novo)
      aoFechar()
    },
  })
  return (
    <form
      aria-label={`Rascunho do relatório: ${t.nome}`}
      className="mt-4 v3-space-y-3 rounded-md border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        salvar.mutate()
      }}
    >
      {dados.secoes.map((s) => (
        <div key={s.chave}>
          <label
            htmlFor={`${t.codigo}-${s.chave}`}
            className="text-sm font-medium"
          >
            {s.rotulo}
          </label>
          <textarea
            id={`${t.codigo}-${s.chave}`}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={secoes[s.chave] ?? ''}
            onChange={(e) =>
              setSecoes({ ...secoes, [s.chave]: e.target.value })
            }
          />
        </div>
      ))}
      {salvar.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(salvar.error, 'Não foi possível salvar.')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar o rascunho'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function Cartao({
  t,
  dados,
}: {
  t: TratamentoDeAltoRisco
  dados: RelatoriosDeImpacto
}) {
  const queryClient = useQueryClient()
  const [editando, setEditando] = useState(false)
  const [suspendendo, setSuspendendo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erroDoPdf, setErroDoPdf] = useState<string | null>(null)
  const aprovar = useMutation({
    mutationFn: () => aprovarRelatorioDeImpacto(t.codigo),
    onSuccess: (novo) => queryClient.setQueryData(CHAVE, novo),
  })
  const suspender = useMutation({
    mutationFn: () => suspenderRelatorioDeImpacto(t.codigo, motivo),
    onSuccess: (novo) => {
      queryClient.setQueryData(CHAVE, novo)
      setSuspendendo(false)
      setMotivo('')
    },
  })
  const vigente = t.aprovado ?? t.suspenso

  return (
    <section
      aria-label={t.nome}
      data-tratamento={t.codigo}
      className="rounded-xl border border-border bg-card p-6"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t.nome}</h2>
        <Selo t={t} />
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        {t.por_que_alto_risco}
      </p>
      {t.aprovado && (
        <p className="text-sm" data-testid={`aprovado-${t.codigo}`}>
          Versão {t.aprovado.versao} aprovada em{' '}
          {formatarData(t.aprovado.aprovado_em ?? t.aprovado.criado_em, {
            comHora: true,
          })}
          .
        </p>
      )}
      {t.suspenso && (
        <p
          className="text-sm text-destructive"
          data-testid={`suspenso-${t.codigo}`}
        >
          Suspenso: {t.suspenso.motivo_suspensao}
        </p>
      )}
      {t.rascunho && (
        <p className="text-sm" data-testid={`rascunho-${t.codigo}`}>
          Rascunho da versão {t.rascunho.versao} aguardando aprovação
          {t.liberado ? ' (o aprovado continua valendo até lá)' : ''}.
        </p>
      )}
      {vigente && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium">
            Ler o relatório {t.aprovado ? 'aprovado' : 'suspenso'}
          </summary>
          <dl className="mt-2 v3-space-y-2 text-sm">
            {dados.secoes.map((s) => (
              <div key={s.chave}>
                <dt className="font-medium">{s.rotulo}</dt>
                <dd className="whitespace-pre-wrap">
                  {vigente.secoes[s.chave]}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {dados.pode_gerir && !editando && (
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            {t.rascunho ? 'Continuar o rascunho' : 'Escrever o rascunho'}
          </Button>
        )}
        {dados.pode_gerir && t.rascunho && (
          <Button
            size="sm"
            disabled={aprovar.isPending}
            onClick={() => aprovar.mutate()}
          >
            {aprovar.isPending ? 'Aprovando…' : 'Aprovar o relatório'}
          </Button>
        )}
        {dados.pode_gerir && t.aprovado && !suspendendo && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSuspendendo(true)}
          >
            Suspender o tratamento
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setErroDoPdf(null)
            abrirPdfDoRelatorio(t.codigo).catch((e) =>
              setErroDoPdf(mensagemDoErro(e, 'Não foi possível abrir o PDF.')),
            )
          }}
        >
          Abrir em PDF
        </Button>
      </div>
      {aprovar.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {mensagemDoErro(aprovar.error, 'Não foi possível aprovar.')}
        </p>
      )}
      {erroDoPdf && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erroDoPdf}
        </p>
      )}
      {suspendendo && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor={`motivo-${t.codigo}`}
              className="text-sm font-medium"
            >
              Motivo da suspensão
            </label>
            <input
              id={`motivo-${t.codigo}`}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="destructive"
            disabled={suspender.isPending}
            onClick={() => suspender.mutate()}
          >
            Confirmar a suspensão
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSuspendendo(false)}
          >
            Cancelar
          </Button>
          {suspender.isError && (
            <p role="alert" className="w-full text-sm text-destructive">
              {mensagemDoErro(suspender.error, 'Não foi possível suspender.')}
            </p>
          )}
        </div>
      )}
      {editando && (
        <Editar t={t} dados={dados} aoFechar={() => setEditando(false)} />
      )}
      {t.historico.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Versões:{' '}
          {t.historico.map((h) => `${h.versao} (${h.situacao})`).join(', ')}.
        </p>
      )}
    </section>
  )
}

// v7.0d - o relatório de impacto à proteção de dados (RIPD; LGPD art. 38) de cada tratamento de alto risco: sem ele aprovado, o tratamento não roda.
export function RelatorioDeImpactoPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: CHAVE,
    queryFn: obterRelatoriosDeImpacto,
  })
  return (
    <>
      <PageHeader
        titulo="Relatório de impacto"
        descricao="Antes de um tratamento de alto risco rodar, o relatório de impacto à proteção de dados (LGPD, art. 38): o que se trata, os riscos, as medidas e o parecer do encarregado."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Privacidade' },
          { rotulo: 'Relatório de impacto' },
        ]}
      />
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(error, 'Não foi possível carregar.')}
        </p>
      )}
      {data && (
        <div className="v3-space-y-6">
          {data.tratamentos.map((t) => (
            <Cartao key={t.codigo} t={t} dados={data} />
          ))}
        </div>
      )}
    </>
  )
}
