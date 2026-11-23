// v9.5c (desenho aprovado pelo Presidente, rodada 4, 13/11: "a opção 1 vai ser o padrão", com o recolher da opção 4) - o menu de dentro de um módulo, na
// coluna verde: "Voltar ao Início", o nome do módulo e os grupos em LISTA SUSPENSA (abre ao clicar; só o grupo da tela aberta já vem aberto, nunca tudo de
// uma vez).
//
// v9.6b (escolha do Presidente, rodada 7b, `fin-menu-2`; decisão de 19/11: é o PADRÃO de todos os módulos) - o módulo desenhado com `grupos` ganha: os
// quadradinhos "Seus mais usados" no alto (as telas que ESTA pessoa mais abriu nos últimos 30 dias, sem tirar nenhuma do grupo dela), a "Visão geral" fixa
// fora dos grupos, o ícone de cada grupo e de cada tela, o número do que está esperando alguém ao lado da tela ("Compras 2") e, recolhido, uma faixa com UM
// ícone por grupo (o nome embaixo e a soma das pendências no canto): clicar abre a lista do grupo ao lado (o teclado anda por ela, Esc fecha e o foco volta
// ao botão). Módulo ainda sem `grupos` fica como era: a lista corrida e, recolhido, um ícone por tela.
import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ArrowLeft, ChevronRight, LayoutList, X } from 'lucide-react'
import { Link, matchPath, NavLink, useLocation } from 'react-router'

import { mensagens } from '@/lib/i18n/pt-BR'
import { maisUsados, useAberturas } from '@/lib/mais-usados'
import {
  agruparItens,
  itemDaRota,
  itensFixos,
  navNaColuna,
  type GrupoDoMenu,
} from '@/lib/menu-do-modulo'
import { itensVisiveis, type ItemModulo, type Modulo } from '@/lib/modulos'
import {
  pendenciasDoItem,
  pendenciasDosItens,
  textoDasPendencias,
} from '@/lib/pendencias-do-modulo'
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

// o número do que espera alguém, em ouro (na tela aberta, que já é ouro, as cores se invertem). O leitor de tela ouve "Compras 2 pendentes" pelo
// `aria-label` do link ou do botão; o número fica FORA dele (ver `ComNumero`).
function Contador({ n, ativo = false }: { n: number; ativo?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs leading-none font-extrabold tabular-nums',
        ativo
          ? 'bg-brand-secondary-foreground text-brand-secondary'
          : 'bg-brand-secondary text-brand-secondary-foreground',
      )}
    >
      {n}
    </span>
  )
}

// O número fica por cima do link (ou do botão), do lado de fora dele e sem pegar o clique: assim o nome que o leitor de tela ouve é só o `aria-label`
// ("Compras 2 pendentes") e o texto visível de dentro ("Compras") está contido nele (o axe confere: label-content-name-mismatch). Com o número dentro, o
// texto visível sairia grudado ("Compras2") e não bateria com o nome.
function ComNumero({
  n,
  ativo = false,
  lugar = 'top-1/2 right-2 -translate-y-1/2',
  className,
  children,
}: {
  n: number
  ativo?: boolean
  lugar?: string
  className?: string
  children: ReactNode
}) {
  if (n <= 0) return <div className={className}>{children}</div>
  return (
    <div className={cn('relative', className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute', lugar)}
      >
        <Contador n={n} ativo={ativo} />
      </span>
    </div>
  )
}

// a tela aberta, pela mesma regra do NavLink (com `end`, só o endereço exato; sem, também as telas de dentro)
function useTelaAberta(item: ItemModulo): boolean {
  const { pathname } = useLocation()
  return !!matchPath({ path: item.rota, end: !!item.fim }, pathname)
}

function ItemDaColuna({
  item,
  contadores,
  aoNavegar,
  iconeGrande = false,
}: {
  item: ItemModulo
  contadores: Record<string, number>
  aoNavegar: () => void
  iconeGrande?: boolean
}) {
  const n = pendenciasDoItem(item, contadores)
  const ativo = useTelaAberta(item)
  return (
    <ComNumero n={n} ativo={ativo} lugar="top-1/2 right-3 -translate-y-1/2">
      <NavLink
        to={item.rota}
        end={item.fim}
        className={(estado) => cn(navNaColuna(estado), n > 0 && 'pr-11')}
        onClick={aoNavegar}
        aria-label={nomeComPendencias(item.rotulo, n)}
      >
        <item.icone
          aria-hidden="true"
          className={cn(
            'shrink-0',
            iconeGrande ? 'h-5 w-5' : 'h-[18px] w-[18px]',
          )}
        />
        <span className="min-w-0 flex-1">{item.rotulo}</span>
      </NavLink>
    </ComNumero>
  )
}

// uma tela na lista que abre ao lado da faixa recolhida
function ItemDaLista({
  item,
  contadores,
  aoEscolher,
}: {
  item: ItemModulo
  contadores: Record<string, number>
  aoEscolher: () => void
}) {
  const n = pendenciasDoItem(item, contadores)
  const ativo = useTelaAberta(item)
  return (
    <ComNumero n={n} ativo={ativo}>
      <NavLink
        to={item.rota}
        end={item.fim}
        aria-label={nomeComPendencias(item.rotulo, n)}
        onClick={aoEscolher}
        className={({ isActive }) =>
          cn(
            'flex min-h-9 items-center gap-2.5 rounded-[9px] px-2 py-1 text-sm',
            n > 0 && 'pr-10',
            isActive
              ? 'bg-brand-secondary font-extrabold text-brand-secondary-foreground'
              : 'font-medium hover:bg-accent hover:text-accent-foreground',
          )
        }
      >
        <item.icone
          aria-hidden="true"
          className={cn(
            'h-[17px] w-[17px] shrink-0',
            !ativo && 'text-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1">{item.rotulo}</span>
      </NavLink>
    </ComNumero>
  )
}

// "Seus mais usados · automático": os quadradinhos, como os desenhos escolhidos (rodada 7b): no computador, 2 colunas com o ícone AO LADO do nome,
// em linhas de 46 px; na gaveta do celular, 4 colunas com o ícone em cima do nome (achado da revisão de 23/11/2026: o computador saía com o ícone em cima).
// São atalhos: a tela continua no grupo dela. Na gaveta estreita, o nome comprido se divide com hífen ("contri-buição"); no computador cabe inteiro.
function SeusMaisUsados({
  itens,
  aoNavegar,
}: {
  itens: ItemModulo[]
  aoNavegar: () => void
}) {
  const id = useId()
  return (
    <div className="mb-1.5 border-b border-barra-2 pb-2.5">
      <p className="flex items-center justify-between gap-2 px-1.5 pb-1.5 text-xs text-barra-suave">
        <span id={id} className="font-extrabold tracking-[0.08em] uppercase">
          Seus mais usados
        </span>
        <span>automático</span>
      </p>
      {itens.length === 0 ? (
        <p className="px-1.5 text-xs text-barra-suave">
          As telas que você mais abrir aparecem aqui.
        </p>
      ) : (
        <ul
          aria-labelledby={id}
          className="grid grid-cols-4 gap-1.5 lg:grid-cols-2"
        >
          {itens.map((item) => (
            <li key={item.rota}>
              <Link
                to={item.rota}
                onClick={aoNavegar}
                className="flex h-full min-h-11 flex-col items-center justify-center gap-1 rounded-[10px] bg-barra-2 px-0.5 py-2 text-center text-xs leading-tight font-bold text-barra-foreground hover:ring-1 hover:ring-barra-suave lg:min-h-[46px] lg:flex-row lg:justify-start lg:gap-2 lg:px-2.5 lg:py-1 lg:text-left lg:text-[13px]"
              >
                <item.icone
                  aria-hidden="true"
                  className="h-[19px] w-[19px] shrink-0 text-brand-secondary"
                />
                <span className="min-w-0 hyphens-auto [overflow-wrap:anywhere] lg:hyphens-manual">
                  {item.rotulo}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// o nome para o leitor de tela quando há número ao lado ("Compras 2 pendentes"); sem número, o próprio texto da tela basta
function nomeComPendencias(nome: string, n: number): string | undefined {
  return n > 0 ? `${nome} ${textoDasPendencias(n)}` : undefined
}

const botaoDaFaixa = (ativo: boolean) =>
  cn(
    'relative flex w-[70px] shrink-0 flex-col items-center gap-0.5 self-center rounded-xl px-0 py-1.5 text-center text-xs leading-tight',
    ativo
      ? 'bg-brand-secondary font-extrabold text-brand-secondary-foreground'
      : 'font-semibold text-barra-foreground hover:bg-barra-2',
  )

// Recolhido (só no computador): "Início", o ícone do módulo, as telas fixas e um botão por grupo; o botão abre a lista do grupo AO LADO da faixa.
function FaixaRecolhida({
  modulo,
  fixos,
  grupos,
  grupoDaTela,
  contadores,
  aoNavegar,
}: {
  modulo: Modulo
  fixos: ItemModulo[]
  grupos: GrupoDoMenu[]
  grupoDaTela: string
  contadores: Record<string, number>
  aoNavegar: () => void
}) {
  const [aberto, setAberto] = useState<string | null>(null)
  const [topo, setTopo] = useState(0)
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const painel = useRef<HTMLDivElement>(null)
  const base = useId()
  const Icone = modulo.icone

  function fechar(devolverFoco: boolean) {
    const nome = aberto
    setAberto(null)
    if (devolverFoco && nome) botoes.current.get(nome)?.focus()
  }

  function alternar(nome: string, botao: HTMLButtonElement) {
    if (aberto === nome) {
      setAberto(null)
      return
    }
    // a lista abre na altura do botão (medida a partir da coluna, onde ela é posicionada; o botão fica dentro de uma caixa própria, por causa do número)
    const pai = (botao.closest('aside') ??
      botao.closest('nav')) as HTMLElement | null
    const deslocamento =
      botao.getBoundingClientRect().top -
      (pai?.getBoundingClientRect().top ?? 0)
    setTopo(Math.max(8, deslocamento))
    setAberto(nome)
  }

  // aberta a lista: ela não passa do fim da coluna, e o foco vai para a primeira tela dela
  useLayoutEffect(() => {
    const el = painel.current
    if (!aberto || !el) return
    const pai = el.offsetParent as HTMLElement | null
    if (pai) {
      const limite = pai.clientHeight - el.offsetHeight - 8
      if (el.offsetTop > limite) el.style.top = `${Math.max(8, limite)}px`
    }
    el.querySelector<HTMLElement>('a')?.focus()
  }, [aberto])

  // clicar fora da lista a fecha
  useEffect(() => {
    if (!aberto) return
    function aoApertar(evento: MouseEvent) {
      const alvo = evento.target as Node
      if (painel.current?.contains(alvo)) return
      if (aberto && botoes.current.get(aberto)?.contains(alvo)) return
      setAberto(null)
    }
    document.addEventListener('mousedown', aoApertar)
    return () => document.removeEventListener('mousedown', aoApertar)
  }, [aberto])

  function aoTeclar(evento: KeyboardEvent) {
    if (evento.key === 'Escape' && aberto) {
      evento.stopPropagation()
      fechar(true)
    }
  }

  // o foco saiu da lista (Tab depois da última tela, por exemplo) e não foi para o botão dela: fecha
  function aoSairDaLista(evento: FocusEvent<HTMLDivElement>) {
    const destino = evento.relatedTarget as Node | null
    if (!destino || evento.currentTarget.contains(destino)) return
    if (aberto && botoes.current.get(aberto)?.contains(destino)) return
    setAberto(null)
  }

  return (
    <>
      <Link to="/" onClick={aoNavegar} className={botaoDaFaixa(false)}>
        <ArrowLeft aria-hidden="true" className="h-[22px] w-[22px]" />
        <span>{mensagens.navegacao.inicio}</span>
      </Link>
      <span
        aria-hidden="true"
        className="my-1 h-px w-11 shrink-0 self-center bg-barra-2"
      />
      <span
        aria-hidden="true"
        title={modulo.rotulo}
        className="mb-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center self-center rounded-lg bg-white/15"
      >
        <Icone className="h-4 w-4" />
      </span>
      {fixos.map((item) => (
        <NavLink
          key={item.rota}
          to={item.rota}
          end={item.fim}
          onClick={aoNavegar}
          className={({ isActive }) => botaoDaFaixa(isActive)}
        >
          <item.icone aria-hidden="true" className="h-[22px] w-[22px]" />
          <span>{item.rotulo}</span>
        </NavLink>
      ))}
      {grupos.map((grupo, i) => {
        const n = pendenciasDosItens(grupo.itens, contadores)
        const idDaLista = `${base}-lista-${i}`
        const estaAberto = aberto === grupo.nome
        const ativo = grupo.nome === grupoDaTela
        const IconeDoGrupo = grupo.icone ?? LayoutList
        return (
          <Fragment key={grupo.nome}>
            <ComNumero
              n={n}
              lugar="-top-0.5 right-0.5 rounded-full border-[1.5px] border-barra"
              className="self-center"
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) botoes.current.set(grupo.nome, el)
                  else botoes.current.delete(grupo.nome)
                }}
                aria-expanded={estaAberto}
                aria-controls={estaAberto ? idDaLista : undefined}
                aria-label={nomeComPendencias(grupo.nome, n)}
                onClick={(evento) => alternar(grupo.nome, evento.currentTarget)}
                onKeyDown={aoTeclar}
                className={botaoDaFaixa(ativo)}
              >
                <IconeDoGrupo
                  aria-hidden="true"
                  className="h-[22px] w-[22px]"
                />
                <span>{grupo.nome}</span>
              </button>
            </ComNumero>
            {estaAberto && (
              <div
                ref={painel}
                id={idDaLista}
                role="group"
                aria-label={grupo.nome}
                style={{ top: topo }}
                onKeyDown={aoTeclar}
                onBlur={aoSairDaLista}
                className="absolute left-full z-50 ml-1.5 flex max-h-[calc(100%-1rem)] w-[250px] flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-border bg-popover p-2.5 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
              >
                <div className="flex items-center justify-between gap-2 px-1 pt-0.5 pb-1.5">
                  <strong className="font-titulo text-[15px]">
                    {grupo.nome}
                  </strong>
                  <button
                    type="button"
                    onClick={() => fechar(true)}
                    aria-label={`Fechar a lista de ${grupo.nome}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <X aria-hidden="true" className="h-[18px] w-[18px]" />
                  </button>
                </div>
                <ul className="flex flex-col gap-0.5">
                  {grupo.itens.map((item) => (
                    <li key={item.rota}>
                      <ItemDaLista
                        item={item}
                        contadores={contadores}
                        aoEscolher={() => {
                          setAberto(null)
                          aoNavegar()
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Fragment>
        )
      })}
    </>
  )
}

export function MenuDoModulo({
  modulo,
  permissoes,
  recolhido,
  aoNavegar,
  contadores = {},
  idUsuario,
}: {
  modulo: Modulo
  permissoes: string[]
  recolhido: boolean
  aoNavegar: () => void
  // v9.6b: os números de pendência do módulo (lib/pendencias-do-modulo.ts) e quem está usando (para os mais usados, guardados por pessoa)
  contadores?: Record<string, number>
  idUsuario?: number
}) {
  const { pathname } = useLocation()
  const itens = itensVisiveis(modulo, permissoes)
  const menuNovo = !!modulo.grupos
  const fixos = itensFixos(itens)
  const grupos = agruparItens(itens, modulo.grupos)
  const itemAberto = itemDaRota(itens, pathname)
  const grupoDaTela =
    itemAberto && !itemAberto.fixo ? (itemAberto.grupo ?? '') : ''
  const aberturas = useAberturas(menuNovo ? idUsuario : undefined)
  const base = useId()
  // o que a pessoa abriu ou fechou com o clique; o grupo que ela não tocou fica aberto só se for o da tela aberta (ao ir para uma tela de outro grupo, por
  // um link no meio da página, o grupo dela abre sozinho)
  const [escolhas, setEscolhas] = useState<Map<string, boolean>>(
    () => new Map(),
  )
  const estaAberto = (nome: string) =>
    escolhas.get(nome) ?? nome === grupoDaTela

  const Icone = modulo.icone

  if (recolhido && menuNovo) {
    return (
      <FaixaRecolhida
        modulo={modulo}
        fixos={fixos}
        grupos={grupos}
        grupoDaTela={grupoDaTela}
        contadores={contadores}
        aoNavegar={aoNavegar}
      />
    )
  }

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
      {menuNovo && (
        <SeusMaisUsados
          itens={maisUsados(itens, aberturas)}
          aoNavegar={aoNavegar}
        />
      )}
      {fixos.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-0.5 border-b border-barra-2 pb-2">
          {fixos.map((item) => (
            <ItemDaColuna
              key={item.rota}
              item={item}
              contadores={contadores}
              aoNavegar={aoNavegar}
            />
          ))}
        </div>
      )}
      {grupos.map((grupo, i) => {
        if (!grupo.nome) {
          return (
            <div key="sem-grupo" className="flex flex-col gap-0.5">
              {grupo.itens.map((item) => (
                <ItemDaColuna
                  key={item.rota}
                  item={item}
                  contadores={contadores}
                  aoNavegar={aoNavegar}
                  iconeGrande
                />
              ))}
            </div>
          )
        }
        const aberto = estaAberto(grupo.nome)
        const idLista = `${base}-grupo-${i}`
        const IconeDoGrupo = grupo.icone
        return (
          <div key={grupo.nome}>
            {/* o número de telas fica por cima do botão, do lado de fora (como o número de pendências, ver `ComNumero`) */}
            <div className="relative">
              <button
                type="button"
                aria-expanded={aberto}
                aria-controls={idLista}
                aria-label={`${grupo.nome} ${grupo.itens.length} ${grupo.itens.length === 1 ? 'tela' : 'telas'}`}
                onClick={() =>
                  setEscolhas((atual) =>
                    new Map(atual).set(grupo.nome, !aberto),
                  )
                }
                className="flex min-h-11 w-full items-center gap-2 rounded-lg py-0 pr-8 pl-2 text-left text-sm font-bold text-barra-foreground hover:bg-barra-2 lg:min-h-10"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 shrink-0 text-barra-suave transition-transform',
                    aberto && 'rotate-90',
                  )}
                />
                {IconeDoGrupo && (
                  <IconeDoGrupo
                    aria-hidden="true"
                    className="h-[17px] w-[17px] shrink-0 text-barra-suave"
                  />
                )}
                <span className="flex-1">{grupo.nome}</span>
              </button>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs font-semibold text-barra-suave"
              >
                {grupo.itens.length}
              </span>
            </div>
            <div
              id={idLista}
              hidden={!aberto}
              role="group"
              aria-label={grupo.nome}
              className="flex flex-col gap-0.5 pb-1.5 pl-5"
            >
              {grupo.itens.map((item) => (
                <ItemDaColuna
                  key={item.rota}
                  item={item}
                  contadores={contadores}
                  aoNavegar={aoNavegar}
                />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
