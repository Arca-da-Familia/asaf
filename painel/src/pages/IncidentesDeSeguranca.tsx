import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import {
  formatarData,
  formatarDia,
  paraDataHoraLocalInput,
  paraUtcIso,
} from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  atualizarIncidente,
  encerrarIncidente,
  obterIncidentes,
  registrarIncidente,
  type IncidenteAtualizar,
  type IncidenteDeSeguranca,
  type RegistroDeIncidentes,
  type RiscoDoIncidente,
} from '@/lib/privacidade'

// v7.4b (FASE 7) - o registro de incidentes de segurança e o plano de resposta (decisões do Presidente de 2026-10-30): prazo de 3 dias úteis contado de
// quando a associação soube; a comunicação à ANPD e às pessoas só é obrigatória com risco ou dano relevante; aviso por e-mail, painel e site; um ensaio por
// ano; o registro fica guardado (não há como apagar). Só o encarregado registra e completa; quem tem o módulo lê.

const CHAVE = ['privacidade', 'incidentes']

const PRAZO: Record<
  IncidenteDeSeguranca['situacao_do_prazo'],
  { texto: (i: IncidenteDeSeguranca) => string; classe: string }
> = {
  no_prazo: {
    texto: (i) =>
      `Comunicar até ${formatarDia(i.prazo_para_comunicar)} se houver risco relevante`,
    classe: 'bg-amber-600/10 text-amber-900 dark:text-amber-200',
  },
  vence_hoje: {
    texto: () => 'O prazo de comunicação vence hoje',
    classe: 'bg-destructive/15 text-destructive',
  },
  vencido: {
    texto: (i) =>
      `Prazo de comunicação vencido em ${formatarDia(i.prazo_para_comunicar)}`,
    classe: 'bg-destructive/15 text-destructive',
  },
  comunicado: {
    texto: (i) =>
      i.comunicado_fora_do_prazo
        ? 'Comunicado à ANPD e às pessoas (fora do prazo)'
        : 'Comunicado à ANPD e às pessoas',
    classe: 'bg-emerald-600/10 text-emerald-900 dark:text-emerald-200',
  },
  sem_obrigacao: {
    texto: () => 'Sem risco relevante: fica só no registro',
    classe: 'bg-muted text-muted-foreground',
  },
  ensaio: {
    texto: () => 'Ensaio: não se comunica a ninguém de fora',
    classe: 'bg-muted text-muted-foreground',
  },
}

function PlanoDeResposta({ dias }: { dias: number }) {
  return (
    <section
      aria-label="Plano de resposta"
      className="rounded-xl border border-border p-4 text-sm"
    >
      <h2 className="mb-2 font-semibold">Plano de resposta</h2>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          <strong>Registrar aqui</strong> assim que souber do incidente: o prazo
          conta do dia em que a associação soube que dados pessoais foram
          afetados.
        </li>
        <li>
          <strong>Conter:</strong> parar o problema e limitar o dano (trocar
          senhas, tirar acessos, retirar o que foi exposto).
        </li>
        <li>
          <strong>Avaliar o risco às pessoas:</strong> dado sensível, de criança
          ou adolescente, financeiro, documentos, quantidade de pessoas. Só o
          risco ou dano relevante obriga a comunicar; o resto fica no registro.
        </li>
        <li>
          <strong>Comunicar em até {dias} dias úteis</strong>, quando o
          incidente pode trazer risco ou dano relevante: à ANPD, pelo canal de
          comunicação de incidentes da ANPD no gov.br; e a cada pessoa atingida,
          por e-mail, por aviso no painel (quem tem conta) e por aviso no site
          quando não der para achar a pessoa.
        </li>
        <li>
          <strong>Encerrar</strong> com a lição aprendida e a ação corretiva. O
          registro fica guardado (a lei pede pelo menos 5 anos).
        </li>
      </ol>
      <p className="mt-2 text-muted-foreground">
        Uma vez por ano, fazemos um <strong>ensaio</strong>: um incidente de
        mentira, registrado como ensaio, seguindo estes passos sem avisar
        ninguém de fora.
      </p>
    </section>
  )
}

function Ensaios({ r }: { r: RegistroDeIncidentes }) {
  const e = r.ensaios
  return (
    <section
      aria-label="Ensaio anual"
      data-testid="ensaio-anual"
      data-pendente={e.pendente ? 'sim' : 'nao'}
      className={`rounded-xl border p-4 text-sm ${e.pendente ? 'border-amber-600/40 bg-amber-600/10' : 'border-border'}`}
    >
      <h2 className="mb-1 font-semibold">Ensaio anual</h2>
      {e.ultimo_ensaio_em ? (
        <p>
          Último ensaio encerrado em {formatarData(e.ultimo_ensaio_em)}; o
          próximo deve ser feito até {formatarDia(e.proximo_ate)}.
        </p>
      ) : (
        <p>Nenhum ensaio feito ainda.</p>
      )}
      {e.pendente && (
        <p className="mt-1 font-medium">
          Está na hora de fazer o ensaio: registre um incidente marcando
          &ldquo;É um ensaio&rdquo;.
        </p>
      )}
    </section>
  )
}

function Registrar() {
  const cliente = useQueryClient()
  const id = useId()
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [conhecido, setConhecido] = useState('')
  const [ensaio, setEnsaio] = useState(false)
  const registrar = useMutation({
    mutationFn: () =>
      registrarIncidente({
        titulo,
        descricao,
        conhecido_em: paraUtcIso(conhecido),
        ensaio,
      }),
    onSuccess: (dados) => {
      cliente.setQueryData(CHAVE, dados)
      setTitulo('')
      setDescricao('')
      setConhecido('')
      setEnsaio(false)
    },
  })
  function enviar(e: FormEvent) {
    e.preventDefault()
    registrar.mutate()
  }
  return (
    <form
      onSubmit={enviar}
      aria-label="Registrar incidente"
      className="space-y-3 rounded-xl border border-border p-4"
    >
      <h2 className="font-semibold">Registrar incidente</h2>
      <div>
        <label htmlFor={`${id}-titulo`} className="block text-sm font-medium">
          Título
        </label>
        <input
          id={`${id}-titulo`}
          className={classeCampo}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          required
        />
      </div>
      <div>
        <label
          htmlFor={`${id}-descricao`}
          className="block text-sm font-medium"
        >
          O que aconteceu
        </label>
        <textarea
          id={`${id}-descricao`}
          className={classeCampo}
          rows={3}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          required
        />
      </div>
      <div>
        <label
          htmlFor={`${id}-conhecido`}
          className="block text-sm font-medium"
        >
          Quando a associação soube
        </label>
        <input
          id={`${id}-conhecido`}
          type="datetime-local"
          className={classeCampo}
          value={conhecido}
          onChange={(e) => setConhecido(e.target.value)}
          required
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={ensaio}
          onChange={(e) => setEnsaio(e.target.checked)}
        />
        É um ensaio (incidente de mentira, para treinar)
      </label>
      {registrar.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(registrar.error, 'Não foi possível registrar.')}
        </p>
      )}
      <Button type="submit" disabled={registrar.isPending}>
        Registrar
      </Button>
    </form>
  )
}

const CAMPOS_DE_TEXTO: [keyof IncidenteAtualizar, string][] = [
  ['dados_afetados', 'Que dados foram atingidos'],
  ['pessoas_afetadas', 'Quem foi atingido (grupos, nunca a lista de nomes)'],
  ['contencao', 'O que foi feito para conter'],
  ['motivo_do_risco', 'Por que o risco é (ou não é) relevante'],
  ['como_pessoas', 'Como as pessoas foram avisadas'],
  ['licao_aprendida', 'Lição aprendida'],
  ['acao_corretiva', 'Ação corretiva'],
]

function Completar({ i }: { i: IncidenteDeSeguranca }) {
  const cliente = useQueryClient()
  const id = useId()
  const [dados, setDados] = useState<IncidenteAtualizar>({
    dados_afetados: i.dados_afetados,
    pessoas_afetadas: i.pessoas_afetadas,
    contencao: i.contencao,
    risco: i.risco,
    motivo_do_risco: i.motivo_do_risco,
    comunicado_anpd_em: i.comunicado_anpd_em,
    protocolo_anpd: i.protocolo_anpd,
    comunicado_pessoas_em: i.comunicado_pessoas_em,
    como_pessoas: i.como_pessoas,
    licao_aprendida: i.licao_aprendida,
    acao_corretiva: i.acao_corretiva,
  })
  const mudar = (campo: keyof IncidenteAtualizar, valor: string | null) =>
    setDados((d) => ({ ...d, [campo]: valor }))
  const salvar = useMutation({
    mutationFn: () => atualizarIncidente(i.id_incidente, dados),
    onSuccess: (r) => cliente.setQueryData(CHAVE, r),
  })
  const encerrar = useMutation({
    mutationFn: async () => {
      await atualizarIncidente(i.id_incidente, dados)
      return encerrarIncidente(i.id_incidente)
    },
    onSuccess: (r) => cliente.setQueryData(CHAVE, r),
  })
  const erro = salvar.error ?? encerrar.error
  const data = (campo: 'comunicado_anpd_em' | 'comunicado_pessoas_em') => (
    <input
      id={`${id}-${campo}`}
      type="datetime-local"
      className={classeCampo}
      value={dados[campo] ? paraDataHoraLocalInput(dados[campo]!) : ''}
      onChange={(e) =>
        mudar(campo, e.target.value ? paraUtcIso(e.target.value) : null)
      }
    />
  )
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <div>
        <label htmlFor={`${id}-risco`} className="block text-sm font-medium">
          Avaliação do risco às pessoas
        </label>
        <select
          id={`${id}-risco`}
          className={classeCampo}
          value={dados.risco}
          onChange={(e) => mudar('risco', e.target.value as RiscoDoIncidente)}
        >
          <option value="A_AVALIAR">Ainda não avaliado</option>
          <option value="RELEVANTE">
            Risco ou dano relevante: comunicar à ANPD e às pessoas
          </option>
          <option value="SEM_RISCO_RELEVANTE">
            Sem risco relevante: fica só no registro
          </option>
        </select>
      </div>
      {CAMPOS_DE_TEXTO.map(([campo, rotulo]) => (
        <div key={campo}>
          <label
            htmlFor={`${id}-${campo}`}
            className="block text-sm font-medium"
          >
            {rotulo}
          </label>
          <textarea
            id={`${id}-${campo}`}
            className={classeCampo}
            rows={2}
            value={(dados[campo] as string | null) ?? ''}
            onChange={(e) => mudar(campo, e.target.value)}
          />
        </div>
      ))}
      {!i.ensaio && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor={`${id}-comunicado_anpd_em`}
              className="block text-sm font-medium"
            >
              Comunicado à ANPD em
            </label>
            {data('comunicado_anpd_em')}
          </div>
          <div>
            <label
              htmlFor={`${id}-protocolo`}
              className="block text-sm font-medium"
            >
              Protocolo da ANPD
            </label>
            <input
              id={`${id}-protocolo`}
              className={classeCampo}
              value={dados.protocolo_anpd ?? ''}
              onChange={(e) => mudar('protocolo_anpd', e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor={`${id}-comunicado_pessoas_em`}
              className="block text-sm font-medium"
            >
              Pessoas avisadas em
            </label>
            {data('comunicado_pessoas_em')}
          </div>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(erro, 'Não foi possível salvar.')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={salvar.isPending || encerrar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar
        </Button>
        <Button
          type="button"
          disabled={salvar.isPending || encerrar.isPending}
          onClick={() => encerrar.mutate()}
        >
          Salvar e encerrar
        </Button>
      </div>
    </div>
  )
}

function Texto({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="whitespace-pre-wrap">{valor}</dd>
    </div>
  )
}

function Cartao({
  i,
  podeGerir,
}: {
  i: IncidenteDeSeguranca
  podeGerir: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const prazo = PRAZO[i.situacao_do_prazo]
  return (
    <li
      aria-label={`Incidente nº ${i.numero}`}
      data-situacao={i.situacao}
      data-prazo={i.situacao_do_prazo}
      className="rounded-xl border border-border p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          Nº {i.numero} · {i.titulo}
        </h3>
        {i.ensaio && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs">Ensaio</span>
        )}
        <span className="rounded bg-muted px-2 py-0.5 text-xs">
          {i.situacao === 'ABERTO' ? 'Aberto' : 'Encerrado'}
        </span>
        <span className={`rounded px-2 py-0.5 text-xs ${prazo.classe}`}>
          {prazo.texto(i)}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        A associação soube em {formatarData(i.conhecido_em, { comHora: true })}
        {i.encerrado_em && ` · encerrado em ${formatarData(i.encerrado_em)}`}
        {i.precedente && ' · registrado depois, como precedente'}
      </p>
      <dl className="mt-2 space-y-1">
        <Texto rotulo="O que aconteceu" valor={i.descricao} />
        <Texto rotulo="Avaliação do risco" valor={i.risco_rotulo} />
        {i.situacao === 'ENCERRADO' && (
          <>
            <Texto rotulo="Por quê" valor={i.motivo_do_risco} />
            <Texto rotulo="O que foi feito para conter" valor={i.contencao} />
            <Texto rotulo="Lição aprendida" valor={i.licao_aprendida} />
            <Texto rotulo="Ação corretiva" valor={i.acao_corretiva} />
          </>
        )}
      </dl>
      {podeGerir && i.situacao === 'ABERTO' && (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            aria-expanded={aberto}
            onClick={() => setAberto((a) => !a)}
          >
            {aberto ? 'Fechar' : 'Completar o registro'}
          </Button>
          {aberto && <Completar i={i} />}
        </>
      )}
    </li>
  )
}

export function IncidentesDeSegurancaPage() {
  const consulta = useQuery({ queryKey: CHAVE, queryFn: obterIncidentes })
  const r = consulta.data
  return (
    <>
      <PageHeader
        titulo="Incidentes de segurança"
        descricao="O registro de todo incidente que atinge (ou pode atingir) dado pessoal, comunicado ou não, e o plano de resposta. O registro não se apaga."
      />
      {consulta.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando…
        </p>
      )}
      {consulta.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(consulta.error, 'Não foi possível carregar.')}
        </p>
      )}
      {r && (
        <div className="space-y-4">
          <PlanoDeResposta dias={r.dias_uteis_para_comunicar} />
          <Ensaios r={r} />
          {r.pode_gerir && <Registrar />}
          <section aria-label="Registro de incidentes">
            <h2 className="mb-2 font-semibold">Registro</h2>
            {r.itens.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum incidente registrado.
              </p>
            ) : (
              <ul className="space-y-3">
                {r.itens.map((i) => (
                  <Cartao key={i.id_incidente} i={i} podeGerir={r.pode_gerir} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  )
}
