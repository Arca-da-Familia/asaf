import { useQuery } from '@tanstack/react-query'
import { Megaphone } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  COR_DA_SITUACAO,
  confirmacaoPendente,
  listarMeusAvisos,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'

// v6.1 - a caixa de entrada: TUDO que a pessoa recebeu (no mural, vencido ou retirado), para ela provar que foi (ou não foi) avisada.
// Fica no menu pessoal, como Minhas assembleias: qualquer pessoa com acesso ao painel recebe aviso, sem permissão de módulo.
export function MeusAvisosPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['meus-avisos', 'todos'],
    queryFn: () => listarMeusAvisos(false),
  })
  const avisos = data?.avisos ?? []

  return (
    <>
      <PageHeader
        titulo="Meus avisos"
        descricao="Tudo o que a ASAF publicou para você no painel, inclusive o que já saiu do mural. Abrir um aviso registra que você o leu."
      />
      {data && (
        <p className="mb-4 text-sm text-muted-foreground" role="status">
          {data.nao_lidos === 0
            ? 'Nenhum aviso por ler.'
            : `${data.nao_lidos} ${data.nao_lidos === 1 ? 'aviso por ler' : 'avisos por ler'}.`}
          {data.confirmacoes_pendentes > 0 &&
            ` ${data.confirmacoes_pendentes} ${data.confirmacoes_pendentes === 1 ? 'pede' : 'pedem'} a sua confirmação.`}
        </p>
      )}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os seus avisos.
        </p>
      ) : avisos.length === 0 ? (
        <EmptyState
          icone={Megaphone}
          titulo="Nenhum aviso"
          descricao="Quando a ASAF publicar um aviso para um grupo do qual você faz parte, ele aparece aqui."
        />
      ) : (
        <ul className="max-w-3xl space-y-2">
          {avisos.map((a) => (
            <li
              key={a.id_aviso}
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/meus-avisos/${a.id_aviso}`}
                  className={`underline ${a.lido_em ? '' : 'font-semibold'}`}
                >
                  {a.titulo}
                </Link>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${COR_DA_SITUACAO[a.situacao]}`}
                >
                  {a.situacao}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {a.categoria_rotulo}
                </span>
                {confirmacaoPendente(a) && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    Pede a sua confirmação
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Publicado em {formatarData(a.publicado_em)}
                {a.autor ? ` por ${a.autor}` : ''} ·{' '}
                {a.lido_em
                  ? `lido em ${formatarData(a.lido_em, { comHora: true })}`
                  : 'não lido'}
                {a.confirmado_em
                  ? ` · confirmado em ${formatarData(a.confirmado_em, { comHora: true })}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
