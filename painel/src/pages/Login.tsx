import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  ApiError,
  login,
  loginMfa,
  webauthnLoginConcluir,
  webauthnLoginIniciar,
  type TokenPayload,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { formatarCpf, somenteDigitos, validarCpf } from '@/lib/cpf'

function mensagemDeErro(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof TypeError) {
    return 'Não foi possível conectar ao servidor. Tente novamente em instantes.'
  }
  if (err instanceof Error) return err.message
  return 'Erro inesperado. Tente novamente.'
}

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [cpf, setCpf] = useState('')
  const [senha, setSenha] = useState('')
  const [codigoTotp, setCodigoTotp] = useState('')
  const [modoRecuperacao, setModoRecuperacao] = useState(false)
  const [loginTempToken, setLoginTempToken] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [passkeySuportada, setPasskeySuportada] = useState(false)
  const [carregandoPasskey, setCarregandoPasskey] = useState(false)

  useEffect(() => {
    setPasskeySuportada(browserSupportsWebAuthn())
  }, [])

  function aplicarSessao(token: TokenPayload) {
    signIn(token.access_token)
    navigate('/', { replace: true })
  }

  async function entrarComPasskey() {
    setErro(null)
    setCarregandoPasskey(true)
    try {
      const { opcoes, desafio_token } = await webauthnLoginIniciar()
      const resposta = await startAuthentication({
        optionsJSON: opcoes as never,
      })
      const token = await webauthnLoginConcluir({
        credencial: resposta as unknown as Record<string, unknown>,
        desafio_token,
      })
      aplicarSessao(token)
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregandoPasskey(false)
    }
  }

  async function enviarPrimeiroPasso(e: FormEvent) {
    e.preventDefault()
    setErro(null)

    const cpfLimpo = somenteDigitos(cpf)
    if (!validarCpf(cpfLimpo)) {
      setErro('CPF inválido. Confira os dígitos e tente novamente.')
      return
    }

    setCarregando(true)
    try {
      const resposta = await login({ cpf: cpfLimpo, senha })
      if (resposta.requer_mfa) {
        setLoginTempToken(resposta.login_temp_token ?? null)
      } else {
        aplicarSessao(resposta)
      }
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregando(false)
    }
  }

  async function enviarSegundoPasso(e: FormEvent) {
    e.preventDefault()
    setErro(null)

    if (!loginTempToken) {
      setErro('Sessão de login expirada. Volte e tente novamente.')
      return
    }

    setCarregando(true)
    try {
      const resposta = modoRecuperacao
        ? await loginMfa({
            cpf: somenteDigitos(cpf),
            codigo_recuperacao: codigoTotp,
            login_temp_token: loginTempToken,
          })
        : await loginMfa({
            cpf: somenteDigitos(cpf),
            codigo_totp: somenteDigitos(codigoTotp),
            login_temp_token: loginTempToken,
          })
      aplicarSessao(resposta)
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregando(false)
    }
  }

  function voltar() {
    setLoginTempToken(null)
    setCodigoTotp('')
    setModoRecuperacao(false)
    setErro(null)
  }

  function alternarModo() {
    setModoRecuperacao((m) => !m)
    setCodigoTotp('')
    setErro(null)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-bold">ASAF · Painel</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loginTempToken
            ? 'Informe o código do seu autenticador.'
            : 'Entre com seu CPF e senha.'}
        </p>

        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}

        {!loginTempToken ? (
          <form onSubmit={enviarPrimeiroPasso} className="mt-6 space-y-4">
            <div>
              <label htmlFor="cpf" className="text-sm font-medium">
                CPF
              </label>
              <input
                id="cpf"
                inputMode="numeric"
                autoComplete="username"
                value={cpf}
                onChange={(e) => setCpf(formatarCpf(e.target.value))}
                placeholder="000.000.000-00"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="senha" className="text-sm font-medium">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" className="w-full" disabled={carregando}>
              {carregando ? 'Entrando…' : 'Entrar'}
            </Button>
            {passkeySuportada && (
              <>
                <div className="relative py-1 text-center text-xs text-muted-foreground">
                  <span className="bg-card px-2">ou</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={entrarComPasskey}
                  disabled={carregandoPasskey}
                >
                  {carregandoPasskey ? 'Verificando…' : 'Entrar com chave de acesso'}
                </Button>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={enviarSegundoPasso} className="mt-6 space-y-4">
            <div>
              <label htmlFor="codigo" className="text-sm font-medium">
                {modoRecuperacao ? 'Código de recuperação' : 'Código TOTP'}
              </label>
              <input
                id="codigo"
                inputMode={modoRecuperacao ? 'text' : 'numeric'}
                enterKeyHint="done"
                autoComplete="one-time-code"
                maxLength={modoRecuperacao ? 14 : 6}
                value={codigoTotp}
                onChange={(e) =>
                  setCodigoTotp(
                    modoRecuperacao
                      ? e.target.value.toUpperCase()
                      : somenteDigitos(e.target.value),
                  )
                }
                placeholder={modoRecuperacao ? 'XXXX-XXXX-XXXX' : '000000'}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tracking-widest"
              />
            </div>
            <Button type="submit" className="w-full" disabled={carregando}>
              {carregando ? 'Verificando…' : 'Verificar'}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              onClick={alternarModo}
              disabled={carregando}
            >
              {modoRecuperacao
                ? 'Usar código do autenticador'
                : 'Usar código de recuperação'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={voltar}
              disabled={carregando}
            >
              Voltar
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
