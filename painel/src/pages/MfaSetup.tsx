import { useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { ApiError, mfaAtivar, mfaConfirmar } from '@/lib/api'
import { somenteDigitos } from '@/lib/cpf'

function mensagemDeErro(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof TypeError) {
    return 'Não foi possível conectar ao servidor. Tente novamente em instantes.'
  }
  if (err instanceof Error) return err.message
  return 'Erro inesperado. Tente novamente.'
}

export function MfaSetup() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [otpauthUri, setOtpauthUri] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [codigos, setCodigos] = useState<string[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    let ativo = true
    mfaAtivar()
      .then((r) => {
        if (ativo) setOtpauthUri(r.otpauth_uri)
      })
      .catch((err) => {
        if (ativo) setErro(mensagemDeErro(err))
      })
    return () => {
      ativo = false
    }
  }, [])

  async function confirmar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setCarregando(true)
    try {
      const r = await mfaConfirmar(somenteDigitos(codigo))
      setCodigos(r.codigos_recuperacao)
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregando(false)
    }
  }

  function concluir() {
    // Revalida o /auth/me para o gate liberar a navegação (mfa_pendente passa a false).
    queryClient.invalidateQueries({ queryKey: ['me'] })
    navigate('/', { replace: true })
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-xl font-bold">Ativação obrigatória de MFA</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Seu nível de acesso exige autenticação em duas etapas. Escaneie o QR
        code com o app autenticador e informe o código gerado.
      </p>

      {erro && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      {codigos ? (
        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Códigos de recuperação</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Guarde estes códigos em local seguro. Eles são mostrados uma única
            vez e substituem o autenticador caso você perca o celular.
          </p>
          <ul className="mt-4 grid grid-cols-2 gap-2 font-mono text-sm">
            {codigos.map((c) => (
              <li key={c} className="rounded-md bg-muted px-3 py-2 text-center">
                {c}
              </li>
            ))}
          </ul>
          <Button className="mt-6 w-full" onClick={concluir}>
            Guardei os códigos — concluir
          </Button>
        </section>
      ) : (
        <section className="mt-6 rounded-xl border border-border bg-card p-6">
          {otpauthUri ? (
            <div className="flex justify-center">
              <QRCodeSVG value={otpauthUri} size={180} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Gerando QR code…</p>
          )}

          <form onSubmit={confirmar} className="mt-4 space-y-4">
            <div>
              <label htmlFor="codigo" className="text-sm font-medium">
                Código do autenticador
              </label>
              <input
                id="codigo"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="one-time-code"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(somenteDigitos(e.target.value))}
                placeholder="000000"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tracking-widest"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={carregando || !otpauthUri}
            >
              {carregando ? 'Verificando…' : 'Confirmar'}
            </Button>
          </form>
        </section>
      )}
    </main>
  )
}
