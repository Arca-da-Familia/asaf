import { ApiError, buscarJson, enviarJson, type OpcoesBusca } from './api'
import { formatarDiaDeInstanteUtc, formatarInstanteUtc } from './datas'
import {
  avisoDoEventoNoLink,
  caminhoDeCancelar,
  caminhoDeConfirmar,
  lerResumo,
  quandoDoEvento,
  situacaoDoLink,
  valorEmReais,
  type ResumoDaInscricao,
} from './inscricao-link'

/**
 * A página `/minha-conta/` (v5.6b): quem se inscreveu em um evento, doou pelo site ou recebeu um certificado entra com o e-mail e um código de uso único (sem senha) e vê, numa
 * área só, o que está ligado ao e-mail. A página é estática: tudo acontece NO NAVEGADOR, falando com a API (`/api/publico/visitante/...` para pedir o código e entrar,
 * `/api/visitante/...` com a sessão para ler).
 *
 * A SESSÃO fica só no `sessionStorage` desta aba (some ao fechar a aba) e é curta: o servidor a encerra em 60 minutos e a página também. Nada daqui vai para `localStorage`,
 * para cookie ou para o endereço da página. SEGURANÇA: só `textContent` e atributos; nada vindo da API entra como HTML.
 */

const CHAVE_DA_SESSAO = 'asaf-conta-visitante'
const EMAIL_PARECIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MENSAGEM_DE_EMAIL_TORTO =
  'Esse e-mail não parece certo: confira se está escrito sem erro.'
export const MENSAGEM_DE_CODIGO_TORTO =
  'O código tem 6 números: confira o e-mail que enviamos.'
export const MENSAGEM_DE_SESSAO_ACABOU =
  'A sua sessão acabou: peça um novo código para entrar de novo.'
export const MENSAGEM_DE_SAIDA = 'Você saiu da sua conta.'

/** Confere só o formato (a API confere de verdade): evita ir ao servidor com algo que nem parece e-mail. */
export function emailParece(texto: string): boolean {
  return EMAIL_PARECIDO.test(texto.trim())
}

/** O código como a pessoa copiou ("123 456", "123-456"): só os números. */
export function soOsNumeros(texto: string): string {
  return texto.replace(/\D/g, '')
}

export const codigoTemOTamanhoCerto = (texto: string): boolean =>
  soOsNumeros(texto).length === 6

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* O que a API devolve                                                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

export interface RespostaDoPedidoDeCodigo {
  mensagem: string
  minutos_de_validade: number
}

export interface RespostaDaEntrada {
  token: string
  /** UTC SEM fuso ("2026-10-16T18:00:00"). */
  expira_em: string
}

export interface InscricaoDaConta extends ResumoDaInscricao {
  /** O link secreto de cancelar ou confirmar; só vem quando há o que fazer com ele. */
  token: string | null
}

export interface CertificadoDaConta {
  tipo_documento: string
  atividade: string | null
  /** O primeiro nome de quem recebeu (nunca o nome inteiro). */
  primeiro_nome: string | null
  emitida_em: string | null
  codigo_verificacao: string
  /** Caminho do PDF na API (`/uploads/documentos/...`). */
  arquivo: string | null
}

export interface DoacaoDaConta {
  protocolo: string
  situacao: string
  pedida_em: string | null
  valor_informado: unknown
  campanha: string | null
  valor_recebido: unknown
  data_da_doacao: string | null
  numero_do_recibo: number | null
  recibo_enviado_por_email: boolean | null
}

export interface PedidoDeApagamentoAberto {
  protocolo: string
  prazo_em: string | null
}

/** v5.7f: uma solicitação do titular de dados (LGPD) feita com este e-mail. A resposta com dado pessoal só é entregue AQUI (nunca por e-mail). Nunca o CPF nem o texto do pedido. */
export interface PedidoDoTitularDaConta {
  protocolo: string
  /** O direito pedido, em palavras ("Acessar os dados que a associação tem sobre mim"). */
  o_que_pediu: string | null
  /** 'Novo', 'Em atendimento', 'Respondido' ou 'Encerrado'. */
  situacao: string
  pedido_em: string | null
  prazo_em: string | null
  respondido_em: string | null
  resposta: string | null
  encerrado_em: string | null
  /** Só no pedido encerrado: o motivo que a equipe escreveu. */
  motivo_do_encerramento: string | null
}

export interface ContaDoVisitante {
  email: string
  /** UTC SEM fuso. */
  sessao_expira_em: string | null
  inscricoes: InscricaoDaConta[]
  certificados: CertificadoDaConta[]
  doacoes: DoacaoDaConta[]
  pedidos_do_titular: PedidoDoTitularDaConta[]
  pedido_de_apagamento: PedidoDeApagamentoAberto | null
}

const textoOuNada = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() ? valor : null

const objeto = (valor: unknown): Record<string, unknown> | null =>
  valor && typeof valor === 'object' && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null

/** A resposta de `GET /api/visitante/minha-conta` como a página usa. Sem o e-mail (resposta torta), não é uma conta: `null`. Item torto de uma lista é descartado. */
export function lerConta(dados: unknown): ContaDoVisitante | null {
  const r = objeto(dados)
  const email = r ? textoOuNada(r.email) : null
  if (!r || !email) return null
  const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

  const inscricoes: InscricaoDaConta[] = []
  for (const bruto of lista(r.inscricoes)) {
    const resumo = lerResumo(bruto)
    if (resumo)
      inscricoes.push({
        ...resumo,
        token: textoOuNada(objeto(bruto)?.token),
      })
  }

  const certificados: CertificadoDaConta[] = []
  for (const bruto of lista(r.certificados)) {
    const c = objeto(bruto)
    const codigo = c ? textoOuNada(c.codigo_verificacao) : null
    if (!c || !codigo) continue
    certificados.push({
      tipo_documento: textoOuNada(c.tipo_documento) ?? 'Certificado',
      atividade: textoOuNada(c.atividade),
      primeiro_nome: textoOuNada(c.primeiro_nome),
      emitida_em: textoOuNada(c.emitida_em),
      codigo_verificacao: codigo,
      arquivo: textoOuNada(c.arquivo),
    })
  }

  const doacoes: DoacaoDaConta[] = []
  for (const bruto of lista(r.doacoes)) {
    const d = objeto(bruto)
    const protocolo = d ? textoOuNada(d.protocolo) : null
    if (!d || !protocolo) continue
    doacoes.push({
      protocolo,
      situacao: textoOuNada(d.situacao) ?? '',
      pedida_em: textoOuNada(d.pedida_em),
      valor_informado: d.valor_informado,
      campanha: textoOuNada(d.campanha),
      valor_recebido: d.valor_recebido,
      data_da_doacao: textoOuNada(d.data_da_doacao),
      numero_do_recibo:
        typeof d.numero_do_recibo === 'number' ? d.numero_do_recibo : null,
      recibo_enviado_por_email:
        typeof d.recibo_enviado_por_email === 'boolean'
          ? d.recibo_enviado_por_email
          : null,
    })
  }

  const pedidosDoTitular: PedidoDoTitularDaConta[] = []
  for (const bruto of lista(r.pedidos_do_titular)) {
    const p = objeto(bruto)
    const protocolo = p ? textoOuNada(p.protocolo) : null
    if (!p || !protocolo) continue
    pedidosDoTitular.push({
      protocolo,
      o_que_pediu: textoOuNada(p.o_que_pediu),
      situacao: textoOuNada(p.situacao) ?? '',
      pedido_em: textoOuNada(p.pedido_em),
      prazo_em: textoOuNada(p.prazo_em),
      respondido_em: textoOuNada(p.respondido_em),
      resposta: textoOuNada(p.resposta),
      encerrado_em: textoOuNada(p.encerrado_em),
      motivo_do_encerramento: textoOuNada(p.motivo_do_encerramento),
    })
  }

  const pedido = objeto(r.pedido_de_apagamento)
  const protocoloDoPedido = pedido ? textoOuNada(pedido.protocolo) : null
  return {
    email,
    sessao_expira_em: textoOuNada(r.sessao_expira_em),
    inscricoes,
    certificados,
    doacoes,
    pedidos_do_titular: pedidosDoTitular,
    pedido_de_apagamento:
      pedido && protocoloDoPedido
        ? {
            protocolo: protocoloDoPedido,
            prazo_em: textoOuNada(pedido.prazo_em),
          }
        : null,
  }
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* As chamadas                                                                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

export const pedirCodigo = (
  email: string,
  opcoes: OpcoesBusca,
  armadilha = '',
) =>
  enviarJson<RespostaDoPedidoDeCodigo>(
    '/api/publico/visitante/codigo',
    { email: email.trim(), pagina_web: armadilha },
    opcoes,
  )

export const entrarComCodigo = (
  email: string,
  codigo: string,
  opcoes: OpcoesBusca,
) =>
  enviarJson<RespostaDaEntrada>(
    '/api/publico/visitante/entrar',
    { email: email.trim(), codigo: soOsNumeros(codigo) },
    opcoes,
  )

export const buscarConta = (token: string, opcoes: OpcoesBusca) =>
  buscarJson<unknown>('/api/visitante/minha-conta', { ...opcoes, token })

export const sairDaConta = (token: string, opcoes: OpcoesBusca) =>
  enviarJson<unknown>('/api/visitante/sair', {}, { ...opcoes, token })

export interface RespostaDoApagamento {
  protocolo: string
  prazo_dias: number | null
  prazo_em: string | null
  ja_existia: boolean
}

export const pedirApagamento = (token: string, opcoes: OpcoesBusca) =>
  enviarJson<RespostaDoApagamento>(
    '/api/visitante/pedir-apagamento',
    {},
    { ...opcoes, token },
  )

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* A sessão guardada na aba                                                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

export interface SessaoGuardada {
  token: string
  /** UTC SEM fuso. */
  expira_em: string
}

/** O instante em UTC sem fuso (como o servidor manda) como número. */
export function instanteUtc(isoSemFuso: string): number {
  return new Date(
    /[zZ]|[+-]\d\d:?\d\d$/.test(isoSemFuso) ? isoSemFuso : `${isoSemFuso}Z`,
  ).getTime()
}

export function guardarSessao(
  sessao: SessaoGuardada,
  armazenamento: Pick<Storage, 'setItem'> | null = abrirArmazenamento(),
): void {
  try {
    armazenamento?.setItem(CHAVE_DA_SESSAO, JSON.stringify(sessao))
  } catch {
    // navegador que não deixa guardar (aba privada, bloqueio): a sessão vale só enquanto a página estiver aberta
  }
}

export function esquecerSessao(
  armazenamento: Pick<Storage, 'removeItem'> | null = abrirArmazenamento(),
): void {
  try {
    armazenamento?.removeItem(CHAVE_DA_SESSAO)
  } catch {
    // nada a fazer
  }
}

/** A sessão guardada, se ainda vale; vencida ou torta é apagada e vira `null`. */
export function lerSessaoGuardada(
  armazenamento: Pick<
    Storage,
    'getItem' | 'removeItem'
  > | null = abrirArmazenamento(),
  agora: number = Date.now(),
): SessaoGuardada | null {
  try {
    const bruto = armazenamento?.getItem(CHAVE_DA_SESSAO)
    if (!bruto) return null
    const dados = objeto(JSON.parse(bruto))
    const token = dados ? textoOuNada(dados.token) : null
    const expira = dados ? textoOuNada(dados.expira_em) : null
    if (token && expira && instanteUtc(expira) > agora)
      return { token, expira_em: expira }
  } catch {
    // guardado torto: some
  }
  esquecerSessao(armazenamento)
  return null
}

function abrirArmazenamento(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* Frases                                                                                                                                                       */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

const MOTIVO_DO_LIMITE =
  'Muitos pedidos vieram deste e-mail ou deste endereço. Aguarde cerca de uma hora e tente de novo.'

/** Pedir o código: 422 (e-mail torto) e 429 (limite) explicam; o resto é rede ou servidor. */
export function mensagemDoPedidoDeCodigo(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.status === 422) return erro.detalhe ?? MENSAGEM_DE_EMAIL_TORTO
    if (erro.status === 429) return MOTIVO_DO_LIMITE
  }
  return 'Não foi possível pedir o código agora. Tente de novo em alguns instantes.'
}

/** Entrar: o servidor dá a MESMA frase para código errado, vencido ou que não existe; a página a repete. */
export function mensagemDeEntrada(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.status === 400 && erro.detalhe) return erro.detalhe
    if (erro.status === 422) return MENSAGEM_DE_CODIGO_TORTO
    if (erro.status === 429)
      return 'Muitas tentativas vieram deste endereço. Aguarde alguns minutos e tente de novo.'
  }
  return 'Não foi possível entrar agora. Tente de novo em alguns instantes.'
}

export const sessaoAcabou = (erro: unknown): boolean =>
  erro instanceof ApiError && erro.status === 401

export function mensagemDaConta(erro: unknown): string {
  if (sessaoAcabou(erro)) return MENSAGEM_DE_SESSAO_ACABOU
  return 'Não foi possível buscar a sua conta agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.'
}

export function mensagemDoApagamento(erro: unknown): string {
  if (sessaoAcabou(erro)) return MENSAGEM_DE_SESSAO_ACABOU
  return 'Não foi possível enviar o pedido agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.'
}

const SITUACOES_DA_DOACAO: Record<string, string> = {
  PENDENTE: 'Aguardando a confirmação da tesouraria',
  CONFIRMADA: 'Doação confirmada',
  NAO_LOCALIZADA: 'Pix não localizado no extrato',
  EXPIRADA: 'Prazo vencido sem confirmação',
}

export const situacaoDaDoacao = (situacao: string): string =>
  SITUACOES_DA_DOACAO[situacao] ?? situacao

/** A explicação curta de cada situação da doação: antes da confirmação NÃO há recibo, e a página diz isso. */
export function explicacaoDaDoacao(d: DoacaoDaConta): string | null {
  switch (d.situacao) {
    case 'PENDENTE':
      return 'A doação só vale quando a tesouraria encontrar o Pix no extrato do banco. Até lá não há recibo.'
    case 'NAO_LOCALIZADA':
      return 'A tesouraria não encontrou este Pix no extrato. Se você pagou, fale com a secretaria citando o protocolo.'
    case 'EXPIRADA':
      return 'Passou o prazo sem confirmação. Se você pagou, fale com a secretaria citando o protocolo: ainda é possível confirmar.'
    default:
      return null
  }
}

/** A situação do pedido sobre dados pessoais, em palavras: a resposta só existe quando ela está pronta (e foi entregue aqui, nunca por e-mail). */
export function situacaoDoPedidoDoTitular(p: PedidoDoTitularDaConta): string {
  if (p.situacao === 'Respondido') return 'Respondido'
  if (p.situacao === 'Encerrado') return 'Encerrado'
  return 'Em andamento'
}

/** A explicação curta de cada situação: quando a resposta ainda não está pronta, a página diz que ela só aparece aqui. */
export function explicacaoDoPedidoDoTitular(
  p: PedidoDoTitularDaConta,
): string | null {
  switch (situacaoDoPedidoDoTitular(p)) {
    case 'Em andamento':
      return 'A associação ainda está atendendo este pedido. Antes de responder, ela confere que quem pediu é o titular dos dados. Quando houver resposta, ela aparece aqui e o sistema tenta avisar você por e-mail.'
    case 'Encerrado':
      return p.motivo_do_encerramento
        ? 'A associação encerrou este pedido sem responder com dados pessoais. O motivo está abaixo; se o pedido era seu, faça um novo ou procure a secretaria.'
        : 'A associação encerrou este pedido sem responder com dados pessoais. Se precisar de uma explicação, ou se o pedido era seu, procure a secretaria citando o protocolo.'
    default:
      // respondido sem texto para mostrar: pedido de antes de a resposta passar a ser entregue só aqui (ela foi por e-mail)
      return p.resposta
        ? null
        : 'Este pedido já foi respondido, antes de a resposta passar a ser entregue só aqui. Se precisar de uma cópia, procure a secretaria citando o protocolo.'
  }
}

/** "Recibo nº 12: R$ 45,00 em 16/10/2026" (só depois da confirmação). */
export function linhaDoRecibo(d: DoacaoDaConta): string | null {
  if (d.situacao !== 'CONFIRMADA' || d.numero_do_recibo === null) return null
  const valor = valorEmReais(d.valor_recebido)
  const dia = d.data_da_doacao
    ? formatarDiaDeInstanteUtc(d.data_da_doacao)
    : null
  return [
    `Recibo nº ${d.numero_do_recibo}`,
    [valor, dia ? `em ${dia}` : null].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(': ')
}

export function avisoDoReciboPorEmail(d: DoacaoDaConta): string | null {
  if (d.situacao !== 'CONFIRMADA') return null
  if (d.recibo_enviado_por_email === false)
    return 'O e-mail com o recibo não saiu. Fale com a secretaria citando o protocolo para receber uma cópia.'
  return null
}

/** "16/10/2026 11:30 (horário de Belém)": instante que o sistema grava em UTC sem fuso. */
export const instanteEmPalavras = (iso: string | null): string | null =>
  iso ? `${formatarInstanteUtc(iso)} (horário de Belém)` : null

export const diaEmPalavras = (iso: string | null): string | null =>
  iso ? formatarDiaDeInstanteUtc(iso) : null

/** A frase que diz até quando vale a sessão (a hora de Belém). */
export const frasePeloFimDaSessao = (iso: string | null): string | null =>
  iso
    ? `Por segurança, esta sessão termina em ${formatarInstanteUtc(iso)} (horário de Belém).`
    : null

export function situacaoDaInscricao(i: InscricaoDaConta): string {
  return situacaoDoLink(i.status)
}

/** O que a pessoa pode fazer com a inscrição: os links secretos (cancelar e confirmar) só aparecem quando há o que fazer. */
export function linksDaInscricao(i: InscricaoDaConta): {
  cancelar: string | null
  confirmar: string | null
} {
  if (!i.token) return { cancelar: null, confirmar: null }
  return {
    cancelar: i.pode_cancelar ? caminhoDeCancelar(i.token) : null,
    confirmar:
      i.pode_confirmar && i.evento.status !== 'Cancelado'
        ? caminhoDeConfirmar(i.token)
        : null,
  }
}

export { avisoDoEventoNoLink, quandoDoEvento }
