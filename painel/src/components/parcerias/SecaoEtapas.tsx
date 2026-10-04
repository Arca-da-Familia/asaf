import { useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { FotosDaEtapa } from '@/components/parcerias/FotosDaEtapa'
import { Secao } from '@/components/layout/Secao'
import { Button } from '@/components/ui/button'
import { classeAreaDeTexto, classeCampo } from '@/lib/campos'
import { isoParaDataBr } from '@/lib/datas'
import {
  apagarEtapa,
  criarEtapa,
  editarEtapa,
  type Executar,
  type Opcoes,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

// Etapa de execução (oficina, entrega, evento). Aparece no site com data, local e público atendido. Fotos com
// autorização de imagem entram numa próxima versão (precisam de um caminho que confira a autorização).
export function SecaoEtapas({
  d,
  opcoes,
  executar,
}: {
  d: ParceriaDetalhe
  opcoes: Opcoes | undefined
  executar: Executar
}) {
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [local, setLocal] = useState('')
  const [dataPrevista, setDataPrevista] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function adicionar() {
    setErro(null)
    if (titulo.trim().length < 3) {
      return setErro('Dê um título à etapa (pelo menos 3 letras).')
    }
    const ok = await executar(() =>
      criarEtapa(d.id_parceria, {
        titulo: titulo.trim(),
        ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
        ...(local.trim() ? { local: local.trim() } : {}),
        ...(dataPrevista ? { data_prevista: dataPrevista } : {}),
      }),
    )
    if (ok) {
      setTitulo('')
      setDescricao('')
      setLocal('')
      setDataPrevista('')
    }
  }

  return (
    <Secao
      titulo="Etapas de execução"
      descricao="O que foi (ou será) feito: oficinas, entregas, eventos."
    >
      {d.etapas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma etapa cadastrada.
        </p>
      ) : (
        <ul className="space-y-3">
          {d.etapas.map((e) => (
            <li
              key={e.id_etapa}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium">
                {e.titulo}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  — {e.situacao}
                </span>
              </p>
              {e.descricao && (
                <p className="whitespace-pre-line text-muted-foreground">
                  {e.descricao}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {e.data_realizacao
                  ? `Realizada em ${isoParaDataBr(e.data_realizacao)}`
                  : e.data_prevista
                    ? `Prevista para ${isoParaDataBr(e.data_prevista)}`
                    : 'Sem data'}
                {e.local ? ` · ${e.local}` : ''}
                {e.publico_atendido !== null
                  ? ` · ${e.publico_atendido} pessoa(s) atendida(s)`
                  : ''}
              </p>
              <FotosDaEtapa d={d} etapa={e} executar={executar} />
              {d.pode_editar && (
                <EdicaoRapidaDaEtapa
                  d={d}
                  idEtapa={e.id_etapa}
                  situacaoAtual={e.situacao}
                  opcoes={opcoes}
                  executar={executar}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {d.pode_editar && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Título da nova etapa" className="sm:col-span-2">
              <input
                className={classeCampo}
                value={titulo}
                maxLength={200}
                onChange={(e) => setTitulo(e.target.value)}
              />
            </Campo>
            <Campo rotulo="Prevista para (opcional)">
              <input
                type="date"
                className={classeCampo}
                value={dataPrevista}
                onChange={(e) => setDataPrevista(e.target.value)}
              />
            </Campo>
          </div>
          <Campo rotulo="Local (opcional)">
            <input
              className={classeCampo}
              value={local}
              onChange={(e) => setLocal(e.target.value)}
            />
          </Campo>
          <Campo
            rotulo="Descrição (opcional)"
            dica="Aparece no site. Não escreva telefone, e-mail ou documento de pessoas."
          >
            <textarea
              className={classeAreaDeTexto}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Campo>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void adicionar()}
          >
            Adicionar etapa
          </Button>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
        </div>
      )}
    </Secao>
  )
}

// Marcar como realizada (com a data e o público) ou cancelar, sem abrir um formulário grande.
function EdicaoRapidaDaEtapa({
  d,
  idEtapa,
  situacaoAtual,
  opcoes,
  executar,
}: {
  d: ParceriaDetalhe
  idEtapa: number
  situacaoAtual: string
  opcoes: Opcoes | undefined
  executar: Executar
}) {
  const [situacao, setSituacao] = useState(situacaoAtual)
  const [data, setData] = useState('')
  const [publico, setPublico] = useState('')

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Campo rotulo="Situação" className="w-36">
        <select
          className={classeCampo}
          value={situacao}
          onChange={(e) => setSituacao(e.target.value)}
        >
          {opcoes?.situacoes_de_etapa.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Campo>
      {situacao === 'Realizada' && (
        <>
          <Campo rotulo="Realizada em" className="w-40">
            <input
              type="date"
              className={classeCampo}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </Campo>
          <Campo rotulo="Pessoas atendidas" className="w-36">
            <input
              type="number"
              min={0}
              className={classeCampo}
              value={publico}
              onChange={(e) => setPublico(e.target.value)}
            />
          </Campo>
        </>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          void executar(() =>
            editarEtapa(d.id_parceria, idEtapa, {
              situacao,
              ...(data ? { data_realizacao: data } : {}),
              ...(publico !== '' ? { publico_atendido: Number(publico) } : {}),
            }),
          )
        }
      >
        Salvar situação
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void executar(() => apagarEtapa(d.id_parceria, idEtapa))}
      >
        Apagar etapa
      </Button>
    </div>
  )
}
