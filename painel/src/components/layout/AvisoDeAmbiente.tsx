import { useEffect } from 'react'
import { FlaskConical } from 'lucide-react'

import { ehHomologacao, TEXTO_DO_AMBIENTE_DE_TESTE } from '@/lib/ambiente'

// Faixa fixa no ambiente de TESTE (homologação): quem abre o painel de teste nunca deve achar que está no sistema de verdade.
// No painel de produção (sem VITE_AMBIENTE) não renderiza nada e não mexe no título nem nos mecanismos de busca.
export function AvisoDeAmbiente({
  ativo = ehHomologacao(),
}: {
  ativo?: boolean
}) {
  useEffect(() => {
    if (!ativo) return
    const tituloOriginal = document.title
    if (!tituloOriginal.startsWith('[TESTE]'))
      document.title = `[TESTE] ${tituloOriginal}`
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => {
      document.title = tituloOriginal
      meta.remove()
    }
  }, [ativo])

  if (!ativo) return null
  return (
    <div
      role="status"
      data-ambiente="homologacao"
      className="flex items-center gap-2 border-b border-amber-600/40 bg-amber-300 px-4 py-2 text-sm font-semibold text-black"
    >
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
      {TEXTO_DO_AMBIENTE_DE_TESTE}
    </div>
  )
}
