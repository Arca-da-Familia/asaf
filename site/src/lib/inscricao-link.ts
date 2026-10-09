import { ApiError, buscarJson, enviarJson } from './api'
import { formatarDia, formatarHora, formatarInstanteUtc } from './datas'

/**
 * As páginas `/cancelar-inscricao/` e `/confirmar-inscricao/` (v5.5c): os e-mails do sistema levam a elas com `?token=<código>`. O código é o segredo de quem se
 * inscreveu (só ele vê e muda aquela inscrição); a página o lê NO NAVEGADOR (as páginas são estáticas), consulta `GET /api/publico/inscricoes/{token}` e, só quando a
 * pessoa clica, chama `POST .../cancelar` ou `POST .../confirmar`. O que se pode fazer vem da API (`pode_cancelar`, `pode_confirmar`): nada é decidido aqui.
 *
 * SEGURANÇA: só `textContent` e atributos — nada vindo da API entra como HTML. O código nunca vai para o caminho da página, só para a query.
 */

export type ModoDoLink = 'cancelar' | 'confirmar'

/** O código é gerado pelo sistema (letras, números, "-" e "_"); qualquer outra coisa no endereço nem chega à API. */
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{8,128}$/

export type LeituraDoToken =
  | { estado: 'ausente' }
  | { estado: 'invalido' }
  | { estado: 'ok'; token: string }

/** O `?token=` do endereço da página: sem ele, "ausente"; com ele torto, "invalido"; senão, o código. */
export function lerToken(busca: string): LeituraDoToken {
  const bruto = new URLSearchParams(busca).get('token')
  if (bruto === null || bruto.trim() === '') return { estado: 'ausente' }
  const token = bruto.trim()
  return TOKEN_VALIDO.test(token)
    ? { estado: 'ok', token }
    : { estado: 'invalido' }
}

export const caminhoDeCancelar = (token: string) =>
  `/cancelar-inscricao/?token=${encodeURIComponent(token)}`
export const caminhoDeConfirmar = (token: string) =>
  `/confirmar-inscricao/?token=${encodeURIComponent(token)}`

/** O que a API devolve em `GET /api/publico/inscricoes/{token}` (app/services/inscricao.py::resumo_publico_por_token). */
export interface ResumoDaInscricao {
  status: string
  primeiro_nome: string | null
  evento: {
    titulo: string | null
    /** ISO sem fuso (horário local de Parauapebas). */
    data_hora_inicio: string | null
    data_hora_fim: string | null
    endereco_avulso: string | null
  }
  sessao: { titulo: string; data_hora_inicio: string | null } | null
  codigo_checkin: string | null
  /** UTC SEM fuso na ponta ("2026-10-10T14:30:00"). */
  prazo_confirmacao: string | null
  evento_encerrado: boolean
  pode_cancelar: boolean
  pode_confirmar: boolean
}

const textoOuNada = (valor: unknown): string | null =>
  typeof valor === 'string' && valor.trim() ? valor : null

/** A resposta da API como a página usa. Sem a situação (resposta torta), não é um resumo: `null`. */
export function lerResumo(dados: unknown): ResumoDaInscricao | null {
  if (!dados || typeof dados !== 'object') return null
  const r = dados as Record<string, unknown>
  const status = textoOuNada(r.status)
  if (!status) return null
  const evento = (
    r.evento && typeof r.evento === 'object' ? r.evento : {}
  ) as Record<string, unknown>
  const sessao =
    r.sessao && typeof r.sessao === 'object'
      ? (r.sessao as Record<string, unknown>)
      : null
  return {
    status,
    primeiro_nome: textoOuNada(r.primeiro_nome),
    evento: {
      titulo: textoOuNada(evento.titulo),
      data_hora_inicio: textoOuNada(evento.data_hora_inicio),
      data_hora_fim: textoOuNada(evento.data_hora_fim),
      endereco_avulso: textoOuNada(evento.endereco_avulso),
    },
    sessao:
      sessao && textoOuNada(sessao.titulo)
        ? {
            titulo: String(sessao.titulo),
            data_hora_inicio: textoOuNada(sessao.data_hora_inicio),
          }
        : null,
    codigo_checkin: textoOuNada(r.codigo_checkin),
    prazo_confirmacao: textoOuNada(r.prazo_confirmacao),
    evento_encerrado: r.evento_encerrado === true,
    pode_cancelar: r.pode_cancelar === true,
    pode_confirmar: r.pode_confirmar === true,
  }
}

const LISTA_DE_ESPERA = 'Lista de Espera'

/** A situação em palavras simples. */
export function situacaoDoLink(status: string): string {
  switch (status) {
    case 'Pré-inscrito':
      return 'Vaga reservada'
    case 'Confirmado':
      return 'Vaga confirmada'
    case LISTA_DE_ESPERA:
      return 'Na lista de espera'
    case 'Cancelado':
      return 'Inscrição cancelada'
    case 'Presente':
      return 'Presença registrada'
    case 'Ausente':
      return 'Ausência registrada'
    default:
      return status
  }
}

/** "sábado, 10 de outubro de 2026, às 19:00" — a data do evento é horário local de Parauapebas, sem fuso. */
export function quandoDoEvento(inicio: string | null): string | null {
  if (!inicio) return null
  return `${formatarDia(inicio)}, às ${formatarHora(inicio)}`
}

/** O prazo para confirmar: a API manda em UTC sem fuso; a pessoa lê no horário de Belém ("10/10/2026 11:30"). */
export function prazoEmPalavras(prazo: string | null): string | null {
  if (!prazo) return null
  try {
    return `${formatarInstanteUtc(prazo)} (horário de Belém)`
  } catch {
    return null
  }
}

/** "R$ 50,00": o valor a devolver chega como número ou como texto. */
export function valorEmReais(valor: unknown): string | null {
  const numero = typeof valor === 'string' ? Number(valor) : valor
  if (typeof numero !== 'number' || !Number.isFinite(numero)) return null
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(numero)
}

/** A frase que explica a situação quando ela muda o que se pode fazer (vazia = nada a explicar: o botão fala por si). */
export function explicacaoDaSituacao(
  r: ResumoDaInscricao,
  modo: ModoDoLink,
): string | null {
  if (r.status === 'Cancelado')
    return modo === 'cancelar'
      ? 'Esta inscrição já foi cancelada.'
      : 'Esta inscrição foi cancelada: não há o que confirmar.'
  if (r.evento_encerrado)
    return modo === 'cancelar'
      ? 'Este evento já aconteceu: não é mais possível cancelar a inscrição.'
      : 'Este evento já aconteceu: não é mais possível confirmar a vaga.'
  if (modo === 'confirmar') {
    if (r.status === LISTA_DE_ESPERA)
      return 'Você ainda está na lista de espera; avisamos por e-mail quando uma vaga abrir.'
    if (r.status === 'Confirmado') return 'A sua vaga está confirmada.'
    if (!r.pode_confirmar)
      return 'Não é possível confirmar esta inscrição por aqui. Fale com a secretaria.'
  } else if (!r.pode_cancelar) {
    return 'Não é possível cancelar esta inscrição por aqui. Fale com a secretaria.'
  }
  return null
}

/** O que a página oferece: o botão da própria página e, quando faz sentido, o caminho para a outra. */
export function acoesDisponiveis(
  r: ResumoDaInscricao,
  modo: ModoDoLink,
): { principal: boolean; cruzada: ModoDoLink | null } {
  if (modo === 'cancelar')
    return {
      principal: r.pode_cancelar,
      // quem foi promovido da lista de espera (tem prazo) pode preferir ficar com a vaga
      cruzada: r.pode_confirmar && r.prazo_confirmacao ? 'confirmar' : null,
    }
  return {
    principal: r.pode_confirmar,
    cruzada: r.pode_cancelar ? 'cancelar' : null,
  }
}

/** A pergunta da etapa de confirmação do cancelamento: quem está na fila não "perde a vaga", sai da lista. */
export const perguntaDoCancelamento = (r: ResumoDaInscricao) =>
  r.status === LISTA_DE_ESPERA
    ? 'Tem certeza? Você sai da lista de espera.'
    : 'Tem certeza? Você perde a vaga.'

/** O texto do link para a outra página. */
export function rotuloDaAcaoCruzada(
  cruzada: ModoDoLink,
  r: ResumoDaInscricao,
): string {
  if (cruzada === 'confirmar') return 'Quero ficar com a vaga: confirmar'
  return r.status === LISTA_DE_ESPERA
    ? 'Cancelar a minha inscrição'
    : 'Não vou poder ir: cancelar a minha inscrição'
}

export type FalhaDaPagina = 'invalido' | 'limite' | 'rede'

/** O que deu errado ao consultar a inscrição: código que não existe (404), limite de consultas (429) ou o resto (rede, API acordando, erro de servidor). */
export function falhaDaConsulta(erro: unknown): FalhaDaPagina {
  if (erro instanceof ApiError && erro.status === 404) return 'invalido'
  if (erro instanceof ApiError && erro.status === 429) return 'limite'
  return 'rede'
}

export const MENSAGEM_DE_LINK_INVALIDO =
  'Esse link não é válido: confira o endereço que veio no e-mail.'
export const MENSAGEM_SEM_TOKEN =
  'Esta página precisa do link que foi enviado para o seu e-mail. Abra o link da mensagem da sua inscrição.'

export function mensagemDaConsulta(falha: FalhaDaPagina): string {
  if (falha === 'invalido') return MENSAGEM_DE_LINK_INVALIDO
  if (falha === 'limite')
    return 'Muitas consultas vieram deste endereço. Aguarde alguns minutos e tente de novo.'
  return 'Não foi possível buscar a sua inscrição agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.'
}

/** A frase de falha de cancelar/confirmar: o motivo da API (em português) quando há; senão a orientação de sempre. */
export function mensagemDeFalhaDaAcao(erro: unknown, modo: ModoDoLink): string {
  const verbo = modo === 'cancelar' ? 'cancelar' : 'confirmar'
  if (erro instanceof ApiError) {
    if (erro.status === 404) return MENSAGEM_DE_LINK_INVALIDO
    if (erro.status === 429)
      return (
        erro.detalhe ??
        'Muitos pedidos vieram deste endereço. Aguarde alguns minutos e tente de novo.'
      )
    if (erro.status !== undefined && erro.status < 500 && erro.detalhe)
      return erro.detalhe
  }
  return `Não foi possível ${verbo} agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.`
}

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */
/* O NAVEGADOR                                                                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------------------------------------ */

export interface OpcoesDaPaginaDeInscricao {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
  /** O `?...` do endereço (nos testes, fixo). */
  busca?: string
}

type Estado = 'carregando' | 'sem-token' | 'invalido' | 'erro' | 'resumo'

function mostrarEstado(raiz: HTMLElement, estado: Estado) {
  for (const bloco of raiz.querySelectorAll<HTMLElement>('[data-estado]'))
    bloco.hidden = bloco.dataset.estado !== estado
}

const campo = (raiz: HTMLElement, seletor: string) =>
  raiz.querySelector<HTMLElement>(seletor)

function texto(raiz: HTMLElement, seletor: string, valor: string | null) {
  const el = campo(raiz, seletor)
  if (!el) return
  el.textContent = valor ?? ''
  const linha = el.closest<HTMLElement>('[data-linha]') ?? el
  linha.hidden = !valor
}

/** Dá vida à página de cancelar ou de confirmar (`[data-inscricao-link]`). */
export function iniciarPaginaDeInscricao(
  raiz: HTMLElement,
  opcoes: OpcoesDaPaginaDeInscricao = {},
): void {
  const modo: ModoDoLink =
    raiz.dataset.modo === 'confirmar' ? 'confirmar' : 'cancelar'
  const baseUrl = raiz.dataset.apiUrl ?? ''
  const leitura = lerToken(opcoes.busca ?? window.location.search)
  if (leitura.estado === 'ausente') return mostrarEstado(raiz, 'sem-token')
  if (leitura.estado === 'invalido') return mostrarEstado(raiz, 'invalido')
  const { token } = leitura
  const caminhoDaInscricao = `/api/publico/inscricoes/${encodeURIComponent(token)}`

  const falhaDaAcao = campo(raiz, '[data-falha-da-acao]')
  const resultado = campo(raiz, '[data-resultado-da-acao]')
  const acoes = campo(raiz, '[data-acoes]')
  const botaoPrincipal = campo(
    raiz,
    modo === 'cancelar' ? '[data-cancelar]' : '[data-confirmar]',
  ) as HTMLButtonElement | null
  const passo = campo(raiz, '[data-passo-de-confirmacao]')
  const botaoDoPasso = campo(
    raiz,
    '[data-confirmar-cancelamento]',
  ) as HTMLButtonElement | null
  const botaoVoltar = campo(raiz, '[data-voltar]')

  function mostrarResumo(r: ResumoDaInscricao) {
    texto(raiz, '[data-evento-titulo]', r.evento.titulo)
    texto(raiz, '[data-quando]', quandoDoEvento(r.evento.data_hora_inicio))
    texto(raiz, '[data-onde]', r.evento.endereco_avulso)
    texto(
      raiz,
      '[data-sessao]',
      r.sessao
        ? [r.sessao.titulo, quandoDoEvento(r.sessao.data_hora_inicio)]
            .filter(Boolean)
            .join(', ')
        : null,
    )
    texto(raiz, '[data-inscrito]', r.primeiro_nome)
    texto(raiz, '[data-situacao]', situacaoDoLink(r.status))
    texto(raiz, '[data-codigo]', r.codigo_checkin)
    texto(raiz, '[data-prazo]', prazoEmPalavras(r.prazo_confirmacao))
    const explicacao = explicacaoDaSituacao(r, modo)
    texto(raiz, '[data-explicacao]', explicacao)

    const { principal, cruzada } = acoesDisponiveis(r, modo)
    if (botaoPrincipal) botaoPrincipal.hidden = !principal
    if (passo) passo.hidden = true
    const link = campo(raiz, '[data-acao-cruzada]') as HTMLAnchorElement | null
    if (link) {
      link.hidden = !cruzada
      if (cruzada) {
        link.href =
          cruzada === 'confirmar'
            ? caminhoDeConfirmar(token)
            : caminhoDeCancelar(token)
        link.textContent = rotuloDaAcaoCruzada(cruzada, r)
      }
    }
    if (acoes) acoes.hidden = !principal && !cruzada
    const pergunta = campo(raiz, '[data-pergunta-do-cancelamento]')
    if (pergunta) pergunta.textContent = perguntaDoCancelamento(r)
    mostrarEstado(raiz, 'resumo')
  }

  async function consultar(): Promise<void> {
    mostrarEstado(raiz, 'carregando')
    try {
      const dados = await buscarJson<unknown>(caminhoDaInscricao, {
        baseUrl,
        fetchImpl: opcoes.fetchImpl,
        timeoutMs: opcoes.timeoutMs ?? 35_000,
        tentativas: 2,
        esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
      })
      const lido = lerResumo(dados)
      if (!lido) throw new ApiError('Resposta da API sem a situação.')
      mostrarResumo(lido)
    } catch (erro) {
      const falha = falhaDaConsulta(erro)
      if (falha === 'invalido') return mostrarEstado(raiz, 'invalido')
      const mensagem = campo(raiz, '[data-estado="erro"] [data-mensagem]')
      if (mensagem) mensagem.textContent = mensagemDaConsulta(falha)
      mostrarEstado(raiz, 'erro')
    }
  }
  campo(raiz, '[data-tentar-de-novo]')?.addEventListener(
    'click',
    () => void consultar(),
  )

  function mostrarFalhaDaAcao(erro: unknown) {
    if (!falhaDaAcao) return
    falhaDaAcao.textContent = mensagemDeFalhaDaAcao(erro, modo)
    falhaDaAcao.hidden = false
    falhaDaAcao.focus()
  }

  function concluir(frases: string[]) {
    if (!resultado) return
    const lista = resultado.querySelector<HTMLElement>('[data-frases]')
    if (lista) {
      lista.replaceChildren(
        ...frases.map((frase) => {
          const p = document.createElement('p')
          p.className = 'mt-2'
          p.textContent = frase
          return p
        }),
      )
    }
    if (acoes) acoes.hidden = true
    texto(raiz, '[data-explicacao]', null)
    if (falhaDaAcao) falhaDaAcao.hidden = true
    resultado.hidden = false
    resultado.focus()
  }

  async function executar(acao: 'cancelar' | 'confirmar'): Promise<void> {
    if (raiz.getAttribute('aria-busy') === 'true') return
    if (falhaDaAcao) falhaDaAcao.hidden = true
    raiz.setAttribute('aria-busy', 'true')
    const botao = acao === 'cancelar' ? botaoDoPasso : botaoPrincipal
    const rotulo = botao?.textContent ?? ''
    if (botao) {
      botao.disabled = true
      botao.textContent = acao === 'cancelar' ? 'Cancelando…' : 'Confirmando…'
    }
    try {
      const resposta = await enviarJson<Record<string, unknown>>(
        `${caminhoDaInscricao}/${acao}`,
        {},
        { baseUrl, fetchImpl: opcoes.fetchImpl, timeoutMs: opcoes.timeoutMs },
      )
      if (acao === 'cancelar') {
        const frases = ['A sua inscrição foi cancelada.']
        const reembolso =
          resposta.reembolso && typeof resposta.reembolso === 'object'
            ? (resposta.reembolso as Record<string, unknown>)
            : null
        const valor = reembolso ? valorEmReais(reembolso.valor) : null
        if (valor)
          frases.push(
            `Foi registrado um valor a devolver de ${valor}; a secretaria cuida do pagamento.`,
          )
        texto(raiz, '[data-situacao]', situacaoDoLink('Cancelado'))
        texto(raiz, '[data-codigo]', null)
        texto(raiz, '[data-prazo]', null)
        concluir(frases)
      } else {
        texto(raiz, '[data-situacao]', situacaoDoLink('Confirmado'))
        texto(raiz, '[data-prazo]', null)
        concluir(['A sua vaga está confirmada.'])
      }
    } catch (erro) {
      mostrarFalhaDaAcao(erro)
    } finally {
      raiz.removeAttribute('aria-busy')
      if (botao) {
        botao.disabled = false
        botao.textContent = rotulo
      }
    }
  }

  if (modo === 'cancelar') {
    // uma etapa de confirmação antes de cancelar de verdade
    botaoPrincipal?.addEventListener('click', () => {
      if (passo) passo.hidden = false
      botaoPrincipal.hidden = true
      botaoDoPasso?.focus()
    })
    botaoVoltar?.addEventListener('click', () => {
      if (passo) passo.hidden = true
      if (botaoPrincipal) {
        botaoPrincipal.hidden = false
        botaoPrincipal.focus()
      }
    })
    botaoDoPasso?.addEventListener('click', () => void executar('cancelar'))
  } else {
    botaoPrincipal?.addEventListener('click', () => void executar('confirmar'))
  }

  void consultar()
}
