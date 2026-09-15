import { Link } from 'react-router-dom'

import { modulos } from '@/lib/modulos'
import { useMe } from '@/lib/use-me'

// v2.5.1b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - "Início" só mostrava sessão e
// permissão, não servia pra nada. Esta é a página que lança os módulos: um card por módulo que
// o usuário tem permissão de usar, igual à referência que o usuário mostrou (grade de módulos,
// não uma barra lateral que cresce sem parar a cada fase nova). A barra lateral (Shell.tsx)
// agora só tem "Início" e "Meu Perfil" - uso pessoal, sempre visível; todo módulo de negócio
// vive aqui.
export function Home() {
  const { data } = useMe()
  const permissoes = data?.permissoes ?? []
  const modulosVisiveis = modulos.filter((m) =>
    permissoes.includes(m.permissao),
  )

  return (
    <>
      <h1 className="text-2xl font-bold">Início</h1>
      <p className="mt-2 text-muted-foreground">
        Bem-vindo{data?.nome_completo ? `, ${data.nome_completo}` : ''} ao
        painel da ASAF.
      </p>

      <section className="mt-6">
        <h2 className="mb-3 font-semibold">Módulos</h2>
        {modulosVisiveis.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum módulo disponível para o seu nível de acesso.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {modulosVisiveis.map((m) => (
              <Link
                key={m.rota}
                to={m.rota}
                className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center transition-colors hover:border-primary hover:bg-accent"
              >
                <m.icone className="h-8 w-8 text-primary" />
                <span className="font-medium">{m.rotulo}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
