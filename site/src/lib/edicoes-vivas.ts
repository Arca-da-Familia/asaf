import { jaAconteceu } from './datas'
import { aindaVaiAcontecer, statusDoEvento } from './situacao-do-evento'

/**
 * Ilha das EDIÇÕES (v5.5). A página é gerada no build e o build não sabe que dia é quando alguém a abre meses depois.
 * Duas coisas dependem de "hoje" e são conferidas aqui, no navegador, a cada visita:
 *
 *  1. a lista "Edições e eventos" mostra "Já realizado" nas edições cuja data passou;
 *  2. a Home mostra só o PRÓXIMO evento de verdade: o build deixa prontos os próximos (nenhum passado fica na tela) e
 *     aqui some quem já terminou — sem isto a Home anunciaria, por semanas, um "próximo evento" que já aconteceu.
 *
 * v5.5d: a situação do evento (`data-status-do-evento`) manda mais que o relógio. Edição cancelada, adiada ou realizada já traz o selo escrito e NUNCA ganha
 * "Já realizado" (cancelada e adiada não aconteceram); a adiada não "passa" com a data (ela não tem data nova) e continua sendo anunciada.
 *
 * Sem JavaScript a página fica como foi construída: a data de cada item está sempre escrita, mas o "Já realizado" não
 * aparece e o "Próximo evento" pode ser um que já passou (até o próximo build, quando o conteúdo mudar). SEGURANÇA: só
 * atributos `hidden`; nada vira HTML.
 */

/** Mostra "Já realizado" nos itens `[data-edicao][data-fim]` cuja data de fim já passou (só os programados: os demais têm o selo da situação). */
export function marcarEdicoesRealizadas(
  raiz: ParentNode = document,
  agora: Date = new Date(),
): void {
  raiz
    .querySelectorAll<HTMLElement>('[data-edicao][data-fim]')
    .forEach((item) => {
      if (statusDoEvento(item.dataset.statusDoEvento) !== 'Programado') return
      if (!jaAconteceu(item.dataset.fim ?? '', agora)) return
      item
        .querySelector<HTMLElement>('[data-realizado]')
        ?.removeAttribute('hidden')
    })
}

/**
 * Em cada `[data-proximas-edicoes]` deixa visível só a primeira edição (`[data-proxima-edicao][data-fim]`) que ainda
 * não terminou; se todas já passaram, esconde o bloco inteiro.
 */
export function mostrarSoAProximaEdicao(
  raiz: ParentNode = document,
  agora: Date = new Date(),
): void {
  raiz
    .querySelectorAll<HTMLElement>('[data-proximas-edicoes]')
    .forEach((bloco) => {
      const itens = [
        ...bloco.querySelectorAll<HTMLElement>(
          '[data-proxima-edicao][data-fim]',
        ),
      ]
      const primeira = itens.find((item) =>
        aindaVaiAcontecer(
          statusDoEvento(item.dataset.statusDoEvento),
          jaAconteceu(item.dataset.fim ?? '', agora),
        ),
      )
      itens.forEach((item) => {
        item.hidden = item !== primeira
      })
      bloco.hidden = primeira === undefined
    })
}
