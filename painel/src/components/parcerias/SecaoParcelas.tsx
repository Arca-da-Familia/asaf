import { useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Secao } from '@/components/layout/Secao'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import { isoParaDataBr } from '@/lib/datas'
import {
  apagarParcela,
  criarParcela,
  lerValorEmReais,
  moeda,
  type Executar,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

// Parcela = o que está PREVISTO receber. O recebido de verdade vem do livro-caixa e aparece na coluna "Recebido".
export function SecaoParcelas({
  d,
  executar,
}: {
  d: ParceriaDetalhe
  executar: Executar
}) {
  const [valor, setValor] = useState('')
  const [data, setData] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const falta = d.valor_total - d.total_das_parcelas

  async function adicionar() {
    setErro(null)
    const lido = lerValorEmReais(valor)
    if (!lido)
      return setErro(
        'Informe o valor da parcela em reais, por exemplo 10.000,00.',
      )
    const ok = await executar(() =>
      criarParcela(d.id_parceria, {
        valor_previsto: lido,
        ...(data ? { data_prevista: data } : {}),
      }),
    )
    if (ok) {
      setValor('')
      setData('')
    }
  }

  return (
    <Secao
      titulo="Parcelas previstas"
      descricao={`As parcelas somam ${moeda(d.total_das_parcelas)} de ${moeda(d.valor_total)}${falta > 0 ? ` (faltam ${moeda(falta)} para detalhar)` : ''}.`}
    >
      {d.parcelas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma parcela cadastrada.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Parcela
                </th>
                <th scope="col" className="px-3 py-2">
                  Prevista
                </th>
                <th scope="col" className="px-3 py-2">
                  Para o dia
                </th>
                <th scope="col" className="px-3 py-2">
                  Recebido (livro-caixa)
                </th>
                {d.pode_editar && (
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {d.parcelas.map((p) => (
                <tr key={p.id_parcela} className="border-t border-border">
                  <td className="px-3 py-2">{p.numero}ª</td>
                  <td className="px-3 py-2">{moeda(p.valor_previsto)}</td>
                  <td className="px-3 py-2">
                    {p.data_prevista ? isoParaDataBr(p.data_prevista) : '—'}
                  </td>
                  <td className="px-3 py-2">{moeda(p.valor_recebido)}</td>
                  {d.pode_editar && (
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void executar(() =>
                            apagarParcela(d.id_parceria, p.id_parcela),
                          )
                        }
                      >
                        Apagar
                        <span className="sr-only"> a parcela {p.numero}</span>
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.pode_editar && (
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Valor da nova parcela (R$)" className="w-48">
            <input
              inputMode="decimal"
              className={classeCampo}
              value={valor}
              placeholder="10.000,00"
              onChange={(e) => setValor(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Prevista para (opcional)" className="w-44">
            <input
              type="date"
              className={classeCampo}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </Campo>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void adicionar()}
          >
            Adicionar parcela
          </Button>
          {erro && (
            <p role="alert" className="w-full text-sm text-destructive">
              {erro}
            </p>
          )}
        </div>
      )}
    </Secao>
  )
}
