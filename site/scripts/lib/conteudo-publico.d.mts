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

/** A situação do evento (v5.5d). Remarcado não é um status: é `Programado` com `data_hora_inicio_anterior`. */
export type StatusDoEvento = 'Programado' | 'Adiado' | 'Cancelado' | 'Realizado'

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
  /** Projeto público a que o evento pertence (v5.5); null = evento avulso (ou projeto interno, nunca revelado). */
  id_projeto: number | null
  /** Situação do evento (v5.5d); API antiga, sem o campo = `Programado`. */
  status: StatusDoEvento
  /** Por que foi cancelado ou adiado (e, se informado, por que foi remarcado); null = sem motivo. */
  motivo_status: string | null
  /** O começo de ANTES da última remarcação (ISO sem fuso); null = nunca foi remarcado. */
  data_hora_inicio_anterior: string | null
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

/**
 * Pergunta do formulário de inscrição do evento (app/routers/eventos.py::_serializar_pergunta). `tipo`: TEXTO_CURTO, TEXTO_LONGO, SELECAO_UNICA,
 * SELECAO_MULTIPLA, NUMERO, DATA ou ARQUIVO. `opcoes`: as opções das perguntas de seleção, separadas por vírgula (CSV); nulo nas demais.
 */
export interface PerguntaDoEvento {
  id_pergunta: number
  enunciado: string
  tipo: string
  opcoes: string | null
  obrigatoria: boolean
  ordem: number
}

/** O mínimo de um evento nas listas de contexto (edições de um projeto, cadeia de edições). */
export interface ResumoDeEvento {
  id_evento: number
  titulo: string
  categoria: string
  /** ISO sem fuso (horário local de Parauapebas). */
  data_hora_inicio: string
  data_hora_fim: string | null
  endereco_avulso: string | null
  /** Situação do evento (v5.5d); ausente (ou API antiga) = `Programado`. */
  status?: StatusDoEvento
}

/** Uma edição da cadeia do evento; `atual` marca a da própria página. */
export interface EdicaoDoEvento extends ResumoDeEvento {
  atual: boolean
}

/** Foto de um evento: só entra com autorização de imagem confirmada e texto alternativo (v5.5). */
export interface FotoDoEvento {
  id_foto: number
  alt: string
  largura: number
  altura: number
  tamanho: number
  /** SHA-256 do JPEG: o build só aceita o arquivo que bater com ele. */
  sha256: string
  /** Caminho na API; o site usa a cópia do build (`caminhoDaFotoDoEvento`). */
  arquivo: string
}

/** Foto na galeria do projeto: diz de qual evento é. */
export interface FotoDoProjeto extends FotoDoEvento {
  id_evento: number
}

export interface EventoDetalhado extends EventoDaLista {
  sessoes: SessaoDoEvento[]
  /** As perguntas do formulário de inscrição (v5.5c); vazia se o evento não tem (ou na API antiga). */
  perguntas: PerguntaDoEvento[]
  /** Projeto público do evento, ou null. */
  projeto: { id_projeto: number; nome: string } | null
  /** Cadeia de edições públicas (da mais antiga à mais nova); vazia na API antiga. */
  edicoes: EdicaoDoEvento[]
  /** Documentos APROVADOS ligados a este evento. */
  documentos: DocumentoPublico[]
  fotos: FotoDoEvento[]
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
  /** Projeto principal da associação: aparece em destaque na Home (v5.5). false na API antiga. */
  destaque: boolean
}

export interface ProjetoDetalhado extends ProjetoPublico {
  /** Eventos públicos do projeto, o mais recente primeiro. */
  eventos: ResumoDeEvento[]
  /** Documentos APROVADOS ligados ao projeto ou a qualquer evento dele. */
  documentos: DocumentoPublico[]
  /** Até 12 fotos, as mais recentes. */
  fotos: FotoDoProjeto[]
}

/** Foto de quem está na Diretoria ou no Conselho (v5.7c): só de quem autorizou o uso da imagem, já regravada pela API (JPEG sem metadado, até 2000 px). */
export interface FotoDaDiretoria {
  id_foto: number
  /** Texto alternativo já pronto: "Foto de <nome>, <cargo>". */
  alt: string
  largura: number
  altura: number
  /** SHA-256 do JPEG: o build só aceita o arquivo que bater com ele. */
  sha256: string
  /** Caminho na API (`/api/publico/diretoria/fotos/<id_foto>`); o site usa a cópia do build (`caminhoDaFotoDaDiretoria`). */
  arquivo: string
}

export interface MembroDaDiretoria {
  orgao_codigo: string
  orgao: string
  cargo_codigo: string
  cargo: string
  nome: string
  data_inicio: string | null
  data_fim_previsto: string | null
  /** `null` = sem foto autorizada (ou API antiga, sem o campo, ou a cópia da foto não passou na conferência do build). */
  foto: FotoDaDiretoria | null
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
  /** A que evento ou projeto o documento pertence (v5.5); ausente/null = não é de um evento nem de um projeto. */
  vinculo_tipo?: 'evento' | 'projeto' | null
  vinculo_id?: number | null
  /** Quem aprovou a publicação, nome e cargo (v6.3a, decisão do Presidente); ausente na API antiga, null sem cadastro de associado. */
  aprovado_por?: { nome: string; cargo: string | null } | null
  /** As versões do mesmo documento têm o mesmo grupo (v6.3a): a substituída continua no site, ligada à que a substituiu. Ausente na API antiga. */
  grupo_versao?: string
}

export interface DocumentoDetalhado extends DocumentoPublico {
  /** O texto publicado (só no formato TEXTO). */
  texto: string | null
}

/** Uma linha das contas do exercício (v6.3b): o valor em reais com 2 casas, em texto ("1234.56"). */
export interface LinhaDasContas {
  codigo: string
  conta: string
  valor: string
}

/** As contas de um exercício, aprovadas pela Assembleia e publicadas (v6.3b): os números gerados dos lançamentos, como foram aprovados. */
export interface ContasDoExercicio {
  ano: number
  id_documento: number
  titulo: string
  versao: number
  aprovado_em: string | null
  aprovado_por: { nome: string; cargo: string | null } | null
  dados: {
    ano: number
    receitas: LinhaDasContas[]
    despesas: LinhaDasContas[]
    total_receitas: string
    total_despesas: string
    resultado: string
    /** Todos os pareceres do Conselho Fiscal do ano emitidos até a aprovação (cada conselheiro emite o seu), sem o nome de quem emitiu. */
    pareceres: { tipo: string; texto: string; data: string | null }[]
    aprovadas_em_assembleia_em: string | null
  }
}

/** O relatório anual de atividades de um ano (v6.3c): os números montados pelo sistema e a apresentação da diretoria, como foram aprovados. */
export interface RelatorioAnual {
  ano: number
  id_documento: number
  titulo: string
  versao: number
  aprovado_em: string | null
  aprovado_por: { nome: string; cargo: string | null } | null
  dados: {
    ano: number
    apresentacao: string
    /** No ano em que o sistema começou a ser usado, a data desde a qual os números contam; senão, `null`. */
    registros_desde: string | null
    projetos: { nome: string; situacao: string }[]
    /** Contagens de pessoas: abaixo de 5, o servidor manda "menos de 5" (ninguém reconhecido pelo número). */
    eventos: {
      titulo: string
      data: string
      inscritos: number | string
      presentes: number | string
    }[]
    eventos_totais: { inscritos: number | string; presentes: number | string }
    beneficiarios: { pessoas: number | string; atendimentos: number | string }
    voluntariado: { horas: string; voluntarios: number | string }
    associados_no_fim_do_ano: number | string
    indicadores: {
      projeto: string
      indicador: string
      periodo: string
      valor: string
      unidade: string
      meta: string | null
    }[]
    contas: {
      id_documento: number
      titulo: string
      total_receitas: string
      total_despesas: string
      resultado: string
      aprovadas_em_assembleia_em: string | null
    } | null
  }
}

export interface ConteudoPublico {
  /** Os campos da Instituição que o painel marcou "vai para o site" (v5.4h); `{}` se a API não tem a rota. */
  instituicao: Record<string, string>
  eventos: EventoDaLista[]
  detalhesDeEventos: Record<number, EventoDetalhado>
  projetos: ProjetoPublico[]
  /** O detalhe de cada projeto público: edições, relatórios e fotos (v5.5). */
  detalhesDeProjetos: Record<number, ProjetoDetalhado>
  diretoria: MembroDaDiretoria[]
  assembleias: AssembleiaPublica[]
  /** Parcerias e emendas APROVADAS pela diretoria (v5.4b). */
  parcerias: ParceriaPublica[]
  detalhesDeParcerias: Record<number, ParceriaDetalhada>
  /** Documentos APROVADOS (versão pública) da Transparência (v5.4b). */
  documentos: DocumentoPublico[]
  /** Só dos documentos em formato TEXTO: o texto aprovado (SHA-256 já conferido no build). */
  detalhesDeDocumentos: Record<number, DocumentoDetalhado>
  /** As contas de cada exercício aprovadas pela Assembleia e publicadas (v6.3b), o mais novo primeiro; `[]` se a API não tem a rota. */
  contas: ContasDoExercicio[]
  /** O relatório anual de atividades de cada ano publicado (v6.3c), o mais novo primeiro; `[]` se a API não tem a rota. */
  relatoriosAnuais: RelatorioAnual[]
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

/** Projeto da API (lista ou detalhe) -> o do site: `destaque` ausente (API antiga) = false. */
export function normalizarProjeto<T extends object>(
  projeto: T,
): Omit<T, 'destaque'> & { destaque: boolean }

/** Detalhe de projeto: edições, documentos e fotos ausentes (API antiga) = lista vazia. */
export function normalizarProjetoDetalhado(
  detalhe: Partial<ProjetoDetalhado> & { id_projeto: number },
): ProjetoDetalhado

/** Foto da Diretoria da API -> a do site, ou `null` (ausente, sem autorização ou fora do formato do contrato). */
export function normalizarFotoDaDiretoria(foto: unknown): FotoDaDiretoria | null

/** Membro da Diretoria da API -> o do site: `foto` ausente (API antiga) ou inválida = null. */
export function normalizarMembroDaDiretoria<T extends object>(
  membro: T,
): Omit<T, 'foto'> & { foto: FotoDaDiretoria | null }

/** Nome da cópia da foto no site (`/midia/diretoria/<nome>.jpg`): número da foto + começo do SHA-256. */
export function nomeDaFotoDaDiretoria(
  foto: Pick<FotoDaDiretoria, 'id_foto' | 'sha256'>,
): string

export interface AvisoDeFotoDaDiretoria {
  id_foto: number
  cargo: string
  motivo: string
}

/**
 * Baixa a foto de cada membro que tem uma, conferindo JPEG e SHA-256. Foto que falha NÃO derruba o build: o membro volta com `foto: null` e o
 * motivo vai em `avisos`. `fotos` guarda os bytes pelo `nomeDaFotoDaDiretoria`.
 */
export function baixarFotosDaDiretoria(
  apiUrl: string,
  diretoria: MembroDaDiretoria[],
  opcoes?: Omit<OpcoesDeBusca, 'directus'>,
): Promise<{
  diretoria: MembroDaDiretoria[]
  fotos: Map<string, Buffer>
  avisos: AvisoDeFotoDaDiretoria[]
}>

/** Uma linha de aviso no log do build por foto da Diretoria que ficou de fora. */
export function anunciarAvisosDeFotosDaDiretoria(
  avisos: AvisoDeFotoDaDiretoria[],
  escrever?: (texto: string) => void,
  noGitHub?: boolean,
): void

/** Evento da lista: `id_projeto` ausente (API antiga) = null; sem situação (API antiga) = `Programado`, sem motivo e nunca remarcado. */
export function normalizarEvento<T extends object>(
  evento: T,
): Omit<
  T,
  'id_projeto' | 'status' | 'motivo_status' | 'data_hora_inicio_anterior'
> & {
  id_projeto: number | null
  status: StatusDoEvento
  motivo_status: string | null
  data_hora_inicio_anterior: string | null
}

/** Detalhe de evento: projeto ausente = null; edições, documentos e fotos ausentes = lista vazia. */
export function normalizarEventoDetalhado(
  detalhe: Partial<EventoDetalhado> & { id_evento: number },
): EventoDetalhado

/**
 * Notícia ligada a projeto/evento que não existe (ou não é público) é publicada SEM a ligação, com um aviso
 * (`publicada: true`) por ligação desfeita.
 */
export function ligarNoticias(
  noticias: NoticiaPublica[],
  existentes: {
    projetos: Pick<ProjetoPublico, 'id_projeto'>[]
    eventos: Pick<EventoDaLista, 'id_evento'>[]
    /** As parcerias PÚBLICAS (a lista só traz as aprovadas); só as do tipo EMENDA valem para a ligação (v5.7h). */
    parcerias?: { id_parceria: number; tipo_codigo: string }[]
  },
): { noticias: NoticiaPublica[]; avisos: AvisoDeNoticia[] }

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
  opcoes?: Omit<OpcoesDeBusca, 'directus'> & {
    /** De onde é a foto, para a mensagem de erro (padrão: "da transparência"; evento: "do evento"). */
    descricao?: string
  },
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
