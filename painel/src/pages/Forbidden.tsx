import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { mensagens } from '@/lib/i18n/pt-BR'

export function Forbidden() {
  const location = useLocation()
  const navigate = useNavigate()
  const permissao = (location.state as { permissao?: string } | null)?.permissao

  return (
    <>
      <h1 className="text-2xl font-bold">{mensagens.erros.acessoNegado}</h1>
      <p className="mt-2 text-muted-foreground">
        {mensagens.erros.acessoNegadoDescricao}
        {permissao
          ? ` (${mensagens.erros.permissaoNecessaria}: ${permissao})`
          : ''}
        . {mensagens.erros.procureAdmin}
      </p>
      <Button className="mt-6" onClick={() => navigate('/')}>
        {mensagens.comum.voltarInicio}
      </Button>
    </>
  )
}
