import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Lock, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Paginador } from '@/components/data/Paginador'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  anonimizarVencidos,
  compararItemDaFila,
  escanearDuplicidade,
  higienizarContatos,
  ignorarItemDaFila,
  listarFilaDeRevisao,
  mesclarPessoas,
  urlArquivo,
  type CampoDaJuncao,
  type ComparacaoDeDuplicado,
  type LadoDaComparacao,
  type SinalDeRevisao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { usePaginaLocal } from '@/lib/pagina-local'
import { simplificar } from '@/lib/texto'
import { cn } from '@/lib/utils'

const ROTULO_DO_SINAL: Record<string, string> = {
  duplicidade_nome_nascimento: 'Possível cadastro duplicado',
  duplicidade_parecida: 'Possível cadastro duplicado',
  contato_telefone_invalido: 'Telefone com formato inválido',
  contato_email_suspeito: 'E-mail suspeito (devolveu)',
}
const TIPOS = [
  { id: '', rotulo: 'Todos' },
  // os dois sinais de duplicado (nome e nascimento iguais; nomes parecidos com um dado igual) começam com 'duplicidade'
  { id: 'duplicidade', rotulo: 'Duplicados' },
  { id: 'contato_telefone_invalido', rotulo: 'Telefone' },
  { id: 'contato_email_suspeito', rotulo: 'E-mail' },
]
const SITUACOES = [
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'ignorado', rotulo: 'Ignorados' },
  { id: 'mesclado', rotulo: 'Juntados' },
] as const
type SituacaoDaFila = (typeof SITUACOES)[number]['id']

const campoClasse =
  'h-10 w-full rounded-lg border border-input bg-card px-3 text-sm'
const ITENS_POR_PAGINA = 10

// v1.8 no servidor, tela só na v5.4c; v9.5f (desenho aprovado pelo Presidente, rodadas 4 e 5): PASSO A PASSO - 1) a fila, com filtro por tipo e
// situação e busca pelo nome; 2) os dois cadastros lado a lado, campo por campo: o que é igual não pede nada, o que é diferente pede uma escolha, e a
// matrícula mais antiga fica sempre (cadeado); 3) o resultado, o que acontece e o nome digitado para juntar. Nada acontece sozinho.
type Passo =
  | { tipo: 'fila' }
  | { tipo: 'comparar'; item: SinalDeRevisao }
  | {
      tipo: 'confirmar'
      item: SinalDeRevisao
      comparacao: ComparacaoDeDuplicado
      escolhas: Record<string, Escolha>
    }
type Escolha = 'mantida' | 'absorvida'

function PassosDaQualidade({
  atual,
  aoVoltarAFila,
  aoVoltarAComparar,
}: {
  atual: Passo['tipo']
  aoVoltarAFila: () => void
  aoVoltarAComparar?: () => void
}) {
  const passos: { id: Passo['tipo']; nome: string; ir?: () => void }[] = [
    { id: 'fila', nome: 'Escolher na fila', ir: aoVoltarAFila },
    { id: 'comparar', nome: 'Comparar campo a campo', ir: aoVoltarAComparar },
    { id: 'confirmar', nome: 'Confirmar' },
  ]
  const indice = passos.findIndex((p) => p.id === atual)
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2" aria-label="Passos">
      {passos.map((p, i) => {
        const feito = i < indice
        const conteudo = (
          <>
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold',
                i === indice
                  ? 'bg-primary-foreground text-primary'
                  : feito
                    ? 'bg-verde-texto text-verde-tinta'
                    : 'bg-muted text-foreground',
              )}
            >
              {feito ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            {p.nome}
          </>
        )
        const classe = cn(
          'flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm',
          i === indice
            ? 'border-primary bg-primary font-extrabold text-primary-foreground'
            : feito
              ? 'border-verde-tinta bg-verde-tinta font-bold text-verde-texto'
              : 'border-input bg-card font-semibold',
        )
        return (
          <li key={p.id} aria-current={i === indice ? 'step' : undefined}>
            {feito && p.ir ? (
              <button type="button" className={classe} onClick={p.ir}>
                {conteudo}
              </button>
            ) : (
              <span className={classe}>{conteudo}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function QualidadeDaBasePage() {
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoAnonimizar, setConfirmandoAnonimizar] = useState(false)
  const [passo, setPasso] = useState<Passo>({ tipo: 'fila' })

  function depois(mensagem: string) {
    setErro(null)
    setAviso(mensagem)
    setPasso({ tipo: 'fila' })
    queryClient.invalidateQueries({ queryKey: ['fila-revisao'] })
    queryClient.invalidateQueries({ queryKey: ['associados'] })
  }
  function falhou(e: unknown) {
    setAviso(null)
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
  }

  const duplicidade = useMutation({
    mutationFn: escanearDuplicidade,
    onSuccess: (r) => depois(r.mensagem),
    onError: falhou,
  })
  const telefones = useMutation({
    mutationFn: higienizarContatos,
    onSuccess: (r) => depois(r.mensagem),
    onError: falhou,
  })
  const anonimizar = useMutation({
    mutationFn: anonimizarVencidos,
    onSuccess: (r) => {
      setConfirmandoAnonimizar(false)
      depois(r.mensagem)
    },
    onError: (e) => {
      setConfirmandoAnonimizar(false)
      falhou(e)
    },
  })

  return (
    <>
      <PageHeader
        titulo="Qualidade da base"
        descricao="O sistema aponta o que parece errado; quem decide é uma pessoa, campo por campo. Nada é juntado nem apagado sozinho."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Qualidade da base' },
        ]}
      />

      {aviso && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-primary/30 bg-verde-tinta px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-destructive/30 bg-perigo-tinta px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      {/* as buscas ficam no alto (o Presidente gostou delas assim na rodada 4) */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-muted-foreground">
          Procurar de novo:
        </span>
        <Button
          variant="outline"
          disabled={duplicidade.isPending}
          onClick={() => duplicidade.mutate()}
        >
          Procurar cadastros duplicados
        </Button>
        <Button
          variant="outline"
          disabled={telefones.isPending}
          onClick={() => telefones.mutate()}
        >
          Procurar telefones inválidos
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirmandoAnonimizar(true)}
        >
          Anonimizar desligados com prazo vencido
        </Button>
      </div>

      <PassosDaQualidade
        atual={passo.tipo}
        aoVoltarAFila={() => setPasso({ tipo: 'fila' })}
        aoVoltarAComparar={
          passo.tipo === 'confirmar'
            ? () => setPasso({ tipo: 'comparar', item: passo.item })
            : undefined
        }
      />

      {passo.tipo === 'fila' && (
        <FilaDeRevisao
          aoComparar={(item) => {
            setAviso(null)
            setErro(null)
            setPasso({ tipo: 'comparar', item })
          }}
          aoConcluir={depois}
          aoFalhar={falhou}
        />
      )}
      {passo.tipo === 'comparar' && (
        <Comparacao
          item={passo.item}
          aoVoltar={() => setPasso({ tipo: 'fila' })}
          aoConcluir={depois}
          aoFalhar={falhou}
          aoContinuar={(comparacao, escolhas) =>
            setPasso({
              tipo: 'confirmar',
              item: passo.item,
              comparacao,
              escolhas,
            })
          }
        />
      )}
      {passo.tipo === 'confirmar' && (
        <Confirmacao
          comparacao={passo.comparacao}
          escolhas={passo.escolhas}
          aoVoltar={() => setPasso({ tipo: 'comparar', item: passo.item })}
          aoConcluir={depois}
          aoFalhar={falhou}
        />
      )}

      <ConfirmDialog
        aberto={confirmandoAnonimizar}
        onAbertoChange={setConfirmandoAnonimizar}
        titulo="Anonimizar os desligados com prazo vencido?"
        descricao="Apaga de forma definitiva o CPF, o contato e o endereço de todo associado desligado cujo prazo de retenção já terminou (LGPD). Quem ainda está dentro do prazo não é tocado."
        rotuloConfirmar="Anonimizar agora"
        carregando={anonimizar.isPending}
        onConfirmar={() => anonimizar.mutate()}
      />
    </>
  )
}

// Dois cadastros duplicados costumam ter o MESMO nome: o que os distingue é ser associado (e a matrícula) ou só uma pessoa.
function quem(
  nome: string | null,
  eAssociado: boolean,
  matricula: number | null,
): string {
  return `${nome ?? '—'} (${eAssociado ? `associado, matrícula ${matricula ?? '—'}` : 'pessoa sem cadastro de associado'})`
}

/* ============================== 1) a fila, com filtros ============================== */
function FilaDeRevisao({
  aoComparar,
  aoConcluir,
  aoFalhar,
}: {
  aoComparar: (item: SinalDeRevisao) => void
  aoConcluir: (mensagem: string) => void
  aoFalhar: (e: unknown) => void
}) {
  const [situacao, setSituacao] = useState<SituacaoDaFila>('pendente')
  const [tipo, setTipo] = useState('')
  const [busca, setBusca] = useState('')
  const { data: fila, isLoading } = useQuery({
    queryKey: ['fila-revisao', situacao],
    queryFn: () => listarFilaDeRevisao(situacao),
  })
  const termo = simplificar(busca.trim())
  const doTipo = (fila ?? []).filter((i) => i.tipo_sinal.startsWith(tipo))
  const achados = termo
    ? doTipo.filter((item) =>
        [item.nome_pessoa_a, item.nome_pessoa_b].some(
          (nome) => nome && simplificar(nome).includes(termo),
        ),
      )
    : doTipo
  const pagina = usePaginaLocal(achados, ITENS_POR_PAGINA, `${termo}|${tipo}`)
  const contagem = (id: string) =>
    (fila ?? []).filter((i) => i.tipo_sinal.startsWith(id)).length

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 className="mb-4 font-semibold">Fila de revisão</h2>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div
          role="group"
          aria-label="Tipo"
          className="relative flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible"
        >
          {TIPOS.map((t) => (
            <button
              key={t.id || 'todos'}
              type="button"
              aria-pressed={tipo === t.id}
              onClick={() => setTipo(t.id)}
              className={cn(
                'flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap',
                tipo === t.id
                  ? 'border-primary bg-primary font-bold text-primary-foreground'
                  : 'border-border bg-card font-medium hover:bg-accent',
              )}
            >
              {t.rotulo} · {contagem(t.id)}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">
            Situação
          </span>
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value as SituacaoDaFila)}
            className={cn(campoClasse, 'w-auto')}
          >
            {SITUACOES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </label>
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <label
            htmlFor="procurar-na-fila"
            className="text-xs text-muted-foreground"
          >
            Procurar na fila
          </label>
          <input
            id="procurar-na-fila"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome da pessoa"
            className={cn(campoClasse, 'mt-1')}
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !fila?.length ? (
        <EmptyState
          icone={ShieldCheck}
          titulo={
            situacao === 'pendente'
              ? 'Nada na fila de revisão'
              : 'Nada nesta situação'
          }
          descricao="Use os botões do alto para procurar problemas no cadastro."
        />
      ) : (
        <>
          {termo && (
            <p
              aria-live="polite"
              className="mb-2 text-xs text-muted-foreground"
            >
              {pagina.total}{' '}
              {pagina.total === 1 ? 'item encontrado' : 'itens encontrados'}.
            </p>
          )}
          <ul
            aria-label="Itens da fila"
            className="divide-y divide-border overflow-hidden rounded-xl border border-border"
          >
            {pagina.daPagina.map((item) => (
              <ItemDaFila
                key={item.id_fila}
                item={item}
                pendente={situacao === 'pendente'}
                aoComparar={() => aoComparar(item)}
                aoConcluir={aoConcluir}
                aoFalhar={aoFalhar}
              />
            ))}
          </ul>
          {pagina.total === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Ninguém com esse nome ou desse tipo na fila.
            </p>
          )}
          <Paginador
            pagina={pagina.pagina}
            porPagina={pagina.porPagina}
            total={pagina.total}
            aoMudar={pagina.setPagina}
            rotulo="Páginas da fila"
          />
        </>
      )}
    </section>
  )
}

function ItemDaFila({
  item,
  pendente,
  aoComparar,
  aoConcluir,
  aoFalhar,
}: {
  item: SinalDeRevisao
  pendente: boolean
  aoComparar: () => void
  aoConcluir: (mensagem: string) => void
  aoFalhar: (e: unknown) => void
}) {
  const ehDuplicidade = item.id_pessoa_b !== null
  const ignorar = useMutation({
    mutationFn: () => ignorarItemDaFila(item.id_fila),
    onSuccess: (r) => aoConcluir(r.mensagem),
    onError: aoFalhar,
  })
  const rotulo = ROTULO_DO_SINAL[item.tipo_sinal] ?? item.tipo_sinal
  return (
    <li
      className="grid gap-2 p-4 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
      aria-label={`${rotulo}: ${item.nome_pessoa_a ?? ''}`}
    >
      <span
        className={cn(
          'self-start rounded-full px-2.5 py-0.5 text-xs font-bold sm:self-center',
          ehDuplicidade
            ? 'bg-ouro-tinta text-ouro-texto'
            : 'bg-azul-tinta text-azul-texto',
        )}
      >
        {rotulo}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {quem(item.nome_pessoa_a, item.e_associado_a, item.matricula_a)}
          {ehDuplicidade && <span className="font-normal"> e </span>}
          {ehDuplicidade &&
            quem(item.nome_pessoa_b, item.e_associado_b, item.matricula_b)}
        </p>
        <p className="text-xs text-muted-foreground">
          {item.detalhe ? `${item.detalhe} · ` : ''}desde{' '}
          {formatarData(item.criado_em)}
        </p>
      </div>
      {pendente && (
        <div className="flex flex-wrap gap-2">
          {ehDuplicidade && (
            <Button size="sm" className="min-h-9" onClick={aoComparar}>
              Comparar
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="min-h-9"
            disabled={ignorar.isPending}
            onClick={() => ignorar.mutate()}
          >
            {ehDuplicidade
              ? 'Não é duplicado — ignorar'
              : 'Já resolvido — ignorar'}
          </Button>
        </div>
      )}
    </li>
  )
}

/* ============================== 2) comparar campo a campo ============================== */
const ROTULO_DO_CAMPO: Record<string, string> = {
  nome_completo: 'Nome completo',
  cpf: 'CPF',
  data_nascimento: 'Nascimento',
  email_contato: 'E-mail',
  telefone_whatsapp: 'Telefone',
  estado_civil: 'Estado civil',
  profissao: 'Profissão',
  naturalidade: 'Naturalidade',
  foto: 'Foto',
  categoria: 'Categoria',
  endereco: 'Endereço',
}

// v9.5f (conferência): cada campo já vem classificado pelo servidor, pela mesma regra da junção - o "Vai ficar assim" é o que fica gravado
type Linha = CampoDaJuncao & { rotulo: string }
function linhasDaComparacao(c: ComparacaoDeDuplicado): Linha[] {
  return c.campos.map((campo) => ({
    ...campo,
    rotulo: ROTULO_DO_CAMPO[campo.chave] ?? campo.chave,
  }))
}

// a foto aparece como foto; datas, no jeito brasileiro
function mostrar(l: Pick<Linha, 'chave'>, valor: string | null): ReactNode {
  if (!valor) return null
  if (l.chave === 'foto')
    return (
      <img
        src={urlArquivo(valor)}
        alt=""
        className="h-14 w-14 rounded-full object-cover"
      />
    )
  if (l.chave === 'data_nascimento') return formatarData(valor)
  return valor
}

function ladosDe(c: ComparacaoDeDuplicado) {
  return c.fica === c.a.id_pessoa
    ? { fica: c.a, sai: c.b }
    : { fica: c.b, sai: c.a }
}

const mesAno = (iso: string | null) =>
  iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null

function cabecalhoDoLado(l: LadoDaComparacao): string {
  if (!l.associado) return 'pessoa sem cadastro de associado'
  const desde = mesAno(l.associado.data_admissao)
  return `matrícula ${l.associado.numero_matricula ?? '—'}${desde ? ` · desde ${desde}` : ''}`
}

function Comparacao({
  item,
  aoVoltar,
  aoContinuar,
  aoConcluir,
  aoFalhar,
}: {
  item: SinalDeRevisao
  aoVoltar: () => void
  aoContinuar: (
    comparacao: ComparacaoDeDuplicado,
    escolhas: Record<string, Escolha>,
  ) => void
  aoConcluir: (mensagem: string) => void
  aoFalhar: (e: unknown) => void
}) {
  const {
    data: c,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['fila-revisao', 'comparar', item.id_fila],
    queryFn: () => compararItemDaFila(item.id_fila),
  })
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({})
  const ignorar = useMutation({
    mutationFn: () => ignorarItemDaFila(item.id_fila),
    onSuccess: (r) => aoConcluir(r.mensagem),
    onError: aoFalhar,
  })

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (!c)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof Error
          ? error.message
          : 'Não foi possível abrir a comparação.'}
      </p>
    )

  const { fica, sai } = ladosDe(c)
  const linhas = linhasDaComparacao(c)
  const faltam = linhas.filter(
    (l) => l.modo === 'escolher' && !escolhas[l.chave],
  )
  const ambos = c.os_dois_sao_associados

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 className="font-semibold">
        {fica.nome_completo} × {sai.nome_completo}
      </h2>
      {c.detalhe && (
        <p className="mt-1 text-sm text-muted-foreground">
          Por que apareceu: {c.detalhe}
        </p>
      )}
      {c.cpf_diferente && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-destructive/30 bg-perigo-tinta px-3 py-2 text-sm font-semibold text-destructive"
        >
          Os CPFs são diferentes. Confira se é mesmo a mesma pessoa antes de
          juntar; se não for, use "Não é a mesma pessoa".
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        <div className="hidden grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_10rem] gap-3 bg-muted/60 px-4 py-2.5 text-xs font-bold text-muted-foreground sm:grid">
          <span className="tracking-wide uppercase">Campo</span>
          <span>
            <span className="text-foreground">Cadastro que fica</span> ·{' '}
            {cabecalhoDoLado(fica)}
          </span>
          <span>
            <span className="text-foreground">Cadastro juntado</span> ·{' '}
            {cabecalhoDoLado(sai)}
          </span>
          <span className="tracking-wide uppercase">O que fica</span>
        </div>

        {/* a matrícula: nunca se escolhe */}
        <LinhaInformativa
          rotulo="Matrícula"
          fica={
            fica.associado
              ? `${fica.associado.numero_matricula ?? '—'}${mesAno(fica.associado.data_admissao) ? ` · desde ${mesAno(fica.associado.data_admissao)}` : ''}`
              : '—'
          }
          sai={
            sai.associado
              ? `${sai.associado.numero_matricula ?? '—'}${mesAno(sai.associado.data_admissao) ? ` · desde ${mesAno(sai.associado.data_admissao)}` : ''}`
              : '—'
          }
          resultado={
            <span className="flex items-center gap-1.5 font-bold text-verde-texto">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {ambos
                ? `Fica a ${fica.associado?.numero_matricula}, a mais antiga`
                : fica.associado
                  ? `Fica a ${fica.associado.numero_matricula}`
                  : 'Nenhum é associado'}
            </span>
          }
        />

        {linhas.map((l) =>
          l.modo === 'escolher' ? (
            <div
              key={l.chave}
              role="radiogroup"
              aria-labelledby={`rotulo-escolha-${l.chave}`}
              className="grid gap-2 border-t border-border px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_10rem] sm:items-center sm:gap-3"
            >
              <span
                id={`rotulo-escolha-${l.chave}`}
                className="text-sm font-bold"
              >
                {l.rotulo}
              </span>
              {(['mantida', 'absorvida'] as const).map((lado) => {
                const valor = mostrar(l, lado === 'mantida' ? l.fica : l.sai)
                const marcado = escolhas[l.chave] === lado
                return (
                  <label
                    key={lado}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm break-words',
                      marcado
                        ? 'border-primary bg-verde-tinta font-bold'
                        : 'border-input bg-card',
                    )}
                  >
                    <input
                      type="radio"
                      name={`escolha-${l.chave}`}
                      checked={marcado}
                      onChange={() =>
                        setEscolhas((e) => ({ ...e, [l.chave]: lado }))
                      }
                      className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-normal text-muted-foreground sm:sr-only">
                        {lado === 'mantida'
                          ? 'Do cadastro que fica'
                          : 'Do cadastro juntado'}
                      </span>
                      {valor}
                    </span>
                  </label>
                )
              })}
              <span className="text-xs">
                {escolhas[l.chave] ? (
                  <span className="font-bold text-verde-texto">Escolhido</span>
                ) : (
                  <span className="rounded-full bg-ouro-tinta px-2.5 py-0.5 font-bold text-ouro-texto">
                    Escolha um
                  </span>
                )}
              </span>
            </div>
          ) : (
            <LinhaInformativa
              key={l.chave}
              rotulo={l.rotulo}
              fica={mostrar(l, l.fica) ?? '(vazio)'}
              sai={mostrar(l, l.sai) ?? '(vazio)'}
              resultado={
                <span className="text-muted-foreground">
                  {l.modo === 'igual'
                    ? 'Igual'
                    : l.modo === 'so_um'
                      ? 'Fica o que tem'
                      : 'Vem do juntado'}
                </span>
              }
            />
          ),
        )}

        {c.situacao && (
          <LinhaInformativa
            rotulo="Situação"
            fica={c.situacao.fica ?? '—'}
            sai={c.situacao.sai ?? '—'}
            resultado={<span className="font-bold">{c.situacao.depois}</span>}
          />
        )}
        {c.acesso && (
          <LinhaInformativa
            rotulo="Acesso ao painel"
            fica={c.acesso.fica}
            sai={c.acesso.sai}
            resultado={<span className="font-bold">{c.acesso.depois}</span>}
          />
        )}
        <LinhaInformativa
          rotulo="Mensalidades e histórico"
          fica={resumoDoHistorico(fica)}
          sai={resumoDoHistorico(sai)}
          resultado={
            <span className="font-bold">Tudo passa para o que fica</span>
          }
        />
      </div>

      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <p
          className={cn(
            'text-sm font-bold sm:mr-auto',
            faltam.length ? 'text-ouro-texto' : 'text-verde-texto',
          )}
          aria-live="polite"
        >
          {faltam.length
            ? `Falta escolher ${faltam.length} ${faltam.length === 1 ? 'campo' : 'campos'} (${faltam.map((f) => f.rotulo.toLowerCase()).join(', ')}).`
            : 'Tudo escolhido.'}
        </p>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={ignorar.isPending}
          onClick={() => ignorar.mutate()}
        >
          Não é a mesma pessoa
        </Button>
        <Button variant="outline" className="min-h-11" onClick={aoVoltar}>
          Voltar à fila
        </Button>
        <Button
          className="min-h-11"
          disabled={faltam.length > 0}
          onClick={() => aoContinuar(c, escolhas)}
        >
          Continuar
        </Button>
      </div>
    </section>
  )
}

function resumoDoHistorico(l: LadoDaComparacao): string {
  const partes = []
  if (l.associado)
    partes.push(
      `${l.associado.titulos_pagos} pagas · ${l.associado.titulos_em_aberto} em aberto`,
    )
  if (l.familiares)
    partes.push(
      `${l.familiares} ${l.familiares === 1 ? 'familiar' : 'familiares'}`,
    )
  return partes.join(' · ') || '—'
}

function LinhaInformativa({
  rotulo,
  fica,
  sai,
  resultado,
}: {
  rotulo: string
  fica: ReactNode
  sai: ReactNode
  resultado: ReactNode
}) {
  return (
    <div className="grid gap-1 border-t border-border px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_10rem] sm:items-center sm:gap-3">
      <span className="font-bold">{rotulo}</span>
      <span className="break-words">
        <span className="text-xs text-muted-foreground sm:sr-only">
          Que fica:{' '}
        </span>
        {fica}
      </span>
      <span className="break-words">
        <span className="text-xs text-muted-foreground sm:sr-only">
          Juntado:{' '}
        </span>
        {sai}
      </span>
      <span className="text-xs">{resultado}</span>
    </div>
  )
}

/* ============================== 3) confirmar ============================== */
function Confirmacao({
  comparacao: c,
  escolhas,
  aoVoltar,
  aoConcluir,
  aoFalhar,
}: {
  comparacao: ComparacaoDeDuplicado
  escolhas: Record<string, Escolha>
  aoVoltar: () => void
  aoConcluir: (mensagem: string) => void
  aoFalhar: (e: unknown) => void
}) {
  const { fica, sai } = ladosDe(c)
  const [nome, setNome] = useState('')
  const linhas = linhasDaComparacao(c)
  const final = (l: Linha) =>
    l.modo === 'escolher'
      ? escolhas[l.chave] === 'absorvida'
        ? l.sai
        : l.fica
      : l.modo === 'vem_do_juntado'
        ? l.sai
        : l.fica
  const juntar = useMutation({
    mutationFn: () =>
      mesclarPessoas(fica.id_pessoa, {
        id_pessoa_absorvida: sai.id_pessoa,
        nome_confirmacao: nome,
        escolhas,
        id_fila: c.id_fila,
        assinatura: c.assinatura,
      }),
    onSuccess: (r) =>
      aoConcluir(
        `Cadastros juntados.${r.matricula_liberada ? ` A matrícula nº ${r.matricula_liberada} ficou livre: um associado novo pode recebê-la (o sistema dá sempre o menor número livre).` : ''}`,
      ),
    onError: aoFalhar,
  })

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
            Vai ficar assim
          </h2>
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            {fica.associado && (
              <>
                <dt className="text-muted-foreground">Matrícula</dt>
                <dd className="font-bold">{fica.associado.numero_matricula}</dd>
              </>
            )}
            {linhas
              .filter((l) => final(l))
              .map((l) => (
                <div key={l.chave} className="contents">
                  <dt className="text-muted-foreground">{l.rotulo}</dt>
                  <dd className="font-bold break-words">
                    {mostrar(l, final(l))}
                  </dd>
                </div>
              ))}
          </dl>
        </div>
        <div className="rounded-xl bg-ouro-tinta p-4 text-sm">
          <h2 className="mb-2 font-bold">O que acontece ao juntar</h2>
          <ul className="flex flex-col gap-1.5">
            {c.os_dois_sao_associados && (
              <li>
                Fica a matrícula mais antiga, a{' '}
                <strong>nº {fica.associado?.numero_matricula}</strong>. A{' '}
                <strong>nº {sai.associado?.numero_matricula}</strong> fica livre
                (um associado novo pode recebê-la).
              </li>
            )}
            <li>
              Tudo do cadastro juntado passa para o que fica: mensalidades e
              pagamentos, histórico, família, cargos e observações. A
              mensalidade do mesmo mês cobrada nos dois fica uma só (a paga, ou
              a do cadastro que fica); paga nos dois, a junção é recusada.
            </li>
            {c.situacao && <li>Situação: {c.situacao.depois}.</li>}
            {c.acesso && <li>Acesso ao painel: {c.acesso.depois}.</li>}
            <li>
              Ficam os dados escolhidos no passo 2; os outros são descartados.
            </li>
            <li>Não tem volta. A Auditoria registra quem juntou e quando.</li>
          </ul>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="nome-para-juntar" className="text-sm font-medium">
            Para confirmar, digite o nome do cadastro que será juntado:{' '}
            <strong>{sai.nome_completo}</strong>
          </label>
          <input
            id="nome-para-juntar"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoComplete="off"
            className={cn(campoClasse, 'mt-1')}
          />
        </div>
        <Button variant="outline" className="min-h-11" onClick={aoVoltar}>
          Voltar
        </Button>
        <Button
          variant="destructive"
          className="min-h-11"
          disabled={juntar.isPending || !nome.trim()}
          onClick={() => juntar.mutate()}
        >
          {juntar.isPending ? 'Juntando…' : 'Juntar os dois cadastros'}
        </Button>
      </div>
    </section>
  )
}
