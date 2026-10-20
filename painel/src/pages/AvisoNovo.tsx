import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Campo } from '@/components/forms/Campo'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  PUBLICO_INICIAL,
  TAMANHO_DO_TEXTO,
  TAMANHO_DO_TITULO,
  alternar,
  conferirPublico,
  dataDaquiA,
  faltaNoPublico,
  mesmoPublico,
  opcoesDePublico,
  publicarAviso,
  publicoParaEnviar,
  type ConferenciaDoPublico,
  type ParteDoProjeto,
  type PublicoDoAviso,
  type TipoDePublico,
} from '@/lib/comunicacao'

// v6.1 - publicar um aviso. O grupo é uma REGRA (associados por situação/categoria, quem tem uma permissão, equipe/voluntários de um projeto) que o
// servidor calcula. Primeiro "Conferir quem vai receber" (o total, quem não tem acesso ao painel e os nomes); só então o botão de publicar aparece, com o
// número de pessoas, e pede confirmação. Mudar o grupo depois de conferir apaga a conferência. O servidor recalcula e recusa se o total mudou.
const classeCampo =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const TIPOS: { valor: TipoDePublico; rotulo: string }[] = [
  { valor: 'associados', rotulo: 'Associados' },
  { valor: 'permissao', rotulo: 'Quem tem uma permissão' },
  { valor: 'projeto', rotulo: 'Equipe e voluntários de um projeto' },
]
const PARTES: { valor: ParteDoProjeto; rotulo: string }[] = [
  { valor: 'equipe', rotulo: 'A equipe do projeto' },
  { valor: 'voluntarios', rotulo: 'Os voluntários associados' },
]

export function AvisoNovoPage() {
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const { data: opcoes } = useQuery({
    queryKey: ['avisos', 'opcoes-de-publico'],
    queryFn: opcoesDePublico,
  })

  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [categoria, setCategoria] = useState('GERAL')
  const [validoAte, setValidoAte] = useState(() => dataDaquiA(30))
  const [exigeConfirmacao, setExigeConfirmacao] = useState(false)
  const [publico, setPublico] = useState<PublicoDoAviso>(PUBLICO_INICIAL)
  // a conferência guarda o grupo que foi conferido: só vale enquanto o grupo escolhido for o MESMO (uma resposta que chega depois de a pessoa mudar o
  // grupo não habilita o botão), e o que se publica é exatamente o grupo conferido
  const [conferenciaGuardada, setConferencia] = useState<
    (ConferenciaDoPublico & { publico: PublicoDoAviso }) | null
  >(null)
  const conferencia =
    conferenciaGuardada && mesmoPublico(conferenciaGuardada.publico, publico)
      ? conferenciaGuardada
      : null
  // se a diretoria desativar "Geral" no catálogo, o padrão vira a primeira categoria ativa
  const categorias = opcoes?.categorias_de_aviso ?? []
  const categoriaEscolhida = categorias.some((c) => c.codigo === categoria)
    ? categoria
    : (categorias[0]?.codigo ?? categoria)
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function mudarPublico(novo: Partial<PublicoDoAviso>) {
    setPublico((atual) => ({ ...atual, ...novo }))
    setConferencia(null) // o grupo mudou: a contagem anterior não vale mais
  }

  const conferir = useMutation({
    mutationFn: (enviado: PublicoDoAviso) => conferirPublico(enviado),
    onSuccess: (resultado, enviado) => {
      setErro(null)
      setConferencia({ ...resultado, publico: enviado })
    },
    onError: (e) =>
      setErro(
        e instanceof ApiError ? e.detail : 'Não foi possível conferir o grupo.',
      ),
  })

  const publicar = useMutation({
    mutationFn: () =>
      publicarAviso({
        titulo,
        texto,
        categoria: categoriaEscolhida,
        valido_ate: validoAte,
        exige_confirmacao: exigeConfirmacao,
        publico: conferencia ? conferencia.publico : publicoParaEnviar(publico),
        total_confirmado: conferencia?.total ?? 0,
      }),
    onSuccess: (aviso) => {
      queryClient.invalidateQueries({ queryKey: ['avisos'] })
      queryClient.invalidateQueries({ queryKey: ['meus-avisos'] })
      queryClient.invalidateQueries({ queryKey: ['minhas-notificacoes'] })
      navegar(`/comunicacao/${aviso.id_aviso}`)
    },
    onError: (e) => {
      setConfirmando(false)
      // 409 = o grupo mudou desde a conferência: a contagem antiga sai da tela e a pessoa confere de novo
      if (e instanceof ApiError && e.status === 409) setConferencia(null)
      setErro(e instanceof ApiError ? e.detail : 'Não foi possível publicar.')
    },
  })

  const falta = faltaNoPublico(publico)
  const textoPronto = titulo.trim() !== '' && texto.trim() !== ''

  function aoEnviar(e: FormEvent) {
    e.preventDefault()
    if (!conferencia || conferencia.total === 0 || !textoPronto) return
    setErro(null)
    setConfirmando(true)
  }

  return (
    <>
      <PageHeader
        titulo="Novo aviso"
        trilha={[
          { rotulo: 'Avisos publicados', href: '/comunicacao' },
          { rotulo: 'Novo' },
        ]}
        descricao="O aviso aparece no mural e na caixa de entrada de cada pessoa do grupo. Depois de publicado, não se edita: se precisar corrigir, retire-o e publique outro."
      />
      {erro && (
        <p
          role="alert"
          className="mb-4 max-w-3xl rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
      <form className="max-w-3xl space-y-4" onSubmit={aoEnviar}>
        <Campo rotulo="Título">
          <input
            className={classeCampo}
            value={titulo}
            maxLength={TAMANHO_DO_TITULO}
            onChange={(e) => setTitulo(e.target.value)}
            required
          />
        </Campo>
        <Campo
          rotulo="Texto"
          dica="Só texto; as quebras de linha são mantidas."
        >
          <textarea
            className="min-h-32 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={texto}
            maxLength={TAMANHO_DO_TEXTO}
            onChange={(e) => setTexto(e.target.value)}
            required
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Categoria">
            <select
              className={classeCampo}
              value={categoriaEscolhida}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {(opcoes?.categorias_de_aviso ?? []).map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            rotulo="No mural até"
            dica="Depois desse dia o aviso sai do mural, mas continua na caixa de entrada de quem recebeu."
          >
            <input
              type="date"
              className={classeCampo}
              value={validoAte}
              min={dataDaquiA(0)}
              onChange={(e) => setValidoAte(e.target.value)}
              required
            />
          </Campo>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={exigeConfirmacao}
            onChange={(e) => setExigeConfirmacao(e.target.checked)}
          />
          <span>
            <span className="font-medium">Pedir confirmação de leitura</span>
            <span className="block text-xs text-muted-foreground">
              Cada pessoa vê o botão “Li e estou ciente”; a data fica
              registrada. Use em convocação e mudança de regra.
            </span>
          </span>
        </label>

        <fieldset className="space-y-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Quem recebe</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {TIPOS.map((t) => (
              <label key={t.valor} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="tipo-de-publico"
                  checked={publico.tipo === t.valor}
                  onChange={() => mudarPublico({ tipo: t.valor })}
                />
                {t.rotulo}
              </label>
            ))}
          </div>

          {publico.tipo === 'permissao' && (
            <Campo rotulo="Permissão">
              <select
                className={classeCampo}
                value={publico.codigo_permissao ?? ''}
                onChange={(e) =>
                  mudarPublico({
                    codigo_permissao: e.target.value || undefined,
                  })
                }
              >
                <option value="">Escolha…</option>
                {(opcoes?.permissoes ?? []).map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} — {p.descricao}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          {publico.tipo === 'projeto' && (
            <>
              <Campo rotulo="Projeto">
                <select
                  className={classeCampo}
                  value={publico.id_projeto ?? ''}
                  onChange={(e) =>
                    mudarPublico({
                      id_projeto: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                >
                  <option value="">Escolha…</option>
                  {(opcoes?.projetos ?? []).map((p) => (
                    <option key={p.id_projeto} value={p.id_projeto}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <div className="flex flex-wrap gap-4 text-sm">
                {PARTES.map((p) => (
                  <label key={p.valor} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={publico.partes_do_projeto.includes(p.valor)}
                      onChange={() =>
                        mudarPublico({
                          partes_do_projeto: alternar(
                            publico.partes_do_projeto,
                            p.valor,
                          ),
                        })
                      }
                    />
                    {p.rotulo}
                  </label>
                ))}
              </div>
            </>
          )}

          {publico.tipo !== 'permissao' && (
            <>
              {/* a situação (em dia, inadimplente...) só aparece a quem pode vê-la: o servidor manda a lista vazia para quem só tem `comunicar` */}
              {(opcoes?.situacoes ?? []).length > 0 && (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">
                    Situação do associado (nenhuma marcada = todas, menos
                    desligado)
                  </legend>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {(opcoes?.situacoes ?? []).map((s) => (
                      <label key={s} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={publico.situacoes.includes(s)}
                          onChange={() =>
                            mudarPublico({
                              situacoes: alternar(publico.situacoes, s),
                            })
                          }
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <fieldset>
                <legend className="mb-1 text-sm font-medium">
                  Categoria (nenhuma marcada = todas)
                </legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(opcoes?.categorias_de_associado ?? []).map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={publico.categorias.includes(c)}
                        onChange={() =>
                          mudarPublico({
                            categorias: alternar(publico.categorias, c),
                          })
                        }
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          <div>
            <Button
              type="button"
              variant="outline"
              disabled={falta !== null || conferir.isPending}
              onClick={() => conferir.mutate(publicoParaEnviar(publico))}
            >
              Conferir quem vai receber
            </Button>
            {falta && (
              <span className="ml-3 text-xs text-muted-foreground">
                {falta}
              </span>
            )}
          </div>

          {conferencia && (
            <div role="status" className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">
                {conferencia.descricao}:{' '}
                {conferencia.total === 1
                  ? '1 pessoa'
                  : `${conferencia.total} pessoas`}
                {conferencia.sem_acesso > 0 &&
                  ` (${conferencia.sem_acesso} sem acesso ao painel: o aviso fica guardado no nome delas, mas elas não são avisadas agora)`}
                .
              </p>
              {conferencia.total === 0 ? (
                <p className="mt-1">
                  Ninguém está neste grupo hoje. Mude a escolha.
                </p>
              ) : (
                <details className="mt-2">
                  <summary className="cursor-pointer underline">
                    Ver os nomes
                  </summary>
                  <ul className="mt-2 max-h-64 list-disc space-y-0.5 overflow-y-auto pl-5">
                    {conferencia.pessoas.map((p, i) => (
                      <li key={`${p.nome}-${i}`}>
                        {p.nome}
                        {!p.tem_acesso && (
                          <span className="text-muted-foreground">
                            {' '}
                            (sem acesso ao painel)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              !conferencia ||
              conferencia.total === 0 ||
              !textoPronto ||
              publicar.isPending
            }
          >
            {conferencia && conferencia.total > 0
              ? `Publicar para ${conferencia.total === 1 ? '1 pessoa' : `${conferencia.total} pessoas`}`
              : 'Publicar'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navegar('/comunicacao')}
          >
            Cancelar
          </Button>
        </div>
        {!conferencia && (
          <p className="text-xs text-muted-foreground">
            Para publicar, primeiro confira quem vai receber.
          </p>
        )}
      </form>

      <ConfirmDialog
        aberto={confirmando}
        onAbertoChange={setConfirmando}
        titulo="Publicar este aviso?"
        descricao={`O aviso “${titulo.trim()}” vai para ${conferencia?.total === 1 ? '1 pessoa' : `${conferencia?.total ?? 0} pessoas`}. Depois de publicado, ele não se edita; dá para retirar com um motivo.`}
        rotuloConfirmar={`Publicar para ${conferencia?.total === 1 ? '1 pessoa' : `${conferencia?.total ?? 0} pessoas`}`}
        onConfirmar={() => publicar.mutate()}
        carregando={publicar.isPending}
      />
    </>
  )
}
