import { useMutation, useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { z } from 'zod'

import { DialogoDeFormulario } from '@/components/feedback/DialogoDeFormulario'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { Button } from '@/components/ui/button'
import {
  confirmarIntencaoDeDoacao,
  listarCentrosCusto,
  listarPlanoContas,
  type IntencaoDeDoacao,
  type IntencaoDeDoacaoConfirmada,
} from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import { cpfParaATela, reais, valorParaOCampo } from '@/lib/doacoes-do-site'
import { confirmarDoacaoDoSiteSchema } from '@/lib/schemas'
import { lerValorEmReais } from '@/lib/valores'

type Valores = z.infer<typeof confirmarDoacaoDoSiteSchema>

// v5.6a - "Confirmar recebimento": a tesouraria achou o Pix no extrato do banco. Só aqui nasce a doação de verdade (título pago, lançamento e recibo
// numerado, com o valor RECEBIDO, que pode ser diferente do informado) e o recibo sai por e-mail. Não há como desfazer, então o diálogo diz isso antes.
// As contas e a destinação são as mesmas do formulário "Registrar doação" (Receita, caixa/banco, centro de custo), com as mesmas consultas.
export function ConfirmarRecebimento({
  intencao,
  onFechar,
  onConfirmada,
  onFalha,
  devolverFoco,
}: {
  intencao: IntencaoDeDoacao
  onFechar: () => void
  onConfirmada: (resultado: IntencaoDeDoacaoConfirmada) => void
  // o servidor recusou (ex.: já foi confirmada em outra aba): quem chamou confere a lista de novo
  onFalha: () => void
  devolverFoco: () => HTMLElement | null
}) {
  const contas = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const centros = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const idValor = useId()
  const idDicaDoValor = useId()
  const idReceita = useId()
  const idCaixa = useId()
  const idDestinacao = useId()
  const idDicaDaDestinacao = useId()

  const confirmar = useMutation({
    mutationFn: (v: Valores) =>
      confirmarIntencaoDeDoacao(intencao.id_intencao, {
        valor_recebido: Number(lerValorEmReais(v.valor_recebido)),
        id_conta_contabil: Number(v.id_conta_contabil),
        id_conta_contabil_caixa: Number(v.id_conta_contabil_caixa),
        ...(v.id_centro_custo_destinacao
          ? {
              id_centro_custo_destinacao: Number(v.id_centro_custo_destinacao),
            }
          : {}),
      }),
    onSuccess: onConfirmada,
    onError: onFalha,
  })

  const contasDeReceita = (contas.data ?? []).filter(
    (c) => c.tipo === 'Receita' && !c.sintetica,
  )
  const contasDeCaixa = (contas.data ?? []).filter(
    (c) => c.tipo === 'Ativo' && !c.sintetica,
  )
  const pronto = contas.isSuccess && centros.isSuccess
  const falhou = contas.isError || centros.isError
  const cpf = cpfParaATela(intencao.documento_doador)
  const destinacaoDaCampanha = intencao.id_centro_custo_sugerido ?? null

  return (
    <DialogoDeFormulario
      titulo={`Confirmar o Pix de ${intencao.nome_doador}`}
      descricao={
        <p>
          Confirme só depois de achar este Pix no extrato do banco da
          associação. Ao confirmar, o sistema registra a doação, emite o recibo
          numerado e envia o recibo por e-mail para {intencao.email_doador}. Não
          dá para desfazer.
        </p>
      }
      onFechar={onFechar}
      devolverFoco={devolverFoco}
      bloqueado={confirmar.isPending}
    >
      <dl className="mb-3 grid gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Protocolo</dt>
          <dd>{intencao.protocolo}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CPF</dt>
          <dd>{cpf ?? 'não informado'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Valor informado</dt>
          <dd>
            {intencao.valor_informado !== null
              ? reais(intencao.valor_informado)
              : 'sem valor informado'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Campanha</dt>
          <dd>{intencao.campanha_titulo ?? 'sem campanha'}</dd>
        </div>
      </dl>

      {!pronto && !falhou && (
        <p className="text-sm text-muted-foreground">Carregando as contas…</p>
      )}

      {falhou && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar as contas. Tente de novo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                if (contas.isError) void contas.refetch()
                if (centros.isError) void centros.refetch()
              }}
            >
              Tentar de novo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onFechar}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {pronto && (
        <FormShell<Valores>
          schema={confirmarDoacaoDoSiteSchema}
          defaultValues={{
            valor_recebido: valorParaOCampo(intencao.valor_informado),
            id_conta_contabil: '',
            id_conta_contabil_caixa: '',
            id_centro_custo_destinacao: String(destinacaoDaCampanha ?? ''),
          }}
          onSubmit={(v) => confirmar.mutateAsync(v)}
        >
          {(form) => (
            <>
              <div>
                <label
                  htmlFor={idValor}
                  className="mb-1 block text-sm font-medium"
                >
                  Valor recebido (R$)
                </label>
                <input
                  id={idValor}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  aria-describedby={idDicaDoValor}
                  aria-invalid={
                    form.formState.errors.valor_recebido ? true : undefined
                  }
                  className={classeCampo}
                  {...form.register('valor_recebido')}
                />
                <p
                  id={idDicaDoValor}
                  className="mt-1 text-xs text-muted-foreground"
                >
                  É o valor que vale: o que entrou no extrato, mesmo que seja
                  diferente do informado.
                </p>
                <ErroCampo
                  mensagem={form.formState.errors.valor_recebido?.message}
                />
              </div>

              <div>
                <label
                  htmlFor={idReceita}
                  className="mb-1 block text-sm font-medium"
                >
                  Conta de receita
                </label>
                <select
                  id={idReceita}
                  aria-invalid={
                    form.formState.errors.id_conta_contabil ? true : undefined
                  }
                  className={classeCampo}
                  {...form.register('id_conta_contabil')}
                >
                  <option value="">Escolha a conta de receita…</option>
                  {contasDeReceita.map((c) => (
                    <option key={c.id_conta} value={c.id_conta}>
                      {c.codigo_contabil} — {c.descricao_conta}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={form.formState.errors.id_conta_contabil?.message}
                />
              </div>

              <div>
                <label
                  htmlFor={idCaixa}
                  className="mb-1 block text-sm font-medium"
                >
                  Conta de caixa ou banco que recebeu
                </label>
                <select
                  id={idCaixa}
                  aria-invalid={
                    form.formState.errors.id_conta_contabil_caixa
                      ? true
                      : undefined
                  }
                  className={classeCampo}
                  {...form.register('id_conta_contabil_caixa')}
                >
                  <option value="">Escolha a conta de caixa ou banco…</option>
                  {contasDeCaixa.map((c) => (
                    <option key={c.id_conta} value={c.id_conta}>
                      {c.codigo_contabil} — {c.descricao_conta}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={
                    form.formState.errors.id_conta_contabil_caixa?.message
                  }
                />
              </div>

              <div>
                <label
                  htmlFor={idDestinacao}
                  className="mb-1 block text-sm font-medium"
                >
                  Destinação (centro de custo)
                </label>
                <select
                  id={idDestinacao}
                  aria-describedby={idDicaDaDestinacao}
                  className={classeCampo}
                  {...form.register('id_centro_custo_destinacao')}
                >
                  <option value="">
                    {destinacaoDaCampanha !== null
                      ? 'Usar a destinação da campanha'
                      : 'Sem destinação específica'}
                  </option>
                  {(centros.data ?? []).map((c) => (
                    <option key={c.id_centro_custo} value={c.id_centro_custo}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <p
                  id={idDicaDaDestinacao}
                  className="mt-1 text-xs text-muted-foreground"
                >
                  {destinacaoDaCampanha !== null
                    ? `A destinação da campanha${intencao.campanha_titulo ? ` “${intencao.campanha_titulo}”` : ''} já vem escolhida. Para mandar a doação a outro fim, escolha outro centro de custo.`
                    : 'Opcional. Escolha só se a doação tiver um fim definido (um centro de custo).'}
                </p>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={confirmar.isPending}
                  onClick={onFechar}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={confirmar.isPending}>
                  {confirmar.isPending
                    ? 'Confirmando…'
                    : 'Confirmar recebimento'}
                </Button>
              </div>
            </>
          )}
        </FormShell>
      )}

      {!pronto && !falhou && (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
        </div>
      )}
    </DialogoDeFormulario>
  )
}
