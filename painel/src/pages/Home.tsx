import { ChevronRight, ExternalLink } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'

import { MuralDeAvisos } from '@/components/comunicacao/MuralDeAvisos'
import { Agenda } from '@/components/inicio/Agenda'
import { PrecisaDeVoce } from '@/components/inicio/PrecisaDeVoce'
import { AjudaDaTela } from '@/components/layout/AjudaDaTela'
import { COR_DA_AREA, ORDEM_DAS_AREAS } from '@/lib/areas'
import { moduloVisivel, modulos, type Modulo } from '@/lib/modulos'
import { useMe } from '@/lib/use-me'
import { cn } from '@/lib/utils'

// v2.5.1b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - "Início" só mostrava sessão e
// permissão, não servia pra nada. Esta é a página que lança os módulos.
// v9.5b - o desenho escolhido pelo Presidente (rodadas 2 e 3, 13/11/2026): sem coluna à esquerda; no notebook, a lista dos módulos em duas colunas (ícone na cor
// da área, nome e uma frase) e, à direita, "Precisa de você", o mural de avisos e a agenda. No celular, as pendências primeiro e os módulos em cartões de 3 em 3.
function saudacao(hora: number): string {
  if (hora < 12) return 'Bom dia'
  if (hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

function DestinoDoModulo({
  modulo,
  className,
  children,
}: {
  modulo: Modulo
  className: string
  children: ReactNode
}) {
  // o nome do link é o nome do módulo; a frase embaixo dele é a descrição (lida depois pelo leitor de tela)
  const descricao = modulo.descricao
    ? `descricao-${modulo.rota.replace(/\W+/g, '')}`
    : undefined
  // v5.1 - módulo externo (ex.: Directus): abre noutra aba, sem repassar o `window.opener` (noopener) nem o endereço do painel como origem (noreferrer).
  if (modulo.externo)
    return (
      <a
        href={modulo.externo}
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={descricao}
        className={className}
      >
        {children}
        <span className="sr-only">(abre em uma nova aba)</span>
      </a>
    )
  return (
    <Link to={modulo.rota} aria-describedby={descricao} className={className}>
      {children}
    </Link>
  )
}

export function Home() {
  const { data } = useMe()
  const { hash } = useLocation()
  const permissoes = data?.permissoes ?? []
  const visiveis = modulos
    .filter((m) => moduloVisivel(m, permissoes))
    .sort(
      (a, b) =>
        ORDEM_DAS_AREAS.indexOf(a.area ?? 'administracao') -
        ORDEM_DAS_AREAS.indexOf(b.area ?? 'administracao'),
    )
  // calculado uma vez ao abrir a tela (a regra de pureza do React não aceita ler o relógio a cada desenho)
  const [agora] = useState(() => new Date())
  const primeiroNome = (data?.nome_completo ?? '').trim().split(/\s+/)[0]
  const dataPorExtenso = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(agora)

  // "Módulos" na barra de baixo do celular leva até a lista
  useEffect(() => {
    if (hash === '#modulos')
      document.getElementById('modulos')?.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <>
      <div className="flex flex-col gap-1">
        {/* o nome da página continua "Início" para quem usa leitor de tela (e para os robôs da homologação) */}
        <h1 className="text-[26px] leading-tight font-extrabold sm:text-[30px]">
          <span className="sr-only">Início — </span>
          {saudacao(agora.getHours())}
          {primeiroNome ? `, ${primeiroNome}` : ''}
        </h1>
        <p className="text-[15px] text-muted-foreground first-letter:uppercase">
          {dataPorExtenso}
        </p>
      </div>
      <AjudaDaTela />

      <div className="mt-5 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-5">
        <div className="lg:col-start-2 lg:row-start-1">
          <PrecisaDeVoce permissoes={permissoes} />
        </div>

        <section
          id="modulos"
          aria-labelledby="titulo-dos-modulos"
          className="scroll-mt-20 lg:col-start-1 lg:row-span-3 lg:row-start-1"
        >
          <h2
            id="titulo-dos-modulos"
            className="mb-2.5 text-[17px] font-extrabold lg:sr-only"
          >
            Módulos
          </h2>
          {visiveis.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum módulo disponível para o seu nível de acesso.
            </p>
          ) : (
            // uma lista só (sem repetir os atalhos para quem usa leitor de tela): no celular, cartões de 3 em 3; do tablet em diante, a lista em duas colunas
            <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-0 sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:px-5 sm:py-1.5 sm:shadow-sm">
              {visiveis.map((m) => (
                <li key={m.rota} className="sm:border-b sm:border-border">
                  <DestinoDoModulo
                    modulo={m}
                    className="flex h-full flex-col items-center gap-2 rounded-2xl border border-border bg-card px-1 py-3 text-center sm:min-h-[64px] sm:flex-row sm:gap-3 sm:rounded-lg sm:border-0 sm:bg-transparent sm:px-0 sm:py-2 sm:text-left sm:hover:bg-accent/50"
                  >
                    <span
                      className={cn(
                        'flex size-11 shrink-0 items-center justify-center rounded-xl sm:size-10 sm:rounded-[10px]',
                        COR_DA_AREA[m.area ?? 'administracao'],
                      )}
                    >
                      <m.icone
                        className="size-[22px] sm:size-5"
                        aria-hidden="true"
                      />
                    </span>
                    <span className="flex min-w-0 flex-col sm:flex-1">
                      <span className="flex items-center justify-center gap-1 text-[13px] leading-tight font-bold sm:justify-start sm:text-[15px]">
                        {m.rotulo}
                        {m.externo && (
                          <ExternalLink
                            className="hidden size-3.5 sm:block"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      {m.descricao && (
                        <span
                          id={`descricao-${m.rota.replace(/\W+/g, '')}`}
                          aria-hidden="true"
                          className="hidden text-[13px] text-muted-foreground sm:block"
                        >
                          {m.descricao}
                        </span>
                      )}
                    </span>
                    <ChevronRight
                      className="hidden size-[18px] shrink-0 text-muted-foreground sm:block"
                      aria-hidden="true"
                    />
                  </DestinoDoModulo>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="lg:col-start-2 lg:row-start-2">
          <MuralDeAvisos />
        </div>
        <div className="lg:col-start-2 lg:row-start-3">
          <Agenda />
        </div>
      </div>
    </>
  )
}
