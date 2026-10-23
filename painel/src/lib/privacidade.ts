import { apiFetch, apiFetchBlob } from '@/lib/api'

// v7.0a (FASE 7) - o módulo Privacidade: o encarregado pelo tratamento de dados (o Presidente) e o substituto que o ato designa (o 1º Vice-Presidente; o 2º na falta
// dele), pelos mandatos vigentes, e o ato de designação (Resolução CD/ANPD nº 18/2024, art. 3º e 4º): o sistema gera o texto e o PDF, a cópia assinada é anexada e
// só então o ato vale.

export const PERMISSAO_DE_PRIVACIDADE = 'privacidade'

export type SituacaoDoAto =
  'Aguardando assinatura' | 'Vigente' | 'Substituído' | 'Descartado'

export type PessoaDoMandato = {
  id_associado: number
  nome: string
  cargo: string
  mandato_inicio: string
  mandato_fim: string
}

export type AtoDoEncarregado = {
  id_ato: number
  numero: number
  situacao: SituacaoDoAto
  texto: string
  nome_encarregado: string
  nome_substituto: string | null
  cargo_substituto: string | null
  gerado_em: string
  assinatura_registrada_em: string | null
  tem_copia_assinada: boolean
  assinado_nome_arquivo: string | null
  encerrado_em: string | null
}

export type SituacaoDoEncarregado = {
  encarregado: PessoaDoMandato | null
  substituto: PessoaDoMandato | null
  ato_vigente: AtoDoEncarregado | null
  rascunho: AtoDoEncarregado | null
  historico: AtoDoEncarregado[]
  avisos: { codigo: string; texto: string }[]
  // gerar e registrar a cópia assinada: só quem tem `privacidade_gerir` (o Presidente); o Vice-Presidente só vê
  pode_gerir: boolean
}

export const obterSituacaoDoEncarregado = () =>
  apiFetch<SituacaoDoEncarregado>('/api/privacidade/encarregado')

export const gerarAtoDoEncarregado = () =>
  apiFetch<SituacaoDoEncarregado>('/api/privacidade/encarregado/atos', {
    method: 'POST',
  })

export function registrarAssinaturaDoAto(
  idAto: number,
  arquivo: File,
): Promise<SituacaoDoEncarregado> {
  const form = new FormData()
  form.append('arquivo', arquivo)
  return apiFetch(`/api/privacidade/encarregado/atos/${idAto}/assinado`, {
    method: 'POST',
    body: form,
  })
}

function entregar(blob: Blob, nome: string, modo: 'abrir' | 'baixar') {
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

// O PDF para imprimir abre na aba (não tem dado sigiloso); a cópia assinada é baixada (o download vai para a Auditoria).
export async function abrirPdfDoAto(ato: AtoDoEncarregado): Promise<void> {
  const { blob } = await apiFetchBlob(
    `/api/privacidade/encarregado/atos/${ato.id_ato}/pdf`,
  )
  entregar(blob, `Ato ${ato.numero} - encarregado de dados.pdf`, 'abrir')
}

export async function baixarCopiaAssinada(
  ato: AtoDoEncarregado,
): Promise<void> {
  const { blob, nomeSugerido } = await apiFetchBlob(
    `/api/privacidade/encarregado/atos/${ato.id_ato}/assinado`,
  )
  entregar(
    blob,
    nomeSugerido ?? ato.assinado_nome_arquivo ?? `ato-${ato.numero}`,
    'baixar',
  )
}

// ---------------------------------------------------------------------------------------------- v7.0c - o inventário de dados
export type OperadorDoInventario = {
  codigo: string
  nome: string
  o_que_faz: string
  onde: string
  fora_do_brasil: boolean
}

export type AtividadeDeTratamento = {
  codigo: string
  nome: string
  finalidade: string
  bases_legais: string[]
  bases_legais_texto: string[]
  operadores: string[]
  operadores_detalhe: OperadorDoInventario[]
  medidas: string
  observacoes: string
  base_legal_conferida: boolean
  transferencia_internacional: boolean
  tabelas: string[]
  titulares: string[]
  dados_pessoais: string[]
  dados_sensiveis: string[]
  texto_livre_que_pode_ter_sensivel: string[]
  pode_ter_crianca: boolean
  requisito_crianca: string | null
  tabelas_externas: string[]
  armazenamento: string[]
  prazos_de_guarda: { regra: string; rotulo: string; dias: number }[]
  prazos_fixos: string[]
  sem_rotina_de_guarda: boolean
  versao: number
  alterado_em: string | null
}

export type Inventario = {
  atividades: AtividadeDeTratamento[]
  tabelas_sem_atividade: string[]
  bases_legais: { codigo: string; texto: string }[]
  operadores: OperadorDoInventario[]
  base_legal_a_conferir: string[]
  pode_gerir: boolean
}

// os operadores (com quem se compartilha) são fato do sistema: não se ajustam na tela
export type AjusteDeAtividade = Partial<
  Pick<
    AtividadeDeTratamento,
    | 'finalidade'
    | 'bases_legais'
    | 'medidas'
    | 'observacoes'
    | 'base_legal_conferida'
  >
>

export type VersaoDeAtividade = {
  versao: number
  alterado_em: string | null
  por: string | null
  campos: AjusteDeAtividade
}

export const obterInventario = () =>
  apiFetch<Inventario>('/api/privacidade/inventario')

// `versaoBase`: a versão que a tela mostrava; se outra pessoa salvou depois, o servidor recusa (409) em vez de apagar o que ela fez
export const ajustarAtividade = (
  codigo: string,
  dados: AjusteDeAtividade,
  versaoBase: number,
) =>
  apiFetch<Inventario>(`/api/privacidade/inventario/${codigo}`, {
    method: 'PUT',
    body: JSON.stringify({ ...dados, versao_base: versaoBase }),
  })

export const historicoDaAtividade = (codigo: string) =>
  apiFetch<VersaoDeAtividade[]>(
    `/api/privacidade/inventario/${codigo}/historico`,
  )

export async function baixarInventario(formato: 'planilha' | 'pdf') {
  const { blob, nomeSugerido } = await apiFetchBlob(
    `/api/privacidade/inventario-${formato}`,
  )
  entregar(
    blob,
    nomeSugerido ?? `inventario-de-dados.${formato === 'pdf' ? 'pdf' : 'csv'}`,
    formato === 'pdf' ? 'abrir' : 'baixar',
  )
}
