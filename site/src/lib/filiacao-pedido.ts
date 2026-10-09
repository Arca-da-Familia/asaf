import { ApiError, enviarJson } from './api'

/**
 * Formulário público de FILIAÇÃO (v5.4h): o pedido sai do site para a API (`POST /api/filiacao/propor`) e cai na caixa de propostas da Diretoria; os sócios
 * ativos são avisados no painel para propor o nome (Estatuto, Art. 12, parágrafo único, VI).
 *
 * A idade segue o Art. 12 (maior de 18 anos; de 16 a 17 com autorização dos pais ou responsáveis). O formulário só recebe a DECLARAÇÃO de que a autorização
 * existe: o papel é conferido pela secretaria. A API repete todas as regras (quem manda o pedido sem passar pela página também é barrado); aqui elas
 * existem para a pessoa saber o que corrigir antes de enviar.
 *
 * SEGURANÇA: só `textContent` e atributos — nada vindo da API entra como HTML.
 */

/** Versão do aviso de privacidade do formulário. A API só aceita a versão que ela conhece: mudou o texto, muda o número nos dois lados. */
export const VERSAO_DO_AVISO_DE_PRIVACIDADE = '2'

export const IDADE_MINIMA = 16
export const MAIORIDADE = 18

export interface ValoresDoPedido {
  nome_completo: string
  cpf: string
  data_nascimento: string
  email_contato: string
  telefone_whatsapp: string
  autorizacao_responsavel: boolean
  consentimento_lgpd: boolean
}

export type CampoComErro = keyof ValoresDoPedido | 'contato'
export type ErrosDoPedido = Partial<Record<CampoComErro, string>>

export const somenteDigitos = (texto: string) => texto.replace(/\D/g, '')

export function cpfValido(cpf: string): boolean {
  const d = somenteDigitos(cpf)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const digito = (tamanho: number) => {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10])
}

/** Idade completa em `hoje`; `null` se o texto não for uma data AAAA-MM-DD real (ou for no futuro). */
export function idadeEm(nascimento: string, hoje: Date): number | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nascimento)
  if (!partes) return null
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
    return null
  const mesHoje = hoje.getMonth() + 1
  const idade =
    hoje.getFullYear() -
    ano -
    (mesHoje < mes || (mesHoje === mes && hoje.getDate() < dia) ? 1 : 0)
  return idade < 0 ? null : idade
}

export function precisaDeAutorizacao(nascimento: string, hoje: Date): boolean {
  const idade = idadeEm(nascimento, hoje)
  return idade !== null && idade >= IDADE_MINIMA && idade < MAIORIDADE
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function telefoneValido(telefone: string): boolean {
  const d = somenteDigitos(telefone)
  if (d.length !== 10 && d.length !== 11) return false
  if (Number(d.slice(0, 2)) < 11) return false
  return d.length === 10 || d[2] === '9'
}

export function validarPedido(
  v: ValoresDoPedido,
  hoje: Date = new Date(),
): ErrosDoPedido {
  const erros: ErrosDoPedido = {}
  if (v.nome_completo.trim().length < 3)
    erros.nome_completo = 'Informe o seu nome completo.'
  if (!v.cpf.trim()) erros.cpf = 'Informe o seu CPF.'
  else if (!cpfValido(v.cpf))
    erros.cpf = 'Esse CPF não confere: veja se os números estão certos.'

  const idade = idadeEm(v.data_nascimento, hoje)
  if (!v.data_nascimento)
    erros.data_nascimento = 'Informe a sua data de nascimento.'
  else if (idade === null)
    erros.data_nascimento = 'Essa data de nascimento não é válida.'
  else if (idade < IDADE_MINIMA)
    erros.data_nascimento = `O Estatuto (Art. 12) só admite filiação a partir dos ${IDADE_MINIMA} anos.`
  else if (idade < MAIORIDADE && !v.autorizacao_responsavel)
    erros.autorizacao_responsavel = `De ${IDADE_MINIMA} a ${MAIORIDADE - 1} anos, o Estatuto (Art. 12) exige a autorização expressa dos pais ou responsáveis: marque a declaração.`

  const email = v.email_contato.trim()
  const telefone = v.telefone_whatsapp.trim()
  if (email && !EMAIL.test(email))
    erros.email_contato = 'Esse e-mail não parece certo.'
  if (telefone && !telefoneValido(telefone))
    erros.telefone_whatsapp = 'Use o DDD e o número, com 10 ou 11 dígitos.'
  if (!email && !telefone)
    erros.contato =
      'Informe um e-mail ou um telefone para a secretaria conseguir falar com você.'

  if (!v.consentimento_lgpd)
    erros.consentimento_lgpd =
      'Para enviar, é preciso ler e aceitar o aviso de privacidade.'
  return erros
}

/** O corpo que a API espera (`PropostaFiliacaoCriar`): CPF e telefone só com dígitos; o que ficou em branco não vai. */
export function montarCorpo(
  v: ValoresDoPedido,
  armadilha = '',
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    nome_completo: v.nome_completo.trim().replace(/\s+/g, ' '),
    cpf: somenteDigitos(v.cpf),
    data_nascimento: v.data_nascimento,
    consentimento_lgpd: v.consentimento_lgpd,
    versao_texto_consentimento: VERSAO_DO_AVISO_DE_PRIVACIDADE,
    autorizacao_responsavel: v.autorizacao_responsavel,
    pagina_web: armadilha,
  }
  if (v.email_contato.trim()) corpo.email_contato = v.email_contato.trim()
  if (v.telefone_whatsapp.trim())
    corpo.telefone_whatsapp = somenteDigitos(v.telefone_whatsapp)
  return corpo
}

export function mensagemDeFalhaDoEnvio(erro: unknown): string {
  if (erro instanceof ApiError && erro.detalhe) return erro.detalhe
  if (erro instanceof ApiError && erro.status === 429)
    return 'Muitos pedidos vieram deste endereço. Aguarde um pouco e tente de novo, ou fale com a secretaria.'
  return 'Não foi possível enviar o pedido agora. Tente de novo em alguns instantes; se continuar, fale com a secretaria.'
}

export interface OpcoesDoFormulario {
  hoje?: () => Date
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

const CAMPOS_DO_FORMULARIO: Array<keyof ValoresDoPedido> = [
  'nome_completo',
  'cpf',
  'data_nascimento',
  'email_contato',
  'telefone_whatsapp',
  'autorizacao_responsavel',
  'consentimento_lgpd',
]

function entrada(form: HTMLFormElement, nome: string): HTMLInputElement {
  const campo = form.elements.namedItem(nome)
  if (!(campo instanceof HTMLInputElement))
    throw new Error(`Campo ausente no formulário: ${nome}`)
  return campo
}

function lerValores(form: HTMLFormElement): ValoresDoPedido {
  return {
    nome_completo: entrada(form, 'nome_completo').value,
    cpf: entrada(form, 'cpf').value,
    data_nascimento: entrada(form, 'data_nascimento').value,
    email_contato: entrada(form, 'email_contato').value,
    telefone_whatsapp: entrada(form, 'telefone_whatsapp').value,
    autorizacao_responsavel: entrada(form, 'autorizacao_responsavel').checked,
    consentimento_lgpd: entrada(form, 'consentimento_lgpd').checked,
  }
}

function mostrarErros(form: HTMLFormElement, erros: ErrosDoPedido): void {
  for (const mensagem of form.querySelectorAll<HTMLElement>('[data-erro]')) {
    const chave = mensagem.dataset.erro as CampoComErro
    const texto = erros[chave]
    mensagem.textContent = texto ?? ''
    mensagem.hidden = !texto
  }
  for (const nome of CAMPOS_DO_FORMULARIO) {
    const campo = entrada(form, nome)
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
    resumo.textContent =
      total === 0
        ? ''
        : total === 1
          ? 'Há 1 campo para corrigir.'
          : `Há ${total} campos para corrigir.`
    resumo.hidden = total === 0
  }
}

/** Quem corrige um campo vê o aviso dele sumir na hora (e o resumo acompanhar), sem esperar o próximo envio. */
function limparErroDoCampo(
  form: HTMLFormElement,
  campo: HTMLInputElement,
): void {
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
    resumo.textContent =
      restantes === 0
        ? ''
        : restantes === 1
          ? 'Há 1 campo para corrigir.'
          : `Há ${restantes} campos para corrigir.`
    resumo.hidden = restantes === 0
  }
}

function primeiroCampoComErro(
  form: HTMLFormElement,
  erros: ErrosDoPedido,
): HTMLInputElement | null {
  for (const nome of CAMPOS_DO_FORMULARIO) {
    if (erros[nome]) return entrada(form, nome)
  }
  return erros.contato ? entrada(form, 'email_contato') : null
}

export function iniciarFormularioDeFiliacao(
  form: HTMLFormElement,
  opcoes: OpcoesDoFormulario = {},
): void {
  const hoje = opcoes.hoje ?? (() => new Date())
  const bloco = form.querySelector<HTMLElement>('[data-bloco-autorizacao]')
  const botao = form.querySelector<HTMLButtonElement>('[data-enviar]')
  const falha = form.querySelector<HTMLElement>('[data-falha-do-envio]')
  const confirmacao = document.querySelector<HTMLElement>(
    form.dataset.confirmacao ?? '[data-confirmacao]',
  )

  const mostrarAutorizacaoSeForMenor = () => {
    if (bloco)
      bloco.hidden = !precisaDeAutorizacao(
        entrada(form, 'data_nascimento').value,
        hoje(),
      )
  }
  entrada(form, 'data_nascimento').addEventListener(
    'input',
    mostrarAutorizacaoSeForMenor,
  )
  entrada(form, 'data_nascimento').addEventListener(
    'change',
    mostrarAutorizacaoSeForMenor,
  )
  mostrarAutorizacaoSeForMenor()
  form.addEventListener('input', (evento) => {
    if (evento.target instanceof HTMLInputElement && evento.target.name)
      limparErroDoCampo(form, evento.target)
  })

  form.addEventListener('submit', (evento) => {
    evento.preventDefault()
    // um segundo envio enquanto o primeiro está a caminho criaria um pedido duplicado
    if (form.getAttribute('aria-busy') === 'true') return
    if (falha) falha.hidden = true
    const valores = lerValores(form)
    // quem não precisa da autorização (maior de idade) não manda a marca, mesmo que a tenha deixado marcada antes de corrigir a data
    if (!precisaDeAutorizacao(valores.data_nascimento, hoje()))
      valores.autorizacao_responsavel = false
    const erros = validarPedido(valores, hoje())
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
    const armadilha =
      (form.elements.namedItem('pagina_web') as HTMLInputElement | null)
        ?.value ?? ''
    void enviarJson('/api/filiacao/propor', montarCorpo(valores, armadilha), {
      baseUrl: form.dataset.apiUrl ?? '',
      fetchImpl: opcoes.fetchImpl,
      timeoutMs: opcoes.timeoutMs,
    })
      .then(() => {
        form.hidden = true
        if (confirmacao) {
          confirmacao.hidden = false
          confirmacao.focus()
        }
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
          botao.textContent = 'Enviar pedido de filiação'
        }
      })
  })
}
