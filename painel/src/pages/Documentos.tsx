import { useQuery } from '@tanstack/react-query'
import { FolderOpen, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Paginador } from '@/components/data/Paginador'

import {
  SeloDeClassificacao,
  SeloDeSituacao,
  SeloDeValidade,
} from '@/components/documentos/Selos'
import { GeradosPeloSistema } from '@/components/documentos/GeradosPeloSistema'
import { RelatorioAnualParaOSite } from '@/components/documentos/RelatorioAnualParaOSite'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Abas } from '@/components/ui/abas'
import { Button } from '@/components/ui/button'
import {
  listarDocumentos,
  listarTiposDeDocumento,
  rotuloDoVinculo,
  type Documento,
  type FiltrosDeDocumentos,
} from '@/lib/documentos'
import { usePaginaLocal } from '@/lib/pagina-local'
import { useMe } from '@/lib/use-me'
import { porPaginaNaTela } from '@/lib/celular'

const classeCampo =
  'h-9 rounded-md border border-input bg-background px-3 text-sm'

// v9.3u (a tela tinha 10,1 alturas de notebook na homologação): cada tipo mostra os 5 primeiros documentos e "Ver todos"; escolhido um tipo, a lista
// dele vem em páginas de 10. As contas do exercício e o relatório anual (para quem prepara documentos) ficam em abas ao lado da biblioteca (?parte=).
const POR_TIPO = porPaginaNaTela(5, 3) // v9.3z2: 3 por tipo no celular (a tela tinha 10,6 alturas)
const POR_PAGINA = 10
const PARTES = ['biblioteca', 'contas', 'relatorio'] as const
type Parte = (typeof PARTES)[number]

function TabelaDeDocumentos({
  lista,
  rotulo,
}: {
  lista: Documento[]
  rotulo: string
}) {
  return (
    <div
      role="region"
      // um nome por tabela (o leitor de tela lista as regiões pelo nome; várias "Documentos" iguais não se distinguem)
      aria-label={`Documentos: ${rotulo}`}
      tabIndex={0}
      className="relative overflow-x-auto rounded-md border border-border"
    >
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2">
              Documento
            </th>
            <th scope="col" className="px-3 py-2">
              Ano
            </th>
            <th scope="col" className="px-3 py-2">
              Classificação
            </th>
            <th scope="col" className="px-3 py-2">
              Situação
            </th>
            <th scope="col" className="px-3 py-2">
              No site
            </th>
          </tr>
        </thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id_documento} className="border-t border-border">
              <td className="px-3 py-2">
                <Link
                  to={`/documentos/${d.id_documento}`}
                  className="font-medium hover:underline"
                >
                  {d.titulo}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>versão {d.versao}</span>
                  {!d.vigente && <span>(não vigente)</span>}
                  <SeloDeValidade validade={d.validade} />
                  {d.vinculo_tipo && (
                    <span>{rotuloDoVinculo(d.vinculo_tipo, d.vinculo_id)}</span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">{d.ano ?? '—'}</td>
              <td className="px-3 py-2">
                <SeloDeClassificacao classificacao={d.classificacao} />
              </td>
              <td className="px-3 py-2">
                <SeloDeSituacao situacao={d.situacao} />
              </td>
              <td className="px-3 py-2">
                {!d.publicar_no_site
                  ? 'Não é para o site'
                  : d.situacao === 'Aprovado'
                    ? 'Publicado'
                    : d.tem_versao_publica
                      ? 'Versão pública pronta'
                      : 'Falta a versão pública'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// v5.4a - Biblioteca de documentos institucionais, AGRUPADA POR TIPO (a crítica do usuário à biblioteca crua do
// Directus: "só coloca aqui, perdeu organização"). Cada grupo é uma tabela; o selo diz o que falta em cada documento.
export function DocumentosPage() {
  const { data: eu } = useMe()
  const podePreparar = eu?.permissoes.includes('documentos') ?? false
  const [filtros, setFiltros] = useState<FiltrosDeDocumentos>({
    vigente: true,
  })

  const { data: tipos } = useQuery({
    queryKey: ['documentos-tipos'],
    queryFn: listarTiposDeDocumento,
  })
  const { data: documentos, isLoading } = useQuery({
    queryKey: ['documentos', filtros],
    queryFn: () => listarDocumentos(filtros),
  })

  const grupos = useMemo(() => {
    const ordem = new Map((tipos?.tipos ?? []).map((t, i) => [t.codigo, i]))
    const porTipo = new Map<string, Documento[]>()
    for (const d of documentos ?? []) {
      porTipo.set(d.tipo, [...(porTipo.get(d.tipo) ?? []), d])
    }
    return [...porTipo.entries()].sort(
      ([a], [b]) => (ordem.get(a) ?? 99) - (ordem.get(b) ?? 99),
    )
  }, [documentos, tipos])

  const paraAprovar = (documentos ?? []).filter((d) => d.pode_aprovar)

  function mudar(campo: keyof FiltrosDeDocumentos, valor: string | boolean) {
    setFiltros((f) => ({ ...f, [campo]: valor === '' ? undefined : valor }))
  }

  // um tipo escolhido: a lista dele inteira, em páginas de 10
  const doTipo = filtros.tipo ? (grupos[0]?.[1] ?? []) : undefined
  const pagina = usePaginaLocal(
    doTipo,
    POR_PAGINA,
    JSON.stringify(filtros) + String(documentos?.length ?? 0),
  )

  const [parametros, setParametros] = useSearchParams()
  const pedida = parametros.get('parte')
  const parte: Parte =
    podePreparar && PARTES.includes(pedida as Parte)
      ? (pedida as Parte)
      : 'biblioteca'
  function irParaParte(chave: string) {
    setParametros(
      (atual) => {
        const novo = new URLSearchParams(atual)
        if (chave === 'biblioteca') novo.delete('parte')
        else novo.set('parte', chave)
        return novo
      },
      { replace: true },
    )
  }

  const biblioteca: ReactNode = (
    <>
      <form
        role="search"
        aria-label="Filtrar documentos"
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="flex flex-col gap-1 text-sm">
          Buscar
          <input
            type="search"
            className={`${classeCampo} w-56`}
            placeholder="Título ou texto do documento"
            value={filtros.busca ?? ''}
            onChange={(e) => mudar('busca', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tipo
          <select
            className={classeCampo}
            value={filtros.tipo ?? ''}
            onChange={(e) => mudar('tipo', e.target.value)}
          >
            <option value="">Todos</option>
            {tipos?.tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Ano
          <input
            type="number"
            className={`${classeCampo} w-24`}
            value={filtros.ano ?? ''}
            onChange={(e) => mudar('ano', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Situação
          <select
            className={classeCampo}
            value={filtros.situacao ?? ''}
            onChange={(e) => mudar('situacao', e.target.value)}
          >
            <option value="">Todas</option>
            {tipos?.situacoes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Classificação
          <select
            className={classeCampo}
            value={filtros.classificacao ?? ''}
            onChange={(e) => mudar('classificacao', e.target.value)}
          >
            <option value="">Todas</option>
            {tipos?.classificacoes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={filtros.vigente === true}
            onChange={(e) => mudar('vigente', e.target.checked ? true : '')}
          />
          Só as versões vigentes
        </label>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : grupos.length === 0 ? (
        <EmptyState
          icone={FolderOpen}
          titulo="Nenhum documento encontrado"
          descricao={
            podePreparar
              ? 'Cadastre o primeiro documento ou ajuste os filtros.'
              : 'Ajuste os filtros para ver outros documentos.'
          }
        />
      ) : doTipo ? (
        <section aria-labelledby="tipo-escolhido">
          <h2 id="tipo-escolhido" className="mb-2 text-lg font-semibold">
            {doTipo[0]?.tipo_rotulo}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({doTipo.length})
            </span>
          </h2>
          <TabelaDeDocumentos
            lista={pagina.daPagina}
            rotulo={doTipo[0]?.tipo_rotulo ?? ''}
          />
          <Paginador
            pagina={pagina.pagina}
            porPagina={pagina.porPagina}
            total={pagina.total}
            aoMudar={pagina.setPagina}
            rotulo="Páginas dos documentos"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => mudar('tipo', '')}
          >
            Ver todos os tipos
          </Button>
        </section>
      ) : (
        <div className="space-y-8">
          {grupos.map(([tipo, lista]) => (
            <section key={tipo} aria-labelledby={`tipo-${tipo}`}>
              <h2 id={`tipo-${tipo}`} className="mb-2 text-lg font-semibold">
                {lista[0]?.tipo_rotulo}{' '}
                <span className="text-sm font-normal text-muted-foreground">
                  ({lista.length})
                </span>
              </h2>
              <TabelaDeDocumentos
                lista={lista.slice(0, POR_TIPO)}
                rotulo={lista[0]?.tipo_rotulo ?? tipo}
              />
              {lista.length > POR_TIPO && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => mudar('tipo', tipo)}
                >
                  Ver todos os {lista.length} ({lista[0]?.tipo_rotulo})
                </Button>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  )

  return (
    <>
      <PageHeader
        titulo="Documentos"
        descricao="Estatuto, atas, certidões, balanços e termos. O original fica guardado em área privada; ao site de transparência só vai a versão pública, conferida e aprovada por outra pessoa."
        acoes={
          podePreparar ? (
            <Button asChild>
              <Link to="/documentos/novo">
                <Plus aria-hidden="true" /> Novo documento
              </Link>
            </Button>
          ) : undefined
        }
      />

      {paraAprovar.length > 0 && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {paraAprovar.length === 1
            ? '1 documento aguarda a sua aprovação: '
            : `${paraAprovar.length} documentos aguardam a sua aprovação: `}
          {paraAprovar.map((d, i) => (
            <span key={d.id_documento}>
              {i > 0 && ', '}
              <Link
                to={`/documentos/${d.id_documento}`}
                className="font-medium underline"
              >
                {d.titulo}
              </Link>
            </span>
          ))}
        </p>
      )}

      {podePreparar ? (
        <Abas
          rotulo="Partes de Documentos"
          atual={parte}
          aoMudar={irParaParte}
          abas={[
            { chave: 'biblioteca', rotulo: 'Biblioteca', conteudo: biblioteca },
            {
              chave: 'contas',
              rotulo: 'Contas do exercício',
              conteudo: <GeradosPeloSistema />,
            },
            {
              chave: 'relatorio',
              rotulo: 'Relatório anual',
              conteudo: <RelatorioAnualParaOSite />,
            },
          ]}
        />
      ) : (
        biblioteca
      )}
    </>
  )
}
