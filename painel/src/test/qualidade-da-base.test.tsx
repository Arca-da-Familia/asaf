import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import type { ComparacaoDeDuplicado, SinalDeRevisao } from '@/lib/api'
import { QualidadeDaBasePage } from '@/pages/QualidadeDaBase'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  listarFilaDeRevisao: vi.fn(),
  escanearDuplicidade: vi.fn(),
  higienizarContatos: vi.fn(),
  ignorarItemDaFila: vi.fn(),
  compararItemDaFila: vi.fn(),
  mesclarPessoas: vi.fn(),
  anonimizarVencidos: vi.fn(),
}))

const duplicado: SinalDeRevisao = {
  id_fila: 1,
  tipo_sinal: 'duplicidade_nome_nascimento',
  detalhe: 'Mesmo nome e mesma data de nascimento',
  status: 'pendente',
  criado_em: '2026-10-05T10:00:00',
  id_pessoa_a: 10,
  nome_pessoa_a: 'Maria Souza',
  id_pessoa_b: 11,
  nome_pessoa_b: 'Maria de Souza',
  e_associado_a: true,
  matricula_a: 5,
  e_associado_b: false,
  matricula_b: null,
}
const telefone: SinalDeRevisao = {
  id_fila: 2,
  tipo_sinal: 'contato_telefone_invalido',
  detalhe: 'Telefone 123',
  status: 'pendente',
  criado_em: '2026-10-05T10:00:00',
  id_pessoa_a: 12,
  nome_pessoa_a: 'João Lima',
  id_pessoa_b: null,
  nome_pessoa_b: null,
  e_associado_a: true,
  matricula_a: 7,
  e_associado_b: false,
  matricula_b: null,
}

// v9.5f: os dois são associados; fica o da matrícula mais antiga (5, desde 03/2019), mesmo sendo o lado A
const comparacao: ComparacaoDeDuplicado = {
  id_fila: 1,
  tipo_sinal: 'duplicidade_nome_nascimento',
  detalhe: 'Mesmo nome e mesma data de nascimento',
  fica: 10,
  os_dois_sao_associados: true,
  a: {
    id_pessoa: 10,
    nome_completo: 'Maria Souza',
    cpf_mascarado: '***.***.***-45',
    data_nascimento: '1975-07-22',
    email_contato: 'maria@exemplo.com',
    telefone_whatsapp: '(91) 98888-1234',
    estado_civil: null,
    profissao: null,
    naturalidade: null,
    tem_foto: false,
    familiares: 2,
    associado: {
      id_associado: 5,
      numero_matricula: 5,
      data_admissao: '2019-03-01',
      categoria: 'Efetivo',
      status_arrolamento: 'Ativo - Em Dia',
      endereco: 'Rua A, 1, Marco, Belém/PA',
      titulos_pagos: 38,
      titulos_em_aberto: 0,
    },
  },
  b: {
    id_pessoa: 11,
    nome_completo: 'Maria de Souza',
    cpf_mascarado: null,
    data_nascimento: '1975-07-22',
    email_contato: 'maria@exemplo.com',
    telefone_whatsapp: '(91) 99123-4567',
    estado_civil: null,
    profissao: null,
    naturalidade: null,
    tem_foto: false,
    familiares: 0,
    associado: {
      id_associado: 41,
      numero_matricula: 41,
      data_admissao: '2025-08-01',
      categoria: 'Efetivo',
      status_arrolamento: 'Em Experiência',
      endereco: 'Rua A, 1, Marco, Belém/PA',
      titulos_pagos: 2,
      titulos_em_aberto: 1,
    },
  },
  campos: [
    {
      chave: 'nome_completo',
      fica: 'Maria Souza',
      sai: 'Maria de Souza',
      modo: 'escolher',
    },
    { chave: 'cpf', fica: '***.***.***-45', sai: null, modo: 'so_um' },
    {
      chave: 'data_nascimento',
      fica: '1975-07-22',
      sai: '1975-07-22',
      modo: 'igual',
    },
    {
      chave: 'email_contato',
      fica: 'maria@exemplo.com',
      sai: 'maria@exemplo.com',
      modo: 'igual',
    },
    {
      chave: 'telefone_whatsapp',
      fica: '(91) 98888-1234',
      sai: '(91) 99123-4567',
      modo: 'escolher',
    },
  ],
  cpf_diferente: false,
  situacao: {
    fica: 'Ativo - Em Dia',
    sai: 'Em Experiência',
    depois: 'Calculada de novo com as mensalidades das duas',
  },
  acesso: {
    fica: 'Tem acesso',
    sai: 'Sem acesso',
    depois: 'Fica o acesso do cadastro que fica',
  },
}

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <QualidadeDaBasePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.listarFilaDeRevisao).mockResolvedValue([duplicado, telefone])
})

describe('Qualidade da base (v5.4c: a tela que faltava para as rotas da v1.8)', () => {
  it('lista a fila com o tipo de cada sinal e oferece mesclar só onde há duas pessoas', async () => {
    desenhar()
    const dup = within(
      await screen.findByRole('listitem', {
        name: 'Possível cadastro duplicado: Maria Souza',
      }),
    )
    // já no cabeçalho do item: quem é associado (e a matrícula) e quem é só uma pessoa — nomes iguais não se distinguem de outro jeito
    expect(
      dup.getByText(/Maria Souza \(associado, matrícula 5\)/),
    ).toBeInTheDocument()
    expect(
      dup.getByText(/Maria de Souza \(pessoa sem cadastro de associado\)/),
    ).toBeInTheDocument()
    expect(dup.getByRole('button', { name: 'Comparar' })).toBeInTheDocument()
    expect(
      dup.getByRole('button', { name: 'Não é duplicado — ignorar' }),
    ).toBeInTheDocument()
    const tel = within(
      screen.getByRole('listitem', {
        name: 'Telefone com formato inválido: João Lima',
      }),
    )
    expect(
      tel.queryByRole('button', { name: 'Comparar' }),
    ).not.toBeInTheDocument()
    expect(
      tel.getByRole('button', { name: 'Já resolvido — ignorar' }),
    ).toBeInTheDocument()
  })

  it('fila vazia diz isso', async () => {
    vi.mocked(api.listarFilaDeRevisao).mockResolvedValue([])
    desenhar()
    expect(
      await screen.findByText('Nada na fila de revisão'),
    ).toBeInTheDocument()
  })

  it('as buscas mostram quantos achados novos entraram na fila', async () => {
    const u = userEvent.setup()
    vi.mocked(api.escanearDuplicidade).mockResolvedValue({
      mensagem: '2 novo(s) candidato(s) a duplicidade adicionado(s) à fila.',
      novos: 2,
    })
    vi.mocked(api.higienizarContatos).mockResolvedValue({
      mensagem: '0 telefone(s) com formato inválido adicionado(s) à fila.',
      novos: 0,
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Procurar cadastros duplicados',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      '2 novo(s) candidato(s)',
    )
    await u.click(
      screen.getByRole('button', { name: 'Procurar telefones inválidos' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('0 telefone(s)'),
    )
  })

  it('ignorar um item chama o servidor', async () => {
    const u = userEvent.setup()
    vi.mocked(api.ignorarItemDaFila).mockResolvedValue({
      mensagem: 'Item marcado como ignorado.',
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Não é duplicado — ignorar' }),
    )
    await waitFor(() => expect(api.ignorarItemDaFila).toHaveBeenCalledWith(1))
    expect(await screen.findByRole('status')).toHaveTextContent('ignorado')
  })

  it('os filtros: por tipo (com a contagem) e por situação (pede ao servidor os ignorados)', async () => {
    const u = userEvent.setup()
    desenhar()
    await screen.findByRole('button', { name: 'Comparar' })
    const tipos = within(screen.getByRole('group', { name: 'Tipo' }))
    expect(tipos.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Todos · 2',
      'Duplicados · 1',
      'Telefone · 1',
      'E-mail · 0',
    ])
    await u.click(tipos.getByRole('button', { name: 'Telefone · 1' }))
    expect(
      within(screen.getByRole('list', { name: 'Itens da fila' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(1)
    expect(
      screen.getByRole('listitem', {
        name: 'Telefone com formato inválido: João Lima',
      }),
    ).toBeInTheDocument()
    await u.selectOptions(
      screen.getByRole('combobox', { name: /Situação/ }),
      'ignorado',
    )
    await waitFor(() =>
      expect(api.listarFilaDeRevisao).toHaveBeenCalledWith('ignorado'),
    )
  })

  it('passo a passo: comparar campo a campo (a matrícula mais antiga com cadeado), escolher o que difere e juntar digitando o nome', async () => {
    const u = userEvent.setup()
    vi.mocked(api.compararItemDaFila).mockResolvedValue(comparacao)
    vi.mocked(api.mesclarPessoas).mockResolvedValue({
      mensagem: 'Pessoas mescladas com sucesso.',
      matricula_mantida: 5,
      matricula_liberada: 41,
    })
    desenhar()
    await u.click(await screen.findByRole('button', { name: 'Comparar' }))
    expect(
      await screen.findByText('Fica a 5, a mais antiga'),
    ).toBeInTheDocument()
    // o CPF só de um lado não pede escolha; o e-mail igual também não
    expect(screen.getByText('Fica o que tem')).toBeInTheDocument()
    expect(screen.getAllByText('Igual').length).toBeGreaterThan(0)
    // o nome e o telefone diferem: precisam de escolha antes de continuar
    const continuar = screen.getByRole('button', { name: 'Continuar' })
    expect(continuar).toBeDisabled()
    expect(
      screen.getByText(/Falta escolher 2 campos \(nome completo, telefone\)/),
    ).toBeInTheDocument()
    const nome = within(
      screen.getByRole('radiogroup', { name: 'Nome completo' }),
    )
    await u.click(nome.getByRole('radio', { name: /Maria Souza/ }))
    const tel = within(screen.getByRole('radiogroup', { name: 'Telefone' }))
    await u.click(tel.getByRole('radio', { name: /99123-4567/ }))
    expect(continuar).toBeEnabled()
    await u.click(continuar)

    // passo 3: o resultado e o que acontece
    expect(await screen.findByText('Vai ficar assim')).toBeInTheDocument()
    expect(screen.getByText('(91) 99123-4567')).toBeInTheDocument()
    expect(screen.getByText(/fica livre/)).toBeInTheDocument()
    expect(
      screen.getByText(/Acesso ao painel: Fica o acesso do cadastro que fica/),
    ).toBeInTheDocument()
    const juntar = screen.getByRole('button', {
      name: 'Juntar os dois cadastros',
    })
    expect(juntar).toBeDisabled()
    await u.type(
      screen.getByLabelText(
        /Para confirmar, digite o nome do cadastro que será juntado/,
      ),
      'Maria de Souza',
    )
    await u.click(juntar)
    await waitFor(() =>
      expect(api.mesclarPessoas).toHaveBeenCalledWith(10, {
        id_pessoa_absorvida: 11,
        nome_confirmacao: 'Maria de Souza',
        escolhas: { nome_completo: 'mantida', telefone_whatsapp: 'absorvida' },
        id_fila: 1,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'A matrícula nº 41 ficou livre: um associado novo pode recebê-la',
    )
  })

  it('CPFs diferentes (mesmo com o mesmo final escondido) pedem escolha e avisam para conferir se é a mesma pessoa', async () => {
    const u = userEvent.setup()
    vi.mocked(api.compararItemDaFila).mockResolvedValue({
      ...comparacao,
      cpf_diferente: true,
      campos: [
        ...comparacao.campos.filter((c) => c.chave !== 'cpf'),
        {
          chave: 'cpf',
          fica: '***.***.***-99',
          sai: '***.***.***-99',
          modo: 'escolher',
        },
      ],
    })
    desenhar()
    await u.click(await screen.findByRole('button', { name: 'Comparar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Os CPFs são diferentes',
    )
    expect(
      within(screen.getByRole('radiogroup', { name: 'CPF' })).getAllByRole(
        'radio',
      ),
    ).toHaveLength(2)
  })

  it('a recusa do servidor ao juntar aparece e nada some', async () => {
    const u = userEvent.setup()
    vi.mocked(api.compararItemDaFila).mockResolvedValue({
      ...comparacao,
      campos: comparacao.campos.map((c) =>
        c.modo === 'escolher' ? { ...c, sai: c.fica, modo: 'igual' } : c,
      ),
    })
    vi.mocked(api.mesclarPessoas).mockRejectedValue(
      new Error(
        'Nome de confirmação não confere com o nome da pessoa que será absorvida.',
      ),
    )
    desenhar()
    await u.click(await screen.findByRole('button', { name: 'Comparar' }))
    await u.click(await screen.findByRole('button', { name: 'Continuar' }))
    await u.type(
      screen.getByLabelText(
        /Para confirmar, digite o nome do cadastro que será juntado/,
      ),
      'Outro Nome',
    )
    await u.click(
      screen.getByRole('button', { name: 'Juntar os dois cadastros' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('não confere')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('Vai ficar assim')).toBeInTheDocument()
  })

  it('anonimizar em lote pede confirmação e mostra o total', async () => {
    const u = userEvent.setup()
    vi.mocked(api.anonimizarVencidos).mockResolvedValue({
      mensagem: '3 associado(s) anonimizado(s).',
      total: 3,
    })
    desenhar()
    await u.click(
      await screen.findByRole('button', {
        name: 'Anonimizar desligados com prazo vencido',
      }),
    )
    expect(api.anonimizarVencidos).not.toHaveBeenCalled()
    expect(
      await screen.findByText(/Apaga de forma definitiva o CPF/),
    ).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Anonimizar agora' }))
    await waitFor(() => expect(api.anonimizarVencidos).toHaveBeenCalled())
    expect(await screen.findByRole('status')).toHaveTextContent(
      '3 associado(s) anonimizado(s).',
    )
  })

  it('não tem violação de acessibilidade (axe), nem na comparação aberta', async () => {
    const u = userEvent.setup()
    vi.mocked(api.compararItemDaFila).mockResolvedValue(comparacao)
    const { container } = desenhar()
    await screen.findByRole('button', { name: 'Comparar' })
    expect(await axe(container)).toHaveNoViolations()
    await u.click(screen.getByRole('button', { name: 'Comparar' }))
    await screen.findByText('Fica a 5, a mais antiga')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('a fila com busca e páginas (v9.3p: a tela tinha 12 alturas de notebook)', () => {
  it('10 por página e a busca pelo nome de qualquer das duas pessoas, sem acento', async () => {
    const user = userEvent.setup()
    vi.mocked(api.listarFilaDeRevisao).mockResolvedValue(
      Array.from({ length: 13 }, (_, i) => ({
        ...telefone,
        id_fila: 100 + i,
        nome_pessoa_a: i === 11 ? 'Conceição Araújo' : `Pessoa ${i + 1}`,
      })),
    )
    desenhar()
    expect(
      await screen.findByRole('navigation', { name: 'Páginas da fila' }),
    ).toHaveTextContent('Página 1 de 2 · 13 itens')
    expect(
      within(screen.getByRole('list', { name: 'Itens da fila' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(10)
    await user.type(screen.getByLabelText('Procurar na fila'), 'araujo')
    expect(
      within(screen.getByRole('list', { name: 'Itens da fila' })).getAllByRole(
        'listitem',
      ),
    ).toHaveLength(1)
    expect(screen.getByText('1 item encontrado.')).toBeInTheDocument()
  })
})
