import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as consentimentos from '@/lib/consentimentos'
import { ConsentimentosPage } from '@/pages/Consentimentos'

vi.mock('@/lib/consentimentos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/consentimentos')>()),
  obterConsentimentos: vi.fn(),
}))

const consentimento = (
  extra: Partial<consentimentos.ResumoDoConsentimento> = {},
): consentimentos.ResumoDoConsentimento => ({
  id_consentimento: 1,
  termo: 'IMAGEM_ATIVIDADE',
  versao: '2',
  titular: 'Joana da Silva',
  dado_por: null,
  meio: 'termo_em_papel',
  meio_rotulo: 'Termo assinado em papel, guardado pela secretaria',
  id_documento: null,
  dado_em: '2026-10-27T12:00:00',
  origem: 'foto_de_evento',
  origem_rotulo: 'Foto de evento',
  id_origem: 5,
  encerrado_em: null,
  encerramento: null,
  encerramento_rotulo: null,
  motivo_encerramento: null,
  versao_atual_do_termo: '2',
  ...extra,
})

function desenhar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <ConsentimentosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('Consentimentos (v7.1b)', () => {
  it('mostra o vigente e o revogado (com o motivo), a versão do termo de cada um; passa no axe', async () => {
    vi.mocked(consentimentos.obterConsentimentos).mockResolvedValue({
      consentimentos: [
        consentimento(),
        consentimento({
          id_consentimento: 2,
          versao: '1',
          titular: 'Pessoas que aparecem na foto (declaração de quem a enviou)',
          meio: 'declaracao_antiga',
          meio_rotulo:
            'Declaração de quem enviou a foto (antes do termo do sistema)',
          encerrado_em: '2026-10-27T15:00:00',
          encerramento: 'revogado',
          encerramento_rotulo: 'Revogado (a pessoa retirou a autorização)',
          motivo_encerramento: 'A mãe pediu por telefone.',
        }),
      ],
      origens: { foto_de_evento: 'Foto de evento' },
      total: 2,
      pagina: 1,
      por_pagina: 50,
    })
    const { container } = desenhar()
    const vigente = (await screen.findByText(/Foto de evento nº 5 · Joana/))
      .parentElement!
    expect(within(vigente).getByText('Vigente')).toBeInTheDocument()
    const revogado = screen.getByText(
      /Pessoas que aparecem na foto/,
    ).parentElement!
    expect(revogado).toHaveTextContent(
      /Revogado \(a pessoa retirou a autorização\) em .*: A mãe pediu por telefone\./,
    )
    expect(revogado).toHaveTextContent('Termo versão 1 (hoje vale a 2)')
    expect(revogado).toHaveTextContent('declarado em')
    expect(vigente).toHaveTextContent('assinado em 27/10/2026')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('os filtros, a busca pelo nome e as páginas pedem ao servidor só o que foi escolhido', async () => {
    vi.mocked(consentimentos.obterConsentimentos).mockResolvedValue({
      consentimentos: [],
      origens: { foto_de_evento: 'Foto de evento' },
      total: 0,
      pagina: 1,
      por_pagina: 50,
    })
    desenhar()
    await screen.findByText('Nenhum consentimento com estes filtros.')
    await userEvent.selectOptions(
      screen.getByLabelText('Situação'),
      'encerrados',
    )
    await userEvent.selectOptions(
      screen.getByLabelText('O que ele cobre'),
      'foto_de_evento',
    )
    await userEvent.type(screen.getByLabelText('Nome de quem assinou'), 'Joana')
    expect(consentimentos.obterConsentimentos).toHaveBeenLastCalledWith(
      'encerrados',
      'foto_de_evento',
      'Joana',
      1,
    )
  })

  it('com mais de uma página, "Próxima página" pede a seguinte', async () => {
    vi.mocked(consentimentos.obterConsentimentos).mockResolvedValue({
      consentimentos: [consentimento()],
      origens: {},
      total: 120,
      pagina: 1,
      por_pagina: 50,
    })
    desenhar()
    expect(
      await screen.findByText('120 consentimento(s) · página 1 de 3'),
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Próxima página' }),
    )
    expect(consentimentos.obterConsentimentos).toHaveBeenLastCalledWith(
      '',
      '',
      '',
      2,
    )
  })
})
