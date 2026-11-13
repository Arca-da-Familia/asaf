import { useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import {
  CAMPO_DA_ENTRADA,
  ROTULO_DA_ENTRADA,
  TelaDeEntrada,
} from '@/components/layout/TelaDeEntrada'
import { Button } from '@/components/ui/button'
import { ApiError, mfaAtivar, mfaConfirmar, type Me } from '@/lib/api'
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
    // Achado ao construir a troca obrigatória da senha (depois da v6.2d): só invalidar o /auth/me não bastava, porque a guarda lia a cópia
    // guardada (até 30 s), ainda com mfa_pendente, e mandava de volta para cá. O MFA acabou de ser ativado: a cópia é atualizada aqui mesmo
    // (sem depender da rede) e a busca de verdade vem em seguida.
    queryClient.setQueryData<Me>(['me'], (antes) =>
      antes ? { ...antes, mfa_pendente: false, mfa_ativado: true } : antes,
    )
    void queryClient.invalidateQueries({ queryKey: ['me'] })
    navigate('/', { replace: true })
  }

  return (
    <TelaDeEntrada>
      <h1 className="text-[26px] leading-tight font-extrabold">
        Ativação obrigatória de MFA
      </h1>
      <p className="text-[15px] text-muted-foreground">
        Seu nível de acesso exige autenticação em duas etapas. Escaneie o QR
        code com o app autenticador e informe o código gerado.
      </p>

      {erro && (
        <p
          role="alert"
          className="rounded-xl border border-destructive/40 bg-perigo-tinta px-3.5 py-2.5 text-sm font-semibold text-destructive"
        >
          {erro}
        </p>
      )}

      {codigos ? (
        <section className="rounded-2xl border border-border bg-card p-5">
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
        <section className="rounded-2xl border border-border bg-card p-5">
          {otpauthUri ? (
            <div className="flex justify-center">
              <QRCodeSVG value={otpauthUri} size={180} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Gerando QR code…</p>
          )}

          <form onSubmit={confirmar} className="mt-4 v3-space-y-4">
            <div>
              <label htmlFor="codigo" className={ROTULO_DA_ENTRADA}>
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
                className={`${CAMPO_DA_ENTRADA} h-14 text-center text-[24px] font-extrabold tracking-[0.3em]`}
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
    </TelaDeEntrada>
  )
}
