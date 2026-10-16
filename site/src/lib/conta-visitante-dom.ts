import { ApiError } from './api'
import {
  avisoDoEventoNoLink,
  avisoDoReciboPorEmail,
  buscarConta,
  codigoTemOTamanhoCerto,
  diaEmPalavras,
  emailParece,
  entrarComCodigo,
  esquecerSessao,
  explicacaoDaDoacao,
  frasePeloFimDaSessao,
  guardarSessao,
  instanteEmPalavras,
  instanteUtc,
  lerConta,
  lerSessaoGuardada,
  linhaDoRecibo,
  linksDaInscricao,
  MENSAGEM_DE_CODIGO_TORTO,
  MENSAGEM_DE_EMAIL_TORTO,
  MENSAGEM_DE_SAIDA,
  MENSAGEM_DE_SESSAO_ACABOU,
  mensagemDaConta,
  mensagemDeEntrada,
  mensagemDoApagamento,
  mensagemDoPedidoDeCodigo,
  pedirApagamento,
  pedirCodigo,
  quandoDoEvento,
  sairDaConta,
  sessaoAcabou,
  situacaoDaDoacao,
  situacaoDaInscricao,
  type ContaDoVisitante,
} from './conta-visitante'
import { valorEmReais } from './inscricao-link'

/**
 * O NAVEGADOR da página `/minha-conta/` (v5.6b): liga o HTML de `components/ContaDoVisitante.astro` à API. Quatro telas (e-mail, código, a conta e a falha), uma sessão curta
 * guardada só nesta aba e cartões copiados de `<template>`s e preenchidos só com texto (nada que vem da API entra como HTML). Ao sair, a sessão acabar ou a aba fechar, os dados
 * pessoais saem da tela e da memória da página.
 */

export interface OpcoesDaConta {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Onde a sessão fica guardada (nos testes, um falso). Padrão: `sessionStorage`. */
  armazenamento?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  /** O relógio (nos testes, fixo). */
  agora?: () => number
}

type Estado = 'carregando' | 'email' | 'codigo' | 'conta' | 'erro'

const MAIOR_ESPERA_DO_RELOGIO = 2_147_000_000

export async function iniciarContaDoVisitante(
  raiz: HTMLElement,
  opcoes: OpcoesDaConta = {},
): Promise<void> {
  const agora = opcoes.agora ?? (() => Date.now())
  const opcoesDaApi = () => ({
    baseUrl: raiz.dataset.apiUrl ?? '',
    fetchImpl: opcoes.fetchImpl,
    timeoutMs: opcoes.timeoutMs,
  })
  const armazenamento = opcoes.armazenamento

  const um = <T extends HTMLElement>(seletor: string) =>
    raiz.querySelector<T>(seletor)
  const todos = <T extends HTMLElement>(seletor: string) => [
    ...raiz.querySelectorAll<T>(seletor),
  ]

  let email = ''
  let token: string | null = null
  let relogio: ReturnType<typeof setTimeout> | null = null
  let tentarDeNovo: (() => void) | null = null

  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  /* utilidades de tela                                                                                                                                          */
  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  const mostrarEstado = (estado: Estado) => {
    for (const bloco of todos('[data-estado]'))
      bloco.hidden = bloco.dataset.estado !== estado
  }

  const avisar = (texto: string | null) => {
    const aviso = um('[data-aviso-geral]')
    if (!aviso) return
    aviso.textContent = texto ?? ''
    aviso.hidden = !texto
    if (texto) aviso.focus()
  }

  const mostrarErro = (seletor: string, texto: string | null) => {
    const erro = um(seletor)
    if (!erro) return
    erro.textContent = texto ?? ''
    erro.hidden = !texto
    const campo = erro.parentElement?.querySelector<HTMLElement>('input')
    if (campo) campo.setAttribute('aria-invalid', texto ? 'true' : 'false')
  }

  const preencher = (
    pai: ParentNode,
    seletor: string,
    valor: string | null,
  ): void => {
    const alvo = pai.querySelector<HTMLElement>(seletor)
    if (!alvo) return
    alvo.textContent = valor ?? ''
    const linha = alvo.closest<HTMLElement>('[data-linha]')
    if (linha) linha.hidden = valor === null || valor === ''
  }

  const clonar = (nome: string): HTMLElement | null => {
    const modelo = um<HTMLTemplateElement>(`template[data-modelo="${nome}"]`)
    return (
      (modelo?.content.firstElementChild?.cloneNode(true) as HTMLElement) ??
      null
    )
  }

  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  /* a conta                                                                                                                                                     */
  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  const limparConta = () => {
    for (const lista of todos('[data-lista]')) lista.replaceChildren()
    for (const seletor of [
      '[data-email-da-conta]',
      '[data-fim-da-sessao]',
      '[data-protocolo-em-andamento]',
      '[data-prazo-em-andamento]',
      '[data-protocolo-do-pedido]',
      '[data-prazo-do-pedido]',
      '[data-email-informado]',
      '[data-mensagem-do-pedido]',
    ]) {
      const el = um(seletor)
      if (el) el.textContent = ''
    }
    const campoDoCodigo = um<HTMLInputElement>('#conta-codigo')
    if (campoDoCodigo) campoDoCodigo.value = ''
    const frase = um('[data-frase-do-resultado]')
    if (frase) frase.textContent = 'Pedido recebido.'
    const confirmacao = um('[data-confirmacao-por-email]')
    if (confirmacao) confirmacao.hidden = false
    for (const seletor of [
      '[data-resultado-do-apagamento]',
      '[data-falha-do-apagamento]',
      '[data-apagamento-em-andamento]',
      '[data-passo-de-confirmacao]',
    ]) {
      const el = um(seletor)
      if (el) el.hidden = true
    }
    const formulario = um('[data-apagamento-formulario]')
    if (formulario) formulario.hidden = false
  }

  const encerrarAqui = () => {
    esquecerSessao(armazenamento)
    token = null
    if (relogio) clearTimeout(relogio)
    relogio = null
    limparConta()
  }

  /** Sair ou a sessão acabar: o e-mail também sai da tela e da memória da página (computador compartilhado). */
  const voltarParaOEmail = (aviso: string | null) => {
    encerrarAqui()
    email = ''
    const campoDoEmail = um<HTMLInputElement>('#conta-email')
    if (campoDoEmail) campoDoEmail.value = ''
    mostrarEstado('email')
    avisar(aviso)
  }

  const desenharInscricoes = (conta: ContaDoVisitante) => {
    const lista = um('[data-lista="inscricoes"]')
    if (!lista) return
    for (const i of conta.inscricoes) {
      const cartao = clonar('inscricao')
      if (!cartao) continue
      preencher(cartao, '[data-i-titulo]', i.evento.titulo ?? 'Evento')
      const aviso = avisoDoEventoNoLink(i)
      const caixaDoAviso = cartao.querySelector<HTMLElement>('[data-i-aviso]')
      if (caixaDoAviso && aviso) {
        caixaDoAviso.textContent = aviso.texto
        caixaDoAviso.hidden = false
      }
      preencher(
        cartao,
        '[data-i-quando]',
        quandoDoEvento(i.evento.data_hora_inicio),
      )
      preencher(cartao, '[data-i-onde]', i.evento.endereco_avulso)
      preencher(cartao, '[data-i-sessao]', i.sessao?.titulo ?? null)
      preencher(cartao, '[data-i-inscrito]', i.primeiro_nome)
      preencher(cartao, '[data-i-situacao]', situacaoDaInscricao(i))
      preencher(cartao, '[data-i-codigo]', i.codigo_checkin)
      const encerrado = cartao.querySelector<HTMLElement>('[data-i-encerrado]')
      if (encerrado) encerrado.hidden = !i.evento_encerrado
      const { cancelar, confirmar } = linksDaInscricao(i)
      const links = cartao.querySelector<HTMLElement>('[data-i-links]')
      const aCancelar =
        cartao.querySelector<HTMLAnchorElement>('[data-i-cancelar]')
      const aConfirmar =
        cartao.querySelector<HTMLAnchorElement>('[data-i-confirmar]')
      if (aCancelar && cancelar) {
        aCancelar.href = cancelar
        aCancelar.hidden = false
      }
      if (aConfirmar && confirmar) {
        aConfirmar.href = confirmar
        aConfirmar.hidden = false
      }
      if (links) links.hidden = !cancelar && !confirmar
      lista.append(cartao)
    }
    const vazio = um('[data-vazio="inscricoes"]')
    if (vazio) vazio.hidden = conta.inscricoes.length > 0
    const nota = um('[data-nota-de-eventos-encerrados]')
    if (nota) nota.hidden = !conta.inscricoes.some((i) => i.evento_encerrado)
  }

  const desenharCertificados = (conta: ContaDoVisitante) => {
    const lista = um('[data-lista="certificados"]')
    if (!lista) return
    for (const c of conta.certificados) {
      const cartao = clonar('certificado')
      if (!cartao) continue
      preencher(cartao, '[data-c-tipo]', c.tipo_documento)
      preencher(cartao, '[data-c-atividade]', c.atividade)
      preencher(cartao, '[data-c-nome]', c.primeiro_nome)
      preencher(cartao, '[data-c-emitido]', diaEmPalavras(c.emitida_em))
      preencher(cartao, '[data-c-codigo]', c.codigo_verificacao)
      const baixar = cartao.querySelector<HTMLAnchorElement>('[data-c-baixar]')
      if (baixar && c.arquivo) {
        baixar.href = `${raiz.dataset.apiUrl ?? ''}${c.arquivo}`
        baixar.target = '_blank'
        baixar.rel = 'noopener noreferrer'
        baixar.hidden = false
      }
      lista.append(cartao)
    }
    const vazio = um('[data-vazio="certificados"]')
    if (vazio) vazio.hidden = conta.certificados.length > 0
  }

  const desenharDoacoes = (conta: ContaDoVisitante) => {
    const lista = um('[data-lista="doacoes"]')
    if (!lista) return
    for (const d of conta.doacoes) {
      const cartao = clonar('doacao')
      if (!cartao) continue
      preencher(cartao, '[data-d-protocolo]', d.protocolo)
      preencher(cartao, '[data-d-situacao]', situacaoDaDoacao(d.situacao))
      preencher(cartao, '[data-d-pedida]', instanteEmPalavras(d.pedida_em))
      preencher(cartao, '[data-d-informado]', valorEmReais(d.valor_informado))
      preencher(cartao, '[data-d-campanha]', d.campanha)
      preencher(
        cartao,
        '[data-d-recibo]',
        linhaDoRecibo(d) ?? 'Ainda sem recibo',
      )
      const explicacao = explicacaoDaDoacao(d)
      const caixaDaExplicacao = cartao.querySelector<HTMLElement>(
        '[data-d-explicacao]',
      )
      if (caixaDaExplicacao && explicacao) {
        caixaDaExplicacao.textContent = explicacao
        caixaDaExplicacao.hidden = false
      }
      const avisoDoRecibo = avisoDoReciboPorEmail(d)
      const caixaDoAviso = cartao.querySelector<HTMLElement>(
        '[data-d-aviso-do-recibo]',
      )
      if (caixaDoAviso && avisoDoRecibo) {
        caixaDoAviso.textContent = avisoDoRecibo
        caixaDoAviso.hidden = false
      }
      lista.append(cartao)
    }
    const vazio = um('[data-vazio="doacoes"]')
    if (vazio) vazio.hidden = conta.doacoes.length > 0
  }

  const desenharApagamento = (conta: ContaDoVisitante) => {
    const andamento = um('[data-apagamento-em-andamento]')
    const formulario = um('[data-apagamento-formulario]')
    const pedido = conta.pedido_de_apagamento
    if (andamento) andamento.hidden = !pedido
    if (formulario) formulario.hidden = !!pedido
    if (pedido) {
      const protocolo = um('[data-protocolo-em-andamento]')
      if (protocolo) protocolo.textContent = pedido.protocolo
      const prazo = diaEmPalavras(pedido.prazo_em)
      const prazoEl = um('[data-prazo-em-andamento]')
      if (prazoEl)
        prazoEl.textContent = prazo ? `Prazo de resposta: até ${prazo}.` : ''
    }
  }

  const agendarOFim = (iso: string | null) => {
    if (relogio) clearTimeout(relogio)
    relogio = null
    if (!iso) return
    const espera = instanteUtc(iso) - agora()
    if (!Number.isFinite(espera)) return
    relogio = setTimeout(
      () => voltarParaOEmail(MENSAGEM_DE_SESSAO_ACABOU),
      Math.min(Math.max(espera, 0), MAIOR_ESPERA_DO_RELOGIO),
    )
  }

  const desenharConta = (conta: ContaDoVisitante) => {
    limparConta()
    const emailDaConta = um('[data-email-da-conta]')
    if (emailDaConta) emailDaConta.textContent = conta.email
    const fim = um('[data-fim-da-sessao]')
    if (fim)
      fim.textContent = frasePeloFimDaSessao(conta.sessao_expira_em) ?? ''
    desenharInscricoes(conta)
    desenharCertificados(conta)
    desenharDoacoes(conta)
    desenharApagamento(conta)
  }

  const abrirConta = async (sessao: string): Promise<void> => {
    token = sessao
    mostrarEstado('carregando')
    try {
      const conta = lerConta(await buscarConta(sessao, opcoesDaApi()))
      if (!conta) throw new ApiError('A resposta da conta veio torta.')
      email = conta.email
      desenharConta(conta)
      mostrarEstado('conta')
      agendarOFim(conta.sessao_expira_em)
    } catch (erro) {
      if (sessaoAcabou(erro)) {
        voltarParaOEmail(MENSAGEM_DE_SESSAO_ACABOU)
        return
      }
      const mensagem = um('[data-mensagem-de-erro]')
      if (mensagem) mensagem.textContent = mensagemDaConta(erro)
      tentarDeNovo = () => void abrirConta(sessao)
      mostrarEstado('erro')
    }
  }

  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  /* as telas de entrada                                                                                                                                         */
  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  const mostrarOCodigo = (mensagem: string) => {
    const texto = um('[data-mensagem-do-pedido]')
    if (texto) texto.textContent = mensagem
    const informado = um('[data-email-informado]')
    if (informado) informado.textContent = email
    const campo = um<HTMLInputElement>('#conta-codigo')
    if (campo) campo.value = ''
    mostrarErro('[data-erro-do-codigo]', null)
    mostrarEstado('codigo')
    campo?.focus()
  }

  const pedir = async (valor: string, armadilha: string): Promise<boolean> => {
    try {
      const resposta = await pedirCodigo(valor, opcoesDaApi(), armadilha)
      email = valor.trim()
      mostrarOCodigo(resposta.mensagem)
      return true
    } catch (erro) {
      mostrarErro('[data-erro-do-email]', mensagemDoPedidoDeCodigo(erro))
      return false
    }
  }

  um<HTMLFormElement>('[data-formulario-email]')?.addEventListener(
    'submit',
    async (evento) => {
      evento.preventDefault()
      const campo = um<HTMLInputElement>('#conta-email')
      const botao = um<HTMLButtonElement>('[data-pedir-codigo]')
      const valor = campo?.value.trim() ?? ''
      avisar(null)
      if (!emailParece(valor)) {
        mostrarErro('[data-erro-do-email]', MENSAGEM_DE_EMAIL_TORTO)
        campo?.focus()
        return
      }
      mostrarErro('[data-erro-do-email]', null)
      const armadilha =
        um<HTMLInputElement>('input[name="pagina_web"]')?.value ?? ''
      if (botao) botao.disabled = true
      try {
        await pedir(valor, armadilha)
      } finally {
        if (botao) botao.disabled = false
      }
    },
  )

  um<HTMLFormElement>('[data-formulario-codigo]')?.addEventListener(
    'submit',
    async (evento) => {
      evento.preventDefault()
      const campo = um<HTMLInputElement>('#conta-codigo')
      const botao = um<HTMLButtonElement>('[data-entrar]')
      const valor = campo?.value ?? ''
      if (!codigoTemOTamanhoCerto(valor)) {
        mostrarErro('[data-erro-do-codigo]', MENSAGEM_DE_CODIGO_TORTO)
        campo?.focus()
        return
      }
      mostrarErro('[data-erro-do-codigo]', null)
      if (botao) botao.disabled = true
      try {
        const resposta = await entrarComCodigo(email, valor, opcoesDaApi())
        guardarSessao(
          { token: resposta.token, expira_em: resposta.expira_em },
          armazenamento,
        )
        avisar(null)
        await abrirConta(resposta.token)
      } catch (erro) {
        mostrarErro('[data-erro-do-codigo]', mensagemDeEntrada(erro))
        campo?.focus()
      } finally {
        if (botao) botao.disabled = false
      }
    },
  )

  um('[data-pedir-outro-codigo]')?.addEventListener('click', async () => {
    const botao = um<HTMLButtonElement>('[data-pedir-outro-codigo]')
    if (botao) botao.disabled = true
    try {
      if (!(await pedir(email, ''))) {
        // volta ao e-mail para a falha aparecer onde a pessoa vê
        const campoDoEmail = um<HTMLInputElement>('#conta-email')
        if (campoDoEmail) campoDoEmail.value = email
        mostrarEstado('email')
      }
    } finally {
      if (botao) botao.disabled = false
    }
  })

  um('[data-usar-outro-email]')?.addEventListener('click', () => {
    const campoDoEmail = um<HTMLInputElement>('#conta-email')
    if (campoDoEmail) campoDoEmail.value = ''
    email = ''
    mostrarErro('[data-erro-do-email]', null)
    mostrarEstado('email')
    campoDoEmail?.focus()
  })

  um('[data-tentar-de-novo]')?.addEventListener('click', () => tentarDeNovo?.())

  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  /* dentro da conta                                                                                                                                             */
  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  um('[data-sair]')?.addEventListener('click', async () => {
    const sessao = token
    voltarParaOEmail(MENSAGEM_DE_SAIDA)
    if (sessao) {
      try {
        await sairDaConta(sessao, opcoesDaApi())
      } catch {
        // a sessão já saiu da tela; o servidor a encerra sozinho no prazo
      }
    }
  })

  const passo = () => um('[data-passo-de-confirmacao]')

  um('[data-apagar]')?.addEventListener('click', () => {
    const etapa = passo()
    if (etapa) etapa.hidden = false
    um<HTMLButtonElement>('[data-confirmar-apagamento]')?.focus()
  })

  um('[data-voltar]')?.addEventListener('click', () => {
    const etapa = passo()
    if (etapa) etapa.hidden = true
    um<HTMLButtonElement>('[data-apagar]')?.focus()
  })

  um('[data-confirmar-apagamento]')?.addEventListener('click', async () => {
    const sessao = token
    if (!sessao) return
    const botao = um<HTMLButtonElement>('[data-confirmar-apagamento]')
    const falha = um('[data-falha-do-apagamento]')
    if (falha) falha.hidden = true
    if (botao) botao.disabled = true
    try {
      const resposta = await pedirApagamento(sessao, opcoesDaApi())
      // o pedido que já existia não manda e-mail de novo: a tela não promete a confirmação
      const frase = um('[data-frase-do-resultado]')
      if (frase)
        frase.textContent = resposta.ja_existia
          ? 'Você já tinha este pedido em andamento.'
          : 'Pedido recebido.'
      const confirmacao = um('[data-confirmacao-por-email]')
      if (confirmacao) confirmacao.hidden = resposta.ja_existia === true
      const protocolo = um('[data-protocolo-do-pedido]')
      if (protocolo) protocolo.textContent = resposta.protocolo
      const prazo = diaEmPalavras(resposta.prazo_em)
      const prazoEl = um('[data-prazo-do-pedido]')
      if (prazoEl)
        prazoEl.textContent = prazo ? `Prazo de resposta: até ${prazo}.` : ''
      const formulario = um('[data-apagamento-formulario]')
      if (formulario) formulario.hidden = true
      const resultado = um('[data-resultado-do-apagamento]')
      if (resultado) {
        resultado.hidden = false
        resultado.focus()
      }
    } catch (erro) {
      if (sessaoAcabou(erro)) {
        voltarParaOEmail(MENSAGEM_DE_SESSAO_ACABOU)
        return
      }
      if (falha) {
        falha.textContent = mensagemDoApagamento(erro)
        falha.hidden = false
        falha.focus()
      }
    } finally {
      if (botao) botao.disabled = false
    }
  })

  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  /* a abertura da página                                                                                                                                         */
  /* ---------------------------------------------------------------------------------------------------------------------------------------------------------- */
  const guardada = lerSessaoGuardada(armazenamento, agora())
  if (guardada) {
    await abrirConta(guardada.token)
  } else {
    mostrarEstado('email')
  }
}
