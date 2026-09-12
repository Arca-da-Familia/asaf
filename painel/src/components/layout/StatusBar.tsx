import { useSyncExternalStore } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { mensagens } from '@/lib/i18n/pt-BR'
import { inscrever, obterEstado } from '@/lib/network-status'

type StatusBarProps = {
  novaVersaoDisponivel: boolean
  recarregar: () => void
}

// v0.2.7 — faixa fixa logo abaixo do header: nunca deixa o usuário achando que o painel
// "quebrou" quando na verdade é o Container App acordando de scale-to-zero, ou a rede caiu, ou
// simplesmente saiu um deploy novo enquanto a aba estava aberta. `commitAtual`/`novaVersaoDisponivel`
// vêm do Shell (que já chama `useVersaoBuild` para o rodapé) para não duplicar o polling.
export function StatusBar({ novaVersaoDisponivel, recarregar }: StatusBarProps) {
  const estadoRede = useSyncExternalStore(inscrever, obterEstado)

  if (estadoRede === 'offline') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
      >
        <WifiOff className="h-4 w-4 shrink-0" />
        {mensagens.rede.semConexao}
      </div>
    )
  }

  if (estadoRede === 'acordando') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400"
      >
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
        {mensagens.rede.acordandoServidor}
      </div>
    )
  }

  if (novaVersaoDisponivel) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 border-b border-border bg-accent px-4 py-2 text-sm text-accent-foreground"
      >
        <span>{mensagens.rede.novaVersaoDisponivel}</span>
        <Button size="sm" variant="outline" onClick={recarregar}>
          {mensagens.rede.recarregar}
        </Button>
      </div>
    )
  }

  return null
}
