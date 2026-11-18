import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import { useParams } from 'react-router'

import {
  conferirCredencial,
  urlArquivo,
  type ConferenciaDeCredencial,
} from '@/lib/api'
import { cn } from '@/lib/utils'

// v9.5i - a página que abre no celular de quem lê o QR da credencial (portaria, outro associado, parceiro), SEM entrar no painel. Desenho escolhido pelo
// Presidente (rodada 6, "Situação em letras grandes embaixo da foto"): a foto grande primeiro, logo abaixo a situação de AGORA numa caixa da cor dela, e os
// dados em seguida. O QR do cartão impresso vale para sempre: o que muda é a situação mostrada (decisão de 14/11/2026). Não mostra CPF, endereço, telefone
// nem e-mail; quando a credencial não vale (substituída por outra, de quem não é mais associado), nem a foto nem o nome.

const COR_DO_ESTADO: Record<ConferenciaDeCredencial['estado'], string> = {
  em_dia: 'bg-verde-tinta text-verde-texto border-verde-texto/30',
  pendencia: 'bg-ouro-tinta text-ouro-texto border-ouro-texto/30',
  nao_vale: 'bg-muted text-foreground border-border',
}

function quando(iso: string): string {
  const momento = new Date(iso)
  const dia = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(momento)
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Belem',
    hour: '2-digit',
    minute: '2-digit',
  }).format(momento)
  return `${dia} às ${hora}`
}

export function ConferirCredencialPage() {
  const { codigo = '' } = useParams()
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['conferir-credencial', codigo],
    queryFn: () => conferirCredencial(codigo),
    retry: 1,
    // a situação é a de agora: nada de mostrar o que ficou guardado de antes
    staleTime: 0,
    gcTime: 0,
  })

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="flex items-center gap-3 bg-barra px-4 py-3 text-barra-foreground">
        <span className="flex h-10 w-11 shrink-0 items-center justify-center rounded-lg bg-white">
          <img
            src="/asaf-logo-160.webp"
            alt=""
            className="h-9 w-9 object-contain"
          />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-titulo text-lg font-extrabold">ASAF</span>
          <span className="text-sm text-barra-suave">
            Conferência de credencial
          </span>
        </span>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <h1 className="sr-only">Conferência da credencial de associado</h1>
        {isLoading ? (
          <p className="text-center text-muted-foreground" role="status">
            Conferindo a credencial…
          </p>
        ) : isError || !data ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 text-center">
            <p className="font-semibold">Não consegui conferir agora.</p>
            <p className="text-sm text-muted-foreground">
              Confira a internet do celular e tente de novo.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="min-h-11 rounded-lg bg-primary px-5 font-semibold text-primary-foreground"
            >
              Tentar de novo
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-center">
              {data.estado !== 'nao_vale' && data.foto ? (
                <img
                  src={urlArquivo(data.foto)}
                  alt={`Foto de ${data.nome_completo ?? 'quem tem a credencial'}`}
                  className="h-44 w-44 rounded-full border-4 border-card object-cover shadow-card"
                />
              ) : (
                <span
                  className={cn(
                    'flex h-44 w-44 items-center justify-center rounded-full border-2 border-dashed border-input bg-muted p-6 text-center text-sm text-muted-foreground',
                  )}
                >
                  {data.estado === 'nao_vale' ? (
                    'Sem foto: a credencial não vale'
                  ) : (
                    <>
                      <UserRound className="h-16 w-16" aria-hidden="true" />
                      <span className="sr-only">Sem foto no cadastro</span>
                    </>
                  )}
                </span>
              )}
            </div>

            <section
              aria-label="Situação de agora"
              data-estado={data.estado}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-2xl border px-4 py-4 text-center',
                COR_DO_ESTADO[data.estado],
              )}
            >
              <p className="font-titulo text-2xl font-extrabold">
                {data.titulo}
              </p>
              <p className="text-sm">{data.detalhe}</p>
            </section>

            {data.estado !== 'nao_vale' && (
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="font-titulo text-xl font-extrabold">
                  {data.nome_completo}
                </p>
                <p className="text-[15px]">
                  {data.matricula ? (
                    <>
                      Matrícula nº <strong>{data.matricula}</strong>
                    </>
                  ) : (
                    'Sem matrícula'
                  )}
                  {data.categoria ? ` · ${data.categoria}` : ''}
                </p>
                {data.situacao && (
                  <p className="text-sm text-muted-foreground">
                    Situação: {data.situacao}
                  </p>
                )}
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground">
              Conferido em {quando(data.conferido_em)} (horário de Belém). A
              situação é a de agora, não a do dia em que o cartão foi impresso.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
