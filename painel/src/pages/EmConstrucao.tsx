import { mensagens } from '@/lib/i18n/pt-BR'

export function EmConstrucao({ modulo }: { modulo: string }) {
  return (
    <>
      <h1 className="text-2xl font-bold">{modulo}</h1>
      <p className="mt-2 text-muted-foreground">{mensagens.emConstrucao}</p>
    </>
  )
}
