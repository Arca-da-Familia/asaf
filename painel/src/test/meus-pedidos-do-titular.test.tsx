import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MeusPedidosDoTitular } from '@/components/privacidade/MeusPedidosDoTitular'
import * as privacidade from '@/lib/privacidade'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterMeusPedidosDoTitular: vi.fn(),
  fazerPedidoDoTitular: vi.fn(),
  baixarMeuRelatorio: vi.fn(),
}))

// v7.2e - "Meus dados pessoais" no Meu Perfil: o pedido sobre os próprios dados feito de dentro do painel, a resposta e o relatório baixados ali
const DADOS: privacidade.MeusPedidosDoTitular = {
  aviso: {
    ponto: 'ATENDIMENTO_TITULAR',
    versao: '2',
    texto: 'Usamos o que você escrever só para responder ao seu pedido.',
  },
  email: 'joana@exemplo.com',
  direitos: [
    {
      codigo: 'ACESSO',
      rotulo: 'Acessar os dados que a associação tem sobre mim',
    },
    { codigo: 'ELIMINACAO', rotulo: 'Anonimizar ou eliminar dados meus' },
  ],
  pedidos: [
    {
      protocolo: 'ASAF-2026-00070',
      o_que_pediu: 'Acessar os dados que a associação tem sobre mim',
      situacao: 'Respondido',
      pedido_em: '2026-10-20T12:00:00',
      prazo_em: '2026-11-04T12:00:00',
      respondido_em: '2026-10-22T12:00:00',
      resposta: 'O relatório está liberado para você.',
      encerrado_em: null,
      motivo_do_encerramento: null,
      resultado: 'Atendido',
      fundamento: null,
      relatorio_disponivel_ate: '2026-11-06T12:00:00',
    },
  ],
}

function desenhar() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MeusPedidosDoTitular />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(privacidade.obterMeusPedidosDoTitular).mockResolvedValue(DADOS)
})

describe('Meus dados pessoais', () => {
  it('mostra o formulário, o aviso e os pedidos com a resposta e o relatório; passa no axe', async () => {
    const { container } = desenhar()
    const lista = await screen.findByRole('region', {
      name: 'Meus pedidos sobre dados pessoais',
    })
    const pedido = within(lista).getByText(
      /Protocolo ASAF-2026-00070/,
    ).parentElement!
    expect(pedido).toHaveTextContent('O relatório está liberado para você.')
    expect(pedido).toHaveTextContent('Atendido')
    expect(pedido).toHaveTextContent('disponível até 06/11/2026')
    expect(
      screen.getByText(/Usamos o que você escrever/, { exact: false }),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('confere o que falta antes de enviar e manda o direito, a mensagem e a versão do aviso', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.fazerPedidoDoTitular).mockResolvedValue({
      protocolo: 'ASAF-2026-00071',
      prazo_dias: 15,
      prazo_em: '2026-11-13T12:00:00',
      ja_existia: false,
      situacao: 'Novo',
      identidade_validada: false,
    })
    desenhar()
    const enviar = await screen.findByRole('button', {
      name: 'Enviar o pedido',
    })
    await u.click(enviar)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Escolha o que você quer pedir.',
    )
    await u.selectOptions(
      screen.getByLabelText('O que você quer pedir'),
      'ELIMINACAO',
    )
    await u.type(
      screen.getByLabelText('Explique o seu pedido'),
      'Quero que apaguem o que não for obrigatório guardar.',
    )
    await u.click(enviar)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Leia o aviso de privacidade',
    )
    await u.click(
      screen.getByRole('checkbox', { name: 'Li o aviso de privacidade' }),
    )
    await u.click(enviar)
    expect(privacidade.fazerPedidoDoTitular).toHaveBeenCalledWith({
      subtipo: 'ELIMINACAO',
      mensagem: 'Quero que apaguem o que não for obrigatório guardar.',
      aviso_lido: true,
      versao_do_aviso: '2',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Pedido ASAF-2026-00071 recebido. Prazo de resposta: até 13/11/2026. Como a sua conta ainda não tem o segundo passo ligado',
    )
  })

  it('os botões do relatório baixam o PDF e o arquivo', async () => {
    const u = userEvent.setup()
    vi.mocked(privacidade.baixarMeuRelatorio).mockResolvedValue()
    desenhar()
    await u.click(
      await screen.findByRole('button', { name: 'Baixar o relatório (PDF)' }),
    )
    expect(privacidade.baixarMeuRelatorio).toHaveBeenCalledWith(
      'ASAF-2026-00070',
      'pdf',
    )
    await u.click(
      screen.getByRole('button', {
        name: 'Baixar os dados em arquivo (para levar a outro serviço)',
      }),
    )
    expect(privacidade.baixarMeuRelatorio).toHaveBeenCalledWith(
      'ASAF-2026-00070',
      'json',
    )
  })
})
