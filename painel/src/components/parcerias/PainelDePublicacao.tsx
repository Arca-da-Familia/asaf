import { useState } from 'react'

import { Secao } from '@/components/layout/Secao'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import {
  aprovarParceria,
  enviarParceriaParaRevisao,
  reabrirParceria,
  recusarParceria,
  retirarParceria,
  type Executar,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

type Confirmacao = 'aprovar' | 'recusar' | 'retirar' | null

const quando = (valor: string | null) =>
  valor ? formatarData(valor, { comHora: true }) : '—'

// Publicação no site de transparência: rascunho -> em revisão -> aprovado -> retirado. Quem criou ou enviou não aprova
// (o servidor confere; aqui só aparece o botão para quem pode).
export function PainelDePublicacao({
  d,
  executar,
}: {
  d: ParceriaDetalhe
  executar: Executar
}) {
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null)
  const [motivo, setMotivo] = useState('')

  function fechar() {
    setConfirmacao(null)
    setMotivo('')
  }

  return (
    <Secao titulo="Publicação no site de transparência">
      {d.motivo_recusa && d.situacao_publicacao === 'Rascunho' && (
        <p className="text-sm text-destructive">
          Última recusa ({quando(d.recusado_em)}): {d.motivo_recusa}
        </p>
      )}
      {d.situacao_publicacao === 'Aprovado' && (
        <p className="text-sm">No site desde {quando(d.aprovado_em)}.</p>
      )}
      {d.situacao_publicacao === 'Retirado' && (
        <p className="text-sm">
          Retirada do site em {quando(d.retirado_em)}: {d.motivo_retirada}
        </p>
      )}

      {confirmacao === null && (
        <div className="flex flex-wrap gap-3">
          {d.pode_enviar_revisao && (
            <Button
              type="button"
              onClick={() =>
                void executar(() => enviarParceriaParaRevisao(d.id_parceria))
              }
            >
              Enviar para revisão
            </Button>
          )}
          {d.pode_aprovar && (
            <>
              <Button type="button" onClick={() => setConfirmacao('aprovar')}>
                Aprovar a publicação
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmacao('recusar')}
              >
                Recusar
              </Button>
            </>
          )}
          {d.pode_retirar && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmacao('retirar')}
            >
              Retirar do site
            </Button>
          )}
          {d.pode_reabrir && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void executar(() => reabrirParceria(d.id_parceria))
              }
            >
              Reabrir para corrigir
            </Button>
          )}
        </div>
      )}

      {confirmacao === 'aprovar' && (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p>
            Ao aprovar, os dados desta parceria (título, objeto, valores,
            parcelas, etapas, relatórios e os movimentos classificados) passam a
            ser vistos por qualquer pessoa no site de transparência. Você
            conferiu e confirma que não há dado pessoal nem informação errada?
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={async () => {
                if (await executar(() => aprovarParceria(d.id_parceria)))
                  fechar()
              }}
            >
              Confirmar aprovação
            </Button>
            <Button type="button" variant="outline" onClick={fechar}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      {(confirmacao === 'recusar' || confirmacao === 'retirar') && (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm">
          <label className="block">
            <span className="mb-1 block font-medium">
              {confirmacao === 'recusar'
                ? 'Por que a publicação foi recusada? (pelo menos 10 letras)'
                : 'Por que sair do site? (pelo menos 10 letras)'}
            </span>
            <textarea
              className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={confirmacao === 'retirar' ? 'destructive' : 'default'}
              onClick={async () => {
                const ok = await executar(() =>
                  confirmacao === 'recusar'
                    ? recusarParceria(d.id_parceria, motivo)
                    : retirarParceria(d.id_parceria, motivo),
                )
                if (ok) fechar()
              }}
            >
              {confirmacao === 'recusar'
                ? 'Confirmar recusa'
                : 'Confirmar retirada'}
            </Button>
            <Button type="button" variant="outline" onClick={fechar}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </Secao>
  )
}
