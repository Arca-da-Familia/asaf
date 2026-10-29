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

export function entregar(blob: Blob, nome: string, modo: 'abrir' | 'baixar') {
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
  // os dois endereços por extenso (o teste que confere que toda rota do servidor tem tela procura o endereço escrito)
  const { blob, nomeSugerido } = await apiFetchBlob(
    formato === 'pdf'
      ? '/api/privacidade/inventario-pdf'
      : '/api/privacidade/inventario-planilha',
  )
  entregar(
    blob,
    nomeSugerido ?? `inventario-de-dados.${formato === 'pdf' ? 'pdf' : 'csv'}`,
    formato === 'pdf' ? 'abrir' : 'baixar',
  )
}

// ---------------------------------------------------------------------------------------------- v7.0d - o relatório de impacto (RIPD)
export type VersaoDoRelatorio = {
  id_relatorio: number
  versao: number
  situacao: 'Rascunho' | 'Aprovado' | 'Suspenso' | 'Substituído'
  secoes: Record<string, string>
  criado_em: string
  atualizado_em: string | null
  aprovado_em: string | null
  suspenso_em: string | null
  motivo_suspensao: string | null
}

export type TratamentoDeAltoRisco = {
  codigo: string
  nome: string
  ligado: boolean
  versao_do_plano: string
  por_que_alto_risco: string
  liberado: boolean
  aprovado: VersaoDoRelatorio | null
  rascunho: VersaoDoRelatorio | null
  suspenso: VersaoDoRelatorio | null
  proposta: Record<string, string> | null
  // o que a tela tinha do rascunho quando começou a editar (volta no salvar: se outra pessoa salvou no meio, o servidor recusa)
  marcador_do_rascunho: string | null
  historico: {
    versao: number
    situacao: string
    criado_em: string
    aprovado_em: string | null
  }[]
}

export type RelatoriosDeImpacto = {
  tratamentos: TratamentoDeAltoRisco[]
  secoes: { chave: string; rotulo: string }[]
  pode_gerir: boolean
}

export const obterRelatoriosDeImpacto = () =>
  apiFetch<RelatoriosDeImpacto>('/api/privacidade/relatorios-de-impacto')

export const salvarRelatorioDeImpacto = (
  codigo: string,
  secoes: Record<string, string>,
  marcadorBase: string | null,
) =>
  apiFetch<RelatoriosDeImpacto>(
    `/api/privacidade/relatorios-de-impacto/${codigo}`,
    {
      method: 'PUT',
      body: JSON.stringify({ secoes, marcador_base: marcadorBase }),
    },
  )

export const aprovarRelatorioDeImpacto = (codigo: string) =>
  apiFetch<RelatoriosDeImpacto>(
    `/api/privacidade/relatorios-de-impacto/${codigo}/aprovar`,
    { method: 'POST' },
  )

export const suspenderRelatorioDeImpacto = (codigo: string, motivo: string) =>
  apiFetch<RelatoriosDeImpacto>(
    `/api/privacidade/relatorios-de-impacto/${codigo}/suspender`,
    { method: 'POST', body: JSON.stringify({ motivo }) },
  )

export async function abrirPdfDoRelatorio(codigo: string) {
  const { blob } = await apiFetchBlob(
    `/api/privacidade/relatorios-de-impacto/${codigo}/pdf`,
  )
  entregar(blob, `relatorio-de-impacto-${codigo}.pdf`, 'abrir')
}

// a tela do prontuário pergunta se o tratamento está liberado (qualquer pessoa logada; não traz dado)
export const tratamentoLiberado = (codigo: string) =>
  apiFetch<{ codigo: string; nome: string; liberado: boolean }>(
    `/api/relatorios-de-impacto/${codigo}/liberado`,
  )

// ------------------------------------------------------------------------------------------------ v7.1a: os avisos de privacidade com versão
export type VersaoDeAviso = {
  versao: string
  vigente_desde: string
  texto: string
  texto_sem_links: string
  impressao: string
  reconstituido: boolean
  observacao: string | null
  registrado_em: string
  diverge_do_codigo: boolean
  // como era QUANDO esta versão foi mostrada (a 1 da inscrição em evento era consentimento, com a caixa "Li e aceito.")
  tipo: 'aviso' | 'consentimento'
  caixa: string | null
  // a caixa era marcada pela equipe no painel (a declaração de quem enviava a foto, a marca no cadastro do beneficiário), não pela pessoa
  marcada_pela_equipe: boolean
}

export type PontoDeColeta = {
  codigo: string
  nome: string
  tipo: 'aviso' | 'consentimento'
  onde: string
  caixa: string
  atividade: string
  atividade_nome: string
  bases_legais: { codigo: string; texto: string }[]
  versao_atual: string
  versoes: VersaoDeAviso[]
}

export type AvisoDeUmaVersao = VersaoDeAviso & {
  codigo: string
  nome: string
  versao_atual: string
}

export const obterTextosDePrivacidade = () =>
  apiFetch<{ pontos: PontoDeColeta[] }>(
    '/api/privacidade/textos-de-privacidade',
  )

export const lerAvisoDeUmaVersao = (ponto: string, versao: string) =>
  apiFetch<AvisoDeUmaVersao>(
    `/api/textos-de-privacidade/${encodeURIComponent(ponto)}/${encodeURIComponent(versao)}`,
  )

// ------------------------------------------------------------------------------------------------ v7.2b: o relatório dos dados de uma pessoa (só o encarregado)
export type PessoaAchada = {
  id_pessoa: number
  nome_completo: string
  cpf_final: string | null
  associado: boolean
  beneficiario: boolean
}

export type AtividadeDoRelatorio = {
  codigo: string
  nome: string
  finalidade: string
  bases_legais: string[]
  base_legal_conferida: boolean
  compartilhado_com: string[]
  transferencia_internacional: boolean
  prazos_de_guarda: string[]
}

export type SecaoDoRelatorio = {
  tabela: string
  atividades: AtividadeDoRelatorio[]
  tem_dado_sensivel: boolean
  cortado: boolean
  linhas: Array<Record<string, string | number | boolean | null>>
}

export type RelatorioDoTitular = {
  gerado_em: string
  pessoa: {
    id_pessoa: number
    nome_completo: string
    cpf: string | null
  } | null
  secoes: SecaoDoRelatorio[]
  total_de_linhas: number
  algum_corte: boolean
  fora_do_relatorio: string
  // v7.2c: a impressão do conteúdo; a liberação ao titular a manda de volta e o servidor recusa (409) se o relatório mudou desde a conferência
  impressao: string
}

// de quem é o relatório: o número do cadastro, ou (quem só escreveu pelo site) o e-mail; `id_atendimento` = quem responde a solicitação dela gera também;
// só o `id_atendimento` (v7.2c) = a pessoa sai do pedido, pela mesma regra da entrega
export type QuemNoRelatorio = {
  id_pessoa?: number
  email?: string
  id_atendimento?: number
}

export const buscarTitulares = (busca: string) =>
  apiFetch<PessoaAchada[]>(
    `/api/privacidade/titulares?busca=${encodeURIComponent(busca)}`,
  )

export const obterRelatorioDoTitular = (quem: QuemNoRelatorio) => {
  const p = new URLSearchParams()
  if (quem.id_pessoa) p.set('id_pessoa', String(quem.id_pessoa))
  if (quem.email) p.set('email', quem.email)
  if (quem.id_atendimento) p.set('id_atendimento', String(quem.id_atendimento))
  return apiFetch<RelatorioDoTitular>(
    `/api/privacidade/titulares/relatorio?${p.toString()}`,
  )
}

// v7.2c - liberar o relatório conferido para a pessoa baixar pela Minha conta (PDF e arquivo da portabilidade, 15 dias); liberar de novo substitui o anterior
export type EntregaLiberada = {
  id_entrega: number
  liberado_em: string
  valido_ate: string
}

export const liberarRelatorioAoTitular = (
  idAtendimento: number,
  impressao: string,
) =>
  apiFetch<EntregaLiberada>(
    `/api/privacidade/titulares/entregas/${idAtendimento}`,
    { method: 'POST', body: JSON.stringify({ impressao }) },
  )
