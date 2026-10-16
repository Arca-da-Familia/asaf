import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useRef, type ReactNode } from 'react'

type DialogoDeFormularioProps = {
  titulo: string
  descricao: ReactNode
  onFechar: () => void
  // Enquanto uma ação está em andamento o diálogo não fecha (nem com Esc): o resultado dela não pode se perder.
  bloqueado?: boolean
  // Para onde o foco vai quando o diálogo fecha. O Radix só devolve o foco a um botão `Trigger`, e aqui quem abre é o chamador: sem isto o foco
  // se perderia no corpo da página. Sem resposta (`null`), o foco fica onde o navegador o puser.
  devolverFoco?: () => HTMLElement | null
  children: ReactNode
}

// Diálogo com formulário dentro (v5.6a). O `ConfirmDialog` serve para "tem certeza?" com um botão nomeado; quando a confirmação precisa de campos
// (valor, contas, observação), este é o irmão dele: mesma base (Radix AlertDialog: prende o foco, Esc fecha, o resto da
// tela fica inacessível enquanto aberto) e, como lá, clicar fora NÃO fecha (não se perde o que foi digitado). O chamador só o desenha enquanto
// estiver aberto e diz para onde o foco volta ao fechar (`devolverFoco`). O primeiro campo leva `autoFocus`.
export function DialogoDeFormulario({
  titulo,
  descricao,
  onFechar,
  bloqueado = false,
  devolverFoco,
  children,
}: DialogoDeFormularioProps) {
  const conteudo = useRef<HTMLDivElement>(null)
  return (
    <AlertDialog.Root
      open
      onOpenChange={(aberto) => {
        if (!aberto && !bloqueado) onFechar()
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          ref={conteudo}
          onOpenAutoFocus={(evento) => {
            // Quem desenha o diálogo põe `autoFocus` no primeiro campo (que pode só aparecer depois de carregar as opções). Se nenhum campo
            // tomou o foco ainda, ele vai para o próprio diálogo: nunca fica fora dele.
            evento.preventDefault()
            const dialogo = conteudo.current
            if (dialogo && !dialogo.contains(document.activeElement))
              dialogo.focus()
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault()
            devolverFoco?.()?.focus()
          }}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg"
        >
          <AlertDialog.Title className="text-lg font-semibold">
            {titulo}
          </AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2 space-y-2 text-sm text-muted-foreground">
              {descricao}
            </div>
          </AlertDialog.Description>
          <div className="mt-4">{children}</div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
