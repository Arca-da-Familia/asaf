import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssociarRotulos } from '@/components/acessibilidade/AssociarRotulos'
import * as api from '@/lib/api'
import { associarRotulos, nomearCamposSemRotulo } from '@/lib/rotulos'
import { AssociadoNovoPage } from '@/pages/AssociadoNovo'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  listarOpcoesLegado: vi.fn(),
}))

function montar(html: string): HTMLElement {
  const raiz = document.createElement('div')
  raiz.innerHTML = html
  document.body.appendChild(raiz)
  return raiz
}

describe('associarRotulos (rede de segurança: rótulo solto passa a nomear o campo)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('liga o rótulo ao campo que vem logo depois, de modo que o leitor de tela o nomeia', () => {
    const raiz = montar(
      '<label>Nome completo *</label><input /><label>Categoria</label><select><option>A</option></select>',
    )
    expect(associarRotulos(raiz)).toBe(2)
    const campos = raiz.querySelectorAll<HTMLInputElement>('input, select')
    expect(campos[0]!.labels?.[0]?.textContent).toBe('Nome completo *')
    expect(campos[1]!.labels?.[0]?.textContent).toBe('Categoria')
  })

  it('em lista, cada rótulo ganha o SEU campo, com ids diferentes', () => {
    const raiz = montar(
      [1, 2, 3]
        .map((n) => `<div><label>Item ${n}</label><input /></div>`)
        .join(''),
    )
    associarRotulos(raiz)
    const campos = [...raiz.querySelectorAll<HTMLInputElement>('input')]
    expect(new Set(campos.map((c) => c.id)).size).toBe(3)
    campos.forEach((c, i) =>
      expect(c.labels?.[0]?.textContent).toBe(`Item ${i + 1}`),
    )
  })

  it('campo dentro de um invólucro logo depois do rótulo também é ligado, mas só se for UM campo', () => {
    const raiz = montar(
      '<label>Um só</label><div><input /></div><label>Dois</label><div><input /><input /></div>',
    )
    expect(associarRotulos(raiz)).toBe(1)
    const campos = raiz.querySelectorAll<HTMLInputElement>('input')
    expect(campos[0]!.labels?.[0]?.textContent).toBe('Um só')
    expect(campos[1]!.labels?.length).toBe(0)
    expect(campos[2]!.labels?.length).toBe(0)
  })

  it('não mexe no que já está certo nem em campo escondido', () => {
    const raiz = montar(
      [
        '<label for="a">Já ligado</label><input id="a" />',
        '<label>Envolve <input type="checkbox" /></label>',
        '<label>Escondido</label><input type="hidden" />',
        // o campo já tem rótulo (o de baixo, ligado por `for`): o solto de cima não ganha um segundo
        '<label>Solto</label><input id="e" /><label for="e">Rótulo que já existia</label>',
      ].join(''),
    )
    const antes = raiz.innerHTML
    expect(associarRotulos(raiz)).toBe(0)
    expect(raiz.innerHTML).toBe(antes)
  })

  it('o componente religa o que aparece depois (tela que carrega os campos mais tarde)', async () => {
    render(<AssociarRotulos />)
    const raiz = montar('')
    raiz.innerHTML = '<label>Chegou depois</label><input />'
    await waitFor(() =>
      expect(
        raiz.querySelector<HTMLInputElement>('input')!.labels?.[0]?.textContent,
      ).toBe('Chegou depois'),
    )
  })
})

describe('em uma tela de verdade (Novo associado)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api.me).mockResolvedValue({
      id_usuario: 1,
      id_associado: 1,
      nome_completo: 'Quem Atende',
      email: 'a@b.c',
      nivel: 'Presidente',
      mfa_ativado: false,
      mfa_obrigatorio: false,
      mfa_pendente: false,
      permissoes: ['associados'],
    })
    vi.mocked(api.listarOpcoesLegado).mockResolvedValue([
      { id_opcao: 1, valor: 'Efetivo', ativo: true },
    ])
  })

  it('todo campo passa a ter rótulo associado: dá para achá-lo pelo rótulo e o axe não reprova', async () => {
    const u = userEvent.setup()
    const cliente = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { container } = render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <AssociarRotulos />
          <AssociadoNovoPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const nome = await screen.findByLabelText('Nome completo *')
    await u.type(nome, 'Maria')
    expect(nome).toHaveValue('Maria')
    expect(screen.getByLabelText('CPF *')).toBeInTheDocument()
    expect(screen.getByLabelText('Categoria *')).toBeInTheDocument()
    expect(await axe(container, { runOnly: ['label'] })).toHaveNoViolations()
  })
})

describe('nomearCamposSemRotulo (segunda rede: campo sem nome ganha um aria-label)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('select com convite na primeira opção usa o convite; campo solto usa o nome por extenso; rótulo de verdade não é trocado', () => {
    const raiz = montar(
      '<select name="id_conta_contabil"><option value="">Selecione a conta contábil…</option><option value="1">1.1</option></select>' +
        '<select name="tipo"><option value="Ativo">Ativo</option></select>' +
        '<input type="date" name="data_competencia" />' +
        '<input type="number" name="ano" placeholder="Ano" />' +
        '<label for="ok">Com rótulo</label><input id="ok" name="com_rotulo" />' +
        '<input type="file" />' +
        '<input type="hidden" name="escondido" />',
    )
    nomearCamposSemRotulo(raiz)
    expect(raiz.querySelector('[name=id_conta_contabil]')).toHaveAttribute(
      'aria-label',
      'Selecione a conta contábil',
    )
    expect(raiz.querySelector('[name=tipo]')).toHaveAttribute(
      'aria-label',
      'Tipo',
    )
    expect(raiz.querySelector('[name=data_competencia]')).toHaveAttribute(
      'aria-label',
      'Data competencia',
    )
    expect(raiz.querySelector('[name=ano]')).not.toHaveAttribute('aria-label')
    expect(raiz.querySelector('[name=com_rotulo]')).not.toHaveAttribute(
      'aria-label',
    )
    expect(raiz.querySelector('input[type=file]')).toHaveAttribute(
      'aria-label',
      'Anexar arquivo',
    )
    expect(raiz.querySelector('[name=escondido]')).not.toHaveAttribute(
      'aria-label',
    )
  })
})
