import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { EmptyState } from '@/components/feedback/EmptyState'
import { Campo } from '@/components/forms/Campo'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  TAMANHO_DO_TEXTO,
  TAMANHO_DO_TITULO,
  arquivarModelo,
  criarModelo,
  editarModelo,
  listarModelos,
  opcoesDePublico,
  variaveisDesconhecidas,
  versoesDoModelo,
  type DadosDoModelo,
  type ModeloDeAviso,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.2c - modelos de aviso: textos prontos (ex.: "Convocação de assembleia") que o "Novo aviso" usa. VERSIONADOS: editar cria uma versão nova (a anterior fica no histórico, e o
// aviso que a usou continua apontando para ela); arquivar tira da lista sem apagar. O texto aceita {primeiro_nome} e {nome}.
const classeCampo =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const VAZIO: DadosDoModelo = {
  nome: '',
  titulo: '',
  texto: '',
  categoria: 'GERAL',
  exige_confirmacao: false,
  por_email: false,
}

function FormularioDoModelo({
  inicial,
  rotulo,
  enviando,
  onSalvar,
  onCancelar,
}: {
  inicial: DadosDoModelo
  rotulo: string
  enviando: boolean
  onSalvar: (dados: DadosDoModelo) => void
  onCancelar: () => void
}) {
  const [dados, setDados] = useState(inicial)
  const { data: opcoes } = useQuery({
    queryKey: ['avisos', 'opcoes-de-publico'],
    queryFn: opcoesDePublico,
  })
  const desconhecidas = variaveisDesconhecidas(dados.texto)
  const categorias = opcoes?.categorias_de_aviso ?? []
  const categoria = categorias.some((c) => c.codigo === dados.categoria)
    ? dados.categoria
    : (categorias[0]?.codigo ?? dados.categoria)
  const mudar = (novo: Partial<DadosDoModelo>) =>
    setDados((d) => ({ ...d, ...novo }))

  function aoEnviar(e: FormEvent) {
    e.preventDefault()
    onSalvar({ ...dados, categoria })
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-border p-4"
      onSubmit={aoEnviar}
    >
      <Campo rotulo="Nome do modelo" dica="Só para achar o modelo na lista.">
        <input
          className={classeCampo}
          value={dados.nome}
          maxLength={100}
          onChange={(e) => mudar({ nome: e.target.value })}
          required
        />
      </Campo>
      <Campo rotulo="Título do aviso">
        <input
          className={classeCampo}
          value={dados.titulo}
          maxLength={TAMANHO_DO_TITULO}
          onChange={(e) => mudar({ titulo: e.target.value })}
          required
        />
      </Campo>
      <Campo
        rotulo="Texto do aviso"
        dica="Pode usar {primeiro_nome} e {nome}: cada pessoa vê o próprio nome no lugar."
      >
        <textarea
          className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={dados.texto}
          maxLength={TAMANHO_DO_TEXTO}
          onChange={(e) => mudar({ texto: e.target.value })}
          required
        />
      </Campo>
      {desconhecidas.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Variável que não existe: {desconhecidas.join(', ')}. As que existem:
          {' {primeiro_nome}'} e {'{nome}'}.
        </p>
      )}
      <Campo rotulo="Categoria">
        <select
          className={classeCampo}
          value={categoria}
          onChange={(e) => mudar({ categoria: e.target.value })}
        >
          {(opcoes?.categorias_de_aviso ?? []).map((c) => (
            <option key={c.codigo} value={c.codigo}>
              {c.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={dados.exige_confirmacao}
          onChange={(e) => mudar({ exige_confirmacao: e.target.checked })}
        />
        Pedir confirmação de leitura
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={dados.por_email}
          onChange={(e) => mudar({ por_email: e.target.checked })}
        />
        Também por e-mail
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={enviando || desconhecidas.length > 0}>
          {rotulo}
        </Button>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function Versoes({ modelo }: { modelo: ModeloDeAviso }) {
  const { data, isLoading } = useQuery({
    queryKey: ['modelos-de-aviso', 'versoes', modelo.grupo, modelo.versao],
    queryFn: () => versoesDoModelo(modelo.id_modelo),
  })
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  return (
    <ol className="mt-2 space-y-2 text-sm">
      {(data ?? []).map((v) => (
        <li key={v.id_modelo} className="rounded-md border border-border p-2">
          <p className="font-medium">
            Versão {v.versao} · {formatarData(v.criado_em, { comHora: true })}
            {v.ativo ? ' · em uso' : ''}
          </p>
          <p className="whitespace-pre-wrap break-words text-muted-foreground">
            {v.titulo} — {v.texto}
          </p>
        </li>
      ))}
    </ol>
  )
}

export function ModelosDeAvisoPage() {
  const queryClient = useQueryClient()
  const [criando, setCriando] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [vendoVersoes, setVendoVersoes] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['modelos-de-aviso'],
    queryFn: listarModelos,
  })

  function falhou(e: unknown) {
    setAviso(null)
    setErro(e instanceof ApiError ? e.detail : 'Não foi possível salvar.')
  }
  function pronto(texto: string) {
    setErro(null)
    setAviso(texto)
    queryClient.invalidateQueries({ queryKey: ['modelos-de-aviso'] })
  }

  const criar = useMutation({
    mutationFn: criarModelo,
    onSuccess: (m) => {
      setCriando(false)
      pronto(`Modelo “${m.nome}” criado.`)
    },
    onError: falhou,
  })
  const editar = useMutation({
    mutationFn: (v: { id: number; dados: DadosDoModelo }) =>
      editarModelo(v.id, v.dados),
    onSuccess: (m) => {
      setEditando(null)
      pronto(
        `Modelo “${m.nome}” salvo como versão ${m.versao}; a anterior ficou no histórico.`,
      )
    },
    onError: falhou,
  })
  const arquivar = useMutation({
    mutationFn: arquivarModelo,
    onSuccess: () => pronto('Modelo arquivado (as versões ficam guardadas).'),
    onError: falhou,
  })

  const modelos = data ?? []

  return (
    <>
      <PageHeader
        titulo="Modelos de aviso"
        descricao="Textos prontos para os avisos. Editar cria uma versão nova; as anteriores ficam no histórico."
        acoes={
          !criando && (
            <Button onClick={() => setCriando(true)}>Novo modelo</Button>
          )
        }
      />
      {aviso && (
        <p
          role="status"
          className="mb-4 max-w-3xl rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mb-4 max-w-3xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
      <div className="max-w-3xl space-y-4">
        {criando && (
          <FormularioDoModelo
            inicial={VAZIO}
            rotulo="Criar modelo"
            enviando={criar.isPending}
            onSalvar={(dados) => criar.mutate(dados)}
            onCancelar={() => setCriando(false)}
          />
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar os modelos.
          </p>
        ) : modelos.length === 0 && !criando ? (
          <EmptyState
            titulo="Nenhum modelo"
            descricao="Use “Novo modelo” para guardar um texto que se repete (convocação, lembrete de reunião...)."
          />
        ) : (
          <ul className="space-y-3">
            {modelos.map((m) => (
              <li
                key={m.id_modelo}
                className="rounded-xl border border-border bg-card p-4"
              >
                {editando === m.id_modelo ? (
                  <FormularioDoModelo
                    inicial={m}
                    rotulo="Salvar como versão nova"
                    enviando={editar.isPending}
                    onSalvar={(dados) =>
                      editar.mutate({ id: m.id_modelo, dados })
                    }
                    onCancelar={() => setEditando(null)}
                  />
                ) : (
                  <>
                    <h2 className="font-semibold">{m.nome}</h2>
                    <p className="text-xs text-muted-foreground">
                      Versão {m.versao} ·{' '}
                      {formatarData(m.criado_em, { comHora: true })}
                    </p>
                    <p className="mt-2 text-sm font-medium">{m.titulo}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {m.texto}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditando(m.id_modelo)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setVendoVersoes(
                            vendoVersoes === m.id_modelo ? null : m.id_modelo,
                          )
                        }
                      >
                        {vendoVersoes === m.id_modelo
                          ? 'Esconder versões'
                          : 'Ver versões'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={arquivar.isPending}
                        onClick={() => arquivar.mutate(m.id_modelo)}
                      >
                        Arquivar
                      </Button>
                    </div>
                    {vendoVersoes === m.id_modelo && <Versoes modelo={m} />}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
