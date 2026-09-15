import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { criarAssociadoMaster, listarOpcoesLegado } from '@/lib/api'
import { associadoMasterSchema } from '@/lib/schemas'

type AssociadoForm = z.infer<typeof associadoMasterSchema>

// v3.0.2 (achado 2026-09-15) - primeiro cadastro de negócio real do painel único, ligado ao
// mesmo endpoint que a página HTML legada (`/admin/secretaria`) já usa - o formulário mudou de
// lugar, a regra de validação (backend) é a mesma de sempre.
export function AssociadoNovoPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: categorias, isLoading: carregandoCategorias } = useQuery({
    queryKey: ['opcoes-legado', 'categoria_associado'],
    queryFn: () => listarOpcoesLegado('categoria_associado'),
  })
  const { data: estadosCivis } = useQuery({
    queryKey: ['opcoes-legado', 'estado_civil'],
    queryFn: () => listarOpcoesLegado('estado_civil'),
  })

  const criar = useMutation({
    // Campos opcionais chegam como string vazia do formulário (input não preenchido) - o
    // backend espera ausência do campo (None), não "" (Pydantic recusaria "" como data).
    mutationFn: (v: AssociadoForm) =>
      criarAssociadoMaster({
        ...v,
        data_nascimento: v.data_nascimento || undefined,
        estado_civil: v.estado_civil || undefined,
        profissao: v.profissao || undefined,
        naturalidade: v.naturalidade || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['associados'] })
      navigate('/associados')
    },
  })

  return (
    <>
      <PageHeader
        titulo="Novo associado"
        descricao="Cadastro completo (dados pessoais e endereço)."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Novo associado' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <FormShell<AssociadoForm>
          schema={associadoMasterSchema}
          defaultValues={{
            nome_completo: '',
            cpf: '',
            email_contato: '',
            telefone_whatsapp: '',
            categoria: '',
            cep: '',
            logradouro: '',
            numero: '',
            bairro: '',
            cidade: '',
            estado: '',
            data_nascimento: '',
            estado_civil: '',
            profissao: '',
            naturalidade: '',
          }}
          onSubmit={(v) => criar.mutateAsync(v)}
        >
          {(form) => (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Nome completo *</label>
                  <input
                    {...form.register('nome_completo')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.nome_completo?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">CPF *</label>
                  <input
                    {...form.register('cpf')}
                    placeholder="000.000.000-00"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.cpf?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">E-mail *</label>
                  <input
                    {...form.register('email_contato')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.email_contato?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Telefone (WhatsApp) *
                  </label>
                  <input
                    {...form.register('telefone_whatsapp')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.telefone_whatsapp?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Categoria *</label>
                  <select
                    {...form.register('categoria')}
                    disabled={carregandoCategorias}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">
                      {carregandoCategorias ? 'Carregando…' : 'Selecione…'}
                    </option>
                    {(categorias ?? []).map((o) => (
                      <option key={o.id_opcao} value={o.valor}>
                        {o.valor}
                      </option>
                    ))}
                  </select>
                  <ErroCampo
                    mensagem={form.formState.errors.categoria?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Data de nascimento
                  </label>
                  <input
                    type="date"
                    {...form.register('data_nascimento')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Estado civil</label>
                  <select
                    {...form.register('estado_civil')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Selecione…</option>
                    {(estadosCivis ?? []).map((o) => (
                      <option key={o.id_opcao} value={o.valor}>
                        {o.valor}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Profissão</label>
                  <input
                    {...form.register('profissao')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Naturalidade</label>
                  <input
                    {...form.register('naturalidade')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>

              <h2 className="pt-2 font-semibold">Endereço</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">CEP *</label>
                  <input
                    {...form.register('cep')}
                    placeholder="00000-000"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.cep?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Logradouro *</label>
                  <input
                    {...form.register('logradouro')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.logradouro?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Número *</label>
                  <input
                    {...form.register('numero')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.numero?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Bairro *</label>
                  <input
                    {...form.register('bairro')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.bairro?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Cidade *</label>
                  <input
                    {...form.register('cidade')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.cidade?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Estado (UF) *</label>
                  <input
                    {...form.register('estado')}
                    maxLength={2}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
                  />
                  <ErroCampo mensagem={form.formState.errors.estado?.message} />
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={criar.isPending}>
                  {criar.isPending ? 'Cadastrando…' : 'Cadastrar associado'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/associados')}
                >
                  Cancelar
                </Button>
              </div>
            </>
          )}
        </FormShell>
      </section>
    </>
  )
}
