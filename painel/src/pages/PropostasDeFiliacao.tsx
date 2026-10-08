import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Inbox } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aprovarPropostaDeFiliacao,
  ApiError,
  conferirPropostaDeFiliacao,
  listarOpcoesLegado,
  listarPropostasDeFiliacao,
  recusarPropostaDeFiliacao,
  type PropostaDeFiliacao,
  type StatusDeProposta,
} from '@/lib/api'
import { formatarCpf } from '@/lib/cpf'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'

const SITUACOES: StatusDeProposta[] = [
  'Pendente',
  'Em Conferência',
  'Aprovada',
  'Recusada',
]

const COR_DA_SITUACAO: Record<StatusDeProposta, string> = {
  Pendente: 'bg-amber-100 text-amber-900',
  'Em Conferência': 'bg-sky-100 text-sky-900',
  Aprovada: 'bg-emerald-100 text-emerald-900',
  Recusada: 'bg-rose-100 text-rose-900',
}

const campoClasse =
  'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

// v1.2 no servidor, caixa de entrada só na v5.4c (achado AO VIVO na homologação, 2026-10-05): propor, conferir, recusar e aprovar
// filiação eram rotas testadas que nenhuma tela chamava — quem recebe o pedido de uma pessoa não tinha onde atendê-lo.
export function PropostasDeFiliacaoPage() {
  const [situacao, setSituacao] = useState('')
  const { data: propostas, isLoading } = useQuery({
    queryKey: ['propostas-filiacao', situacao],
    queryFn: () => listarPropostasDeFiliacao(situacao || undefined),
  })

  return (
    <>
      <PageHeader
        titulo="Propostas de filiação"
        descricao="Pedidos de quem quer virar associado: confira a documentação e aprove ou recuse."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Propostas de filiação' },
        ]}
      />

      <div className="mb-4 max-w-xs">
        <label htmlFor="filtro-situacao" className="text-sm font-medium">
          Situação da proposta
        </label>
        <select
          id="filtro-situacao"
          value={situacao}
          onChange={(e) => setSituacao(e.target.value)}
          className={campoClasse}
        >
          <option value="">Todas</option>
          {SITUACOES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !propostas?.length ? (
        <EmptyState
          icone={Inbox}
          titulo="Nenhuma proposta por aqui"
          descricao="Quando alguém propuser filiação, o pedido aparece nesta lista."
        />
      ) : (
        <ul className="v3-space-y-4">
          {propostas.map((p) => (
            <Proposta key={p.id_proposta} proposta={p} />
          ))}
        </ul>
      )}
    </>
  )
}

function Proposta({ proposta }: { proposta: PropostaDeFiliacao }) {
  const queryClient = useQueryClient()
  const { data: eu } = useMe()
  const [modo, setModo] = useState<null | 'recusar' | 'aprovar'>(null)
  const [motivo, setMotivo] = useState('')
  const [categoria, setCategoria] = useState('Efetivo')
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cadastroParecido, setCadastroParecido] = useState(false)

  const { data: categorias } = useQuery({
    queryKey: ['opcoes-legado', 'categoria_associado'],
    queryFn: () => listarOpcoesLegado('categoria_associado'),
    enabled: modo === 'aprovar',
  })

  function atualizar() {
    queryClient.invalidateQueries({ queryKey: ['propostas-filiacao'] })
    queryClient.invalidateQueries({ queryKey: ['associados'] })
  }

  function falhar(e: unknown) {
    setAviso(null)
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    if (e instanceof ApiError && e.status === 409) setCadastroParecido(true)
  }

  const conferir = useMutation({
    mutationFn: () => conferirPropostaDeFiliacao(proposta.id_proposta),
    onSuccess: (r) => {
      setErro(null)
      setAviso(r.mensagem)
      atualizar()
    },
    onError: falhar,
  })
  const recusar = useMutation({
    mutationFn: () => recusarPropostaDeFiliacao(proposta.id_proposta, motivo),
    onSuccess: (r) => {
      setErro(null)
      setAviso(r.mensagem)
      setModo(null)
      atualizar()
    },
    onError: falhar,
  })
  const aprovar = useMutation({
    mutationFn: (forcar: boolean) =>
      aprovarPropostaDeFiliacao(proposta.id_proposta, { categoria, forcar }),
    onSuccess: (r) => {
      setErro(null)
      setCadastroParecido(false)
      setAviso(`${r.mensagem} Matrícula ${r.numero_matricula}.`)
      setModo(null)
      atualizar()
    },
    onError: falhar,
  })

  const podeForcar = !!eu?.permissoes.includes('forcar_cadastro_duplicado')
  const exigidos = proposta.exigidos ?? 3
  const propoem = proposta.total_propoem ?? 0
  const sociosCompletos = propoem >= exigidos

  function enviarRecusa(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    if (motivo.trim().length < 3) {
      setErro('Informe o motivo da recusa.')
      return
    }
    recusar.mutate()
  }

  return (
    <li
      className="rounded-xl border border-border bg-card p-5"
      data-situacao={proposta.status}
      aria-label={`Proposta de ${proposta.nome_completo}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{proposta.nome_completo}</p>
          <p className="text-sm text-muted-foreground">
            CPF {formatarCpf(proposta.cpf)}
            {proposta.email_contato && ` · ${proposta.email_contato}`}
            {proposta.telefone_whatsapp && ` · ${proposta.telefone_whatsapp}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Recebida em {formatarData(proposta.criado_em)}
          </p>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${COR_DA_SITUACAO[proposta.status] ?? ''}`}
        >
          {proposta.status}
        </span>
      </div>

      {(proposta.status === 'Pendente' ||
        proposta.status === 'Em Conferência') && (
        <div className="mt-3 text-sm">
          <p className={sociosCompletos ? 'font-medium' : ''}>
            Sócios que propõem: {propoem} de {exigidos}
            {sociosCompletos ? '' : ` — faltam ${exigidos - propoem}.`}
          </p>
          {(proposta.proponentes ?? []).length > 0 && (
            <ul
              aria-label={`Sócios sobre o pedido de ${proposta.nome_completo}`}
              className="mt-1 space-y-0.5 text-xs"
            >
              {(proposta.proponentes ?? []).map((d) => (
                <li key={d.id_associado}>
                  <span className="font-medium">{d.socio}</span>: {d.decisao}
                  {d.observacao ? ` — “${d.observacao}”` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {proposta.status === 'Recusada' && proposta.motivo_recusa && (
        <p className="mt-3 text-sm">
          Motivo da recusa: {proposta.motivo_recusa}
        </p>
      )}
      {proposta.status === 'Aprovada' && proposta.id_associado_efetivado && (
        <p className="mt-3 text-sm">
          <Link
            className="underline"
            to={`/associados/${proposta.id_associado_efetivado}`}
          >
            Abrir o cadastro do associado
          </Link>
        </p>
      )}

      {aviso && (
        <p
          role="status"
          className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {proposta.status === 'Pendente' && (
          <Button
            variant="outline"
            size="sm"
            disabled={conferir.isPending}
            onClick={() => conferir.mutate()}
          >
            Marcar documentação conferida
          </Button>
        )}
        {proposta.status === 'Em Conferência' && (
          <Button
            size="sm"
            disabled={!sociosCompletos}
            title={
              sociosCompletos
                ? undefined
                : `O Estatuto pede ${exigidos} sócios propondo (até agora ${propoem}).`
            }
            onClick={() => setModo(modo === 'aprovar' ? null : 'aprovar')}
          >
            Aprovar e efetivar
          </Button>
        )}
        {(proposta.status === 'Pendente' ||
          proposta.status === 'Em Conferência') && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setModo(modo === 'recusar' ? null : 'recusar')}
          >
            Recusar proposta
          </Button>
        )}
      </div>

      {modo === 'recusar' && (
        <form
          onSubmit={enviarRecusa}
          className="mt-4 rounded-lg border border-border p-4"
          noValidate
        >
          <label
            htmlFor={`motivo-${proposta.id_proposta}`}
            className="text-sm font-medium"
          >
            Motivo da recusa *
          </label>
          <input
            id={`motivo-${proposta.id_proposta}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={campoClasse}
          />
          <Button
            type="submit"
            variant="destructive"
            className="mt-3"
            disabled={recusar.isPending}
          >
            Confirmar recusa
          </Button>
        </form>
      )}

      {modo === 'aprovar' && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <label
            htmlFor={`categoria-${proposta.id_proposta}`}
            className="text-sm font-medium"
          >
            Categoria *
          </label>
          <select
            id={`categoria-${proposta.id_proposta}`}
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className={campoClasse}
          >
            {(
              categorias ?? [{ id_opcao: 0, valor: 'Efetivo', ativo: true }]
            ).map((c) => (
              <option key={c.id_opcao} value={c.valor}>
                {c.valor}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            Cria o cadastro do associado, atribui a matrícula e registra a
            filiação na linha do tempo.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={aprovar.isPending}
              onClick={() => aprovar.mutate(false)}
            >
              Efetivar associado
            </Button>
            {cadastroParecido && podeForcar && (
              <Button
                variant="destructive"
                disabled={aprovar.isPending}
                onClick={() => aprovar.mutate(true)}
              >
                Aprovar mesmo assim (confirmo que é outra pessoa)
              </Button>
            )}
          </div>
          {cadastroParecido && !podeForcar && (
            <p className="mt-2 text-xs text-muted-foreground">
              Só quem tem a permissão de forçar cadastro parecido (o Presidente)
              pode aprovar mesmo assim.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
