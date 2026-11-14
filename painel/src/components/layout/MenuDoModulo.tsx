// v9.5c (desenho aprovado pelo Presidente, rodada 4, 13/11: "a opção 1 vai ser o padrão", com o recolher da opção 4) - o menu de dentro de um módulo, na
// coluna verde: "Voltar ao Início", o nome do módulo e os grupos em LISTA SUSPENSA (abre ao clicar; só o grupo da tela aberta já vem aberto, nunca tudo de
// uma vez). Recolhido, vira uma faixa estreita só com os ícones (o nome de cada um fica para o leitor de tela e aparece ao parar o mouse).
import { useId, useState } from 'react'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router'

import { mensagens } from '@/lib/i18n/pt-BR'
import { agruparItens, itemDaRota, navNaColuna } from '@/lib/menu-do-modulo'
import { itensVisiveis, type Modulo } from '@/lib/modulos'
import { cn } from '@/lib/utils'

export function VoltarAoInicio({
  recolhido,
  aoNavegar,
}: {
  recolhido: boolean
  aoNavegar: () => void
}) {
  return (
    <Link
      to="/"
      onClick={aoNavegar}
      aria-label={recolhido ? mensagens.navegacao.inicio : undefined}
      title={recolhido ? mensagens.navegacao.inicio : undefined}
      className={cn(
        'mb-1 flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-barra-suave hover:bg-barra-2 hover:text-barra-foreground',
        recolhido && 'justify-center px-0',
      )}
    >
      <ArrowLeft className="h-5 w-5 shrink-0" />
      {!recolhido && <span>Voltar ao Início</span>}
    </Link>
  )
}

export function MenuDoModulo({
  modulo,
  permissoes,
  recolhido,
  aoNavegar,
}: {
  modulo: Modulo
  permissoes: string[]
  recolhido: boolean
  aoNavegar: () => void
}) {
  const { pathname } = useLocation()
  const itens = itensVisiveis(modulo, permissoes)
  const grupos = agruparItens(itens)
  const grupoDaTela = itemDaRota(itens, pathname)?.grupo ?? ''
  const base = useId()
  // o que a pessoa abriu ou fechou com o clique; o grupo que ela não tocou fica aberto só se for o da tela aberta (ao ir para uma tela de outro grupo, por
  // um link no meio da página, o grupo dela abre sozinho)
  const [escolhas, setEscolhas] = useState<Map<string, boolean>>(
    () => new Map(),
  )
  const estaAberto = (nome: string) =>
    escolhas.get(nome) ?? nome === grupoDaTela

  const Icone = modulo.icone

  if (recolhido) {
    return (
      <>
        <VoltarAoInicio recolhido aoNavegar={aoNavegar} />
        {itens.map((item) => (
          <NavLink
            key={item.rota}
            to={item.rota}
            end={item.fim}
            onClick={aoNavegar}
            aria-label={item.rotulo}
            title={item.rotulo}
            className={(estado) =>
              cn(navNaColuna(estado), 'justify-center px-0')
            }
          >
            <item.icone className="h-5 w-5 shrink-0" />
          </NavLink>
        ))}
      </>
    )
  }

  return (
    <>
      <VoltarAoInicio recolhido={false} aoNavegar={aoNavegar} />
      <p className="flex items-center gap-2.5 px-2 pt-1 pb-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <Icone className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="font-titulo text-lg font-extrabold">
          {modulo.rotulo}
        </span>
      </p>
      {grupos.map((grupo, i) => {
        if (!grupo.nome) {
          return (
            <div key="sem-grupo" className="flex flex-col gap-0.5">
              {grupo.itens.map((item) => (
                <NavLink
                  key={item.rota}
                  to={item.rota}
                  end={item.fim}
                  className={navNaColuna}
                  onClick={aoNavegar}
                >
                  <item.icone className="h-5 w-5 shrink-0" />
                  <span>{item.rotulo}</span>
                </NavLink>
              ))}
            </div>
          )
        }
        const aberto = estaAberto(grupo.nome)
        const idLista = `${base}-grupo-${i}`
        return (
          <div key={grupo.nome}>
            <button
              type="button"
              aria-expanded={aberto}
              aria-controls={idLista}
              onClick={() =>
                setEscolhas((atual) => new Map(atual).set(grupo.nome, !aberto))
              }
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-bold text-barra-foreground hover:bg-barra-2"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0 text-barra-suave transition-transform',
                  aberto && 'rotate-90',
                )}
              />
              <span className="flex-1">{grupo.nome}</span>
              <span className="text-xs font-semibold text-barra-suave">
                {grupo.itens.length}
              </span>
            </button>
            <div
              id={idLista}
              hidden={!aberto}
              className="flex flex-col gap-0.5 pb-1.5 pl-5"
            >
              {grupo.itens.map((item) => (
                <NavLink
                  key={item.rota}
                  to={item.rota}
                  end={item.fim}
                  className={navNaColuna}
                  onClick={aoNavegar}
                >
                  <item.icone className="h-[18px] w-[18px] shrink-0" />
                  <span>{item.rotulo}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
