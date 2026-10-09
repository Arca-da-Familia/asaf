import type { PerguntaDoEvento } from '../../scripts/lib/conteudo-publico.mjs'
import { ApiError, buscarJson, enviarJson } from './api'
import {
  cpfValido,
  EMAIL,
  somenteDigitos,
  telefoneValido,
} from './filiacao-pedido'

/**
 * INSCRIÇÃO EM EVENTO pela página do evento (v5.5c). O formulário (`components/FormularioDeInscricao.astro`) é HTML de verdade; esta ilha valida, monta o corpo
 * e envia `POST /api/publico/eventos/{id}/inscrever-se` (sem login). Vale para evento GRATUITO, que ainda não aconteceu e sem pergunta do tipo ARQUIVO (esses o
 * site manda fazer com a secretaria).
 *
 * A API repete todas as regras; aqui elas existem para a pessoa saber o que corrigir antes de enviar. O texto do consentimento e a sua versão NUNCA são escritos
 * aqui: vêm da API (`GET /api/publico/eventos/consentimento-lgpd`), são mostrados exatamente como vieram e a versão lida é a enviada. Sem o texto, não se envia.
 *
 * Inscrição em grupo: a pessoa principal e até 9 outras. O e-mail e o telefone são do grupo; nome, CPF e as respostas são de cada pessoa (as perguntas
 * OBRIGATÓRIAS valem para CADA pessoa).
 *
 * SEGURANÇA: só `textContent` e atributos — nada vindo da API (nem do formulário) entra como HTML.
 */

export const TIPOS_DE_PERGUNTA = [
  'TEXTO_CURTO',
  'TEXTO_LONGO',
  'SELECAO_UNICA',
  'SELECAO_MULTIPLA',
  'NUMERO',
  'DATA',
  'ARQUIVO',
] as const

/** Além da pessoa principal: no máximo 9 (10 pessoas por inscrição). */
export const MAXIMO_DE_PESSOAS_ADICIONAIS = 9
/** Até esta quantidade de opções a escolha única vira botões de marcar (rádios); acima, uma lista. */
export const MAXIMO_DE_OPCOES_EM_RADIOS = 5
export const NOME_MINIMO = 3
export const NOME_MAXIMO = 150
export const RESPOSTA_CURTA_MAXIMA = 200
export const RESPOSTA_LONGA_MAXIMA = 2000

export const AVISO_SEM_VAGAS =
  'As vagas acabaram. Você pode se inscrever na lista de espera e será avisado por e-mail se uma vaga abrir.'
export const AVISO_DA_LISTA_DE_ESPERA =
  'Você será avisado(a) por e-mail se uma vaga abrir.'
export const AVISO_DO_LINK =
  'Guarde este link: é por ele que você cancela ou confirma a sua vaga.'
const FALHA_DO_CONSENTIMENTO =
  'Não foi possível carregar o texto do consentimento, e sem ele não dá para enviar a inscrição. Tente de novo; se continuar, fale com a secretaria.'

/** O que a pessoa respondeu, ainda "em bruto": texto, ou a lista de opções marcadas (seleção múltipla). */
export type RespostaBruta = string | string[]

export interface ParticipanteDoFormulario {
  /** Número fixo do bloco na página (0 = a pessoa principal): ligue cada campo ao seu aviso de erro. Nunca se reaproveita. */
  indice: number
  nome_completo: string
  cpf: string
  /** Por `id_pergunta` (texto). */
  respostas: Record<string, RespostaBruta>
}

export interface ValoresDaInscricao {
  /** O primeiro é a pessoa principal; os outros, as adicionais, na ordem da página. */
  participantes: ParticipanteDoFormulario[]
  email: string
  telefone: string
  /** `""` = o evento todo (sem escolher uma sessão); senão, o `id_sessao`. */
  id_sessao: string
  consentimento_lgpd: boolean
}

/** Chaves dos campos (ligam o controle, o aviso de erro e a ordem do foco). */
export const chaveDoNome = (indice: number | string) =>
  `participante.${indice}.nome`
export const chaveDoCpf = (indice: number | string) =>
  `participante.${indice}.cpf`
export const chaveDaPergunta = (
  indice: number | string,
  idPergunta: number | string,
) => `participante.${indice}.pergunta.${idPergunta}`
export const CHAVE_DO_EMAIL = 'email'
export const CHAVE_DO_TELEFONE = 'telefone'
export const CHAVE_DA_SESSAO = 'sessao'
export const CHAVE_DO_CONSENTIMENTO = 'consentimento'

/** Os erros, na ORDEM DA PÁGINA (a primeira chave é o primeiro campo a receber o foco). */
export type ErrosDaInscricao = Record<string, string>

/** Estado do texto do consentimento: ainda carregando, pronto para ser lido e aceito, ou a busca falhou. */
export type EstadoDoConsentimento = 'carregando' | 'pronto' | 'falhou'

/** Letras como a API conta (pontos de código, não unidades UTF-16: um emoji vale 1). */
const tamanho = (texto: string) => [...texto].length
const normalizado = (texto: string) => texto.trim().replace(/\s+/g, ' ')

export const perguntasOrdenadas = (
  perguntas: readonly PerguntaDoEvento[],
): PerguntaDoEvento[] =>
  [...perguntas].sort(
    (a, b) => a.ordem - b.ordem || a.id_pergunta - b.id_pergunta,
  )

/** O evento tem pergunta que pede um arquivo? Então a inscrição é com a secretaria (o site não recebe arquivo). */
export const pedeArquivo = (perguntas: readonly PerguntaDoEvento[]) =>
  perguntas.some((p) => p.tipo === 'ARQUIVO')

/** As opções de uma pergunta de seleção: o texto vem em CSV (separado por vírgula); sem vazios nem repetidas. */
export function opcoesDaPergunta(
  pergunta: Pick<PerguntaDoEvento, 'opcoes'>,
): string[] {
  const opcoes = (pergunta.opcoes ?? '')
    .split(',')
    .map((opcao) => opcao.trim())
    .filter(Boolean)
  return [...new Set(opcoes)]
}

export const escolhaUnicaEmRadios = (
  pergunta: Pick<PerguntaDoEvento, 'opcoes'>,
) => opcoesDaPergunta(pergunta).length <= MAXIMO_DE_OPCOES_EM_RADIOS

/** "12 vagas", "1 vaga", "sem vagas: lista de espera"; sem limite de vagas (ou sem informação) = nada. */
export function rotuloDeVagasDaSessao(
  vagasLivres: number | null | undefined,
): string {
  if (typeof vagasLivres !== 'number') return ''
  if (vagasLivres <= 0) return 'sem vagas: lista de espera'
  return vagasLivres === 1 ? '1 vaga' : `${vagasLivres} vagas`
}

/** O texto da opção de uma sessão no campo "Sessão": o rótulo fixo e, quando se sabe, as vagas livres. */
export function textoDaOpcaoDaSessao(
  rotulo: string,
  vagasLivres: number | null | undefined,
): string {
  const vagas = rotuloDeVagasDaSessao(vagasLivres)
  return vagas ? `${rotulo} — ${vagas}` : rotulo
}

/** O texto do campo de data (AAAA-MM-DD) é uma data que existe? */
function dataExiste(texto: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (!partes) return false
  const [ano, mes, dia] = [
    Number(partes[1]),
    Number(partes[2]),
    Number(partes[3]),
  ] as [number, number, number]
  const data = new Date(Date.UTC(ano, mes - 1, dia))
  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  )
}

const NUMERO = /^-?\d+([.,]\d+)?$/

export function erroDoNome(nome: string): string | undefined {
  const letras = tamanho(normalizado(nome))
  if (letras < NOME_MINIMO) return 'Informe o nome completo.'
  if (letras > NOME_MAXIMO)
    return `O nome está comprido demais (até ${NOME_MAXIMO} letras).`
  return undefined
}

export function erroDoCpf(cpf: string): string | undefined {
  if (!cpf.trim()) return 'Informe o CPF.'
  if (!cpfValido(cpf))
    return 'Esse CPF não confere: veja se os números estão certos.'
  return undefined
}

export function erroDoEmail(email: string): string | undefined {
  const texto = email.trim()
  if (!texto) return 'Informe o seu e-mail.'
  if (!EMAIL.test(texto)) return 'Esse e-mail não parece certo.'
  return undefined
}

export function erroDoTelefone(telefone: string): string | undefined {
  if (!telefone.trim()) return 'Informe o telefone, com o DDD.'
  if (!telefoneValido(telefone))
    return 'Use o DDD e o número, com 10 ou 11 dígitos.'
  return undefined
}

/** A resposta em bruto está em branco? (texto só com espaços, ou nenhuma opção marcada) */
export function respostaEmBranco(bruta: RespostaBruta | undefined): boolean {
  if (bruta === undefined) return true
  if (Array.isArray(bruta)) return bruta.length === 0
  return bruta.trim() === ''
}

/** O que falta ou está errado numa resposta, com as palavras de cada tipo de pergunta (a API só confere se as obrigatórias foram respondidas). */
export function erroDaResposta(
  pergunta: PerguntaDoEvento,
  bruta: RespostaBruta | undefined,
): string | undefined {
  const emBranco = respostaEmBranco(bruta)
  if (emBranco) {
    if (!pergunta.obrigatoria) return undefined
    switch (pergunta.tipo) {
      case 'SELECAO_UNICA':
        return 'Escolha uma opção.'
      case 'SELECAO_MULTIPLA':
        return 'Escolha ao menos uma opção.'
      case 'NUMERO':
        return 'Informe um número.'
      case 'DATA':
        return 'Informe a data.'
      default:
        return 'Responda a esta pergunta.'
    }
  }
  const texto = Array.isArray(bruta) ? '' : (bruta ?? '').trim()
  switch (pergunta.tipo) {
    case 'TEXTO_LONGO':
      return tamanho(texto) > RESPOSTA_LONGA_MAXIMA
        ? `A resposta está comprida demais (até ${RESPOSTA_LONGA_MAXIMA.toLocaleString('pt-BR')} letras).`
        : undefined
    case 'NUMERO':
      return NUMERO.test(texto)
        ? undefined
        : 'Use só números (para decimais, pode usar a vírgula).'
    case 'DATA':
      return dataExiste(texto) ? undefined : 'Confira a data.'
    case 'SELECAO_UNICA':
      return opcoesDaPergunta(pergunta).includes(texto)
        ? undefined
        : 'Escolha uma das opções.'
    case 'SELECAO_MULTIPLA': {
      const opcoes = opcoesDaPergunta(pergunta)
      return (Array.isArray(bruta) ? bruta : []).every((o) =>
        opcoes.includes(o),
      )
        ? undefined
        : 'Escolha só entre as opções.'
    }
    default:
      return tamanho(normalizado(texto)) > RESPOSTA_CURTA_MAXIMA
        ? `A resposta está comprida demais (até ${RESPOSTA_CURTA_MAXIMA} letras).`
        : undefined
  }
}

/**
 * Tudo que há para corrigir, na ordem da página: para cada pessoa o nome e o CPF (na principal, em seguida o e-mail e o telefone) e as perguntas; por último o
 * consentimento. O mesmo CPF duas vezes na mesma inscrição é apontado na segunda vez.
 */
export function validarInscricao(
  v: ValoresDaInscricao,
  perguntas: readonly PerguntaDoEvento[],
  consentimento: EstadoDoConsentimento = 'pronto',
): ErrosDaInscricao {
  const erros: ErrosDaInscricao = {}
  const perguntasDeResposta = perguntasOrdenadas(perguntas).filter(
    (p) => p.tipo !== 'ARQUIVO',
  )
  const cpfsVistos = new Set<string>()
  v.participantes.forEach((pessoa, posicao) => {
    const nome = erroDoNome(pessoa.nome_completo)
    if (nome) erros[chaveDoNome(pessoa.indice)] = nome
    let cpf = erroDoCpf(pessoa.cpf)
    if (!cpf) {
      const digitos = somenteDigitos(pessoa.cpf)
      if (cpfsVistos.has(digitos))
        cpf = 'Este CPF já foi informado para outra pessoa desta inscrição.'
      cpfsVistos.add(digitos)
    }
    if (cpf) erros[chaveDoCpf(pessoa.indice)] = cpf
    if (posicao === 0) {
      const email = erroDoEmail(v.email)
      if (email) erros[CHAVE_DO_EMAIL] = email
      const telefone = erroDoTelefone(v.telefone)
      if (telefone) erros[CHAVE_DO_TELEFONE] = telefone
    }
    for (const pergunta of perguntasDeResposta) {
      const erro = erroDaResposta(
        pergunta,
        pessoa.respostas[String(pergunta.id_pergunta)],
      )
      if (erro)
        erros[chaveDaPergunta(pessoa.indice, pergunta.id_pergunta)] = erro
    }
  })
  if (consentimento === 'carregando')
    erros[CHAVE_DO_CONSENTIMENTO] =
      'Aguarde: o texto do consentimento ainda está carregando.'
  else if (consentimento === 'falhou')
    erros[CHAVE_DO_CONSENTIMENTO] =
      'Não foi possível carregar o texto do consentimento: use “Tentar carregar de novo”.'
  else if (!v.consentimento_lgpd)
    erros[CHAVE_DO_CONSENTIMENTO] =
      'Para se inscrever, é preciso ler e aceitar o texto de consentimento.'
  return erros
}

/** As respostas de UMA pessoa como a API as espera: por `id_pergunta` (texto); número como número; seleção múltipla como lista. Pergunta em branco não vai. */
export function respostasDoParticipante(
  perguntas: readonly PerguntaDoEvento[],
  brutas: Record<string, RespostaBruta>,
): Record<string, string | number | string[]> {
  const respostas: Record<string, string | number | string[]> = {}
  for (const pergunta of perguntasOrdenadas(perguntas)) {
    if (pergunta.tipo === 'ARQUIVO') continue
    const bruta = brutas[String(pergunta.id_pergunta)]
    if (respostaEmBranco(bruta)) continue
    const chave = String(pergunta.id_pergunta)
    if (pergunta.tipo === 'SELECAO_MULTIPLA') {
      respostas[chave] = Array.isArray(bruta) ? [...bruta] : [String(bruta)]
    } else if (pergunta.tipo === 'NUMERO') {
      respostas[chave] = Number(String(bruta).trim().replace(',', '.'))
    } else if (pergunta.tipo === 'TEXTO_LONGO') {
      respostas[chave] = String(bruta).trim()
    } else {
      respostas[chave] = normalizado(String(bruta))
    }
  }
  return respostas
}

/**
 * O corpo que a API espera (`InscricaoPublicaCriar`): CPF e telefone só com dígitos; a sessão só se escolhida; a primeira pessoa é a principal e as outras vão em
 * `participantes_adicionais`; a versão do consentimento é a que a API mostrou; `pagina_web` é a armadilha de robô (sempre vazia para gente de verdade).
 */
export function montarCorpo(
  v: ValoresDaInscricao,
  perguntas: readonly PerguntaDoEvento[],
  versaoDoConsentimento: string,
  armadilha = '',
): Record<string, unknown> {
  const [principal, ...adicionais] = v.participantes
  if (!principal) throw new Error('A inscrição precisa de ao menos uma pessoa.')
  const corpo: Record<string, unknown> = {
    nome_completo: normalizado(principal.nome_completo),
    cpf: somenteDigitos(principal.cpf),
    email: v.email.trim(),
    telefone: somenteDigitos(v.telefone),
    respostas: respostasDoParticipante(perguntas, principal.respostas),
  }
  if (v.id_sessao.trim()) corpo.id_sessao = Number(v.id_sessao)
  corpo.participantes_adicionais = adicionais.map((pessoa) => ({
    nome_completo: normalizado(pessoa.nome_completo),
    cpf: somenteDigitos(pessoa.cpf),
    respostas: respostasDoParticipante(perguntas, pessoa.respostas),
  }))
  corpo.consentimento_lgpd = v.consentimento_lgpd
  corpo.versao_texto_consentimento = versaoDoConsentimento
  corpo.pagina_web = armadilha
  return corpo
}

/** A API recusou porque o texto do consentimento mudou desde que a página abriu (422 com a frase do consentimento)? */
export function consentimentoDesatualizado(erro: unknown): boolean {
  return (
    erro instanceof ApiError &&
    erro.status === 422 &&
    /consentimento/i.test(erro.detalhe ?? '')
  )
}

/**
 * A frase de falha do envio. A API manda o motivo em português nos erros de quem preenche (4xx): ele é mostrado como veio. Erro de servidor e queda de rede
 * ganham orientação sem culpar a pessoa; em grupo, avisa que parte das pessoas pode já ter sido inscrita (cada uma é gravada em seguida da outra).
 */
export function mensagemDeFalhaDoEnvio(
  erro: unknown,
  totalDePessoas = 1,
): string {
  const semServidor =
    'Não foi possível enviar a inscrição agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.'
  if (!(erro instanceof ApiError)) return semServidor
  if (erro.status === undefined)
    return `${semServidor} Se a sua conexão caiu no meio do envio, a inscrição pode ter sido registrada: veja se chegou um e-mail antes de tentar de novo.`
  if (erro.status === 429)
    return (
      erro.detalhe ??
      'Muitas inscrições vieram deste endereço. Aguarde um pouco e tente de novo, ou fale com a secretaria.'
    )
  if (erro.status >= 500 || !erro.detalhe) return semServidor
  if (erro.status === 400 && /já está inscrit/i.test(erro.detalhe)) {
    const grupo =
      totalDePessoas > 1
        ? ' Como são várias pessoas, algumas podem já ter sido inscritas agora há pouco: veja o seu e-mail ou fale com a secretaria antes de tentar de novo.'
        : ''
    return `${erro.detalhe} Confira o CPF digitado ou fale com a secretaria.${grupo}`
  }
  return erro.detalhe
}

export interface ConsentimentoLgpd {
  texto: string
  versao: string
}

/**
 * O texto do consentimento e a versão que a API confere (`GET /api/publico/eventos/consentimento-lgpd`). Texto em branco, ou sem versão, é o mesmo que não ter:
 * erro, e a página não deixa enviar (aceitar um texto que não se pôde ler não vale).
 */
export async function buscarConsentimento(opcoes: {
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
}): Promise<ConsentimentoLgpd> {
  const dados = await buscarJson<{ texto?: unknown; versao?: unknown }>(
    '/api/publico/eventos/consentimento-lgpd',
    { ...opcoes, timeoutMs: opcoes.timeoutMs ?? 35_000, tentativas: 2 },
  )
  const { texto, versao } = dados ?? {}
  if (
    typeof texto !== 'string' ||
    !texto.trim() ||
    (typeof versao !== 'string' && typeof versao !== 'number') ||
    String(versao).trim() === ''
  )
    throw new ApiError('O texto do consentimento veio vazio.')
  return { texto, versao: String(versao) }
}

/** Uma pessoa na resposta da inscrição. */
export interface ParticipanteInscrito {
  nome_completo: string
  status: string
  codigo_checkin: string | null
  token_cancelamento: string | null
  email_enviado: boolean
}

const textoOuNada = (valor: unknown) =>
  typeof valor === 'string' && valor.trim() ? valor : null

/**
 * A resposta do envio como a tela usa. A armadilha de robô dispara uma resposta de sucesso SEM participantes e sem código: a lista vem vazia e a tela mostra só
 * "Recebemos a sua inscrição.". Sem a lista `participantes` (resposta no formato antigo, de uma pessoa só), vale o que vem no topo.
 */
export function lerResposta(
  resposta: unknown,
  nomeDaPrincipal = '',
): ParticipanteInscrito[] {
  const corpo = (
    resposta && typeof resposta === 'object' ? resposta : {}
  ) as Record<string, unknown>
  const doTopo = (): ParticipanteInscrito[] => {
    const status = textoOuNada(corpo.status)
    const codigo = textoOuNada(corpo.codigo_checkin)
    const token = textoOuNada(corpo.token_cancelamento)
    if (!status || (!codigo && !token)) return []
    return [
      {
        nome_completo: nomeDaPrincipal,
        status,
        codigo_checkin: codigo,
        token_cancelamento: token,
        email_enviado: corpo.email_enviado === true,
      },
    ]
  }
  if (!Array.isArray(corpo.participantes)) return doTopo()
  const lista = corpo.participantes
    .filter(
      (p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object',
    )
    .map((p) => ({
      nome_completo: textoOuNada(p.nome_completo) ?? '',
      status: textoOuNada(p.status) ?? '',
      codigo_checkin: textoOuNada(p.codigo_checkin),
      token_cancelamento: textoOuNada(p.token_cancelamento),
      email_enviado: p.email_enviado === true,
    }))
  return lista.length > 0 ? lista : doTopo()
}

/** Como a pessoa lê a situação: 'Pré-inscrito' é vaga reservada; 'Lista de Espera' é sem vaga por enquanto. */
export function situacaoEmPalavras(status: string): {
  rotulo: string
  listaDeEspera: boolean
} {
  if (status === 'Lista de Espera')
    return { rotulo: 'Lista de espera', listaDeEspera: true }
  if (status === 'Pré-inscrito')
    return { rotulo: 'Vaga reservada', listaDeEspera: false }
  if (status === 'Confirmado')
    return { rotulo: 'Vaga confirmada', listaDeEspera: false }
  return { rotulo: status, listaDeEspera: false }
}

/** O endereço (da página de cancelar/confirmar) de quem se inscreveu: o código vai na query, nunca no caminho. */
export const caminhoDoLinkDaInscricao = (token: string) =>
  `/cancelar-inscricao/?token=${encodeURIComponent(token)}`

/**
 * A frase do e-mail da tela de resultado. Todas as pessoas com e-mail enviado: uma frase só; nenhuma: o aviso de guardar o código e o link; umas sim e outras
 * não: devolve `null` e a tela diz a situação de cada uma (o e-mail é o mesmo, mas cada pessoa tem o seu envio).
 */
export function fraseDoEmail(
  participantes: readonly ParticipanteInscrito[],
  email: string,
): string | null {
  if (participantes.length === 0) return null
  const enviados = participantes.filter((p) => p.email_enviado).length
  if (enviados === participantes.length) {
    const comCodigo = participantes.some((p) => p.codigo_checkin)
    return `Enviamos um e-mail para ${email} com ${comCodigo ? 'o código e o link' : 'o link'}.`
  }
  if (enviados === 0)
    return 'Não conseguimos enviar o e-mail: guarde o código e o link desta tela.'
  return null
}

export const FRASE_DE_EMAIL_NAO_ENVIADO =
  'Não conseguimos enviar o e-mail: guarde o código e o link desta tela.'

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* O NAVEGADOR                                                                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

export interface OpcoesDaInscricao {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
}

type Controle = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

const ehControle = (el: Element | null): el is Controle =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement

const porChave = (raiz: ParentNode, chave: string): HTMLElement | null =>
  raiz.querySelector<HTMLElement>(`[data-campo="${chave}"]`)

/** O que está preenchido num campo: o texto do controle, ou as opções marcadas de um grupo (botões de marcar). */
function lerCampo(el: HTMLElement | null, tipo: string): RespostaBruta {
  if (!el) return tipo === 'SELECAO_MULTIPLA' ? [] : ''
  if (ehControle(el)) return el.value
  const marcadas = [...el.querySelectorAll<HTMLInputElement>('input:checked')]
  const valores = marcadas.map((marcada) => marcada.value)
  return tipo === 'SELECAO_MULTIPLA' ? valores : (valores[0] ?? '')
}

function lerPerguntasDoFormulario(form: HTMLFormElement): PerguntaDoEvento[] {
  try {
    const bruto: unknown = JSON.parse(form.dataset.perguntas ?? '[]')
    return Array.isArray(bruto) ? (bruto as PerguntaDoEvento[]) : []
  } catch {
    return []
  }
}

function lerValores(
  form: HTMLFormElement,
  perguntas: readonly PerguntaDoEvento[],
): ValoresDaInscricao {
  const participantes = [
    ...form.querySelectorAll<HTMLElement>('[data-participante]'),
  ].map((bloco) => {
    const indice = Number(bloco.dataset.indice)
    const respostas: Record<string, RespostaBruta> = {}
    for (const pergunta of perguntas) {
      if (pergunta.tipo === 'ARQUIVO') continue
      respostas[String(pergunta.id_pergunta)] = lerCampo(
        porChave(bloco, chaveDaPergunta(indice, pergunta.id_pergunta)),
        pergunta.tipo,
      )
    }
    const nome = porChave(bloco, chaveDoNome(indice))
    const cpf = porChave(bloco, chaveDoCpf(indice))
    return {
      indice,
      nome_completo: ehControle(nome) ? nome.value : '',
      cpf: ehControle(cpf) ? cpf.value : '',
      respostas,
    }
  })
  const campo = (chave: string) => {
    const el = porChave(form, chave)
    return ehControle(el) ? el.value : ''
  }
  const aceite = porChave(form, CHAVE_DO_CONSENTIMENTO)
  return {
    participantes,
    email: campo(CHAVE_DO_EMAIL),
    telefone: campo(CHAVE_DO_TELEFONE),
    id_sessao: campo(CHAVE_DA_SESSAO),
    consentimento_lgpd: aceite instanceof HTMLInputElement && aceite.checked,
  }
}

const textoDoResumo = (total: number) =>
  total === 1
    ? 'Há 1 campo para corrigir.'
    : `Há ${total} campos para corrigir.`

function mostrarErros(form: HTMLFormElement, erros: ErrosDaInscricao): void {
  for (const mensagem of form.querySelectorAll<HTMLElement>('[data-erro]')) {
    const texto = erros[mensagem.dataset.erro ?? '']
    mensagem.textContent = texto ?? ''
    mensagem.hidden = !texto
  }
  for (const campo of form.querySelectorAll<HTMLElement>('[data-campo]')) {
    if (erros[campo.dataset.campo ?? ''])
      campo.setAttribute('aria-invalid', 'true')
    else campo.removeAttribute('aria-invalid')
  }
  const resumo = form.querySelector<HTMLElement>('[data-resumo-de-erros]')
  if (resumo) {
    const total = Object.keys(erros).length
    resumo.textContent = total === 0 ? '' : textoDoResumo(total)
    resumo.hidden = total === 0
  }
}

/** Quem corrige um campo vê o aviso dele sumir na hora (e o resumo acompanhar), sem esperar o próximo envio. */
function limparErroDoCampo(form: HTMLFormElement, campo: HTMLElement): void {
  const chave = campo.dataset.campo
  if (!chave) return
  const mensagem = form.querySelector<HTMLElement>(`[data-erro="${chave}"]`)
  if (mensagem) {
    mensagem.textContent = ''
    mensagem.hidden = true
  }
  campo.removeAttribute('aria-invalid')
  atualizarResumo(form)
}

function atualizarResumo(form: HTMLFormElement): void {
  const resumo = form.querySelector<HTMLElement>('[data-resumo-de-erros]')
  if (resumo && !resumo.hidden) {
    const restantes = form.querySelectorAll('[data-erro]:not([hidden])').length
    resumo.textContent = restantes === 0 ? '' : textoDoResumo(restantes)
    resumo.hidden = restantes === 0
  }
}

/** O foco vai ao campo; num grupo de botões de marcar, ao primeiro botão. */
function focarCampo(form: HTMLFormElement, chave: string): void {
  const campo = porChave(form, chave)
  if (!campo) return
  const alvo = ehControle(campo)
    ? campo
    : campo.querySelector<HTMLElement>('input, select, textarea')
  alvo?.focus()
}

/** Atualiza o aviso "As vagas acabaram…": vale a sessão escolhida; sem sessão escolhida, o evento todo. */
export function atualizarAvisoDeVagas(secao: HTMLElement): void {
  const aviso = secao.querySelector<HTMLElement>('[data-aviso-esgotado]')
  if (!aviso) return
  let livres = secao.dataset.vagasLivres
  const sessao = secao.querySelector<HTMLSelectElement>(
    'select[data-campo="sessao"]',
  )
  if (sessao?.value) livres = sessao.selectedOptions[0]?.dataset.vagasLivres
  aviso.hidden = livres !== '0'
}

export interface VagasAoVivo {
  vagas_livres?: number | null
  sessoes?: Array<{ id_sessao?: number; vagas_livres?: number | null }>
}

/**
 * As vagas de AGORA (a ilha `evento-vivo` busca na API; o número do build seria velho): atualiza as vagas do evento e o texto de cada sessão no formulário e
 * refaz o aviso de "vagas acabaram". Sem formulário na página, não faz nada.
 */
export function aplicarVagasAoVivo(raiz: HTMLElement, vivo: VagasAoVivo): void {
  const secao = raiz.querySelector<HTMLElement>('[data-inscricao-formulario]')
  if (!secao) return
  if (typeof vivo.vagas_livres === 'number')
    secao.dataset.vagasLivres = String(vivo.vagas_livres)
  else if (vivo.vagas_livres === null) delete secao.dataset.vagasLivres
  for (const sessao of vivo.sessoes ?? []) {
    if (!Number.isInteger(sessao.id_sessao)) continue
    const opcao = secao.querySelector<HTMLOptionElement>(
      `option[data-sessao="${sessao.id_sessao}"]`,
    )
    if (!opcao) continue
    if (typeof sessao.vagas_livres === 'number')
      opcao.dataset.vagasLivres = String(sessao.vagas_livres)
    else if (sessao.vagas_livres === null) delete opcao.dataset.vagasLivres
    else continue
    opcao.textContent = textoDaOpcaoDaSessao(
      opcao.dataset.rotulo ?? opcao.textContent ?? '',
      sessao.vagas_livres,
    )
  }
  atualizarAvisoDeVagas(secao)
}

/** O formulário some (evento que já aconteceu, ou retirado da programação) — salvo se a pessoa já acabou de se inscrever: aí a tela dela fica. */
export function esconderComoParticipar(raiz: HTMLElement): void {
  const bloco = raiz.querySelector<HTMLElement>('[data-como-participar]')
  if (!bloco) return
  if (bloco.querySelector('[data-inscricao-formulario][data-concluida]')) return
  bloco.hidden = true
}

function criar<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  conteudo?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (classe) el.className = classe
  if (conteudo !== undefined) el.textContent = conteudo
  return el
}

const LINK = 'break-all font-medium text-primary underline underline-offset-4'

/** A tela de resultado: para CADA pessoa, o nome, a situação, o código de check-in (só quem tem vaga) e o link para cancelar/confirmar. */
function mostrarResultado(
  resultado: HTMLElement,
  pessoas: readonly ParticipanteInscrito[],
  email: string,
): void {
  const aviso = resultado.querySelector<HTMLElement>('[data-resultado-email]')
  const lista = resultado.querySelector<HTMLElement>('[data-resultado-lista]')
  const frase = fraseDoEmail(pessoas, email)
  if (aviso) {
    aviso.textContent = frase ?? ''
    aviso.hidden = !frase
  }
  if (lista) {
    lista.replaceChildren()
    lista.hidden = pessoas.length === 0
    for (const pessoa of pessoas) {
      const item = criar('li', 'rounded-md border bg-card p-4')
      item.dataset.pessoaInscrita = pessoa.nome_completo
      if (pessoa.nome_completo)
        item.append(criar('p', 'text-lg font-semibold', pessoa.nome_completo))
      const situacao = situacaoEmPalavras(pessoa.status)
      const linhaDaSituacao = criar('p', 'mt-1', 'Situação: ')
      linhaDaSituacao.append(criar('strong', undefined, situacao.rotulo))
      item.append(linhaDaSituacao)
      if (situacao.listaDeEspera) {
        item.append(criar('p', 'mt-1', AVISO_DA_LISTA_DE_ESPERA))
      } else if (pessoa.codigo_checkin) {
        const linhaDoCodigo = criar('p', 'mt-3', 'Código de check-in: ')
        const codigo = criar(
          'strong',
          'ml-1 rounded-md border-2 border-primary px-2 py-1 text-xl tracking-wide',
          pessoa.codigo_checkin,
        )
        codigo.dataset.codigo = ''
        linhaDoCodigo.append(codigo)
        item.append(
          linhaDoCodigo,
          criar('p', 'mt-2', 'Apresente este código na entrada do evento.'),
        )
      }
      if (pessoa.token_cancelamento) {
        const caminho = caminhoDoLinkDaInscricao(pessoa.token_cancelamento)
        const link = criar(
          'a',
          LINK,
          new URL(caminho, window.location.origin).href,
        )
        link.href = caminho
        link.dataset.linkDaInscricao = ''
        const linhaDoLink = criar('p', 'mt-2')
        linhaDoLink.append(link)
        item.append(criar('p', 'mt-3', AVISO_DO_LINK), linhaDoLink)
      }
      if (frase === null)
        item.append(
          criar(
            'p',
            'mt-2',
            pessoa.email_enviado
              ? `Enviamos um e-mail para ${email}.`
              : FRASE_DE_EMAIL_NAO_ENVIADO,
          ),
        )
      lista.append(item)
    }
  }
  resultado.hidden = false
  resultado.focus()
}

/** Dá vida ao formulário de inscrição (`[data-inscricao-formulario]`). */
export function iniciarFormularioDeInscricao(
  secao: HTMLElement,
  opcoes: OpcoesDaInscricao = {},
): void {
  const encontrado = secao.querySelector<HTMLFormElement>(
    'form[data-inscricao-form]',
  )
  if (!encontrado) return
  // `const` tipado: as funções declaradas abaixo não herdam o "não é nulo" da conferência acima
  const form: HTMLFormElement = encontrado
  const baseUrl = secao.dataset.apiUrl ?? ''
  const idDoEvento = secao.dataset.idEvento ?? ''
  const perguntas = perguntasOrdenadas(lerPerguntasDoFormulario(form))
  const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')
  const rotuloDoBotao = botao?.textContent?.trim() || 'Enviar inscrição'
  const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')
  const resultado = secao.querySelector<HTMLElement>('[data-resultado]')

  /* --- o texto do consentimento, sempre o da API --- */
  let consentimento: ConsentimentoLgpd | null = null
  let estadoDoConsentimento: EstadoDoConsentimento = 'carregando'
  const aceite = porChave(form, CHAVE_DO_CONSENTIMENTO)
  const caixaDeTexto = form.querySelector<HTMLElement>(
    '[data-consentimento-texto]',
  )
  const avisoDoConsentimento = form.querySelector<HTMLElement>(
    '[data-consentimento-estado]',
  )
  const tentarDeNovo = form.querySelector<HTMLButtonElement>(
    '[data-recarregar-consentimento]',
  )
  const definirAceite = (habilitado: boolean) => {
    if (aceite instanceof HTMLInputElement) {
      aceite.disabled = !habilitado
      if (!habilitado) aceite.checked = false
    }
  }
  async function carregarConsentimento(): Promise<void> {
    estadoDoConsentimento = 'carregando'
    consentimento = null
    definirAceite(false)
    if (caixaDeTexto) caixaDeTexto.hidden = true
    if (tentarDeNovo) tentarDeNovo.hidden = true
    if (avisoDoConsentimento) {
      avisoDoConsentimento.textContent = 'Carregando o texto do consentimento…'
      avisoDoConsentimento.hidden = false
    }
    try {
      consentimento = await buscarConsentimento({
        baseUrl,
        fetchImpl: opcoes.fetchImpl,
        timeoutMs: opcoes.timeoutMs,
        esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
      })
      estadoDoConsentimento = 'pronto'
      if (caixaDeTexto) {
        caixaDeTexto.textContent = consentimento.texto
        caixaDeTexto.hidden = false
      }
      if (avisoDoConsentimento) avisoDoConsentimento.hidden = true
      definirAceite(true)
    } catch {
      estadoDoConsentimento = 'falhou'
      if (avisoDoConsentimento) {
        avisoDoConsentimento.textContent = FALHA_DO_CONSENTIMENTO
        avisoDoConsentimento.hidden = false
      }
      if (tentarDeNovo) tentarDeNovo.hidden = false
    }
  }
  tentarDeNovo?.addEventListener('click', () => void carregarConsentimento())
  void carregarConsentimento()

  /* --- mais pessoas na mesma inscrição --- */
  const containerDeExtras = form.querySelector<HTMLElement>(
    '[data-participantes-adicionais]',
  )
  const modelo = secao.querySelector<HTMLTemplateElement>(
    'template[data-modelo-participante]',
  )
  const botaoDeAdicionar = form.querySelector<HTMLButtonElement>(
    '[data-adicionar-participante]',
  )
  const avisoDoLimite = form.querySelector<HTMLElement>(
    '[data-limite-de-pessoas]',
  )
  let proximoIndice = 1
  const extras = () =>
    containerDeExtras
      ? [
          ...containerDeExtras.querySelectorAll<HTMLElement>(
            '[data-participante]',
          ),
        ]
      : []
  function renumerar(): void {
    extras().forEach((bloco, posicao) => {
      const numero = posicao + 2
      const titulo = bloco.querySelector<HTMLElement>('[data-titulo-da-pessoa]')
      if (titulo) titulo.textContent = `Pessoa ${numero}`
      const remover = bloco.querySelector<HTMLElement>(
        '[data-remover-participante]',
      )
      if (remover) remover.textContent = `Remover a pessoa ${numero}`
    })
    const cheio = extras().length >= MAXIMO_DE_PESSOAS_ADICIONAIS
    if (botaoDeAdicionar) botaoDeAdicionar.disabled = cheio
    if (avisoDoLimite) avisoDoLimite.hidden = !cheio
  }
  function adicionarPessoa(): void {
    if (!modelo || !containerDeExtras) return
    if (extras().length >= MAXIMO_DE_PESSOAS_ADICIONAIS) return
    const indice = proximoIndice++
    const fragmento = modelo.content.cloneNode(true) as DocumentFragment
    for (const el of fragmento.querySelectorAll('*'))
      for (const atributo of [...el.attributes])
        if (atributo.value.includes('__N__'))
          atributo.value = atributo.value.replaceAll('__N__', String(indice))
    containerDeExtras.append(fragmento)
    renumerar()
    focarCampo(form, chaveDoNome(indice))
  }
  botaoDeAdicionar?.addEventListener('click', adicionarPessoa)
  form.addEventListener('click', (evento) => {
    const alvo = evento.target
    if (!(alvo instanceof Element)) return
    const remover = alvo.closest('[data-remover-participante]')
    if (!remover) return
    remover.closest('[data-participante]')?.remove()
    renumerar()
    atualizarResumo(form)
    botaoDeAdicionar?.focus()
  })

  /* --- o que a pessoa digita --- */
  form.addEventListener('input', (evento) => {
    const alvo = evento.target
    if (!(alvo instanceof HTMLElement)) return
    const campo = alvo.closest<HTMLElement>('[data-campo]')
    if (campo) limparErroDoCampo(form, campo)
  })
  form.addEventListener('change', (evento) => {
    const alvo = evento.target
    if (!(alvo instanceof HTMLElement)) return
    const campo = alvo.closest<HTMLElement>('[data-campo]')
    if (campo) limparErroDoCampo(form, campo)
    if (campo?.dataset.campo === CHAVE_DA_SESSAO) atualizarAvisoDeVagas(secao)
  })
  atualizarAvisoDeVagas(secao)

  /* --- o envio --- */
  form.addEventListener('submit', (evento) => {
    evento.preventDefault()
    // um segundo envio enquanto o primeiro está a caminho criaria inscrições repetidas
    if (form.getAttribute('aria-busy') === 'true') return
    if (falha) falha.hidden = true
    const valores = lerValores(form, perguntas)
    const erros = validarInscricao(valores, perguntas, estadoDoConsentimento)
    mostrarErros(form, erros)
    const primeiro = Object.keys(erros)[0]
    if (primeiro !== undefined) {
      focarCampo(form, primeiro)
      return
    }
    if (!consentimento) return

    if (botao) {
      botao.disabled = true
      botao.textContent = 'Enviando…'
    }
    form.setAttribute('aria-busy', 'true')
    const armadilha =
      form.querySelector<HTMLInputElement>('input[name="pagina_web"]')?.value ??
      ''
    void enviarJson<unknown>(
      `/api/publico/eventos/${encodeURIComponent(idDoEvento)}/inscrever-se`,
      montarCorpo(valores, perguntas, consentimento.versao, armadilha),
      {
        baseUrl,
        fetchImpl: opcoes.fetchImpl,
        timeoutMs: opcoes.timeoutMs,
      },
    )
      .then((resposta) => {
        const pessoas = lerResposta(
          resposta,
          normalizado(valores.participantes[0]?.nome_completo ?? ''),
        )
        secao.dataset.concluida = ''
        form.hidden = true
        // some tudo que era do formulário (apresentação e aviso de vagas): fica a tela de resultado
        for (const bloco of secao.querySelectorAll<HTMLElement>(
          '[data-introducao], [data-aviso-esgotado]',
        ))
          bloco.hidden = true
        if (resultado)
          mostrarResultado(resultado, pessoas, valores.email.trim())
      })
      .catch((erro: unknown) => {
        if (consentimentoDesatualizado(erro)) {
          // o texto mudou: mostra o novo e pede o aceite de novo (a caixa volta desmarcada)
          void carregarConsentimento()
          if (falha) {
            falha.textContent =
              'O texto do consentimento foi atualizado. Leia a versão nova e marque a caixa de novo para enviar a inscrição.'
            falha.hidden = false
            falha.focus()
          }
          return
        }
        if (falha) {
          falha.textContent = mensagemDeFalhaDoEnvio(
            erro,
            valores.participantes.length,
          )
          falha.hidden = false
          falha.focus()
        }
      })
      .finally(() => {
        form.removeAttribute('aria-busy')
        if (botao) {
          botao.disabled = false
          botao.textContent = rotuloDoBotao
        }
      })
  })
}
