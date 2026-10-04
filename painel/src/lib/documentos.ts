import { apiFetch, apiFetchBlob } from './api'

// v5.4a - Documentos institucionais: a biblioteca onde ata, estatuto, certidão, balanço e termo moram. Cada documento
// tem um ORIGINAL (privado, pode ter RG/CPF) e, para ir ao site de transparência, uma VERSÃO PÚBLICA com os dados
// pessoais cobertos, verificada por máquina e aprovada por OUTRA pessoa (Presidente ou Secretário).

export type Classificacao = 'Pública' | 'Interna' | 'Restrita'
export type Situacao = 'Rascunho' | 'Em revisão' | 'Aprovado' | 'Retirado'

export type AchadoDaVerificacao = {
  codigo: string
  mensagem: string
  pagina: number | null
  // Sempre mascarada pelo servidor (ex.: 111.***.***-35): o dado inteiro nunca chega aqui.
  amostra: string | null
}

export type ResultadoDaVerificacao = {
  ok: boolean
  paginas: number
  caracteres: number
  bloqueios: AchadoDaVerificacao[]
  avisos: AchadoDaVerificacao[]
}

export type Documento = {
  id_documento: number
  tipo: string
  tipo_rotulo: string
  titulo: string
  descricao: string | null
  data_documento: string | null
  ano: number | null
  validade: string | null
  classificacao: Classificacao
  publicar_no_site: boolean
  vinculo_tipo: string | null
  vinculo_id: number | null
  grupo_versao: string
  versao: number
  vigente: boolean
  tem_original: boolean
  original_nome_arquivo: string | null
  original_tamanho: number | null
  original_sha256: string | null
  tem_versao_publica: boolean
  // "PDF" (arquivo com texto pesquisável) ou "TEXTO" (o próprio texto, colado no sistema); nulo = ainda não há.
  publico_formato: 'PDF' | 'TEXTO' | null
  publico_tamanho: number | null
  publico_paginas: number | null
  publico_sha256: string | null
  verificacao: ResultadoDaVerificacao | null
  verificacao_em: string | null
  situacao: Situacao
  enviado_revisao_em: string | null
  aprovado_em: string | null
  motivo_recusa: string | null
  recusado_em: string | null
  motivo_retirada: string | null
  retirado_em: string | null
  criado_em: string | null
  atualizado_em: string | null
  pode_baixar_original: boolean
  pode_editar: boolean
  pode_aprovar: boolean
  pode_retirar: boolean
}

export type TiposDeDocumento = {
  tipos: { codigo: string; rotulo: string }[]
  classificacoes: Classificacao[]
  situacoes: Situacao[]
  vinculos: string[]
}

export type EventoDaTrilha = {
  acao: string
  rotulo: string
  quando: string
  quem: string | null
  detalhes: Record<string, unknown>
}

export type FiltrosDeDocumentos = {
  busca?: string
  tipo?: string
  ano?: string
  situacao?: string
  classificacao?: string
  vigente?: boolean
  grupo_versao?: string
}

export type DadosDoDocumento = {
  tipo: string
  titulo: string
  descricao?: string
  classificacao: Classificacao
  publicar_no_site: boolean
  data_documento?: string
  validade?: string
  ano?: string
  vinculo_tipo?: string
  vinculo_id?: string
}

function consulta(filtros: FiltrosDeDocumentos): string {
  const parametros = new URLSearchParams()
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === undefined || valor === '' || valor === null) continue
    parametros.set(chave, String(valor))
  }
  const texto = parametros.toString()
  return texto ? `?${texto}` : ''
}

export function listarTiposDeDocumento(): Promise<TiposDeDocumento> {
  return apiFetch('/api/documentos/tipos')
}

export function listarDocumentos(
  filtros: FiltrosDeDocumentos = {},
): Promise<Documento[]> {
  return apiFetch(`/api/documentos${consulta(filtros)}`)
}

export function obterDocumento(id: number): Promise<Documento> {
  return apiFetch(`/api/documentos/${id}`)
}

export function listarHistoricoDoDocumento(
  id: number,
): Promise<EventoDaTrilha[]> {
  return apiFetch(`/api/documentos/${id}/historico`)
}

function formularioDoDocumento(
  dados: DadosDoDocumento,
  arquivo?: File | null,
): FormData {
  const form = new FormData()
  form.append('tipo', dados.tipo)
  form.append('titulo', dados.titulo)
  form.append('classificacao', dados.classificacao)
  form.append('publicar_no_site', String(dados.publicar_no_site))
  for (const campo of [
    'descricao',
    'data_documento',
    'validade',
    'ano',
    'vinculo_tipo',
    'vinculo_id',
  ] as const) {
    const valor = dados[campo]
    if (valor) form.append(campo, valor)
  }
  if (arquivo) form.append('arquivo', arquivo)
  return form
}

export function criarDocumento(
  dados: DadosDoDocumento,
  arquivo?: File | null,
): Promise<Documento> {
  return apiFetch('/api/documentos', {
    method: 'POST',
    body: formularioDoDocumento(dados, arquivo),
  })
}

export function editarDocumento(
  id: number,
  dados: Partial<DadosDoDocumento>,
): Promise<Documento> {
  return apiFetch(`/api/documentos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...dados,
      // texto vazio vira "sem valor" no servidor
      ano: dados.ano ? Number(dados.ano) : undefined,
      vinculo_id: dados.vinculo_id ? Number(dados.vinculo_id) : undefined,
    }),
  })
}

function arquivoEmFormulario(arquivo: File): FormData {
  const form = new FormData()
  form.append('arquivo', arquivo)
  return form
}

export function enviarOriginal(id: number, arquivo: File): Promise<Documento> {
  return apiFetch(`/api/documentos/${id}/original`, {
    method: 'POST',
    body: arquivoEmFormulario(arquivo),
  })
}

export type DocumentoComVerificacao = Documento & {
  resultado_da_verificacao: ResultadoDaVerificacao
}

export function enviarVersaoPublica(
  id: number,
  arquivo: File,
): Promise<DocumentoComVerificacao> {
  return apiFetch(`/api/documentos/${id}/versao-publica`, {
    method: 'POST',
    body: arquivoEmFormulario(arquivo),
  })
}

export function enviarVersaoPublicaTexto(
  id: number,
  texto: string,
): Promise<DocumentoComVerificacao> {
  return apiFetch(`/api/documentos/${id}/versao-publica-texto`, {
    method: 'POST',
    body: JSON.stringify({ texto }),
  })
}

export function usarOriginalComoVersaoPublica(
  id: number,
): Promise<DocumentoComVerificacao> {
  return apiFetch(`/api/documentos/${id}/versao-publica/usar-original`, {
    method: 'POST',
  })
}

const acao = (id: number, caminho: string, corpo?: object) =>
  apiFetch<Documento>(`/api/documentos/${id}/${caminho}`, {
    method: 'POST',
    body: corpo ? JSON.stringify(corpo) : undefined,
  })

export const enviarParaRevisao = (id: number) => acao(id, 'enviar-revisao')
export const aprovarDocumento = (id: number) => acao(id, 'aprovar')
export const recusarDocumento = (id: number, motivo: string) =>
  acao(id, 'recusar', { motivo })
export const retirarDocumento = (id: number, motivo: string) =>
  acao(id, 'retirar', { motivo })
export const criarNovaVersao = (id: number) => acao(id, 'nova-versao')
export const tornarVigente = (id: number) => acao(id, 'tornar-vigente')

// O original e a versão pública (antes de aprovada) só saem com o token do usuário: busca o arquivo e entrega ao
// navegador. O original é baixado (nunca aberto na aba: pode ser sigiloso); a versão pública abre para conferir.
function entregarAoNavegador(
  blob: Blob,
  nome: string,
  modo: 'baixar' | 'abrir',
) {
  const url = URL.createObjectURL(blob)
  if (modo === 'abrir') {
    window.open(url, '_blank', 'noopener,noreferrer')
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function baixarOriginal(doc: Documento): Promise<void> {
  const { blob, nomeSugerido } = await apiFetchBlob(
    `/api/documentos/${doc.id_documento}/original`,
  )
  entregarAoNavegador(
    blob,
    nomeSugerido ?? doc.original_nome_arquivo ?? 'original',
    'baixar',
  )
}

// Download autenticado de qualquer caminho da API (ex.: o documento assinado de uma ata). Nunca abre na aba.
export async function baixarArquivoDaApi(
  caminho: string,
  nomePadrao: string,
): Promise<void> {
  const { blob, nomeSugerido } = await apiFetchBlob(caminho)
  entregarAoNavegador(blob, nomeSugerido ?? nomePadrao, 'baixar')
}

export async function abrirVersaoPublica(doc: Documento): Promise<void> {
  const { blob } = await apiFetchBlob(
    `/api/documentos/${doc.id_documento}/versao-publica`,
  )
  entregarAoNavegador(blob, `${doc.titulo}.pdf`, 'abrir')
}

// ---------------------------------------------------------------------------------------------- apresentação
export const CLASSE_DA_SITUACAO: Record<Situacao, string> = {
  Rascunho: 'bg-muted text-muted-foreground',
  'Em revisão': 'bg-amber-100 text-amber-900',
  Aprovado: 'bg-green-100 text-green-900',
  Retirado: 'bg-red-100 text-red-900',
}

export const EXPLICACAO_DA_CLASSIFICACAO: Record<Classificacao, string> = {
  Pública:
    'Pode ser lida por qualquer pessoa. O próprio original pode ir ao site (ex.: estatuto, balanço).',
  Interna:
    'Uso da associação. Só uma versão pública (com os dados pessoais cobertos) pode ir ao site.',
  Restrita:
    'Tem dado pessoal sensível (RG, CPF, endereço). O original só é baixado por quem tem a permissão de originais sigilosos; ao site vai só a versão pública.',
}

export type AlertaDeValidade = 'vencida' | 'vence-em-breve' | null

// Certidão vencida trava convênio e edital sem ninguém ver (PLANO v12.2): avisa 30 dias antes.
export function alertaDeValidade(
  validade: string | null,
  hoje: Date = new Date(),
): AlertaDeValidade {
  if (!validade) return null
  const [ano, mes, dia] = validade.split('-').map(Number)
  if (!ano || !mes || !dia) return null
  const fim = Date.UTC(ano, mes - 1, dia)
  const agora = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const dias = Math.round((fim - agora) / 86_400_000)
  if (dias < 0) return 'vencida'
  return dias <= 30 ? 'vence-em-breve' : null
}

// O que fazer agora, em português simples (a tela mostra no alto do documento).
export function proximoPasso(doc: Documento): string {
  if (!doc.publicar_no_site) {
    return 'Documento interno: fica guardado no sistema e não vai ao site.'
  }
  switch (doc.situacao) {
    case 'Rascunho':
      if (doc.motivo_recusa)
        return `Recusado: ${doc.motivo_recusa} Corrija e envie de novo para revisão.`
      if (!doc.tem_original)
        return 'Envie o arquivo original (ele fica guardado em área privada).'
      if (!doc.tem_versao_publica) {
        return doc.classificacao === 'Pública'
          ? 'Use o original como versão pública (ele será conferido) ou envie outra versão (PDF ou texto).'
          : 'Envie a versão pública: um PDF com os dados pessoais cobertos de verdade ou o próprio texto. Ela será conferida automaticamente.'
      }
      return 'A versão pública passou na conferência. Envie para revisão.'
    case 'Em revisão':
      return doc.pode_aprovar
        ? 'Confira a versão pública e aprove ou recuse a publicação.'
        : 'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).'
    case 'Aprovado':
      return 'Publicado no site de transparência.'
    case 'Retirado':
      return 'Retirado do site. Todo o histórico foi preservado.'
  }
}

export function formatarTamanho(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
