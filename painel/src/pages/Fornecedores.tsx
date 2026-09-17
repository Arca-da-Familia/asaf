import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  aprovarDadosBancariosFornecedor,
  atualizarFornecedor,
  criarFornecedor,
  listarDadosBancariosFornecedor,
  listarFornecedores,
  rejeitarDadosBancariosFornecedor,
  solicitarDadosBancariosFornecedor,
  validarSituacaoCadastral,
  type Fornecedor,
} from '@/lib/api'
import {
  dadosBancariosFornecedorCriarSchema,
  fornecedorCriarSchema,
} from '@/lib/schemas'

// v2.5.8 (FASE 2.5 - Painel) - Fornecedores (backend v3.0, só faltava a tela). `categoria_servico`
// é texto livre no backend (não existe catálogo pra isso) - confirmado antes de tentar um
// <select> que não teria de onde vir. Sem DELETE no backend: só criar e editar. O CNPJ volta do
// GET só-dígitos (o backend normaliza) - a formatação de exibição é responsabilidade da tela.
function formatarCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return cnpj
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

function FormularioFornecedor({
  fornecedor,
  onSalvar,
  onCancelar,
}: {
  fornecedor?: Fornecedor
  onSalvar: (v: z.infer<typeof fornecedorCriarSchema>) => Promise<unknown>
  onCancelar?: () => void
}) {
  return (
    <FormShell<z.infer<typeof fornecedorCriarSchema>>
      schema={fornecedorCriarSchema}
      defaultValues={{
        razao_social: fornecedor?.razao_social ?? '',
        cnpj: fornecedor?.cnpj ?? '',
        categoria_servico: fornecedor?.categoria_servico ?? '',
        telefone: fornecedor?.telefone ?? '',
      }}
      onSubmit={onSalvar}
      className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <input
              {...form.register('razao_social')}
              placeholder="Razão social"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.razao_social?.message} />
          </div>
          <div>
            <input
              {...form.register('cnpj')}
              placeholder="CNPJ"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.cnpj?.message} />
          </div>
          <div>
            <input
              {...form.register('categoria_servico')}
              placeholder="Categoria de serviço"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.categoria_servico?.message}
            />
          </div>
          <div>
            <input
              {...form.register('telefone')}
              placeholder="Telefone"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.telefone?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm">
              Salvar
            </Button>
            {onCancelar && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancelar}
              >
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}
    </FormShell>
  )
}

// v3.3 - dados bancários de fornecedor são versionados (nunca editados) e exigem SEGUNDO
// APROVADOR (nunca quem solicitou a troca) antes de valer - a alteração de dados bancários de
// fornecedor é o golpe mais comum contra organizações, a defesa é processual.
function PainelDadosBancarios({ idFornecedor }: { idFornecedor: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: historico } = useQuery({
    queryKey: ['dados-bancarios-fornecedor', idFornecedor],
    queryFn: () => listarDadosBancariosFornecedor(idFornecedor),
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['dados-bancarios-fornecedor', idFornecedor],
    })
  }

  const solicitar = useMutation({
    mutationFn: (v: z.infer<typeof dadosBancariosFornecedorCriarSchema>) =>
      solicitarDadosBancariosFornecedor({ id_fornecedor: idFornecedor, ...v }),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const aprovar = useMutation({
    mutationFn: (id: number) => aprovarDadosBancariosFornecedor(id),
    onSuccess: invalidar,
  })
  const rejeitar = useMutation({
    mutationFn: (id: number) =>
      rejeitarDadosBancariosFornecedor(id, 'Rejeitado pelo segundo aprovador.'),
    onSuccess: invalidar,
  })

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">Dados bancários</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Solicitar troca'}
        </Button>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof dadosBancariosFornecedorCriarSchema>>
          schema={dadosBancariosFornecedorCriarSchema}
          defaultValues={{
            banco: '',
            agencia: '',
            conta: '',
            tipo_conta: '',
            titular: '',
          }}
          onSubmit={(v) => solicitar.mutateAsync(v)}
          className="mb-3 grid gap-2 rounded-md border border-border p-2 sm:grid-cols-2"
        >
          {(form) => (
            <>
              <div>
                <input
                  {...form.register('banco')}
                  placeholder="Banco"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.banco?.message} />
              </div>
              <div>
                <input
                  {...form.register('agencia')}
                  placeholder="Agência"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.agencia?.message} />
              </div>
              <div>
                <input
                  {...form.register('conta')}
                  placeholder="Conta"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.conta?.message} />
              </div>
              <div>
                <input
                  {...form.register('tipo_conta')}
                  placeholder="Tipo (Corrente/Poupança)"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.tipo_conta?.message}
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  {...form.register('titular')}
                  placeholder="Titular da conta"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.titular?.message} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={solicitar.isPending}>
                  {solicitar.isPending
                    ? 'Enviando…'
                    : 'Solicitar (aguarda segundo aprovador)'}
                </Button>
              </div>
              {solicitar.isError && (
                <p className="text-xs text-destructive sm:col-span-2">
                  {(solicitar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-1">
        {(historico ?? []).map((h) => (
          <div
            key={h.id_dados_bancarios}
            className="rounded border border-border p-2"
          >
            <div className="flex items-center justify-between">
              <span>
                {h.banco} — ag. {h.agencia} · c. {h.conta} ({h.tipo_conta}) ·{' '}
                {h.titular}
              </span>
              <span
                className={
                  h.status === 'Aprovado'
                    ? 'text-green-600'
                    : h.status === 'Rejeitado'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
              >
                {h.status}
              </span>
            </div>
            {h.status === 'Pendente' && (
              <div className="mt-1 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={aprovar.isPending}
                  onClick={() => aprovar.mutate(h.id_dados_bancarios)}
                >
                  Aprovar (2º aprovador)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rejeitar.isPending}
                  onClick={() => rejeitar.mutate(h.id_dados_bancarios)}
                >
                  Rejeitar
                </Button>
              </div>
            )}
            {aprovar.isError && (
              <p className="text-xs text-destructive">
                {(aprovar.error as Error).message}
              </p>
            )}
          </div>
        ))}
        {(historico ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhuma troca de dados bancários registrada.
          </p>
        )}
      </div>
    </div>
  )
}

export function FornecedoresPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [expandido, setExpandido] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const validar = useMutation({
    mutationFn: (idFornecedor: number) =>
      validarSituacaoCadastral(idFornecedor),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] }),
  })

  const { data: fornecedores } = useQuery({
    queryKey: ['fornecedores'],
    queryFn: listarFornecedores,
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['fornecedores'] })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof fornecedorCriarSchema>) =>
      criarFornecedor(v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
      setErro(null)
    },
    onError: (e: Error) => setErro(e.message),
  })

  const editar = useMutation({
    mutationFn: ({
      idFornecedor,
      dados,
    }: {
      idFornecedor: number
      dados: z.infer<typeof fornecedorCriarSchema>
    }) => atualizarFornecedor(idFornecedor, dados),
    onSuccess: () => {
      invalidar()
      setEditando(null)
      setErro(null)
    },
    onError: (e: Error) => setErro(e.message),
  })

  return (
    <>
      <PageHeader
        titulo="Fornecedores"
        descricao="Fornecedores usados nos títulos a pagar."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Fornecedores' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Fornecedores cadastrados</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo fornecedor'}
          </Button>
        </div>

        {mostrarForm && (
          <div className="mb-4">
            <FormularioFornecedor
              onSalvar={(v) => criar.mutateAsync(v)}
              onCancelar={() => setMostrarForm(false)}
            />
          </div>
        )}

        {erro && <p className="mb-2 text-sm text-destructive">{erro}</p>}

        <div className="space-y-2">
          {(fornecedores ?? []).map((f) =>
            editando === f.id_fornecedor ? (
              <FormularioFornecedor
                key={f.id_fornecedor}
                fornecedor={f}
                onSalvar={(v) =>
                  editar.mutateAsync({
                    idFornecedor: f.id_fornecedor,
                    dados: v,
                  })
                }
                onCancelar={() => setEditando(null)}
              />
            ) : (
              <div
                key={f.id_fornecedor}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{f.razao_social}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatarCnpj(f.cnpj)} · {f.categoria_servico} ·{' '}
                      {f.telefone}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Situação cadastral:{' '}
                      {f.situacao_cadastral ?? 'nunca validada'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={validar.isPending}
                      onClick={() => validar.mutate(f.id_fornecedor)}
                    >
                      Validar situação
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExpandido((v) =>
                          v === f.id_fornecedor ? null : f.id_fornecedor,
                        )
                      }
                    >
                      {expandido === f.id_fornecedor
                        ? 'Ocultar'
                        : 'Dados bancários'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditando(f.id_fornecedor)}
                    >
                      Editar
                    </Button>
                  </div>
                </div>
                {expandido === f.id_fornecedor && (
                  <PainelDadosBancarios idFornecedor={f.id_fornecedor} />
                )}
              </div>
            ),
          )}
          {(fornecedores ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum fornecedor cadastrado.
            </p>
          )}
        </div>
      </section>
    </>
  )
}
