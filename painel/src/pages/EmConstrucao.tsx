export function EmConstrucao({ modulo }: { modulo: string }) {
  return (
    <>
      <h1 className="text-2xl font-bold">{modulo}</h1>
      <p className="mt-2 text-muted-foreground">
        A navegação e a guarda de permissão já estão funcionando. O conteúdo de
        negócio deste módulo entra nas fases seguintes do plano (a partir da
        FASE 1).
      </p>
    </>
  )
}
