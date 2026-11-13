import {
  browserSupportsWebAuthn,
  startAuthentication,
} from '@simplewebauthn/browser'
import { Eye, EyeOff, Fingerprint } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import {
  CAMPO_DA_ENTRADA,
  PassosDaEntrada,
  ROTULO_DA_ENTRADA,
  TelaDeEntrada,
} from '@/components/layout/TelaDeEntrada'
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
import { ID_DO_ERRO, useErroDeFormulario } from '@/lib/erro-de-formulario'

function mensagemDeErro(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof TypeError) {
    return 'Não foi possível conectar ao servidor. Tente novamente em instantes.'
  }
  if (err instanceof Error) return err.message
  return 'Erro inesperado. Tente novamente.'
}

// v9.5a - o novo visual aprovado pelo Presidente (rodada 3, 13/11): "metade verde, metade formulário" no notebook e "topo verde e cartão" no celular
// (TelaDeEntrada). O que a tela faz não mudou: CPF e senha → código do aplicativo (ou de recuperação), ou a chave de acesso (digital/rosto), que dispensa
// os dois. Novidades: "Mostrar" a senha; o código é conferido sozinho quando os 6 números entram (digitados ou colados), como o Presidente pediu.
const BOTAO_GRANDE =
  'h-[50px] min-h-[50px] w-full rounded-xl text-base font-bold'

export function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [cpf, setCpf] = useState('')
  const [senha, setSenha] = useState('')
  const [mostrarSenha, setMostrarSenha] = useState(false)
  const [codigoTotp, setCodigoTotp] = useState('')
  const [modoRecuperacao, setModoRecuperacao] = useState(false)
  const [loginTempToken, setLoginTempToken] = useState<string | null>(null)
  const { erro, setErro, doCampo } = useErroDeFormulario()
  const [carregando, setCarregando] = useState(false)
  // Painel é SPA (sem renderização no servidor): dá pra perguntar ao navegador já na criação do
  // estado, sem efeito (a regra react-hooks/set-state-in-effect do React 19 reprova o efeito).
  const [passkeySuportada] = useState(browserSupportsWebAuthn)
  const [carregandoPasskey, setCarregandoPasskey] = useState(false)
  // o código pode ser enviado sozinho (6 números) e pelo Enter ao mesmo tempo: só um envio por vez
  const enviandoCodigo = useRef(false)
  const formularioDoCodigo = useRef<HTMLFormElement>(null)

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
      setErro('CPF inválido. Confira os dígitos e tente novamente.', 'cpf')
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
    if (enviandoCodigo.current) return
    setErro(null)

    if (!loginTempToken) {
      setErro('O tempo para entrar acabou. Volte e tente de novo.')
      return
    }

    enviandoCodigo.current = true
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
      // o código do autenticador (ou de recuperação) não foi aceito: o foco volta para ele
      setErro(mensagemDeErro(err), 'codigo')
    } finally {
      enviandoCodigo.current = false
      setCarregando(false)
    }
  }

  function mudarCodigo(valor: string) {
    if (modoRecuperacao) {
      setCodigoTotp(valor.toUpperCase())
      return
    }
    // colado com espaço ou traço ("482 913", "482-913") também vale: ficam só os números
    const numeros = somenteDigitos(valor).slice(0, 6)
    setCodigoTotp(numeros)
    if (numeros.length === 6 && numeros !== codigoTotp) {
      // os 6 números entraram: confere sozinho, depois que a tela mostra o código completo
      requestAnimationFrame(() => formularioDoCodigo.current?.requestSubmit())
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

  const mensagemDeErroNaTela = erro && (
    <p
      id={ID_DO_ERRO}
      role="alert"
      className="rounded-xl border border-destructive/40 bg-perigo-tinta px-3.5 py-2.5 text-sm font-semibold text-destructive"
    >
      {erro}
    </p>
  )

  if (loginTempToken) {
    return (
      <TelaDeEntrada
        passos={<PassosDaEntrada nomes={['CPF e senha', 'Código']} atual={1} />}
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-[26px] leading-tight font-extrabold">
            {modoRecuperacao ? 'Sem o celular?' : 'Falta só o código'}
          </h1>
          <p className="text-[15px] text-muted-foreground">
            {modoRecuperacao
              ? 'Digite um dos códigos de recuperação que você guardou quando ligou o aplicativo.'
              : 'Abra o aplicativo autenticador no seu celular e digite os 6 números da ASAF. Também pode copiar e colar.'}
          </p>
        </div>
        {mensagemDeErroNaTela}
        <form
          ref={formularioDoCodigo}
          onSubmit={enviarSegundoPasso}
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="codigo" className={ROTULO_DA_ENTRADA}>
              {modoRecuperacao
                ? 'Código de recuperação'
                : 'Código do aplicativo'}
            </label>
            <input
              id="codigo"
              {...doCampo('codigo')}
              inputMode={modoRecuperacao ? 'text' : 'numeric'}
              enterKeyHint="done"
              autoComplete="one-time-code"
              maxLength={modoRecuperacao ? 14 : 20}
              value={codigoTotp}
              onChange={(e) => mudarCodigo(e.target.value)}
              placeholder={modoRecuperacao ? 'XXXX-XXXX-XXXX' : '000000'}
              className={`${CAMPO_DA_ENTRADA} ${
                modoRecuperacao
                  ? 'h-14 text-lg tracking-widest'
                  : 'h-16 text-center font-titulo text-[30px] font-extrabold tracking-[0.3em]'
              }`}
            />
          </div>
          <Button type="submit" className={BOTAO_GRANDE} disabled={carregando}>
            {carregando ? 'Verificando…' : 'Verificar'}
          </Button>
          <p className="flex flex-wrap items-center justify-center gap-x-1 text-sm">
            {!modoRecuperacao && (
              <span className="text-muted-foreground">
                Não está com o celular?
              </span>
            )}
            <Button
              type="button"
              variant="link"
              className="h-auto min-h-0 px-1 py-1 font-bold text-azul-texto"
              onClick={alternarModo}
              disabled={carregando}
            >
              {modoRecuperacao
                ? 'Usar código do autenticador'
                : 'Usar código de recuperação'}
            </Button>
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-12 min-h-12 w-full rounded-xl border-[1.5px] border-input text-[15px] font-bold"
            onClick={voltar}
            disabled={carregando}
          >
            Voltar
          </Button>
        </form>
      </TelaDeEntrada>
    )
  }

  return (
    <TelaDeEntrada>
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight font-extrabold">
          Entrar no painel
        </h1>
        <p className="text-[15px] text-muted-foreground">
          Use o seu CPF e a sua senha.
        </p>
      </div>
      {mensagemDeErroNaTela}
      <form onSubmit={enviarPrimeiroPasso} className="flex flex-col gap-4">
        <div>
          <label htmlFor="cpf" className={ROTULO_DA_ENTRADA}>
            CPF
          </label>
          <input
            id="cpf"
            {...doCampo('cpf')}
            inputMode="numeric"
            autoComplete="username"
            value={cpf}
            onChange={(e) => setCpf(formatarCpf(e.target.value))}
            placeholder="000.000.000-00"
            className={CAMPO_DA_ENTRADA}
          />
        </div>
        <div>
          <label htmlFor="senha" className={ROTULO_DA_ENTRADA}>
            Senha
          </label>
          <div className="relative">
            <input
              id="senha"
              {...doCampo('senha')}
              type={mostrarSenha ? 'text' : 'password'}
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className={`${CAMPO_DA_ENTRADA} pr-28`}
            />
            {/* o nome do botão não leva a palavra do rótulo do campo: quem procura o campo pelo rótulo acha só o campo */}
            <button
              type="button"
              onClick={() => setMostrarSenha((m) => !m)}
              aria-pressed={mostrarSenha}
              aria-controls="senha"
              className="absolute top-1/2 right-2 mt-[3px] flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-bold text-azul-texto"
            >
              {mostrarSenha ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
              {mostrarSenha ? 'Esconder' : 'Mostrar'}
            </button>
          </div>
        </div>
        <Button type="submit" className={BOTAO_GRANDE} disabled={carregando}>
          {carregando ? 'Entrando…' : 'Entrar'}
        </Button>
        <p className="text-center text-sm">
          <Link
            to="/esqueci-a-senha"
            className="font-bold text-azul-texto underline-offset-4 hover:underline"
          >
            Esqueci a minha senha
          </Link>
        </p>
        {passkeySuportada && (
          <>
            <div
              aria-hidden="true"
              className="flex items-center gap-3 text-[13px] text-muted-foreground"
            >
              <span className="h-px flex-1 bg-border" />
              ou
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="outline"
                className="h-[50px] min-h-[50px] w-full rounded-xl border-[1.5px] border-input text-[15px] font-bold"
                onClick={entrarComPasskey}
                disabled={carregandoPasskey}
                aria-describedby="dica-da-chave"
              >
                <Fingerprint aria-hidden="true" />
                {carregandoPasskey
                  ? 'Verificando…'
                  : 'Entrar com chave de acesso'}
              </Button>
              <p
                id="dica-da-chave"
                className="text-center text-[12.5px] text-muted-foreground"
              >
                Digital, rosto ou PIN deste aparelho, para quem já o cadastrou
                no perfil. Dispensa a senha e o código.
              </p>
            </div>
          </>
        )}
      </form>
    </TelaDeEntrada>
  )
}
