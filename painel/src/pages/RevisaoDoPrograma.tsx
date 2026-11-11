import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  anotarRevisaoDoPrograma,
  aprovarRevisaoDoPrograma,
  montarRevisaoDoPrograma,
  obterRevisoesDoPrograma,
  type RetratoDoPrograma,
  type RevisaoDoPrograma,
} from '@/lib/privacidade'
import { useNomeDaPermissao } from '@/lib/rotulo-do-catalogo'

const CHAVE = ['privacidade', 'revisao-anual']

// v7.5b (FASE 7) - a revisão anual do programa de privacidade (decisão do Presidente, 2026-11-02: todo janeiro). O sistema monta o retrato do dia e o guarda;
// o encarregado escreve as observações e aprova; quem tem o módulo lê (é o relatório à Diretoria). A aprovada não muda.

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-md border border-border p-2">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-xl font-bold tabular-nums">{valor}</dd>
    </div>
  )
}

function Retrato({ r }: { r: RetratoDoPrograma }) {
  const nomeDaPermissao = useNomeDaPermissao()
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Período: de {formatarData(r.periodo.de)} a {formatarData(r.periodo.ate)}
        .
      </p>
      <section aria-label="Encarregado">
        <h3 className="font-semibold">Encarregado</h3>
        <p>
          {r.encarregado.nome ?? 'Sem Presidente cadastrado'}
          {r.encarregado.ato_vigente
            ? ` · ato nº ${r.encarregado.ato_vigente}`
            : ' · sem ato assinado'}
        </p>
        {r.encarregado.avisos.length > 0 && (
          <ul className="list-disc pl-5 text-muted-foreground">
            {r.encarregado.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Números do ano">
        <h3 className="font-semibold">Números dos últimos 12 meses</h3>
        <dl className="mt-1 grid gap-2 sm:grid-cols-4">
          <Numero
            rotulo="Atividades no inventário"
            valor={r.inventario.atividades}
          />
          <Numero
            rotulo="Base legal a conferir"
            valor={r.inventario.base_legal_a_conferir}
          />
          <Numero rotulo="Incidentes" valor={r.incidentes.registrados} />
          <Numero
            rotulo="Com risco relevante"
            valor={r.incidentes.com_risco_relevante}
          />
          <Numero rotulo="Ensaios" valor={r.incidentes.ensaios} />
          <Numero
            rotulo="Pedidos de titular"
            valor={r.pedidos_de_titular.total}
          />
          <Numero
            rotulo="Respondidos no prazo"
            valor={r.pedidos_de_titular.respondidos_no_prazo}
          />
          <Numero
            rotulo="Treinamentos atrasados"
            valor={r.treinamento.atrasados}
          />
        </dl>
      </section>
      <section aria-label="Prazos de guarda">
        <h3 className="font-semibold">Prazos de guarda em vigor</h3>
        <ul className="list-disc pl-5">
          {r.prazos_de_guarda.map((p) => (
            <li key={p.rotulo}>
              {p.rotulo}: {p.dias} dias
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Quem tem acesso a quê">
        <h3 className="font-semibold">
          Quem tem acesso a dado de outras pessoas
        </h3>
        <ul className="list-disc pl-5">
          {r.acessos.map((a) => (
            <li key={a.nome}>
              {a.nome}
              {a.nivel ? ` (${a.nivel})` : ''}:{' '}
              {a.permissoes.map(nomeDaPermissao).join(', ')}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Rascunho({ r }: { r: RevisaoDoPrograma }) {
  const cliente = useQueryClient()
  const id = useId()
  const [obs, setObs] = useState(r.observacoes ?? '')
  const aprovar = useMutation({
    mutationFn: async () => {
      await anotarRevisaoDoPrograma(r.id_revisao, obs)
      return aprovarRevisaoDoPrograma(r.id_revisao)
    },
    onSuccess: (dados) => cliente.setQueryData(CHAVE, dados),
  })
  const salvar = useMutation({
    mutationFn: () => anotarRevisaoDoPrograma(r.id_revisao, obs),
    onSuccess: (dados) => cliente.setQueryData(CHAVE, dados),
  })
  const erro = aprovar.error ?? salvar.error
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <label htmlFor={`${id}-obs`} className="block text-sm font-medium">
        Observações do encarregado (o que está bom e o que melhorar)
      </label>
      <textarea
        id={`${id}-obs`}
        className={classeCampo}
        rows={4}
        value={obs}
        onChange={(e) => setObs(e.target.value)}
      />
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(erro, 'Não foi possível salvar.')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={salvar.isPending || aprovar.isPending}
          onClick={() => salvar.mutate()}
        >
          Salvar
        </Button>
        <Button
          type="button"
          disabled={salvar.isPending || aprovar.isPending}
          onClick={() => aprovar.mutate()}
        >
          Salvar e aprovar
        </Button>
      </div>
    </div>
  )
}

function ItemDaRevisao({
  r,
  podeGerir,
}: {
  r: RevisaoDoPrograma
  podeGerir: boolean
}) {
  return (
    <li
      aria-label={`Revisão de ${formatarData(r.montada_em)}`}
      data-situacao={r.situacao}
      className="rounded-xl border border-border p-4"
    >
      <h2 className="mb-2 font-semibold">
        {r.situacao === 'APROVADA'
          ? `Aprovada em ${formatarData(r.aprovada_em!)}`
          : 'Rascunho'}{' '}
        <span className="font-normal text-muted-foreground">
          (montada em {formatarData(r.montada_em, { comHora: true })})
        </span>
      </h2>
      <Retrato r={r.retrato} />
      {r.situacao === 'APROVADA' && r.observacoes && (
        <div className="mt-3 border-t border-border pt-3 text-sm">
          <p className="text-xs text-muted-foreground">
            Observações do encarregado
          </p>
          <p className="whitespace-pre-wrap">{r.observacoes}</p>
        </div>
      )}
      {r.situacao === 'RASCUNHO' && podeGerir && <Rascunho r={r} />}
    </li>
  )
}

export function RevisaoDoProgramaPage() {
  const cliente = useQueryClient()
  const consulta = useQuery({
    queryKey: CHAVE,
    queryFn: obterRevisoesDoPrograma,
  })
  const montar = useMutation({
    mutationFn: montarRevisaoDoPrograma,
    onSuccess: (dados) => cliente.setQueryData(CHAVE, dados),
  })
  const d = consulta.data
  return (
    <>
      <PageHeader
        titulo="Revisão anual do programa"
        descricao="Todo janeiro, o retrato do programa de privacidade: inventário, prazos de guarda, quem tem acesso a quê, incidentes, pedidos e treinamento. O encarregado aprova; a Diretoria lê."
      />
      {consulta.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando…
        </p>
      )}
      {consulta.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(consulta.error, 'Não foi possível carregar.')}
        </p>
      )}
      {d && (
        <div className="space-y-4">
          <section
            aria-label="Situação da revisão"
            data-testid="situacao-da-revisao"
            data-pendente={d.situacao.pendente ? 'sim' : 'nao'}
            className={`rounded-xl border p-4 text-sm ${d.situacao.atrasada ? 'border-amber-600/40 bg-amber-600/10' : 'border-border'}`}
          >
            {d.situacao.ultima_aprovada_em
              ? `Última revisão aprovada em ${formatarData(d.situacao.ultima_aprovada_em)}.`
              : 'Nenhuma revisão aprovada ainda.'}{' '}
            {d.situacao.pendente
              ? 'A revisão deste ano está pendente.'
              : `A próxima é em ${d.situacao.proxima_em}.`}
            {d.pode_gerir && (
              <div className="mt-2">
                {montar.isError && (
                  <p role="alert" className="mb-2 text-destructive">
                    {mensagemDoErro(montar.error, 'Não foi possível montar.')}
                  </p>
                )}
                <Button
                  type="button"
                  disabled={montar.isPending}
                  onClick={() => montar.mutate()}
                >
                  Montar o retrato de hoje
                </Button>
              </div>
            )}
          </section>
          {d.revisoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma revisão montada ainda.
            </p>
          ) : (
            <>
              {/* v9.3y (a tela tinha 9 alturas de notebook na homologação: todas as revisões abertas, uma embaixo da outra): a mais recente aberta;
                  as anteriores recolhidas (a API manda da mais nova para a mais antiga) */}
              <ul className="space-y-3">
                {d.revisoes.slice(0, 1).map((r) => (
                  <ItemDaRevisao
                    key={r.id_revisao}
                    r={r}
                    podeGerir={d.pode_gerir}
                  />
                ))}
              </ul>
              {d.revisoes.length > 1 && (
                <details className="rounded-xl border border-border p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Revisões anteriores ({d.revisoes.length - 1})
                  </summary>
                  <ul className="mt-3 space-y-3">
                    {d.revisoes.slice(1).map((r) => (
                      <ItemDaRevisao
                        key={r.id_revisao}
                        r={r}
                        podeGerir={d.pode_gerir}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
