import { useEffect } from 'react'

import { associarRotulos } from '@/lib/rotulos'

export function AssociarRotulos() {
  useEffect(() => {
    associarRotulos()
    let agendado = false
    const observador = new MutationObserver(() => {
      if (agendado) return
      agendado = true
      queueMicrotask(() => {
        agendado = false
        associarRotulos()
      })
    })
    observador.observe(document.body, { childList: true, subtree: true })
    return () => observador.disconnect()
  }, [])
  return null
}
