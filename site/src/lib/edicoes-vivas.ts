import { jaAconteceu } from './datas'

/**
 * Ilha das EDIÇÕES (v5.5). A página é gerada no build e o build não sabe que dia é quando alguém a abre meses depois.
 * Duas coisas dependem de "hoje" e são conferidas aqui, no navegador, a cada visita:
 *
 *  1. a lista "Edições e eventos" mostra "Já realizado" nas edições cuja data passou;
 *  2. a Home mostra só a PRÓXIMA edição de verdade: o build deixa prontas as próximas (nenhuma passada fica na tela) e
 *     aqui some quem já terminou — sem isto a Home anunciaria, por semanas, uma "próxima edição" que já aconteceu.
 *
 * Sem JavaScript a página continua correta como foi construída. SEGURANÇA: só atributos `hidden`; nada vira HTML.
 */

/** Mostra "Já realizado" nos itens `[data-edicao][data-fim]` cuja data de fim já passou. */
export function marcarEdicoesRealizadas(
  raiz: ParentNode = document,
  agora: Date = new Date(),
): void {
  raiz
    .querySelectorAll<HTMLElement>('[data-edicao][data-fim]')
    .forEach((item) => {
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
      const primeira = itens.find(
        (item) => !jaAconteceu(item.dataset.fim ?? '', agora),
      )
      itens.forEach((item) => {
        item.hidden = item !== primeira
      })
      bloco.hidden = primeira === undefined
    })
}
