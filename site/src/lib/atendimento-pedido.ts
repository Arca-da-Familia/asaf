import { ApiError, buscarJson, enviarJson } from './api'
import { formatarDiaDeInstanteUtc } from './datas'
import {
  cpfValido,
  EMAIL,
  somenteDigitos,
  telefoneValido,
} from './filiacao-pedido'

/**
 * Formulários públicos da FILA ÚNICA DE ATENDIMENTO (v5.5a): contato, pedido de informação sobre recursos públicos e solicitação do titular de dados; na v5.5b,
 * também o pedido para ser voluntário (não é preciso ser associado). O pedido sai do site para a API (`POST /api/publico/atendimentos`), ganha protocolo e prazo
 * e cai na fila de quem atende no painel.
 *
 * A API repete todas as regras (quem manda o pedido sem passar pela página também é barrado); aqui elas existem para a pessoa saber o que corrigir antes de
 * enviar. O prazo de resposta NÃO é escrito na página: vem da API (`GET /api/publico/atendimentos/prazos` e a resposta do envio), porque é a diretoria que o
 * define no painel. Sem o número, o texto some; nunca é inventado.
 *
 * SEGURANÇA: só `textContent` e atributos — nada vindo da API entra como HTML.
 */

/** Versão do aviso de privacidade dos formulários. A API só aceita a versão que ela conhece: mudou o texto, muda o número nos dois lados. */
export const VERSAO_DO_AVISO_DE_PRIVACIDADE_DO_ATENDIMENTO = '1'

export const TIPOS_DE_PEDIDO = [
  'CONTATO',
  'PEDIDO_INFORMACAO',
  'TITULAR_LGPD',
  'VOLUNTARIO',
] as const
export type TipoDePedido = (typeof TIPOS_DE_PEDIDO)[number]

/** O que o titular dos dados pode pedir (o `subtipo` da API), com o rótulo que a pessoa lê. */
export const DIREITOS_DO_TITULAR = [
  {
    valor: 'CONFIRMACAO',
    rotulo: 'Confirmar se a associação trata dados meus',
  },
  {
    valor: 'ACESSO',
    rotulo: 'Acessar os dados que a associação tem sobre mim',
  },
  {
    valor: 'CORRECAO',
    rotulo: 'Corrigir dados incompletos, inexatos ou desatualizados',
  },
  {
    valor: 'ELIMINACAO',
    rotulo:
      'Anonimizar, bloquear ou eliminar dados desnecessários ou tratados sem base legal',
  },
  {
    valor: 'PORTABILIDADE',
    rotulo: 'Receber meus dados para levar a outra entidade (portabilidade)',
  },
  {
    valor: 'COMPARTILHAMENTO',
    rotulo: 'Saber com quem a associação compartilhou meus dados',
  },
  { valor: 'REVOGACAO', rotulo: 'Retirar um consentimento que dei' },
  { valor: 'OUTRO', rotulo: 'Outro pedido sobre os meus dados pessoais' },
] as const

export const MENSAGEM_MINIMA = 10
export const MENSAGEM_MAXIMA = 4000
export const ASSUNTO_MINIMO = 3
export const ASSUNTO_MAXIMO = 150
export const NOME_MINIMO = 3
export const NOME_MAXIMO = 150
/** Como a API: antes de 1900 a data de nascimento é tida como engano de digitação. */
export const ANO_MINIMO_DE_NASCIMENTO = 1900

export interface ValoresDoPedido {
  tipo: TipoDePedido
  /** Só na solicitação do titular: um dos `valor` de `DIREITOS_DO_TITULAR`. */
  subtipo: string
  /** Só em contato e pedido de informação (a solicitação do titular e o voluntariado não têm assunto). */
  assunto: string
  mensagem: string
  nome_completo: string
  email_contato: string
  telefone_whatsapp: string
  /** Obrigatório na solicitação do titular; opcional (mas, se vier, tem de ser válido) no voluntariado. */
  cpf: string
  /** Só no voluntariado: "AAAA-MM-DD", como o campo de data entrega. */
  data_nascimento: string
  consentimento_lgpd: boolean
}

export type CampoDoFormulario = Exclude<keyof ValoresDoPedido, 'tipo'>
export type CampoComErro = CampoDoFormulario | 'contato'
export type ErrosDoPedido = Partial<Record<CampoComErro, string>>

/** Os campos na ordem em que aparecem na página: é a ordem em que o foco procura o primeiro erro. */
const CAMPOS_DO_FORMULARIO: CampoDoFormulario[] = [
  'nome_completo',
  'email_contato',
  'telefone_whatsapp',
  'data_nascimento',
  'cpf',
  'assunto',
  'subtipo',
  'mensagem',
  'consentimento_lgpd',
]

/** Letras como a API conta (pontos de código, não unidades UTF-16: um emoji vale 1). */
const tamanho = (texto: string) => [...texto].length
const normalizado = (texto: string) => texto.trim().replace(/\s+/g, ' ')

export const ehSolicitacaoDeTitular = (tipo: TipoDePedido) =>
  tipo === 'TITULAR_LGPD'
export const ehVoluntario = (tipo: TipoDePedido) => tipo === 'VOLUNTARIO'

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/**
 * A data de nascimento do voluntário (`valor` no formato AAAA-MM-DD do campo de data), com as mesmas regras e as mesmas palavras da API: obrigatória, uma data que
 * existe, nunca no futuro (o dia de hoje vale) e de 1900 em diante. `undefined` = está certa.
 */
export function erroDaDataDeNascimento(
  valor: string,
  hoje: Date,
): string | undefined {
  const texto = valor.trim()
  if (!texto) return 'Informe a sua data de nascimento.'
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (!partes) return 'Confira a data de nascimento.'
  const [ano, mes, dia] = [
    Number(partes[1]),
    Number(partes[2]),
    Number(partes[3]),
  ] as [number, number, number]
  const data = new Date(Date.UTC(ano, mes - 1, dia))
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  )
    return 'Confira a data de nascimento.'
  // AAAA-MM-DD compara como texto; "hoje" é o dia de quem preenche
  const dataDeHoje = `${String(hoje.getFullYear()).padStart(4, '0')}-${doisDigitos(hoje.getMonth() + 1)}-${doisDigitos(hoje.getDate())}`
  if (texto > dataDeHoje) return 'A data de nascimento não pode ser no futuro.'
  if (ano < ANO_MINIMO_DE_NASCIMENTO) return 'Confira a data de nascimento.'
  return undefined
}

export function validarPedido(
  v: ValoresDoPedido,
  hoje: Date = new Date(),
): ErrosDoPedido {
  const erros: ErrosDoPedido = {}
  const nome = tamanho(normalizado(v.nome_completo))
  if (nome < NOME_MINIMO) erros.nome_completo = 'Informe o seu nome completo.'
  else if (nome > NOME_MAXIMO)
    erros.nome_completo = `O nome está comprido demais (até ${NOME_MAXIMO} letras).`

  const email = v.email_contato.trim()
  const telefone = v.telefone_whatsapp.trim()
  if (email && !EMAIL.test(email))
    erros.email_contato = 'Esse e-mail não parece certo.'
  if (telefone && !telefoneValido(telefone))
    erros.telefone_whatsapp = 'Use o DDD e o número, com 10 ou 11 dígitos.'
  if (!email && !telefone)
    erros.contato =
      'Informe um e-mail ou um telefone para a associação conseguir responder.'

  if (ehSolicitacaoDeTitular(v.tipo)) {
    if (!v.cpf.trim()) erros.cpf = 'Informe o seu CPF.'
    else if (!cpfValido(v.cpf))
      erros.cpf = 'Esse CPF não confere: veja se os números estão certos.'
    if (!DIREITOS_DO_TITULAR.some((d) => d.valor === v.subtipo))
      erros.subtipo = 'Escolha o que você quer pedir sobre os seus dados.'
  } else if (ehVoluntario(v.tipo)) {
    // sem assunto (é sempre "Quero ser voluntário"); o CPF é opcional, mas o que for digitado tem de conferir
    const nascimento = erroDaDataDeNascimento(v.data_nascimento, hoje)
    if (nascimento) erros.data_nascimento = nascimento
    if (v.cpf.trim() && !cpfValido(v.cpf))
      erros.cpf = 'Esse CPF não confere: veja se os números estão certos.'
  } else {
    const assunto = tamanho(normalizado(v.assunto))
    if (assunto < ASSUNTO_MINIMO)
      erros.assunto = `Informe o assunto (pelo menos ${ASSUNTO_MINIMO} letras).`
    else if (assunto > ASSUNTO_MAXIMO)
      erros.assunto = `O assunto está comprido demais (até ${ASSUNTO_MAXIMO} letras).`
  }

  const mensagem = tamanho(v.mensagem.trim())
  if (mensagem < MENSAGEM_MINIMA)
    erros.mensagem = `Escreva a sua mensagem (pelo menos ${MENSAGEM_MINIMA} letras).`
  else if (mensagem > MENSAGEM_MAXIMA)
    erros.mensagem = 'A mensagem está comprida demais (até 4.000 letras).'

  if (!v.consentimento_lgpd)
    erros.consentimento_lgpd =
      'Para enviar, é preciso ler e aceitar o aviso de privacidade.'
  return erros
}

/**
 * O corpo que a API espera (`AtendimentoPublicoCriar`): CPF e telefone só com dígitos; o que não existe no tipo (CPF e direito só na solicitação do titular, e o
 * CPF também no voluntariado, quando preenchido; a data de nascimento só no voluntariado; assunto só em contato e pedido de informação) e o que ficou em branco
 * não vai.
 */
export function montarCorpo(
  v: ValoresDoPedido,
  armadilha = '',
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    tipo: v.tipo,
    mensagem: v.mensagem.trim(),
    nome_completo: normalizado(v.nome_completo),
    consentimento_lgpd: v.consentimento_lgpd,
    versao_texto_consentimento: VERSAO_DO_AVISO_DE_PRIVACIDADE_DO_ATENDIMENTO,
    pagina_web: armadilha,
  }
  if (ehSolicitacaoDeTitular(v.tipo)) {
    corpo.subtipo = v.subtipo
    corpo.cpf = somenteDigitos(v.cpf)
  } else if (ehVoluntario(v.tipo)) {
    corpo.data_nascimento = v.data_nascimento.trim()
    const cpf = somenteDigitos(v.cpf)
    if (cpf) corpo.cpf = cpf
  } else {
    corpo.assunto = normalizado(v.assunto)
  }
  if (v.email_contato.trim()) corpo.email_contato = v.email_contato.trim()
  if (v.telefone_whatsapp.trim())
    corpo.telefone_whatsapp = somenteDigitos(v.telefone_whatsapp)
  return corpo
}

export function mensagemDeFalhaDoEnvio(erro: unknown): string {
  if (erro instanceof ApiError && erro.detalhe) return erro.detalhe
  if (erro instanceof ApiError && erro.status === 429)
    return 'Muitos pedidos vieram deste endereço. Aguarde um pouco e tente de novo, ou fale com a associação.'
  return 'Não foi possível enviar o pedido agora. Tente de novo em alguns instantes; se continuar, fale com a associação.'
}

/** Formato da resposta do envio. `protocolo` nulo = a armadilha de robô disparou: a página mostra a mesma tela de sucesso, só que sem o número. */
export interface RespostaDoPedido {
  mensagem?: string
  protocolo: string | null
  prazo_dias: number | null
  prazo_em: string | null
}

/**
 * "Respondemos em até 10 dias (até 19 de outubro de 2026)." — `dias` vem da API; sem um número válido, não há texto (nunca um prazo inventado). A data é o
 * `prazo_em` que a API calculou, mostrado no horário de Parauapebas; se ela faltar ou for ilegível, o texto fica só com os dias.
 */
export function textoDoPrazo(dias: unknown, prazoEm?: unknown): string | null {
  if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 1)
    return null
  const quantos = dias === 1 ? '1 dia' : `${dias} dias`
  let ate = ''
  if (typeof prazoEm === 'string' && prazoEm) {
    try {
      ate = ` (até ${formatarDiaDeInstanteUtc(prazoEm)})`
    } catch {
      ate = ''
    }
  }
  return `Respondemos em até ${quantos}${ate}.`
}

/** Os prazos (em dias) de cada tipo, como a diretoria os definiu. Falhou? `{}`: a página só fica sem o texto do prazo. */
export async function buscarPrazos(opcoes: {
  baseUrl: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
}): Promise<Partial<Record<TipoDePedido, number>>> {
  try {
    const dados = await buscarJson<Record<string, unknown>>(
      '/api/publico/atendimentos/prazos',
      { ...opcoes, tentativas: 2 },
    )
    const prazos: Partial<Record<TipoDePedido, number>> = {}
    for (const tipo of TIPOS_DE_PEDIDO) {
      const dias = dados[tipo]
      if (typeof dias === 'number' && Number.isInteger(dias) && dias >= 1)
        prazos[tipo] = dias
    }
    return prazos
  } catch {
    return {}
  }
}

export interface OpcoesDoFormulario {
  /** O envio do pedido. */
  fetchImpl?: typeof fetch
  /** A consulta dos prazos (nos testes, separada do envio para não misturar as chamadas). */
  fetchDosPrazos?: typeof fetch
  timeoutMs?: number
  /** O "hoje" de quem preenche (nos testes, fixo): a data de nascimento não pode ser depois dele. */
  hoje?: () => Date
}

type Campo = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function campoOuNada(form: HTMLFormElement, nome: string): Campo | null {
  const campo = form.elements.namedItem(nome)
  return campo instanceof HTMLInputElement ||
    campo instanceof HTMLTextAreaElement ||
    campo instanceof HTMLSelectElement
    ? campo
    : null
}

function campoObrigatorio(form: HTMLFormElement, nome: string): Campo {
  const campo = campoOuNada(form, nome)
  if (!campo) throw new Error(`Campo ausente no formulário: ${nome}`)
  return campo
}

function tipoDoFormulario(form: HTMLFormElement): TipoDePedido {
  const tipo = form.dataset.tipo
  const conhecido = TIPOS_DE_PEDIDO.find((t) => t === tipo)
  if (!conhecido) throw new Error(`Tipo de pedido desconhecido: ${tipo}`)
  return conhecido
}

function lerValores(form: HTMLFormElement): ValoresDoPedido {
  const texto = (nome: string) => campoOuNada(form, nome)?.value ?? ''
  const aceite = campoObrigatorio(form, 'consentimento_lgpd')
  return {
    tipo: tipoDoFormulario(form),
    subtipo: texto('subtipo'),
    assunto: texto('assunto'),
    mensagem: texto('mensagem'),
    nome_completo: texto('nome_completo'),
    email_contato: texto('email_contato'),
    telefone_whatsapp: texto('telefone_whatsapp'),
    cpf: texto('cpf'),
    data_nascimento: texto('data_nascimento'),
    consentimento_lgpd: aceite instanceof HTMLInputElement && aceite.checked,
  }
}

const textoDoResumo = (total: number) =>
  total === 1
    ? 'Há 1 campo para corrigir.'
    : `Há ${total} campos para corrigir.`

function mostrarErros(form: HTMLFormElement, erros: ErrosDoPedido): void {
  for (const mensagem of form.querySelectorAll<HTMLElement>('[data-erro]')) {
    const chave = mensagem.dataset.erro as CampoComErro
    const texto = erros[chave]
    mensagem.textContent = texto ?? ''
    mensagem.hidden = !texto
  }
  for (const nome of CAMPOS_DO_FORMULARIO) {
    const campo = campoOuNada(form, nome)
    if (!campo) continue
    const comErro =
      Boolean(erros[nome]) ||
      ((nome === 'email_contato' || nome === 'telefone_whatsapp') &&
        Boolean(erros.contato))
    if (comErro) campo.setAttribute('aria-invalid', 'true')
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
function limparErroDoCampo(form: HTMLFormElement, campo: Campo): void {
  const chaves = [campo.name]
  if (campo.name === 'email_contato' || campo.name === 'telefone_whatsapp')
    chaves.push('contato')
  for (const chave of chaves) {
    const mensagem = form.querySelector<HTMLElement>(`[data-erro="${chave}"]`)
    if (mensagem) {
      mensagem.textContent = ''
      mensagem.hidden = true
    }
  }
  campo.removeAttribute('aria-invalid')
  const resumo = form.querySelector<HTMLElement>('[data-resumo-de-erros]')
  if (resumo && !resumo.hidden) {
    const restantes = form.querySelectorAll('[data-erro]:not([hidden])').length
    resumo.textContent = restantes === 0 ? '' : textoDoResumo(restantes)
    resumo.hidden = restantes === 0
  }
}

function primeiroCampoComErro(
  form: HTMLFormElement,
  erros: ErrosDoPedido,
): Campo | null {
  for (const nome of CAMPOS_DO_FORMULARIO) {
    if (erros[nome]) return campoOuNada(form, nome)
  }
  return erros.contato ? campoOuNada(form, 'email_contato') : null
}

/** "12 de 4.000 letras", acompanhando o que se digita. */
function atualizarContador(form: HTMLFormElement): void {
  const contador = form.querySelector<HTMLElement>('[data-contador]')
  const mensagem = campoOuNada(form, 'mensagem')
  if (!contador || !mensagem) return
  const letras = tamanho(mensagem.value.trim())
  contador.textContent = `${letras.toLocaleString('pt-BR')} de ${MENSAGEM_MAXIMA.toLocaleString('pt-BR')} letras`
}

function mostrarConfirmacao(
  confirmacao: HTMLElement,
  resposta: Partial<RespostaDoPedido> | null | undefined,
): void {
  const protocolo =
    typeof resposta?.protocolo === 'string' ? resposta.protocolo : ''
  const blocoDoProtocolo = confirmacao.querySelector<HTMLElement>(
    '[data-bloco-do-protocolo]',
  )
  const numero = confirmacao.querySelector<HTMLElement>('[data-protocolo]')
  if (blocoDoProtocolo && numero) {
    numero.textContent = protocolo
    blocoDoProtocolo.hidden = !protocolo
  }
  const prazo = confirmacao.querySelector<HTMLElement>(
    '[data-prazo-da-resposta]',
  )
  if (prazo) {
    const texto = protocolo
      ? textoDoPrazo(resposta?.prazo_dias, resposta?.prazo_em)
      : null
    prazo.textContent = texto ?? ''
    prazo.hidden = !texto
  }
  confirmacao.hidden = false
  confirmacao.focus()
}

export function iniciarFormularioDeAtendimento(
  form: HTMLFormElement,
  opcoes: OpcoesDoFormulario = {},
): void {
  const tipo = tipoDoFormulario(form)
  const baseUrl = form.dataset.apiUrl ?? ''
  const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')
  const rotuloDoBotao = botao?.textContent?.trim() || 'Enviar pedido'
  const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')
  const confirmacao = document.querySelector<HTMLElement>(
    form.dataset.confirmacao ?? '[data-confirmacao]',
  )

  form.addEventListener('input', (evento) => {
    const alvo = evento.target
    if (
      (alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        alvo instanceof HTMLSelectElement) &&
      alvo.name
    ) {
      limparErroDoCampo(form, alvo)
      if (alvo.name === 'mensagem') atualizarContador(form)
    }
  })
  atualizarContador(form)

  // "Respondemos em até N dias": o número vem da API; sem ele, o texto simplesmente não aparece
  const avisoDoPrazo = form.querySelector<HTMLElement>('[data-prazo]')
  if (avisoDoPrazo) {
    void buscarPrazos({
      baseUrl,
      fetchImpl: opcoes.fetchDosPrazos ?? opcoes.fetchImpl,
    }).then((prazos) => {
      const texto = textoDoPrazo(prazos[tipo])
      if (!texto) return
      avisoDoPrazo.textContent = texto
      avisoDoPrazo.hidden = false
    })
  }

  form.addEventListener('submit', (evento) => {
    evento.preventDefault()
    // um segundo envio enquanto o primeiro está a caminho criaria um pedido duplicado
    if (form.getAttribute('aria-busy') === 'true') return
    if (falha) falha.hidden = true
    const valores = lerValores(form)
    const erros = validarPedido(valores, (opcoes.hoje ?? (() => new Date()))())
    mostrarErros(form, erros)
    if (Object.keys(erros).length > 0) {
      primeiroCampoComErro(form, erros)?.focus()
      return
    }

    if (botao) {
      botao.disabled = true
      botao.textContent = 'Enviando…'
    }
    form.setAttribute('aria-busy', 'true')
    const armadilha = campoOuNada(form, 'pagina_web')?.value ?? ''
    void enviarJson<RespostaDoPedido>(
      '/api/publico/atendimentos',
      montarCorpo(valores, armadilha),
      { baseUrl, fetchImpl: opcoes.fetchImpl, timeoutMs: opcoes.timeoutMs },
    )
      .then((resposta) => {
        form.hidden = true
        if (confirmacao) mostrarConfirmacao(confirmacao, resposta)
      })
      .catch((erro: unknown) => {
        if (falha) {
          falha.textContent = mensagemDeFalhaDoEnvio(erro)
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
