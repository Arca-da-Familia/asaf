import { CircleHelp } from 'lucide-react'
import { useId, useState } from 'react'
import { useInRouterContext, useLocation } from 'react-router'

import { ajudaDaTela } from '@/lib/ajuda'

/**
 * v9.3 — "Como usar esta tela": um botão discreto abaixo do título. O texto só existe na página depois do clique (fechado, não há nada escondido que
 * confunda quem procura um botão pelo nome). Tela sem texto em `lib/ajuda.ts` não mostra o botão.
 */
export function AjudaDaTela() {
  // fora de um roteador (alguns testes desenham só o cabeçalho) não há endereço: não há ajuda
  return useInRouterContext() ? <AjudaPelaRota /> : null
}

function AjudaPelaRota() {
  const { pathname } = useLocation()
  const ajuda = ajudaDaTela(pathname)
  const [aberta, setAberta] = useState(false)
  const id = useId()
  if (!ajuda) return null
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={aberta ? id : undefined}
        onClick={() => setAberta((v) => !v)}
        className="inline-flex min-h-6 items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <CircleHelp className="h-4 w-4" aria-hidden="true" />
        {aberta ? 'Fechar a ajuda' : 'Como usar esta tela'}
      </button>
      {aberta && (
        <div
          id={id}
          role="region"
          aria-label="Como usar esta tela"
          className="mt-2 max-w-3xl rounded-lg border border-border bg-muted/40 p-4 text-sm"
        >
          <p>{ajuda.paraQue}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {ajuda.passos.map((passo) => (
              <li key={passo}>{passo}</li>
            ))}
          </ol>
          {ajuda.atencao && (
            <p className="mt-2 text-muted-foreground">
              <strong className="text-foreground">Atenção:</strong>{' '}
              {ajuda.atencao}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
