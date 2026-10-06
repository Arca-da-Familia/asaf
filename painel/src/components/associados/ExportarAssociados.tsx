import { useMutation } from '@tanstack/react-query'
import Papa from 'papaparse'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  COLUNAS_EXPORTAVEIS_DE_ASSOCIADOS,
  exportarAssociados,
  type ExportacaoDeAssociados,
} from '@/lib/api'
import { useMe } from '@/lib/use-me'

const PADRAO = ['nome_completo', 'categoria', 'status_arrolamento']

function baixar(exportacao: ExportacaoDeAssociados) {
  const csv = Papa.unparse({
    fields: exportacao.colunas,
    data: exportacao.linhas.map((l) =>
      exportacao.colunas.map((c) => l[c] ?? ''),
    ),
  })
  // BOM para o Excel abrir os acentos certos
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'associados.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// v1.3 no servidor, tela só na v5.4c (achado AO VIVO na homologação, 2026-10-05): a exportação da base de associados existia, com permissão
// própria e auditoria, e nenhuma tela a oferecia. Só aparece para quem tem `exportar_dados_pessoais`.
export function ExportarAssociados() {
  const { data: eu } = useMe()
  const [aberto, setAberto] = useState(false)
  const [escolhidas, setEscolhidas] = useState<string[]>(PADRAO)
  const [resultado, setResultado] = useState<ExportacaoDeAssociados | null>(
    null,
  )

  const exportar = useMutation({
    mutationFn: () => exportarAssociados(escolhidas),
    onSuccess: setResultado,
  })

  if (!eu?.permissoes.includes('exportar_dados_pessoais')) return null

  function alternar(chave: string) {
    setResultado(null)
    setEscolhidas((atual) =>
      atual.includes(chave)
        ? atual.filter((c) => c !== chave)
        : [...atual, chave],
    )
  }

  return (
    <div className="mb-6">
      <Button variant="outline" onClick={() => setAberto((v) => !v)}>
        Exportar dados dos associados
      </Button>
      {aberto && (
        <section
          className="mt-3 rounded-xl border border-border bg-card p-5"
          aria-label="Exportar dados dos associados"
        >
          <fieldset>
            <legend className="text-sm font-medium">Quais colunas?</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
              {COLUNAS_EXPORTAVEIS_DE_ASSOCIADOS.map((c) => (
                <label
                  key={c.chave}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={escolhidas.includes(c.chave)}
                    onChange={() => alternar(c.chave)}
                  />
                  {c.rotulo}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-3 text-xs text-muted-foreground">
            São dados pessoais: cada exportação fica registrada na Auditoria
            (quem, quantas linhas e quais colunas; nunca o conteúdo).
          </p>
          <Button
            className="mt-3"
            disabled={exportar.isPending || escolhidas.length === 0}
            onClick={() => exportar.mutate()}
          >
            {exportar.isPending ? 'Gerando…' : 'Gerar exportação'}
          </Button>
          {exportar.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {(exportar.error as Error).message}
            </p>
          )}
          {resultado && (
            <div className="mt-4">
              <p role="status" className="text-sm">
                <strong data-testid="exportacao-total">
                  {resultado.linhas.length}
                </strong>{' '}
                linha(s) prontas.
              </p>
              <div className="mt-2 max-h-64 overflow-auto rounded-md border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {resultado.colunas.map((c) => (
                        <th key={c} className="p-2">
                          {COLUNAS_EXPORTAVEIS_DE_ASSOCIADOS.find(
                            (x) => x.chave === c,
                          )?.rotulo ?? c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {resultado.linhas.slice(0, 10).map((l, i) => (
                      <tr key={i} className="border-t border-border">
                        {resultado.colunas.map((c) => (
                          <td key={c} className="p-2">
                            {l[c] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {resultado.linhas.length > 10 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Mostrando as 10 primeiras; o arquivo leva todas.
                </p>
              )}
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => baixar(resultado)}
              >
                Baixar CSV
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
