import { CheckCircle2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import {
  CAMPO_DA_ENTRADA,
  PassosDaEntrada,
  ROTULO_DA_ENTRADA,
  TelaDeEntrada,
} from '@/components/layout/TelaDeEntrada'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  pedirCodigoDeNovaSenha,
  trocarSenhaComCodigo,
} from '@/lib/api'
import { formatarCpf, somenteDigitos, validarCpf } from '@/lib/cpf'
import { ID_DO_ERRO, useErroDeFormulario } from '@/lib/erro-de-formulario'

// Esqueci a minha senha (pedido do Presidente em 21/10): o CPF pede um código, que vai para o e-mail cadastrado; com ele a pessoa escolhe a senha nova. A resposta ao pedido é a
// mesma exista ou não uma conta (ninguém descobre quem tem acesso pelo CPF); o código vale 10 minutos e serve uma vez. Trocar aqui encerra as sessões abertas (nenhuma se renova;
// o acesso já aberto vale no máximo 45 minutos, `ACCESS_TOKEN_MINUTOS`); o segundo passo (MFA), quando o nível exige, continua sendo pedido ao entrar. Na homologação (sem
// servidor de e-mail) o servidor devolve o código, só de conta sem permissão do sistema, e a tela o mostra, para dar para testar.
// v9.5a - novo visual aprovado pelo Presidente (rodada 3, 13/11): a mesma "metade verde" da entrada, com os 3 passos acima do formulário (o pedido dele: os passos
// do lado direito, para o notebook não ficar com um fundão branco vazio). O que a tela faz não mudou.
const MINIMO = 8
const classeCampo = CAMPO_DA_ENTRADA
const PASSOS = ['Seu CPF', 'Código do e-mail', 'Senha nova']
const ATUAL = { cpf: 0, codigo: 1, pronto: 3 } as const
const BOTAO_GRANDE =
  'h-[50px] min-h-[50px] w-full rounded-xl text-base font-bold'
const BOTAO_LINHA =
  'h-12 min-h-12 w-full rounded-xl border-[1.5px] border-input text-[15px] font-bold'

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
  const { erro, setErro, doCampo } = useErroDeFormulario()
  const [carregando, setCarregando] = useState(false)

  async function pedir(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    const cpfLimpo = somenteDigitos(cpf)
    if (!validarCpf(cpfLimpo))
      return setErro(
        'CPF inválido. Confira os dígitos e tente novamente.',
        'cpf',
      )
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
      return setErro(
        'Informe os 6 números do código que chegou por e-mail.',
        'codigo',
      )
    if (nova.length < MINIMO)
      return setErro(
        `A senha nova deve ter pelo menos ${MINIMO} caracteres.`,
        'senha-nova',
      )
    if (nova !== confirmacao)
      return setErro('As senhas novas não conferem.', 'senha-confirmacao')
    setCarregando(true)
    try {
      await trocarSenhaComCodigo({
        cpf: somenteDigitos(cpf),
        codigo: somenteDigitos(codigo),
        senha_nova: nova,
      })
      setEtapa('pronto')
    } catch (err) {
      // o servidor recusa o código (errado, vencido ou já usado): o foco volta para ele
      setErro(mensagemDeErro(err), 'codigo')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <TelaDeEntrada
      passos={<PassosDaEntrada nomes={PASSOS} atual={ATUAL[etapa]} />}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] leading-tight font-extrabold">
          Esqueci a minha senha
        </h1>
        {etapa === 'codigo' && (
          <p className="text-[15px] text-muted-foreground">
            Digite os 6 números que chegaram no seu e-mail e escolha a senha
            nova.
          </p>
        )}
      </div>

      {erro && (
        <p
          id={ID_DO_ERRO}
          role="alert"
          className="rounded-xl border border-destructive/40 bg-perigo-tinta px-3.5 py-2.5 text-sm font-semibold text-destructive"
        >
          {erro}
        </p>
      )}

      {etapa === 'cpf' && (
        <form onSubmit={pedir} className="flex flex-col gap-4">
          <p className="text-[15px] text-muted-foreground">
            Informe o seu CPF. Se ele tiver acesso ao painel, enviamos um código
            para o e-mail cadastrado.
          </p>
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
              className={classeCampo}
            />
          </div>
          <Button type="submit" className={BOTAO_GRANDE} disabled={carregando}>
            {carregando ? 'Enviando…' : 'Enviar o código'}
          </Button>
        </form>
      )}

      {etapa === 'codigo' && (
        <form onSubmit={trocar} className="flex flex-col gap-4">
          {aviso && (
            <p role="status" className="text-sm text-muted-foreground">
              {aviso}
            </p>
          )}
          {codigoDeTeste && (
            <p className="rounded-xl border border-primary/30 bg-verde-tinta px-3.5 py-2.5 text-sm">
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
            <label htmlFor="codigo" className={ROTULO_DA_ENTRADA}>
              Código recebido por e-mail
            </label>
            <input
              id="codigo"
              {...doCampo('codigo')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={codigo}
              onChange={(e) => setCodigo(somenteDigitos(e.target.value))}
              placeholder="000000"
              className={`${classeCampo} h-14 text-center font-titulo text-[26px] font-extrabold tracking-[0.3em]`}
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
              aria-describedby="dica-da-senha"
              className={classeCampo}
            />
            <p
              id="dica-da-senha"
              className="mt-1 text-[12.5px] text-muted-foreground"
            >
              Pelo menos {MINIMO} caracteres.
            </p>
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
          <Button type="submit" className={BOTAO_GRANDE} disabled={carregando}>
            {carregando ? 'Trocando…' : 'Trocar a senha'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={BOTAO_LINHA}
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
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2
            className="size-16 text-verde-texto"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          <p role="status" className="text-[15px]">
            Senha trocada. As sessões que estavam abertas não se renovam mais e
            se encerram em até 45 minutos. Entre com o seu CPF e a senha nova.
          </p>
        </div>
      )}

      <p className="text-center text-sm">
        <Link
          to="/login"
          className="font-bold text-azul-texto underline-offset-4 hover:underline"
        >
          Voltar para entrar
        </Link>
      </p>
    </TelaDeEntrada>
  )
}
