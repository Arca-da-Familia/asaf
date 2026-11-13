import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'

import {
  CAMPO_DA_ENTRADA,
  ROTULO_DA_ENTRADA,
  TelaDeEntrada,
} from '@/components/layout/TelaDeEntrada'
import { Button } from '@/components/ui/button'
import { ApiError, alterarSenha, logout, type Me } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useMe } from '@/lib/use-me'
import { ID_DO_ERRO, useErroDeFormulario } from '@/lib/erro-de-formulario'

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

const classeCampo = CAMPO_DA_ENTRADA

export function TrocarSenhaObrigatoria() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { data: eu } = useMe()
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const { erro, setErro, doCampo } = useErroDeFormulario()
  const [carregando, setCarregando] = useState(false)

  async function sair() {
    await logout()
    signOut()
  }

  async function trocar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!atual)
      return setErro(
        'Informe a senha provisória que você recebeu.',
        'senha-provisoria',
      )
    if (nova.length < MINIMO)
      return setErro(
        `A senha nova deve ter pelo menos ${MINIMO} caracteres.`,
        'senha-nova',
      )
    if (nova !== confirmacao)
      return setErro('As senhas novas não conferem.', 'senha-confirmacao')
    if (nova === atual)
      return setErro(
        'A senha nova precisa ser diferente da provisória.',
        'senha-nova',
      )
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
    <TelaDeEntrada>
      <h1 className="text-[26px] leading-tight font-extrabold">
        Troque a sua senha
      </h1>
      <p className="text-[15px] text-muted-foreground">
        Você entrou com a senha provisória que a secretaria lhe entregou. Para
        continuar, escolha uma senha só sua (pelo menos {MINIMO} caracteres).
      </p>

      {erro && (
        <p
          id={ID_DO_ERRO}
          role="alert"
          className="rounded-xl border border-destructive/40 bg-perigo-tinta px-3.5 py-2.5 text-sm font-semibold text-destructive"
        >
          {erro}
        </p>
      )}

      <form onSubmit={trocar} className="flex flex-col gap-4">
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
          <label htmlFor="senha-provisoria" className={ROTULO_DA_ENTRADA}>
            Senha provisória
          </label>
          <input
            id="senha-provisoria"
            {...doCampo('senha-provisoria')}
            type="password"
            autoComplete="current-password"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
            className={classeCampo}
          />
        </div>
        <div>
          <label htmlFor="senha-nova" className={ROTULO_DA_ENTRADA}>
            Senha nova
          </label>
          <input
            id="senha-nova"
            {...doCampo('senha-nova')}
            type="password"
            autoComplete="new-password"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            className={classeCampo}
          />
        </div>
        <div>
          <label htmlFor="senha-confirmacao" className={ROTULO_DA_ENTRADA}>
            Repita a senha nova
          </label>
          <input
            id="senha-confirmacao"
            {...doCampo('senha-confirmacao')}
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            className={classeCampo}
          />
        </div>
        <Button
          type="submit"
          className="h-[50px] min-h-[50px] w-full rounded-xl text-base font-bold"
          disabled={carregando}
        >
          {carregando ? 'Trocando…' : 'Trocar a senha'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 min-h-12 w-full rounded-xl border-[1.5px] border-input text-[15px] font-bold"
          onClick={sair}
        >
          Sair
        </Button>
      </form>
    </TelaDeEntrada>
  )
}
