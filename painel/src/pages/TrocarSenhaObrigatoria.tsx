import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { ApiError, alterarSenha, logout, type Me } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useMe } from '@/lib/use-me'

// Achado da v6.2d - a senha que a secretaria dá em "Conceder acesso" é provisória e a tela promete que o associado "será obrigado a trocá-la no primeiro login": até
// aqui o painel não obrigava. Enquanto `/auth/me` disser `senha_provisoria`, o painel inteiro leva a esta tela (`RequireSenhaDefinitiva` em App.tsx), como faz com o MFA
// obrigatório. O servidor recusa a senha nova igual à atual e aplica a mesma regra de senha forte de sempre. Quem chega aqui sem a senha provisória volta ao início.
const MINIMO = 8

function mensagemDeErro(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof TypeError) {
    return 'Não foi possível conectar ao servidor. Tente novamente em instantes.'
  }
  return 'Não foi possível trocar a senha. Tente novamente.'
}

const classeCampo =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

export function TrocarSenhaObrigatoria() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { data: eu } = useMe()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function sair() {
    await logout()
    signOut()
  }

  async function trocar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!atual) return setErro('Informe a senha provisória que você recebeu.')
    if (nova.length < MINIMO)
      return setErro(`A senha nova deve ter pelo menos ${MINIMO} caracteres.`)
    if (nova !== confirmacao) return setErro('As senhas novas não conferem.')
    if (nova === atual)
      return setErro('A senha nova precisa ser diferente da provisória.')
    setCarregando(true)
    try {
      await alterarSenha({ senha_atual: atual, senha_nova: nova })
    } catch (err) {
      setErro(mensagemDeErro(err))
      setCarregando(false)
      return
    }
    // A senha foi trocada: a cópia guardada do /auth/me (até 30 s) é atualizada aqui mesmo, sem depender da rede; só invalidar não basta, a
    // guarda leria a cópia velha, ainda com senha_provisoria, e mandaria de volta para cá. A busca de verdade vem em seguida.
    queryClient.setQueryData<Me>(['me'], (antes) =>
      antes ? { ...antes, senha_provisoria: false } : antes,
    )
    void queryClient.invalidateQueries({ queryKey: ['me'] })
    navigate('/', { replace: true })
  }

  if (eu && !eu.senha_provisoria) return <Navigate to="/" replace />

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-xl font-bold">Troque a sua senha</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Você entrou com a senha provisória que a secretaria lhe entregou. Para
        continuar, escolha uma senha só sua (pelo menos {MINIMO} caracteres).
      </p>

      {erro && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      <form
        onSubmit={trocar}
        className="mt-6 v3-space-y-4 rounded-xl border border-border bg-card p-6"
      >
        {/* para o gerenciador de senhas ligar a senha nova à conta certa */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={eu?.email ?? ''}
          readOnly
          hidden
        />
        <div>
          <label htmlFor="senha-provisoria" className="text-sm font-medium">
            Senha provisória
          </label>
          <input
            id="senha-provisoria"
            type="password"
            autoComplete="current-password"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
            className={classeCampo}
          />
        </div>
        <div>
          <label htmlFor="senha-nova" className="text-sm font-medium">
            Senha nova
          </label>
          <input
            id="senha-nova"
            type="password"
            autoComplete="new-password"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            className={classeCampo}
          />
        </div>
        <div>
          <label htmlFor="senha-confirmacao" className="text-sm font-medium">
            Repita a senha nova
          </label>
          <input
            id="senha-confirmacao"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            className={classeCampo}
          />
        </div>
        <Button type="submit" className="w-full" disabled={carregando}>
          {carregando ? 'Trocando…' : 'Trocar a senha'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={sair}
        >
          Sair
        </Button>
      </form>
    </main>
  )
}
