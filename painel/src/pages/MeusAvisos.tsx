import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Megaphone } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'

import { LeituraDoAviso } from '@/components/comunicacao/LeituraDoAviso'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { corDaCategoria, COR_DA_CONFIRMACAO } from '@/lib/categorias-de-aviso'
import {
  COR_DA_SITUACAO,
  confirmacaoPendente,
  listarMeusAvisos,
} from '@/lib/comunicacao'
import { formatarData } from '@/lib/datas'
import { useAvisoAberto } from '@/lib/use-aviso-aberto'
import { cn } from '@/lib/utils'

// v6.1 - a caixa de entrada: TUDO que a pessoa recebeu (no mural, vencido ou retirado), para ela provar que foi (ou não foi) avisada.
// Fica no menu pessoal, como Minhas assembleias: qualquer pessoa com acesso ao painel recebe aviso, sem permissão de módulo.
// v9.5b - desenho aprovado pelo Presidente (rodada 3): no notebook, a lista à esquerda e o aviso escolhido aberto à direita, sem sair da tela; no celular, a lista e,
// ao tocar num aviso, só o aviso, com "Voltar à lista". Abrir um aviso registra a leitura (o mesmo da página do aviso, que continua existindo).
function LeituraAoLado({ idAviso }: { idAviso: number }) {
  const { data: aviso, isLoading, isError } = useAvisoAberto(idAviso)
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError || !aviso)
    return (
      <p role="alert" className="text-sm text-destructive">
        Aviso não encontrado.
      </p>
    )
  return (
    <>
      <h2 className="mb-3 text-[22px] leading-tight font-extrabold">
        {aviso.titulo}
      </h2>
      <LeituraDoAviso aviso={aviso} idAviso={idAviso} />
    </>
  )
}

export function MeusAvisosPage() {
  const [busca] = useSearchParams()
  const idAberto = Number(busca.get('aviso')) || null
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
        <p
          className={cn(
            'mb-4 text-sm text-muted-foreground',
            idAberto && 'hidden lg:block',
          )}
          role="status"
        >
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
        <div className="lg:grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start lg:gap-5">
          <ul
            className={cn(
              'overflow-hidden rounded-2xl border border-border bg-card shadow-sm',
              idAberto && 'hidden lg:block',
            )}
          >
            {avisos.map((a) => {
              const aberto = a.id_aviso === idAberto
              return (
                <li
                  key={a.id_aviso}
                  className={cn(
                    'border-t border-border px-4 py-3 first:border-t-0',
                    aberto && 'bg-ouro-tinta',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${corDaCategoria(a.categoria_rotulo)}`}
                    >
                      {a.categoria_rotulo}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${COR_DA_SITUACAO[a.situacao]}`}
                    >
                      {a.situacao}
                    </span>
                    {confirmacaoPendente(a) && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${COR_DA_CONFIRMACAO}`}
                      >
                        Pede a sua confirmação
                      </span>
                    )}
                  </div>
                  <span className="mt-1.5 flex items-start gap-2">
                    {!a.lido_em && (
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-2.5 shrink-0 rounded-full bg-verde-texto"
                      />
                    )}
                    <Link
                      to={{ search: `?aviso=${a.id_aviso}` }}
                      aria-current={aberto ? 'true' : undefined}
                      className={`text-[15px] underline-offset-4 hover:underline ${a.lido_em ? 'font-semibold' : 'font-extrabold'}`}
                    >
                      {a.titulo}
                    </Link>
                  </span>
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
              )
            })}
          </ul>

          <section
            aria-label="Aviso aberto"
            className={cn('mt-0', !idAberto && 'hidden lg:block')}
          >
            {idAberto ? (
              <>
                <Link
                  to={{ search: '' }}
                  className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-azul-texto lg:hidden"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Voltar à lista
                </Link>
                <LeituraAoLado key={idAberto} idAviso={idAberto} />
              </>
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
                Escolha um aviso na lista para lê-lo aqui.
              </p>
            )}
          </section>
        </div>
      )}
    </>
  )
}
