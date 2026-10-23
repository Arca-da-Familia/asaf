import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  abrirPdfDoAto,
  baixarCopiaAssinada,
  gerarAtoDoEncarregado,
  obterSituacaoDoEncarregado,
  registrarAssinaturaDoAto,
  type AtoDoEncarregado,
  type PessoaDoMandato,
  type SituacaoDoEncarregado,
} from '@/lib/privacidade'

const CLASSE_DA_SITUACAO: Record<AtoDoEncarregado['situacao'], string> = {
  'Aguardando assinatura': 'bg-amber-100 text-amber-900',
  Vigente: 'bg-green-100 text-green-900',
  Substituído: 'bg-muted text-muted-foreground',
  Descartado: 'bg-muted text-muted-foreground',
}

function Pessoa({
  titulo,
  pessoa,
  vazio,
  testid,
}: {
  titulo: string
  pessoa: PessoaDoMandato | null
  vazio: string
  testid: string
}) {
  return (
    <div className="rounded-md border border-border p-3" data-testid={testid}>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {titulo}
      </p>
      {pessoa ? (
        <>
          <p className="font-semibold">{pessoa.nome}</p>
          <p className="text-sm text-muted-foreground">
            {pessoa.cargo} · mandato de {formatarData(pessoa.mandato_inicio)} a{' '}
            {formatarData(pessoa.mandato_fim)}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      )}
    </div>
  )
}

function SituacaoDoAtoSelo({ ato }: { ato: AtoDoEncarregado }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${CLASSE_DA_SITUACAO[ato.situacao]}`}
    >
      {ato.situacao}
    </span>
  )
}

function AguardandoAssinatura({
  ato,
  podeRegistrar,
}: {
  ato: AtoDoEncarregado
  podeRegistrar: boolean
}) {
  const queryClient = useQueryClient()
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erroDoPdf, setErroDoPdf] = useState<string | null>(null)
  const registrar = useMutation({
    mutationFn: (f: File) => registrarAssinaturaDoAto(ato.id_ato, f),
    onSuccess: (situacao) => {
      queryClient.setQueryData(['privacidade', 'encarregado'], situacao)
      setArquivo(null)
    },
    // recusa (ex.: o mandato mudou): o quadro "Hoje, pelos mandatos" é relido para mostrar o que o servidor viu
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: ['privacidade', 'encarregado'],
      }),
  })
  const id = `assinado-${ato.id_ato}`

  return (
    <section
      aria-label="Ato aguardando assinatura"
      data-testid="ato-aguardando-assinatura"
      className="rounded-xl border border-amber-600/40 bg-card p-6"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Ato nº {ato.numero}</h2>
        <SituacaoDoAtoSelo ato={ato} />
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Gerado em {formatarData(ato.gerado_em, { comHora: true })}. Imprima,
        colha as assinaturas ({ato.nome_encarregado}
        {ato.nome_substituto ? ` e ${ato.nome_substituto}` : ''}) e anexe aqui a
        cópia assinada: só ela faz o ato valer.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setErroDoPdf(null)
            abrirPdfDoAto(ato).catch((e) =>
              setErroDoPdf(mensagemDoErro(e, 'Não foi possível abrir o PDF.')),
            )
          }}
        >
          Abrir o PDF para imprimir
        </Button>
      </div>
      {erroDoPdf && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erroDoPdf}
        </p>
      )}
      {podeRegistrar && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={id} className="mb-1 block text-sm font-medium">
              Cópia assinada (PDF, JPG ou PNG)
            </label>
            <input
              id={id}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null)
                registrar.reset()
              }}
              className="text-sm"
            />
          </div>
          <Button
            size="sm"
            disabled={!arquivo || registrar.isPending}
            onClick={() => arquivo && registrar.mutate(arquivo)}
          >
            {registrar.isPending ? 'Registrando…' : 'Registrar a assinatura'}
          </Button>
        </div>
      )}
      {registrar.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {mensagemDoErro(
            registrar.error,
            'Não foi possível registrar a assinatura.',
          )}
        </p>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">
          Ler o texto do ato
        </summary>
        <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
          {ato.texto}
        </pre>
      </details>
    </section>
  )
}

function Vigente({ ato }: { ato: AtoDoEncarregado }) {
  const [erro, setErro] = useState<string | null>(null)
  const executar = (fn: () => Promise<void>) => () => {
    setErro(null)
    fn().catch((e) => setErro(mensagemDoErro(e, 'Não foi possível abrir.')))
  }
  return (
    <section
      aria-label="Ato vigente"
      data-testid="ato-vigente"
      className="rounded-xl border border-border bg-card p-6"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Ato nº {ato.numero}</h2>
        <SituacaoDoAtoSelo ato={ato} />
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Encarregado: <strong>{ato.nome_encarregado}</strong>. Substituto:{' '}
        <strong>
          {ato.nome_substituto
            ? `${ato.nome_substituto} (${ato.cargo_substituto})`
            : 'só pelo cargo (sem Vice-Presidente com mandato quando foi gerado)'}
        </strong>
        . Assinatura registrada em{' '}
        {ato.assinatura_registrada_em
          ? formatarData(ato.assinatura_registrada_em, { comHora: true })
          : '—'}
        .
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={executar(() => abrirPdfDoAto(ato))}
        >
          Ver o texto em PDF
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={executar(() => baixarCopiaAssinada(ato))}
        >
          Baixar a cópia assinada
        </Button>
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
    </section>
  )
}

function Historico({ atos }: { atos: AtoDoEncarregado[] }) {
  if (atos.length === 0) return null
  return (
    <section
      aria-label="Histórico dos atos"
      className="rounded-xl border border-border bg-card p-6"
    >
      <h2 className="mb-3 font-semibold">Histórico dos atos</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-muted-foreground">
              <th className="py-1 pr-3">Nº</th>
              <th className="py-1 pr-3">Situação</th>
              <th className="py-1 pr-3">Encarregado</th>
              <th className="py-1 pr-3">Substituto</th>
              <th className="py-1 pr-3">Gerado em</th>
              <th className="py-1">Encerrado em</th>
            </tr>
          </thead>
          <tbody>
            {atos.map((a) => (
              <tr key={a.id_ato} className="border-t border-border">
                <td className="py-1 pr-3">{a.numero}</td>
                <td className="py-1 pr-3">
                  <SituacaoDoAtoSelo ato={a} />
                </td>
                <td className="py-1 pr-3">{a.nome_encarregado}</td>
                <td className="py-1 pr-3">{a.nome_substituto ?? '—'}</td>
                <td className="py-1 pr-3">{formatarData(a.gerado_em)}</td>
                <td className="py-1">
                  {a.encerrado_em ? formatarData(a.encerrado_em) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// v7.0a - o encarregado pelo tratamento de dados (LGPD, art. 41): quem é hoje pelos mandatos, o que falta (avisos), o ato que vale, o que aguarda assinatura e o histórico.
export function EncarregadoPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['privacidade', 'encarregado'],
    queryFn: obterSituacaoDoEncarregado,
  })
  const gerar = useMutation({
    mutationFn: gerarAtoDoEncarregado,
    onSuccess: (situacao: SituacaoDoEncarregado) =>
      queryClient.setQueryData(['privacidade', 'encarregado'], situacao),
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: ['privacidade', 'encarregado'],
      }),
  })

  return (
    <>
      <PageHeader
        titulo="Encarregado de dados"
        descricao="Quem responde pelos dados pessoais da associação (LGPD, art. 41), o substituto e o ato de designação assinado."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Privacidade' },
          { rotulo: 'Encarregado' },
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
          {data.avisos.length > 0 && (
            <section
              aria-label="O que falta"
              data-testid="avisos-do-encarregado"
              className="rounded-xl border border-amber-600/30 bg-amber-600/10 p-4"
            >
              <h2 className="mb-2 font-semibold">O que falta</h2>
              <ul className="list-disc pl-5 text-sm">
                {data.avisos.map((a) => (
                  <li key={a.codigo} data-aviso={a.codigo}>
                    {a.texto}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-label="Hoje, pelos mandatos"
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="mb-1 font-semibold">Hoje, pelos mandatos</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              O encarregado é o Presidente. O Estatuto (art. 21, parágrafo
              único) atribui aos Vice-Presidentes a substituição do Presidente;
              o ato designa o 1º e, na falta dele, o 2º. Os nomes vêm dos
              mandatos cadastrados em Governança.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pessoa
                titulo="Encarregado"
                pessoa={data.encarregado}
                vazio="Sem mandato vigente de Presidente cadastrado."
                testid="encarregado-de-hoje"
              />
              <Pessoa
                titulo="Substituto"
                pessoa={data.substituto}
                vazio="Sem mandato vigente de Vice-Presidente cadastrado."
                testid="substituto-de-hoje"
              />
            </div>
            {data.pode_gerir ? (
              <div className="mt-4">
                <Button
                  size="sm"
                  disabled={!data.encarregado || gerar.isPending}
                  onClick={() => gerar.mutate()}
                >
                  {gerar.isPending
                    ? 'Gerando…'
                    : data.rascunho
                      ? `Gerar de novo (descarta o Ato nº ${data.rascunho.numero}, ainda não assinado)`
                      : 'Gerar o ato de designação'}
                </Button>
                {gerar.isError && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {mensagemDoErro(
                      gerar.error,
                      'Não foi possível gerar o ato.',
                    )}
                  </p>
                )}
              </div>
            ) : (
              <p
                className="mt-4 text-sm text-muted-foreground"
                data-testid="so-o-presidente-gera"
              >
                Só o Presidente gera o ato e registra a cópia assinada.
              </p>
            )}
          </section>

          {/* `key`: outro ato gerado é outro quadro (o arquivo escolhido para o ato anterior nunca vai para o novo) */}
          {data.rascunho && (
            <AguardandoAssinatura
              key={data.rascunho.id_ato}
              ato={data.rascunho}
              podeRegistrar={data.pode_gerir}
            />
          )}
          {data.ato_vigente && <Vigente ato={data.ato_vigente} />}
          <Historico atos={data.historico} />
        </div>
      )}
    </>
  )
}
