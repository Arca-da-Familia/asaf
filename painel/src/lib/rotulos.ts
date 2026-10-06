// Liga rótulo solto ao campo (rede de segurança de acessibilidade). Ver components/acessibilidade/AssociarRotulos.tsx.

// Campo de formulário que um <label> pode nomear (campo escondido não conta).
const CONTROLES = 'input:not([type="hidden"]), select, textarea'

let contador = 0

/**
 * Liga cada <label> solto ao campo que vem logo depois dele (a convenção do painel: `<label>Nome</label><input />`, sem `htmlFor`).
 * Sem a ligação, o leitor de tela lê o campo sem nome e clicar no rótulo não leva ao campo (WCAG 1.3.1, 3.3.2 e 4.1.2).
 *
 * Achado AO VIVO na homologação (v5.4d, 2026-10-06): 183 rótulos em 37 telas estavam soltos. Esta é a REDE DE SEGURANÇA central (vale
 * também para lista, onde um `id` fixo se repetiria); telas e componentes novos devem usar `htmlFor`/`id` de verdade. Idempotente: não mexe em
 * rótulo que já tem `for`, que envolve o campo, nem em campo que já tem rótulo.
 */
export function associarRotulos(raiz: ParentNode = document): number {
  let ligados = 0
  raiz
    .querySelectorAll<HTMLLabelElement>('label:not([for])')
    .forEach((rotulo) => {
      if (rotulo.querySelector(CONTROLES)) return // o rótulo já envolve o campo
      const vizinho = rotulo.nextElementSibling
      if (!vizinho) return
      let controle: Element | null = null
      if (vizinho.matches(CONTROLES)) {
        controle = vizinho
      } else if (!vizinho.matches('label') && !vizinho.querySelector('label')) {
        // o campo vem dentro de um invólucro logo depois do rótulo, e só há UM campo nele
        const campos = vizinho.querySelectorAll(CONTROLES)
        if (campos.length === 1) controle = campos[0] ?? null
      }
      if (!controle) return
      const campo = controle as HTMLInputElement
      if (campo.labels && campo.labels.length > 0) return // já tem rótulo
      if (!campo.id) {
        contador += 1
        campo.id = `rotulo-auto-${contador}`
      }
      rotulo.htmlFor = campo.id
      ligados += 1
    })
  return ligados
}
