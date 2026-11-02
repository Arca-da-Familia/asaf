import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router'

import { formatarData } from '@/lib/datas'
import { obterMeuTreinamento } from '@/lib/privacidade'

export const ROTA_DO_TREINAMENTO = '/treinamento-de-privacidade'

// v7.5a - o aviso do treinamento de privacidade pendente, no alto de todas as telas, para quem tem acesso a dado de outras pessoas (decisão do Presidente,
// 2026-11-02: sem bloqueio, só o aviso). Quem não precisa, ou se o servidor não responder, não vê nada.
export function AvisoDoTreinamento() {
  const { pathname } = useLocation()
  const { data } = useQuery({
    queryKey: ['meu-treinamento-de-privacidade'],
    queryFn: obterMeuTreinamento,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const s = data?.situacao
  if (!s?.pendente || pathname === ROTA_DO_TREINAMENTO) return null
  return (
    <div
      role="status"
      data-testid="aviso-do-treinamento"
      className={`border-b px-6 py-2 text-sm ${s.atrasado ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-amber-600/30 bg-amber-600/10'}`}
    >
      {s.atrasado
        ? 'O seu treinamento de privacidade está atrasado'
        : 'Falta o seu treinamento de privacidade'}
      {s.fazer_ate && !s.atrasado && ` (faça até ${formatarData(s.fazer_ate)})`}
      {'. '}
      <Link to={ROTA_DO_TREINAMENTO} className="font-medium underline">
        Fazer agora (uns 10 minutos)
      </Link>
    </div>
  )
}
