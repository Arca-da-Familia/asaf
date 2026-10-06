import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { AssociadoNovoPage } from '@/pages/AssociadoNovo'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  criarAssociadoMaster: vi.fn(),
  listarOpcoesLegado: vi.fn(),
}))

function eu(permissoes: string[]) {
  return {
    id_usuario: 1,
    id_associado: 1,
    nome_completo: 'Quem Atende',
    email: 'a@b.c',
    nivel: 'Presidente',
    mfa_ativado: false,
    mfa_obrigatorio: false,
    mfa_pendente: false,
    permissoes,
  }
}

function desenhar(permissoes: string[]) {
  vi.mocked(api.me).mockResolvedValue(eu(permissoes))
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <AssociadoNovoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// os rótulos deste formulário não são ligados aos campos (`label` sem `htmlFor`): o campo é o irmão seguinte do rótulo
function campo(rotulo: string): HTMLInputElement | HTMLSelectElement {
  const alvo = screen.getByText(rotulo).nextElementSibling
  if (!alvo) throw new Error(`campo não achado: ${rotulo}`)
  return alvo as HTMLInputElement | HTMLSelectElement
}

async function preencher(u: ReturnType<typeof userEvent.setup>) {
  await u.type(campo('Nome completo *'), 'Joana Parecida de Teste')
  await u.type(campo('CPF *'), '52998224725')
  await u.type(campo('E-mail *'), 'joana@exemplo.com.br')
  await u.type(campo('Telefone (WhatsApp) *'), '91988887777')
  await u.selectOptions(campo('Categoria *'), 'Efetivo')
  await u.type(campo('CEP *'), '68515000')
  await u.type(campo('Logradouro *'), 'Rua das Flores')
  await u.type(campo('Número *'), '10')
  await u.type(campo('Bairro *'), 'Centro')
  await u.type(campo('Cidade *'), 'Parauapebas')
  await u.type(campo('Estado (UF) *'), 'PA')
}

const parecido = () =>
  new api.ApiError(
    409,
    "Já existe um cadastro parecido: 'Joana Antiga' - confirme que não é a mesma pessoa antes de continuar.",
  )

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarOpcoesLegado).mockResolvedValue([
    { id_opcao: 1, valor: 'Efetivo', ativo: true },
  ])
})

describe('Novo associado: cadastro parecido (v5.4c)', () => {
  it('sem a permissão do Presidente, o aviso aparece e não há como forçar', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarAssociadoMaster).mockRejectedValue(parecido())
    desenhar(['associados'])
    await preencher(u)
    await u.click(screen.getByRole('button', { name: 'Cadastrar associado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe um cadastro parecido',
    )
    expect(
      screen.queryByRole('button', { name: /Cadastrar mesmo assim/ }),
    ).not.toBeInTheDocument()
  })

  it('com a permissão do Presidente, só depois do aviso aparece "cadastrar mesmo assim" e ele manda forcar', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarAssociadoMaster)
      .mockRejectedValueOnce(parecido())
      .mockResolvedValueOnce({ mensagem: 'Ficha criada.', id_associado: 99 })
    desenhar(['associados', 'forcar_cadastro_duplicado'])
    await preencher(u)
    expect(
      screen.queryByRole('button', { name: /Cadastrar mesmo assim/ }),
    ).not.toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Cadastrar associado' }))
    await u.click(
      await screen.findByRole('button', { name: /Cadastrar mesmo assim/ }),
    )
    await waitFor(() =>
      expect(api.criarAssociadoMaster).toHaveBeenCalledTimes(2),
    )
    expect(
      vi.mocked(api.criarAssociadoMaster).mock.calls[0]![0],
    ).not.toHaveProperty('forcar')
    expect(vi.mocked(api.criarAssociadoMaster).mock.calls[1]![0]).toMatchObject(
      {
        nome_completo: 'Joana Parecida de Teste',
        forcar: true,
      },
    )
  })
})
