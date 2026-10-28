import { useQuery } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  buscarTitulares,
  obterRelatorioDoTitular,
  type SecaoDoRelatorio,
} from '@/lib/privacidade'

// o valor em palavras: data e hora de Belém, Sim/Não; o resto como veio
function emPalavras(v: string | number | boolean | null | undefined): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v))
    return formatarData(v, { comHora: true })
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return formatarData(v)
  return String(v)
}

// o nome da coluna em palavras ("data_nascimento" -> "Data nascimento")
function rotuloDaColuna(c: string): string {
  const t = c.replace(/^id_/, '').replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function Secao({ s }: { s: SecaoDoRelatorio }) {
  const colunas = Array.from(
    new Set(s.linhas.flatMap((linha) => Object.keys(linha))),
  ).filter((c) => c !== 'numero')
  return (
    <section
      aria-label={`Dados na tabela ${s.tabela}`}
      className="rounded-md border border-border p-3 text-sm"
      data-secao={s.tabela}
    >
      <h2 className="font-semibold">
        {s.atividades[0]?.nome ?? 'Sem atividade no inventário'}{' '}
        <span className="text-xs font-normal text-muted-foreground">
          ({s.tabela})
        </span>
      </h2>
      {s.atividades.map((a) => (
        <div key={a.codigo} className="mt-1 text-xs text-muted-foreground">
          <p>Para que serve: {a.finalidade}</p>
          <p>
            Base legal: {a.bases_legais.join('; ')}
            {!a.base_legal_conferida &&
              ' (proposta, ainda não conferida pelo encarregado)'}
          </p>
          <p>
            Com quem é compartilhado: {a.compartilhado_com.join('; ') || '—'}
            {a.transferencia_internacional &&
              ' (há transferência internacional)'}
          </p>
          <p>
            Por quanto tempo:{' '}
            {a.prazos_de_guarda.join('; ') || 'sem prazo automático'}
          </p>
        </div>
      ))}
      {s.cortado && (
        <p role="alert" className="mt-1 text-xs text-destructive" data-cortado>
          Há mais registros do que os mostrados aqui (os mais novos primeiro):
          peça à equipe técnica a lista completa.
        </p>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-1">Nº</th>
              {colunas.map((c) => (
                <th key={c} className="px-2 py-1">
                  {rotuloDaColuna(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.linhas.map((linha) => (
              <tr
                key={String(linha.numero)}
                className="border-b border-border last:border-0 align-top"
              >
                <td className="px-2 py-1">{String(linha.numero)}</td>
                {colunas.map((c) => (
                  <td key={c} className="whitespace-pre-wrap px-2 py-1">
                    {emPalavras(linha[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// v7.2b - o relatório de TODOS os dados de uma pessoa (LGPD, art. 18, I, II e VII), só para o encarregado (decisão do Presidente, 2026-10-28). A leitura fica na
// Auditoria. A entrega à pessoa (PDF e arquivo para portabilidade pela Minha conta) é a v7.2c; até lá, o encarregado imprime.
export function DadosDeUmaPessoaPage() {
  const [parametros, setParametros] = useSearchParams()
  const idPessoa = Number(parametros.get('id_pessoa')) || undefined
  const email = parametros.get('email') ?? undefined
  const idAtendimento = Number(parametros.get('id_atendimento')) || undefined
  const quem = { id_pessoa: idPessoa, email, id_atendimento: idAtendimento }
  const [busca, setBusca] = useState('')
  const [termo, setTermo] = useState('')
  const idBusca = useId()

  const achadas = useQuery({
    queryKey: ['privacidade', 'titulares', termo],
    queryFn: () => buscarTitulares(termo),
    enabled: termo.length >= 3,
  })
  const relatorio = useQuery({
    queryKey: ['privacidade', 'relatorio-do-titular', quem],
    queryFn: () => obterRelatorioDoTitular(quem),
    enabled: idPessoa !== undefined || email !== undefined,
    staleTime: 0,
  })

  function buscar(e: FormEvent) {
    e.preventDefault()
    setTermo(busca.trim())
  }

  return (
    <>
      <PageHeader
        titulo="Dados de uma pessoa"
        descricao="Tudo o que o sistema guarda sobre uma pessoa, com para que serve, a base legal, com quem é compartilhado e por quanto tempo (a Auditoria fica de fora). Só o encarregado gera; cada leitura fica registrada."
      />
      <form onSubmit={buscar} className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={idBusca} className="block text-sm font-medium">
            Nome, CPF ou e-mail do cadastro
          </label>
          <input
            id={idBusca}
            type="search"
            className={classeCampo}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm">
          Buscar
        </Button>
      </form>
      {achadas.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(achadas.error, 'Não foi possível buscar.')}
        </p>
      )}
      {achadas.data && (
        <ul
          className="mb-4 v3-space-y-1 text-sm"
          aria-label="Pessoas encontradas"
        >
          {achadas.data.length === 0 && (
            <li className="text-muted-foreground">Ninguém encontrado.</li>
          )}
          {achadas.data.map((p) => (
            <li key={p.id_pessoa} className="flex flex-wrap items-center gap-2">
              <span>
                {p.nome_completo}
                {p.cpf_final && ` · CPF ${p.cpf_final}`}
                {p.associado && ' · associado'}
                {p.beneficiario && ' · atendido nos projetos'}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setParametros({ id_pessoa: String(p.id_pessoa) })
                }
              >
                Gerar o relatório de {p.nome_completo}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {relatorio.isLoading && (
        <p className="text-sm text-muted-foreground">Gerando…</p>
      )}
      {relatorio.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(
            relatorio.error,
            'Não foi possível gerar o relatório.',
          )}
        </p>
      )}
      {relatorio.data && (
        <article
          aria-label="Relatório dos dados"
          className="v3-space-y-3"
          data-relatorio
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <strong>
                {relatorio.data.pessoa?.nome_completo ?? 'Sem cadastro'}
              </strong>
              {' · '}
              {relatorio.data.total_de_linhas} registro(s) em{' '}
              {relatorio.data.secoes.length} lugar(es) · gerado em{' '}
              {formatarData(relatorio.data.gerado_em, { comHora: true })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => window.print()}
            >
              Imprimir
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {relatorio.data.fora_do_relatorio}
          </p>
          {relatorio.data.secoes.map((s) => (
            <Secao key={s.tabela} s={s} />
          ))}
        </article>
      )}
    </>
  )
}
