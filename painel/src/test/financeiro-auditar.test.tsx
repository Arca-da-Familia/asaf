import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import {
  InicioDoFinanceiro,
  RequireAnyPermission,
  RequirePermission,
} from '@/App'
import { itensVisiveis, moduloVisivel, modulos } from '@/lib/modulos'
import { useMe } from '@/lib/use-me'

// o painel só mostra o Início do operador a quem tem `financeiro`; o componente de operação (FinanceiroInicioPage) busca dados que o auditor não pode ler
vi.mock('@/pages/FinanceiroInicio', () => ({
  FinanceiroInicioPage: () => <p>Retrato do dia de quem opera</p>,
}))
vi.mock('@/lib/use-me', () => ({ useMe: vi.fn() }))

const useMeMock = vi.mocked(useMe)
const comPermissoes = (...permissoes: string[]) =>
  useMeMock.mockReturnValue({
    data: { permissoes },
    isLoading: false,
  } as ReturnType<typeof useMe>)

const financeiro = modulos.find((m) => m.rota === '/financeiro')!
const rotulos = (permissoes: string[]) =>
  itensVisiveis(financeiro, permissoes).map((i) => i.rotulo)

describe('o menu do Financeiro (v5.7e: o Conselho Fiscal audita, não opera)', () => {
  it('quem só tem `financeiro_auditar` entra no módulo e vê SÓ o que audita', () => {
    expect(moduloVisivel(financeiro, ['financeiro_auditar'])).toBe(true)
    expect(rotulos(['financeiro_auditar'])).toEqual([
      'Conselho Fiscal',
      'Auditoria financeira',
      'Relatórios',
    ])
  })

  it('quem opera (`financeiro`) vê o módulo inteiro, inclusive o Início e o que o auditor vê', () => {
    expect(moduloVisivel(financeiro, ['financeiro'])).toBe(true)
    const todos = rotulos(['financeiro'])
    expect(todos).toHaveLength(financeiro.itens!.length)
    for (const r of [
      'Início',
      'Títulos',
      'Registrar saída',
      'Doações',
      'Conselho Fiscal',
      'Auditoria financeira',
      'Relatórios',
    ])
      expect(todos).toContain(r)
  })

  it('nenhuma das duas permissões: o módulo nem aparece', () => {
    expect(moduloVisivel(financeiro, ['associados', 'governanca'])).toBe(false)
  })

  it('o auditor não vê nenhuma tela que opera (registrar saída, doações, cobranças, compras, alçadas...)', () => {
    const visiveis = rotulos(['financeiro_auditar'])
    for (const operacional of [
      'Registrar saída',
      'Doações',
      'Gerar Cobranças',
      'Compras',
      'Alçadas de Aprovação',
      'Conciliação',
      'Títulos',
      'Plano de Contas',
    ])
      expect(visiveis).not.toContain(operacional)
  })
})

function renderFinanceiro(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/403" element={<p>Acesso negado</p>} />
        <Route
          path="/financeiro"
          element={
            <RequireAnyPermission
              permissions={['financeiro', 'financeiro_auditar']}
            >
              <Outlet />
            </RequireAnyPermission>
          }
        >
          <Route index element={<InicioDoFinanceiro />} />
          <Route
            path="conselho-fiscal"
            element={<p>Conselho Fiscal (leitura)</p>}
          />
          <Route
            element={
              <RequirePermission permission="financeiro">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route path="titulos" element={<p>Títulos (opera)</p>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('as rotas do Financeiro para quem só audita', () => {
  it('abre o Conselho Fiscal', () => {
    comPermissoes('financeiro_auditar')
    renderFinanceiro('/financeiro/conselho-fiscal')
    expect(screen.getByText('Conselho Fiscal (leitura)')).toBeInTheDocument()
  })

  it('é barrado na tela que opera, mesmo digitando o endereço', () => {
    comPermissoes('financeiro_auditar')
    renderFinanceiro('/financeiro/titulos')
    expect(screen.getByText('Acesso negado')).toBeInTheDocument()
    expect(screen.queryByText('Títulos (opera)')).not.toBeInTheDocument()
  })

  it('o Início do Financeiro o leva ao Conselho Fiscal (o retrato do operador não é dele)', () => {
    comPermissoes('financeiro_auditar')
    renderFinanceiro('/financeiro')
    expect(screen.getByText('Conselho Fiscal (leitura)')).toBeInTheDocument()
    expect(
      screen.queryByText('Retrato do dia de quem opera'),
    ).not.toBeInTheDocument()
  })

  it('quem opera vê o Início de sempre e a tela de títulos', () => {
    comPermissoes('financeiro')
    renderFinanceiro('/financeiro')
    expect(screen.getByText('Retrato do dia de quem opera')).toBeInTheDocument()
  })

  it('quem opera abre títulos', () => {
    comPermissoes('financeiro')
    renderFinanceiro('/financeiro/titulos')
    expect(screen.getByText('Títulos (opera)')).toBeInTheDocument()
  })

  it('sem nenhuma das duas permissões nada do módulo abre', () => {
    comPermissoes('associados')
    renderFinanceiro('/financeiro/conselho-fiscal')
    expect(screen.getByText('Acesso negado')).toBeInTheDocument()
  })
})
