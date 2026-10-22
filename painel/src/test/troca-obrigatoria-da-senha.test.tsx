import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequireMfa, RequireSenhaDefinitiva } from '@/App'
import * as api from '@/lib/api'
import { criarQueryClient } from '@/lib/query-client'
import { TrocarSenhaObrigatoria } from '@/pages/TrocarSenhaObrigatoria'

// Achado da v6.2d: a tela "Conceder acesso" promete que o associado é obrigado a trocar a senha provisória no primeiro login. A guarda leva o
// painel inteiro para a tela de troca enquanto o `/auth/me` disser `senha_provisoria` (antes até do MFA obrigatório).
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  me: vi.fn(),
  alterarSenha: vi.fn(),
  logout: vi.fn(),
}))
const sairDoContexto = vi.fn()
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isBootstrapping: false,
    signIn: vi.fn(),
    signOut: sairDoContexto,
  }),
}))

function eu(extra: Partial<api.Me> = {}): api.Me {
  return {
    id_usuario: 7,
    id_associado: 7,
    nome_completo: 'Associada Nova',
    email: 'nova@exemplo.com.br',
    nivel: 'Associado',
    mfa_ativado: false,
    mfa_obrigatorio: false,
    mfa_pendente: false,
    permissoes: [],
    ...extra,
  }
}

function desenhar(inicio: string) {
  const cliente = criarQueryClient()
  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[inicio]}>
        <Routes>
          <Route path="/trocar-senha" element={<TrocarSenhaObrigatoria />} />
          <Route path="/mfa/setup" element={<p>Configurar MFA</p>} />
          <Route
            path="/"
            element={
              <RequireSenhaDefinitiva>
                <RequireMfa>
                  <p>Início do painel</p>
                </RequireMfa>
              </RequireSenhaDefinitiva>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.me).mockReset()
  vi.mocked(api.alterarSenha).mockReset()
  vi.mocked(api.logout).mockReset()
  sairDoContexto.mockReset()
})

describe('troca obrigatória da senha provisória', () => {
  it('com a senha provisória, o painel leva à troca (antes do MFA obrigatório)', async () => {
    vi.mocked(api.me).mockResolvedValue(
      eu({ senha_provisoria: true, mfa_pendente: true }),
    )
    desenhar('/')
    expect(
      await screen.findByRole('heading', { name: 'Troque a sua senha' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Início do painel')).not.toBeInTheDocument()
    expect(screen.queryByText('Configurar MFA')).not.toBeInTheDocument()
  })

  it('sem a senha provisória (ou com a API antiga, sem o campo), o painel abre normalmente', async () => {
    vi.mocked(api.me).mockResolvedValue(eu())
    desenhar('/')
    expect(await screen.findByText('Início do painel')).toBeInTheDocument()
  })

  it('confere a senha nova antes de mandar: mínimo, confirmação e diferente da provisória', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.me).mockResolvedValue(eu({ senha_provisoria: true }))
    desenhar('/trocar-senha')
    await usuario.type(screen.getByLabelText('Senha provisória'), 'Provisoria1')
    await usuario.type(screen.getByLabelText('Senha nova'), 'curta')
    await usuario.type(screen.getByLabelText('Repita a senha nova'), 'curta')
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A senha nova deve ter pelo menos 8 caracteres.',
    )

    await usuario.clear(screen.getByLabelText('Senha nova'))
    await usuario.type(screen.getByLabelText('Senha nova'), 'Provisoria1')
    await usuario.clear(screen.getByLabelText('Repita a senha nova'))
    await usuario.type(
      screen.getByLabelText('Repita a senha nova'),
      'Provisoria1',
    )
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A senha nova precisa ser diferente da provisória.',
    )

    await usuario.clear(screen.getByLabelText('Repita a senha nova'))
    await usuario.type(
      screen.getByLabelText('Repita a senha nova'),
      'Outra12345',
    )
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'As senhas novas não conferem.',
    )
    expect(api.alterarSenha).not.toHaveBeenCalled()
  })

  it('trocou: o painel abre (sem voltar para a troca); o erro do servidor aparece na tela', async () => {
    const usuario = userEvent.setup()
    // o caminho de verdade: entra pelo início, a guarda leva à troca (o 'me' fica guardado com senha_provisoria), troca e volta ao início
    vi.mocked(api.me).mockResolvedValue(eu({ senha_provisoria: true }))
    vi.mocked(api.alterarSenha)
      .mockRejectedValueOnce(new api.ApiError(400, 'Senha atual incorreta.'))
      .mockImplementation(async () => {
        vi.mocked(api.me).mockResolvedValue(eu({ senha_provisoria: false }))
        return { mensagem: 'Senha alterada com sucesso.' }
      })
    desenhar('/')
    await screen.findByRole('heading', { name: 'Troque a sua senha' })
    await usuario.type(screen.getByLabelText('Senha provisória'), 'Errada123')
    await usuario.type(screen.getByLabelText('Senha nova'), 'MinhaSenha9')
    await usuario.type(
      screen.getByLabelText('Repita a senha nova'),
      'MinhaSenha9',
    )
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Senha atual incorreta.',
    )

    await usuario.clear(screen.getByLabelText('Senha provisória'))
    await usuario.type(screen.getByLabelText('Senha provisória'), 'Provisoria1')
    await usuario.click(screen.getByRole('button', { name: 'Trocar a senha' }))
    expect(await screen.findByText('Início do painel')).toBeInTheDocument()
    expect(api.alterarSenha).toHaveBeenLastCalledWith({
      senha_atual: 'Provisoria1',
      senha_nova: 'MinhaSenha9',
    })
  })

  it('quem abre a tela de troca sem a senha provisória volta ao início', async () => {
    vi.mocked(api.me).mockResolvedValue(eu())
    desenhar('/trocar-senha')
    expect(await screen.findByText('Início do painel')).toBeInTheDocument()
  })

  it('"Sair" encerra a sessão no servidor e no painel', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.me).mockResolvedValue(eu({ senha_provisoria: true }))
    vi.mocked(api.logout).mockResolvedValue(undefined)
    desenhar('/trocar-senha')
    await usuario.click(screen.getByRole('button', { name: 'Sair' }))
    await waitFor(() => expect(sairDoContexto).toHaveBeenCalled())
    expect(api.logout).toHaveBeenCalled()
  })
})

describe('ativação obrigatória do MFA', () => {
  it('ao concluir, o painel abre (sem voltar para a ativação com a cópia velha do /auth/me)', async () => {
    const { MfaSetup } = await import('@/pages/MfaSetup')
    const usuario = userEvent.setup()
    vi.spyOn(api, 'mfaAtivar').mockResolvedValue({
      otpauth_uri: 'otpauth://totp/ASAF:teste?secret=JBSWY3DPEHPK3PXP',
    })
    vi.spyOn(api, 'mfaConfirmar').mockImplementation(async () => {
      vi.mocked(api.me).mockResolvedValue(eu({ mfa_pendente: false }))
      return { mensagem: 'ok', codigos_recuperacao: ['AAAA-1111'] }
    })
    vi.mocked(api.me).mockResolvedValue(eu({ mfa_pendente: true }))
    const cliente = criarQueryClient()
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/mfa/setup" element={<MfaSetup />} />
            <Route
              path="/"
              element={
                <RequireMfa>
                  <p>Início do painel</p>
                </RequireMfa>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: 'Ativação obrigatória de MFA' })
    await usuario.type(
      screen.getByLabelText('Código do autenticador'),
      '123456',
    )
    await usuario.click(screen.getByRole('button', { name: 'Confirmar' }))
    await usuario.click(
      await screen.findByRole('button', {
        name: 'Guardei os códigos — concluir',
      }),
    )
    expect(await screen.findByText('Início do painel')).toBeInTheDocument()
  })
})
