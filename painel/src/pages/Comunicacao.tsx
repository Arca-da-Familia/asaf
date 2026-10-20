import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  COR_DA_SITUACAO,
  listarAvisos,
  resumoDoEmail,
  type SituacaoDoAviso,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - o módulo Comunicação (permissão `comunicar`): os avisos publicados, com os totais de leitura. Cada um abre o relatório de quem leu e confirmou.
const POR_PAGINA = 25
const SITUACOES: SituacaoDoAviso[] = ['No mural', 'Vencido', 'Retirado']
const classeCampo =
  'h-9 rounded-md border border-input bg-background px-3 text-sm'

export function ComunicacaoPage() {
  const [situacao, setSituacao] = useState<SituacaoDoAviso | ''>('')
  const [textoBusca, setTextoBusca] = useState('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)

  // a busca espera a pessoa parar de digitar e volta para a primeira página
  useEffect(() => {
    const espera = setTimeout(() => {
      setBusca(textoBusca.trim())
      setPagina(1)
    }, 400)
    return () => clearTimeout(espera)
  }, [textoBusca])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['avisos', situacao, busca, pagina],
    queryFn: () =>
      listarAvisos({
        situacao: situacao || undefined,
        busca: busca || undefined,
        pagina,
        por_pagina: POR_PAGINA,
      }),
    placeholderData: (anterior) => anterior,
  })
  const itens = data?.itens ?? []
  const totalDePaginas = Math.max(1, Math.ceil((data?.total ?? 0) / POR_PAGINA))

  return (
    <>
      <PageHeader
        titulo="Avisos publicados"
        descricao="Os avisos do mural do painel e quem leu e confirmou cada um."
        acoes={
          <Link
            to="/comunicacao/novo"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Novo aviso
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Buscar pelo título</span>
          <input
            className={classeCampo}
            value={textoBusca}
            onChange={(e) => setTextoBusca(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Situação</span>
          <select
            className={classeCampo}
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value as SituacaoDoAviso | '')
              setPagina(1)
            }}
          >
            <option value="">Todas</option>
            {SITUACOES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os avisos.
        </p>
      ) : itens.length === 0 ? (
        <EmptyState
          icone={Megaphone}
          titulo={
            busca || situacao
              ? 'Nenhum aviso encontrado'
              : 'Nenhum aviso publicado'
          }
          descricao="Use “Novo aviso” para publicar no mural de um grupo."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Aviso</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Para quem</th>
                <th className="px-3 py-2 font-medium">Receberam</th>
                <th className="px-3 py-2 font-medium">Leram</th>
                <th className="px-3 py-2 font-medium">Confirmaram</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.id_aviso} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      to={`/comunicacao/${a.id_aviso}`}
                      className="font-medium underline"
                    >
                      {a.titulo}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {a.categoria_rotulo} · {formatarData(a.publicado_em)} ·
                      até {formatarData(a.valido_ate)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${COR_DA_SITUACAO[a.situacao]}`}
                    >
                      {a.situacao}
                    </span>
                  </td>
                  <td className="px-3 py-2">{a.publico_descricao}</td>
                  <td className="px-3 py-2">
                    {a.totais.destinatarios}
                    {a.totais.sem_acesso
                      ? ` (${a.totais.sem_acesso} sem acesso)`
                      : ''}
                    {a.por_email && (
                      <span className="block text-xs text-muted-foreground">
                        E-mail: {resumoDoEmail(a.email, a.por_email)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{a.totais.lidos ?? '—'}</td>
                  <td className="px-3 py-2">
                    {a.exige_confirmacao
                      ? (a.totais.confirmados ?? '—')
                      : 'Não pede'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {totalDePaginas > 1 && (
        <nav
          aria-label="Páginas"
          className="mt-4 flex items-center gap-3 text-sm"
        >
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </button>
          <span>
            Página {pagina} de {totalDePaginas}
          </span>
          <button
            type="button"
            className="underline disabled:opacity-50"
            disabled={pagina >= totalDePaginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </button>
        </nav>
      )}
    </>
  )
}
