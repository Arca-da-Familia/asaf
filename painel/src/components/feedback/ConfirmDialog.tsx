import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type ConfirmDialogProps = {
  aberto: boolean
  onAbertoChange: (aberto: boolean) => void
  titulo: string
  descricao: ReactNode
  // Rótulo nomeado da ação destrutiva — ex.: "Excluir associado", nunca um "OK" genérico.
  rotuloConfirmar: string
  onConfirmar: () => void
  carregando?: boolean
}

// Confirmação de ação destrutiva (v0.2.4): sempre exige uma confirmação explícita e nomeada.
// O fechamento é controlado pelo chamador (onAbertoChange), então funciona com ação assíncrona.
export function ConfirmDialog({
  aberto,
  onAbertoChange,
  titulo,
  descricao,
  rotuloConfirmar,
  onConfirmar,
  carregando = false,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={aberto} onOpenChange={onAbertoChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg">
          <AlertDialog.Title className="text-lg font-semibold">
            {titulo}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
            {descricao}
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={carregando}
              onClick={() => onAbertoChange(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirmar}
              disabled={carregando}
            >
              {carregando && <Loader2 className="h-4 w-4 animate-spin" />}
              {rotuloConfirmar}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
