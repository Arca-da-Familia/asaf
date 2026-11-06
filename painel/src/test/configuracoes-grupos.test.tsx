import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MenuDasConfiguracoes } from '@/components/layout/Shell'
import * as api from '@/lib/api'
import { useMe } from '@/lib/use-me'
import { codigoDoRotulo } from '@/lib/texto'
import { ConfiguracoesPage } from '@/pages/Configuracoes'

// Ponto de Revisão FASE 6 (1/2): o catálogo da categoria do aviso (v6.1) tem o dono `comunicar`, e o grupo dele em Configurações aparece com o nome do
// módulo (Comunicação), nunca com o código cru.
// v9.3 (achado do Presidente, 05/11): a lista dos catálogos fica na BARRA LATERAL (como o menu de um módulo) e a página mostra só o catálogo escolhido,
// com endereço próprio - no celular o conteúdo aparece direto, sem uma lista inteira antes.
vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarCatalogos: vi.fn(),
  listarOpcoesCatalogo: vi.fn(),
  criarOpcaoCatalogo: vi.fn(),
}))

const catalogo = (
  chave: string,
  nome: string,
  dono: string | null,
): api.Catalogo => ({
  id_catalogo: chave.length,
  chave,
  nome_exibido: nome,
  descricao: null,
  editavel_pelo_usuario: true,
  permissao_gerenciamento: dono,
})

function montar(endereco: string, permissoes: string[]) {
  vi.mocked(useMe).mockReturnValue({
    data: { permissoes },
  } as unknown as ReturnType<typeof useMe>)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[endereco]}>
        <Routes>
          <Route
            path="/configuracoes/:chave?"
            element={
              <>
                <nav aria-label="Menu">
                  <MenuDasConfiguracoes
                    collapsed={false}
                    aoNavegar={() => {}}
                  />
                </nav>
                <main>
                  <ConfiguracoesPage />
                </main>
              </>
            }
          />
          <Route path="/" element={<p>Início do painel</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listarCatalogos).mockResolvedValue([
    catalogo('categoria_aviso', 'Categoria de aviso', 'comunicar'),
    catalogo('forma_pagamento', 'Forma de pagamento', 'financeiro'),
    catalogo('estado_civil', 'Estado civil', 'associados'),
    catalogo('tipo_sistema', 'Tipo do sistema', null),
  ])
  vi.mocked(api.listarOpcoesCatalogo).mockImplementation(async (chave) =>
    chave === 'estado_civil'
      ? [
          {
            id_opcao: 1,
            id_catalogo: 1,
            codigo: 'CASADO',
            rotulo: 'Casado(a)',
            ordem: 1,
            ativo: true,
          } as unknown as Awaited<
            ReturnType<typeof api.listarOpcoesCatalogo>
          >[number],
        ]
      : [],
  )
})

describe('Configurações: o grupo de cada catálogo', () => {
  it('o catálogo da categoria do aviso aparece no grupo "Comunicação" para quem tem comunicar', async () => {
    montar('/configuracoes', ['comunicar'])
    const menu = screen.getByRole('navigation', { name: 'Menu' })
    expect(await screen.findByText('Comunicação')).toBeVisible()
    expect(screen.queryByText('comunicar')).toBeNull()
    expect(
      await screen.findByRole('link', { name: 'Categoria de aviso' }),
    ).toBeVisible()
    expect(menu).not.toHaveTextContent('Forma de pagamento')
    expect(screen.queryByText('Tipo do sistema')).toBeNull()
  })
})

describe('Configurações: os catálogos na barra lateral, um catálogo por vez na página (v9.3)', () => {
  it('sem catálogo no endereço abre o primeiro, marcado na barra; a página não repete a lista', async () => {
    montar('/configuracoes', ['comunicar', 'associados'])
    expect(
      await screen.findByRole('heading', {
        name: 'Categoria de aviso',
        level: 2,
      }),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Categoria de aviso' }),
    ).toHaveAttribute('aria-current', 'page')
    // a página (main) mostra só o catálogo escolhido: nenhum outro nome de catálogo nem botão de escolher
    const main = screen.getByRole('main')
    expect(main).not.toHaveTextContent('Estado civil')
    expect(screen.queryAllByRole('button', { name: 'Estado civil' })).toEqual(
      [],
    )
    // e a barra tem a volta ao Início
    expect(screen.getByRole('link', { name: /Início/ })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('escolher outro catálogo na barra troca a página e o endereço', async () => {
    montar('/configuracoes', ['comunicar', 'associados'])
    await userEvent.click(
      await screen.findByRole('link', { name: 'Estado civil' }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Estado civil', level: 2 }),
    ).toBeVisible()
    expect(await screen.findByText('Casado(a)')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Estado civil' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('catálogo pelo endereço abre direto', async () => {
    montar('/configuracoes/estado_civil', ['associados'])
    expect(
      await screen.findByRole('heading', { name: 'Estado civil', level: 2 }),
    ).toBeVisible()
  })

  it('catálogo sem permissão pelo endereço: avisa, sem mostrar nada dele', async () => {
    montar('/configuracoes/forma_pagamento', ['associados'])
    expect(
      await screen.findByText(
        /Este catálogo não existe ou não está disponível/,
      ),
    ).toBeVisible()
    expect(
      screen.queryByRole('heading', { name: 'Forma de pagamento' }),
    ).toBeNull()
  })

  it('o catálogo de sistema (sem dono) só aparece para gerenciar_acesso, no grupo "Sistema"', async () => {
    montar('/configuracoes', ['gerenciar_acesso'])
    expect(
      await screen.findByRole('link', { name: 'Tipo do sistema' }),
    ).toBeVisible()
    expect(screen.getByText('Sistema')).toBeVisible()
  })
})

describe('Configurações sem nome técnico (v9.3g, pedido do Presidente em 06/11)', () => {
  it('a opção aparece só pelo nome, sem o código interno', async () => {
    montar('/configuracoes/estado_civil', ['associados'])
    expect(await screen.findByText('Casado(a)')).toBeVisible()
    expect(screen.queryByText('CASADO')).not.toBeInTheDocument()
  })

  it('opção nova: só o nome; o código sai dele, sem acento nem espaço', async () => {
    const user = userEvent.setup()
    vi.mocked(api.criarOpcaoCatalogo).mockResolvedValue(
      {} as Awaited<ReturnType<typeof api.criarOpcaoCatalogo>>,
    )
    montar('/configuracoes/estado_civil', ['associados'])
    await user.click(await screen.findByRole('button', { name: 'Nova opção' }))
    await user.type(screen.getByLabelText('Nome da opção'), 'Viúvo(a)')
    await user.click(screen.getByRole('button', { name: 'Adicionar opção' }))
    expect(api.criarOpcaoCatalogo).toHaveBeenCalledWith('estado_civil', {
      codigo: 'VIUVO_A',
      rotulo: 'Viúvo(a)',
    })
  })

  it('o código gerado do nome', () => {
    expect(codigoDoRotulo('União estável')).toBe('UNIAO_ESTAVEL')
    expect(codigoDoRotulo('  Ação social / Cesta  ')).toBe('ACAO_SOCIAL_CESTA')
    expect(codigoDoRotulo('???')).toBe('OPCAO')
  })
})
