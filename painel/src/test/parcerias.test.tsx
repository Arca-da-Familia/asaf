import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { FormularioDaParceria } from '@/components/parcerias/FormularioDaParceria'
import { PainelDePublicacao } from '@/components/parcerias/PainelDePublicacao'
import {
  PendenciasDaParceria,
  ResumoFinanceiro,
} from '@/components/parcerias/ResumoEPendencias'
import { SecaoLancamentos } from '@/components/parcerias/SecaoLancamentos'
import {
  lerValorEmReais,
  moeda,
  proximoPassoDaParceria,
  type Opcoes,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

function parceria(
  sobrescrever: Partial<ParceriaDetalhe> = {},
): ParceriaDetalhe {
  return {
    id_parceria: 7,
    tipo: 'EMENDA',
    tipo_rotulo: 'Emenda parlamentar',
    ano: 2026,
    titulo: 'Emenda 123/2026 — Oficinas de música',
    objeto: 'Oficinas de música para crianças do bairro.',
    esfera: 'Municipal',
    orgao_concedente: 'Secretaria Municipal de Assistência Social',
    numero_emenda: '123/2026',
    identificador_unico: null,
    proponente: 'Vereador Exemplo',
    numero_termo: null,
    valor_total: 50000,
    data_assinatura: null,
    vigencia_inicio: null,
    vigencia_fim: null,
    situacao: 'Proposta',
    id_centro_custo: 3,
    codigo_centro_custo: 'PARC-0007',
    recebido: 10000,
    pago: 2000,
    saldo: 8000,
    situacao_publicacao: 'Rascunho',
    enviado_revisao_em: null,
    aprovado_em: null,
    motivo_recusa: null,
    recusado_em: null,
    motivo_retirada: null,
    retirado_em: null,
    criado_em: '2026-10-01T10:00:00',
    atualizado_em: '2026-10-01T10:00:00',
    pode_editar: true,
    pode_enviar_revisao: true,
    pode_aprovar: false,
    pode_retirar: false,
    pode_reabrir: false,
    total_das_parcelas: 0,
    parcelas: [],
    etapas: [],
    relatorios: [],
    lancamentos: [],
    lancamentos_sem_classificacao: [],
    consistencia: { bloqueios: [], avisos: [] },
    ...sobrescrever,
  }
}

const opcoes: Opcoes = {
  tipos: [
    { codigo: 'EMENDA', rotulo: 'Emenda parlamentar' },
    { codigo: 'TERMO_FOMENTO', rotulo: 'Termo de fomento' },
  ],
  esferas: ['Municipal', 'Estadual', 'Federal'],
  situacoes: ['Proposta', 'Em execução'],
  situacoes_de_publicacao: ['Rascunho', 'Em revisão', 'Aprovado', 'Retirado'],
  tipos_de_relatorio: [
    { codigo: 'FINAL', rotulo: 'Prestação de contas final' },
  ],
  resultados: ['Em análise', 'Regulares'],
  situacoes_de_etapa: ['Prevista', 'Realizada'],
  categorias_de_pagamento: [
    { codigo: 'FORNECEDOR', rotulo: 'Fornecedor' },
    { codigo: 'EQUIPE', rotulo: 'Equipe (só função e valor)' },
    { codigo: 'OUTRO', rotulo: 'Outro pagamento' },
  ],
}

describe('lerValorEmReais - como a pessoa escreve no Brasil', () => {
  it.each([
    ['50.000,00', '50000.00'],
    ['50000,5', '50000.50'],
    ['R$ 1.234.567,89', '1234567.89'],
    ['1.200', '1200'],
    ['50000.00', '50000.00'],
    ['50000.5', '50000.50'],
    ['300', '300.00'],
    ['0,99', '0.99'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(lerValorEmReais(entrada)).toBe(esperado)
  })

  it.each(['', 'abc', '0', '0,00', '-5', '1,234,56', '12,345', '1..2', 'R$'])(
    '%j não é um valor válido',
    (entrada) => {
      expect(lerValorEmReais(entrada)).toBeNull()
    },
  )
})

describe('moeda', () => {
  it('formata reais em pt-BR', () => {
    expect(moeda(50000).replace(/\s/g, ' ')).toBe('R$ 50.000,00')
    expect(moeda(0.1 + 0.2).replace(/\s/g, ' ')).toBe('R$ 0,30')
  })
})

describe('proximoPassoDaParceria', () => {
  it('rascunho com pendência manda resolver antes de enviar', () => {
    const d = parceria({
      consistencia: {
        bloqueios: [{ codigo: 'X', mensagem: 'm' }],
        avisos: [],
      },
    })
    expect(proximoPassoDaParceria(d)).toMatch(/Resolva a pendência/)
    const duas = parceria({
      consistencia: {
        bloqueios: [
          { codigo: 'A', mensagem: 'm' },
          { codigo: 'B', mensagem: 'm' },
        ],
        avisos: [],
      },
    })
    expect(proximoPassoDaParceria(duas)).toMatch(/as 2 pendências/)
  })
  it('rascunho limpo manda enviar para revisão; recusado mostra o motivo', () => {
    expect(proximoPassoDaParceria(parceria())).toMatch(/Envie para revisão/)
    expect(
      proximoPassoDaParceria(parceria({ motivo_recusa: 'Falta o bairro.' })),
    ).toMatch(/Recusada: Falta o bairro\./)
  })
  it('em revisão: quem pode aprovar é chamado; os demais esperam outra pessoa', () => {
    expect(
      proximoPassoDaParceria(
        parceria({ situacao_publicacao: 'Em revisão', pode_aprovar: true }),
      ),
    ).toMatch(/aprove ou recuse/)
    expect(
      proximoPassoDaParceria(parceria({ situacao_publicacao: 'Em revisão' })),
    ).toMatch(/outra pessoa/)
  })
  it('publicada avisa quando há movimento novo sem classificar', () => {
    const d = parceria({
      situacao_publicacao: 'Aprovado',
      lancamentos_sem_classificacao: [
        {
          id_lancamento: 1,
          numero: 1,
          data: null,
          historico: null,
          natureza: 'RECEBIMENTO',
          natureza_rotulo: 'Recebimento',
          valor: 10,
        },
      ],
    })
    expect(proximoPassoDaParceria(d)).toMatch(/1 lançamento\(s\) novo\(s\)/)
    expect(
      proximoPassoDaParceria(parceria({ situacao_publicacao: 'Aprovado' })),
    ).toMatch(/Publicada no site/)
  })
  it('retirada pode ser reaberta', () => {
    expect(
      proximoPassoDaParceria(parceria({ situacao_publicacao: 'Retirado' })),
    ).toMatch(/Reabra/)
  })
})

describe('ResumoFinanceiro e pendências', () => {
  it('mostra os quatro números e diz que vêm do livro-caixa', async () => {
    const { container } = render(<ResumoFinanceiro d={parceria()} />)
    expect(screen.getByText('Valor da parceria')).toBeInTheDocument()
    expect(screen.getByText('Recebido')).toBeInTheDocument()
    expect(screen.getByText(/lidos do livro-caixa/)).toBeInTheDocument()
    expect(screen.getByText(/PARC-0007/)).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('pendência trava (vermelho) e aviso informa (amarelo); sem nenhum, não renderiza', async () => {
    const vazio = render(<PendenciasDaParceria d={parceria()} />)
    expect(vazio.container).toBeEmptyDOMElement()
    vazio.unmount()

    const { container } = render(
      <PendenciasDaParceria
        d={parceria({
          consistencia: {
            bloqueios: [
              {
                codigo: 'PAGO_ACIMA_DO_RECEBIDO',
                mensagem: 'Pago passa do recebido.',
              },
            ],
            avisos: [
              { codigo: 'RELATORIO_ATRASADO', mensagem: 'Relatório atrasado.' },
            ],
          },
        })}
      />,
    )
    expect(
      screen.getByText('Pendências que impedem a publicação'),
    ).toBeInTheDocument()
    expect(screen.getByText('Pago passa do recebido.')).toBeInTheDocument()
    expect(screen.getByText('Relatório atrasado.')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('FormularioDaParceria', () => {
  it('não envia sem título, objeto e um valor entendível; mostra o motivo', async () => {
    const onSalvar = vi.fn()
    const { container } = render(
      <FormularioDaParceria
        opcoes={opcoes}
        rotuloDoBotao="Cadastrar"
        enviando={false}
        onSalvar={onSalvar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/título/i)
    expect(onSalvar).not.toHaveBeenCalled()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('envia o valor no formato da API (ponto decimal) e campos vazios como null', async () => {
    const usuario = userEvent.setup()
    const onSalvar = vi.fn()
    render(
      <FormularioDaParceria
        opcoes={opcoes}
        rotuloDoBotao="Cadastrar"
        enviando={false}
        onSalvar={onSalvar}
      />,
    )
    await usuario.type(screen.getByLabelText(/^Título/), 'Emenda 55/2026')
    await usuario.type(
      screen.getByLabelText(/^Objeto/),
      'Reforço escolar para crianças.',
    )
    await usuario.type(screen.getByLabelText(/^Valor total/), '50.000,00')
    await usuario.click(screen.getByRole('button', { name: 'Cadastrar' }))
    await waitFor(() => expect(onSalvar).toHaveBeenCalledTimes(1))
    const enviado = onSalvar.mock.calls[0]![0] as Record<string, unknown>
    expect(enviado.valor_total).toBe('50000.00')
    expect(enviado.titulo).toBe('Emenda 55/2026')
    expect(enviado.numero_termo).toBeNull()
    expect(enviado.identificador_unico).toBeNull()
    expect(enviado).not.toHaveProperty('situacao') // só aparece na edição
  })

  it('na edição traz os dados e inclui a situação', async () => {
    const usuario = userEvent.setup()
    const onSalvar = vi.fn()
    render(
      <FormularioDaParceria
        inicial={parceria()}
        opcoes={opcoes}
        rotuloDoBotao="Salvar alterações"
        enviando={false}
        onSalvar={onSalvar}
      />,
    )
    expect(screen.getByLabelText(/^Valor total/)).toHaveValue('50.000,00')
    await usuario.click(
      screen.getByRole('button', { name: 'Salvar alterações' }),
    )
    await waitFor(() => expect(onSalvar).toHaveBeenCalled())
    const enviado = onSalvar.mock.calls[0]![0] as Record<string, unknown>
    expect(enviado.valor_total).toBe('50000.00')
    expect(enviado.situacao).toBe('Proposta')
  })
})

describe('PainelDePublicacao - só aparece o botão de quem pode', () => {
  const executar = vi.fn().mockResolvedValue(true)

  it('gestor de rascunho só vê "Enviar para revisão"', () => {
    render(<PainelDePublicacao d={parceria()} executar={executar} />)
    expect(
      screen.getByRole('button', { name: 'Enviar para revisão' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Aprovar/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Retirar/ }),
    ).not.toBeInTheDocument()
  })

  it('quem aprova vê aprovar e recusar, e aprovar pede confirmação explícita', async () => {
    const usuario = userEvent.setup()
    executar.mockClear()
    const d = parceria({
      situacao_publicacao: 'Em revisão',
      pode_enviar_revisao: false,
      pode_aprovar: true,
    })
    render(<PainelDePublicacao d={d} executar={executar} />)
    await usuario.click(
      screen.getByRole('button', { name: 'Aprovar a publicação' }),
    )
    expect(executar).not.toHaveBeenCalled()
    expect(
      screen.getByText(/passam a ser vistos por qualquer pessoa/),
    ).toBeInTheDocument()
    await usuario.click(
      screen.getByRole('button', { name: 'Confirmar aprovação' }),
    )
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('retirar exige o motivo escrito antes de chamar o servidor', async () => {
    const usuario = userEvent.setup()
    executar.mockClear()
    const d = parceria({
      situacao_publicacao: 'Aprovado',
      pode_enviar_revisao: false,
      pode_retirar: true,
    })
    render(<PainelDePublicacao d={d} executar={executar} />)
    await usuario.click(screen.getByRole('button', { name: 'Retirar do site' }))
    await usuario.type(
      screen.getByLabelText(/Por que sair do site/),
      'Valor informado errado, vamos corrigir.',
    )
    await usuario.click(
      screen.getByRole('button', { name: 'Confirmar retirada' }),
    )
    expect(executar).toHaveBeenCalledTimes(1)
  })
})

describe('SecaoLancamentos', () => {
  const pendente = {
    id_lancamento: 11,
    numero: 11,
    data: '2026-09-01T12:00:00',
    historico: 'Pgto João da Silva oficineiro',
    natureza: 'PAGAMENTO' as const,
    natureza_rotulo: 'Pagamento',
    valor: 1200,
  }

  function renderizar(
    d: ParceriaDetalhe,
    executar = vi.fn().mockResolvedValue(true),
  ) {
    const queryClient = new QueryClient()
    const resultado = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SecaoLancamentos d={d} opcoes={opcoes} executar={executar} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { ...resultado, executar }
  }

  it('sem nada pendente, explica como o movimento chega até aqui', () => {
    renderizar(parceria())
    expect(
      screen.getByText(/lance-o no livro-caixa marcando o centro/),
    ).toBeInTheDocument()
  })

  it('pagamento de equipe exige a função e manda função, nunca o nome', async () => {
    const usuario = userEvent.setup()
    const { executar, container } = renderizar(
      parceria({ lancamentos_sem_classificacao: [pendente] }),
    )
    expect(await axe(container)).toHaveNoViolations()
    await usuario.type(
      screen.getByLabelText(/^Texto público/),
      'Pagamento mensal',
    )
    await usuario.selectOptions(
      screen.getByLabelText('Tipo de pagamento'),
      'EQUIPE',
    )
    await usuario.click(
      screen.getByRole('button', { name: 'Classificar para o site' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /informe a função/,
    )
    expect(executar).not.toHaveBeenCalled()
    await usuario.type(screen.getByLabelText(/^Função/), 'Oficineiro de música')
    await usuario.click(
      screen.getByRole('button', { name: 'Classificar para o site' }),
    )
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('mostra o movimento classificado como o público vai ler, e marca o estornado', () => {
    renderizar(
      parceria({
        lancamentos: [
          {
            id_vinculo: 1,
            id_lancamento: 11,
            natureza: 'PAGAMENTO',
            natureza_rotulo: 'Pagamento',
            categoria: 'EQUIPE',
            categoria_rotulo: 'Equipe',
            descricao_publica: 'Pagamento mensal',
            funcao: 'Oficineiro de música',
            id_parcela: null,
            parcela_numero: null,
            data: '2026-09-01T12:00:00',
            valor: 1200,
            historico: 'Pgto João da Silva',
            estornado: true,
            fornecedor: null,
          },
        ],
      }),
    )
    expect(
      screen.getByText(/“Pagamento mensal” — função: Oficineiro de música/),
    ).toBeInTheDocument()
    expect(screen.getByText('Estornado: fora do site')).toBeInTheDocument()
    // o histórico interno (que tem o nome) não é mostrado no bloco "No site"
    expect(screen.queryByText(/João da Silva/)).not.toBeInTheDocument()
  })
})
