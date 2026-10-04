import type {
  AvisoDeNoticia,
  ConfiguracaoDoDirectus,
  NoticiaPublica,
} from './directus.mjs'

export type {
  AvisoDeNoticia,
  ImagemDaNoticia,
  NoticiaPublica,
} from './directus.mjs'

export interface EventoDaLista {
  id_evento: number
  titulo: string
  descricao: string | null
  categoria: string
  /** ISO sem fuso (horário local de Parauapebas). */
  data_hora_inicio: string
  data_hora_fim: string | null
  id_espaco: number | null
  endereco_avulso: string | null
  vagas: number | null
  vagas_livres: number | null
  gratuito: boolean
}

export interface SessaoDoEvento {
  id_sessao: number
  titulo: string
  descricao: string | null
  data_hora_inicio: string
  data_hora_fim: string | null
  vagas: number | null
  vagas_livres: number | null
}

export interface EventoDetalhado extends EventoDaLista {
  sessoes: SessaoDoEvento[]
}

export interface ProjetoPublico {
  id_projeto: number
  nome: string
  descricao: string | null
  tipo_codigo: string | null
  tipo: string | null
  status_codigo: string | null
  status: string | null
  publico_alvo: string | null
  /** "AAAA-MM-DD" */
  data_inicio: string | null
  data_fim_prevista: string | null
}

export interface MembroDaDiretoria {
  orgao_codigo: string
  orgao: string
  cargo_codigo: string
  cargo: string
  nome: string
  data_inicio: string | null
  data_fim_previsto: string | null
}

export interface AssembleiaPublica {
  id_assembleia: number
  tipo: string
  status: string
  pauta: string
  local_fisico: string | null
  /** UTC sem fuso (momento em que o edital foi emitido). */
  convocada_em: string | null
  primeira_convocacao: string
  segunda_convocacao: string
  terceira_convocacao: string
  edital_texto: string
  edital_sha256: string
}

/** Parcela PREVISTA e o que o livro-caixa mostra como recebido dela. */
export interface ParcelaPublica {
  numero: number
  valor_previsto: number
  /** "AAAA-MM-DD" */
  data_prevista: string | null
  valor_recebido: number
}

export interface RecebimentoPublico {
  /** Dia no relógio de Parauapebas, "AAAA-MM-DD". */
  data: string | null
  valor: number
  descricao: string
  parcela: number | null
}

export interface PagamentoPublico {
  data: string | null
  valor: number
  descricao: string
  categoria: 'FORNECEDOR' | 'EQUIPE' | 'TARIFA' | 'OUTRO' | null
  /** Só pagamento de equipe: a função (o nome da pessoa NUNCA vai ao site). */
  funcao: string | null
  /** Só pagamento a fornecedor. */
  fornecedor: { razao_social: string; cnpj: string } | null
}

/** Foto de uma etapa: já tem a autorização de imagem confirmada e o texto alternativo. */
export interface FotoPublica {
  id_foto: number
  alt: string
  largura: number
  altura: number
  /** SHA-256 do JPEG: o build só aceita o arquivo que bater com ele. */
  sha256: string
  /** Caminho na API; o site usa a cópia do build (`caminhoDaFotoDaEtapa`). */
  arquivo: string
}

export interface EtapaPublica {
  titulo: string
  descricao: string | null
  data_prevista: string | null
  data_realizacao: string | null
  local: string | null
  publico_atendido: number | null
  situacao: string
  fotos: FotoPublica[]
}

export interface RelatorioPublico {
  tipo_codigo: string
  tipo: string
  periodo_inicio: string | null
  periodo_fim: string | null
  data_prevista: string | null
  data_apresentacao: string | null
  prazo_analise_dias: number
  data_limite_analise: string | null
  /** "Em análise" | "Regulares" | "Regulares com ressalvas" | "Irregulares" */
  resultado: string
  data_resultado: string | null
}

export interface DocumentoDaParceria {
  id_documento: number
  titulo: string
  tipo: string
  data_documento: string | null
  /** "PDF": o site copia o arquivo; "TEXTO": o site monta uma página com o texto. */
  formato: 'PDF' | 'TEXTO'
  /** Caminho na API do PDF; nulo no formato TEXTO. */
  arquivo: string | null
}

export interface ParceriaPublica {
  id_parceria: number
  tipo_codigo: string
  tipo: string
  ano: number
  titulo: string
  objeto: string
  esfera: string | null
  orgao_concedente: string | null
  numero_emenda: string | null
  identificador_unico: string | null
  proponente: string | null
  numero_termo: string | null
  situacao: string
  valor_total: number
  recebido: number
  pago: number
  data_assinatura: string | null
  vigencia_inicio: string | null
  vigencia_fim: string | null
  /** Movimentos do livro-caixa que ainda não foram detalhados para o site (os totais já os incluem). */
  lancamentos_em_classificacao: number
  /** Instante UTC com `Z`. */
  ultima_atualizacao: string
}

export interface ParceriaDetalhada extends ParceriaPublica {
  parcelas: ParcelaPublica[]
  recebimentos: RecebimentoPublico[]
  pagamentos: PagamentoPublico[]
  etapas: EtapaPublica[]
  relatorios: RelatorioPublico[]
  documentos: DocumentoDaParceria[]
}

/** Documento APROVADO: o site só enxerga a versão pública. */
export interface DocumentoPublico {
  id_documento: number
  tipo_codigo: string
  tipo: string
  titulo: string
  descricao: string | null
  data_documento: string | null
  ano: number | null
  versao: number
  vigente: boolean
  paginas: number | null
  tamanho: number | null
  /** SHA-256 do arquivo aprovado: o build só aceita o PDF que bater com ele. */
  sha256: string
  aprovado_em: string | null
  formato: 'PDF' | 'TEXTO'
  /** Caminho na API do PDF (o site usa a cópia do build); nulo no formato TEXTO. */
  arquivo: string | null
}

export interface DocumentoDetalhado extends DocumentoPublico {
  /** O texto publicado (só no formato TEXTO). */
  texto: string | null
}

export interface ConteudoPublico {
  eventos: EventoDaLista[]
  detalhesDeEventos: Record<number, EventoDetalhado>
  projetos: ProjetoPublico[]
  diretoria: MembroDaDiretoria[]
  assembleias: AssembleiaPublica[]
  /** Parcerias e emendas APROVADAS pela diretoria (v5.4b). */
  parcerias: ParceriaPublica[]
  detalhesDeParcerias: Record<number, ParceriaDetalhada>
  /** Documentos APROVADOS (versão pública) da Transparência (v5.4b). */
  documentos: DocumentoPublico[]
  /** Só dos documentos em formato TEXTO: o texto aprovado (SHA-256 já conferido no build). */
  detalhesDeDocumentos: Record<number, DocumentoDetalhado>
  /** Notícias PUBLICADAS no Directus (editor do site), já validadas e com o HTML limpo. */
  noticias: NoticiaPublica[]
  /** Notícias que NÃO foram publicadas e o motivo (diagnóstico; fora da impressão digital). */
  avisosDeNoticias: AvisoDeNoticia[]
}

export interface OpcoesDeBusca {
  fetchImpl?: typeof fetch
  tentativas?: number
  timeoutMs?: number
  esperaMs?: number
  /** Sobrescreve a configuração do Directus (padrão: variáveis de ambiente). */
  directus?: ConfiguracaoDoDirectus
}

export const ENDPOINTS_DE_LISTA: Record<
  | 'eventos'
  | 'projetos'
  | 'diretoria'
  | 'assembleias'
  | 'parcerias'
  | 'documentos',
  string
>

export function buscarConteudoPublico(
  apiUrl: string,
  opcoes?: OpcoesDeBusca,
): Promise<ConteudoPublico>

export function buscarJson(
  base: string,
  caminho: string,
  opcoes: {
    fetchImpl: typeof fetch
    tentativas: number
    timeoutMs: number
    esperaMs: number
    headers?: Record<string, string>
    rotulo?: string
    /** Como ler a resposta (padrão: JSON). */
    ler?: (resposta: Response) => Promise<unknown>
  },
): Promise<any>

/** Baixa a foto de uma etapa e só a devolve se for JPEG e bater com o SHA-256 aprovado. */
export function baixarFotoDaTransparencia(
  apiUrl: string,
  foto: Pick<FotoPublica, 'id_foto' | 'sha256' | 'arquivo'>,
  opcoes?: Omit<OpcoesDeBusca, 'directus'>,
): Promise<Buffer>

/** Derruba o build se o texto de um documento aprovado não for o aprovado (SHA-256) ou vier vazio. */
export function verificarTextoDoDocumento(
  detalhe: Pick<
    DocumentoDetalhado,
    'id_documento' | 'titulo' | 'sha256' | 'texto'
  >,
): void

/** Baixa o PDF de um documento aprovado e só o devolve se for PDF e bater com o SHA-256 aprovado. */
export function baixarPdfDaTransparencia(
  apiUrl: string,
  documento: Pick<DocumentoPublico, 'id_documento' | 'titulo' | 'sha256'> & {
    arquivo: string
  },
  opcoes?: Omit<OpcoesDeBusca, 'directus'>,
): Promise<Buffer>

export function impressaoDoConteudo(conteudo: unknown): string
