import { useQuery } from '@tanstack/react-query'
import { FileCheck } from 'lucide-react'
import { useState } from 'react'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { listarDocumentosEmitidos, listarEventos, urlArquivo } from '@/lib/api'
import { formatarData } from '@/lib/datas'

// v5.4e - os crachás e certificados que o sistema já emitiu (backend v4.0, motor de documento gerado), todos numerados e nunca reaproveitados. A
// rota existia desde a v4.0 sem tela: o que se emitiu só aparecia na hora, na tela do evento. Aqui é o registro, com filtro por evento, e cada
// linha abre o PDF.
export function DocumentosEmitidosPage() {
  const [idEvento, setIdEvento] = useState('')

  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: listarEventos,
  })
  const { data: documentos, isLoading } = useQuery({
    queryKey: ['documentos-emitidos', idEvento],
    queryFn: () =>
      listarDocumentosEmitidos(
        idEvento
          ? { contexto_tipo: 'Evento', id_contexto: Number(idEvento) }
          : {},
      ),
  })

  return (
    <>
      <PageHeader
        titulo="Documentos emitidos"
        descricao="Crachás e certificados que o sistema já emitiu, numerados em sequência."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Documentos emitidos' },
        ]}
      />

      <div className="mb-4 flex items-center gap-2 text-sm">
        <label htmlFor="filtro-evento" className="text-muted-foreground">
          Evento
        </label>
        <select
          id="filtro-evento"
          value={idEvento}
          onChange={(e) => setIdEvento(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos os eventos</option>
          {(eventos ?? []).map((e) => (
            <option key={e.id_evento} value={e.id_evento}>
              {e.titulo}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {!isLoading && (documentos ?? []).length === 0 && (
        <EmptyState
          icone={FileCheck}
          titulo="Nenhum documento emitido"
          descricao="Crachás e certificados aparecem aqui depois de emitidos na tela do evento."
        />
      )}
      <div className="v3-space-y-2">
        {(documentos ?? []).map((d) => (
          <div
            key={d.id_documento}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                Nº {d.numero_sequencial} · {d.nome_template ?? 'Documento'}
              </p>
              <p className="text-muted-foreground">
                {d.nome_pessoa ?? 'Sem pessoa'}
                {d.titulo_contexto && ` · ${d.titulo_contexto}`}
              </p>
              <p className="text-xs text-muted-foreground">
                Emitido em {formatarData(d.emitida_em, { comHora: true })}
              </p>
            </div>
            <a
              className="text-primary underline"
              href={urlArquivo(d.caminho_arquivo)}
              target="_blank"
              rel="noreferrer"
            >
              Abrir o PDF
            </a>
          </div>
        ))}
      </div>
    </>
  )
}
