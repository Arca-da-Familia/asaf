import { useQuery } from '@tanstack/react-query'
import { Check, Printer, RefreshCw, UserRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  obterMinhaCredencial,
  urlArquivo,
  type MinhaCredencial,
} from '@/lib/api'
import { cn } from '@/lib/utils'

// v9.5i - a carteirinha (credencial) de quem está logado, no desenho escolhido pelo Presidente: no notebook, o cartão ao centro com "onde usar" ao lado
// e o botão de imprimir no canto de baixo, à direita (rodada 5, opção 1 e a observação dele); no celular, frente e verso (rodada 5, opção 3): abre na
// frente, "Mostrar o QR" vira o cartão. O QR vale SEMPRE e quem o lê vê a situação de AGORA (decisão de 14/11/2026): o cartão impresso não vence.

function mesEAno(iso: string | null): string | null {
  if (!iso) return null
  const [ano, mes] = iso.split('-')
  return mes && ano ? `${mes}/${ano}` : null
}

function Cartao({
  dados,
  lado,
}: {
  dados: MinhaCredencial
  lado: 'frente' | 'verso'
}) {
  const endereco = `${window.location.origin}${dados.pagina}`
  const desde = mesEAno(dados.associado_desde)
  return (
    <div
      data-impressao="carteirinha"
      className="w-full overflow-hidden rounded-[22px] border border-border bg-card shadow-card print:w-[86mm] print:shadow-none"
    >
      <div className="flex items-center gap-3 bg-barra px-4 py-3 text-barra-foreground">
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
            Carteirinha de associado
          </span>
        </span>
      </div>
      <div className="flex flex-col items-center gap-4 px-4 py-5">
        {/* a frente: foto e dados (no celular some quando o cartão está virado; no computador e no papel, sempre) */}
        <div
          className={cn(
            'flex flex-col items-center gap-3 text-center print:flex',
            lado === 'verso' && 'hidden lg:flex',
          )}
        >
          {dados.foto ? (
            <img
              src={urlArquivo(dados.foto)}
              alt="Sua foto"
              className="h-24 w-24 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="h-12 w-12" aria-hidden="true" />
              <span className="sr-only">Sem foto no cadastro</span>
            </span>
          )}
          <p className="font-titulo text-xl leading-tight font-extrabold break-words">
            {dados.nome_completo}
          </p>
          <p className="text-[15px]">
            {dados.matricula ? (
              <>
                Matrícula nº <strong>{dados.matricula}</strong>
              </>
            ) : (
              'Sem matrícula'
            )}
            {dados.categoria ? ` · ${dados.categoria}` : ''}
          </p>
          {dados.situacao && (
            <span className="rounded-full bg-verde-tinta px-3 py-0.5 text-sm font-bold text-verde-texto">
              {dados.situacao}
            </span>
          )}
          {desde && (
            <p className="text-sm text-muted-foreground">
              Associado desde {desde}
            </p>
          )}
        </div>
        {/* o verso: o QR (no celular, só quando o cartão está virado) */}
        <div
          className={cn(
            'flex flex-col items-center gap-2 print:flex',
            lado === 'frente' && 'hidden lg:flex',
          )}
        >
          {/* a moldura tem o nome (leitor de tela e robô); o desenho do QR fica fora da leitura */}
          <span
            role="img"
            aria-label="QR da sua carteirinha: abre a página de conferência"
            className="rounded-2xl border border-border bg-white p-3"
          >
            <QRCodeSVG
              value={endereco}
              size={200}
              level="M"
              aria-hidden="true"
            />
          </span>
          <p className="max-w-64 text-center text-sm">
            O QR vale sempre: quem o lê vê a sua situação de{' '}
            <strong>agora</strong>.
          </p>
        </div>
      </div>
    </div>
  )
}

export function MinhaCarteirinhaPage() {
  const [lado, setLado] = useState<'frente' | 'verso'>('frente')
  const { data, isLoading, error } = useQuery({
    queryKey: ['minha-credencial'],
    queryFn: obterMinhaCredencial,
    retry: (falhas, erro) =>
      !(erro instanceof ApiError && erro.status === 404) && falhas < 2,
  })

  return (
    <>
      <PageHeader
        titulo="Minha carteirinha"
        descricao="A sua credencial de associado da ASAF."
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error instanceof ApiError && error.status === 404 ? (
        <EmptyState
          titulo="A carteirinha é de associado"
          descricao="Você não tem cadastro de associado ligado ao seu acesso. Se deveria ter, fale com a secretaria."
        />
      ) : !data ? (
        <EmptyState
          titulo="Não foi possível abrir a carteirinha"
          descricao="Confira a conexão e tente de novo daqui a pouco."
        />
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-center lg:gap-8">
          <div className="mx-auto flex w-full max-w-[360px] flex-col gap-3 lg:mx-0 lg:w-[360px] lg:shrink-0">
            <Cartao dados={data} lado={lado} />
            <Button
              type="button"
              variant={lado === 'frente' ? 'default' : 'outline'}
              className="min-h-12 text-base lg:hidden print:hidden"
              onClick={() => setLado(lado === 'frente' ? 'verso' : 'frente')}
            >
              <RefreshCw aria-hidden="true" />
              {lado === 'frente' ? 'Mostrar o QR' : 'Ver a frente'}
            </Button>
          </div>

          <div className="flex w-full flex-col gap-4 lg:w-[400px] print:hidden">
            <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="text-xs font-extrabold tracking-wide [word-spacing:0.2em] text-muted-foreground uppercase">
                Onde a carteirinha vale
              </h2>
              <ul className="flex flex-col gap-1.5 text-sm">
                {[
                  'Na portaria dos eventos da ASAF.',
                  'No credenciamento das assembleias.',
                  'Para mostrar que é associado: quem lê o QR vê a foto, o nome e a situação de agora.',
                ].map((t) => (
                  <li key={t} className="flex flex-nowrap gap-2">
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-verde-texto"
                      aria-hidden="true"
                    />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                O QR não vence e não leva CPF, endereço nem telefone. Se perder
                o cartão, peça à secretaria para emitir outro: o antigo deixa de
                valer na hora.
              </p>
            </section>
            <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-card">
              <h2 className="font-titulo text-base font-extrabold">
                Algum dado errado?
              </h2>
              <p className="text-sm">
                O nome, a foto e a situação vêm do seu cadastro. Para corrigir,
                abra Meu perfil ou fale com a secretaria.
              </p>
              <Button asChild variant="outline" className="min-h-11 self-start">
                <Link to="/perfil">Abrir Meu perfil</Link>
              </Button>
            </section>
            {/* a impressão no canto de baixo, à direita (pedido do Presidente na rodada 5) */}
            <div className="flex justify-end">
              <Button
                type="button"
                className="min-h-11"
                onClick={() => window.print()}
              >
                <Printer aria-hidden="true" />
                Imprimir a carteirinha
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
