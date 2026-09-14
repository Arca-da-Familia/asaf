import { z } from 'zod'

import { clearSession, getAccessToken, setAccessToken } from './auth'
import { finalizarRequisicao, iniciarRequisicao } from './network-status'
import { meResponseSchema, perfilResponseSchema } from './schemas'

// Em produção, aponte para a origem da API (mesmo site do painel para o cookie SameSite=Strict
// funcionar — ex.: https://api.asaf.org.br). Em dev, deixe vazio: o Vite faz proxy de /auth.
const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

type ErrorPayload = {
  detail?: string | { loc: (string | number)[]; msg: string; type: string }[]
}

export type ErroCampo422 = { campo: string; mensagem: string }

export class ApiError extends Error {
  status: number
  detail: string
  retryAfter?: number
  errosCampos: ErroCampo422[]

  constructor(
    status: number,
    detail: string,
    errosCampos: ErroCampo422[] = [],
    retryAfter?: number,
  ) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.errosCampos = errosCampos
    this.retryAfter = retryAfter
  }
}

// Envolve toda chamada de rede do painel (v0.2.7): alimenta o `network-status` para o
// `StatusBar` mostrar "acordando o servidor" (scale-to-zero) ou "sem conexão", sem duplicar
// essa lógica nos três pontos que hoje chamam `fetch` diretamente.
async function fetchInstrumentado(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  iniciarRequisicao()
  try {
    const res = await fetch(input, init)
    finalizarRequisicao(true)
    return res
  } catch (erro) {
    finalizarRequisicao(false)
    throw erro
  }
}

// Teste de contrato (v0.2.8): valida a resposta contra o schema Zod ANTES do resto do painel
// confiar no formato. Se o backend renomear/remover um campo, quebra aqui — com mensagem
// específica de qual campo — em vez de um `undefined` silencioso estourando em algum componente
// três telas depois.
function validarResposta<T>(
  schema: z.ZodType<T>,
  dados: unknown,
  origem: string,
): T {
  const resultado = schema.safeParse(dados)
  if (!resultado.success) {
    throw new Error(
      `Resposta de ${origem} não bate com o contrato esperado: ${resultado.error.issues
        .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
        .join('; ')}`,
    )
  }
  return resultado.data
}

async function parseError(res: Response): Promise<ApiError> {
  let detail = `Erro inesperado (${res.status}).`
  const retryAfter = res.headers.get('retry-after')
  const errosCampos: ErroCampo422[] = []
  try {
    const payload = (await res.json()) as ErrorPayload
    if (Array.isArray(payload.detail)) {
      // Erro 422 do FastAPI: detail é uma lista de { loc, msg, type }. Extrai o campo
      // (loc sem o prefixo "body") para o FormShell mapear de volta no react-hook-form.
      errosCampos.push(
        ...payload.detail.map((d) => ({
          campo: d.loc.filter((p) => p !== 'body').join('.'),
          mensagem: d.msg,
        })),
      )
      detail = errosCampos[0]?.mensagem ?? 'Dados inválidos.'
    } else if (payload.detail) {
      detail = payload.detail
    }
  } catch {
    // corpo sem JSON — mantém a mensagem genérica
  }
  return new ApiError(
    res.status,
    detail,
    errosCampos,
    retryAfter ? Number(retryAfter) : undefined,
  )
}

// ---------------------------------------------------------------------------
// Refresh com fila de espera: nunca dois refresh concorrentes. Enquanto um está
// em voo, as demais requisições 401 aguardam o MESMO Promise.
// ---------------------------------------------------------------------------
let refreshInFlight: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetchInstrumentado(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // envia o cookie HttpOnly do refresh
    })
    if (!res.ok) return false
    const data = (await res.json()) as { access_token?: string }
    if (data.access_token) setAccessToken(data.access_token)
    return true
  } catch {
    return false
  }
}

function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// Chamado uma vez, ao carregar a aplicação (ver AuthProvider): o access token só existe em
// memória e por isso não sobrevive a um F5/fechar-e-abrir aba - sem isto, toda recarga de
// página derrubaria a sessão mesmo com o cookie de refresh (30 dias) ainda válido, o que
// tornaria esse cookie inútil na prática. Reaproveita a mesma fila de espera do interceptor.
export function bootstrapSession(): Promise<boolean> {
  return refreshAccessToken()
}

// ---------------------------------------------------------------------------
// Cliente HTTP único. Injeta Authorization: Bearer, detecta 401, tenta o refresh
// UMA vez e refaz a requisição original. Se o refresh falhar, derruba a sessão.
// ---------------------------------------------------------------------------
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  alreadyRetried = false,
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')

  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetchInstrumentado(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 401) {
    if (!alreadyRetried) {
      const renewed = await refreshAccessToken()
      if (renewed) {
        return apiFetch<T>(path, init, true)
      }
    }
    clearSession()
    throw new ApiError(401, 'Sessão expirada. Faça login novamente.')
  }

  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Endpoints de autenticação — NÃO passam pelo interceptor (401 aqui é credencial
// errada ou refresh ausente, não sessão expirada que deva tentar renovar).
// ---------------------------------------------------------------------------
export type LoginPayload = { cpf: string; senha: string }
export type LoginMfaPayload = {
  cpf: string
  login_temp_token: string
  codigo_totp?: string
  codigo_recuperacao?: string
}

export type TokenPayload = {
  access_token: string
  refresh_token?: string | null
  token_type: string
  expires_in_minutos: number
  requer_mfa: boolean
  login_temp_token?: string | null
}

async function rawFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  const res = await fetchInstrumentado(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function login(payload: LoginPayload): Promise<TokenPayload> {
  return rawFetch<TokenPayload>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loginMfa(payload: LoginMfaPayload): Promise<TokenPayload> {
  return rawFetch<TokenPayload>('/auth/login/mfa', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function logout(): Promise<void> {
  try {
    // O cookie HttpOnly é enviado automaticamente (credentials: include) e a API o revoga.
    await rawFetch('/auth/logout', { method: 'POST', body: '{}' })
  } finally {
    setAccessToken(null)
  }
}

export type Impersonando = {
  id_nivel: number
  nome_nivel: string
  nivel_real: string
}

export type Me = {
  id_usuario: number
  id_associado?: number | null
  nome_completo?: string | null
  email?: string | null
  nivel?: string | null
  mfa_ativado: boolean
  mfa_obrigatorio: boolean
  mfa_pendente: boolean
  permissoes: string[]
  impersonando?: Impersonando | null
}

export async function me(): Promise<Me> {
  const dados = await apiFetch<Me>('/auth/me')
  return validarResposta(meResponseSchema, dados, 'GET /auth/me')
}

export type MfaAtivarResult = { otpauth_uri: string }

export function mfaAtivar(): Promise<MfaAtivarResult> {
  return apiFetch<MfaAtivarResult>('/auth/mfa/ativar', { method: 'POST' })
}

export type MfaConfirmarResult = {
  mensagem: string
  codigos_recuperacao: string[]
}

export function mfaConfirmar(codigoTotp: string): Promise<MfaConfirmarResult> {
  return apiFetch<MfaConfirmarResult>('/auth/mfa/confirmar', {
    method: 'POST',
    body: JSON.stringify({ codigo_totp: codigoTotp }),
  })
}

// ---------------------------------------------------------------------------
// Passkey / WebAuthn (v0.4 - adendo pós-fechamento da FASE 0). `opcoes` é repassado direto
// para @simplewebauthn/browser (startRegistration/startAuthentication) — o formato de verdade
// é o do próprio WebAuthn, não vale duplicar campo a campo aqui.
// ---------------------------------------------------------------------------
export type WebAuthnOpcoes = {
  opcoes: Record<string, unknown>
  desafio_token: string
}

export type WebAuthnCredencial = {
  id_credencial: number
  apelido?: string | null
  criado_em?: string | null
  ultimo_uso_em?: string | null
}

export function webauthnRegistrarIniciar(): Promise<WebAuthnOpcoes> {
  return apiFetch<WebAuthnOpcoes>('/auth/webauthn/registrar/iniciar', {
    method: 'POST',
  })
}

export function webauthnRegistrarConcluir(dados: {
  credencial: Record<string, unknown>
  desafio_token: string
  apelido?: string
}): Promise<WebAuthnCredencial> {
  return apiFetch('/auth/webauthn/registrar/concluir', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function webauthnListarCredenciais(): Promise<WebAuthnCredencial[]> {
  return apiFetch<WebAuthnCredencial[]>('/auth/webauthn/credenciais')
}

export function webauthnRemoverCredencial(
  idCredencial: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/auth/webauthn/credenciais/${idCredencial}`, {
    method: 'DELETE',
  })
}

export function webauthnLoginIniciar(): Promise<WebAuthnOpcoes> {
  return rawFetch<WebAuthnOpcoes>('/auth/webauthn/login/iniciar', {
    method: 'POST',
  })
}

export function webauthnLoginConcluir(dados: {
  credencial: Record<string, unknown>
  desafio_token: string
}): Promise<TokenPayload> {
  return rawFetch<TokenPayload>('/auth/webauthn/login/concluir', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// Meu Perfil (v0.2.5)
// ---------------------------------------------------------------------------
export type Endereco = {
  cep?: string | null
  logradouro?: string | null
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
}

export type Perfil = {
  id_associado?: number | null
  nome_completo?: string | null
  cpf?: string | null
  email_contato?: string | null
  telefone_whatsapp?: string | null
  categoria?: string | null
  status_arrolamento?: string | null
  data_admissao?: string | null
  endereco?: Endereco | null
}

export type PerfilUpdate = {
  email_contato: string
  telefone_whatsapp: string
  cep?: string
  logradouro?: string
  numero?: string
  bairro?: string
  cidade?: string
  estado?: string
}

export type Sessao = {
  id_token: number
  criado_em?: string | null
  ultimo_uso_em?: string | null
  ip_origem?: string | null
  user_agent?: string | null
  is_atual: boolean
}

export type Documento = {
  id_documento: number
  tipo_documento?: string | null
  data_upload?: string | null
}

export async function obterPerfil(): Promise<Perfil> {
  const dados = await apiFetch<Perfil>('/auth/perfil')
  return validarResposta(perfilResponseSchema, dados, 'GET /auth/perfil')
}

export function atualizarPerfil(
  dados: PerfilUpdate,
): Promise<{ mensagem: string }> {
  return apiFetch('/auth/perfil', {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function alterarSenha(dados: {
  senha_atual: string
  senha_nova: string
}): Promise<{ mensagem: string }> {
  return apiFetch('/auth/senha/alterar', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarSessoes(): Promise<Sessao[]> {
  return apiFetch<Sessao[]>('/auth/sessoes')
}

export function revogarSessao(idToken: number): Promise<{ mensagem: string }> {
  return apiFetch(`/auth/sessoes/${idToken}`, { method: 'DELETE' })
}

export function desativarMfa(dados: {
  senha: string
  codigo_totp: string
}): Promise<{ mensagem: string }> {
  return apiFetch('/auth/mfa/desativar', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function regenerarRecuperacao(dados: {
  senha: string
}): Promise<MfaConfirmarResult> {
  return apiFetch('/auth/mfa/recuperacao/regenerar', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarDocumentos(): Promise<Documento[]> {
  return apiFetch<Documento[]>('/auth/me/documentos')
}

// ---------------------------------------------------------------------------
// Ficha 360º (v1.5) — dados, situação financeira resumida, cargos e linha do tempo unificada.
// ---------------------------------------------------------------------------
export type EventoLinhaDoTempo = {
  id_evento: number
  modulo_origem: string
  tipo: string
  titulo: string
  descricao?: string | null
  data_evento: string
}

export type CargoFicha360 = {
  id_historico: number
  titulo_cargo: string
  data_posse?: string | null
  data_saida?: string | null
  atual: boolean
}

export type Ficha360 = {
  dados: {
    id_associado: number
    nome_completo?: string | null
    numero_matricula?: number | null
    categoria?: string | null
    status_arrolamento?: string | null
    data_admissao?: string | null
  }
  situacao_financeira: {
    saldo_devedor_total: number
    quantidade_titulos_pendentes: number
  }
  cargos: CargoFicha360[]
  documentos: Documento[]
  linha_do_tempo: EventoLinhaDoTempo[]
}

export function obterMinhaFicha360(): Promise<Ficha360> {
  return apiFetch<Ficha360>('/auth/me/ficha-360')
}

// ---------------------------------------------------------------------------
// Níveis de acesso e permissões — matriz de administração (v0.2.9)
// ---------------------------------------------------------------------------
export type NivelAcesso = {
  id_nivel: number
  nome_nivel: string
  descricao?: string | null
  is_conselho_fiscal: boolean
  exige_mfa: boolean
  permissoes: number[]
}

export type PermissaoSistema = {
  id_permissao: number
  modulo: string
  codigo_permissao: string
  descricao?: string | null
}

export function listarNiveisAcesso(): Promise<NivelAcesso[]> {
  return apiFetch<NivelAcesso[]>('/api/niveis-acesso/')
}

export function listarPermissoes(): Promise<PermissaoSistema[]> {
  return apiFetch<PermissaoSistema[]>('/api/permissoes/')
}

export function criarNivelAcesso(dados: {
  nome_nivel: string
  descricao?: string
  is_conselho_fiscal?: boolean
  exige_mfa?: boolean
}): Promise<{ id_nivel: number; nome_nivel: string }> {
  return apiFetch('/api/niveis-acesso/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function criarPermissao(dados: {
  modulo: string
  codigo_permissao: string
  descricao?: string
}): Promise<{ id_permissao: number; codigo_permissao: string }> {
  return apiFetch('/api/permissoes/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function atribuirPermissao(
  idNivel: number,
  idPermissao: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/niveis-acesso/${idNivel}/permissoes/${idPermissao}`, {
    method: 'POST',
  })
}

export function removerPermissao(
  idNivel: number,
  idPermissao: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/niveis-acesso/${idNivel}/permissoes/${idPermissao}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Visualizador de auditoria (v0.2.9) — somente leitura, sem exclusão pela interface.
// ---------------------------------------------------------------------------
export type EntradaAuditoria = {
  id_log: number
  id_usuario?: number | null
  nome_usuario?: string | null
  tabela_afetada: string
  id_registro_afetado?: number | null
  acao: string
  dados_antes?: string | null
  dados_depois?: string | null
  ip_origem?: string | null
  timestamp: string
}

export type FiltroAuditoria = {
  id_usuario?: number
  tabela_afetada?: string
  acao?: string
  desde?: string
  ate?: string
  pagina?: number
  por_pagina?: number
}

export type PaginaAuditoria = {
  total: number
  pagina: number
  por_pagina: number
  entradas: EntradaAuditoria[]
}

export function listarAuditoria(
  filtro: FiltroAuditoria = {},
): Promise<PaginaAuditoria> {
  const params = new URLSearchParams()
  for (const [chave, valor] of Object.entries(filtro)) {
    if (valor !== undefined && valor !== '') params.set(chave, String(valor))
  }
  const query = params.toString()
  return apiFetch<PaginaAuditoria>(`/api/auditoria/${query ? `?${query}` : ''}`)
}

export function listarAcoesAuditoria(): Promise<string[]> {
  return apiFetch<string[]>('/api/auditoria/acoes')
}

// ---------------------------------------------------------------------------
// "Ver o sistema como" — impersonação de papel, somente leitura (v0.2.9)
// ---------------------------------------------------------------------------
export type ImpersonarResult = {
  access_token: string
  token_type: string
  expires_in_minutos: number
}

export function iniciarImpersonacao(
  idNivel: number,
): Promise<ImpersonarResult> {
  return apiFetch<ImpersonarResult>(`/auth/impersonar/${idNivel}`, {
    method: 'POST',
  })
}

export function pararImpersonacao(): Promise<ImpersonarResult> {
  return apiFetch<ImpersonarResult>('/auth/impersonar/parar', {
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// Opções de catálogo para preencher seleção (v0.3.1/v0.3.3) — leitura liberada a
// qualquer usuário autenticado, só CRUD de catálogo é restrito a admin.
// ---------------------------------------------------------------------------
export type OpcaoDeCatalogo = {
  id_opcao: number
  id_pai: number | null
  codigo: string
  rotulo: string
  ordem: number
  ativo: boolean
  cor: string | null
  icone: string | null
}

export function listarOpcoesCatalogo(
  chave: string,
): Promise<OpcaoDeCatalogo[]> {
  return apiFetch(`/api/catalogos/${chave}/opcoes`)
}

// ---------------------------------------------------------------------------
// Campos personalizados sem deploy (v0.3.3) — a diretoria acrescenta um campo extra num
// módulo sem precisar de programador; renderizado automaticamente pelo FormShell.
// ---------------------------------------------------------------------------
export type EntidadeCampoPersonalizado =
  'associado' | 'projeto_evento' | 'beneficiario'
export type TipoCampoPersonalizado =
  'texto' | 'numero' | 'data' | 'booleano' | 'selecao' | 'arquivo'

export type DefinicaoCampoPersonalizado = {
  id_definicao: number
  entidade: EntidadeCampoPersonalizado
  rotulo: string
  tipo: TipoCampoPersonalizado
  id_catalogo: number | null
  catalogo_chave: string | null
  obrigatorio: boolean
  ordem: number
}

export function listarDefinicoesCampo(
  entidade: EntidadeCampoPersonalizado,
): Promise<DefinicaoCampoPersonalizado[]> {
  return apiFetch(`/api/campos-personalizados/${entidade}`)
}

export function obterValoresCampo(
  entidade: EntidadeCampoPersonalizado,
  idRegistro: number,
): Promise<Record<number, string | null>> {
  return apiFetch(
    `/api/campos-personalizados/${entidade}/${idRegistro}/valores`,
  )
}

export function definirValoresCampo(
  entidade: EntidadeCampoPersonalizado,
  idRegistro: number,
  valores: { id_definicao: number; valor: string | null }[],
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/campos-personalizados/${entidade}/${idRegistro}/valores`,
    {
      method: 'PUT',
      body: JSON.stringify({ valores }),
    },
  )
}

export function criarDefinicaoCampo(dados: {
  entidade: EntidadeCampoPersonalizado
  rotulo: string
  tipo: TipoCampoPersonalizado
  id_catalogo?: number
  obrigatorio?: boolean
  ordem?: number
  niveis_visiveis?: number[]
}): Promise<{ id_definicao: number }> {
  return apiFetch('/api/campos-personalizados/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function atualizarDefinicaoCampo(
  idDefinicao: number,
  dados: {
    rotulo?: string
    obrigatorio?: boolean
    ordem?: number
    ativo?: boolean
    niveis_visiveis?: number[]
  },
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/campos-personalizados/${idDefinicao}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function excluirDefinicaoCampo(
  idDefinicao: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/campos-personalizados/${idDefinicao}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------------------
// Importação/exportação em massa de associados (v1.3) — o arquivo é parseado no navegador
// (nunca sobe bruto pro servidor); estas funções só trocam JSON já estruturado.
// ---------------------------------------------------------------------------
export type LinhaImportacao = {
  nome_completo: string
  cpf: string
  email_contato?: string
  telefone_whatsapp?: string
  data_nascimento?: string
  categoria?: string
  resolucao: 'nova' | 'ignorar'
}

export type VeredictoDuplicidade = {
  indice: number
  tipo: 'cpf_exato' | 'nome_e_nascimento' | null
  id_associado: number | null
  nome_encontrado: string | null
}

export function verificarDuplicidade(
  linhas: { nome_completo: string; cpf: string; data_nascimento?: string }[],
): Promise<{ resultados: VeredictoDuplicidade[] }> {
  return apiFetch('/api/associados/verificar-duplicidade', {
    method: 'POST',
    body: JSON.stringify({ linhas }),
  })
}

export type ResultadoImportacao = {
  id_lote: number
  criados: number
  ignorados: number
  erros: { indice: number; motivo: string }[]
}

export function importarLote(
  linhas: LinhaImportacao[],
): Promise<ResultadoImportacao> {
  return apiFetch('/api/associados/importar-lote', {
    method: 'POST',
    body: JSON.stringify({ linhas }),
  })
}

export function desfazerLote(idLote: number): Promise<{ mensagem: string }> {
  return apiFetch(`/api/associados/importar-lote/${idLote}/desfazer`, {
    method: 'POST',
  })
}

export function exportarAssociados(
  colunas: string[],
): Promise<{ colunas: string[]; linhas: Record<string, unknown>[] }> {
  return apiFetch(`/api/associados/exportar?colunas=${colunas.join(',')}`)
}
