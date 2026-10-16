import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { obterReciboDoacao } from '@/lib/api'
import { mensagemDoErro } from '@/lib/erro-da-api'

// Mostra o texto do recibo numerado de uma doação (v3.4). `paraQuem` (v5.6a) dá ao botão um nome próprio para quem usa leitor de tela, quando a tela
// repete o botão em várias linhas.
export function BotaoRecibo({
  idDoacao,
  paraQuem,
}: {
  idDoacao: number
  paraQuem?: string
}) {
  const [texto, setTexto] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const recibo = useMutation({
    mutationFn: () => obterReciboDoacao(idDoacao),
    onSuccess: (resultado) => {
      setErro(null)
      setTexto(resultado.texto)
    },
    onError: (e) =>
      setErro(
        mensagemDoErro(e, 'Não foi possível abrir o recibo. Tente de novo.'),
      ),
  })
  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        disabled={recibo.isPending}
        onClick={() => recibo.mutate()}
      >
        Ver recibo
        {paraQuem && (
          <>
            {' '}
            <span className="sr-only">de {paraQuem}</span>
          </>
        )}
      </Button>
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
      {texto && (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-xs">
          {texto}
        </pre>
      )}
    </div>
  )
}
