import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ChevronRight, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Paginador } from '@/components/data/Paginador'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  emitirOutraCredencial,
  listarCredenciais,
  resumirCredenciais,
  type FiltroDeCredenciais,
  type LinhaDeCredencial,
} from '@/lib/api'
import { abrirFolhaDeImpressao } from '@/lib/credenciais'
import { cn } from '@/lib/utils'

// v9.5j - as credenciais emitidas, no desenho escolhido pelo Presidente (rodada 6): no notebook a tabela com seleção - filtros (todas, falta imprimir,
// impressas, emitidas de novo), marcar várias e "Imprimir as marcadas", que abre a folha A4 com 10 cartões numa SEGUNDA ABA (lá se confere e imprime ou
// salva em PDF; cartão com dado faltando só sai com justificativa); "Emitir outra" para quem perdeu o cartão. No celular, a lista com o nome e como está
// a credencial; tocar abre a ficha na aba Situação, onde estão "Imprimir" e "Emitir outra".

const FILTROS: { id: FiltroDeCredenciais; nome: string }[] = [
  { id: 'todas', nome: 'Todas' },
  { id: 'falta_imprimir', nome: 'Falta imprimir' },
  { id: 'impressas', nome: 'Impressas' },
  { id: 'emitidas_de_novo', nome: 'Emitidas de novo' },
]
const POR_PAGINA = 25
const MAXIMO_POR_VEZ = 60

function dataBR(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem' }).format(
    new Date(iso),
  )
}

function comoEsta(l: LinhaDeCredencial): string {
  if (l.credencial?.impressa_em)
    return `Impressa em ${dataBR(l.credencial.impressa_em)}`
  return 'Falta imprimir'
}

function EmitirOutra({ linha }: { linha: LinhaDeCredencial }) {
  const cliente = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState('')
  const emitir = useMutation({
    mutationFn: () => emitirOutraCredencial(linha.id_associado),
    onSuccess: (r) => {
      setConfirmando(false)
      setAviso(r.mensagem)
      void cliente.invalidateQueries({ queryKey: ['credenciais'] })
    },
    onError: (erro) =>
      setAviso(
        erro instanceof ApiError
          ? erro.detail
          : 'Não foi possível emitir outra agora.',
      ),
  })
  if (aviso)
    return (
      <p role="status" className="text-xs font-semibold">
        {aviso}
      </p>
    )
  if (!confirmando)
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setConfirmando(true)}
      >
        Emitir outra
      </Button>
    )
  return (
    <span className="flex flex-col gap-1 rounded-md bg-ouro-tinta p-2 text-xs text-ouro-texto">
      A atual deixa de valer na hora.
      <span className="flex gap-1">
        <Button
          type="button"
          size="sm"
          disabled={emitir.isPending}
          onClick={() => emitir.mutate()}
        >
          Emitir outra
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setConfirmando(false)}
        >
          Cancelar
        </Button>
      </span>
    </span>
  )
}

export function CredenciaisEmitidasPage() {
  const [filtro, setFiltro] = useState<FiltroDeCredenciais>('todas')
  const [texto, setTexto] = useState('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [marcadas, setMarcadas] = useState<Set<number>>(() => new Set())
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)

  // a busca espera a pessoa parar de digitar
  useEffect(() => {
    if (espera.current) clearTimeout(espera.current)
    espera.current = setTimeout(() => {
      setBusca(texto)
      setPagina(1)
    }, 350)
    return () => {
      if (espera.current) clearTimeout(espera.current)
    }
  }, [texto])

  const { data: resumo } = useQuery({
    queryKey: ['credenciais', 'resumo'],
    queryFn: resumirCredenciais,
  })
  const { data, isLoading, isError } = useQuery({
    queryKey: ['credenciais', filtro, busca, pagina],
    queryFn: () => listarCredenciais(filtro, busca, pagina, POR_PAGINA),
    placeholderData: keepPreviousData,
  })
  const linhas = data?.itens ?? []
  const todasDaPaginaMarcadas =
    linhas.length > 0 && linhas.every((l) => marcadas.has(l.id_associado))

  function alternar(id: number) {
    setMarcadas((atual) => {
      const nova = new Set(atual)
      if (nova.has(id)) nova.delete(id)
      else nova.add(id)
      return nova
    })
  }
  function alternarPagina() {
    setMarcadas((atual) => {
      const nova = new Set(atual)
      for (const l of linhas) {
        if (todasDaPaginaMarcadas) nova.delete(l.id_associado)
        else nova.add(l.id_associado)
      }
      return nova
    })
  }

  return (
    <>
      <PageHeader
        titulo="Credenciais"
        descricao="A credencial de cada associado: imprimir, ou emitir outra se perder."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Credenciais' },
        ]}
      />

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div
          role="group"
          aria-label="Filtrar credenciais"
          className="flex flex-wrap gap-2"
        >
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => {
                setFiltro(f.id)
                setPagina(1)
              }}
              className={cn(
                'min-h-10 rounded-full border px-3 text-sm',
                filtro === f.id
                  ? 'border-primary bg-primary font-extrabold text-primary-foreground'
                  : 'border-border bg-card font-semibold',
              )}
            >
              {f.nome}
              {resumo ? ` · ${resumo[f.id]}` : ''}
            </button>
          ))}
        </div>
        <span className="hidden flex-1 lg:block" />
        <label className="flex flex-col gap-1 text-sm font-semibold lg:w-72">
          <span className="sr-only lg:not-sr-only">Procurar</span>
          <input
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Nome ou matrícula"
            className="min-h-10 rounded-md border border-input bg-card px-3 text-sm font-normal"
          />
        </label>
      </div>

      {marcadas.size > 0 && (
        <div className="mb-3 hidden flex-wrap items-center gap-3 rounded-xl bg-ouro-tinta px-4 py-2 md:flex">
          <span className="text-sm font-extrabold text-ouro-texto">
            {marcadas.size} {marcadas.size === 1 ? 'marcada' : 'marcadas'}
          </span>
          {marcadas.size > MAXIMO_POR_VEZ && (
            <span className="text-sm text-ouro-texto">
              No máximo {MAXIMO_POR_VEZ} por vez (6 folhas A4).
            </span>
          )}
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMarcadas(new Set())}
          >
            Desmarcar
          </Button>
          <Button
            type="button"
            disabled={marcadas.size > MAXIMO_POR_VEZ}
            onClick={() => abrirFolhaDeImpressao([...marcadas])}
          >
            <Printer aria-hidden="true" />
            Imprimir as marcadas (folha A4)
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError ? (
        <EmptyState
          titulo="Não foi possível carregar as credenciais"
          descricao="Confira a conexão e tente de novo."
        />
      ) : linhas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma credencial neste filtro"
          descricao={
            busca
              ? 'Nada encontrado com essa busca.'
              : 'Mude o filtro para ver as outras.'
          }
        />
      ) : (
        <>
          {/* notebook: a tabela com seleção */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
            <table
              className="w-full text-sm"
              aria-label="Credenciais dos associados"
            >
              <thead className="bg-muted text-left text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Marcar todos desta página"
                      checked={todasDaPaginaMarcadas}
                      onChange={alternarPagina}
                      className="h-4 w-4"
                    />
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Associado
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Matr.
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Situação
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Credencial
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr
                    key={l.id_associado}
                    className="border-t border-border align-top"
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Marcar ${l.nome_completo ?? 'associado'}`}
                        checked={marcadas.has(l.id_associado)}
                        onChange={() => alternar(l.id_associado)}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-semibold">
                      <Link
                        to={`/associados/${l.id_associado}?aba=situacao`}
                        className="hover:underline"
                      >
                        {l.nome_completo ?? 'Sem nome'}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {l.matricula ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">{l.situacao ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <span>{comoEsta(l)}</span>
                        {l.emitida_de_novo && (
                          <span className="rounded-full bg-azul-tinta px-2 text-xs font-bold text-azul-texto">
                            Emitida de novo
                          </span>
                        )}
                        {l.faltando.length > 0 && (
                          <span className="rounded-full bg-ouro-tinta px-2 text-xs font-bold text-ouro-texto">
                            Falta {l.faltando.join(' e ')}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap items-start justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            abrirFolhaDeImpressao([l.id_associado])
                          }
                        >
                          Imprimir
                        </Button>
                        <EmitirOutra linha={l} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* celular: o nome e como está a credencial; tocar abre a ficha na aba Situação */}
          <ul
            aria-label="Credenciais"
            className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card md:hidden"
          >
            {linhas.map((l) => (
              <li
                key={l.id_associado}
                className="border-b border-border last:border-0"
              >
                <Link
                  to={`/associados/${l.id_associado}?aba=situacao`}
                  className="flex min-h-16 flex-nowrap items-center gap-3 px-4 py-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-extrabold break-words">
                      {l.nome_completo ?? 'Sem nome'}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {comoEsta(l)}
                      {l.faltando.length > 0
                        ? ` · falta ${l.faltando.join(' e ')}`
                        : ''}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>

          <Paginador
            pagina={pagina}
            porPagina={POR_PAGINA}
            total={data?.total ?? 0}
            aoMudar={setPagina}
            rotulo="Páginas das credenciais"
          />
        </>
      )}
    </>
  )
}
