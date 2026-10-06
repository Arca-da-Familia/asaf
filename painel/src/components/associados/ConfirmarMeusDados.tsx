import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { confirmarMeusDados } from '@/lib/api'
import { formatarData } from '@/lib/datas'

// v1.8 no servidor (recadastramento periódico), tela só na v5.4c (achado AO VIVO na homologação, 2026-10-05): o associado não tinha
// onde dizer "meus dados continuam corretos", então todo cadastro ficaria para sempre com "Recadastramento pendente".
export function ConfirmarMeusDados() {
  const queryClient = useQueryClient()
  const [confirmado, setConfirmado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const confirmar = useMutation({
    mutationFn: confirmarMeusDados,
    onSuccess: (r) => {
      setErro(null)
      setConfirmado(r.data_ultima_confirmacao)
      queryClient.invalidateQueries({ queryKey: ['perfil'] })
      queryClient.invalidateQueries({ queryKey: ['ficha360'] })
    },
    onError: (e) =>
      setErro(e instanceof Error ? e.message : 'Não foi possível confirmar.'),
  })

  return (
    <section
      className="mt-6 rounded-lg border border-border p-4"
      aria-label="Recadastramento"
    >
      <h3 className="font-semibold">Seus dados continuam corretos?</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Se nada mudou, basta confirmar: a associação registra a data de hoje
        como a do seu recadastramento, sem alterar nenhum dado.
      </p>
      <Button
        className="mt-3"
        variant="outline"
        disabled={confirmar.isPending}
        onClick={() => confirmar.mutate()}
      >
        Confirmo que meus dados estão corretos
      </Button>
      {confirmado && (
        <p
          role="status"
          className="mt-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
        >
          Dados confirmados em {formatarData(confirmado)}.
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}
    </section>
  )
}
