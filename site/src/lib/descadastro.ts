import { ApiError, buscarJson, enviarJson } from './api'

/**
 * A página `/descadastrar/` (v6.2b): os e-mails da ASAF que a pessoa pode desligar (avisos que não são obrigatórios, lembretes de mensalidade, avisos de evento)
 * levam a ela com `?token=<link assinado>`. A página lê o token NO NAVEGADOR (é estática), consulta `GET /api/publico/descadastro?token=` (o tipo de e-mail e se
 * a pessoa recebe; nada que identifique a pessoa) e, só quando a pessoa clica, chama `POST /api/publico/descadastro` para parar ou voltar a receber.
 *
 * SEGURANÇA: só `textContent` e atributos — nada vindo da API entra como HTML. O token nunca vai para o caminho da página, só para a query.
 */

/** O token é `<número>.<tipo>.<assinatura>`; qualquer outra coisa no endereço nem chega à API. */
const TOKEN_VALIDO = /^\d{1,12}\.[a-z_]{1,40}\.[0-9a-f]{32}$/

export const MENSAGEM_SEM_TOKEN =
  'Para escolher os e-mails que você recebe, use o link que vem no fim do próprio e-mail da ASAF.'
export const MENSAGEM_DE_LINK_INVALIDO =
  'Este link não é válido ou está incompleto. Confira se copiou o endereço inteiro do e-mail.'
export const MENSAGEM_DE_FALHA =
  'Não foi possível falar com o sistema da ASAF agora. Tente de novo em alguns minutos.'

export type LeituraDoToken =
  | { estado: 'ausente' }
  | { estado: 'invalido' }
  | { estado: 'ok'; token: string }

export function lerToken(busca: string): LeituraDoToken {
  const bruto = new URLSearchParams(busca).get('token')
  if (bruto === null || bruto.trim() === '') return { estado: 'ausente' }
  const token = bruto.trim()
  return TOKEN_VALIDO.test(token)
    ? { estado: 'ok', token }
    : { estado: 'invalido' }
}

/** O que a API devolve (app/services/preferencias_de_comunicacao.py::resumo_publico). */
export interface SituacaoDoDescadastro {
  tipo: string
  rotulo: string
  recebe: boolean
}

/** A frase do estado atual. */
export function fraseDaSituacao(s: SituacaoDoDescadastro): string {
  return s.recebe
    ? `Você recebe este tipo de e-mail da ASAF: ${s.rotulo}.`
    : `Você NÃO recebe mais este tipo de e-mail da ASAF: ${s.rotulo}.`
}

/** A frase depois de clicar. */
export function fraseDoResultado(s: SituacaoDoDescadastro): string {
  return s.recebe
    ? 'Pronto: você voltará a receber este tipo de e-mail.'
    : 'Pronto: você não receberá mais este tipo de e-mail. Se mudar de ideia, use o botão acima (ou o Meu Perfil, se você tem acesso ao painel).'
}

type Estado = 'carregando' | 'sem-token' | 'invalido' | 'erro' | 'ok'

function mostrarEstado(raiz: HTMLElement, estado: Estado): void {
  raiz.querySelectorAll<HTMLElement>('[data-estado]').forEach((bloco) => {
    bloco.hidden = bloco.dataset.estado !== estado
  })
}

function campo(raiz: HTMLElement, seletor: string): HTMLElement | null {
  return raiz.querySelector<HTMLElement>(seletor)
}

export interface OpcoesDaPagina {
  busca?: string
  fetchImpl?: typeof fetch
}

export function iniciarPaginaDeDescadastro(
  raiz: HTMLElement,
  opcoes: OpcoesDaPagina = {},
): void {
  const baseUrl = raiz.dataset.apiUrl ?? ''
  const leitura = lerToken(opcoes.busca ?? window.location.search)
  if (leitura.estado === 'ausente') return mostrarEstado(raiz, 'sem-token')
  if (leitura.estado === 'invalido') return mostrarEstado(raiz, 'invalido')
  const { token } = leitura
  const situacao = campo(raiz, '[data-situacao]')
  const resultado = campo(raiz, '[data-resultado]')
  const falha = campo(raiz, '[data-falha]')
  const parar = campo(raiz, '[data-parar]') as HTMLButtonElement | null
  const voltar = campo(
    raiz,
    '[data-voltar-a-receber]',
  ) as HTMLButtonElement | null

  function desenhar(s: SituacaoDoDescadastro) {
    if (situacao) situacao.textContent = fraseDaSituacao(s)
    if (parar) parar.hidden = !s.recebe
    if (voltar) voltar.hidden = s.recebe
  }

  async function mudar(recebe: boolean) {
    if (falha) falha.hidden = true
    for (const b of [parar, voltar]) if (b) b.disabled = true
    try {
      const novo = await enviarJson<SituacaoDoDescadastro>(
        '/api/publico/descadastro',
        { token, recebe },
        { baseUrl, fetchImpl: opcoes.fetchImpl },
      )
      desenhar(novo)
      if (resultado) {
        resultado.textContent = fraseDoResultado(novo)
        resultado.hidden = false
      }
    } catch (erro) {
      if (falha) {
        falha.textContent =
          erro instanceof ApiError && erro.status === 404
            ? MENSAGEM_DE_LINK_INVALIDO
            : erro instanceof ApiError && erro.status === 429
              ? 'Muitas tentativas seguidas: espere alguns minutos e tente de novo.'
              : MENSAGEM_DE_FALHA
        falha.hidden = false
      }
    } finally {
      for (const b of [parar, voltar]) if (b) b.disabled = false
    }
  }

  parar?.addEventListener('click', () => void mudar(false))
  voltar?.addEventListener('click', () => void mudar(true))

  buscarJson<SituacaoDoDescadastro>(
    `/api/publico/descadastro?token=${encodeURIComponent(token)}`,
    { baseUrl, tentativas: 3, fetchImpl: opcoes.fetchImpl },
  )
    .then((s) => {
      desenhar(s)
      mostrarEstado(raiz, 'ok')
    })
    .catch((erro) => {
      if (erro instanceof ApiError && erro.status === 429) {
        const bloco = campo(raiz, '[data-estado="erro"] p')
        if (bloco)
          bloco.textContent =
            'Muitas tentativas seguidas: espere alguns minutos e abra o link de novo.'
      }
      mostrarEstado(
        raiz,
        erro instanceof ApiError && erro.status === 404 ? 'invalido' : 'erro',
      )
    })
}
