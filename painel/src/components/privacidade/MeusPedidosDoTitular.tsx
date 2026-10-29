import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  baixarMeuRelatorio,
  fazerPedidoDoTitular,
  obterMeusPedidosDoTitular,
  type MeuPedidoDoTitular,
  type PedidoFeito,
} from '@/lib/privacidade'

// v7.2e (FASE 7) - "Meus dados pessoais" no Meu Perfil: a pessoa pede à associação o que a LGPD lhe garante (art. 18) sobre o próprio cadastro, sem sair do
// painel. Quem entrou no painel já passou pela senha e pelo segundo passo: a identidade nasce validada. A resposta, o resultado e o fundamento aparecem aqui, e o
// relatório liberado pelo encarregado é baixado aqui mesmo.
export function MeusPedidosDoTitular() {
  const queryClient = useQueryClient()
  const idDireito = useId()
  const idMensagem = useId()
  const [direito, setDireito] = useState('')
  const [mensagem, setMensagem] = useState('')
  const [leu, setLeu] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<PedidoFeito | null>(null)

  const dados = useQuery({
    queryKey: ['meus-pedidos-do-titular'],
    queryFn: obterMeusPedidosDoTitular,
    retry: false,
  })
  const pedir = useMutation({
    mutationFn: () =>
      fazerPedidoDoTitular({
        subtipo: direito,
        mensagem,
        aviso_lido: leu,
        versao_do_aviso: dados.data!.aviso.versao,
      }),
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      setFeito(r)
      setDireito('')
      setMensagem('')
      setLeu(false)
      queryClient.invalidateQueries({ queryKey: ['meus-pedidos-do-titular'] })
    },
    onError: (e) => setErro(mensagemDoErro(e, 'Não foi possível enviar.')),
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!direito) return setErro('Escolha o que você quer pedir.')
    if (mensagem.trim().length < 10)
      return setErro('Escreva o seu pedido (pelo menos 10 letras).')
    if (!leu) return setErro('Leia o aviso de privacidade e marque que leu.')
    pedir.mutate()
  }

  if (dados.isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (dados.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {mensagemDoErro(dados.error, 'Não foi possível abrir os seus pedidos.')}
      </p>
    )
  if (!dados.data) return null

  return (
    <div className="space-y-6">
      <section
        aria-label="Fazer um pedido sobre os meus dados"
        className="rounded-xl border border-border bg-card p-6"
      >
        <h2 className="font-semibold">Fazer um pedido sobre os meus dados</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A Lei Geral de Proteção de Dados garante que você peça à associação,
          por exemplo, para saber quais dados ela guarda sobre você, receber uma
          cópia, corrigir ou eliminar. O prazo de resposta é de até 15 dias, e a
          resposta aparece aqui.
        </p>
        {feito && (
          <p
            role="status"
            className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
            data-pedido-feito
          >
            {feito.ja_existia
              ? `Você já tinha este pedido: protocolo ${feito.protocolo}.`
              : feito.situacao === 'Respondido'
                ? `Pedido ${feito.protocolo} recebido e já respondido: veja a resposta abaixo.`
                : `Pedido ${feito.protocolo} recebido. Prazo de resposta: até ${formatarData(feito.prazo_em)}.${
                    feito.identidade_validada
                      ? ''
                      : ' Como a sua conta ainda não tem o segundo passo ligado, a equipe vai conferir a sua identidade antes de responder.'
                  }`}
          </p>
        )}
        <form onSubmit={enviar} noValidate className="mt-4 space-y-3">
          <div>
            <label htmlFor={idDireito} className="block text-sm font-medium">
              O que você quer pedir
            </label>
            <select
              id={idDireito}
              className={classeCampo}
              value={direito}
              onChange={(e) => setDireito(e.target.value)}
            >
              <option value="">Escolha…</option>
              {dados.data.direitos.map((d) => (
                <option key={d.codigo} value={d.codigo}>
                  {d.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={idMensagem} className="block text-sm font-medium">
              Explique o seu pedido
            </label>
            <textarea
              id={idMensagem}
              rows={4}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
            />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              Ler o aviso de privacidade (versão {dados.data.aviso.versao})
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {dados.data.aviso.texto}
            </p>
          </details>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={leu}
              onChange={(e) => setLeu(e.target.checked)}
            />
            Li o aviso de privacidade
          </label>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <Button type="submit" size="sm" disabled={pedir.isPending}>
            Enviar o pedido
          </Button>
        </form>
      </section>

      <section
        aria-label="Meus pedidos sobre dados pessoais"
        className="rounded-xl border border-border bg-card p-6"
      >
        <h2 className="font-semibold">Meus pedidos sobre dados pessoais</h2>
        {dados.data.pedidos.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Você ainda não fez nenhum pedido.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {dados.data.pedidos.map((p) => (
              <Pedido key={p.protocolo} p={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Pedido({ p }: { p: MeuPedidoDoTitular }) {
  const [erro, setErro] = useState<string | null>(null)
  const [baixando, setBaixando] = useState(false)

  async function baixar(formato: 'pdf' | 'json') {
    setErro(null)
    setBaixando(true)
    try {
      await baixarMeuRelatorio(p.protocolo, formato)
    } catch (e) {
      setErro(mensagemDoErro(e, 'Não foi possível baixar.'))
    } finally {
      setBaixando(false)
    }
  }

  return (
    <li
      className="rounded-md border border-border p-3 text-sm"
      data-meu-pedido={p.protocolo}
    >
      <p className="font-medium">
        Protocolo {p.protocolo} · {p.situacao}
      </p>
      <p className="text-muted-foreground">
        {p.o_que_pediu}
        {p.pedido_em && ` · pedido em ${formatarData(p.pedido_em)}`}
        {p.prazo_em &&
          !p.respondido_em &&
          ` · prazo: até ${formatarData(p.prazo_em)}`}
      </p>
      {(p.resposta || p.motivo_do_encerramento) && (
        <div className="mt-2 rounded-md border-2 border-primary p-3">
          <p className="font-medium">
            {p.resposta ? 'Resposta da associação' : 'Motivo do encerramento'}
          </p>
          <p className="mt-1 whitespace-pre-wrap">
            {p.resposta ?? p.motivo_do_encerramento}
          </p>
          {p.resultado && (
            <p className="mt-1 font-medium" data-meu-resultado>
              {p.fundamento
                ? `${p.resultado}. Fundamento: ${p.fundamento}`
                : p.resultado}
            </p>
          )}
        </div>
      )}
      {p.relatorio_disponivel_ate && (
        <div className="mt-2 space-y-2" data-meu-relatorio>
          <p>
            O relatório dos seus dados está disponível até{' '}
            {formatarData(p.relatorio_disponivel_ate, { comHora: true })}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={baixando}
              onClick={() => void baixar('pdf')}
            >
              Baixar o relatório (PDF)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={baixando}
              onClick={() => void baixar('json')}
            >
              Baixar os dados em arquivo (para levar a outro serviço)
            </Button>
          </div>
          {erro && (
            <p role="alert" className="text-destructive">
              {erro}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
