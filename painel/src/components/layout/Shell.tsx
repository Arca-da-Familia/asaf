import { Suspense, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { Button } from '@/components/ui/button'
import { logout } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { useImpersonacao } from '@/lib/impersonacao'
import {
  ROTA_CONFIGURACOES,
  rotaDoCatalogo,
  rotuloDoGrupo,
  useCatalogosVisiveis,
} from '@/lib/catalogos-visiveis'
import { mensagens } from '@/lib/i18n/pt-BR'
import { useTabelasEmCartoes } from '@/lib/tabelas-em-cartoes'
import { itensVisiveis, modulos } from '@/lib/modulos'
import { useTheme } from '@/lib/theme'
import { useMe } from '@/lib/use-me'
import { useVersaoBuild } from '@/lib/versao'
import { cn } from '@/lib/utils'

import { AvisoDeAmbiente } from './AvisoDeAmbiente'
import { AvisoDoTreinamento } from './AvisoDoTreinamento'
import { MenuPessoal } from './MenuPessoal'
import { NavegacaoDoCelular } from './NavegacaoDoCelular'
import { SinoDeAvisos } from './SinoDeAvisos'
import { StatusBar } from './StatusBar'

// Altura total da faixa fixa do topo: 64px (barra normal) + 40px a mais quando o aviso
// permanente do modo "ver como" está visível — aside/main usam o mesmo valor para nunca ficar
// nem escondidos atrás do header nem com um vão em branco.
const ALTURA_TOPO_NORMAL = 'h-16'
const ALTURA_TOPO_IMPERSONANDO = 'h-[6.5rem]' // 104px = 64px + 40px

// Faixa de aviso permanente do modo "ver como" (v0.2.9) — nunca permite sessão ambígua sem
// aviso visível. Só existe botão de ENCERRAR aqui: nenhuma escrita é possível nesse modo (o
// backend bloqueia de qualquer forma, isto é só a sinalização visual).
function ImpersonationBar({
  impersonando,
}: {
  impersonando: NonNullable<ReturnType<typeof useMe>['data']>['impersonando']
}) {
  const { parar, pendente } = useImpersonacao()
  if (!impersonando) return null

  return (
    <div
      role="status"
      className="flex h-10 items-center justify-center gap-3 bg-amber-500 px-4 text-sm font-medium text-amber-950"
    >
      <span>
        Vendo como <strong>{impersonando.nome_nivel}</strong> — modo somente
        leitura. Seu nível real: {impersonando.nivel_real}.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="border-amber-950/30 bg-transparent text-amber-950 hover:bg-amber-950/10"
        onClick={() => parar()}
        disabled={pendente}
      >
        Encerrar
      </Button>
    </div>
  )
}

function navCls({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  )
}

// v9.3 (achado do Presidente, 05/11) - dentro de Configurações a barra lateral troca para os catálogos, agrupados pelo módulo dono, como o menu de qualquer
// módulo (regra da v2.5.1d: uma barra só, nunca uma segunda lista de navegação dentro da página). A lista vem da API, então não cabe em `modulos`.
export function MenuDasConfiguracoes({
  collapsed,
  aoNavegar,
}: {
  collapsed: boolean
  aoNavegar: () => void
}) {
  const { grupos } = useCatalogosVisiveis()
  return (
    <>
      <Link
        to="/"
        onClick={aoNavegar}
        aria-label={collapsed ? mensagens.navegacao.inicio : undefined}
        className="mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <ArrowLeft className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{mensagens.navegacao.inicio}</span>}
      </Link>
      {!collapsed && (
        <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Configurações
        </p>
      )}
      {Array.from(grupos.entries()).map(([chaveGrupo, catalogos]) => (
        <div key={chaveGrupo} className="pt-2">
          {!collapsed && (
            <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
              {rotuloDoGrupo(chaveGrupo)}
            </p>
          )}
          {catalogos.map((c) => (
            <NavLink
              key={c.chave}
              to={rotaDoCatalogo(c.chave)}
              className={navCls}
              onClick={aoNavegar}
              aria-label={collapsed ? c.nome_exibido : undefined}
              title={collapsed ? c.nome_exibido : undefined}
            >
              <SlidersHorizontal className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{c.nome_exibido}</span>}
            </NavLink>
          ))}
        </div>
      ))}
    </>
  )
}

export function Shell() {
  const { signOut } = useAuth()
  const { data } = useMe()
  const { ehEscuro, alternar } = useTheme()
  const { commitAtual, novaVersaoDisponivel, recarregar } = useVersaoBuild()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // v2.5.1d (achado do usuário 2026-09-15) - uma barra lateral só, nunca duas: dentro de um
  // módulo com `itens` próprios (ex.: Associados), a MESMA barra troca pro menu do módulo, em
  // vez de abrir uma segunda coluna de navegação ao lado do conteúdo (péssimo no celular).
  const moduloAtivo = modulos.find(
    (m) =>
      m.itens &&
      (location.pathname === m.rota ||
        location.pathname.startsWith(`${m.rota}/`)),
  )

  const emConfiguracoes =
    location.pathname === ROTA_CONFIGURACOES ||
    location.pathname.startsWith(`${ROTA_CONFIGURACOES}/`)

  // v9.5b (decisão do Presidente, rodada 2, 13/11): o Início e as telas pessoais não têm coluna à esquerda; ela só aparece dentro de um módulo (ou de
  // Configurações). Os atalhos pessoais que moravam nela foram para a lista suspensa do botão com o nome da pessoa (MenuPessoal).
  const temColuna = !!moduloAtivo || emConfiguracoes
  const emImpersonacao = !!data?.impersonando
  // v9.3b: no celular as tabelas do conteúdo viram cartões empilhados (lib/tabelas-em-cartoes.ts)
  const conteudo = useRef<HTMLElement>(null)
  useTabelasEmCartoes(conteudo)
  const alturaTopo = emImpersonacao
    ? ALTURA_TOPO_IMPERSONANDO
    : ALTURA_TOPO_NORMAL

  async function sair() {
    await logout()
    signOut()
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Barra superior: aviso de impersonação (se houver) + identidade, busca, perfil */}
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-30 flex flex-col bg-barra text-barra-foreground transition-[height] duration-200',
          alturaTopo,
        )}
      >
        <ImpersonationBar impersonando={data?.impersonando} />
        {/* v9.3b: no celular, margens mais justas e o nome numa linha só (antes "ASAF ·" e "Painel" em duas linhas num celular de 360 px) */}
        <div className="flex h-16 flex-1 items-center gap-1 px-2 sm:gap-2 sm:px-4">
          {temColuna && (
            <Button
              variant="ghost"
              size="icon"
              className="text-barra-foreground hover:bg-barra-2 hover:text-barra-foreground lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}

          {temColuna && (
            <Button
              variant="ghost"
              size="icon"
              className="hidden text-barra-foreground hover:bg-barra-2 hover:text-barra-foreground lg:inline-flex"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            >
              {collapsed ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <ChevronLeft className="h-5 w-5" />
              )}
            </Button>
          )}

          {/* v9.5b: a logo e o nome levam ao Início (o nome do link é "Início") */}
          <Link
            to="/"
            aria-label="Início"
            className="flex min-w-0 items-center gap-2.5 rounded-xl px-1 whitespace-nowrap"
          >
            <span className="flex items-center justify-center rounded-lg bg-white p-1">
              <img
                src="/asaf-logo-160.webp"
                alt=""
                width={39}
                height={32}
                className="h-8 w-auto"
              />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-titulo text-lg font-extrabold tracking-wide">
                ASAF
              </span>
              <span className="hidden text-xs text-barra-suave sm:block">
                Painel da associação
              </span>
            </span>
          </Link>

          {/* Busca global — placeholder nesta versão (a busca funcional entra em versão futura). */}
          <div className="relative ml-auto hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-barra-suave" />
            <input
              type="search"
              placeholder="Busca global…"
              aria-label="Busca global"
              disabled
              className="h-10 w-64 rounded-xl border border-barra-2 bg-barra-2 pl-9 pr-3 text-sm text-barra-foreground placeholder:text-barra-suave disabled:cursor-not-allowed"
            />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="ml-auto text-barra-foreground hover:bg-barra-2 hover:text-barra-foreground md:ml-0"
            onClick={alternar}
            aria-label={ehEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
          >
            {ehEscuro ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          <SinoDeAvisos naBarraVerde />

          <div className="flex items-center gap-1.5 sm:gap-2">
            <MenuPessoal nome={data?.nome_completo ?? data?.email} />
            <Button
              variant="outline"
              size="sm"
              onClick={sair}
              className="border-barra-suave/60 bg-transparent text-barra-foreground hover:bg-barra-2 hover:text-barra-foreground"
            >
              <LogOut className="h-4 w-4" />
              {/* v9.1a: no celular a palavra some da tela, mas o leitor de tela continua lendo "Sair" (antes o botão ficava sem nome) */}
              <span className="sr-only sm:not-sr-only">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      {temColuna && mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Navegação lateral colapsável (vira gaveta abaixo de 1024px) - só dentro de um módulo ou de Configurações (v9.5b) */}
      {temColuna && (
        <aside
          className={cn(
            'fixed bottom-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform lg:translate-x-0',
            emImpersonacao ? 'top-[6.5rem]' : 'top-16',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
            collapsed ? 'lg:w-16' : 'lg:w-64',
          )}
        >
          <nav className="flex-1 v3-space-y-1 overflow-y-auto p-3">
            {moduloAtivo ? (
              <>
                <Link
                  to="/"
                  onClick={() => setMobileOpen(false)}
                  className="mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <ArrowLeft className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{mensagens.navegacao.inicio}</span>}
                </Link>
                {!collapsed && (
                  <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {moduloAtivo.rotulo}
                  </p>
                )}
                {itensVisiveis(moduloAtivo, data?.permissoes ?? []).map(
                  (item) => (
                    <NavLink
                      key={item.rota}
                      to={item.rota}
                      end={item.fim}
                      className={navCls}
                      onClick={() => setMobileOpen(false)}
                    >
                      <item.icone className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>{item.rotulo}</span>}
                    </NavLink>
                  ),
                )}
              </>
            ) : emConfiguracoes ? (
              <MenuDasConfiguracoes
                collapsed={collapsed}
                aoNavegar={() => setMobileOpen(false)}
              />
            ) : null}
          </nav>
        </aside>
      )}

      {/* Área de conteúdo */}
      <main
        ref={conteudo}
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200',
          emImpersonacao ? 'pt-[6.5rem]' : 'pt-16',
          !temColuna ? '' : collapsed ? 'lg:pl-16' : 'lg:pl-64',
          // a barra de baixo do celular não cobre o fim da tela
          'pb-[76px] lg:pb-0',
        )}
      >
        <AvisoDeAmbiente />
        <AvisoDoTreinamento />
        <StatusBar
          novaVersaoDisponivel={novaVersaoDisponivel}
          recarregar={recarregar}
        />
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {/* v9.2a: a tela é baixada quando abre; o menu e o alto ficam na tela enquanto isso */}
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted-foreground">
                Carregando…
              </p>
            }
          >
            <Outlet />
          </Suspense>
        </div>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          {mensagens.app.nome}
          {commitAtual ? ` · build ${commitAtual}` : null}
        </footer>
      </main>
      <NavegacaoDoCelular />
    </div>
  )
}
