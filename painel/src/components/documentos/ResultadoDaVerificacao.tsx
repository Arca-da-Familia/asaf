import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

import type { ResultadoDaVerificacao as Resultado } from '@/lib/documentos'

// v5.4a - o que o verificador achou na VERSÃO PÚBLICA. O servidor só devolve amostra MASCARADA do dado pessoal
// (111.***.***-35): esta tela nunca tem o dado inteiro para mostrar.
export function ResultadoDaVerificacao({
  resultado,
}: {
  resultado: Resultado
}) {
  const recusado = resultado.bloqueios.length > 0
  return (
    <section
      aria-label="Resultado da conferência da versão pública"
      className="space-y-3 rounded-md border border-border p-4 text-sm"
    >
      <p
        className={
          recusado
            ? 'flex items-center gap-2 font-semibold text-destructive'
            : 'flex items-center gap-2 font-semibold text-green-700'
        }
      >
        {recusado ? (
          <XCircle aria-hidden="true" className="h-5 w-5" />
        ) : (
          <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
        )}
        {recusado
          ? 'Não pode ir ao site do jeito que está'
          : 'Passou na conferência automática'}
      </p>
      <p className="text-muted-foreground">
        {resultado.paginas} página(s), {resultado.caracteres} caracteres de
        texto pesquisável.
      </p>

      {recusado && (
        <div>
          <h3 className="font-medium">O que precisa ser corrigido</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {resultado.bloqueios.map((a, i) => (
              <li key={`${a.codigo}-${i}`}>
                {a.mensagem}
                {a.pagina ? ` (página ${a.pagina})` : ''}
                {a.amostra ? (
                  <>
                    {' '}
                    — encontrado:{' '}
                    <code className="rounded bg-muted px-1">{a.amostra}</code>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">
            Cubra os dados de verdade (apague o texto, não só desenhe uma tarja
            por cima: o texto continua no arquivo) e envie de novo.
          </p>
        </div>
      )}

      {resultado.avisos.length > 0 && (
        <div>
          <h3 className="flex items-center gap-1 font-medium text-amber-800">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            Para quem aprova ler com atenção
          </h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            {resultado.avisos.map((a, i) => (
              <li key={`${a.codigo}-${i}`}>
                {a.mensagem}
                {a.pagina ? ` (página ${a.pagina})` : ''}
                {a.amostra ? ` — ${a.amostra}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
