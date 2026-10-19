import { ApiError } from './api'
import { formatarDataCurta, formatarDiaDeInstanteUtc } from './datas'
import { cpfValido, EMAIL, somenteDigitos } from './filiacao-pedido'

/**
 * Doar pelo site com Pix estático (v5.6a) — a parte que não mexe em tela: ler a resposta da API, validar o que a pessoa digitou (com as MESMAS frases do servidor),
 * montar o corpo do pedido e escrever o que a página diz de cada campanha. Quem desenha a página é `doacao-vivo.ts`.
 *
 * O que a API devolve (app/routers/doacao_online.py):
 *  - `GET /api/publico/doacao`: o Pix da associação (só se a Presidência o marcou "vai para o site"), as campanhas EM ANDAMENTO, a versão do aviso de privacidade e os dias de
 *    validade do pedido;
 *  - `GET /api/publico/doacao/pix`: o código "copia e cola" para doar SEM se identificar;
 *  - `POST /api/publico/doacoes/intencoes`: doar SE IDENTIFICANDO — protocolo e código. A intenção nunca é dinheiro: só a confirmação da tesouraria, depois de achar o Pix no extrato do
 *    banco, cria a doação e o recibo.
 *
 * A API repete todas as regras (quem manda o pedido sem passar pela página também é barrado); aqui elas existem para a pessoa saber o que corrigir antes de enviar.
 *
 * SEGURANÇA: o que vem da API (título e descrição de campanha, nome do beneficiário) é texto digitado por quem administra; a página só usa `textContent` e atributos.
 */

export const VALOR_MAXIMO_DA_DOACAO = 1_000_000
export const NOME_MINIMO = 3
export const NOME_MAXIMO = 120

/** As frases do servidor (app/schemas/doacao_online.py), iguais nas duas pontas: a pessoa lê a mesma coisa antes e depois do envio. */
export const FRASES = {
  nome: 'Informe o seu nome completo.',
  nomeGrande: 'O nome ficou grande demais: confira.',
  email: 'Esse e-mail não parece certo: confira se está escrito sem erro.',
  cpf: 'Esse CPF não confere: confira os números ou deixe em branco.',
  valorZero: 'O valor da doação precisa ser maior que zero.',
  valorAlto:
    'Esse valor é alto demais para o Pix pelo site: fale com a secretaria.',
  valorIlegivel:
    'Confira o valor: escreva só números, por exemplo 50 ou 25,50 (até duas casas depois da vírgula).',
  aviso: 'Para continuar, é preciso ler e aceitar o aviso de privacidade.',
  campanha: 'Escolha uma campanha da lista ou doe sem campanha.',
} as const

// ------------------------------------------------------------------------------------------------ o que a API devolve

export interface CampanhaPublica {
  id_campanha: number
  titulo: string
  descricao: string | null
  meta_valor: number
  /** Só o que a tesouraria já registrou no sistema (a intenção, sozinha, nunca conta). */
  valor_arrecadado: number
  /**
   * v5.7g: o TOTAL já gasto no centro de custo da campanha, conforme os lançamentos da tesouraria. `null` = a campanha não tem centro de custo, então o gasto dela não é acompanhado à parte;
   * `undefined` = a API não manda este dado (API antiga): a página não fala dele, nunca inventa.
   */
  valor_aplicado?: number | null

  /** Inteiro, como o servidor calcula; pode passar de 100. */
  percentual: number
  /** "AAAA-MM-DD" (o dia do prazo ainda vale) ou nulo (sem prazo). */
  prazo: string | null
}

export interface DoacaoPublica {
  pix_disponivel: boolean
  chave_pix: string | null
  beneficiario: string | null
  cidade: string | null
  campanhas: CampanhaPublica[]
  /** A versão do aviso de privacidade que a API confere no pedido: a página manda a que leu daqui, nunca um número escrito no código. */
  versao_aviso_de_privacidade: string | null
  /** Quantos dias o pedido espera a conferência da tesouraria; ausente = a página não fala em prazo (nunca um número inventado). */
  dias_de_validade_do_pedido: number | null
}

/** O código Pix com os dados de quem recebe, como `GET /doacao/pix` e a resposta do pedido devolvem. */
export interface DadosDoPix {
  copia_e_cola: string
  chave_pix: string
  beneficiario: string
  cidade: string
  valor: number | null
  id_campanha: number | null
}

export interface RespostaDoPedido {
  /** Nulo = a armadilha de robô disparou: a API finge sucesso sem gravar nada. */
  protocolo: string | null
  pix: DadosDoPix | null
  expira_em: string | null
}

const objeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const textoNaoVazio = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== ''
const numeroFinito = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const DIA = /^\d{4}-\d{2}-\d{2}$/

function lerCampanha(bruta: unknown): CampanhaPublica | null {
  if (!objeto(bruta)) return null
  const { id_campanha, titulo, descricao, meta_valor, valor_arrecadado } = bruta
  if (typeof id_campanha !== 'number' || !Number.isInteger(id_campanha))
    return null
  if (!textoNaoVazio(titulo)) return null
  if (!numeroFinito(meta_valor) || meta_valor < 0) return null
  if (!numeroFinito(valor_arrecadado) || valor_arrecadado < 0) return null
  const percentual = bruta.percentual
  const prazo = bruta.prazo
  return {
    id_campanha,
    titulo: titulo.trim(),
    descricao: textoNaoVazio(descricao) ? descricao.trim() : null,
    meta_valor,
    valor_arrecadado,
    ...('valor_aplicado' in bruta
      ? {
          valor_aplicado:
            numeroFinito(bruta.valor_aplicado) && bruta.valor_aplicado >= 0
              ? bruta.valor_aplicado
              : null,
        }
      : {}),
    percentual:
      numeroFinito(percentual) && percentual >= 0
        ? Math.round(percentual)
        : meta_valor > 0
          ? Math.round((valor_arrecadado / meta_valor) * 100)
          : 0,
    prazo: typeof prazo === 'string' && DIA.test(prazo) ? prazo : null,
  }
}

/**
 * `GET /api/publico/doacao` já conferido: `null` = a resposta não tem a forma combinada (a página mostra "não consegui carregar", nunca um formulário pela metade).
 * Com o Pix indisponível só importa isso: a página não mostra campanha nem formulário. Campanha com dado quebrado é descartada, as outras ficam.
 */
export function lerDoacaoPublica(bruto: unknown): DoacaoPublica | null {
  if (!objeto(bruto) || typeof bruto.pix_disponivel !== 'boolean') return null
  if (!bruto.pix_disponivel) {
    return {
      pix_disponivel: false,
      chave_pix: null,
      beneficiario: null,
      cidade: null,
      campanhas: [],
      versao_aviso_de_privacidade: null,
      dias_de_validade_do_pedido: null,
    }
  }
  const { chave_pix, beneficiario, cidade, versao_aviso_de_privacidade } = bruto
  if (
    !textoNaoVazio(chave_pix) ||
    !textoNaoVazio(beneficiario) ||
    !textoNaoVazio(cidade) ||
    !textoNaoVazio(versao_aviso_de_privacidade) ||
    !Array.isArray(bruto.campanhas)
  )
    return null
  const dias = bruto.dias_de_validade_do_pedido
  return {
    pix_disponivel: true,
    chave_pix: chave_pix.trim(),
    beneficiario: beneficiario.trim(),
    cidade: cidade.trim(),
    campanhas: bruto.campanhas
      .map(lerCampanha)
      .filter((c): c is CampanhaPublica => c !== null),
    versao_aviso_de_privacidade: versao_aviso_de_privacidade.trim(),
    dias_de_validade_do_pedido:
      typeof dias === 'number' && Number.isInteger(dias) && dias >= 1
        ? dias
        : null,
  }
}

/**
 * Só as campanhas que ainda recebem: a API já manda só essas, e aqui se confere de novo com o MESMO critério dela — o dia do prazo ainda vale, contado em UTC como o servidor
 * conta (`prazo >= início do dia`). Assim a página nunca oferece uma campanha encerrada, nem depois de ficar aberta por dias.
 */
export function campanhasEmAndamento(
  campanhas: CampanhaPublica[],
  hoje: Date = new Date(),
): CampanhaPublica[] {
  const dia = hoje.toISOString().slice(0, 10)
  return campanhas.filter((c) => c.prazo === null || c.prazo >= dia)
}

/** O código Pix e os dados de quem recebe, já conferidos; `null` se faltar qualquer parte (um código incompleto nunca vai para a tela). */
export function lerDadosDoPix(bruto: unknown): DadosDoPix | null {
  if (!objeto(bruto)) return null
  const { copia_e_cola, chave_pix, beneficiario, cidade, valor, id_campanha } =
    bruto
  if (
    !textoNaoVazio(copia_e_cola) ||
    !textoNaoVazio(chave_pix) ||
    !textoNaoVazio(beneficiario) ||
    !textoNaoVazio(cidade)
  )
    return null
  return {
    copia_e_cola: copia_e_cola.trim(),
    chave_pix: chave_pix.trim(),
    beneficiario: beneficiario.trim(),
    cidade: cidade.trim(),
    valor: numeroFinito(valor) && valor > 0 ? valor : null,
    id_campanha:
      typeof id_campanha === 'number' && Number.isInteger(id_campanha)
        ? id_campanha
        : null,
  }
}

/**
 * A resposta do pedido identificado. `protocolo` nulo (armadilha de robô) devolve a tela de sucesso SEM número e SEM código: nada é mostrado que a API não deu.
 * Resposta com protocolo mas sem o código Pix inteiro é tratada como falha (a mensagem manda tentar de novo: o mesmo pedido devolve o mesmo protocolo).
 */
export function lerRespostaDoPedido(bruto: unknown): RespostaDoPedido {
  if (!objeto(bruto)) throw new ApiError('Resposta da API fora do formato.')
  if (bruto.protocolo === null || bruto.protocolo === undefined)
    return { protocolo: null, pix: null, expira_em: null }
  const pix = lerDadosDoPix(bruto)
  if (!textoNaoVazio(bruto.protocolo) || !pix)
    throw new ApiError('Resposta da API sem o protocolo ou sem o código Pix.')
  return {
    protocolo: bruto.protocolo.trim(),
    pix,
    expira_em: textoNaoVazio(bruto.expira_em) ? bruto.expira_em : null,
  }
}

// ------------------------------------------------------------------------------------------------ dinheiro, CPF e datas

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** 1234.5 -> "R$ 1.234,50" */
export function formatarReais(valor: number): string {
  return MOEDA.format(valor)
}

/** Onze números viram "390.533.447-05"; qualquer outra coisa fica como a pessoa escreveu (o aviso de erro mostra o que está errado). */
export function formatarCpf(texto: string): string {
  const d = somenteDigitos(texto)
  if (d.length !== 11) return texto
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

export type LeituraDoValor =
  { ok: true; valor: number | null } | { ok: false; erro: string }

/**
 * O valor como a pessoa escreve no Brasil: "50", "50,00", "25,5", "1.000", "1.000,50", "R$ 25,50". Em branco vale (o valor é opcional: quem deixa em branco digita no aplicativo do banco).
 * A vírgula separa os centavos; o ponto sozinho só vale como separador de milhar ("1.000") ou, com um ou dois dígitos depois dele, como centavos ("25.5"). Mais de duas casas, letras ou
 * sinal de menos são recusados — o valor nunca é "adivinhado". Mesmos limites do servidor: maior que zero e até 1.000.000.
 */
export function lerValorDigitado(texto: string): LeituraDoValor {
  const limpo = texto
    .replace(/^\s*R\$\s*/i, '')
    .replace(/\s+/g, '')
    .trim()
  if (limpo === '') return { ok: true, valor: null }
  let normalizado: string
  if (limpo.includes(',')) {
    // 1.000,50 -> 1000.50 (só vale se os pontos separam grupos de três dígitos)
    const [inteiro = '', centavos = '', resto] = limpo.split(',')
    if (resto !== undefined || !/^\d{1,3}(\.\d{3})*$|^\d+$/.test(inteiro))
      return { ok: false, erro: FRASES.valorIlegivel }
    normalizado = `${inteiro.replace(/\./g, '')}.${centavos}`
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    normalizado = limpo.replace(/\./g, '')
  } else {
    normalizado = limpo
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado))
    return { ok: false, erro: FRASES.valorIlegivel }
  const valor = Math.round(Number(normalizado) * 100) / 100
  if (valor <= 0) return { ok: false, erro: FRASES.valorZero }
  if (valor > VALOR_MAXIMO_DA_DOACAO)
    return { ok: false, erro: FRASES.valorAlto }
  return { ok: true, valor }
}

/** "Até 31/12/2026" ou "Sem prazo definido" (o dia do prazo ainda vale). */
export function frasePrazo(prazo: string | null): string {
  return prazo ? `Até ${formatarDataCurta(prazo)}` : 'Sem prazo definido'
}

/** "25% da meta" — e, passando de 100%, o aviso de que a meta já foi ultrapassada (o percentual SEMPRE aparece em texto, nunca só na barra). */
export function frasePercentual(c: CampanhaPublica): string {
  if (c.meta_valor <= 0) return 'Esta campanha não tem uma meta em dinheiro.'
  if (c.percentual > 100)
    return `${c.percentual}% da meta: a meta já foi ultrapassada.`
  if (c.percentual === 100) return '100% da meta: a meta foi alcançada.'
  return `${c.percentual}% da meta.`
}

/** O valor da barra de progresso: nunca passa do máximo (acima da meta a barra fica cheia; o número real está no texto). */
export function valorDaBarra(c: CampanhaPublica): number {
  return Math.min(c.valor_arrecadado, c.meta_valor)
}

/** "O pedido vale por 15 dias (até 30 de outubro de 2026)." — sem os dias, sem frase (nada inventado). */
export function fraseDeValidade(
  dias: number | null,
  expiraEm: string | null,
): string | null {
  if (dias === null) return null
  const quantos = dias === 1 ? '1 dia' : `${dias} dias`
  let ate = ''
  if (expiraEm) {
    try {
      ate = ` (até ${formatarDiaDeInstanteUtc(expiraEm)})`
    } catch {
      ate = ''
    }
  }
  return `O pedido vale por ${quantos}${ate}.`
}

// ------------------------------------------------------------------------------------------------ o formulário identificado

export interface ValoresDaDoacao {
  nome_completo: string
  email: string
  cpf: string
  /** O que foi digitado no campo de valor (texto; `lerValorDigitado` entende). */
  valor: string
  /** "" = para a associação, sem campanha; senão, o id da campanha escolhida. */
  id_campanha: string
  consentimento_lgpd: boolean
}

export type CampoDaDoacao = keyof ValoresDaDoacao
export type ErrosDaDoacao = Partial<Record<CampoDaDoacao, string>>

/** Os campos na ordem em que aparecem na página: é a ordem em que o foco procura o primeiro erro. */
export const CAMPOS_DA_DOACAO: readonly CampoDaDoacao[] = [
  'nome_completo',
  'email',
  'cpf',
  'id_campanha',
  'valor',
  'consentimento_lgpd',
]

/** Letras como a API conta (pontos de código, não unidades UTF-16). */
const tamanho = (texto: string) => [...texto].length
const normalizado = (texto: string) => texto.trim().replace(/\s+/g, ' ')

/** O id da campanha escolhida (`null` = sem campanha, ou um valor que não é número). */
export function idDaCampanha(escolha: string): number | null {
  return /^\d+$/.test(escolha.trim()) ? Number(escolha) : null
}

export function validarDoacao(
  v: ValoresDaDoacao,
  idsDasCampanhas: readonly number[],
): ErrosDaDoacao {
  const erros: ErrosDaDoacao = {}
  const nome = tamanho(normalizado(v.nome_completo))
  if (nome < NOME_MINIMO) erros.nome_completo = FRASES.nome
  else if (nome > NOME_MAXIMO) erros.nome_completo = FRASES.nomeGrande

  if (!EMAIL.test(v.email.trim())) erros.email = FRASES.email

  if (v.cpf.trim() !== '' && !cpfValido(v.cpf)) erros.cpf = FRASES.cpf

  const valor = lerValorDigitado(v.valor)
  if (!valor.ok) erros.valor = valor.erro

  if (v.id_campanha !== '') {
    const id = idDaCampanha(v.id_campanha)
    if (id === null || !idsDasCampanhas.includes(id))
      erros.id_campanha = FRASES.campanha
  }

  if (!v.consentimento_lgpd) erros.consentimento_lgpd = FRASES.aviso
  return erros
}

/**
 * O corpo que a API espera (`IntencaoDeDoacaoCriar`): CPF só com dígitos, valor como número, campanha como número; o que ficou em branco não vai. `versao` é a do aviso de
 * privacidade que a PÁGINA leu da API (`versao_aviso_de_privacidade`) e mostrou à pessoa — a API recusa se o texto mudou desde então.
 */
export function montarCorpoDaDoacao(
  v: ValoresDaDoacao,
  versao: string,
  armadilha = '',
): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    nome_completo: normalizado(v.nome_completo),
    email: v.email.trim(),
    consentimento_lgpd: v.consentimento_lgpd,
    versao_texto_consentimento: versao,
    pagina_web: armadilha,
  }
  const cpf = somenteDigitos(v.cpf)
  if (cpf) corpo.cpf = cpf
  const valor = lerValorDigitado(v.valor)
  if (valor.ok && valor.valor !== null) corpo.valor = valor.valor
  const campanha = idDaCampanha(v.id_campanha)
  if (campanha !== null) corpo.id_campanha = campanha
  return corpo
}

/** O texto que vai na consulta do código Pix sem identificação (`?valor=25.50`): sempre com duas casas, com ponto, como o servidor lê. */
export function valorParaConsulta(valor: number): string {
  return valor.toFixed(2)
}

// ------------------------------------------------------------------------------------------------ quando a API recusa

const CAMPOS_CONHECIDOS = new Set<string>(CAMPOS_DA_DOACAO)

export interface FalhaDoEnvio {
  /** O que a API apontou em cada campo (só os campos que a página tem). */
  porCampo: ErrosDaDoacao
  /** Uma frase para quem não tem campo para apontar (ou o que sobrou); nunca vazia quando `porCampo` está vazio. */
  geral: string | null
}

const FALE_COM_A_SECRETARIA = 'Se continuar, fale com a secretaria.'

/**
 * O que dizer quando o pedido identificado não foi aceito. Recusa de validação (422 em lista) aponta o campo; o resto (429, 503, aviso desatualizado, campanha encerrada,
 * erro de servidor, falta de rede) vira uma frase — a da API quando ela deu uma em português, ou uma nossa. O pedido pode repetir sem medo: o mesmo pedido mandado de novo em 24 horas
 * devolve o mesmo protocolo.
 */
export function falhaDoEnvio(erro: unknown): FalhaDoEnvio {
  if (erro instanceof ApiError && erro.erros && erro.erros.length > 0) {
    const porCampo: ErrosDaDoacao = {}
    const sobras: string[] = []
    for (const e of erro.erros) {
      if (CAMPOS_CONHECIDOS.has(e.campo) && !(e.campo in porCampo))
        porCampo[e.campo as CampoDaDoacao] = e.mensagem
      else sobras.push(e.mensagem)
    }
    return {
      porCampo,
      geral:
        Object.keys(porCampo).length === 0 || sobras.length > 0
          ? (sobras[0] ?? erro.detalhe ?? null)
          : null,
    }
  }
  if (erro instanceof ApiError && erro.status === 429)
    return {
      porCampo: {},
      geral: `${erro.detalhe ?? 'Muitos pedidos vieram deste endereço de internet.'} Se preferir, fale com a secretaria.`,
    }
  if (erro instanceof ApiError && erro.detalhe)
    return { porCampo: {}, geral: erro.detalhe }
  return {
    porCampo: {},
    geral: `Não foi possível enviar o seu pedido agora. Tente de novo em alguns instantes: se o pedido anterior tiver chegado, você recebe o mesmo protocolo. ${FALE_COM_A_SECRETARIA}`,
  }
}

/** O que dizer quando o código Pix (sem identificação) não veio: a frase da API (valor ou campanha recusados, Pix indisponível) ou uma nossa. */
export function falhaDoCodigo(erro: unknown): string {
  if (erro instanceof ApiError && erro.detalhe) return erro.detalhe
  return `Não foi possível gerar o código agora. Tente de novo em alguns instantes. ${FALE_COM_A_SECRETARIA}`
}
