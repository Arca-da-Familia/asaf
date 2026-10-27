import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/PageHeader'
import { formatarDia } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { obterTextosDePrivacidade, type PontoDeColeta } from '@/lib/privacidade'

function Ponto({ p }: { p: PontoDeColeta }) {
  return (
    <section
      aria-label={p.nome}
      data-ponto={p.codigo}
      className="rounded-xl border border-border bg-card p-6"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{p.nome}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          {p.tipo === 'aviso' ? 'Aviso (não é consentimento)' : 'Consentimento'}
        </span>
        <span className="text-xs text-muted-foreground">
          versão atual: {p.versao_atual}
        </span>
      </div>
      <dl className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="font-medium">Onde a pessoa lê</dt>
        <dd>{p.onde}</dd>
        <dt className="font-medium">Base legal</dt>
        <dd>
          <ul className="list-disc pl-5">
            {p.bases_legais.map((b) => (
              <li key={b.codigo}>{b.texto}</li>
            ))}
          </ul>
        </dd>
        <dt className="font-medium">Atividade do inventário</dt>
        <dd>{p.atividade_nome}</dd>
        <dt className="font-medium">A caixa diz</dt>
        <dd>{p.caixa}</dd>
      </dl>
      <h3 className="mt-4 text-sm font-semibold">
        Versões (a mais nova primeiro)
      </h3>
      <ul className="mt-2 v3-space-y-2">
        {p.versoes.map((v) => (
          <li key={v.versao}>
            <details open={v.versao === p.versao_atual}>
              <summary className="cursor-pointer text-sm font-medium">
                Versão {v.versao}, desde {formatarDia(v.vigente_desde)}
                {v.versao === p.versao_atual ? ' (em vigor)' : ''}
                {v.reconstituido ? ' · reconstituída do código do site' : ''}
              </summary>
              {v.diverge_do_codigo && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  O código do sistema tem hoje outro texto para esta versão;
                  vale o texto gravado abaixo, que é o que foi mostrado.
                </p>
              )}
              <p className="mt-2 whitespace-pre-line rounded-md border border-border p-3 text-sm">
                {v.texto_sem_links}
              </p>
              <p className="mt-1 text-xs">
                {v.tipo === 'consentimento'
                  ? 'Era um pedido de consentimento'
                  : 'Era um aviso'}
                {v.caixa && ` · a caixa dizia: “${v.caixa}”`}
              </p>
              {v.observacao && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {v.observacao}
                </p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}

// v7.1a - cada formulário que recebe dado pessoal, com a base legal e o texto EXATO de cada versão do aviso (o que a pessoa leu). Pedir consentimento para
// tudo enfraquece o consentimento onde ele importa: onde a base é o pedido da própria pessoa (LGPD, art. 7º, V), o formulário mostra um aviso.
export function AvisosDePrivacidadePage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['privacidade', 'textos-de-privacidade'],
    queryFn: obterTextosDePrivacidade,
  })
  return (
    <>
      <PageHeader
        titulo="Avisos de privacidade"
        descricao="O que cada formulário do site diz sobre os dados pessoais, a base legal e o texto exato de cada versão: é por ele que se prova o que a pessoa leu."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Privacidade' },
          { rotulo: 'Avisos de privacidade' },
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
          {data.pontos.map((p) => (
            <Ponto key={p.codigo} p={p} />
          ))}
        </div>
      )}
    </>
  )
}
