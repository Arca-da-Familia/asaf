import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { apiFetch, logout } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'

type Me = {
  id_usuario: number
  nome_completo?: string | null
  email?: string | null
  nivel?: string | null
  mfa_ativado: boolean
  permissoes: string[]
}

export function Home() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<Me>('/auth/me'),
  })

  async function sair() {
    await logout()
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Painel</h1>
        <Button variant="outline" onClick={sair}>
          Sair
        </Button>
      </div>

      <section className="mt-8 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Sessão autenticada</h2>
        {isLoading && (
          <p className="mt-2 text-sm text-muted-foreground">Carregando…</p>
        )}
        {isError && (
          <p className="mt-2 text-sm text-destructive">
            Não foi possível carregar seus dados.
          </p>
        )}
        {data && (
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Nome:</dt>
              <dd>{data.nome_completo ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Nível:</dt>
              <dd>{data.nivel ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Permissões:</dt>
              <dd>
                {data.permissoes.length ? data.permissoes.join(', ') : '—'}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </main>
  )
}
