import { useEffect } from 'react'

import { associarRotulos, nomearCamposSemRotulo } from '@/lib/rotulos'

export function AssociarRotulos() {
  useEffect(() => {
    associarRotulos()
    nomearCamposSemRotulo(document.body)
    let agendado = false
    const observador = new MutationObserver(() => {
      if (agendado) return
      agendado = true
      queueMicrotask(() => {
        agendado = false
        associarRotulos()
        nomearCamposSemRotulo(document.body)
      })
    })
    observador.observe(document.body, { childList: true, subtree: true })
    return () => observador.disconnect()
  }, [])
  return null
}
