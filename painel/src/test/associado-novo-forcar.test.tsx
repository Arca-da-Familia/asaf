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

// v9.5e: o cadastro é em 4 passos (Pessoa, Contato, Endereço, Conferir); "Continuar" confere só o passo
async function continuar(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole('button', { name: 'Continuar' }))
}

async function preencher(u: ReturnType<typeof userEvent.setup>) {
  await screen.findAllByRole('option', { name: 'Efetivo' })
  await u.type(campo('Nome completo *'), 'Joana Parecida de Teste')
  await u.type(campo('CPF *'), '52998224725')
  await u.selectOptions(campo('Categoria *'), 'Efetivo')
  await continuar(u)
  await screen.findByText('Passo 2 de 4 · Contato')
  await u.type(campo('E-mail *'), 'joana@exemplo.com.br')
  await u.type(campo('Telefone (WhatsApp) *'), '91988887777')
  await continuar(u)
  await screen.findByText('Passo 3 de 4 · Endereço')
  await u.type(campo('CEP *'), '68515000')
  await u.type(campo('Logradouro *'), 'Rua das Flores')
  await u.type(campo('Número *'), '10')
  await u.type(campo('Bairro *'), 'Centro')
  await u.type(campo('Cidade *'), 'Parauapebas')
  await u.type(campo('Estado (UF) *'), 'PA')
  await continuar(u)
  await screen.findByText('Passo 4 de 4 · Conferir')
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

describe('Novo associado em 4 passos (v9.5e, desenho aprovado na rodada 4)', () => {
  it('"Continuar" não sai do passo com campo obrigatório vazio e mostra o erro ali', async () => {
    const u = userEvent.setup()
    desenhar(['associados'])
    await screen.findByText('Passo 1 de 4 · Pessoa')
    await continuar(u)
    expect(await screen.findByText('Passo 1 de 4 · Pessoa')).toBeInTheDocument()
    expect(screen.queryByText('Passo 2 de 4 · Contato')).not.toBeInTheDocument()
    expect(api.criarAssociadoMaster).not.toHaveBeenCalled()
  })

  it('o último passo mostra o resumo de cada parte; "Corrigir" volta ao passo com o que foi digitado', async () => {
    const u = userEvent.setup()
    desenhar(['associados'])
    await preencher(u)
    expect(screen.getByText('Joana Parecida de Teste')).toBeInTheDocument()
    expect(screen.getByText('joana@exemplo.com.br')).toBeInTheDocument()
    expect(screen.getByText('Parauapebas')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Corrigir Contato' }))
    expect(
      await screen.findByText('Passo 2 de 4 · Contato'),
    ).toBeInTheDocument()
    expect(campo('E-mail *')).toHaveValue('joana@exemplo.com.br')
    await u.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(campo('Nome completo *')).toHaveValue('Joana Parecida de Teste')
  })

  it('o que o servidor recusa num campo aparece no resumo da parte dele, e o envio leva todos os passos', async () => {
    const u = userEvent.setup()
    vi.mocked(api.criarAssociadoMaster).mockRejectedValue(
      new api.ApiError(422, 'inválido', [
        { campo: 'cpf', mensagem: 'CPF já cadastrado.' },
      ]),
    )
    desenhar(['associados'])
    await preencher(u)
    await u.click(screen.getByRole('button', { name: 'Cadastrar associado' }))
    // aparece no resumo da parte Pessoa (o campo dela está no passo 1, escondido agora)
    const avisos = await screen.findAllByText('CPF já cadastrado.')
    expect(avisos.some((el) => !el.closest('[hidden]'))).toBe(true)
    expect(vi.mocked(api.criarAssociadoMaster).mock.calls[0]![0]).toMatchObject(
      {
        nome_completo: 'Joana Parecida de Teste',
        email_contato: 'joana@exemplo.com.br',
        cidade: 'Parauapebas',
      },
    )
  })
})
