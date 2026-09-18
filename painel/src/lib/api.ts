import { z } from 'zod'

import { clearSession, getAccessToken, setAccessToken } from './auth'
import { finalizarRequisicao, iniciarRequisicao } from './network-status'
import { meResponseSchema, perfilResponseSchema } from './schemas'

// Em produção, aponte para a origem da API (mesmo site do painel para o cookie SameSite=Strict
// funcionar — ex.: https://api.asaf.org.br). Em dev, deixe vazio: o Vite faz proxy de /auth.
const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''

// v2.5.4c (achado do usuário 2026-09-16, ponto de revisão) - qualquer caminho `/uploads/...`
// devolvido pelo backend (foto do associado, documento anexado da ata) é relativo À API, não
// ao painel - em produção são domínios DIFERENTES (api.asaf.org.br vs painel.asaf.org.br), então
// usar o caminho puro como `src`/`href` sempre resolvia contra a origem ERRADA (painel) e dava
// 404. Todo lugar que renderiza um caminho de upload deve passar por aqui, nunca usar o campo
// bruto direto.
export function urlArquivo(caminho: string): string {
  return `${API_BASE_URL}${caminho}`
}

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
  // FormData (upload de arquivo, v2.5.1) precisa que o navegador defina o Content-Type
  // sozinho (multipart/form-data + boundary) - forçar application/json aqui quebraria o upload.
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json')

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
    recadastramento_pendente?: boolean
    contato_suspeito?: boolean
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

// v2.5.1b - mesma ficha, endpoint administrativo (secretaria vendo a ficha de qualquer
// associado, não a própria) - endpoint já existia e já era testado, só nunca tinha tela.
export function obterFicha360Associado(idAssociado: number): Promise<Ficha360> {
  return apiFetch<Ficha360>(`/api/associados/${idAssociado}/ficha-360`)
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
// Opções de catálogo para preencher seleção (v0.3.1/v0.3.3) — leitura liberada a qualquer
// usuário autenticado. Gerenciar (criar/editar/excluir opção) exige, desde a v2.5.8, a
// permissão do MÓDULO dono do catálogo (`Catalogo.permissao_gerenciamento`) - nunca mais só
// `gerenciar_acesso` - ver módulo Configurações (pages/Configuracoes.tsx).
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
  incluirInativos = false,
): Promise<OpcaoDeCatalogo[]> {
  return apiFetch(
    `/api/catalogos/${chave}/opcoes${incluirInativos ? '?incluir_inativos=true' : ''}`,
  )
}

export type Catalogo = {
  id_catalogo: number
  chave: string
  nome_exibido: string
  descricao: string | null
  editavel_pelo_usuario: boolean
  permissao_gerenciamento: string | null
}

export function listarCatalogos(): Promise<Catalogo[]> {
  return apiFetch('/api/catalogos/')
}

export function criarOpcaoCatalogo(
  chave: string,
  dados: { codigo: string; rotulo: string; ordem?: number },
): Promise<{ id_opcao: number; codigo: string }> {
  return apiFetch(`/api/catalogos/${chave}/opcoes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function atualizarOpcaoCatalogo(
  idOpcao: number,
  dados: { rotulo?: string; ordem?: number; ativo?: boolean },
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/opcoes-catalogo/${idOpcao}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function excluirOpcaoCatalogo(
  idOpcao: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/opcoes-catalogo/${idOpcao}`, { method: 'DELETE' })
}

// Rota legada de compatibilidade (`/api/opcoes/{tipo}`, mantida desde v0.1/v0.2 - ver
// app/routers/core.py) - alguns campos antigos (`Associado.categoria`, `Associado.estado_civil`)
// gravam o RÓTULO como valor (ex.: "Efetivo"), não o código do catálogo novo (ex.: "EFETIVO").
// Use esta função pra esses campos especificamente, nunca `listarOpcoesCatalogo` no lugar dela.
export function listarOpcoesLegado(
  tipo: string,
): Promise<{ id_opcao: number; valor: string; ativo: boolean }[]> {
  return apiFetch(`/api/opcoes/${tipo}`)
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

// ---------------------------------------------------------------------------
// Associados — listagem, cadastro e concessão de acesso (v3.0.2, achado 2026-09-15: a aba
// "Associados" do painel só tinha guarda de permissão, nenhum conteúdo real).
// ---------------------------------------------------------------------------
export type AssociadoListagem = {
  id_associado: number
  nome_completo: string
  cpf: string
  categoria: string | null
  status_arrolamento: string | null
  email_contato: string | null
  telefone_whatsapp: string | null
  numero_matricula: string | number | null
  tem_acesso: boolean
}

export function listarAssociados(): Promise<AssociadoListagem[]> {
  return apiFetch('/api/associados/')
}

export type AssociadoMasterCriarInput = {
  nome_completo: string
  cpf: string
  email_contato: string
  telefone_whatsapp: string
  categoria: string
  cep: string
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  data_nascimento?: string
  estado_civil?: string
  profissao?: string
  naturalidade?: string
}

export function criarAssociadoMaster(
  dados: AssociadoMasterCriarInput,
): Promise<{ mensagem: string; id_associado: number }> {
  return apiFetch('/associados-master/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type ConcederAcessoInput = {
  email: string
  senha_provisoria: string
  id_nivel?: number
}

export function concederAcesso(
  idAssociado: number,
  dados: ConcederAcessoInput,
): Promise<{ mensagem: string; id_usuario: number }> {
  return apiFetch(`/api/associados/${idAssociado}/conceder-acesso`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// Detalhe/edição de associado, cargos e família (v2.5.1, FASE 2.5 - Painel)
// ---------------------------------------------------------------------------
export type AssociadoDetalhe = {
  id_associado: number
  id_pessoa: number
  nome_completo: string
  cpf: string
  email_contato: string
  telefone_whatsapp: string
  categoria: string
  status_arrolamento: string | null
  foto: string | null
  numero_matricula: number | null
  data_nascimento: string | null
  estado_civil: string | null
  profissao: string | null
  naturalidade: string | null
  endereco: {
    cep: string
    logradouro: string
    numero: string
    bairro: string
    cidade: string
    estado: string
  }
}

export function obterAssociado(idAssociado: number): Promise<AssociadoDetalhe> {
  return apiFetch(`/api/associados/${idAssociado}`)
}

export type AssociadoAdminUpdateInput = {
  nome_completo: string
  email_contato: string
  telefone_whatsapp: string
  categoria: string
  cep: string
  logradouro: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  data_nascimento?: string
  estado_civil?: string
  profissao?: string
  naturalidade?: string
}

export function editarAssociado(
  idAssociado: number,
  dados: AssociadoAdminUpdateInput,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/associados/${idAssociado}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function enviarFotoAssociado(
  idAssociado: number,
  arquivo: File,
): Promise<{ mensagem: string; foto: string }> {
  const formData = new FormData()
  formData.append('foto', arquivo)
  return apiFetch(`/api/associados/${idAssociado}/foto`, {
    method: 'POST',
    body: formData,
  })
}

export type CargoHistorico = {
  id_historico: number
  titulo_cargo: string
  data_posse: string | null
  data_saida: string | null
}

export function listarCargos(idAssociado: number): Promise<CargoHistorico[]> {
  return apiFetch(`/api/associados/${idAssociado}/cargos`)
}

export function criarCargo(
  idAssociado: number,
  dados: { titulo_cargo: string; data_posse: string },
): Promise<{ mensagem: string; id_historico: number }> {
  return apiFetch(`/api/associados/${idAssociado}/cargos`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function encerrarCargo(
  idHistorico: number,
  dataSaida: string,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/cargos/${idHistorico}/encerrar`, {
    method: 'PUT',
    body: JSON.stringify({ data_saida: dataSaida }),
  })
}

export function removerCargo(
  idHistorico: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/cargos/${idHistorico}`, { method: 'DELETE' })
}

export type DependenteFamiliar = {
  id_dependente: number
  grau_parentesco: string
  id_pessoa_vinculada: number
  nome_completo: string | null
  data_nascimento: string | null
  e_associado: boolean
}

export function listarDependentesDaPessoa(
  idPessoaTitular: number,
): Promise<DependenteFamiliar[]> {
  return apiFetch(`/api/pessoas/${idPessoaTitular}/dependentes`)
}

export function adicionarDependente(
  idPessoaTitular: number,
  dados: {
    grau_parentesco: string
    id_pessoa_vinculada?: number
    nome_completo?: string
    data_nascimento?: string
  },
): Promise<{ mensagem: string; id_dependente: number }> {
  return apiFetch(`/api/pessoas/${idPessoaTitular}/dependentes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function editarDependente(
  idDependente: number,
  grauParentesco: string,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/dependentes/${idDependente}`, {
    method: 'PUT',
    body: JSON.stringify({ grau_parentesco: grauParentesco }),
  })
}

export function removerDependente(
  idDependente: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/dependentes/${idDependente}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Governança — Assembleias, petição de convocação e condução de sessão
// (v2.5.2, FASE 2.5 - Painel). Backend já existia por completo desde a FASE 2
// (v2.2/v2.3); esta versão só liga o painel único nele.
// ---------------------------------------------------------------------------
export type HorariosConvocacao = {
  primeira_convocacao: string
  segunda_convocacao: string
  terceira_convocacao: string
}

export type Assembleia = HorariosConvocacao & {
  id_assembleia: number
  tipo: string
  pauta: string
  status: string
  origem_convocacao: string
  local_fisico: string | null
  link_remoto: string | null
  convocada_em: string | null
}

export type AssembleiaCriarInput = {
  tipo: string
  pauta: string
  data_hora_convocacao: string
  local_fisico?: string
  link_remoto?: string
}

export function listarAssembleias(status?: string): Promise<Assembleia[]> {
  return apiFetch(
    `/api/assembleias/${status ? `?status=${encodeURIComponent(status)}` : ''}`,
  )
}

export function obterAssembleia(idAssembleia: number): Promise<Assembleia> {
  return apiFetch(`/api/assembleias/${idAssembleia}`)
}

export function criarAssembleia(
  dados: AssembleiaCriarInput,
): Promise<Assembleia> {
  return apiFetch('/api/assembleias/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function convocarAssembleia(idAssembleia: number): Promise<Assembleia> {
  return apiFetch(`/api/assembleias/${idAssembleia}/convocar`, {
    method: 'POST',
  })
}

export function cancelarAssembleia(
  idAssembleia: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/assembleias/${idAssembleia}/cancelar`, {
    method: 'POST',
  })
}

export function abrirSessaoAssembleia(
  idAssembleia: number,
): Promise<Assembleia> {
  return apiFetch(`/api/assembleias/${idAssembleia}/abrir-sessao`, {
    method: 'POST',
  })
}

export function encerrarSessaoAssembleia(
  idAssembleia: number,
): Promise<Assembleia> {
  return apiFetch(`/api/assembleias/${idAssembleia}/encerrar-sessao`, {
    method: 'POST',
  })
}

export function obterEditalAssembleia(
  idAssembleia: number,
): Promise<{ edital_texto: string }> {
  return apiFetch(`/api/assembleias/${idAssembleia}/edital`)
}

export type Habilitado = {
  id_associado: number
  habilitado: boolean
  motivo_inabilitacao: string | null
  status_arrolamento_no_momento: string | null
}

export function listarHabilitados(
  idAssembleia: number,
  apenasHabilitados = false,
): Promise<Habilitado[]> {
  return apiFetch(
    `/api/assembleias/${idAssembleia}/habilitados${apenasHabilitados ? '?apenas_habilitados=true' : ''}`,
  )
}

export type PeticaoConvocacao = {
  id_peticao: number
  pauta_proposta: string
  status: string
  data_quorum_atingido: string | null
  adesoes: number
  base_associados_ativos: number
  fracao_atual: number
  pode_converter_sem_presidente: boolean
}

export function listarPeticoes(): Promise<PeticaoConvocacao[]> {
  return apiFetch('/api/peticoes-convocacao/')
}

export function obterPeticao(idPeticao: number): Promise<PeticaoConvocacao> {
  return apiFetch(`/api/peticoes-convocacao/${idPeticao}`)
}

export function proporPeticao(
  pautaProposta: string,
): Promise<PeticaoConvocacao> {
  return apiFetch('/api/peticoes-convocacao/', {
    method: 'POST',
    body: JSON.stringify({ pauta_proposta: pautaProposta }),
  })
}

export function aderirPeticao(idPeticao: number): Promise<PeticaoConvocacao> {
  return apiFetch(`/api/peticoes-convocacao/${idPeticao}/aderir`, {
    method: 'POST',
  })
}

export function converterPeticaoEmAssembleia(
  idPeticao: number,
  dados: AssembleiaCriarInput,
): Promise<Assembleia> {
  return apiFetch(
    `/api/peticoes-convocacao/${idPeticao}/converter-em-assembleia`,
    {
      method: 'POST',
      body: JSON.stringify(dados),
    },
  )
}

// ---------------------------------------------------------------------------
// Condução da sessão (v2.3) — credenciamento, quórum em tempo real, itens de
// pauta e ocorrências. Só vale com a assembleia "Em andamento".
// ---------------------------------------------------------------------------
export type Credenciamento = {
  id_credenciamento: number
  id_associado: number
  nome_completo?: string
  modalidade: string
  hora_entrada: string
  hora_saida: string | null
}

export function credenciar(
  idAssembleia: number,
  dados: { id_associado: number; modalidade: string },
): Promise<Credenciamento> {
  return apiFetch(`/api/assembleias/${idAssembleia}/credenciamentos`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function registrarSaidaCredenciamento(
  idAssembleia: number,
  idCredenciamento: number,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/assembleias/${idAssembleia}/credenciamentos/${idCredenciamento}/saida`,
    { method: 'POST' },
  )
}

export function listarCredenciamentos(
  idAssembleia: number,
): Promise<Credenciamento[]> {
  return apiFetch(`/api/assembleias/${idAssembleia}/credenciamentos`)
}

export type QuorumInstalacao = {
  convocacao_aplicavel: string
  quorum_regra: string
  total_habilitados: number
  credenciados_habilitados: number
  minimo_exigido: number
  quorum_atingido: boolean
}

export function obterQuorum(idAssembleia: number): Promise<QuorumInstalacao> {
  return apiFetch(`/api/assembleias/${idAssembleia}/quorum`)
}

export type ItemPauta = {
  id_item: number
  titulo: string
  descricao: string | null
  tempo_fala_minutos: number | null
  ordem: number
  status: string
  aberto_em: string | null
  encerrado_em: string | null
}

export function listarItensPauta(idAssembleia: number): Promise<ItemPauta[]> {
  return apiFetch(`/api/assembleias/${idAssembleia}/itens-pauta`)
}

export function criarItemPauta(
  idAssembleia: number,
  dados: { titulo: string; descricao?: string; tempo_fala_minutos?: number },
): Promise<ItemPauta> {
  return apiFetch(`/api/assembleias/${idAssembleia}/itens-pauta`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function abrirDiscussaoItem(
  idAssembleia: number,
  idItem: number,
): Promise<ItemPauta> {
  return apiFetch(
    `/api/assembleias/${idAssembleia}/itens-pauta/${idItem}/abrir-discussao`,
    { method: 'POST' },
  )
}

export function abrirVotacaoItem(
  idAssembleia: number,
  idItem: number,
): Promise<ItemPauta> {
  return apiFetch(
    `/api/assembleias/${idAssembleia}/itens-pauta/${idItem}/abrir-votacao`,
    { method: 'POST' },
  )
}

export function encerrarItemPauta(
  idAssembleia: number,
  idItem: number,
): Promise<ItemPauta> {
  return apiFetch(
    `/api/assembleias/${idAssembleia}/itens-pauta/${idItem}/encerrar`,
    { method: 'POST' },
  )
}

export type OcorrenciaSessao = {
  id_ocorrencia: number
  id_item_pauta: number | null
  descricao: string
  criado_em: string
}

export function listarOcorrencias(
  idAssembleia: number,
): Promise<OcorrenciaSessao[]> {
  return apiFetch(`/api/assembleias/${idAssembleia}/ocorrencias`)
}

export function registrarOcorrencia(
  idAssembleia: number,
  dados: { descricao: string; id_item_pauta?: number },
): Promise<{ mensagem: string; id_ocorrencia: number }> {
  return apiFetch(`/api/assembleias/${idAssembleia}/ocorrencias`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// Motor de votação (v2.4, ligado ao painel em v2.5.3) — abrir votação por item de
// pauta, votar, apurar/encerrar (hash de integridade), impugnar e resolver empate.
// Voto secreto é desacoplado de verdade no backend (ver app/models/votacao.py) - o
// painel nunca pede nem mostra "quem votou o quê" numa votação secreta.
// ---------------------------------------------------------------------------
export type Votacao = {
  id_votacao: number
  id_item_pauta: number
  titulo: string
  tipo: string
  escrutinio: string
  fracao_qualificada: string | null
  opcoes_validas: string[]
  status: string
  quorum_instalacao_minimo: number | null
  resultado_contagem: Record<string, number> | null
  resultado_hash: string | null
  vencedor: string | null
  aprovado: boolean | null
  empate: boolean
}

export type VotacaoAbrirInput = {
  titulo: string
  tipo: string
  escrutinio: string
  opcoes: string[]
  fracao_qualificada?: string
  considerar_abstencao_na_base?: boolean
}

export function criarVotacao(
  idItem: number,
  dados: VotacaoAbrirInput,
): Promise<Votacao> {
  return apiFetch(`/api/itens-pauta/${idItem}/votacoes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarVotacoesDoItem(idItem: number): Promise<Votacao[]> {
  return apiFetch(`/api/itens-pauta/${idItem}/votacoes`)
}

export function obterVotacao(idVotacao: number): Promise<Votacao> {
  return apiFetch(`/api/votacoes/${idVotacao}`)
}

export function votar(
  idVotacao: number,
  opcao: string,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/votacoes/${idVotacao}/votar`, {
    method: 'POST',
    body: JSON.stringify({ opcao }),
  })
}

export function encerrarVotacao(idVotacao: number): Promise<Votacao> {
  return apiFetch(`/api/votacoes/${idVotacao}/encerrar`, { method: 'POST' })
}

export function resolverEmpateVotacao(
  idVotacao: number,
  dados: { vencedor: string; justificativa: string },
): Promise<Votacao> {
  return apiFetch(`/api/votacoes/${idVotacao}/resolver-empate`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type ImpugnacaoVotacao = {
  id_impugnacao: number
  id_associado_impugnante: number
  motivo: string
  prazo_recurso_ate: string | null
  resolvida: boolean
  resolucao: string | null
  criado_em: string
}

export function impugnarVotacao(
  idVotacao: number,
  motivo: string,
): Promise<{
  mensagem: string
  id_impugnacao: number
  prazo_recurso_ate: string | null
}> {
  return apiFetch(`/api/votacoes/${idVotacao}/impugnacoes`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export function listarImpugnacoes(
  idVotacao: number,
): Promise<ImpugnacaoVotacao[]> {
  return apiFetch(`/api/votacoes/${idVotacao}/impugnacoes`)
}

export function resolverImpugnacao(
  idImpugnacao: number,
  resolucao: string,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/votacoes/impugnacoes/${idImpugnacao}/resolver`, {
    method: 'POST',
    body: JSON.stringify({ resolucao }),
  })
}

// ---------------------------------------------------------------------------
// Chamada (v2.5.3b, achado do usuário 2026-09-15) — autochamada por código da sessão,
// justificativa de falta e "Minhas Assembleias" (visão do próprio associado, fora do
// módulo Governança). Presença/falta nunca é um campo próprio: é sempre calculada a partir
// do credenciamento (v2.3) + justificativa aceita, ver app/services/chamada.py.
// ---------------------------------------------------------------------------
export function baterPresenca(
  idAssembleia: number,
  dados: { codigo: string; modalidade: string },
): Promise<{ mensagem: string; id_credenciamento: number }> {
  return apiFetch(`/api/assembleias/${idAssembleia}/bater-presenca`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function obterCodigoChamada(
  idAssembleia: number,
): Promise<{ codigo_chamada: string }> {
  return apiFetch(`/api/assembleias/${idAssembleia}/codigo-chamada`)
}

export function credenciarManual(
  idAssembleia: number,
  dados: { id_associado: number; modalidade: string },
): Promise<{ mensagem: string; id_credenciamento: number }> {
  return apiFetch(`/api/assembleias/${idAssembleia}/credenciamentos/manual`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type JustificativaFalta = {
  id_justificativa: number
  id_assembleia: number
  id_associado: number
  motivo: string
  status: string
  motivo_decisao: string | null
  decidido_em: string | null
  criado_em: string
}

export function criarJustificativa(
  idAssembleia: number,
  dados: { motivo: string; id_associado?: number },
): Promise<JustificativaFalta> {
  return apiFetch(`/api/assembleias/${idAssembleia}/justificativas`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarJustificativas(
  idAssembleia: number,
): Promise<JustificativaFalta[]> {
  return apiFetch(`/api/assembleias/${idAssembleia}/justificativas`)
}

export function decidirJustificativa(
  idJustificativa: number,
  dados: { aceitar: boolean; motivo_decisao?: string },
): Promise<JustificativaFalta> {
  return apiFetch(`/api/justificativas/${idJustificativa}/decidir`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type MinhaAssembleia = {
  id_assembleia: number
  tipo: string
  pauta: string
  status: string
  data_hora_convocacao: string
  status_presenca: string | null
  justificativa: JustificativaFalta | null
}

export function listarMinhasAssembleias(): Promise<MinhaAssembleia[]> {
  return apiFetch('/api/minhas-assembleias')
}

// ---------------------------------------------------------------------------
// Ata, deliberações e certidões (v2.5, ligado ao painel em v2.5.4) — a ata NUNCA é digitada
// livre: é gerada do que a sessão já registrou (presença, pauta, votação, ocorrências); o único
// texto livre é `relato_secretaria`, e só enquanto a ata está em rascunho. Depois de assinada,
// trava pra sempre - correção é uma ata de retificação nova, nunca uma edição.
// ---------------------------------------------------------------------------
export type Ata = {
  id_ata: number
  id_assembleia: number
  numero_sequencial: number | null
  corpo_texto: string
  relato_secretaria: string | null
  status: string
  assinada_em: string | null
  id_ata_retificada: number | null
  motivo_retificacao: string | null
  // v2.5.4b (achado do usuário 2026-09-16) - o registro interno do sistema (corpo_texto,
  // "assinar") NÃO tem valor cartorial - estes três campos guardam o documento real, assinado
  // fora do sistema e (se houver) protocolado em cartório.
  arquivo_documento_assinado: string | null
  numero_protocolo_cartorio: string | null
  data_protocolo_cartorio: string | null
}

export type AtaListagem = Ata & {
  assembleia_tipo: string | null
  assembleia_pauta: string | null
}

export function listarAtas(): Promise<AtaListagem[]> {
  return apiFetch('/api/atas/')
}

export function gerarAta(idAssembleia: number): Promise<Ata> {
  return apiFetch(`/api/assembleias/${idAssembleia}/ata`, { method: 'POST' })
}

export function obterAtaDaAssembleia(idAssembleia: number): Promise<Ata> {
  return apiFetch(`/api/assembleias/${idAssembleia}/ata`)
}

export function anexarDocumentoAssinado(
  idAta: number,
  arquivo: File,
  dados: {
    numero_protocolo_cartorio?: string
    data_protocolo_cartorio?: string
  },
): Promise<Ata> {
  const formData = new FormData()
  formData.append('documento', arquivo)
  if (dados.numero_protocolo_cartorio)
    formData.append(
      'numero_protocolo_cartorio',
      dados.numero_protocolo_cartorio,
    )
  if (dados.data_protocolo_cartorio)
    formData.append('data_protocolo_cartorio', dados.data_protocolo_cartorio)
  return apiFetch(`/api/atas/${idAta}/documento-assinado`, {
    method: 'POST',
    body: formData,
  })
}

export function atualizarRelatoSecretaria(
  idAta: number,
  relatoSecretaria: string,
): Promise<Ata> {
  return apiFetch(`/api/atas/${idAta}/relato-secretaria`, {
    method: 'PUT',
    body: JSON.stringify({ relato_secretaria: relatoSecretaria }),
  })
}

export function assinarAta(idAta: number): Promise<Ata> {
  return apiFetch(`/api/atas/${idAta}/assinar`, { method: 'POST' })
}

export function retificarAta(idAta: number, motivo: string): Promise<Ata> {
  return apiFetch(`/api/atas/${idAta}/retificar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export type Deliberacao = {
  id_deliberacao: number
  id_ata: number
  tipo: string
  texto: string
  ano_exercicio: number | null
  status_execucao: string
  id_associado_responsavel: number | null
  prazo_execucao: string | null
  concluida_em: string | null
  observacao_conclusao: string | null
}

export type DeliberacaoCriarInput = {
  tipo: string
  texto: string
  id_item_pauta?: number
  id_votacao?: number
  id_associado_responsavel?: number
  prazo_execucao?: string
  ano_exercicio?: number
}

export function criarDeliberacao(
  idAta: number,
  dados: DeliberacaoCriarInput,
): Promise<Deliberacao> {
  return apiFetch(`/api/atas/${idAta}/deliberacoes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarDeliberacoesDaAta(idAta: number): Promise<Deliberacao[]> {
  return apiFetch(`/api/atas/${idAta}/deliberacoes`)
}

// v3.5 - lista cross-assembleia, usada pra vincular orçamento/reserva de contingência à
// deliberação que aprovou (nunca "de gaveta", sempre concluída de verdade em assembleia).
export function listarDeliberacoesConcluidas(): Promise<Deliberacao[]> {
  return apiFetch('/api/deliberacoes/concluidas')
}

export type MandatoCriarInput = {
  id_associado: number
  orgao_codigo: string
  cargo_codigo: string
  data_inicio: string
  data_fim_previsto?: string
  ato_origem?: string
}

export function concluirDeliberacao(
  idDeliberacao: number,
  dados: { observacao?: string; mandatos_criar?: MandatoCriarInput[] },
): Promise<Deliberacao & { mandatos_criados: number[]; pendencia?: string }> {
  return apiFetch(`/api/deliberacoes/${idDeliberacao}/concluir`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function revogarDeliberacao(
  idDeliberacao: number,
  motivo: string,
): Promise<Deliberacao> {
  return apiFetch(`/api/deliberacoes/${idDeliberacao}/revogar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export type CertidaoDeliberacao = {
  id_certidao: number
  numero_sequencial: number
  emitida_em?: string
  texto_gerado?: string
}

export function emitirCertidao(
  idDeliberacao: number,
): Promise<CertidaoDeliberacao> {
  return apiFetch(`/api/deliberacoes/${idDeliberacao}/certidao`, {
    method: 'POST',
  })
}

export function listarCertidoes(
  idDeliberacao: number,
): Promise<CertidaoDeliberacao[]> {
  return apiFetch(`/api/deliberacoes/${idDeliberacao}/certidoes`)
}

// ---------------------------------------------------------------------------
// Mandatos, órgãos e conflito de interesse (v2.1 backend, v2.5.5 painel)
// ---------------------------------------------------------------------------
export type Mandato = {
  id_mandato: number
  id_associado: number
  orgao_codigo: string
  cargo_codigo: string
  data_inicio: string
  data_fim_previsto: string
  data_fim_efetivo: string | null
  motivo_encerramento: string | null
  ato_origem: string | null
  vigente: boolean
}

export function listarMandatos(filtros?: {
  idAssociado?: number
  orgaoCodigo?: string
  apenasVigentes?: boolean
}): Promise<Mandato[]> {
  const params = new URLSearchParams()
  if (filtros?.idAssociado)
    params.set('id_associado', String(filtros.idAssociado))
  if (filtros?.orgaoCodigo) params.set('orgao_codigo', filtros.orgaoCodigo)
  if (filtros?.apenasVigentes) params.set('apenas_vigentes', 'true')
  const query = params.toString()
  return apiFetch(`/api/mandatos/${query ? `?${query}` : ''}`)
}

export function criarMandato(dados: MandatoCriarInput): Promise<Mandato> {
  return apiFetch('/api/mandatos/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function encerrarMandato(
  idMandato: number,
  dados: { motivo: string; referencia_ato?: string },
): Promise<Mandato & { vaga_aberta: boolean; pendencia?: string }> {
  return apiFetch(`/api/mandatos/${idMandato}/encerrar`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type DeclaracaoConflitoInteresse = {
  id_declaracao: number
  id_associado: number
  descricao: string
  ativa: boolean
  criado_em: string
}

export function listarConflitosInteresse(filtros?: {
  idAssociado?: number
  apenasAtivas?: boolean
}): Promise<DeclaracaoConflitoInteresse[]> {
  const params = new URLSearchParams()
  if (filtros?.idAssociado)
    params.set('id_associado', String(filtros.idAssociado))
  params.set(
    'apenas_ativas',
    filtros?.apenasAtivas === false ? 'false' : 'true',
  )
  return apiFetch(`/api/mandatos/conflitos-interesse?${params.toString()}`)
}

export function declararConflitoInteresse(dados: {
  id_associado: number
  descricao: string
}): Promise<{ mensagem: string; id_declaracao: number }> {
  return apiFetch('/api/mandatos/conflitos-interesse', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function encerrarConflitoInteresse(
  idDeclaracao: number,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/mandatos/conflitos-interesse/${idDeclaracao}/encerrar`,
    {
      method: 'PUT',
    },
  )
}

// ---------------------------------------------------------------------------
// Conselho Fiscal (v2.6 backend, v2.5.5 painel) - leitura financeira irrestrita
// (auditada a cada consulta), parecer sobre prestação de contas, fila de
// questionamentos sobre lançamento. Vive no módulo Financeiro (permissão
// `financeiro`, a mesma que o backend exige pra leitura) - nunca dentro de
// Governança, porque quem só tem `financeiro`/`auditoria` (Conselho Fiscal,
// v0.1.5) não teria como abrir um módulo que exige `governanca`.
// ---------------------------------------------------------------------------
export type TituloFinanceiroCF = {
  id_titulo: number
  tipo_titulo: string
  id_associado: number | null
  id_fornecedor: number | null
  descricao: string
  // `Numeric`/`Decimal` no backend, mas o FastAPI serializa Decimal como número JSON em reais
  // (jsonable_encoder), nunca centavos e nunca string - confirmado empiricamente antes de
  // escrever este tipo, pra não repetir o mesmo tipo de suposição errada que gerou o achado 1
  // do Ponto de Revisão FASE 2.5 (1/3).
  valor_original: number
  saldo_devedor: number
  data_emissao: string | null
  data_vencimento: string
  status: string
}

export function listarTitulosConselhoFiscal(
  status?: string,
): Promise<TituloFinanceiroCF[]> {
  return apiFetch(
    `/api/conselho-fiscal/financeiro/titulos${status ? `?status=${encodeURIComponent(status)}` : ''}`,
  )
}

export type PartidaContabilCF = {
  id_conta: number
  tipo_partida: string
  valor: number
}

export type LancamentoContabilCF = {
  id_lancamento: number
  numero_sequencial: number
  id_titulo: number | null
  historico: string
  data_lancamento: string
  forma_pagamento: string | null
  estornado: boolean
  partidas: PartidaContabilCF[]
}

export function listarCaixaConselhoFiscal(): Promise<LancamentoContabilCF[]> {
  return apiFetch('/api/conselho-fiscal/financeiro/caixa')
}

export type ParecerPrestacaoContas = {
  id_parecer: number
  ano_exercicio: number
  tipo: string
  texto: string
  id_associado_conselheiro: number
  criado_em: string
}

export function listarPareceres(
  anoExercicio?: number,
): Promise<ParecerPrestacaoContas[]> {
  return apiFetch(
    `/api/conselho-fiscal/pareceres${anoExercicio ? `?ano_exercicio=${anoExercicio}` : ''}`,
  )
}

export function emitirParecer(dados: {
  ano_exercicio: number
  tipo: string
  texto: string
}): Promise<{ id_parecer: number; ano_exercicio: number; tipo: string }> {
  return apiFetch('/api/conselho-fiscal/pareceres', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type QuestionamentoLancamento = {
  id_questionamento: number
  pergunta: string
  status: string
  id_associado_questionador: number
  criado_em: string
}

export function criarQuestionamento(
  idTitulo: number,
  dados: { pergunta: string },
): Promise<{ id_questionamento: number; status: string }> {
  return apiFetch(`/api/financeiro/titulos/${idTitulo}/questionamentos`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarQuestionamentos(
  idTitulo: number,
): Promise<QuestionamentoLancamento[]> {
  return apiFetch(`/api/financeiro/titulos/${idTitulo}/questionamentos`)
}

export type RespostaQuestionamento = {
  id_resposta: number
  texto: string
  criado_em: string
}

export function responderQuestionamento(
  idQuestionamento: number,
  dados: { texto: string },
): Promise<{ id_resposta: number; status_questionamento: string }> {
  return apiFetch(`/api/questionamentos/${idQuestionamento}/respostas`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarRespostas(
  idQuestionamento: number,
): Promise<RespostaQuestionamento[]> {
  return apiFetch(`/api/questionamentos/${idQuestionamento}/respostas`)
}

// ---------------------------------------------------------------------------
// Processo disciplinar (v2.7 backend, v2.5.6 painel) - Art. 16/17. Confidencial: o backend
// devolve 404 (nunca 403) pra quem não é `governanca` nem o próprio acusado, então a tela de
// detalhe vive numa rota GLOBAL (/processos-disciplinares/:id), fora do módulo Governança - se
// morasse dentro de /governanca (permissão `governanca`), o próprio acusado nunca conseguiria
// abrir a própria defesa. A listagem (`GET .../processos-disciplinares/`) já se auto-filtra no
// backend (governanca vê tudo, associado comum só o que é seu) - reaproveitada nas duas rotas
// (`/governanca/disciplina` e `/meus-processos-disciplinares`).
// ---------------------------------------------------------------------------
export type ProcessoDisciplinar = {
  id_processo: number
  id_associado: number
  motivo_codigo: string
  descricao: string
  status: string
  data_abertura: string
  prazo_defesa_ate: string
  defesa_apresentada_em: string | null
  pena_aplicada: string | null
  escalada_automatica: boolean
  suspensao_dias: number | null
  data_fim_suspensao: string | null
  decidido_em: string | null
  homologado_em: string | null
}

export function listarProcessosDisciplinares(): Promise<ProcessoDisciplinar[]> {
  return apiFetch('/api/processos-disciplinares/')
}

export function obterProcessoDisciplinar(
  idProcesso: number,
): Promise<ProcessoDisciplinar> {
  return apiFetch(`/api/processos-disciplinares/${idProcesso}`)
}

export function abrirProcessoDisciplinar(dados: {
  id_associado: number
  motivo_codigo: string
  descricao: string
}): Promise<ProcessoDisciplinar> {
  return apiFetch('/api/processos-disciplinares/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function apresentarDefesa(
  idProcesso: number,
  texto: string,
): Promise<ProcessoDisciplinar> {
  return apiFetch(`/api/processos-disciplinares/${idProcesso}/defesa`, {
    method: 'POST',
    body: JSON.stringify({ texto }),
  })
}

export type ResultadoColegiado = {
  diretores_aptos: number
  quorum_minimo: number
  manifestacoes: number
  quorum_atingido: boolean
  resultado: string | null
  contagem: Record<string, number>
}

export function registrarManifestacao(
  idProcesso: number,
  dados: { pena_proposta?: string; justificativa?: string },
): Promise<ResultadoColegiado> {
  return apiFetch(`/api/processos-disciplinares/${idProcesso}/manifestacoes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function verManifestacoes(
  idProcesso: number,
): Promise<ResultadoColegiado> {
  return apiFetch(`/api/processos-disciplinares/${idProcesso}/manifestacoes`)
}

export function decidirProcessoDisciplinar(
  idProcesso: number,
  dados: { texto_decisao: string; suspensao_dias?: number },
): Promise<ProcessoDisciplinar> {
  return apiFetch(`/api/processos-disciplinares/${idProcesso}/decidir`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function homologarEliminacao(
  idProcesso: number,
  dados: { aprovado: boolean; justificativa: string },
): Promise<ProcessoDisciplinar> {
  return apiFetch(`/api/processos-disciplinares/${idProcesso}/homologar`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// Processo de dissolução (v2.8 backend, v2.5.6 painel) - Art. 31. "Espera-se nunca usar", mas
// precisa existir - tela rara, sempre dentro de Governança (permissão `governanca`, sem
// conceito de "acusado" que precise ver de fora, diferente da disciplina).
// ---------------------------------------------------------------------------
export type ProcessoDissolucao = {
  id_processo_dissolucao: number
  motivo: string
  status: string
  id_deliberacao: number | null
  deliberada_em: string | null
  liquidacao_concluida_em: string | null
  entidade_destinataria_nome: string | null
  entidade_destinataria_cnpj: string | null
  patrimonio_destinado_em: string | null
  baixa_cadastral_em: string | null
  motivo_cancelamento: string | null
}

export function listarProcessosDissolucao(): Promise<ProcessoDissolucao[]> {
  return apiFetch('/api/processos-dissolucao/')
}

export function obterProcessoDissolucao(
  idProcessoDissolucao: number,
): Promise<ProcessoDissolucao> {
  return apiFetch(`/api/processos-dissolucao/${idProcessoDissolucao}`)
}

export function abrirProcessoDissolucao(
  motivo: string,
): Promise<ProcessoDissolucao> {
  return apiFetch('/api/processos-dissolucao/', {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export function deliberarDissolucao(
  idProcessoDissolucao: number,
  idDeliberacao: number,
): Promise<ProcessoDissolucao> {
  return apiFetch(
    `/api/processos-dissolucao/${idProcessoDissolucao}/deliberar`,
    {
      method: 'POST',
      body: JSON.stringify({ id_deliberacao: idDeliberacao }),
    },
  )
}

export function concluirLiquidacaoDissolucao(
  idProcessoDissolucao: number,
  observacao: string,
): Promise<ProcessoDissolucao> {
  return apiFetch(
    `/api/processos-dissolucao/${idProcessoDissolucao}/concluir-liquidacao`,
    { method: 'POST', body: JSON.stringify({ observacao }) },
  )
}

export function destinarPatrimonioDissolucao(
  idProcessoDissolucao: number,
  dados: {
    entidade_nome: string
    entidade_cnpj?: string
    justificativa: string
    confirma_sede_parauapebas: boolean
    confirma_anos_minimos: boolean
    confirma_credenciada: boolean
  },
): Promise<ProcessoDissolucao> {
  return apiFetch(
    `/api/processos-dissolucao/${idProcessoDissolucao}/destinar-patrimonio`,
    { method: 'POST', body: JSON.stringify(dados) },
  )
}

export function baixaCadastralDissolucao(
  idProcessoDissolucao: number,
  observacao: string,
): Promise<ProcessoDissolucao> {
  return apiFetch(
    `/api/processos-dissolucao/${idProcessoDissolucao}/baixa-cadastral`,
    { method: 'POST', body: JSON.stringify({ observacao }) },
  )
}

export function cancelarProcessoDissolucao(
  idProcessoDissolucao: number,
  motivo: string,
): Promise<ProcessoDissolucao> {
  return apiFetch(
    `/api/processos-dissolucao/${idProcessoDissolucao}/cancelar`,
    {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    },
  )
}

// ---------------------------------------------------------------------------
// Calendário institucional (v2.9 backend, v2.5.7 painel) - agrega, na leitura, o que já é dado
// real em outro módulo (AGO/eleição estatutária, assembleia convocada, mandato vencendo, prazo
// de deliberação, projeto/evento) mais evento avulso cadastrado aqui. Leitura liberada a
// QUALQUER usuário autenticado no backend (`GET /api/calendario/` usa só `get_current_user`,
// nunca `exigir_permissao`) - por isso a tela vive numa rota GLOBAL (`/calendario`), fora do
// módulo Governança, terceira vez que esse padrão de "não travar atrás da permissão errada"
// aparece nesta fase (depois de Conselho Fiscal e Disciplina). Só "agendar evento" exige
// `governanca` - a tela mostra o formulário condicionado a isso, o backend recusa de qualquer
// forma se alguém tentar sem ter.
// ---------------------------------------------------------------------------
export type ItemCalendario = {
  tipo: string
  titulo: string
  data: string
  dias_restantes: number
  artigo_origem: string | null
  categoria?: string
  janela_fim?: string
}

export function obterCalendario(
  diasAntecedencia = 90,
): Promise<ItemCalendario[]> {
  return apiFetch(`/api/calendario/?dias_antecedencia=${diasAntecedencia}`)
}

export type EventoCalendario = {
  id_evento: number
  titulo: string
  descricao: string | null
  categoria: string
  data_inicio: string
  data_fim: string | null
}

export function listarEventosCalendario(): Promise<EventoCalendario[]> {
  return apiFetch('/api/eventos-calendario/')
}

export function criarEventoCalendario(dados: {
  titulo: string
  descricao?: string
  categoria: string
  data_inicio: string
  data_fim?: string
}): Promise<{ id_evento: number; titulo: string; data_inicio: string }> {
  return apiFetch('/api/eventos-calendario/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// Financeiro: Plano de Contas, Fornecedores e Exercícios (backend v3.0, painel v2.5.8) - as
// três telas de cadastro que faltavam pro módulo Financeiro (o resto já era só leitura, via
// Conselho Fiscal). Todos os endpoints exigem a mesma permissão `financeiro`, já usada em
// `/financeiro` no App.tsx - nenhum caso de permissão mais estrita que o esperado desta vez.
//
// `PlanoDeContas.tipo` guarda o RÓTULO do catálogo `tipo_conta_contabil` ("Ativo", "Passivo",
// "Patrimônio Líquido", "Receita", "Despesa"), nunca o `codigo` técnico - confirmado em
// `app/services/contabilidade.py::NATUREZA_POR_TIPO` e nos testes de backend, que só usam
// `tipo="Despesa"` etc. Por isso o <select> do formulário usa `o.rotulo` como `value`.
// ---------------------------------------------------------------------------
export type PlanoDeContas = {
  id_conta: number
  codigo_contabil: string
  descricao_conta: string
  tipo: string
  codigo_contabil_pai: string | null
  sintetica: boolean
}

export function listarPlanoContas(): Promise<PlanoDeContas[]> {
  return apiFetch('/api/plano-contas/')
}

export function criarContaContabil(dados: {
  codigo_contabil: string
  descricao_conta: string
  tipo: string
  codigo_contabil_pai?: string | null
}): Promise<{ mensagem: string; id_conta: number }> {
  return apiFetch('/plano-contas/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function atualizarContaContabil(
  idConta: number,
  dados: {
    codigo_contabil: string
    descricao_conta: string
    tipo: string
    codigo_contabil_pai?: string | null
  },
): Promise<{ mensagem: string; id_conta: number }> {
  return apiFetch(`/api/plano-contas/${idConta}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function excluirContaContabil(
  idConta: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/plano-contas/${idConta}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Financeiro: Centros de Custo e Contas Financeiras (backend v3.1, painel v3.1) - "quanto custou
// o projeto X" e saldo por caixa/banco calculado sempre pela soma das partidas (nunca campo
// editável) - ver app/services/contabilidade.py::saldo_conta.
// ---------------------------------------------------------------------------
export type CentroDeCusto = {
  id_centro_custo: number
  codigo: string
  nome: string
  id_projeto: number | null
  ativo: boolean
  saldo_restrito: boolean
}

export function listarCentrosCusto(): Promise<CentroDeCusto[]> {
  return apiFetch('/api/centros-custo/')
}

export function criarCentroCusto(dados: {
  codigo: string
  nome: string
  id_projeto?: number
}): Promise<{ mensagem: string; id_centro_custo: number }> {
  return apiFetch('/api/centros-custo/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function alternarCentroCusto(
  idCentroCusto: number,
  ativo: boolean,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/centros-custo/${idCentroCusto}/ativo?ativo=${ativo}`, {
    method: 'PUT',
  })
}

// v3.4 - destinação restrita (doação com finalidade específica, ver Doações): centro de custo
// "restrito" bloqueia aprovação de compra (v3.3) se o saldo não cobrir, exigindo remanejamento
// formal antes de gastar em outra finalidade.
export function alternarSaldoRestrito(
  idCentroCusto: number,
  saldoRestrito: boolean,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/centros-custo/${idCentroCusto}/saldo-restrito?saldo_restrito=${saldoRestrito}`,
    { method: 'PUT' },
  )
}

export function obterSaldoRestrito(
  idCentroCusto: number,
): Promise<{ saldo_disponivel: number }> {
  return apiFetch(`/api/centros-custo/${idCentroCusto}/saldo-restrito`)
}

export type RemanejamentoDestinacao = {
  id_remanejamento: number
  id_centro_custo_origem: number
  id_centro_custo_destino: number
  valor: number
  motivo: string
  data_remanejamento: string | null
}

export function listarRemanejamentosDestinacao(): Promise<
  RemanejamentoDestinacao[]
> {
  return apiFetch('/api/remanejamentos-destinacao/')
}

export function registrarRemanejamentoDestinacao(dados: {
  id_centro_custo_origem: number
  id_centro_custo_destino: number
  valor: number
  motivo: string
}): Promise<{ mensagem: string; id_remanejamento: number }> {
  return apiFetch('/api/remanejamentos-destinacao/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// v3.4 - doações, captação e recibos. Doação monetária vira título/lançamento de verdade e um
// recibo numerado, emitido automaticamente no registro.
export type CampanhaArrecadacao = {
  id_campanha: number
  titulo: string
  descricao: string | null
  meta_valor: number
  prazo: string | null
  id_centro_custo: number | null
  ativa: boolean
  valor_arrecadado: number
}

export function listarCampanhasArrecadacao(): Promise<CampanhaArrecadacao[]> {
  return apiFetch('/api/campanhas-arrecadacao/')
}

export function criarCampanhaArrecadacao(dados: {
  titulo: string
  descricao?: string
  meta_valor: number
  prazo?: string
  id_centro_custo?: number
}): Promise<{ mensagem: string; id_campanha: number }> {
  return apiFetch('/api/campanhas-arrecadacao/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function alternarCampanhaArrecadacao(
  idCampanha: number,
  ativa: boolean,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/campanhas-arrecadacao/${idCampanha}/ativa?ativa=${ativa}`,
    {
      method: 'PUT',
    },
  )
}

export type Doacao = {
  id_doacao: number
  anonima: boolean
  nome_doador: string | null
  documento_doador: string | null
  id_associado: number | null
  tipo_doacao: string
  recorrente: boolean
  valor: number
  descricao_bem: string | null
  id_campanha: number | null
  id_centro_custo_destinacao: number | null
  numero_recibo: number | null
  id_titulo: number | null
  data_doacao: string | null
}

export function listarDoacoes(idCampanha?: number): Promise<Doacao[]> {
  const query = idCampanha ? `?id_campanha=${idCampanha}` : ''
  return apiFetch(`/api/doacoes/${query}`)
}

export function registrarDoacao(dados: {
  anonima: boolean
  nome_doador?: string
  documento_doador?: string
  id_associado?: number
  tipo_doacao: string
  recorrente: boolean
  valor: number
  descricao_bem?: string
  id_campanha?: number
  id_centro_custo_destinacao?: number
  id_conta_contabil: number
  id_conta_contabil_caixa?: number
}): Promise<{
  mensagem: string
  id_doacao: number
  numero_recibo: number | null
}> {
  return apiFetch('/api/doacoes/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function obterReciboDoacao(
  idDoacao: number,
): Promise<{ texto: string }> {
  return apiFetch(`/api/doacoes/${idDoacao}/recibo`)
}

export type ContaFinanceira = {
  id_conta_financeira: number
  id_conta: number
  codigo_contabil: string | null
  descricao_conta: string | null
  tipo_conta_financeira: string
  banco: string | null
  agencia: string | null
  numero_conta: string | null
  ativo: boolean
  saldo: number
}

export function listarContasFinanceiras(): Promise<ContaFinanceira[]> {
  return apiFetch('/api/contas-financeiras/')
}

export function criarContaFinanceira(dados: {
  id_conta: number
  tipo_conta_financeira: string
  banco?: string
  agencia?: string
  numero_conta?: string
}): Promise<{ mensagem: string; id_conta_financeira: number }> {
  return apiFetch('/api/contas-financeiras/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// v3.1 - comprovante (anexo obrigatório configurável por tipo de conta - ver
// app/services/contabilidade.py::exige_comprovante). Upload em duas etapas (envia o arquivo,
// recebe o caminho, referencia o caminho na baixa/transferência) - mesmo padrão de
// `enviarFotoAssociado`, mas devolvendo o caminho em vez de já gravar em um registro.
export function enviarComprovante(
  arquivo: File,
): Promise<{ comprovante: string }> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)
  return apiFetch('/api/comprovantes/', { method: 'POST', body: formData })
}

export function criarTransferencia(dados: {
  id_conta_financeira_origem: number
  id_conta_financeira_destino: number
  valor: number
  historico: string
  id_centro_custo?: number
  data_competencia?: string
  comprovante?: string
}): Promise<{
  mensagem: string
  id_lancamento: number
  numero_sequencial: number
}> {
  return apiFetch('/api/transferencias/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type Fornecedor = {
  id_fornecedor: number
  razao_social: string
  cnpj: string
  categoria_servico: string
  telefone: string
  situacao_cadastral: string | null
  data_ultima_validacao_cadastral: string | null
}

export function listarFornecedores(): Promise<Fornecedor[]> {
  return apiFetch('/api/fornecedores/')
}

export function criarFornecedor(dados: {
  razao_social: string
  cnpj: string
  categoria_servico: string
  telefone: string
}): Promise<{ mensagem: string; id_fornecedor: number }> {
  return apiFetch('/fornecedores/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function atualizarFornecedor(
  idFornecedor: number,
  dados: {
    razao_social: string
    cnpj: string
    categoria_servico: string
    telefone: string
  },
): Promise<{ mensagem: string; id_fornecedor: number }> {
  return apiFetch(`/api/fornecedores/${idFornecedor}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

// v3.3 - validação automática de situação cadastral (API pública "Minha Receita") e dados
// bancários versionados com segundo aprovador obrigatório - a alteração de dados bancários de
// fornecedor é o golpe mais comum contra organizações, a defesa é processual.
export function validarSituacaoCadastral(idFornecedor: number): Promise<{
  situacao_cadastral: string
  data_ultima_validacao_cadastral: string | null
}> {
  return apiFetch(
    `/api/fornecedores/${idFornecedor}/validar-situacao-cadastral`,
    {
      method: 'POST',
    },
  )
}

export type DadosBancariosFornecedor = {
  id_dados_bancarios: number
  banco: string
  agencia: string
  conta: string
  tipo_conta: string
  titular: string
  status: string
  id_usuario_solicitante: number | null
  id_usuario_aprovador: number | null
  motivo_rejeicao: string | null
  data_solicitacao: string | null
  data_aprovacao: string | null
}

export function listarDadosBancariosFornecedor(
  idFornecedor: number,
): Promise<DadosBancariosFornecedor[]> {
  return apiFetch(`/api/fornecedores/${idFornecedor}/dados-bancarios`)
}

export function solicitarDadosBancariosFornecedor(dados: {
  id_fornecedor: number
  banco: string
  agencia: string
  conta: string
  tipo_conta: string
  titular: string
}): Promise<{ mensagem: string; id_dados_bancarios: number }> {
  return apiFetch('/api/fornecedores/dados-bancarios', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function aprovarDadosBancariosFornecedor(
  idDadosBancarios: number,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/fornecedores/dados-bancarios/${idDadosBancarios}/aprovar`,
    {
      method: 'POST',
    },
  )
}

export function rejeitarDadosBancariosFornecedor(
  idDadosBancarios: number,
  motivo: string,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/fornecedores/dados-bancarios/${idDadosBancarios}/rejeitar`,
    {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    },
  )
}

// v3.3 - alçadas de aprovação (faixa de valor -> cargo(s) autorizados + dupla assinatura) e
// delegação temporária rastreável.
export type AlcadaAprovacao = {
  id_alcada: number
  valor_minimo: number
  valor_maximo: number | null
  cargos_autorizados: string[]
  exige_dupla_assinatura: boolean
  ativo: boolean
}

export function listarAlcadasAprovacao(): Promise<AlcadaAprovacao[]> {
  return apiFetch('/api/alcadas-aprovacao/')
}

export function criarAlcadaAprovacao(dados: {
  valor_minimo: number
  valor_maximo?: number | null
  cargos_autorizados: string[]
  exige_dupla_assinatura: boolean
}): Promise<{ mensagem: string; id_alcada: number }> {
  return apiFetch('/api/alcadas-aprovacao/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function alternarAlcadaAprovacao(
  idAlcada: number,
  ativo: boolean,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/alcadas-aprovacao/${idAlcada}/ativo?ativo=${ativo}`, {
    method: 'PUT',
  })
}

export type DelegacaoAprovacao = {
  id_delegacao: number
  id_associado_delegante: number
  id_associado_delegado: number
  data_inicio: string
  data_fim: string
  motivo: string
}

export function listarDelegacoesAprovacao(): Promise<DelegacaoAprovacao[]> {
  return apiFetch('/api/delegacoes-aprovacao/')
}

export function criarDelegacaoAprovacao(dados: {
  id_associado_delegante: number
  id_associado_delegado: number
  data_fim: string
  motivo: string
}): Promise<{ mensagem: string; id_delegacao: number }> {
  return apiFetch('/api/delegacoes-aprovacao/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// v3.3 - fluxo de compras: solicitação → cotação (acima de valor configurado) → aprovação por
// alçada → pagamento (título "A Pagar" de sempre) → conciliação.
export type SolicitacaoCompra = {
  id_solicitacao: number
  descricao: string
  justificativa: string | null
  id_fornecedor: number | null
  valor_estimado: number
  id_conta_contabil: number
  id_centro_custo: number | null
  status: string
  id_usuario_solicitante: number | null
  motivo_reprovacao: string | null
  id_titulo_gerado: number | null
  data_solicitacao: string | null
}

export function listarSolicitacoesCompra(
  status?: string,
): Promise<SolicitacaoCompra[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiFetch(`/api/solicitacoes-compra/${query}`)
}

export function criarSolicitacaoCompra(dados: {
  descricao: string
  justificativa?: string
  id_fornecedor?: number
  valor_estimado: number
  id_conta_contabil: number
  id_centro_custo?: number
}): Promise<{ mensagem: string; id_solicitacao: number }> {
  return apiFetch('/api/solicitacoes-compra/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type CotacaoCompra = {
  id_cotacao: number
  id_fornecedor: number
  valor: number
  anexo: string | null
  data_cotacao: string | null
}

export function listarCotacoesCompra(
  idSolicitacao: number,
): Promise<CotacaoCompra[]> {
  return apiFetch(`/api/solicitacoes-compra/${idSolicitacao}/cotacoes`)
}

export function registrarCotacaoCompra(
  idSolicitacao: number,
  dados: { id_fornecedor: number; valor: number; anexo?: string },
): Promise<{ mensagem: string; id_cotacao: number }> {
  return apiFetch(`/api/solicitacoes-compra/${idSolicitacao}/cotacoes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function aprovarSolicitacaoCompra(idSolicitacao: number): Promise<{
  mensagem: string
  status?: string
  aprovacoes?: number
  aprovacoes_exigidas?: number
  id_titulo_gerado?: number
}> {
  return apiFetch(`/api/solicitacoes-compra/${idSolicitacao}/aprovar`, {
    method: 'POST',
  })
}

export function reprovarSolicitacaoCompra(
  idSolicitacao: number,
  motivo: string,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/solicitacoes-compra/${idSolicitacao}/reprovar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

// v3.3 - reembolso de despesa de voluntário/dirigente: comprovante obrigatório, aprovação
// (segregação de funções), pagamento (título "A Pagar" de sempre).
export type ReembolsoDespesa = {
  id_reembolso: number
  id_associado: number
  descricao: string
  valor: number
  comprovante: string
  status: string
  id_usuario_solicitante: number | null
  id_usuario_aprovador: number | null
  motivo_reprovacao: string | null
  id_titulo_gerado: number | null
  data_solicitacao: string | null
}

export function listarReembolsosDespesa(
  idAssociado?: number,
): Promise<ReembolsoDespesa[]> {
  const query = idAssociado ? `?id_associado=${idAssociado}` : ''
  return apiFetch(`/api/reembolsos-despesa/${query}`)
}

export function solicitarReembolsoDespesa(dados: {
  id_associado: number
  descricao: string
  valor: number
  comprovante: string
  id_conta_contabil: number
}): Promise<{ mensagem: string; id_reembolso: number }> {
  return apiFetch('/api/reembolsos-despesa/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function aprovarReembolsoDespesa(
  idReembolso: number,
): Promise<{ mensagem: string; id_titulo_gerado: number }> {
  return apiFetch(`/api/reembolsos-despesa/${idReembolso}/aprovar`, {
    method: 'POST',
  })
}

export function reprovarReembolsoDespesa(
  idReembolso: number,
  motivo: string,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/reembolsos-despesa/${idReembolso}/reprovar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

// v3.3 - contas a pagar recorrentes (aluguel, energia, contador), geração mensal idempotente
// espelhando "Gerar Cobranças" pro lado "A Pagar".
export type ContaAPagarRecorrente = {
  id_conta_recorrente: number
  descricao: string
  valor: number
  id_conta_contabil: number
  id_fornecedor: number | null
  dia_vencimento: number
  ativo: boolean
}

export function listarContasAPagarRecorrentes(): Promise<
  ContaAPagarRecorrente[]
> {
  return apiFetch('/api/contas-a-pagar-recorrentes/')
}

export function criarContaAPagarRecorrente(dados: {
  descricao: string
  valor: number
  id_conta_contabil: number
  id_fornecedor?: number
  dia_vencimento: number
}): Promise<{ mensagem: string; id_conta_recorrente: number }> {
  return apiFetch('/api/contas-a-pagar-recorrentes/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function alternarContaAPagarRecorrente(
  idContaRecorrente: number,
  ativo: boolean,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/contas-a-pagar-recorrentes/${idContaRecorrente}/ativo?ativo=${ativo}`,
    {
      method: 'PUT',
    },
  )
}

export type PrevisaoContasAPagar = {
  competencia: string
  confirmado: boolean
  total_gerados: number
  total_ja_existentes: number
  valor_total: number
  detalhes: { id_conta_recorrente: number; descricao: string; valor: number }[]
}

export function gerarContasAPagarRecorrentes(
  competencia: string,
  confirmar: boolean,
): Promise<PrevisaoContasAPagar> {
  return apiFetch('/api/contas-a-pagar-recorrentes/gerar/', {
    method: 'POST',
    body: JSON.stringify({ competencia, confirmar }),
  })
}

export type Exercicio = {
  id_exercicio: number
  ano: number
  status: string
  data_abertura: string
  data_fechamento: string | null
}

export function listarExercicios(): Promise<Exercicio[]> {
  return apiFetch('/api/exercicios/')
}

export function abrirExercicio(dados: {
  ano: number
}): Promise<{ mensagem: string; id_exercicio: number }> {
  return apiFetch('/api/exercicios/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function fecharExercicio(
  idExercicio: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/exercicios/${idExercicio}/fechar`, {
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// Financeiro: Títulos e baixa (backend v2.6/v3.0, painel v2.5.9) - lançar título (a
// pagar/a receber) e dar baixa nele. Tipos dedicados (não reaproveita `TituloFinanceiroCF`
// acima): o endpoint de GESTÃO (`GET /api/titulos/`) já devolve `conta_contabil`/`beneficiario`
// resolvidos como texto, formato diferente do endpoint de LEITURA do Conselho Fiscal (que
// devolve `id_associado`/`id_fornecedor` crus). Estorno de lançamento fica pra v2.5.10 (Razão
// Contábil), fora do escopo desta versão.
// ---------------------------------------------------------------------------
export type TituloFinanceiro = {
  id_titulo: number
  tipo_titulo: string
  id_associado: number | null
  descricao: string
  conta_contabil: string
  beneficiario: string
  valor_original: number
  saldo_devedor: number
  data_vencimento: string
  status: string
  // v3.2.3 - título-bloco (pagamento antecipado): `competencia_fim` só existe nele, nunca num
  // título normal (um mês só).
  competencia: string | null
  competencia_fim: string | null
}

export function listarTitulos(filtros?: {
  status?: string
  tipo_titulo?: string
}): Promise<TituloFinanceiro[]> {
  const params = new URLSearchParams()
  if (filtros?.status) params.set('status', filtros.status)
  if (filtros?.tipo_titulo) params.set('tipo_titulo', filtros.tipo_titulo)
  const query = params.toString()
  return apiFetch(`/api/titulos/${query ? `?${query}` : ''}`)
}

export function criarTitulo(dados: {
  tipo_titulo: string
  id_conta_contabil: number
  id_associado?: number
  id_fornecedor?: number
  descricao: string
  valor_original: number
  data_vencimento: string
}): Promise<{ mensagem: string; id_titulo: number }> {
  return apiFetch('/titulos/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function baixarTitulo(dados: {
  id_titulo: number
  valor_pago: number
  forma_pagamento: string
  id_conta_contabil_contrapartida: number
  id_centro_custo?: number
  data_competencia?: string
  comprovante?: string
}): Promise<{
  mensagem: string
  saldo_restante: number
  id_lancamento: number
  numero_sequencial: number
}> {
  return apiFetch('/baixar-titulo/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// Financeiro: Razão Contábil - extrato e estorno (backend v3.0, painel v2.5.10) - último bloco
// do módulo Financeiro. Tipos dedicados (mesmo motivo de Títulos): o endpoint de GESTÃO
// (`GET /api/livro-caixa/`) devolve mais campos que o `LancamentoContabilCF` do Conselho Fiscal
// (`id_exercicio`, `motivo_estorno`, `id_lancamento_estorno` - o CF não precisa disso pra só
// ler). Lançamento é IMUTÁVEL (`app/routers/financeiro.py`, comentário do próprio backend) -
// corrigir é sempre estornar (motivo obrigatório) + lançar de novo, nunca editar/apagar.
// ---------------------------------------------------------------------------
export type PartidaContabil = {
  id_conta: number
  conta_contabil: string
  tipo_partida: string
  valor: number
  id_centro_custo: number | null
}

export type LancamentoContabil = {
  id_lancamento: number
  numero_sequencial: number
  id_exercicio: number
  id_titulo: number | null
  data: string | null
  data_competencia: string | null
  historico: string
  tipo_origem: string
  forma_pagamento: string | null
  comprovante: string | null
  estornado: boolean
  motivo_estorno: string | null
  id_lancamento_estorno: number | null
  partidas: PartidaContabil[]
}

export function listarLivroCaixa(): Promise<{
  lancamentos: LancamentoContabil[]
  saldo_contas_ativo: number
}> {
  return apiFetch('/api/livro-caixa/')
}

export function estornarLancamento(
  idLancamento: number,
  motivo: string,
): Promise<{
  mensagem: string
  id_lancamento_estorno: number
  numero_sequencial: number
}> {
  return apiFetch(`/api/lancamentos/${idLancamento}/estornar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

// ---------------------------------------------------------------------------
// Financeiro: Mensalidades e cobrança recorrente (backend v3.2, painel v3.2) - Plano de
// Contribuição (com valor vigente versionado), isenção/desconto, geração de cobrança em lote
// (idempotente por competência), Pix estático (copia e cola) e crédito de associado (pagamento
// a maior). "Cobrança" é sempre um `TituloFinanceiro` "A Receber" por baixo - a tela de Títulos
// (v2.5.9) continua sendo onde se dá baixa nelas.
// ---------------------------------------------------------------------------
export type PlanoDeContribuicao = {
  id_plano: number
  categoria: string
  descricao: string
  periodicidade: string
  dia_vencimento: number
  cobranca_por_nucleo_familiar: boolean
  id_conta_contabil: number
  ativo: boolean
  valor_vigente: number | null
}

export function listarPlanosContribuicao(): Promise<PlanoDeContribuicao[]> {
  return apiFetch('/api/planos-contribuicao/')
}

export function criarPlanoContribuicao(dados: {
  categoria: string
  descricao: string
  periodicidade: string
  dia_vencimento: number
  cobranca_por_nucleo_familiar: boolean
  id_conta_contabil: number
  valor_inicial: number
}): Promise<{ mensagem: string; id_plano: number }> {
  return apiFetch('/api/planos-contribuicao/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function reajustarPlanoContribuicao(
  idPlano: number,
  dados: { valor: number; data_vigencia_inicio: string; motivo: string },
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/planos-contribuicao/${idPlano}/reajustar`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type IsencaoContribuicao = {
  id_isencao: number
  id_associado: number
  id_plano: number | null
  motivo: string
  percentual_desconto: number
  data_inicio: string | null
  data_fim: string | null
}

export function listarIsencoesContribuicao(
  idAssociado?: number,
): Promise<IsencaoContribuicao[]> {
  const query = idAssociado ? `?id_associado=${idAssociado}` : ''
  return apiFetch(`/api/isencoes-contribuicao/${query}`)
}

export function criarIsencaoContribuicao(dados: {
  id_associado: number
  id_plano?: number
  motivo: string
  percentual_desconto: number
  data_fim?: string
}): Promise<{ mensagem: string; id_isencao: number }> {
  return apiFetch('/api/isencoes-contribuicao/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type PrevisaoCobranca = {
  competencia: string
  confirmado: boolean
  total_gerados: number
  total_ja_existentes: number
  total_dependentes_pulados: number
  total_isentos_totais: number
  // v3.2.3 - associado já coberto por um título-bloco (pagamento antecipado) nesta competência -
  // geração mensal normal pula, pra nunca cobrar o mesmo mês duas vezes.
  total_cobertos_por_bloco: number
  valor_total: number
  detalhes: {
    id_associado: number
    nome: string
    id_plano: number
    descricao_plano: string
    valor: number
  }[]
  // v3.2.3 - reconhecimento de receita diferida desta competência (fatia mensal de título-bloco
  // já pago) - só populado quando `confirmar=true`.
  reconhecimentos_receita_diferida: {
    id_titulo: number
    competencia: string
    valor: number
    id_lancamento: number
  }[]
}

export function gerarCobrancas(
  competencia: string,
  confirmar: boolean,
): Promise<PrevisaoCobranca> {
  return apiFetch('/api/contribuicoes/gerar-cobrancas/', {
    method: 'POST',
    body: JSON.stringify({ competencia, confirmar }),
  })
}

// v3.2.3 - campanha de desconto por pagamento antecipado em bloco (semestral/anual,
// configurável), versionada como reajuste de mensalidade: nunca edita a anterior, sempre cria
// uma vigência nova. Título-bloco gerado a partir dela guarda a referência congelada, então
// mudar a campanha aqui nunca afeta quem já pagou.
export type CampanhaDescontoAntecipado = {
  id_campanha: number
  percentual_desconto: number
  quantidade_meses: number
  meses_gatilho: number[]
  id_conta_contabil_receita_diferida: number
  motivo: string | null
  ativo: boolean
  data_vigencia_inicio: string | null
  data_vigencia_fim: string | null
}

export function listarCampanhasDescontoAntecipado(): Promise<
  CampanhaDescontoAntecipado[]
> {
  return apiFetch('/api/campanhas-desconto-antecipado/')
}

export function criarCampanhaDescontoAntecipado(dados: {
  percentual_desconto: number
  quantidade_meses: number
  meses_gatilho: number[]
  id_conta_contabil_receita_diferida: number
  motivo?: string
}): Promise<{ mensagem: string; id_campanha: number }> {
  return apiFetch('/api/campanhas-desconto-antecipado/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function alternarCampanhaDescontoAntecipado(
  idCampanha: number,
  ativo: boolean,
): Promise<{ mensagem: string }> {
  return apiFetch(
    `/api/campanhas-desconto-antecipado/${idCampanha}/ativo?ativo=${ativo}`,
    { method: 'PUT' },
  )
}

export function gerarCobrancaBloco(dados: {
  id_associado: number
  id_plano_contribuicao: number
  competencia_inicio: string
}): Promise<{
  mensagem: string
  id_titulo: number
  competencia: string
  competencia_fim: string
  valor_original: number
}> {
  return apiFetch('/api/titulos/gerar-cobranca-bloco', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// v3.2.2 - negociação/parcelamento de débito em atraso: título original nunca é editado/apagado
// (ganha status "Renegociado"), parcelas novas nascem como título "A Receber" normal. Termo de
// confissão de dívida em texto - assinatura eletrônica fica pra FASE 20 (ainda não existe).
export type NegociacaoDivida = {
  id_negociacao: number
  id_associado: number
  valor_total: number
  quantidade_parcelas: number
  termo: string
  data_negociacao: string | null
}

export function listarNegociacoesDivida(
  idAssociado?: number,
): Promise<NegociacaoDivida[]> {
  const query = idAssociado ? `?id_associado=${idAssociado}` : ''
  return apiFetch(`/api/negociacoes-divida/${query}`)
}

export function negociarDivida(dados: {
  id_associado: number
  ids_titulos_originais: number[]
  quantidade_parcelas: number
  termo: string
}): Promise<{
  mensagem: string
  id_negociacao: number
  valor_total: number
  quantidade_parcelas: number
}> {
  return apiFetch('/api/negociacoes-divida/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function obterPixTitulo(
  idTitulo: number,
): Promise<{ payload: string; valor: number }> {
  return apiFetch(`/api/titulos/${idTitulo}/pix`)
}

export type CreditoAssociado = {
  id_credito: number
  valor: number
  valor_original: number
  origem: string
  id_titulo_origem: number | null
  data_criacao: string | null
}

export function listarCreditosAssociado(
  idAssociado: number,
): Promise<CreditoAssociado[]> {
  return apiFetch(`/api/creditos-associado/${idAssociado}`)
}

export function aplicarCredito(dados: {
  id_credito: number
  id_titulo: number
  id_conta_contabil_adiantamento: number
}): Promise<{
  mensagem: string
  valor_aplicado: number
  saldo_credito_restante: number
  saldo_devedor_titulo: number
}> {
  return apiFetch('/api/creditos-associado/aplicar', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type SugestaoConciliacao = {
  identificador: string
  data: string
  valor: number
  descricao: string
  sugestoes: {
    id_titulo: number
    descricao: string
    tipo_titulo: string
    saldo_devedor: number
  }[]
}

export function importarExtratoConciliacao(
  arquivo: File,
): Promise<{ transacoes: SugestaoConciliacao[] }> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)
  return apiFetch('/api/conciliacao/importar', {
    method: 'POST',
    body: formData,
  })
}

// ---------------------------------------------------------------------------
// v3.5 (FASE 3) - orçamento anual (realizado x previsto calculado contra o razão contábil, nunca
// guardado em coluna própria), fluxo de caixa projetado e reserva de contingência.
// ---------------------------------------------------------------------------
export type Orcamento = {
  id_orcamento: number
  ano: number
  id_conta_contabil: number
  id_centro_custo: number | null
  valor_previsto: number
  id_deliberacao: number
  realizado: number
  percentual_realizado: number | null
  estourado: boolean
}

export function listarOrcamentos(ano?: number): Promise<Orcamento[]> {
  const query = ano ? `?ano=${ano}` : ''
  return apiFetch(`/api/orcamentos/${query}`)
}

export function criarOrcamento(dados: {
  ano: number
  id_conta_contabil: number
  id_centro_custo?: number
  valor_previsto: number
  id_deliberacao: number
}): Promise<{ mensagem: string; id_orcamento: number }> {
  return apiFetch('/api/orcamentos/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type MesFluxoCaixa = {
  competencia: string
  saldo_inicial: number
  entradas_previstas: number
  saidas_previstas: number
  recorrentes_projetadas: number
  saldo_final: number
}

export function obterFluxoDeCaixa(dados?: {
  competenciaInicial?: string
  horizonteMeses?: number
}): Promise<{ horizonte_meses: number; meses: MesFluxoCaixa[] }> {
  const parametros = new URLSearchParams()
  if (dados?.competenciaInicial)
    parametros.set('competencia_inicial', dados.competenciaInicial)
  if (dados?.horizonteMeses)
    parametros.set('horizonte_meses', String(dados.horizonteMeses))
  const query = parametros.toString() ? `?${parametros.toString()}` : ''
  return apiFetch(`/api/fluxo-de-caixa/${query}`)
}

export type ReservaContingencia = {
  id_reserva: number
  id_conta_financeira: number
  regra_uso: string
  valor_minimo: number | null
  id_deliberacao: number | null
  saldo_atual: number
}

export function listarReservasContingencia(): Promise<ReservaContingencia[]> {
  return apiFetch('/api/reservas-contingencia/')
}

export function criarReservaContingencia(dados: {
  id_conta_financeira: number
  regra_uso: string
  valor_minimo?: number
  id_deliberacao?: number
}): Promise<{ mensagem: string; id_reserva: number }> {
  return apiFetch('/api/reservas-contingencia/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// v3.6 (FASE 3) - demonstrativos financeiros e prestação de contas do exercício, versionada, com
// o parecer do Conselho Fiscal (v2.6) já emitido anexado. Todo relatório é calculado na hora
// contra o razão contábil - sem tabela própria (exceto a prestação de contas, que é um snapshot
// versionado de propósito).
// ---------------------------------------------------------------------------
export type LinhaBalancete = {
  id_conta: number
  codigo_contabil: string
  descricao_conta: string
  tipo: string
  saldo_anterior: number
  debitos_periodo: number
  creditos_periodo: number
  saldo_atual: number
}

export function obterBalancete(periodo: {
  dataInicio: string
  dataFim: string
}): Promise<LinhaBalancete[]> {
  return apiFetch(
    `/api/relatorios/balancete?data_inicio=${periodo.dataInicio}&data_fim=${periodo.dataFim}`,
  )
}

export type LinhaReceitaDespesa = {
  id_conta: number
  codigo_contabil: string
  descricao_conta: string
  tipo: string
  valor_periodo: number
}

export function obterReceitasDespesas(periodo: {
  dataInicio: string
  dataFim: string
}): Promise<LinhaReceitaDespesa[]> {
  return apiFetch(
    `/api/relatorios/receitas-despesas?data_inicio=${periodo.dataInicio}&data_fim=${periodo.dataFim}`,
  )
}

export type LinhaReceitaDespesaCentroCusto = {
  id_centro_custo: number | null
  nome_centro_custo: string
  receitas: number
  despesas: number
  resultado: number
}

export function obterReceitasDespesasPorCentroCusto(periodo: {
  dataInicio: string
  dataFim: string
}): Promise<LinhaReceitaDespesaCentroCusto[]> {
  return apiFetch(
    `/api/relatorios/receitas-despesas-por-centro-custo?data_inicio=${periodo.dataInicio}&data_fim=${periodo.dataFim}`,
  )
}

export type LinhaInadimplencia = {
  id_associado: number
  nome_completo: string
  quantidade_titulos_vencidos: number
  total_devido: number
  dias_atraso_maximo: number
}

export function obterRelatorioInadimplencia(): Promise<LinhaInadimplencia[]> {
  return apiFetch('/api/relatorios/inadimplencia')
}

export type MovimentoExtrato = {
  data: string
  tipo_partida: string
  valor: number
  saldo_apos: number
}

export function obterExtratoContaFinanceira(
  idContaFinanceira: number,
): Promise<{
  id_conta_financeira: number
  saldo_atual: number
  movimentos: MovimentoExtrato[]
}> {
  return apiFetch(
    `/api/relatorios/extrato-conta-financeira/${idContaFinanceira}`,
  )
}

export type LinhaRelatorioProjeto = {
  id_projeto: number
  nome_projeto: string
  id_centro_custo: number
  receitas: number
  despesas: number
  resultado: number
}

export function obterRelatorioPorProjeto(periodo: {
  dataInicio: string
  dataFim: string
}): Promise<LinhaRelatorioProjeto[]> {
  return apiFetch(
    `/api/relatorios/por-projeto?data_inicio=${periodo.dataInicio}&data_fim=${periodo.dataFim}`,
  )
}

export type PrestacaoDeContas = {
  id_prestacao: number
  ano_exercicio: number
  versao: number
  conteudo: string
  id_parecer: number | null
  gerada_em: string | null
}

export function listarPrestacoesDeContas(
  anoExercicio?: number,
): Promise<PrestacaoDeContas[]> {
  const query = anoExercicio ? `?ano_exercicio=${anoExercicio}` : ''
  return apiFetch(`/api/prestacoes-de-contas/${query}`)
}

export function gerarPrestacaoDeContas(
  anoExercicio: number,
): Promise<PrestacaoDeContas> {
  return apiFetch('/api/prestacoes-de-contas/', {
    method: 'POST',
    body: JSON.stringify({ ano_exercicio: anoExercicio }),
  })
}

// ---------------------------------------------------------------------------
// v3.7 (FASE 3) - controles antifraude além do mínimo: relatório de exceção mensal de padrões
// suspeitos (Conselho Fiscal) e fechamento mensal com conciliação obrigatória (divergência
// aberta bloqueia o fechamento). A trava de DELETE no próprio banco (lançamento/log imutáveis
// mesmo pra quem tivesse acesso direto ao banco) não tem UI - é garantia de infraestrutura.
// ---------------------------------------------------------------------------
export type PadraoSuspeito = {
  tipo: string
  descricao: string
  [chave: string]: unknown
}

export function obterPadroesSuspeitos(
  competencia: string,
): Promise<PadraoSuspeito[]> {
  return apiFetch(
    `/api/antifraude/padroes-suspeitos?competencia=${competencia}`,
  )
}

export type FechamentoMensal = {
  id_fechamento: number
  competencia: string
  id_conta_financeira: number
  saldo_sistema: number
  saldo_extrato_bancario: number
  divergencia: number
  id_usuario_conferencia: number | null
  assinado_em: string | null
}

export function listarFechamentosMensais(
  competencia?: string,
): Promise<FechamentoMensal[]> {
  const query = competencia ? `?competencia=${competencia}` : ''
  return apiFetch(`/api/fechamentos-mensais/${query}`)
}

export function fecharMes(dados: {
  competencia: string
  id_conta_financeira: number
  saldo_extrato_bancario: number
}): Promise<FechamentoMensal> {
  return apiFetch('/api/fechamentos-mensais/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// v4.1 (FASE 4) - Projeto como entidade única e configurável: cronograma (status sempre
// derivado, nunca escolhido à mão), equipe com papel, orçamento via centro de custo (reaproveita
// Orcamento, v3.5) e encerramento formal versionado (mesmo padrão de PrestacaoDeContas, v3.6).
// ---------------------------------------------------------------------------
export type Projeto = {
  id_projeto: number
  nome_projeto: string
  descricao: string | null
  tipo_projeto: string | null
  tipo_foco: string
  status: string
  id_associado_responsavel: number | null
  publico_alvo: string | null
  data_inicio: string
  data_fim_prevista: string
  id_centro_custo: number | null
  visibilidade: string
  necessita_alvara_bombeiros: boolean
  status_liberacao: string
}

export function listarProjetos(): Promise<Projeto[]> {
  return apiFetch('/api/projetos/')
}

export function obterProjeto(idProjeto: number): Promise<Projeto> {
  return apiFetch(`/api/projetos/${idProjeto}`)
}

export function criarProjeto(dados: {
  nome_projeto: string
  tipo_foco: string
  necessita_alvara_bombeiros: boolean
  data_inicio: string
  data_fim_prevista: string
  descricao?: string
  tipo_projeto?: string
  id_associado_responsavel?: number
  publico_alvo?: string
  id_centro_custo?: number
  visibilidade: string
}): Promise<{ mensagem: string; id_projeto: number }> {
  return apiFetch('/projetos/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function alterarStatusProjeto(
  idProjeto: number,
  status: string,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/projetos/${idProjeto}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

export type ItemCronograma = {
  id_item: number
  tipo: string
  titulo: string
  id_associado_responsavel: number | null
  prazo: string
  concluido_em: string | null
  status: string
}

export function listarCronograma(idProjeto: number): Promise<ItemCronograma[]> {
  return apiFetch(`/api/projetos/${idProjeto}/cronograma`)
}

export function criarItemCronograma(
  idProjeto: number,
  dados: {
    tipo: string
    titulo: string
    prazo: string
    id_associado_responsavel?: number
  },
): Promise<{ mensagem: string; id_item: number }> {
  return apiFetch(`/api/projetos/${idProjeto}/cronograma`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function concluirItemCronograma(
  idItem: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/cronograma/${idItem}/concluir`, { method: 'POST' })
}

export type MembroEquipeProjeto = {
  id_membro: number
  id_associado: number
  papel: string
  data_inicio: string
  data_fim: string | null
}

export function listarEquipeProjeto(
  idProjeto: number,
): Promise<MembroEquipeProjeto[]> {
  return apiFetch(`/api/projetos/${idProjeto}/equipe`)
}

export function adicionarMembroEquipe(
  idProjeto: number,
  dados: { id_associado: number; papel: string },
): Promise<{ mensagem: string; id_membro: number }> {
  return apiFetch(`/api/projetos/${idProjeto}/equipe`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function encerrarParticipacaoEquipe(
  idMembro: number,
): Promise<{ mensagem: string }> {
  return apiFetch(`/api/equipe-projeto/${idMembro}/encerrar`, {
    method: 'POST',
  })
}

export function obterOrcamentoDoProjeto(
  idProjeto: number,
  ano?: number,
): Promise<Orcamento[]> {
  const query = ano ? `?ano=${ano}` : ''
  return apiFetch(`/api/projetos/${idProjeto}/orcamento${query}`)
}

export type RelatorioFinalProjeto = {
  id_relatorio: number
  versao: number
  conteudo: string
  gerado_em: string | null
}

export function gerarRelatorioFinalProjeto(
  idProjeto: number,
): Promise<RelatorioFinalProjeto> {
  return apiFetch(`/api/projetos/${idProjeto}/relatorio-final`, {
    method: 'POST',
  })
}

export function listarRelatoriosFinaisProjeto(
  idProjeto: number,
): Promise<RelatorioFinalProjeto[]> {
  return apiFetch(`/api/projetos/${idProjeto}/relatorio-final`)
}

// ---------------------------------------------------------------------------
// v4.2 (FASE 4) - Beneficiários e atendimento: beneficiário como papel de Pessoa, vínculo N:N a
// projeto com papel, prontuário de atendimento **visível só pra equipe ativa daquele projeto**
// (dado sensível - a API recusa com 403 quem não está na equipe, mesmo tendo permissão geral de
// projetos), e encaminhamento à rede externa. Frequência usa o motor de presença (v4.0) direto.
// ---------------------------------------------------------------------------
export type Beneficiario = {
  id_beneficiario: number
  id_pessoa: number
  consentimento_lgpd_registrado: boolean
  observacao_consentimento: string | null
  data_consentimento: string | null
}

export function listarBeneficiarios(): Promise<Beneficiario[]> {
  return apiFetch('/api/beneficiarios/')
}

export function criarBeneficiario(dados: {
  id_pessoa?: number
  nome_completo?: string
  consentimento_lgpd_registrado?: boolean
  observacao_consentimento?: string
}): Promise<{ mensagem: string; id_beneficiario: number }> {
  return apiFetch('/api/beneficiarios/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type VinculoBeneficiarioProjeto = {
  id_vinculo: number
  id_beneficiario: number
  papel: string
  atendimento_por_familia: boolean
  data_inicio: string
  data_fim: string | null
}

export function listarBeneficiariosDoProjeto(
  idProjeto: number,
): Promise<VinculoBeneficiarioProjeto[]> {
  return apiFetch(`/api/projetos/${idProjeto}/beneficiarios`)
}

export function vincularBeneficiarioAoProjeto(dados: {
  id_beneficiario: number
  id_projeto: number
  papel: string
  atendimento_por_familia?: boolean
}): Promise<{ mensagem: string; id_vinculo: number }> {
  return apiFetch('/api/beneficiarios-projeto/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type RegistroAtendimento = {
  id_registro: number
  data_atendimento: string
  relato: string
  id_usuario_autor: number | null
}

export function listarAtendimentos(
  idVinculo: number,
): Promise<RegistroAtendimento[]> {
  return apiFetch(`/api/beneficiarios-projeto/${idVinculo}/atendimentos`)
}

export function registrarAtendimento(
  idVinculo: number,
  relato: string,
): Promise<{ mensagem: string; id_registro: number }> {
  return apiFetch(`/api/beneficiarios-projeto/${idVinculo}/atendimentos`, {
    method: 'POST',
    body: JSON.stringify({ relato }),
  })
}

export type EncaminhamentoRedeExterna = {
  id_encaminhamento: number
  tipo_rede: string
  descricao: string
  data_encaminhamento: string
}

export function listarEncaminhamentos(
  idVinculo: number,
): Promise<EncaminhamentoRedeExterna[]> {
  return apiFetch(`/api/beneficiarios-projeto/${idVinculo}/encaminhamentos`)
}

export function registrarEncaminhamento(
  idVinculo: number,
  dados: { tipo_rede: string; descricao: string },
): Promise<{ mensagem: string; id_encaminhamento: number }> {
  return apiFetch(`/api/beneficiarios-projeto/${idVinculo}/encaminhamentos`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// v4.3 (FASE 4) - Reserva de espaço: fluxo instantâneo ou aprovação manual (configurável por
// espaço), conflito de horário reaproveitando o motor de agenda (v4.0), tarifa automática por
// perfil, recorrência com tratamento individual de exceções, cancelamento com taxa por prazo,
// no-show com bloqueio por reincidência e checklist de devolução com avaria. A garantia real de
// conflito sob concorrência é uma EXCLUDE constraint no Postgres - o painel só repassa o erro.
// ---------------------------------------------------------------------------
export type Espaco = {
  id_espaco: number
  nome: string
  tipo: string
  capacidade: number | null
  recursos_disponiveis: string | null
  regras_uso: string | null
  horario_funcionamento_inicio: string | null
  horario_funcionamento_fim: string | null
  exige_aprovacao: boolean
  valor_reserva: number | null
  isento_para_associado_adimplente: boolean
  id_conta_contabil_receita: number | null
  prazo_cancelamento_horas: number
  taxa_cancelamento_tardio: number | null
  limite_no_show_bloqueio: number | null
  ativo: boolean
}

export function listarEspacos(): Promise<Espaco[]> {
  return apiFetch('/api/espacos/')
}

export function criarEspaco(dados: {
  nome: string
  tipo: string
  capacidade?: number
  recursos_disponiveis?: string
  regras_uso?: string
  exige_aprovacao: boolean
  valor_reserva?: number
  isento_para_associado_adimplente: boolean
  id_conta_contabil_receita?: number
  prazo_cancelamento_horas: number
  taxa_cancelamento_tardio?: number
  limite_no_show_bloqueio?: number
}): Promise<{ mensagem: string; id_espaco: number }> {
  return apiFetch('/api/espacos/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export type BloqueioEspaco = {
  id_bloqueio: number
  data_hora_inicio: string
  data_hora_fim: string
  motivo: string
  descricao: string | null
}

export function listarBloqueiosEspaco(
  idEspaco: number,
): Promise<BloqueioEspaco[]> {
  return apiFetch(`/api/espacos/${idEspaco}/bloqueios`)
}

export function criarBloqueioEspaco(
  idEspaco: number,
  dados: {
    data_hora_inicio: string
    data_hora_fim: string
    motivo: string
    descricao?: string
  },
): Promise<{ mensagem: string; id_bloqueio: number }> {
  return apiFetch(`/api/espacos/${idEspaco}/bloqueios`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function obterDisponibilidadeEspaco(
  idEspaco: number,
): Promise<{ data_hora_inicio: string; data_hora_fim: string }[]> {
  return apiFetch(`/api/espacos/${idEspaco}/disponibilidade`)
}

export type ReservaEspaco = {
  id_reserva: number
  id_espaco: number
  id_associado_solicitante: number
  data_hora_inicio: string
  data_hora_fim: string
  finalidade: string
  status: string
  motivo_status: string | null
  id_titulo_cobranca: number | null
  identificador_serie: string | null
}

export function listarReservasEspaco(
  idEspaco: number,
): Promise<ReservaEspaco[]> {
  return apiFetch(`/api/reservas-espaco/?id_espaco=${idEspaco}`)
}

export function criarReservaEspaco(dados: {
  id_espaco: number
  id_associado_solicitante: number
  data_hora_inicio: string
  data_hora_fim: string
  finalidade: string
}): Promise<ReservaEspaco> {
  return apiFetch('/api/reservas-espaco/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function criarReservaRecorrente(dados: {
  id_espaco: number
  id_associado_solicitante: number
  data_hora_inicio: string
  data_hora_fim: string
  finalidade: string
  quantidade_semanas: number
}): Promise<{
  ocorrencias: {
    ocorrencia: number
    sucesso: boolean
    id_reserva?: number
    erro?: string
    data_hora_inicio: string
  }[]
}> {
  return apiFetch('/api/reservas-espaco/recorrente', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function aprovarReserva(idReserva: number): Promise<ReservaEspaco> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/aprovar`, {
    method: 'POST',
  })
}

export function recusarReserva(
  idReserva: number,
  motivo: string,
): Promise<ReservaEspaco> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/recusar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export function cancelarReserva(
  idReserva: number,
  motivo: string,
): Promise<ReservaEspaco> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export function marcarNaoCompareceu(idReserva: number): Promise<ReservaEspaco> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/nao-compareceu`, {
    method: 'POST',
  })
}

export type ChecklistDevolucaoEspaco = {
  condicao_retirada: string | null
  data_retirada: string | null
  condicao_devolucao: string | null
  houve_avaria: boolean | null
  descricao_avaria: string | null
  data_devolucao: string | null
}

export function obterChecklistReserva(
  idReserva: number,
): Promise<ChecklistDevolucaoEspaco | null> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/checklist`)
}

export function registrarRetiradaEspaco(
  idReserva: number,
  condicaoRetirada: string,
): Promise<{ mensagem: string; id_checklist: number }> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/retirada`, {
    method: 'POST',
    body: JSON.stringify({ condicao_retirada: condicaoRetirada }),
  })
}

export function registrarDevolucaoEspaco(
  idReserva: number,
  dados: {
    condicao_devolucao: string
    houve_avaria: boolean
    descricao_avaria?: string
  },
): Promise<{ mensagem: string; houve_avaria: boolean }> {
  return apiFetch(`/api/reservas-espaco/${idReserva}/devolucao`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// v4.4 (FASE 4) - Voluntariado vinculado a projeto: escala com turno/habilidades exigindo termo
// de adesão vigente (v1.6) como trava real, autocandidatura + confirmação do coordenador, troca
// de turno entre voluntários e aprovação de horas pelo coordenador (lastro pro certificado v4.8
// e score de engajamento v11.1, quando existirem).
// ---------------------------------------------------------------------------
export type AlocacaoVoluntario = {
  id_alocacao: number
  id_projeto: number
  id_associado: number
  funcao_desempenhada: string
  id_vaga: number | null
  turno_data_hora_inicio: string | null
  turno_data_hora_fim: string | null
  habilidades_exigidas: string | null
  horas_previstas: number
  horas_realizadas: number
  status: string
}

export type VagaEscalaVoluntario = {
  id_vaga: number
  id_projeto: number
  funcao_desempenhada: string
  habilidades_exigidas: string | null
  turno_data_hora_inicio: string
  turno_data_hora_fim: string
  vagas_disponiveis: number
  horas_previstas: number
}

export type VagaEscalaAberta = VagaEscalaVoluntario & { vagas_livres: number }

export type TrocaTurnoVoluntario = {
  id_troca: number
  id_alocacao: number
  id_associado_substituto: number
  status: string
  motivo: string | null
  criado_em: string | null
  resolvido_em: string | null
}

export type RegistroHorasVoluntariado = {
  id_registro: number
  id_termo: number
  data: string
  horas: number
  descricao_atividade: string | null
  id_projeto: number | null
  id_alocacao: number | null
  status: string
}

export function criarVagaEscala(
  idProjeto: number,
  dados: {
    funcao_desempenhada: string
    turno_data_hora_inicio: string
    turno_data_hora_fim: string
    habilidades_exigidas?: string
    vagas_disponiveis: number
    horas_previstas: number
  },
): Promise<{ mensagem: string; id_vaga: number }> {
  return apiFetch(`/api/projetos/${idProjeto}/vagas-escala`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarVagasEscala(
  idProjeto: number,
): Promise<VagaEscalaVoluntario[]> {
  return apiFetch(`/api/projetos/${idProjeto}/vagas-escala`)
}

export function listarCandidaturasPendentes(
  idProjeto: number,
): Promise<AlocacaoVoluntario[]> {
  return apiFetch(`/api/projetos/${idProjeto}/candidaturas-pendentes`)
}

export function confirmarAlocacao(
  idAlocacao: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/alocacoes/${idAlocacao}/confirmar`, { method: 'POST' })
}

export function recusarAlocacao(
  idAlocacao: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/alocacoes/${idAlocacao}/recusar`, { method: 'POST' })
}

export function cancelarAlocacao(
  idAlocacao: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/alocacoes/${idAlocacao}/cancelar`, { method: 'POST' })
}

export function solicitarTrocaTurno(
  idAlocacao: number,
  dados: { id_associado_substituto: number; motivo?: string },
): Promise<{ mensagem: string; id_troca: number }> {
  return apiFetch(`/api/alocacoes/${idAlocacao}/trocas`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarTrocasTurno(
  idProjeto: number,
): Promise<TrocaTurnoVoluntario[]> {
  return apiFetch(`/api/projetos/${idProjeto}/trocas-turno`)
}

export function confirmarTrocaTurno(
  idTroca: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/trocas-turno/${idTroca}/confirmar`, { method: 'POST' })
}

export function recusarTrocaTurno(
  idTroca: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/trocas-turno/${idTroca}/recusar`, { method: 'POST' })
}

export function listarHorasPendentesDoProjeto(
  idProjeto: number,
): Promise<RegistroHorasVoluntariado[]> {
  return apiFetch(`/api/projetos/${idProjeto}/horas-pendentes`)
}

export function aprovarHorasVoluntariado(
  idRegistro: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/horas-voluntariado/${idRegistro}/aprovar`, {
    method: 'POST',
  })
}

export function recusarHorasVoluntariado(
  idRegistro: number,
): Promise<{ mensagem: string; status: string }> {
  return apiFetch(`/api/horas-voluntariado/${idRegistro}/recusar`, {
    method: 'POST',
  })
}

// -- Autoatendimento do voluntário (nível "Voluntário Externo" não tem permissão "projetos"/
// "associados" nenhuma - estes endpoints exigem só estar autenticado, ver app/routers/
// projetos.py) --
export function listarVagasAbertas(): Promise<VagaEscalaAberta[]> {
  return apiFetch('/api/voluntariado/vagas-abertas')
}

export function candidatarSeAVaga(
  idVaga: number,
): Promise<{ mensagem: string; id_alocacao: number }> {
  return apiFetch(`/api/voluntariado/vagas/${idVaga}/candidatar`, {
    method: 'POST',
  })
}

export function listarMinhaEscala(): Promise<AlocacaoVoluntario[]> {
  return apiFetch('/api/voluntariado/minha-escala')
}

export function listarMeuHistoricoHoras(): Promise<
  RegistroHorasVoluntariado[]
> {
  return apiFetch('/api/voluntariado/meu-historico-horas')
}

export function registrarMinhasHoras(dados: {
  data: string
  horas: number
  descricao_atividade?: string
  id_projeto?: number
  id_alocacao?: number
}): Promise<{ mensagem: string; id_registro: number; status: string }> {
  return apiFetch('/api/voluntariado/horas', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// ---------------------------------------------------------------------------
// v4.5 (FASE 4) - Evento como entidade única e pontual: UM registro só, consumido pelo painel
// (gestão) e pelo site institucional (leitura pública, `/api/publico/eventos`). Sessões
// (programação) e edições recorrentes ligadas entre si (`id_edicao_anterior`). Inscrição
// reaproveita o motor genérico da v4.0 (contexto "Evento"/"SessaoEvento").
// ---------------------------------------------------------------------------
export type Evento = {
  id_evento: number
  titulo: string
  descricao: string | null
  categoria: string
  data_hora_inicio: string
  data_hora_fim: string | null
  id_espaco: number | null
  endereco_avulso: string | null
  id_associado_responsavel: number | null
  vagas: number | null
  gratuito: boolean
  visibilidade: string
  id_edicao_anterior: number | null
}

export type SessaoEvento = {
  id_sessao: number
  id_evento: number
  titulo: string
  descricao: string | null
  data_hora_inicio: string
  data_hora_fim: string | null
  vagas: number | null
}

export function criarEvento(dados: {
  titulo: string
  categoria: string
  data_hora_inicio: string
  descricao?: string
  data_hora_fim?: string
  id_espaco?: number
  endereco_avulso?: string
  id_associado_responsavel?: number
  vagas?: number
  gratuito: boolean
  visibilidade: string
}): Promise<{ mensagem: string; id_evento: number }> {
  return apiFetch('/api/eventos/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarEventos(): Promise<Evento[]> {
  return apiFetch('/api/eventos/')
}

export function obterEvento(idEvento: number): Promise<Evento> {
  return apiFetch(`/api/eventos/${idEvento}`)
}

export function criarSessaoEvento(
  idEvento: number,
  dados: {
    titulo: string
    data_hora_inicio: string
    descricao?: string
    data_hora_fim?: string
    vagas?: number
  },
): Promise<{ mensagem: string; id_sessao: number }> {
  return apiFetch(`/api/eventos/${idEvento}/sessoes`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarSessoesEvento(idEvento: number): Promise<SessaoEvento[]> {
  return apiFetch(`/api/eventos/${idEvento}/sessoes`)
}

export function criarNovaEdicaoEvento(
  idEvento: number,
  dados: { data_hora_inicio: string; data_hora_fim?: string; titulo?: string },
): Promise<{ mensagem: string; id_evento: number }> {
  return apiFetch(`/api/eventos/${idEvento}/nova-edicao`, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function listarEdicoesEvento(idEvento: number): Promise<Evento[]> {
  return apiFetch(`/api/eventos/${idEvento}/edicoes`)
}

export type InscricaoMotor = {
  id_inscricao: number
  id_pessoa: number
  status: string
  id_titulo_cobranca: number | null
  data_inscricao: string
}

export function listarInscricoesDoContexto(
  contextoTipo: string,
  idContexto: number,
): Promise<InscricaoMotor[]> {
  return apiFetch(
    `/api/inscricoes/?contexto_tipo=${encodeURIComponent(contextoTipo)}&id_contexto=${idContexto}`,
  )
}

// -- Autoatendimento (qualquer usuário autenticado vinculado a um associado) --
export function inscreverMeNoEvento(
  idEvento: number,
): Promise<{ mensagem: string; id_inscricao: number; status: string }> {
  return apiFetch(`/api/eventos/${idEvento}/inscricao`, { method: 'POST' })
}

export function inscreverMeNaSessaoEvento(
  idSessao: number,
): Promise<{ mensagem: string; id_inscricao: number; status: string }> {
  return apiFetch(`/api/eventos/sessoes/${idSessao}/inscricao`, {
    method: 'POST',
  })
}

export type MinhaInscricaoEvento = {
  id_inscricao: number
  contexto_tipo: string
  id_contexto: number
  status: string
  data_inscricao: string
}

export function listarMinhasInscricoesEmEventos(): Promise<
  MinhaInscricaoEvento[]
> {
  return apiFetch('/api/eventos/minhas-inscricoes')
}
