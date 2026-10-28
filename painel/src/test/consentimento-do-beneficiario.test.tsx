import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConsentimentoDoBeneficiario } from '@/components/privacidade/ConsentimentoDoBeneficiario'
import type * as api from '@/lib/api'
import * as consentimentos from '@/lib/consentimentos'

vi.mock('@/lib/consentimentos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/consentimentos')>()),
  obterTermoDaTela: vi.fn(),
  registrarConsentimentoDoBeneficiario: vi.fn(),
  revogarConsentimentoDoBeneficiario: vi.fn(),
}))

const beneficiario = (
  extra: Partial<api.Beneficiario> = {},
): api.Beneficiario => ({
  id_beneficiario: 7,
  id_pessoa: 70,
  nome_completo: 'Ana Souza',
  data_nascimento: '1990-05-10T00:00:00',
  consentimento_lgpd_registrado: false,
  consentimento: null,
  observacao_consentimento: null,
  ...extra,
})

const vigente: consentimentos.ResumoDoConsentimento = {
  id_consentimento: 3,
  termo: 'ATENDIMENTO_SOCIAL',
  versao: '2',
  titular: 'Ana Souza',
  dado_por: 'responsavel',
  nome_responsavel: 'Joana da Silva',
  vinculo_responsavel: 'mae',
  vinculo_rotulo: 'Mãe',
  meio: 'termo_em_papel',
  meio_rotulo: 'Termo assinado em papel, guardado pela secretaria',
  id_documento: null,
  dado_em: '2026-10-20T12:00:00',
  origem: 'beneficiario',
  origem_rotulo: 'Atendimento social do beneficiário',
  id_origem: 7,
  encerrado_em: null,
  encerramento: null,
  encerramento_rotulo: null,
  motivo_encerramento: null,
  versao_atual_do_termo: '2',
}

function desenhar(b: api.Beneficiario) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={cliente}>
      <ConsentimentoDoBeneficiario beneficiario={b} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(consentimentos.obterTermoDaTela).mockResolvedValue({
    termo: 'ATENDIMENTO_SOCIAL',
    nome: 'Termo de consentimento do atendimento social',
    versao: '2',
    texto: 'Texto do termo.',
    meios: [
      {
        codigo: 'termo_em_papel',
        rotulo: 'Termo assinado em papel, guardado pela secretaria',
      },
    ],
  } as Awaited<ReturnType<typeof consentimentos.obterTermoDaTela>>)
  vi.mocked(
    consentimentos.registrarConsentimentoDoBeneficiario,
  ).mockResolvedValue(vigente)
  vi.mocked(
    consentimentos.revogarConsentimentoDoBeneficiario,
  ).mockResolvedValue(vigente)
})

describe('menorDeIdade', () => {
  const hoje = new Date(2026, 9, 27)
  it('conta os 18 anos pelo dia do aniversário', () => {
    expect(consentimentos.menorDeIdade('2008-10-28', hoje)).toBe(true)
    expect(consentimentos.menorDeIdade('2008-10-27', hoje)).toBe(false)
    expect(consentimentos.menorDeIdade('2016-01-01T00:00:00', hoje)).toBe(true)
    expect(consentimentos.menorDeIdade(null, hoje)).toBe(false)
  })
})

describe('Consentimento do atendimento social', () => {
  it('sem consentimento avisa que o prontuário não grava; passa no axe', async () => {
    const { container } = desenhar(beneficiario())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'o prontuário e o encaminhamento deste beneficiário não gravam',
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  it('mostra quem consentiu pela criança, o vínculo e a versão do termo', () => {
    desenhar(
      beneficiario({
        consentimento_lgpd_registrado: true,
        consentimento: vigente,
      }),
    )
    const linha = document.querySelector('[data-consentimento-vigente]')
    expect(linha).toHaveTextContent('termo versão 2')
    expect(linha).toHaveTextContent('dado por Joana da Silva (Mãe)')
    expect(linha).toHaveTextContent('assinado em 20/10/2026')
  })

  it('criança: a própria pessoa não pode consentir e o responsável exige nome e vínculo', async () => {
    const user = userEvent.setup()
    desenhar(beneficiario({ data_nascimento: '2016-03-01T00:00:00' }))
    expect(
      screen.getByText(/menos de 18 anos na data da assinatura/),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Registrar o termo assinado' }),
    )
    expect(
      screen.getByRole('radio', { name: 'A própria pessoa atendida' }),
    ).toBeDisabled()
    await user.click(
      screen.getByRole('radio', { name: 'Um dos pais ou o responsável legal' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Registrar o consentimento' }),
    )
    expect(
      screen.getByText(
        'Informe o nome de quem consentiu pela pessoa atendida.',
      ),
    ).toBeInTheDocument()
    await user.type(
      screen.getByLabelText('Nome de quem consentiu'),
      'Joana da Silva',
    )
    await user.click(
      screen.getByRole('button', { name: 'Registrar o consentimento' }),
    )
    expect(
      screen.getByText('Informe o vínculo (mãe, pai ou responsável legal).'),
    ).toBeInTheDocument()
    expect(
      consentimentos.registrarConsentimentoDoBeneficiario,
    ).not.toHaveBeenCalled()

    await user.selectOptions(
      screen.getByLabelText('Vínculo com a pessoa atendida'),
      'mae',
    )
    await user.selectOptions(
      await screen.findByLabelText('Como a autorização foi dada'),
      'termo_em_papel',
    )
    fireEvent.change(
      screen.getByLabelText('Data em que o termo foi assinado'),
      {
        target: { value: '2026-10-20' },
      },
    )
    await user.click(
      screen.getByRole('button', { name: 'Registrar o consentimento' }),
    )
    await waitFor(() =>
      expect(
        consentimentos.registrarConsentimentoDoBeneficiario,
      ).toHaveBeenCalledWith(7, {
        dado_por: 'responsavel',
        nome_responsavel: 'Joana da Silva',
        vinculo: 'mae',
        meio: 'termo_em_papel',
        id_documento: null,
        assinado_em: '2026-10-20',
        versao_do_termo: '2',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Consentimento registrado',
    )
  })

  it('sem a data de nascimento não deixa registrar (é ela que diz quem consente)', () => {
    desenhar(beneficiario({ data_nascimento: null }))
    expect(document.querySelector('[data-sem-nascimento]')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Registrar o termo assinado' }),
    ).not.toBeInTheDocument()
  })

  it('a marca antiga do cadastro não abre o prontuário: pede o termo e mostra a anotação', () => {
    desenhar(
      beneficiario({
        consentimento: {
          ...vigente,
          versao: '1',
          dado_por: null,
          nome_responsavel: null,
          vinculo_responsavel: null,
          vinculo_rotulo: null,
          meio: 'declaracao_antiga',
        },
        observacao_consentimento: 'Colhido em papel em 2025.',
      }),
    )
    const alerta = document.querySelector('[data-so-marca-antiga]')
    expect(alerta).toHaveTextContent('Só a marca antiga do cadastro')
    expect(alerta).toHaveTextContent('Colhido em papel em 2025.')
    expect(
      screen.getByRole('button', { name: 'Registrar o termo assinado' }),
    ).toBeInTheDocument()
  })

  it('adulto: pelo responsável, só o responsável legal (curatela)', async () => {
    const user = userEvent.setup()
    desenhar(beneficiario())
    await user.click(
      screen.getByRole('button', { name: 'Registrar o termo assinado' }),
    )
    await user.click(
      screen.getByRole('radio', { name: 'Um dos pais ou o responsável legal' }),
    )
    const opcoes = Array.from(
      (
        screen.getByLabelText(
          'Vínculo com a pessoa atendida',
        ) as HTMLSelectElement
      ).options,
    ).map((o) => o.value)
    expect(opcoes).toEqual(['', 'responsavel_legal'])
  })

  it('revogar pede confirmação e envia o motivo', async () => {
    const user = userEvent.setup()
    desenhar(
      beneficiario({
        consentimento_lgpd_registrado: true,
        consentimento: vigente,
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Revogar o consentimento' }),
    )
    expect(
      consentimentos.revogarConsentimentoDoBeneficiario,
    ).not.toHaveBeenCalled()
    await user.type(
      screen.getByLabelText('Motivo da revogação (opcional)'),
      'A mãe pediu.',
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirmar a revogação' }),
    )
    expect(
      consentimentos.revogarConsentimentoDoBeneficiario,
    ).toHaveBeenCalledWith(7, 'A mãe pediu.')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Consentimento revogado',
    )
  })
})
