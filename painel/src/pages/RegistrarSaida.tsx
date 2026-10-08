import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import type { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  enviarComprovante,
  listarAssociadosParaSelecao,
  listarCentrosCusto,
  listarFornecedores,
  listarPlanoContas,
  registrarSaida,
  type SaidaRegistrada,
} from '@/lib/api'
import { registrarSaidaSchema } from '@/lib/schemas'

const FORMAS_DE_PAGAMENTO = [
  'Pix',
  'Transferência bancária',
  'Boleto',
  'Dinheiro',
  'Cartão de débito',
  'Cartão de crédito',
]

const campo =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

function hojeEmISO(): string {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`
}

// Um anexo (nota fiscal ou comprovante): o arquivo é enviado na hora e o caminho que o servidor devolve vai para o campo do formulário.
function Anexo({
  id,
  rotulo,
  valor,
  erro,
  aoAnexar,
}: {
  id: string
  rotulo: string
  valor: string
  erro?: string
  aoAnexar: (caminho: string) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null)
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
        {rotulo}
      </label>
      <input
        id={id}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        disabled={enviando}
        onChange={async (e) => {
          const arquivo = e.target.files?.[0]
          if (!arquivo) return
          setErroDoEnvio(null)
          setEnviando(true)
          try {
            const { comprovante } = await enviarComprovante(arquivo)
            aoAnexar(comprovante)
          } catch (falha) {
            setErroDoEnvio((falha as Error).message)
          } finally {
            setEnviando(false)
          }
        }}
        className="h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
      />
      {enviando && <p className="text-xs text-muted-foreground">Enviando…</p>}
      {valor && !enviando && (
        <p className="text-xs text-green-600">{rotulo}: anexado.</p>
      )}
      {erroDoEnvio && (
        <p role="alert" className="text-xs text-destructive">
          {erroDoEnvio}
        </p>
      )}
      <ErroCampo mensagem={erro} />
    </div>
  )
}

// Registrar saída: o sistema é só o REGISTRO do que já aconteceu no mundo real (decisão do Presidente, 2026-10-08). Quem fez o Pix no banco já teve
// a aprovação da outra parte; aqui não há fila de assinatura. A saída entra de uma vez só (lança e dá a baixa), com categoria, nota fiscal e
// comprovante, e o Conselho Fiscal confere depois, na Auditoria financeira. O reembolso é uma categoria, com o associado como quem recebeu.
export function RegistrarSaidaPage() {
  const queryClient = useQueryClient()
  const [rodada, setRodada] = useState(0)
  const [registrada, setRegistrada] = useState<{
    saida: SaidaRegistrada
    descricao: string
    mes: string
  } | null>(null)

  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })
  const { data: fornecedores } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: listarFornecedores,
  })
  const { data: associados } = useQuery({
    queryKey: ['associados-para-selecao'],
    queryFn: listarAssociadosParaSelecao,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })
  const categorias = (contas ?? []).filter(
    (c) => c.tipo === 'Despesa' && !c.sintetica,
  )
  const origens = (contas ?? []).filter((c) => c.tipo === 'Ativo')

  const registrar = useMutation({
    mutationFn: (v: z.infer<typeof registrarSaidaSchema>) =>
      registrarSaida({
        id_conta_contabil: v.id_conta_contabil,
        descricao: v.descricao,
        valor: v.valor,
        data_despesa: v.data_despesa,
        data_pagamento: v.data_pagamento,
        forma_pagamento: v.forma_pagamento,
        id_conta_contabil_contrapartida: v.id_conta_contabil_contrapartida,
        id_fornecedor:
          v.quem_recebeu === 'fornecedor' ? Number(v.id_fornecedor) : undefined,
        id_associado:
          v.quem_recebeu === 'associado' ? Number(v.id_associado) : undefined,
        id_centro_custo: v.id_centro_custo
          ? Number(v.id_centro_custo)
          : undefined,
        nota_fiscal: v.nota_fiscal,
        comprovante: v.comprovante,
      }),
    onSuccess: (saida, v) => {
      setRegistrada({
        saida,
        descricao: v.descricao,
        mes: v.data_despesa.slice(0, 7),
      })
      setRodada((n) => n + 1)
      queryClient.invalidateQueries({ queryKey: ['titulos'] })
    },
  })

  return (
    <>
      <PageHeader
        titulo="Registrar saída"
        descricao="Registre uma saída que já aconteceu. O sistema é só o registro: a assinatura é do banco, aqui não há fila de aprovação."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Registrar saída' },
        ]}
      />

      {registrada && (
        <section
          role="status"
          className="mb-4 rounded-xl border border-green-600/40 bg-green-50 p-4 text-sm text-green-900"
        >
          <p className="font-medium">
            Saída registrada: “{registrada.descricao}” (título #
            {registrada.saida.id_titulo}, lançamento nº{' '}
            {registrada.saida.numero_sequencial}).
          </p>
          {registrada.saida.lancamento_tardio && (
            <p className="mt-1 text-amber-800">
              Atenção: esta saída foi lançada{' '}
              {registrada.saida.dias_ate_o_lancamento} dias depois do pagamento.
              Fica marcada como lançamento tardio para o Conselho Fiscal.
            </p>
          )}
          <p className="mt-2">
            <Link
              className="underline"
              to={`/financeiro/saidas?mes=${registrada.mes}&busca=${encodeURIComponent(registrada.descricao)}`}
            >
              Ver em Saídas
            </Link>
          </p>
        </section>
      )}

      <section className="rounded-xl border border-border bg-card p-6">
        <FormShell<z.infer<typeof registrarSaidaSchema>>
          key={rodada}
          schema={registrarSaidaSchema}
          defaultValues={{
            id_conta_contabil: 0,
            quem_recebeu: 'fornecedor',
            descricao: '',
            data_despesa: '',
            data_pagamento: '',
            forma_pagamento: '',
            id_conta_contabil_contrapartida: 0,
            nota_fiscal: '',
            comprovante: '',
          }}
          onSubmit={(v) => registrar.mutateAsync(v).then(() => undefined)}
          className="grid gap-3 sm:grid-cols-2"
        >
          {(form) => {
            const erros = form.formState.errors
            const quem = form.watch('quem_recebeu')
            const hoje = hojeEmISO()
            return (
              <>
                <div>
                  <label
                    htmlFor="saida-categoria"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Categoria da saída
                  </label>
                  <select
                    id="saida-categoria"
                    {...form.register('id_conta_contabil')}
                    className={campo}
                  >
                    <option value="0">Escolha a categoria…</option>
                    {categorias.map((c) => (
                      <option key={c.id_conta} value={c.id_conta}>
                        {c.codigo_contabil} — {c.descricao_conta}
                      </option>
                    ))}
                  </select>
                  <ErroCampo mensagem={erros.id_conta_contabil?.message} />
                </div>

                <div>
                  <label
                    htmlFor="saida-descricao"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Descrição
                  </label>
                  <input
                    id="saida-descricao"
                    {...form.register('descricao')}
                    placeholder="Ex.: material de limpeza da sede"
                    className={campo}
                  />
                  <ErroCampo mensagem={erros.descricao?.message} />
                </div>

                <div>
                  <label
                    htmlFor="saida-quem"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Quem recebeu
                  </label>
                  <select
                    id="saida-quem"
                    {...form.register('quem_recebeu')}
                    className={campo}
                  >
                    <option value="fornecedor">Um fornecedor</option>
                    <option value="associado">Um associado (reembolso)</option>
                  </select>
                </div>

                {quem === 'fornecedor' ? (
                  <div>
                    <label
                      htmlFor="saida-fornecedor"
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      Fornecedor
                    </label>
                    <select
                      id="saida-fornecedor"
                      {...form.register('id_fornecedor')}
                      className={campo}
                    >
                      <option value="">Escolha o fornecedor…</option>
                      {(fornecedores ?? []).map((f) => (
                        <option key={f.id_fornecedor} value={f.id_fornecedor}>
                          {f.razao_social}
                        </option>
                      ))}
                    </select>
                    <ErroCampo mensagem={erros.id_fornecedor?.message} />
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="saida-associado"
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      Associado
                    </label>
                    <select
                      id="saida-associado"
                      {...form.register('id_associado')}
                      className={campo}
                    >
                      <option value="">Escolha o associado…</option>
                      {(associados ?? []).map((a) => (
                        <option key={a.id_associado} value={a.id_associado}>
                          {a.nome_completo}
                        </option>
                      ))}
                    </select>
                    <ErroCampo mensagem={erros.id_associado?.message} />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="saida-valor"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Valor (R$)
                  </label>
                  <input
                    id="saida-valor"
                    type="number"
                    step="0.01"
                    {...form.register('valor')}
                    className={campo}
                  />
                  <ErroCampo mensagem={erros.valor?.message} />
                </div>

                <div>
                  <label
                    htmlFor="saida-forma"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Forma de pagamento
                  </label>
                  <select
                    id="saida-forma"
                    {...form.register('forma_pagamento')}
                    className={campo}
                  >
                    <option value="">Escolha…</option>
                    {FORMAS_DE_PAGAMENTO.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <ErroCampo mensagem={erros.forma_pagamento?.message} />
                </div>

                <div>
                  <label
                    htmlFor="saida-data-despesa"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Data da despesa
                  </label>
                  <input
                    id="saida-data-despesa"
                    type="date"
                    max={hoje}
                    {...form.register('data_despesa')}
                    className={campo}
                  />
                  <ErroCampo mensagem={erros.data_despesa?.message} />
                </div>

                <div>
                  <label
                    htmlFor="saida-data-pagamento"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Data do pagamento
                  </label>
                  <input
                    id="saida-data-pagamento"
                    type="date"
                    max={hoje}
                    {...form.register('data_pagamento')}
                    className={campo}
                  />
                  <ErroCampo mensagem={erros.data_pagamento?.message} />
                </div>

                <div>
                  <label
                    htmlFor="saida-origem"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    De onde saiu o dinheiro
                  </label>
                  <select
                    id="saida-origem"
                    {...form.register('id_conta_contabil_contrapartida')}
                    className={campo}
                  >
                    <option value="0">Conta de banco ou caixa…</option>
                    {origens.map((c) => (
                      <option key={c.id_conta} value={c.id_conta}>
                        {c.codigo_contabil} — {c.descricao_conta}
                      </option>
                    ))}
                  </select>
                  <ErroCampo
                    mensagem={erros.id_conta_contabil_contrapartida?.message}
                  />
                </div>

                <div>
                  <label
                    htmlFor="saida-centro"
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Centro de custo (opcional)
                  </label>
                  <select
                    id="saida-centro"
                    {...form.register('id_centro_custo')}
                    className={campo}
                  >
                    <option value="">Sem centro de custo</option>
                    {(centros ?? [])
                      .filter((c) => c.ativo)
                      .map((c) => (
                        <option
                          key={c.id_centro_custo}
                          value={c.id_centro_custo}
                        >
                          {c.codigo} — {c.nome}
                        </option>
                      ))}
                  </select>
                </div>

                <Anexo
                  id="saida-nota-fiscal"
                  rotulo="Nota fiscal"
                  valor={form.watch('nota_fiscal')}
                  erro={erros.nota_fiscal?.message}
                  aoAnexar={(caminho) =>
                    form.setValue('nota_fiscal', caminho, {
                      shouldValidate: true,
                    })
                  }
                />
                <Anexo
                  id="saida-comprovante"
                  rotulo="Comprovante do pagamento"
                  valor={form.watch('comprovante')}
                  erro={erros.comprovante?.message}
                  aoAnexar={(caminho) =>
                    form.setValue('comprovante', caminho, {
                      shouldValidate: true,
                    })
                  }
                />

                <div className="sm:col-span-2">
                  <Button type="submit" disabled={registrar.isPending}>
                    {registrar.isPending ? 'Registrando…' : 'Registrar saída'}
                  </Button>
                </div>
              </>
            )
          }}
        </FormShell>
      </section>
    </>
  )
}
