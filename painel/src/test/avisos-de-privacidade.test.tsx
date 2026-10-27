import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LerAviso } from '@/components/privacidade/LerAviso'
import * as privacidade from '@/lib/privacidade'
import { AvisosDePrivacidadePage } from '@/pages/AvisosDePrivacidade'

vi.mock('@/lib/privacidade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacidade')>()),
  obterTextosDePrivacidade: vi.fn(),
  lerAvisoDeUmaVersao: vi.fn(),
}))

const versao = (
  extra: Partial<privacidade.VersaoDeAviso>,
): privacidade.VersaoDeAviso => ({
  versao: '1',
  vigente_desde: '2026-10-08',
  texto: 'Texto [com link](/privacidade/).',
  texto_sem_links: 'Texto com link.',
  impressao: 'a'.repeat(64),
  reconstituido: false,
  observacao: null,
  registrado_em: '2026-10-27T12:00:00',
  diverge_do_codigo: false,
  tipo: 'aviso',
  caixa: 'Li o aviso de privacidade.',
  ...extra,
})

function desenhar(no: React.ReactNode) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>{no}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Avisos de privacidade (v7.1a)', () => {
  it('cada formulário com o tipo, a base legal e as versões; o texto antigo e o divergente aparecem; passa no axe', async () => {
    vi.mocked(privacidade.obterTextosDePrivacidade).mockResolvedValue({
      pontos: [
        {
          codigo: 'FILIACAO',
          nome: 'Pedido de filiação pelo site',
          tipo: 'aviso',
          onde: 'site: Seja associado',
          caixa: 'Li o aviso de privacidade.',
          atividade: 'CADASTRO',
          atividade_nome: 'Cadastro e vida associativa',
          bases_legais: [
            { codigo: 'ART7_V', texto: 'Art. 7º, V — execução de contrato' },
          ],
          versao_atual: '3',
          versoes: [
            versao({ versao: '3', texto_sem_links: 'Texto da versão 3.' }),
            versao({
              versao: '2',
              texto_sem_links: 'Pedidos recusados ficam guardados.',
              reconstituido: true,
              observacao: 'A versão 3 corrige o aviso.',
              diverge_do_codigo: true,
              caixa: 'Li o aviso e concordo com o uso dos meus dados.',
            }),
          ],
        },
      ],
    })
    const { container } = desenhar(<AvisosDePrivacidadePage />)
    const ponto = await screen.findByRole('region', {
      name: 'Pedido de filiação pelo site',
    })
    expect(
      within(ponto).getByText('Aviso (não é consentimento)'),
    ).toBeInTheDocument()
    expect(
      within(ponto).getByText('Art. 7º, V — execução de contrato'),
    ).toBeInTheDocument()
    expect(within(ponto).getByText('Texto da versão 3.')).toBeVisible()
    expect(
      within(ponto).getByText(/Versão 2, desde 08\/10\/2026.*reconstituída/),
    ).toBeInTheDocument()
    expect(within(ponto).getByRole('alert')).toHaveTextContent(
      'vale o texto gravado',
    )
    expect(
      within(ponto).getByText(/a caixa dizia: “Li o aviso e concordo/),
    ).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('"Ler o aviso desta versão" mostra o texto EXATO daquela versão e diz qual vale hoje', async () => {
    vi.mocked(privacidade.lerAvisoDeUmaVersao).mockResolvedValue({
      ...versao({
        versao: '2',
        texto_sem_links: 'Pedidos recusados ou sem andamento ficam guardados.',
      }),
      codigo: 'FILIACAO',
      nome: 'Pedido de filiação pelo site',
      versao_atual: '3',
      caixa: 'Li o aviso e concordo com o uso dos meus dados.',
    })
    desenhar(<LerAviso ponto="FILIACAO" versao="2" />)
    expect(privacidade.lerAvisoDeUmaVersao).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: 'Ler o aviso desta versão' }),
    )
    const aviso = await screen.findByTestId('aviso-da-versao')
    expect(
      await within(aviso).findByText(
        'Pedidos recusados ou sem andamento ficam guardados.',
      ),
    ).toBeInTheDocument()
    expect(aviso).toHaveTextContent('versão 2')
    expect(aviso).toHaveTextContent('hoje vale a versão 3')
    expect(aviso).toHaveTextContent(
      'A pessoa marcou a caixa: “Li o aviso e concordo com o uso dos meus dados.”',
    )
    expect(privacidade.lerAvisoDeUmaVersao).toHaveBeenCalledWith(
      'FILIACAO',
      '2',
    )
  })
})
