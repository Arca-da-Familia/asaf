import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { lerAvisoDeUmaVersao } from '@/lib/privacidade'

// v7.1a - reabre o aviso de privacidade que a pessoa leu ao entregar o dado: o texto EXATO daquela versão, como está gravado (não o de hoje).
export function LerAviso({ ponto, versao }: { ponto: string; versao: string }) {
  const [aberto, setAberto] = useState(false)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['aviso-de-privacidade', ponto, versao],
    queryFn: () => lerAvisoDeUmaVersao(ponto, versao),
    enabled: aberto,
    staleTime: Infinity,
  })
  return (
    <div className="mt-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
      >
        {aberto ? 'Fechar o aviso' : 'Ler o aviso desta versão'}
      </Button>
      {aberto && (
        <div
          className="mt-2 rounded-md border border-border p-3 text-sm"
          data-testid="aviso-da-versao"
        >
          {isLoading && <p className="text-muted-foreground">Carregando…</p>}
          {isError && (
            <p role="alert" className="text-destructive">
              {mensagemDoErro(error, 'Não foi possível abrir o aviso.')}
            </p>
          )}
          {data && (
            <>
              <p className="font-medium">
                {data.nome}, versão {data.versao} (valia desde{' '}
                {formatarData(data.vigente_desde)})
                {data.versao !== data.versao_atual &&
                  ` · hoje vale a versão ${data.versao_atual}`}
              </p>
              <p className="mt-2 whitespace-pre-line">{data.texto_sem_links}</p>
              {data.caixa && (
                <p className="mt-2 text-xs">
                  A pessoa marcou a caixa: “{data.caixa}”
                  {data.tipo === 'consentimento' &&
                    ' (era um pedido de consentimento)'}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
