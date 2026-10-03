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

export interface ConteudoPublico {
  eventos: EventoDaLista[]
  detalhesDeEventos: Record<number, EventoDetalhado>
  projetos: ProjetoPublico[]
  diretoria: MembroDaDiretoria[]
  assembleias: AssembleiaPublica[]
}

export interface OpcoesDeBusca {
  fetchImpl?: typeof fetch
  tentativas?: number
  timeoutMs?: number
  esperaMs?: number
}

export const ENDPOINTS_DE_LISTA: Record<
  'eventos' | 'projetos' | 'diretoria' | 'assembleias',
  string
>

export function buscarConteudoPublico(
  apiUrl: string,
  opcoes?: OpcoesDeBusca,
): Promise<ConteudoPublico>

export function impressaoDoConteudo(conteudo: unknown): string
