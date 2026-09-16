import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  atualizarFornecedor,
  criarFornecedor,
  listarFornecedores,
  type Fornecedor,
} from '@/lib/api'
import { fornecedorCriarSchema } from '@/lib/schemas'

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

export function FornecedoresPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()

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
                className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{f.razao_social}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatarCnpj(f.cnpj)} · {f.categoria_servico} ·{' '}
                    {f.telefone}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditando(f.id_fornecedor)}
                >
                  Editar
                </Button>
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
