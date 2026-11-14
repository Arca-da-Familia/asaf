import { cn } from '@/lib/utils'

// v9.5d (desenho aprovado pelo Presidente, rodadas 2 e 4): a situação do associado em cor - em dia verde, inadimplente na cor de atraso (vermelho só para
// atraso e erro, pedido dele), suspenso em ouro, em experiência em azul, licenciado e desligado em cinza. Os pares de texto e fundo estão no teste de
// contraste (src/test/tokens-contraste.test.ts).
const CORES: Record<string, string> = {
  'Ativo - Em Dia': 'bg-verde-tinta text-verde-texto',
  'Ativo - Inadimplente': 'bg-perigo-tinta text-destructive',
  'Suspenso (Estatuto)': 'bg-ouro-tinta text-ouro-texto',
  'Em Experiência': 'bg-azul-tinta text-azul-texto',
}

export function SituacaoChip({ situacao }: { situacao: string | null }) {
  if (!situacao) return null
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold',
        CORES[situacao] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {situacao}
    </span>
  )
}

// as iniciais da pessoa num círculo (a foto entra quando a lista trouxer o endereço dela)
export function IniciaisDaPessoa({ nome }: { nome: string }) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const iniciais =
    (partes[0]?.[0] ?? '') + (partes.length > 1 ? partes.at(-1)![0] : '')
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-azul-tinta text-xs font-extrabold text-azul-texto uppercase"
    >
      {iniciais}
    </span>
  )
}
