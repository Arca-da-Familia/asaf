import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { classeCampo } from '@/lib/campos'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  obterRelatorioDeAtendimentoDoTitular,
  type ContagemDoRelatorio,
} from '@/lib/privacidade'

function Contagens({
  titulo,
  itens,
}: {
  titulo: string
  itens: ContagemDoRelatorio[]
}) {
  return (
    <section
      aria-label={titulo}
      className="rounded-md border border-border p-3"
    >
      <h2 className="text-sm font-semibold">{titulo}</h2>
      {itens.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nenhum.</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {itens.map((i) => (
            <li key={i.codigo} className="flex justify-between gap-4">
              <span>{i.rotulo ?? i.texto}</span>
              <span className="font-semibold tabular-nums">{i.total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// v7.2f (FASE 7) - o relatório de atendimento das solicitações do titular, para a Diretoria (decisão 12 do Presidente, 2026-10-28): quantas chegaram no ano,
// de que direito, por que canal, com que resultado e fundamento, se saíram no prazo e em quanto tempo. Só contagens; o resumo vai também ao relatório anual.
export function RelatorioDeAtendimentoDoTitularPage() {
  const idAno = useId()
  // sem ano escolhido, o servidor responde com o ano de hoje em Belém (e diz qual é: o do navegador pode já ter virado)
  const [ano, setAno] = useState<number | null>(null)
  const relatorio = useQuery({
    queryKey: ['privacidade', 'relatorio-de-atendimento', ano],
    queryFn: () => obterRelatorioDeAtendimentoDoTitular(ano ?? undefined),
    placeholderData: keepPreviousData,
  })
  const r = relatorio.data
  const anoAtual = r?.ano_atual

  return (
    <>
      <PageHeader
        titulo="Relatório de atendimento"
        descricao="Os pedidos sobre dados pessoais (LGPD) do ano: quantos, de que direito, por que canal, com que resultado e se a resposta saiu no prazo. Só números; o resumo vai também ao relatório anual."
      />
      <div className="mb-4">
        <label htmlFor={idAno} className="block text-sm font-medium">
          Ano
        </label>
        <select
          id={idAno}
          className={classeCampo}
          value={ano ?? anoAtual ?? ''}
          disabled={anoAtual === undefined}
          onChange={(e) => setAno(Number(e.target.value))}
        >
          {anoAtual !== undefined &&
            Array.from({ length: 5 }, (_, i) => anoAtual - i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
        </select>
      </div>
      {relatorio.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando…
        </p>
      )}
      {relatorio.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(
            relatorio.error,
            'Não foi possível montar o relatório.',
          )}
        </p>
      )}
      {r && (
        <div className="space-y-4" data-relatorio-de-atendimento={r.ano}>
          <dl className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['Pedidos no ano', r.total],
                ['Respondidos', r.respondidos],
                ['Respondidos no prazo', r.respondidos_no_prazo],
                ['Respondidos fora do prazo', r.respondidos_fora_do_prazo],
                ['Em andamento e já vencidos', r.em_andamento_vencidos],
                [
                  'Tempo médio de resposta',
                  r.tempo_medio_de_resposta_dias === null
                    ? '—'
                    : `${r.tempo_medio_de_resposta_dias.toLocaleString('pt-BR')} dias`,
                ],
                ['Relatórios entregues', r.relatorios_entregues],
                ['Eliminações feitas', r.eliminacoes_feitas],
              ] as const
            ).map(([rotulo, valor]) => (
              <div key={rotulo} className="rounded-md border border-border p-3">
                <dt className="text-sm text-muted-foreground">{rotulo}</dt>
                <dd className="text-2xl font-bold tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-3 md:grid-cols-2">
            <Contagens titulo="Por direito pedido" itens={r.por_direito} />
            <Contagens titulo="Por resultado" itens={r.por_resultado} />
            <Contagens titulo="Por canal" itens={r.por_canal} />
            <Contagens
              titulo="Fundamento do que não foi atendido por inteiro"
              itens={r.por_fundamento}
            />
          </div>
        </div>
      )}
    </>
  )
}
