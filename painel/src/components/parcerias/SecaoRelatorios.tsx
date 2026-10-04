import { useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Secao } from '@/components/layout/Secao'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import { isoParaDataBr } from '@/lib/datas'
import {
  apagarRelatorio,
  criarRelatorio,
  editarRelatorio,
  type Executar,
  type Opcoes,
  type ParceriaDetalhe,
  type Relatorio,
} from '@/lib/parcerias'

const dia = (iso: string | null) => (iso ? isoParaDataBr(iso) : '—')

// Relatórios de monitoramento e prestação de contas (parcial e final). O resultado (regulares / regulares com
// ressalvas / irregulares) só existe depois de apresentado; o prazo de análise (150 dias) é contado da apresentação.
export function SecaoRelatorios({
  d,
  opcoes,
  executar,
}: {
  d: ParceriaDetalhe
  opcoes: Opcoes | undefined
  executar: Executar
}) {
  const [tipo, setTipo] = useState('PARCIAL')
  const [dataPrevista, setDataPrevista] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function adicionar() {
    setErro(null)
    const ok = await executar(() =>
      criarRelatorio(d.id_parceria, {
        tipo,
        ...(dataPrevista ? { data_prevista: dataPrevista } : {}),
      }),
    )
    if (ok) setDataPrevista('')
  }

  return (
    <Secao
      titulo="Relatórios e prestação de contas"
      descricao="Cadastre cada relatório com a data prevista; quando for entregue, registre a apresentação e, depois, o resultado da análise."
    >
      {d.relatorios.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum relatório cadastrado.
        </p>
      ) : (
        <ul className="space-y-3">
          {d.relatorios.map((r) => (
            <li
              key={r.id_relatorio}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium">
                {r.tipo_rotulo}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  — {r.resultado}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                Prevista: {dia(r.data_prevista)} · Apresentada:{' '}
                {dia(r.data_apresentacao)}
                {r.data_limite_analise
                  ? ` · Análise até ${dia(r.data_limite_analise)} (${r.prazo_analise_dias} dias)`
                  : ''}
                {r.data_resultado
                  ? ` · Resultado em ${dia(r.data_resultado)}`
                  : ''}
              </p>
              {d.pode_editar && (
                <EdicaoDoRelatorio
                  d={d}
                  relatorio={r}
                  opcoes={opcoes}
                  executar={executar}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {d.pode_editar && (
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <Campo rotulo="Novo relatório" className="w-64">
            <select
              className={classeCampo}
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              {opcoes?.tipos_de_relatorio.map((t) => (
                <option key={t.codigo} value={t.codigo}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Data prevista (opcional)" className="w-44">
            <input
              type="date"
              className={classeCampo}
              value={dataPrevista}
              onChange={(e) => setDataPrevista(e.target.value)}
            />
          </Campo>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void adicionar()}
          >
            Adicionar relatório
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

function EdicaoDoRelatorio({
  d,
  relatorio,
  opcoes,
  executar,
}: {
  d: ParceriaDetalhe
  relatorio: Relatorio
  opcoes: Opcoes | undefined
  executar: Executar
}) {
  const [apresentacao, setApresentacao] = useState(
    relatorio.data_apresentacao ?? '',
  )
  const [resultado, setResultado] = useState(relatorio.resultado)
  const [dataResultado, setDataResultado] = useState(
    relatorio.data_resultado ?? '',
  )

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Campo rotulo="Apresentada em" className="w-40">
        <input
          type="date"
          className={classeCampo}
          value={apresentacao}
          onChange={(e) => setApresentacao(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Resultado da análise" className="w-56">
        <select
          className={classeCampo}
          value={resultado}
          onChange={(e) => setResultado(e.target.value)}
        >
          {opcoes?.resultados.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      {resultado !== 'Em análise' && (
        <Campo rotulo="Data do resultado" className="w-40">
          <input
            type="date"
            className={classeCampo}
            value={dataResultado}
            onChange={(e) => setDataResultado(e.target.value)}
          />
        </Campo>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          void executar(() =>
            editarRelatorio(d.id_parceria, relatorio.id_relatorio, {
              data_apresentacao: apresentacao || null,
              resultado,
              data_resultado:
                resultado === 'Em análise' ? null : dataResultado || null,
            }),
          )
        }
      >
        Salvar relatório
      </Button>
      {!relatorio.data_apresentacao && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void executar(() =>
              apagarRelatorio(d.id_parceria, relatorio.id_relatorio),
            )
          }
        >
          Apagar relatório
        </Button>
      )}
    </div>
  )
}
