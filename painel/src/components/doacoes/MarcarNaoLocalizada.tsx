import { useMutation } from '@tanstack/react-query'
import { useId } from 'react'
import { z } from 'zod'

import { DialogoDeFormulario } from '@/components/feedback/DialogoDeFormulario'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { Button } from '@/components/ui/button'
import { marcarIntencaoNaoLocalizada, type IntencaoDeDoacao } from '@/lib/api'
import { classeAreaDeTexto } from '@/lib/campos'
import { doacaoDoSiteNaoLocalizadaSchema } from '@/lib/schemas'

type Valores = z.infer<typeof doacaoDoSiteNaoLocalizadaSchema>

const LIMITE_DA_OBSERVACAO = 300

// v5.6a - "Pix não localizado": a tesouraria procurou no extrato e não achou. Nada é apagado nem cancelado: o dinheiro pode chegar atrasado, e
// enquanto não for confirmada a doação ainda pode ser confirmada depois. A observação (opcional) fica registrada para quem olhar depois.
export function MarcarNaoLocalizada({
  intencao,
  onFechar,
  onMarcada,
  onFalha,
  devolverFoco,
}: {
  intencao: IntencaoDeDoacao
  onFechar: () => void
  onMarcada: (resultado: IntencaoDeDoacao) => void
  // o servidor recusou (ex.: já foi confirmada em outra aba): quem chamou confere a lista de novo
  onFalha: () => void
  devolverFoco: () => HTMLElement | null
}) {
  const idObservacao = useId()
  const idDica = useId()

  const marcar = useMutation({
    mutationFn: (v: Valores) =>
      marcarIntencaoNaoLocalizada(intencao.id_intencao, v.observacao.trim()),
    onSuccess: onMarcada,
    onError: onFalha,
  })

  return (
    <DialogoDeFormulario
      titulo={`Pix de ${intencao.nome_doador} não localizado`}
      descricao={
        <p>
          Use quando procurou no extrato do banco e não achou o Pix (protocolo{' '}
          {intencao.protocolo}). Nada é apagado: se o dinheiro chegar depois,
          ainda dá para confirmar o recebimento.
        </p>
      }
      onFechar={onFechar}
      devolverFoco={devolverFoco}
      bloqueado={marcar.isPending}
    >
      <FormShell<Valores>
        schema={doacaoDoSiteNaoLocalizadaSchema}
        defaultValues={{ observacao: intencao.observacao ?? '' }}
        onSubmit={(v) => marcar.mutateAsync(v)}
      >
        {(form) => (
          <>
            <div>
              <label
                htmlFor={idObservacao}
                className="mb-1 block text-sm font-medium"
              >
                Observação (opcional)
              </label>
              <textarea
                id={idObservacao}
                rows={3}
                maxLength={LIMITE_DA_OBSERVACAO}
                autoFocus
                aria-describedby={idDica}
                aria-invalid={
                  form.formState.errors.observacao ? true : undefined
                }
                className={classeAreaDeTexto}
                {...form.register('observacao')}
              />
              <p id={idDica} className="mt-1 text-xs text-muted-foreground">
                Até {LIMITE_DA_OBSERVACAO} letras. Ex.: procurei no extrato dos
                últimos dias e não há Pix desse valor.
              </p>
              <ErroCampo mensagem={form.formState.errors.observacao?.message} />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={marcar.isPending}
                onClick={onFechar}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={marcar.isPending}>
                {marcar.isPending ? 'Marcando…' : 'Marcar como não localizado'}
              </Button>
            </div>
          </>
        )}
      </FormShell>
    </DialogoDeFormulario>
  )
}
