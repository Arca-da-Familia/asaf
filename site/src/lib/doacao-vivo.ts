import { ApiError, buscarJson, enviarJson } from './api'
import {
  CAMPOS_DA_DOACAO,
  campanhasEmAndamento,
  falhaDoCodigo,
  falhaDoEnvio,
  formatarCpf,
  formatarReais,
  fraseDeValidade,
  frasePercentual,
  frasePrazo,
  idDaCampanha,
  lerDadosDoPix,
  lerDoacaoPublica,
  lerRespostaDoPedido,
  lerValorDigitado,
  montarCorpoDaDoacao,
  validarDoacao,
  valorDaBarra,
  valorParaConsulta,
  FRASES,
  type CampanhaPublica,
  type CampoDaDoacao,
  type DoacaoPublica,
  type ErrosDaDoacao,
  type RespostaDoPedido,
  type ValoresDaDoacao,
} from './doacao'
import {
  criar,
  criarPainelDoPix,
  ligarBotaoDeCopiar,
  type OpcoesDaCopia,
} from './doacao-pix-dom'

/**
 * Ilha da PÁGINA DE DOAÇÃO (v5.6a). A página é gerada no build, mas o que muda sem novo publicar é resolvido aqui, no navegador, a cada visita: se a doação pelo site está aberta
 * (a Presidência marca a chave Pix como "vai para o site" no painel), as campanhas em andamento e o quanto cada uma já recebeu (só o que a tesouraria já registrou).
 *
 * Estados (`[data-estado]`, só um visível): carregando -> pronto (campanhas, doar sem se identificar e doar identificando-se), indisponível (o Pix ainda não foi aberto para o site, ou
 * a API é a antiga e a rota não existe: o aviso gentil e o contato, NENHUM formulário) ou erro (a API não respondeu: "tentar de novo"). Sem JavaScript fica o texto da própria página.
 *
 * Doar SEM se identificar: só o código Pix (`GET /api/publico/doacao/pix`); o site não pede nenhum dado e não guarda nada.
 * Doar identificando-se: `POST /api/publico/doacoes/intencoes` — protocolo e código; a doação só passa a constar quando a tesouraria confirmar o Pix no extrato do banco.
 *
 * SEGURANÇA: só `textContent` e atributos — título e descrição de campanha, nome do beneficiário e qualquer texto da API entram como TEXTO, nunca como HTML. Nada de dado pessoal na
 * URL (o pedido vai no corpo do POST) e nada em `localStorage`.
 */

export interface OpcoesDaDoacao extends OpcoesDaCopia {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  esperaEntreTentativasMs?: number
  /** O "agora" de quem vê (nos testes, fixo): a campanha cujo prazo já passou nunca é oferecida. */
  agora?: () => Date
}

type Estado = 'carregando' | 'erro' | 'indisponivel' | 'pronto'

/** O que as caixas e os formulários precisam saber do que a API disse por último. */
interface Contexto {
  doacao: DoacaoPublica | null
  campanhas: CampanhaPublica[]
}

const CLASSE_DA_BARRA = 'mt-3 h-3 w-full accent-primary'

function mostrarEstado(raiz: HTMLElement, estado: Estado): void {
  for (const caixa of raiz.querySelectorAll<HTMLElement>(
    ':scope > [data-estado]',
  ))
    caixa.hidden = caixa.dataset.estado !== estado
  raiz.setAttribute('aria-busy', estado === 'carregando' ? 'true' : 'false')
}

// ------------------------------------------------------------------------------------------------ as campanhas

/** v5.7g: o que já foi gasto no centro de custo da campanha; campanha sem centro de custo diz que o gasto não é acompanhado à parte; sem o dado (API antiga), nada. */
export function fraseDoAplicado(c: CampanhaPublica): string | null {
  if (c.valor_aplicado === undefined) return null
  if (c.valor_aplicado === null) return 'não acompanhado à parte'
  return formatarReais(c.valor_aplicado)
}

function itemDaCampanha(c: CampanhaPublica): HTMLLIElement {
  const item = criar(
    'li',
    'flex flex-col rounded-lg border bg-card p-5 shadow-card',
  )
  item.setAttribute('data-campanha', String(c.id_campanha))
  const idDoTitulo = `campanha-${c.id_campanha}-titulo`
  const titulo = criar('h4', 'text-lg font-semibold', c.titulo)
  titulo.id = idDoTitulo
  item.append(titulo)
  if (c.descricao) item.append(criar('p', 'mt-2 text-sm', c.descricao))

  const dados = criar('dl', 'mt-3 grid gap-2 text-sm')
  for (const [nome, valor, marca] of [
    ['Meta', c.meta_valor > 0 ? formatarReais(c.meta_valor) : '—', 'meta'],
    ['Já recebido', formatarReais(c.valor_arrecadado), 'recebido'],
    ['Já aplicado', fraseDoAplicado(c), 'aplicado'],
    ['Prazo', frasePrazo(c.prazo), 'prazo'],
  ] as const) {
    // a API antiga não manda o aplicado: a página não fala dele
    if (valor === null) continue
    const linha = criar('div', 'flex flex-wrap justify-between gap-x-3')
    const dd = criar('dd', 'font-medium', valor)
    dd.setAttribute(`data-${marca}`, '')
    linha.append(criar('dt', 'text-muted-foreground', nome), dd)
    dados.append(linha)
  }
  item.append(dados)

  if (c.meta_valor > 0) {
    // a barra nunca é a única informação: o percentual está escrito logo abaixo (e, passando de 100%, a barra fica cheia e o texto diz quanto)
    const barra = criar('progress', CLASSE_DA_BARRA)
    barra.max = c.meta_valor
    barra.value = valorDaBarra(c)
    barra.setAttribute('aria-labelledby', idDoTitulo)
    barra.setAttribute('aria-valuetext', frasePercentual(c))
    barra.setAttribute('data-barra', '')
    item.append(barra)
  }
  const percentual = criar('p', 'mt-1 text-sm font-medium', frasePercentual(c))
  percentual.setAttribute('data-percentual', '')
  item.append(percentual)
  return item
}

function pintarCampanhas(
  raiz: HTMLElement,
  campanhas: CampanhaPublica[],
): void {
  const lista = raiz.querySelector<HTMLElement>('[data-campanhas]')
  lista?.replaceChildren(...campanhas.map(itemDaCampanha))
  const vazio = raiz.querySelector<HTMLElement>('[data-sem-campanhas]')
  if (vazio) vazio.hidden = campanhas.length > 0
  const nota = raiz.querySelector<HTMLElement>('[data-nota-recebido]')
  if (nota) nota.hidden = campanhas.length === 0
  if (lista) lista.hidden = campanhas.length === 0
}

/** A lista "Para onde vai a sua doação" dos dois formulários: a primeira opção (sem campanha) fica; as campanhas vêm depois. */
function preencherEscolhas(raiz: HTMLElement, campanhas: CampanhaPublica[]) {
  for (const escolha of raiz.querySelectorAll<HTMLSelectElement>(
    '[data-campo-campanha]',
  )) {
    const atual = escolha.value
    while (escolha.options.length > 1) escolha.remove(1)
    for (const c of campanhas) {
      const opcao = criar('option', undefined, c.titulo)
      opcao.value = String(c.id_campanha)
      escolha.append(opcao)
    }
    // quem já tinha escolhido uma campanha que continua na lista não perde a escolha
    if (campanhas.some((c) => String(c.id_campanha) === atual))
      escolha.value = atual
  }
}

// ------------------------------------------------------------------------------------------------ campos e mensagens de erro

type Campo = HTMLInputElement | HTMLSelectElement

function campoOuNada(form: HTMLFormElement, nome: string): Campo | null {
  const campo = form.elements.namedItem(nome)
  return campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement
    ? campo
    : null
}

const textoDoResumo = (total: number) =>
  total === 1
    ? 'Há 1 campo para corrigir.'
    : `Há ${total} campos para corrigir.`

function mostrarErros(form: HTMLFormElement, erros: ErrosDaDoacao): void {
  for (const mensagem of form.querySelectorAll<HTMLElement>('[data-erro]')) {
    const texto = erros[mensagem.dataset.erro as CampoDaDoacao]
    mensagem.textContent = texto ?? ''
    mensagem.hidden = !texto
  }
  for (const nome of CAMPOS_DA_DOACAO) {
    const campo = campoOuNada(form, nome)
    if (!campo) continue
    if (erros[nome]) campo.setAttribute('aria-invalid', 'true')
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
  const mensagem = form.querySelector<HTMLElement>(
    `[data-erro="${campo.name}"]`,
  )
  if (mensagem) {
    mensagem.textContent = ''
    mensagem.hidden = true
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
  erros: ErrosDaDoacao,
): Campo | null {
  for (const nome of CAMPOS_DA_DOACAO) {
    if (erros[nome]) return campoOuNada(form, nome)
  }
  return null
}

function mostrarFalha(form: HTMLFormElement, texto: string | null): void {
  const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')
  if (!falha) return
  falha.textContent = texto ?? ''
  falha.hidden = !texto
}

/** Liga ao `<form>` a limpeza do aviso de quem corrige, e (opcional) o que mais deve acontecer a cada mudança. */
function ligarLimpezaDosAvisos(form: HTMLFormElement, aoMudar?: () => void) {
  form.addEventListener('input', (evento) => {
    const alvo = evento.target
    if (
      (alvo instanceof HTMLInputElement || alvo instanceof HTMLSelectElement) &&
      alvo.name
    )
      limparErroDoCampo(form, alvo)
    aoMudar?.()
  })
  form.addEventListener('change', (evento) => {
    const alvo = evento.target
    if (alvo instanceof HTMLSelectElement && alvo.name)
      limparErroDoCampo(form, alvo)
    aoMudar?.()
  })
}

// ------------------------------------------------------------------------------------------------ doar SEM se identificar

function ligarDoacaoAnonima(
  raiz: HTMLElement,
  contexto: Contexto,
  opcoes: OpcoesDaDoacao,
): void {
  const form = raiz.querySelector<HTMLFormElement>('[data-doacao-anonima]')
  const resultado = raiz.querySelector<HTMLElement>('[data-resultado-anonimo]')
  const lugarDoPainel = resultado?.querySelector<HTMLElement>('[data-painel]')
  if (!form || !resultado || !lugarDoPainel) return
  const baseUrl = raiz.dataset.apiUrl ?? ''
  const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')
  const rotuloDoBotao = botao?.textContent?.trim() || 'Mostrar o código Pix'

  // o código mostrado é o de ANTES da mudança: se a pessoa mexe na campanha ou no valor, ele sai da tela (nunca fica um código que não combina com o que está escrito)
  ligarLimpezaDosAvisos(form, () => {
    resultado.hidden = true
    mostrarFalha(form, null)
  })

  form.addEventListener('submit', (evento) => {
    evento.preventDefault()
    if (form.getAttribute('aria-busy') === 'true') return
    mostrarFalha(form, null)
    resultado.hidden = true

    const erros: ErrosDaDoacao = {}
    const campanha = campoOuNada(form, 'id_campanha')?.value ?? ''
    const valor = lerValorDigitado(campoOuNada(form, 'valor')?.value ?? '')
    if (!valor.ok) erros.valor = valor.erro
    if (
      campanha !== '' &&
      !contexto.campanhas.some((c) => String(c.id_campanha) === campanha)
    )
      erros.id_campanha = FRASES.campanha
    mostrarErros(form, erros)
    if (Object.keys(erros).length > 0) {
      primeiroCampoComErro(form, erros)?.focus()
      return
    }

    const consulta = new URLSearchParams()
    if (valor.ok && valor.valor !== null)
      consulta.set('valor', valorParaConsulta(valor.valor))
    const id = idDaCampanha(campanha)
    if (id !== null) consulta.set('id_campanha', String(id))
    const texto = consulta.toString()

    if (botao) {
      botao.disabled = true
      botao.textContent = 'Gerando…'
    }
    form.setAttribute('aria-busy', 'true')
    void buscarJson<unknown>(
      `/api/publico/doacao/pix${texto ? `?${texto}` : ''}`,
      {
        baseUrl,
        fetchImpl: opcoes.fetchImpl,
        timeoutMs: opcoes.timeoutMs ?? 35_000,
        tentativas: 2,
        esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
      },
    )
      .then((bruto) => {
        const dados = lerDadosDoPix(bruto)
        if (!dados) throw new ApiError('Resposta da API sem o código Pix.')
        lugarDoPainel.replaceChildren(criarPainelDoPix(dados, opcoes))
        resultado.hidden = false
        resultado.focus()
      })
      .catch((erro: unknown) => {
        mostrarFalha(form, falhaDoCodigo(erro))
        form.querySelector<HTMLElement>('[data-falha-do-envio]')?.focus()
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

// ------------------------------------------------------------------------------------------------ doar identificando-se

function lerValores(form: HTMLFormElement): ValoresDaDoacao {
  const texto = (nome: string) => campoOuNada(form, nome)?.value ?? ''
  const aceite = campoOuNada(form, 'consentimento_lgpd')
  return {
    nome_completo: texto('nome_completo'),
    email: texto('email'),
    cpf: texto('cpf'),
    valor: texto('valor'),
    id_campanha: texto('id_campanha'),
    consentimento_lgpd: aceite instanceof HTMLInputElement && aceite.checked,
  }
}

function mostrar(raiz: ParentNode, seletor: string, texto: string | null) {
  const alvo = raiz.querySelector<HTMLElement>(seletor)
  if (!alvo) return
  if (texto !== null) alvo.textContent = texto
  alvo.hidden = false
}

function esconder(raiz: ParentNode, seletor: string) {
  const alvo = raiz.querySelector<HTMLElement>(seletor)
  if (alvo) alvo.hidden = true
}

function mostrarConfirmacao(
  confirmacao: HTMLElement,
  resposta: RespostaDoPedido,
  contexto: Contexto,
  opcoes: OpcoesDaDoacao,
): void {
  const registrado = resposta.protocolo !== null
  const protocolo = confirmacao.querySelector<HTMLElement>('[data-protocolo]')
  const bloco = confirmacao.querySelector<HTMLElement>(
    '[data-bloco-do-protocolo]',
  )
  if (protocolo) protocolo.textContent = resposta.protocolo ?? ''
  if (bloco) bloco.hidden = !registrado

  // sem protocolo (armadilha de robô) a tela de sucesso é a mesma, mas nada é prometido nem mostrado: não houve pedido
  const validade = fraseDeValidade(
    contexto.doacao?.dias_de_validade_do_pedido ?? null,
    resposta.expira_em,
  )
  if (registrado) mostrar(confirmacao, '[data-aviso-de-pagamento]', null)
  else esconder(confirmacao, '[data-aviso-de-pagamento]')
  if (registrado && validade) {
    mostrar(confirmacao, '[data-validade]', validade)
    mostrar(confirmacao, '[data-aviso-do-vencimento]', null)
  } else {
    esconder(confirmacao, '[data-validade]')
    esconder(confirmacao, '[data-aviso-do-vencimento]')
  }
  if (registrado) mostrar(confirmacao, '[data-aviso-do-email]', null)
  else esconder(confirmacao, '[data-aviso-do-email]')

  const lugarDoPainel = confirmacao.querySelector<HTMLElement>('[data-painel]')
  lugarDoPainel?.replaceChildren(
    ...(resposta.pix ? [criarPainelDoPix(resposta.pix, opcoes)] : []),
  )
  confirmacao.hidden = false
  confirmacao.focus()
}

function ligarDoacaoIdentificada(
  raiz: HTMLElement,
  contexto: Contexto,
  opcoes: OpcoesDaDoacao,
): void {
  const form = raiz.querySelector<HTMLFormElement>('[data-doacao-identificada]')
  const confirmacao = raiz.querySelector<HTMLElement>(
    '[data-confirmacao-identificada]',
  )
  if (!form || !confirmacao) return
  const baseUrl = raiz.dataset.apiUrl ?? ''
  const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')
  const rotuloDoBotao = botao?.textContent?.trim() || 'Enviar'

  ligarLimpezaDosAvisos(form)
  const cpf = campoOuNada(form, 'cpf')
  cpf?.addEventListener('blur', () => {
    cpf.value = formatarCpf(cpf.value)
  })
  const botaoDoProtocolo = confirmacao.querySelector<HTMLButtonElement>(
    '[data-copiar-protocolo]',
  )
  const avisoDoProtocolo = confirmacao.querySelector<HTMLElement>(
    '[data-aviso-da-copia-do-protocolo]',
  )
  const numero = confirmacao.querySelector<HTMLElement>('[data-protocolo]')
  if (botaoDoProtocolo && avisoDoProtocolo && numero)
    ligarBotaoDeCopiar(
      botaoDoProtocolo,
      avisoDoProtocolo,
      () => numero.textContent ?? '',
      numero,
      opcoes,
    )

  form.addEventListener('submit', (evento) => {
    evento.preventDefault()
    // um segundo envio enquanto o primeiro está a caminho criaria um segundo pedido (e, para a tesouraria, uma segunda doação a conferir)
    if (form.getAttribute('aria-busy') === 'true') return
    mostrarFalha(form, null)
    const valores = lerValores(form)
    const erros = validarDoacao(
      valores,
      contexto.campanhas.map((c) => c.id_campanha),
    )
    mostrarErros(form, erros)
    if (Object.keys(erros).length > 0) {
      primeiroCampoComErro(form, erros)?.focus()
      return
    }
    // a versão do aviso que a página mostrou é a que a API mandou ler: sem ela não há como aceitar (a página nem chega aqui sem ela)
    const versao = contexto.doacao?.versao_aviso_de_privacidade
    if (!versao) {
      mostrarFalha(
        form,
        'Não foi possível conferir a versão do aviso de privacidade. Recarregue a página e tente de novo.',
      )
      return
    }

    if (botao) {
      botao.disabled = true
      botao.textContent = 'Enviando…'
    }
    form.setAttribute('aria-busy', 'true')
    const armadilha = campoOuNada(form, 'pagina_web')?.value ?? ''
    void enviarJson<unknown>(
      '/api/publico/doacoes/intencoes',
      montarCorpoDaDoacao(valores, versao, armadilha),
      { baseUrl, fetchImpl: opcoes.fetchImpl, timeoutMs: opcoes.timeoutMs },
    )
      .then(lerRespostaDoPedido)
      .then((resposta) => {
        form.hidden = true
        mostrarConfirmacao(confirmacao, resposta, contexto, opcoes)
      })
      .catch((erro: unknown) => {
        const falha = falhaDoEnvio(erro)
        mostrarErros(form, falha.porCampo)
        mostrarFalha(form, falha.geral)
        const campoComErro = primeiroCampoComErro(form, falha.porCampo)
        if (campoComErro) campoComErro.focus()
        else form.querySelector<HTMLElement>('[data-falha-do-envio]')?.focus()
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

// ------------------------------------------------------------------------------------------------ a ilha

export async function iniciarDoacao(
  raiz: HTMLElement,
  opcoes: OpcoesDaDoacao = {},
): Promise<void> {
  const contexto: Contexto = { doacao: null, campanhas: [] }
  const agora = opcoes.agora ?? (() => new Date())
  ligarDoacaoAnonima(raiz, contexto, opcoes)
  ligarDoacaoIdentificada(raiz, contexto, opcoes)

  async function carregar(): Promise<void> {
    mostrarEstado(raiz, 'carregando')
    try {
      const bruto = await buscarJson<unknown>('/api/publico/doacao', {
        baseUrl: raiz.dataset.apiUrl ?? '',
        fetchImpl: opcoes.fetchImpl,
        timeoutMs: opcoes.timeoutMs ?? 35_000,
        tentativas: 2,
        esperaEntreTentativasMs: opcoes.esperaEntreTentativasMs,
      })
      const doacao = lerDoacaoPublica(bruto)
      if (!doacao) return mostrarEstado(raiz, 'erro')
      if (!doacao.pix_disponivel) return mostrarEstado(raiz, 'indisponivel')
      contexto.doacao = doacao
      contexto.campanhas = campanhasEmAndamento(doacao.campanhas, agora())
      pintarCampanhas(raiz, contexto.campanhas)
      preencherEscolhas(raiz, contexto.campanhas)
      const versao = raiz.querySelector<HTMLElement>('[data-versao-do-aviso]')
      if (versao) versao.textContent = doacao.versao_aviso_de_privacidade ?? ''
      mostrarEstado(raiz, 'pronto')
    } catch (erro) {
      // 404 = a API é a de antes da doação pelo site: a página diz que ainda não está disponível. Outro erro (API acordando, sem rede): "tentar de novo".
      if (erro instanceof ApiError && erro.status === 404)
        mostrarEstado(raiz, 'indisponivel')
      else mostrarEstado(raiz, 'erro')
    }
  }

  raiz
    .querySelector<HTMLButtonElement>('[data-tentar-de-novo]')
    ?.addEventListener('click', () => void carregar())
  await carregar()
}
