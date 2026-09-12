import { useEffect, useRef, useState } from 'react'

// v0.2.7 — compara o build que está rodando na aba contra o que o servidor está servindo
// agora (public/version.json, gerado a cada build por scripts/gerar-version.js). Detecta
// deploy novo sem exigir que o usuário recarregue "no escuro" e fique preso num bundle velho
// chamando uma API que já mudou de contrato. Também expõe o commit atual para o rodapé.
const INTERVALO_CHECAGEM_MS = 5 * 60_000

type VersionInfo = { commit: string; buildEm: string }

async function buscarVersao(): Promise<VersionInfo | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as VersionInfo
  } catch {
    return null
  }
}

export function useVersaoBuild() {
  const [commitAtual, setCommitAtual] = useState<string | null>(null)
  const [novaVersaoDisponivel, setNovaVersaoDisponivel] = useState(false)
  const versaoCarregada = useRef<string | null>(null)

  useEffect(() => {
    let ativo = true

    async function checar() {
      const atual = await buscarVersao()
      if (!ativo || !atual) return
      if (versaoCarregada.current === null) {
        versaoCarregada.current = atual.commit
        setCommitAtual(atual.commit)
        return
      }
      if (atual.commit !== versaoCarregada.current) {
        setNovaVersaoDisponivel(true)
      }
    }

    checar()
    const intervalo = setInterval(checar, INTERVALO_CHECAGEM_MS)
    return () => {
      ativo = false
      clearInterval(intervalo)
    }
  }, [])

  return {
    commitAtual,
    novaVersaoDisponivel,
    recarregar: () => window.location.reload(),
  }
}
