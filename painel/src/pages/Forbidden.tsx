import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export function Forbidden() {
  const location = useLocation()
  const navigate = useNavigate()
  const permissao = (location.state as { permissao?: string } | null)?.permissao

  return (
    <>
      <h1 className="text-2xl font-bold">Acesso negado</h1>
      <p className="mt-2 text-muted-foreground">
        Você não tem permissão para acessar esta área
        {permissao ? ` (permissão necessária: ${permissao})` : ''}. Se acredita
        que isso é um erro, procure um administrador.
      </p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        Voltar ao início
      </Button>
    </>
  )
}
