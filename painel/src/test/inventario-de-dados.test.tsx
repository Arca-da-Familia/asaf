import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import * as privacidade from '@/lib/privacidade'
import { InventarioDeDadosPage } from '@/pages/InventarioDeDados'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterInventario: vi.fn(),
  ajustarAtividade: vi.fn(),
  historicoDaAtividade: vi.fn(),
  baixarInventario: vi.fn(),
}))

const azure: privacidade.OperadorDoInventario = {
  codigo: 'AZURE',
  nome: 'Microsoft (Azure)',
  o_que_faz: 'hospeda o banco',
  onde: 'Brasil; cópias nos Estados Unidos',
  fora_do_brasil: true,
  termos:
    'Adendo de Proteção de Dados da Microsoft (cláusulas da União Europeia)',
}

const minhaReceita: privacidade.ConsultaDoInventario = {
  codigo: 'MINHA_RECEITA',
  nome: 'Minha Receita (minhareceita.org)',
  o_que_recebe: 'só o CNPJ do fornecedor',
  o_que_devolve: 'a situação cadastral',
  termos: 'projeto aberto e gratuito, sem termos de uso nem contrato',
  uso: 'em uso: Financeiro > Fornecedores',
}

const viaCep: privacidade.ConsultaDoInventario = {
  codigo: 'VIACEP',
  nome: 'ViaCEP (viacep.com.br)',
  o_que_recebe: 'só o CEP',
  o_que_devolve: 'o endereço do CEP',
  termos: 'serviço gratuito, sem termos de uso nem contrato',
  uso: 'nenhuma tela do painel nem do site a usa hoje',
}

const atividade = (
  extra: Partial<privacidade.AtividadeDeTratamento> = {},
): privacidade.AtividadeDeTratamento => ({
  codigo: 'BENEFICIARIOS',
  nome: 'Atendimento social a beneficiários',
  finalidade: 'Acompanhar as famílias atendidas.',
  bases_legais: ['ART11_I'],
  bases_legais_texto: ['Art. 11, I — consentimento específico'],
  operadores: ['AZURE'],
  operadores_detalhe: [azure],
  consultas_detalhe: [],
  medidas: 'Só a equipe do projeto.',
  observacoes: '',
  base_legal_conferida: false,
  transferencia_internacional: true,
  tabelas: ['registros_atendimento'],
  titulares: ['beneficiário de projeto'],
  dados_pessoais: [],
  dados_sensiveis: ['registros_atendimento.relato'],
  texto_livre_que_pode_ter_sensivel: [],
  pode_ter_crianca: true,
  requisito_crianca: 'Art. 14: no melhor interesse da criança',
  tabelas_externas: [],
  armazenamento: ['Banco de dados no Azure'],
  prazos_de_guarda: [],
  prazos_fixos: [],
  sem_rotina_de_guarda: true,
  versao: 0,
  alterado_em: null,
  ...extra,
})

const inventario = (
  extra: Partial<privacidade.Inventario> = {},
): privacidade.Inventario => ({
  atividades: [atividade()],
  tabelas_sem_atividade: [],
  bases_legais: [
    { codigo: 'ART7_V', texto: 'Art. 7º, V — contrato' },
    { codigo: 'ART11_I', texto: 'Art. 11, I — consentimento específico' },
  ],
  operadores: [azure],
  consultas: [minhaReceita, viaCep],
  base_legal_a_conferir: ['BENEFICIARIOS'],
  pode_gerir: true,
  ...extra,
})

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  ultimoCliente = cliente
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <InventarioDeDadosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let ultimoCliente: QueryClient

beforeEach(() => vi.resetAllMocks())

describe('Inventário de dados (v7.0c)', () => {
  it('mostra as seções, os selos e o que falta; passa no axe', async () => {
    vi.mocked(privacidade.obterInventario).mockResolvedValue(
      inventario({ tabelas_sem_atividade: ['tabela_nova'] }),
    )
    const { container } = desenhar()
    const cartao = await screen.findByRole('region', {
      name: 'Atendimento social a beneficiários',
    })
    expect(within(cartao).getByText('Dado sensível')).toBeInTheDocument()
    expect(
      within(cartao).getByText('Pode ter criança ou adolescente'),
    ).toBeInTheDocument()
    expect(
      within(cartao).getByText('Base legal: proposta do sistema'),
    ).toBeInTheDocument()
    expect(
      within(cartao).getByText('Sem rotina automática de eliminação ainda.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('pendencias-do-inventario')).toHaveTextContent(
      'Dados pessoais fora do inventário: tabela_nova.',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('v7.3e: mostra o serviço de consulta na atividade e a lista dos serviços com o uso de cada um', async () => {
    vi.mocked(privacidade.obterInventario).mockResolvedValue(
      inventario({
        atividades: [
          atividade({
            codigo: 'FORNECEDORES',
            nome: 'Fornecedores',
            consultas_detalhe: [minhaReceita],
          }),
        ],
      }),
    )
    const { container } = desenhar()
    const cartao = await screen.findByRole('region', { name: 'Fornecedores' })
    expect(
      within(cartao).getByText(/serviço de consulta, sem contrato/),
    ).toHaveTextContent(
      /recebe só o CNPJ do fornecedor\. Termos: projeto aberto/,
    )
    const lista = screen.getByTestId('servicos-de-consulta')
    expect(lista).toHaveTextContent(
      'ViaCEP (viacep.com.br): recebe só o CEP e devolve o endereço do CEP. Uso: nenhuma tela do painel nem do site a usa hoje.',
    )
    expect(lista).toHaveTextContent('Uso: em uso: Financeiro > Fornecedores.')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ajustar envia o que mudou e mostra o erro do servidor', async () => {
    vi.mocked(privacidade.obterInventario).mockResolvedValue(inventario())
    vi.mocked(privacidade.ajustarAtividade)
      .mockRejectedValueOnce(
        new ApiError(422, 'Escolha ao menos uma base legal da lista.'),
      )
      .mockResolvedValueOnce(
        inventario({
          atividades: [
            atividade({
              base_legal_conferida: true,
              versao: 1,
              alterado_em: '2026-10-23T15:00:00',
            }),
          ],
          base_legal_a_conferir: [],
        }),
      )
    desenhar()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ajustar' }),
    )
    const form = screen.getByRole('form', {
      name: 'Ajustar Atendimento social a beneficiários',
    })
    await userEvent.click(within(form).getByLabelText('Art. 7º, V — contrato'))
    await userEvent.click(
      within(form).getByLabelText(
        'O encarregado conferiu a base legal desta atividade',
      ),
    )
    await userEvent.click(
      within(form).getByRole('button', { name: 'Salvar (versão nova)' }),
    )
    expect(
      await within(form).findByText(
        'Escolha ao menos uma base legal da lista.',
      ),
    ).toBeInTheDocument()
    await userEvent.click(
      within(form).getByRole('button', { name: 'Salvar (versão nova)' }),
    )
    expect(await screen.findByText('Base legal conferida')).toBeInTheDocument()
    expect(privacidade.ajustarAtividade).toHaveBeenLastCalledWith(
      'BENEFICIARIOS',
      expect.objectContaining({
        bases_legais: ['ART11_I', 'ART7_V'],
        base_legal_conferida: true,
      }),
      0,
    )
    expect(
      screen.getByText('Art. 14: no melhor interesse da criança'),
    ).toBeInTheDocument()
  })

  it('quem só vê não tem Ajustar, mas baixa e vê o histórico', async () => {
    vi.mocked(privacidade.obterInventario).mockResolvedValue(
      inventario({ pode_gerir: false }),
    )
    vi.mocked(privacidade.historicoDaAtividade).mockResolvedValue([
      { versao: 0, alterado_em: null, por: 'proposta do sistema', campos: {} },
    ])
    vi.mocked(privacidade.baixarInventario).mockResolvedValue()
    desenhar()
    await screen.findByRole('region', {
      name: 'Atendimento social a beneficiários',
    })
    expect(screen.queryByRole('button', { name: 'Ajustar' })).toBeNull()
    await userEvent.click(
      screen.getByRole('button', { name: 'Baixar a planilha' }),
    )
    expect(privacidade.baixarInventario).toHaveBeenCalledWith('planilha')
    await userEvent.click(
      screen.getByRole('button', { name: 'Ver o histórico' }),
    )
    expect(
      await screen.findByText('Versão 0 — proposta do sistema'),
    ).toBeInTheDocument()
  })

  it('a versão de partida é a da abertura do formulário, mesmo se a lista for relida no meio (achado da conferência)', async () => {
    vi.mocked(privacidade.obterInventario)
      .mockResolvedValueOnce(inventario())
      .mockResolvedValue(
        inventario({
          atividades: [
            atividade({ versao: 3, alterado_em: '2026-10-23T15:00:00' }),
          ],
        }),
      )
    vi.mocked(privacidade.ajustarAtividade).mockResolvedValue(inventario())
    desenhar()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ajustar' }),
    )
    await ultimoCliente.invalidateQueries({ queryKey: ['privacidade'] })
    expect(await screen.findByText(/Versão 3, de/)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Salvar (versão nova)' }),
    )
    expect(privacidade.ajustarAtividade).toHaveBeenCalledWith(
      'BENEFICIARIOS',
      expect.anything(),
      0,
    )
  })
})
