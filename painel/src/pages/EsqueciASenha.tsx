import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { AvisoDeAmbiente } from '@/components/layout/AvisoDeAmbiente'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  pedirCodigoDeNovaSenha,
  trocarSenhaComCodigo,
} from '@/lib/api'
import { formatarCpf, somenteDigitos, validarCpf } from '@/lib/cpf'

// Esqueci a minha senha (pedido do Presidente em 21/10): o CPF pede um código, que vai para o e-mail cadastrado; com ele a pessoa escolhe a senha nova. A resposta ao pedido é a
// mesma exista ou não uma conta (ninguém descobre quem tem acesso pelo CPF); o código vale 10 minutos e serve uma vez. Trocar aqui encerra as sessões abertas (nenhuma se renova;
// o acesso já aberto vale no máximo 45 minutos, `ACCESS_TOKEN_MINUTOS`); o segundo passo (MFA), quando o nível exige, continua sendo pedido ao entrar. Na homologação (sem
// servidor de e-mail) o servidor devolve o código, só de conta sem permissão do sistema, e a tela o mostra, para dar para testar.
const MINIMO = 8
const classeCampo =
  'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

function mensagemDeErro(err: unknown): string {
  if (err instanceof ApiError) return err.detail
  if (err instanceof TypeError) {
    return 'Não foi possível conectar ao servidor. Tente novamente em instantes.'
  }
  return 'Não foi possível concluir. Tente novamente.'
}

type Etapa = 'cpf' | 'codigo' | 'pronto'

export function EsqueciASenha() {
  const [etapa, setEtapa] = useState<Etapa>('cpf')
  const [cpf, setCpf] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [codigoDeTeste, setCodigoDeTeste] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function pedir(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    const cpfLimpo = somenteDigitos(cpf)
    if (!validarCpf(cpfLimpo))
      return setErro('CPF inválido. Confira os dígitos e tente novamente.')
    setCarregando(true)
    try {
      const r = await pedirCodigoDeNovaSenha(cpfLimpo)
      setAviso(r.mensagem)
      setCodigoDeTeste(r.codigo_de_teste ?? null)
      setCodigo('')
      setEtapa('codigo')
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregando(false)
    }
  }

  async function trocar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (somenteDigitos(codigo).length !== 6)
      return setErro('Informe os 6 números do código que chegou por e-mail.')
    if (nova.length < MINIMO)
      return setErro(`A senha nova deve ter pelo menos ${MINIMO} caracteres.`)
    if (nova !== confirmacao) return setErro('As senhas novas não conferem.')
    setCarregando(true)
    try {
      await trocarSenhaComCodigo({
        cpf: somenteDigitos(cpf),
        codigo: somenteDigitos(codigo),
        senha_nova: nova,
      })
      setEtapa('pronto')
    } catch (err) {
      setErro(mensagemDeErro(err))
    } finally {
      setCarregando(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-muted/40">
      <AvisoDeAmbiente />
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xs">
          <h1 className="text-xl font-bold">Esqueci a minha senha</h1>

          {erro && (
            <p
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {erro}
            </p>
          )}

          {etapa === 'cpf' && (
            <form onSubmit={pedir} className="mt-4 v3-space-y-4">
              <p className="text-sm text-muted-foreground">
                Informe o seu CPF. Se ele tiver acesso ao painel, enviamos um
                código para o e-mail cadastrado.
              </p>
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
                  className={classeCampo}
                />
              </div>
              <Button type="submit" className="w-full" disabled={carregando}>
                {carregando ? 'Enviando…' : 'Enviar o código'}
              </Button>
            </form>
          )}

          {etapa === 'codigo' && (
            <form onSubmit={trocar} className="mt-4 v3-space-y-4">
              {aviso && (
                <p role="status" className="text-sm text-muted-foreground">
                  {aviso}
                </p>
              )}
              {codigoDeTeste && (
                <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                  Ambiente de TESTE (sem envio de e-mail): o código é{' '}
                  <strong data-testid="codigo-de-teste">{codigoDeTeste}</strong>
                </p>
              )}
              {/* para o gerenciador de senhas ligar a senha nova à conta certa */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={somenteDigitos(cpf)}
                readOnly
                hidden
              />
              <div>
                <label htmlFor="codigo" className="text-sm font-medium">
                  Código recebido por e-mail
                </label>
                <input
                  id="codigo"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={codigo}
                  onChange={(e) => setCodigo(somenteDigitos(e.target.value))}
                  placeholder="000000"
                  className={`${classeCampo} tracking-widest`}
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
                <label
                  htmlFor="senha-confirmacao"
                  className="text-sm font-medium"
                >
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
                onClick={() => {
                  setErro(null)
                  setEtapa('cpf')
                }}
              >
                Pedir outro código
              </Button>
            </form>
          )}

          {etapa === 'pronto' && (
            <p role="status" className="mt-4 text-sm">
              Senha trocada. As sessões que estavam abertas não se renovam mais
              e se encerram em até 45 minutos. Entre com o seu CPF e a senha
              nova.
            </p>
          )}

          <p className="mt-6 text-center text-sm">
            <Link
              to="/login"
              className="text-primary underline-offset-4 hover:underline"
            >
              Voltar para entrar
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
