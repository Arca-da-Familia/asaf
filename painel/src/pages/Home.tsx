import { useMe } from '@/lib/use-me'

export function Home() {
  const { data } = useMe()

  return (
    <>
      <h1 className="text-2xl font-bold">Início</h1>
      <p className="mt-2 text-muted-foreground">
        Bem-vindo{data?.nome_completo ? `, ${data.nome_completo}` : ''} ao
        painel da ASAF.
      </p>

      <section className="mt-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Sua sessão</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Nível:</dt>
            <dd>{data?.nivel ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Permissões:</dt>
            <dd>
              {data?.permissoes.length ? data.permissoes.join(', ') : '—'}
            </dd>
          </div>
        </dl>
      </section>
    </>
  )
}
