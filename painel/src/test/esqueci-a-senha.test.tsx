import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { EsqueciASenha } from '@/pages/EsqueciASenha'

// Esqueci a minha senha (pedido do Presidente em 21/10): CPF → código por e-mail → senha nova.
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  pedirCodigoDeNovaSenha: vi.fn(),
  trocarSenhaComCodigo: vi.fn(),
}))

const CPF = '529.982.247-25'
const MENSAGEM =
  'Se este CPF tiver acesso ao painel, enviamos um código de 6 números para o e-mail cadastrado.'

function desenhar() {
  return render(
    <MemoryRouter>
      <EsqueciASenha />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.mocked(api.pedirCodigoDeNovaSenha).mockReset()
  vi.mocked(api.trocarSenhaComCodigo).mockReset()
})

describe('Esqueci a minha senha', () => {
  it('CPF inválido nem pede o código', async () => {
    const usuario = userEvent.setup()
    desenhar()
    await usuario.type(screen.getByLabelText('CPF'), '11111111111')
    await usuario.click(screen.getByRole('button', { name: 'Enviar o código' }))
    expect(screen.getByRole('alert')).toHaveTextContent('CPF inválido')
    expect(api.pedirCodigoDeNovaSenha).not.toHaveBeenCalled()
  })

  it('pede o código, confere a senha nova e troca', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.pedirCodigoDeNovaSenha).mockResolvedValue({
      mensagem: MENSAGEM,
    })
    vi.mocked(api.trocarSenhaComCodigo)
      .mockRejectedValueOnce(
        new api.ApiError(
          400,
          'Código inválido ou vencido: confira os números ou peça um novo código.',
        ),
      )
      .mockResolvedValue({ mensagem: 'Senha trocada.' })
    desenhar()
    await usuario.type(screen.getByLabelText('CPF'), CPF)
    await usuario.click(screen.getByRole('button', { name: 'Enviar o código' }))
    expect(api.pedirCodigoDeNovaSenha).toHaveBeenCalledWith('52998224725')
    expect(await screen.findByRole('status')).toHaveTextContent(MENSAGEM)
    expect(screen.queryByTestId('codigo-de-teste')).not.toBeInTheDocument()

    await usuario.type(
      screen.getByLabelText('Código recebido por e-mail'),
      '123456',
    )
    await usuario.type(screen.getByLabelText('Senha nova'), 'curta')
    await usuario.type(screen.getByLabelText('Repita a senha nova'), 'curta')
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(screen.getByRole('alert')).toHaveTextContent('pelo menos 8')

    await usuario.clear(screen.getByLabelText('Senha nova'))
    await usuario.type(screen.getByLabelText('Senha nova'), 'MinhaSenha9')
    await usuario.clear(screen.getByLabelText('Repita a senha nova'))
    await usuario.type(
      screen.getByLabelText('Repita a senha nova'),
      'MinhaSenha9',
    )
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Código inválido ou vencido',
    )

    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Senha trocada.',
    )
    expect(api.trocarSenhaComCodigo).toHaveBeenLastCalledWith({
      cpf: '52998224725',
      codigo: '123456',
      senha_nova: 'MinhaSenha9',
    })
  })

  it('na homologação (o servidor devolve o código), a tela mostra o código de teste', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.pedirCodigoDeNovaSenha).mockResolvedValue({
      mensagem: MENSAGEM,
      codigo_de_teste: '654321',
    })
    desenhar()
    await usuario.type(screen.getByLabelText('CPF'), CPF)
    await usuario.click(screen.getByRole('button', { name: 'Enviar o código' }))
    expect(await screen.findByTestId('codigo-de-teste')).toHaveTextContent(
      '654321',
    )
  })
})
