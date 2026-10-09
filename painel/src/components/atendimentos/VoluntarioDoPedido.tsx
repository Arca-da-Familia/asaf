import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  cadastrarVoluntarioDoAtendimento,
  obterTermoVigente,
  registrarTermoDeVoluntario,
  type AtendimentoAberto,
  type AtendimentoCompleto,
} from '@/lib/api'
import {
  AVISO_DE_MENOR_DE_IDADE,
  cargaHorariaSemanal,
  hojeParaCampoDeData,
  recusaPorFaltaDeAutorizacao,
  textoDaDataDeNascimento,
  validarTermoDeAdesao,
} from '@/lib/atendimentos'
import { formatarDia, formatarNumero } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'

const classeCampo =
  'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const classeDoErro =
  'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'

// v5.5b (FASE 5) - quem pediu para ser voluntário (pelo site) vira uma pessoa do cadastro (sem precisar ser associada), assina o termo de adesão
// (Lei 9.608/1998: sem ele não entra em escala nenhuma) e daí pode ser escalada num projeto. Tudo a partir do cartão do pedido.
export function VoluntarioDoPedido({
  a,
  aoCadastrar,
}: {
  a: AtendimentoAberto
  // o pedido já atualizado (com `id_pessoa`): quem desenha o cartão põe na tela e refaz a lista
  aoCadastrar: (r: AtendimentoCompleto) => void
}) {
  const queryClient = useQueryClient()
  const idPessoa = a.id_pessoa
  const [erroDoCadastro, setErroDoCadastro] = useState<string | null>(null)

  const cadastrar = useMutation({
    mutationFn: () => cadastrarVoluntarioDoAtendimento(a.id_atendimento),
    onMutate: () => setErroDoCadastro(null),
    onSuccess: aoCadastrar,
    onError: (e) =>
      setErroDoCadastro(mensagemDoErro(e, 'Não foi possível cadastrar.')),
  })

  return (
    <section
      aria-label="Voluntário"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <h2 className="text-sm font-semibold">Voluntário</h2>
      <p className="text-sm">{textoDaDataDeNascimento(a)}</p>
      {a.menor_de_idade === true && (
        <p className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900">
          {AVISO_DE_MENOR_DE_IDADE}
        </p>
      )}

      {idPessoa === null ? (
        <div>
          {erroDoCadastro && (
            <p role="alert" className={`mb-2 ${classeDoErro}`}>
              {erroDoCadastro}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={cadastrar.isPending}
            onClick={() => cadastrar.mutate()}
          >
            Cadastrar como voluntário
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Cria o cadastro da pessoa, sem precisar ser associada.
          </p>
        </div>
      ) : (
        <TermoDeAdesao
          key={idPessoa}
          idPessoa={idPessoa}
          menorDeIdade={a.menor_de_idade === true}
          aoRegistrar={() => {
            queryClient.invalidateQueries({
              queryKey: ['termo-voluntario', idPessoa],
            })
            // a lista de quem pode ser escalado (tela de Projetos) passa a ter esta pessoa
            queryClient.invalidateQueries({
              queryKey: ['voluntarios-para-selecao'],
            })
          }}
        />
      )}
    </section>
  )
}

function TermoDeAdesao({
  idPessoa,
  menorDeIdade,
  aoRegistrar,
}: {
  idPessoa: number
  menorDeIdade: boolean
  aoRegistrar: () => void
}) {
  const [atividade, setAtividade] = useState('')
  const [carga, setCarga] = useState('')
  const [inicio, setInicio] = useState(hojeParaCampoDeData)
  const [fim, setFim] = useState('')
  const [local, setLocal] = useState('')
  const [documento, setDocumento] = useState('')
  const [autorizacao, setAutorizacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // O servidor também pede a autorização de quem ainda não tem data de nascimento no cadastro (não dá para provar a maioridade): se ele recusar por
  // isso, o campo aparece mesmo sem o pedido dizer que é menor.
  const [servidorExigiu, setServidorExigiu] = useState(false)
  const exigeAutorizacao = menorDeIdade || servidorExigiu

  const {
    data: termo,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['termo-voluntario', idPessoa],
    queryFn: () => obterTermoVigente(idPessoa),
  })

  const registrar = useMutation({
    mutationFn: () =>
      registrarTermoDeVoluntario(idPessoa, {
        atividade: atividade.trim(),
        carga_horaria_semanal: cargaHorariaSemanal(carga) ?? 0,
        data_inicio: inicio,
        data_fim_vigencia: fim,
        local: local.trim() || undefined,
        documento_referencia: documento.trim() || undefined,
        autorizacao_responsavel_referencia:
          (exigeAutorizacao && autorizacao.trim()) || undefined,
      }),
    onMutate: () => {
      setErro(null)
      setAviso(null)
    },
    onSuccess: (r) => {
      setAviso(`${r.mensagem} Versão ${r.versao}.`)
      aoRegistrar()
    },
    onError: (e) => {
      const mensagem = mensagemDoErro(e, 'Não foi possível registrar o termo.')
      if (recusaPorFaltaDeAutorizacao(mensagem)) setServidorExigiu(true)
      setErro(mensagem)
    },
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    const falta = validarTermoDeAdesao(
      { atividade, carga, inicio, fim, autorizacao },
      exigeAutorizacao,
    )
    if (falta) {
      setAviso(null)
      setErro(falta)
      return
    }
    registrar.mutate()
  }

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError)
    return (
      <p role="alert" className={classeDoErro}>
        {mensagemDoErro(error, 'Não foi possível consultar o termo de adesão.')}
      </p>
    )

  if (termo?.vigente)
    return (
      <div className="space-y-2">
        {aviso && (
          <p role="status" className="text-sm">
            {aviso}
          </p>
        )}
        <p className="text-sm" data-testid="termo-vigente">
          Termo de adesão vigente até {formatarDia(termo.data_fim_vigencia)} (
          {termo.atividade}, {formatarNumero(termo.carga_horaria_semanal)} h por
          semana).
        </p>
        <Link
          to="/projetos"
          className="inline-block text-sm font-medium text-primary underline underline-offset-4"
        >
          Escalar em um projeto
        </Link>
      </div>
    )

  return (
    <form
      aria-label="Termo de adesão"
      onSubmit={enviar}
      noValidate
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
    >
      <h3 className="text-sm font-semibold sm:col-span-2">Termo de adesão</h3>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Sem o termo de adesão a pessoa não pode ser escalada em nenhum projeto.
      </p>
      {erro && (
        <p role="alert" className={`sm:col-span-2 ${classeDoErro}`}>
          {erro}
        </p>
      )}
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">Atividade</span>
        <input
          aria-label="Atividade"
          value={atividade}
          onChange={(e) => setAtividade(e.target.value)}
          className={classeCampo}
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">
          Carga horária semanal (horas)
        </span>
        <input
          aria-label="Carga horária semanal (horas)"
          inputMode="decimal"
          value={carga}
          onChange={(e) => setCarga(e.target.value)}
          className={classeCampo}
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">
          Início da vigência
        </span>
        <input
          type="date"
          aria-label="Início da vigência"
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
          className={classeCampo}
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">Fim da vigência</span>
        <input
          type="date"
          aria-label="Fim da vigência"
          value={fim}
          onChange={(e) => setFim(e.target.value)}
          className={classeCampo}
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">Local (opcional)</span>
        <input
          aria-label="Local (opcional)"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className={classeCampo}
        />
      </label>
      <label className="text-sm">
        <span className="text-xs text-muted-foreground">
          Documento de referência (opcional)
        </span>
        <input
          aria-label="Documento de referência (opcional)"
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          className={classeCampo}
        />
      </label>
      {exigeAutorizacao && (
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">
            Autorização do responsável (referência)
          </span>
          <input
            aria-label="Autorização do responsável (referência)"
            value={autorizacao}
            onChange={(e) => setAutorizacao(e.target.value)}
            placeholder="Ex.: documento anexado, número do protocolo"
            className={classeCampo}
          />
        </label>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={registrar.isPending}>
          Registrar termo de adesão
        </Button>
      </div>
    </form>
  )
}
