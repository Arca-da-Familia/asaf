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
