import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router'

import { SeloDeSituacao } from '@/components/documentos/Selos'
import { PageHeader } from '@/components/layout/PageHeader'
import { Secao } from '@/components/layout/Secao'
import { Trilha } from '@/components/layout/Trilha'
import { FormularioDaParceria } from '@/components/parcerias/FormularioDaParceria'
import { PainelDePublicacao } from '@/components/parcerias/PainelDePublicacao'
import {
  PendenciasDaParceria,
  ResumoFinanceiro,
} from '@/components/parcerias/ResumoEPendencias'
import { SecaoEtapas } from '@/components/parcerias/SecaoEtapas'
import { SecaoLancamentos } from '@/components/parcerias/SecaoLancamentos'
import { SecaoParcelas } from '@/components/parcerias/SecaoParcelas'
import { SecaoRelatorios } from '@/components/parcerias/SecaoRelatorios'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  editarParceria,
  historicoDaParceria,
  obterParceria,
  opcoesDeParcerias,
  proximoPassoDaParceria,
  type Achado,
  type Executar,
} from '@/lib/parcerias'

const dia = (iso: string | null) => (iso ? formatarData(iso) : '—')

// v5.4a - tela da parceria, na ordem em que a diretoria trabalha: o que falta, o dinheiro, a publicação, os dados,
// as parcelas, os movimentos do livro-caixa, as etapas, os relatórios e o histórico.
export function ParceriaDetalhePage() {
  const { id } = useParams()
  const idParceria = Number(id)
  const queryClient = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const [pendenciasDoServidor, setPendenciasDoServidor] = useState<Achado[]>([])
  const [editando, setEditando] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const { data: opcoes } = useQuery({
    queryKey: ['parcerias-opcoes'],
    queryFn: opcoesDeParcerias,
  })
  const { data: d, isLoading } = useQuery({
    queryKey: ['parceria', idParceria],
    queryFn: () => obterParceria(idParceria),
    enabled: Number.isFinite(idParceria),
  })
  const { data: trilha } = useQuery({
    queryKey: ['parceria-historico', idParceria],
    queryFn: () => historicoDaParceria(idParceria),
    enabled: !!d,
  })

  // Toda ação passa por aqui: erro do servidor na tela (com as pendências, quando é o caso), detalhe novo no lugar
  // do velho, lista e histórico atualizados.
  const executar: Executar = async (acao) => {
    setErro(null)
    setPendenciasDoServidor([])
    try {
      const novo = await acao()
      queryClient.setQueryData(['parceria', idParceria], novo)
      queryClient.invalidateQueries({ queryKey: ['parcerias'] })
      queryClient.invalidateQueries({
        queryKey: ['parceria-historico', idParceria],
      })
      return true
    } catch (e) {
      if (e instanceof ApiError) {
        setErro(e.detail)
        const bloqueios = e.dados?.bloqueios
        if (Array.isArray(bloqueios))
          setPendenciasDoServidor(bloqueios as Achado[])
      } else {
        setErro('Algo deu errado. Tente de novo.')
      }
      return false
    }
  }

  if (isLoading || !d) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  return (
    <>
      <PageHeader
        titulo={d.titulo}
        trilha={[
          { rotulo: 'Parcerias e emendas', href: '/parcerias' },
          { rotulo: d.tipo_rotulo },
        ]}
      />

      <div className="max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
            {d.situacao}
          </span>
          <SeloDeSituacao situacao={d.situacao_publicacao} />
          <span className="text-muted-foreground">
            {d.tipo_rotulo} · {d.ano}
            {d.codigo_centro_custo
              ? ` · centro de custo ${d.codigo_centro_custo}`
              : ''}
          </span>
        </div>

        <p
          role="status"
          className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          <strong>Próximo passo:</strong> {proximoPassoDaParceria(d)}
        </p>

        {erro && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <p>{erro}</p>
            {pendenciasDoServidor.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {pendenciasDoServidor.map((p) => (
                  <li key={p.codigo}>{p.mensagem}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <ResumoFinanceiro d={d} />
        <PendenciasDaParceria d={d} />
        <PainelDePublicacao d={d} executar={executar} />

        <Secao titulo="Dados da parceria">
          {editando ? (
            <FormularioDaParceria
              inicial={d}
              opcoes={opcoes}
              rotuloDoBotao="Salvar alterações"
              enviando={salvando}
              onCancelar={() => setEditando(false)}
              onSalvar={async (dados) => {
                setSalvando(true)
                const ok = await executar(() =>
                  editarParceria(idParceria, dados),
                )
                setSalvando(false)
                if (ok) setEditando(false)
              }}
            />
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="font-medium">Objeto</dt>
                <dd className="whitespace-pre-line">{d.objeto}</dd>
                <dt className="font-medium">Órgão concedente</dt>
                <dd>{d.orgao_concedente ?? '—'}</dd>
                <dt className="font-medium">Proponente</dt>
                <dd>{d.proponente ?? '—'}</dd>
                <dt className="font-medium">Emenda</dt>
                <dd>
                  {d.numero_emenda ?? '—'}
                  {d.identificador_unico
                    ? ` (ID único ${d.identificador_unico})`
                    : ''}
                </dd>
                <dt className="font-medium">Termo</dt>
                <dd>{d.numero_termo ?? '—'}</dd>
                <dt className="font-medium">Esfera</dt>
                <dd>{d.esfera ?? '—'}</dd>
                <dt className="font-medium">Assinatura</dt>
                <dd>{dia(d.data_assinatura)}</dd>
                <dt className="font-medium">Vigência</dt>
                <dd>
                  {dia(d.vigencia_inicio)} a {dia(d.vigencia_fim)}
                </dd>
              </dl>
              {d.pode_editar && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditando(true)}
                >
                  Editar os dados
                </Button>
              )}
            </>
          )}
        </Secao>

        <SecaoParcelas d={d} executar={executar} />
        <SecaoLancamentos d={d} opcoes={opcoes} executar={executar} />
        <SecaoEtapas d={d} opcoes={opcoes} executar={executar} />
        <SecaoRelatorios d={d} opcoes={opcoes} executar={executar} />
        <Trilha eventos={trilha} />
      </div>
    </>
  )
}
