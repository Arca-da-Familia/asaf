import { apiFetch } from './api'
import { formatarMoeda } from './datas'
export { lerValorEmReais } from './valores'
import type { Situacao } from './documentos'

// v5.4a - Parcerias e emendas: o dinheiro vem do livro-caixa (centro de custo exclusivo da parceria), nunca é
// digitado de novo. O que vai ao site é só o que foi aprovado por outra pessoa (Presidente ou Secretário).

export type Achado = { codigo: string; mensagem: string }

export type Parceria = {
  id_parceria: number
  tipo: string
  tipo_rotulo: string
  ano: number
  titulo: string
  objeto: string
  esfera: string | null
  orgao_concedente: string | null
  numero_emenda: string | null
  identificador_unico: string | null
  proponente: string | null
  numero_termo: string | null
  valor_total: number
  data_assinatura: string | null
  vigencia_inicio: string | null
  vigencia_fim: string | null
  situacao: string
  id_centro_custo: number | null
  codigo_centro_custo: string | null
  recebido: number
  pago: number
  saldo: number
  situacao_publicacao: Situacao
  enviado_revisao_em: string | null
  aprovado_em: string | null
  motivo_recusa: string | null
  recusado_em: string | null
  motivo_retirada: string | null
  retirado_em: string | null
  criado_em: string
  atualizado_em: string
  pode_editar: boolean
  pode_enviar_revisao: boolean
  pode_aprovar: boolean
  pode_retirar: boolean
  pode_reabrir: boolean
}

export type Parcela = {
  id_parcela: number
  numero: number
  valor_previsto: number
  data_prevista: string | null
  observacao: string | null
  valor_recebido: number
}

export type FotoDaEtapa = {
  id_foto: number
  id_etapa: number
  alt: string
  largura: number
  altura: number
  tamanho: number
  autorizacao_imagem: boolean
  id_documento_autorizacao: number | null
  criado_em: string
}

export type Etapa = {
  id_etapa: number
  titulo: string
  descricao: string | null
  data_prevista: string | null
  data_realizacao: string | null
  local: string | null
  publico_atendido: number | null
  situacao: string
  fotos: FotoDaEtapa[]
}

export type Relatorio = {
  id_relatorio: number
  tipo: string
  tipo_rotulo: string
  periodo_inicio: string | null
  periodo_fim: string | null
  data_prevista: string | null
  data_apresentacao: string | null
  prazo_analise_dias: number
  data_limite_analise: string | null
  resultado: string
  data_resultado: string | null
  observacao: string | null
}

export type LancamentoClassificado = {
  id_vinculo: number
  id_lancamento: number
  natureza: 'RECEBIMENTO' | 'PAGAMENTO'
  natureza_rotulo: string
  categoria: string | null
  categoria_rotulo: string | null
  descricao_publica: string
  funcao: string | null
  id_parcela: number | null
  parcela_numero: number | null
  data: string | null
  valor: number
  historico: string | null
  estornado: boolean
  fornecedor: { razao_social: string; cnpj: string } | null
}

export type LancamentoPendente = {
  id_lancamento: number
  numero: number
  data: string | null
  historico: string | null
  natureza: 'RECEBIMENTO' | 'PAGAMENTO'
  natureza_rotulo: string
  valor: number
}

export type ParceriaDetalhe = Parceria & {
  total_das_parcelas: number
  parcelas: Parcela[]
  etapas: Etapa[]
  relatorios: Relatorio[]
  lancamentos: LancamentoClassificado[]
  lancamentos_sem_classificacao: LancamentoPendente[]
  consistencia: { bloqueios: Achado[]; avisos: Achado[] }
}

export type Opcoes = {
  tipos: { codigo: string; rotulo: string }[]
  esferas: string[]
  situacoes: string[]
  situacoes_de_publicacao: string[]
  tipos_de_relatorio: { codigo: string; rotulo: string }[]
  resultados: string[]
  situacoes_de_etapa: string[]
  categorias_de_pagamento: { codigo: string; rotulo: string }[]
}

export type EventoDaTrilha = {
  acao: string
  rotulo: string
  quando: string
  quem: string | null
  detalhes: Record<string, unknown>
}

export type FiltrosDeParcerias = {
  busca?: string
  ano?: string
  tipo?: string
  situacao?: string
  situacao_publicacao?: string
}

// ------------------------------------------------------------------------------------------------ API
function consulta(filtros: FiltrosDeParcerias): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtros)) if (v) p.set(k, String(v))
  const texto = p.toString()
  return texto ? `?${texto}` : ''
}

const json = (corpo: object) => JSON.stringify(corpo)

export const opcoesDeParcerias = () => apiFetch<Opcoes>('/api/parcerias/opcoes')
export const listarParcerias = (f: FiltrosDeParcerias = {}) =>
  apiFetch<Parceria[]>(`/api/parcerias${consulta(f)}`)
export const obterParceria = (id: number) =>
  apiFetch<ParceriaDetalhe>(`/api/parcerias/${id}`)
export const historicoDaParceria = (id: number) =>
  apiFetch<EventoDaTrilha[]>(`/api/parcerias/${id}/historico`)

export const criarParceria = (dados: object) =>
  apiFetch<ParceriaDetalhe>('/api/parcerias', {
    method: 'POST',
    body: json(dados),
  })
export const editarParceria = (id: number, dados: object) =>
  apiFetch<ParceriaDetalhe>(`/api/parcerias/${id}`, {
    method: 'PATCH',
    body: json(dados),
  })

const parte = (id: number, caminho: string, metodo: string, corpo?: object) =>
  apiFetch<ParceriaDetalhe>(`/api/parcerias/${id}/${caminho}`, {
    method: metodo,
    body: corpo ? json(corpo) : undefined,
  })

export const criarParcela = (id: number, d: object) =>
  parte(id, 'parcelas', 'POST', d)
export const editarParcela = (id: number, idParcela: number, d: object) =>
  parte(id, `parcelas/${idParcela}`, 'PATCH', d)
export const apagarParcela = (id: number, idParcela: number) =>
  parte(id, `parcelas/${idParcela}`, 'DELETE')

export const criarEtapa = (id: number, d: object) =>
  parte(id, 'etapas', 'POST', d)
export const editarEtapa = (id: number, idEtapa: number, d: object) =>
  parte(id, `etapas/${idEtapa}`, 'PATCH', d)
export const apagarEtapa = (id: number, idEtapa: number) =>
  parte(id, `etapas/${idEtapa}`, 'DELETE')

// Foto: multipart (arquivo + descrição + confirmação da autorização de imagem). O servidor regrava a imagem.
export const enviarFoto = (
  id: number,
  idEtapa: number,
  d: {
    arquivo: File
    alt: string
    autorizacaoImagem: boolean
    idDocumentoAutorizacao?: string
  },
) => {
  const form = new FormData()
  form.append('arquivo', d.arquivo)
  form.append('alt', d.alt)
  form.append('autorizacao_imagem', String(d.autorizacaoImagem))
  if (d.idDocumentoAutorizacao)
    form.append('id_documento_autorizacao', d.idDocumentoAutorizacao)
  return apiFetch<ParceriaDetalhe>(
    `/api/parcerias/${id}/etapas/${idEtapa}/fotos`,
    {
      method: 'POST',
      body: form,
    },
  )
}
export const apagarFoto = (id: number, idFoto: number) =>
  parte(id, `fotos/${idFoto}`, 'DELETE')

export const criarRelatorio = (id: number, d: object) =>
  parte(id, 'relatorios', 'POST', d)
export const editarRelatorio = (id: number, idRelatorio: number, d: object) =>
  parte(id, `relatorios/${idRelatorio}`, 'PATCH', d)
export const apagarRelatorio = (id: number, idRelatorio: number) =>
  parte(id, `relatorios/${idRelatorio}`, 'DELETE')

export const classificarLancamento = (id: number, d: object) =>
  parte(id, 'lancamentos', 'POST', d)
export const corrigirLancamento = (id: number, idVinculo: number, d: object) =>
  parte(id, `lancamentos/${idVinculo}`, 'PATCH', d)
export const desfazerClassificacao = (id: number, idVinculo: number) =>
  parte(id, `lancamentos/${idVinculo}`, 'DELETE')

export const enviarParceriaParaRevisao = (id: number) =>
  parte(id, 'enviar-revisao', 'POST')
export const aprovarParceria = (id: number) => parte(id, 'aprovar', 'POST')
export const recusarParceria = (id: number, motivo: string) =>
  parte(id, 'recusar', 'POST', { motivo })
export const retirarParceria = (id: number, motivo: string) =>
  parte(id, 'retirar', 'POST', { motivo })
export const reabrirParceria = (id: number) => parte(id, 'reabrir', 'POST')

// ------------------------------------------------------------------------------------------ apresentação
// A API devolve valor em reais (número); `formatarMoeda` do projeto trabalha em centavos.
export function moeda(reais: number): string {
  return formatarMoeda(Math.round(reais * 100))
}

export const CLASSE_DO_ALERTA = {
  bloqueio: 'border-destructive/30 bg-destructive/10 text-destructive',
  aviso: 'border-amber-300 bg-amber-50 text-amber-900',
} as const

// O que fazer agora, em português simples (a tela mostra no alto da parceria).
export function proximoPassoDaParceria(d: ParceriaDetalhe): string {
  const pendencias = d.consistencia.bloqueios.length
  switch (d.situacao_publicacao) {
    case 'Rascunho':
      if (pendencias > 0) {
        return `Resolva ${pendencias === 1 ? 'a pendência' : `as ${pendencias} pendências`} abaixo para poder enviar para revisão.`
      }
      if (d.motivo_recusa) {
        return `Recusada: ${d.motivo_recusa} Corrija e envie de novo para revisão.`
      }
      return 'Tudo certo para publicar. Envie para revisão: o Presidente ou o Secretário (outra pessoa) aprova.'
    case 'Em revisão':
      return d.pode_aprovar
        ? 'Confira os dados, as parcelas e os lançamentos, e aprove ou recuse a publicação.'
        : 'Aguardando a aprovação de outra pessoa (Presidente ou Secretário).'
    case 'Aprovado':
      return d.lancamentos_sem_classificacao.length > 0
        ? `Publicada no site. ${d.lancamentos_sem_classificacao.length} lançamento(s) novo(s) do livro-caixa esperam classificação: o site só mostra depois.`
        : 'Publicada no site. Mantenha parcelas, etapas e relatórios em dia.'
    case 'Retirado':
      return 'Retirada do site. Reabra para corrigir e enviar de novo; o histórico fica guardado.'
  }
}

// As telas de detalhe rodam toda ação por aqui: mostra o erro do servidor, atualiza a tela com o detalhe novo e diz
// se deu certo (para o formulário limpar só quando deu).
export type Executar = (
  acao: () => Promise<ParceriaDetalhe>,
) => Promise<boolean>
