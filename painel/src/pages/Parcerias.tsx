import { useQuery } from '@tanstack/react-query'
import { Handshake, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { SeloDeSituacao } from '@/components/documentos/Selos'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import {
  listarParcerias,
  moeda,
  opcoesDeParcerias,
  type FiltrosDeParcerias,
} from '@/lib/parcerias'
import { useMe } from '@/lib/use-me'

// v5.4a - lista de parcerias e emendas, da mais nova para a mais antiga. Recebido e pago vêm do livro-caixa.
export function ParceriasPage() {
  const { data: eu } = useMe()
  const podeGerir = eu?.permissoes.includes('parcerias') ?? false
  const [filtros, setFiltros] = useState<FiltrosDeParcerias>({})

  const { data: opcoes } = useQuery({
    queryKey: ['parcerias-opcoes'],
    queryFn: opcoesDeParcerias,
  })
  const { data: parcerias, isLoading } = useQuery({
    queryKey: ['parcerias', filtros],
    queryFn: () => listarParcerias(filtros),
  })

  const paraAprovar = (parcerias ?? []).filter((p) => p.pode_aprovar)

  function mudar(campo: keyof FiltrosDeParcerias, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor || undefined }))
  }

  return (
    <>
      <PageHeader
        titulo="Parcerias e emendas"
        descricao="Emendas parlamentares e termos de fomento ou colaboração. O dinheiro vem do livro-caixa; ao site de transparência só vai o que o Presidente ou o Secretário aprovar."
        acoes={
          podeGerir ? (
            <Button asChild>
              <Link to="/parcerias/nova">
                <Plus aria-hidden="true" /> Nova parceria
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
            ? '1 parceria aguarda a sua aprovação: '
            : `${paraAprovar.length} parcerias aguardam a sua aprovação: `}
          {paraAprovar.map((p, i) => (
            <span key={p.id_parceria}>
              {i > 0 && ', '}
              <Link
                to={`/parcerias/${p.id_parceria}`}
                className="font-medium underline"
              >
                {p.titulo}
              </Link>
            </span>
          ))}
        </p>
      )}

      <form
        role="search"
        aria-label="Filtrar parcerias"
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="flex flex-col gap-1 text-sm">
          Buscar
          <input
            type="search"
            className={`${classeCampo} w-56`}
            placeholder="Título, objeto, nº da emenda…"
            value={filtros.busca ?? ''}
            onChange={(e) => mudar('busca', e.target.value)}
          />
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
          Tipo
          <select
            className={classeCampo}
            value={filtros.tipo ?? ''}
            onChange={(e) => mudar('tipo', e.target.value)}
          >
            <option value="">Todos</option>
            {opcoes?.tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Situação
          <select
            className={classeCampo}
            value={filtros.situacao ?? ''}
            onChange={(e) => mudar('situacao', e.target.value)}
          >
            <option value="">Todas</option>
            {opcoes?.situacoes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Publicação
          <select
            className={classeCampo}
            value={filtros.situacao_publicacao ?? ''}
            onChange={(e) => mudar('situacao_publicacao', e.target.value)}
          >
            <option value="">Todas</option>
            {opcoes?.situacoes_de_publicacao.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !parcerias || parcerias.length === 0 ? (
        <EmptyState
          icone={Handshake}
          titulo="Nenhuma parceria encontrada"
          descricao={
            podeGerir
              ? 'Cadastre a primeira parceria ou emenda, ou ajuste os filtros.'
              : 'Ajuste os filtros para ver outras parcerias.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Parcerias e emendas</caption>
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Parceria
                </th>
                <th scope="col" className="px-3 py-2">
                  Ano
                </th>
                <th scope="col" className="px-3 py-2">
                  Valor
                </th>
                <th scope="col" className="px-3 py-2">
                  Recebido
                </th>
                <th scope="col" className="px-3 py-2">
                  Pago
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
              {parcerias.map((p) => (
                <tr key={p.id_parceria} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      to={`/parcerias/${p.id_parceria}`}
                      className="font-medium hover:underline"
                    >
                      {p.titulo}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {p.tipo_rotulo}
                      {p.numero_emenda ? ` · emenda ${p.numero_emenda}` : ''}
                      {p.proponente ? ` · ${p.proponente}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{p.ano}</td>
                  <td className="px-3 py-2">{moeda(p.valor_total)}</td>
                  <td className="px-3 py-2">{moeda(p.recebido)}</td>
                  <td className="px-3 py-2">{moeda(p.pago)}</td>
                  <td className="px-3 py-2">{p.situacao}</td>
                  <td className="px-3 py-2">
                    <SeloDeSituacao situacao={p.situacao_publicacao} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
