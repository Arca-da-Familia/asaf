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

// Segunda rede de segurança: o campo que, mesmo depois de `associarRotulos`, continua sem nome (um `<select>` ao lado de um texto que não é `<label>`,
// um `<input type="date">` solto) ganha um `aria-label` — o da primeira opção do select quando ela é o convite ("Selecione a conta contábil…") ou o
// nome do campo por extenso. Rótulo de verdade, `aria-label`, `title` ou placeholder sempre valem mais e nunca são trocados.
export function nomeLegivelDoCampo(nome: string): string {
  const texto = nome
    .replace(/^id_/, '')
    .replace(/\[\d+\]/g, ' ')
    .replace(/[_.]+/g, ' ')
    .trim()
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : ''
}

type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const NOME_POR_TIPO: Record<string, string> = {
  file: 'Anexar arquivo',
  date: 'Data',
  month: 'Mês',
  'datetime-local': 'Data e hora',
  number: 'Número',
  checkbox: 'Opção',
  radio: 'Opção',
  search: 'Buscar',
  text: 'Texto',
}

const TIPOS_SEM_NOME = new Set(['hidden', 'submit', 'button', 'reset', 'image'])

function temNome(campo: Campo): boolean {
  if (campo.getAttribute('aria-label')?.trim()) return true
  if (campo.getAttribute('aria-labelledby')) return true
  if (campo.getAttribute('title')?.trim()) return true
  if (
    campo instanceof HTMLInputElement ||
    campo instanceof HTMLTextAreaElement
  ) {
    if (campo.placeholder?.trim()) return true
  }
  return Array.from(campo.labels ?? []).some((l) => l.textContent?.trim())
}

export function nomearCamposSemRotulo(raiz: HTMLElement): void {
  raiz.querySelectorAll<Campo>('input, select, textarea').forEach((campo) => {
    if (campo instanceof HTMLInputElement && TIPOS_SEM_NOME.has(campo.type))
      return
    if (temNome(campo)) return
    let nome = ''
    if (campo instanceof HTMLSelectElement) {
      const primeira = campo.options[0]
      if (primeira && primeira.value === '') {
        nome = (primeira.textContent ?? '').replace(/[….\s]+$/, '').trim()
      }
    }
    if (!nome) nome = nomeLegivelDoCampo(campo.name || campo.id)
    // campo sem `name` nem `id` (um anexo, um filtro solto): o nome vem do tipo
    if (!nome && campo instanceof HTMLInputElement) {
      nome = NOME_POR_TIPO[campo.type] ?? 'Campo'
    }
    if (!nome) nome = 'Campo'
    if (nome) campo.setAttribute('aria-label', nome)
  })
}
