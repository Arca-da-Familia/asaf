import { apiFetch } from '@/lib/api'

// v6.1 (FASE 6) - comunicação interna no painel: o módulo Comunicação (quem tem `comunicar` publica, acompanha a leitura e retira) e o mural e a caixa de
// entrada de cada pessoa. O grupo de um aviso é uma REGRA que o servidor calcula; a tela nunca manda uma lista de pessoas.

export const PERMISSAO_DE_COMUNICAR = 'comunicar'

export type TipoDePublico = 'associados' | 'permissao' | 'projeto'
export type ParteDoProjeto = 'equipe' | 'voluntarios'
export type SituacaoDoAviso = 'No mural' | 'Vencido' | 'Retirado'

export type PublicoDoAviso = {
  tipo: TipoDePublico
  situacoes: string[]
  categorias: string[]
  codigo_permissao?: string
  id_projeto?: number
  partes_do_projeto: ParteDoProjeto[]
}

export type OpcoesDePublico = {
  situacoes: string[]
  categorias_de_associado: string[]
  permissoes: { codigo: string; modulo: string; descricao: string }[]
  projetos: { id_projeto: number; nome: string }[]
  // v6.2a: `obrigatoria` (Convocação e Mudança de regra) deixa a caixa "também por e-mail" marcada por padrão
  categorias_de_aviso: {
    codigo: string
    rotulo: string
    obrigatoria: boolean
  }[]
}

export type ConferenciaDoPublico = {
  descricao: string
  total: number
  sem_acesso: number
  com_email: number
  // v6.2b: dos que têm e-mail, quantos desligaram os avisos NÃO obrigatórios por e-mail
  desligaram_os_avisos: number
  pessoas: { nome: string; tem_acesso: boolean; tem_email: boolean }[]
}

export type TotaisDoAviso = {
  destinatarios: number
  lidos: number | null
  confirmados: number | null
  sem_acesso: number | null
}

// v6.2a - a entrega por e-mail: uma por pessoa, e os totais do aviso por situação
export type SituacaoDoEmail =
  | 'Na fila'
  | 'Enviando'
  | 'Enviado'
  | 'Falhou'
  | 'Sem e-mail no cadastro'
  | 'Cancelado'
  | 'Desligou por escolha'

export type EntregaDoEmail = {
  situacao: SituacaoDoEmail
  tentativas: number
  enviado_em: string | null
  erro: string | null
}

export type TotaisDeEmail = Record<SituacaoDoEmail, number>

export type AvisoResumo = {
  id_aviso: number
  titulo: string
  categoria: string
  categoria_rotulo: string
  exige_confirmacao: boolean
  valido_ate: string
  publicado_em: string
  publico_descricao: string
  autor: string | null
  situacao: SituacaoDoAviso
  retirado_em: string | null
  motivo_retirada: string | null
  leitura_apagada_em: string | null
  totais: TotaisDoAviso
  por_email: boolean
  email: TotaisDeEmail | null
}

export type DestinatarioDoAviso = {
  id_destinatario: number
  nome: string
  // tinha acesso ao painel quando entrou no grupo / tem hoje (ganhou acesso depois)
  tinha_acesso: boolean
  tem_acesso_hoje: boolean
  incluido_em: string
  lido_em: string | null
  confirmado_em: string | null
  email: EntregaDoEmail | null
}

export type AvisoCompleto = AvisoResumo & {
  texto: string
  // grupo escolhido pela situação do associado (ex.: os inadimplentes) e quem olha não tem `associados` nem `financeiro`: só os totais, sem os nomes
  nomes_ocultos: boolean
  destinatarios: DestinatarioDoAviso[]
  // v6.2c: a versão do modelo que o aviso usou
  modelo?: { id_modelo: number; nome: string; versao: number } | null
}

export type PaginaDeAvisos = {
  total: number
  pagina: number
  por_pagina: number
  itens: AvisoResumo[]
}

export type MeuAviso = {
  id_aviso: number
  titulo: string
  categoria_rotulo: string
  exige_confirmacao: boolean
  valido_ate: string
  publicado_em: string
  autor: string | null
  situacao: SituacaoDoAviso
  retirado_em: string | null
  motivo_retirada: string | null
  lido_em: string | null
  confirmado_em: string | null
  texto?: string
}

export type MeusAvisos = {
  nao_lidos: number
  confirmacoes_pendentes: number
  avisos: MeuAviso[]
}

export type NovoAviso = {
  titulo: string
  texto: string
  categoria: string
  valido_ate: string
  exige_confirmacao: boolean
  por_email: boolean
  publico: PublicoDoAviso
  total_confirmado: number
  id_modelo?: number
}

// ------------------------------------------------------------------ chamadas ao servidor
export function opcoesDePublico(): Promise<OpcoesDePublico> {
  return apiFetch('/api/avisos/opcoes-de-publico')
}

export function conferirPublico(
  publico: PublicoDoAviso,
): Promise<ConferenciaDoPublico> {
  return apiFetch('/api/avisos/conferir-publico', {
    method: 'POST',
    body: JSON.stringify({ publico }),
  })
}

export function publicarAviso(aviso: NovoAviso): Promise<AvisoCompleto> {
  return apiFetch('/api/avisos/', {
    method: 'POST',
    body: JSON.stringify(aviso),
  })
}

export function listarAvisos(filtros: {
  situacao?: SituacaoDoAviso
  busca?: string
  pagina: number
  por_pagina: number
}): Promise<PaginaDeAvisos> {
  const qs = new URLSearchParams()
  if (filtros.situacao) qs.set('situacao', filtros.situacao)
  if (filtros.busca) qs.set('busca', filtros.busca)
  qs.set('pagina', String(filtros.pagina))
  qs.set('por_pagina', String(filtros.por_pagina))
  return apiFetch(`/api/avisos/?${qs}`)
}

export function detalharAviso(idAviso: number): Promise<AvisoCompleto> {
  return apiFetch(`/api/avisos/${idAviso}`)
}

export function incluirNovosNoAviso(
  idAviso: number,
): Promise<{ incluidos: number; aviso: AvisoCompleto }> {
  return apiFetch(`/api/avisos/${idAviso}/incluir-novos`, { method: 'POST' })
}

export function retirarAviso(
  idAviso: number,
  motivo: string,
): Promise<AvisoCompleto> {
  return apiFetch(`/api/avisos/${idAviso}/retirar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

export function reenviarEmailsDoAviso(
  idAviso: number,
): Promise<{ voltaram_para_a_fila: number; aviso: AvisoCompleto }> {
  return apiFetch(`/api/avisos/${idAviso}/reenviar-emails`, { method: 'POST' })
}

export function listarMeusAvisos(soMural = false): Promise<MeusAvisos> {
  return apiFetch(`/api/meus-avisos/${soMural ? '?mural=true' : ''}`)
}

export function abrirMeuAviso(idAviso: number): Promise<MeuAviso> {
  return apiFetch(`/api/meus-avisos/${idAviso}`)
}

export function confirmarMeuAviso(idAviso: number): Promise<MeuAviso> {
  return apiFetch(`/api/meus-avisos/${idAviso}/confirmar`, { method: 'POST' })
}

// ------------------------------------------------------------------ regras da tela (puras, testadas à parte)
export const MOTIVO_MINIMO = 10
export const MOTIVO_MAXIMO = 500
export const TAMANHO_DO_TITULO = 150
export const TAMANHO_DO_TEXTO = 5000

export const PUBLICO_INICIAL: PublicoDoAviso = {
  tipo: 'associados',
  situacoes: [],
  categorias: [],
  partes_do_projeto: ['equipe', 'voluntarios'],
}

/** O público que vai ao servidor: só os campos do tipo escolhido (a regra que fica guardada no aviso não leva sobra de outro tipo). */
export function publicoParaEnviar(publico: PublicoDoAviso): PublicoDoAviso {
  if (publico.tipo === 'permissao')
    return {
      tipo: 'permissao',
      situacoes: [],
      categorias: [],
      partes_do_projeto: [],
      codigo_permissao: publico.codigo_permissao,
    }
  const base = {
    tipo: publico.tipo,
    situacoes: publico.situacoes,
    categorias: publico.categorias,
    partes_do_projeto: [] as ParteDoProjeto[],
  }
  if (publico.tipo === 'projeto')
    return {
      ...base,
      id_projeto: publico.id_projeto,
      partes_do_projeto: publico.partes_do_projeto,
    }
  return base
}

/** O que ainda falta escolher para o grupo poder ser conferido (null = pronto). */
export function faltaNoPublico(publico: PublicoDoAviso): string | null {
  if (publico.tipo === 'permissao' && !publico.codigo_permissao)
    return 'Escolha a permissão.'
  if (publico.tipo === 'projeto') {
    if (!publico.id_projeto) return 'Escolha o projeto.'
    if (publico.partes_do_projeto.length === 0)
      return 'Escolha a equipe, os voluntários ou os dois.'
  }
  return null
}

/** Liga ou desliga um valor numa lista (as caixas de situação e de categoria). */
export function alternar<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor)
    ? lista.filter((v) => v !== valor)
    : [...lista, valor]
}

/** A leitura de uma pessoa, em português, para o relatório. */
export function textoDaLeitura(d: DestinatarioDoAviso): string {
  if (d.lido_em === null) {
    if (d.tinha_acesso) return 'Ainda não leu'
    return d.tem_acesso_hoje
      ? 'Ganhou acesso depois; ainda não leu'
      : 'Sem acesso ao painel: não foi avisado'
  }
  return d.tinha_acesso ? 'Leu' : 'Ganhou acesso depois e leu'
}

/** A conferência vale só para o MESMO grupo que foi conferido (a resposta que chega depois de a pessoa mudar o grupo não conta). */
export function mesmoPublico(a: PublicoDoAviso, b: PublicoDoAviso): boolean {
  return (
    JSON.stringify(publicoParaEnviar(a)) ===
    JSON.stringify(publicoParaEnviar(b))
  )
}

export type FiltroDaLeitura =
  'todos' | 'nao_leram' | 'nao_confirmaram' | 'sem_acesso' | 'email_falhou'

export function filtrarDestinatarios(
  destinatarios: DestinatarioDoAviso[],
  filtro: FiltroDaLeitura,
): DestinatarioDoAviso[] {
  if (filtro === 'nao_leram')
    return destinatarios.filter((d) => d.lido_em === null)
  if (filtro === 'nao_confirmaram')
    return destinatarios.filter((d) => d.confirmado_em === null)
  if (filtro === 'email_falhou')
    return destinatarios.filter((d) => d.email?.situacao === 'Falhou')
  if (filtro === 'sem_acesso')
    return destinatarios.filter((d) => !d.tinha_acesso)
  return destinatarios
}

/** Para o aviso que pede confirmação: está pendente para a pessoa (no mural e ainda não confirmado). */
export function confirmacaoPendente(aviso: MeuAviso): boolean {
  return (
    aviso.exige_confirmacao &&
    aviso.confirmado_em === null &&
    aviso.situacao === 'No mural'
  )
}

export const COR_DA_SITUACAO: Record<SituacaoDoAviso, string> = {
  'No mural': 'bg-primary/10 text-primary',
  Vencido: 'bg-muted text-muted-foreground',
  Retirado: 'bg-destructive/10 text-destructive',
}

/** A data daqui a N dias, no fuso de quem usa (yyyy-mm-dd): o padrão de "válido até" (o servidor recusa data no passado). */
export function dataDaquiA(dias: number, agora = new Date()): string {
  const d = new Date(agora)
  d.setDate(d.getDate() + dias)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** O botão "Li e estou ciente": vale enquanto o aviso não foi retirado (depois de vencido ainda dá; a data mostra que foi depois), como o servidor. */
export function podeConfirmar(aviso: MeuAviso): boolean {
  return (
    aviso.exige_confirmacao &&
    aviso.confirmado_em === null &&
    aviso.situacao !== 'Retirado'
  )
}

/** v6.2a - a entrega por e-mail de uma pessoa, em português, para o relatório. */
export function textoDoEmail(entrega: EntregaDoEmail | null): string {
  if (entrega === null) return '—'
  if (entrega.situacao === 'Falhou')
    return entrega.erro ? `Falhou: ${entrega.erro}` : 'Falhou'
  if (entrega.situacao === 'Na fila' && entrega.tentativas > 0)
    return `Na fila (nova tentativa; ${entrega.tentativas} até agora)`
  return entrega.situacao
}

/** v6.2a - os totais do e-mail de um aviso, numa frase (só o que existe). */
// Aviso que foi por e-mail e não tem mais o registro (apagado pelo prazo de guarda) diz isso, em vez de "só no painel".
export function resumoDoEmail(
  email: TotaisDeEmail | null,
  porEmail = email !== null,
): string {
  if (email === null)
    return porEmail
      ? 'Foi também por e-mail (o registro foi apagado pelo prazo de guarda)'
      : 'Só no painel'
  const partes: string[] = []
  if (email['Enviado']) partes.push(`${email['Enviado']} enviados`)
  if (email['Na fila']) partes.push(`${email['Na fila']} na fila`)
  if (email['Enviando']) partes.push(`${email['Enviando']} saindo agora`)
  if (email['Falhou']) partes.push(`${email['Falhou']} falharam`)
  if (email['Sem e-mail no cadastro'])
    partes.push(`${email['Sem e-mail no cadastro']} sem e-mail`)
  if (email['Cancelado']) partes.push(`${email['Cancelado']} cancelados`)
  if (email['Desligou por escolha'])
    partes.push(
      `${email['Desligou por escolha']} desligaram os avisos por e-mail`,
    )
  return partes.length ? partes.join(' · ') : 'Nenhum e-mail'
}

// ------------------------------------------------------------------ v6.2b - preferências de e-mail (Meu Perfil)
export type TipoDeEmail = 'avisos' | 'lembretes_de_mensalidade' | 'eventos'

export type MinhasPreferencias = {
  tem_cadastro: boolean
  obrigatorias: string
  // `link_de_teste` só vem na homologação (sem e-mail configurado): o robô não lê e-mail
  tipos: {
    tipo: TipoDeEmail
    rotulo: string
    recebe: boolean
    link_de_teste?: string
  }[]
}

export function minhasPreferencias(): Promise<MinhasPreferencias> {
  return apiFetch('/api/minhas-preferencias-de-comunicacao/')
}

export function mudarPreferencia(
  tipo: TipoDeEmail,
  recebe: boolean,
): Promise<MinhasPreferencias> {
  return apiFetch('/api/minhas-preferencias-de-comunicacao/', {
    method: 'PUT',
    body: JSON.stringify({ tipo, recebe }),
  })
}

// ------------------------------------------------------------------ v6.2c - modelos, variáveis, pré-visualização, teste e agendamento
export const VARIAVEIS_DO_TEXTO = ['{primeiro_nome}', '{nome}'] as const

export type ModeloDeAviso = {
  id_modelo: number
  grupo: string
  versao: number
  nome: string
  titulo: string
  texto: string
  categoria: string
  exige_confirmacao: boolean
  por_email: boolean
  ativo: boolean
  criado_em: string
}

export type DadosDoModelo = Pick<
  ModeloDeAviso,
  'nome' | 'titulo' | 'texto' | 'categoria' | 'exige_confirmacao' | 'por_email'
>

export type SituacaoDoAgendamento = 'Agendado' | 'Publicado' | 'Cancelado'

export type AvisoAgendado = {
  id_agendado: number
  publicar_em: string
  situacao: SituacaoDoAgendamento
  titulo: string
  categoria: string
  valido_ate: string
  exige_confirmacao: boolean
  por_email: boolean
  publico_descricao: string
  total_conferido: number
  id_aviso: number | null
  motivo: string | null
  criado_em: string
}

export function listarModelos(): Promise<ModeloDeAviso[]> {
  return apiFetch('/api/modelos-de-aviso/')
}

export function criarModelo(dados: DadosDoModelo): Promise<ModeloDeAviso> {
  return apiFetch('/api/modelos-de-aviso/', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function editarModelo(
  idModelo: number,
  dados: DadosDoModelo,
): Promise<ModeloDeAviso> {
  return apiFetch(`/api/modelos-de-aviso/${idModelo}`, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export function arquivarModelo(idModelo: number): Promise<{ arquivado: true }> {
  return apiFetch(`/api/modelos-de-aviso/${idModelo}/arquivar`, {
    method: 'POST',
  })
}

export function versoesDoModelo(idModelo: number): Promise<ModeloDeAviso[]> {
  return apiFetch(`/api/modelos-de-aviso/${idModelo}/versoes`)
}

export function preVisualizarAviso(dados: {
  titulo: string
  texto: string
  publico?: PublicoDoAviso
}): Promise<{ para: string; titulo: string; texto: string }> {
  return apiFetch('/api/avisos/pre-visualizar', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function enviarTesteDoAviso(dados: {
  titulo: string
  texto: string
  exige_confirmacao: boolean
}): Promise<{ enviado_para: string }> {
  return apiFetch('/api/avisos/enviar-teste', {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

export function agendarAviso(
  aviso: NovoAviso & { publicar_em: string },
): Promise<AvisoAgendado> {
  return apiFetch('/api/avisos-agendados/', {
    method: 'POST',
    body: JSON.stringify(aviso),
  })
}

export function listarAgendados(
  situacao?: SituacaoDoAgendamento,
): Promise<AvisoAgendado[]> {
  return apiFetch(
    `/api/avisos-agendados/${situacao ? `?situacao=${encodeURIComponent(situacao)}` : ''}`,
  )
}

export function cancelarAgendado(
  idAgendado: number,
  motivo: string,
): Promise<AvisoAgendado> {
  return apiFetch(`/api/avisos-agendados/${idAgendado}/cancelar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  })
}

/** Variáveis escritas no texto que não existem (o servidor também recusa): para avisar antes de enviar. */
export function variaveisDesconhecidas(texto: string): string[] {
  const achadas = texto.match(/\{[A-Za-z_]+\}/g) ?? []
  return [
    ...new Set(
      achadas.filter(
        (v) => !(VARIAVEIS_DO_TEXTO as readonly string[]).includes(v),
      ),
    ),
  ]
}
