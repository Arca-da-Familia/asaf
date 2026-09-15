import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { concederAcesso } from '@/lib/api'
import { concederAcessoSchema } from '@/lib/schemas'

type ConcederAcessoForm = z.infer<typeof concederAcessoSchema>

// v3.0.2 (achado 2026-09-15) - cadastrar a ficha nunca deu login pra a pessoa; esta tela fecha
// esse buraco. A senha aqui é provisória de propósito: o associado é obrigado a trocá-la no
// primeiro login (Usuario.senha_provisoria, ver app/routers/auth.py).
export function ConcederAcessoPage() {
  const { id } = useParams<{ id: string }>()
  const idAssociado = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [senhaEntregue, setSenhaEntregue] = useState<{ email: string; senha: string } | null>(
    null,
  )

  const conceder = useMutation({
    mutationFn: (v: ConcederAcessoForm) => concederAcesso(idAssociado, v),
    onSuccess: (_resultado, variaveis) => {
      queryClient.invalidateQueries({ queryKey: ['associados'] })
      setSenhaEntregue({ email: variaveis.email, senha: variaveis.senha_provisoria })
    },
  })

  if (senhaEntregue) {
    return (
      <>
        <PageHeader
          titulo="Acesso concedido"
          trilha={[{ rotulo: 'Associados', href: '/associados' }, { rotulo: 'Conceder acesso' }]}
        />
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="mb-4 text-sm">
            Entregue estes dados ao associado. Ele será obrigado a trocar a senha no primeiro
            login.
          </p>
          <dl className="mb-6 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">E-mail de login:</dt>
              <dd className="font-mono">{senhaEntregue.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Senha provisória:</dt>
              <dd className="font-mono">{senhaEntregue.senha}</dd>
            </div>
          </dl>
          <Button onClick={() => navigate('/associados')}>Voltar para Associados</Button>
        </section>
      </>
    )
  }

  return (
    <>
      <PageHeader
        titulo="Conceder acesso"
        descricao="Define uma senha provisória para o associado entrar no painel pela primeira vez."
        trilha={[{ rotulo: 'Associados', href: '/associados' }, { rotulo: 'Conceder acesso' }]}
      />

      <section className="max-w-md rounded-xl border border-border bg-card p-6">
        <FormShell<ConcederAcessoForm>
          schema={concederAcessoSchema}
          defaultValues={{ email: '', senha_provisoria: '' }}
          onSubmit={(v) => conceder.mutateAsync(v)}
        >
          {(form) => (
            <>
              <div>
                <label className="text-sm font-medium">E-mail de login</label>
                <input
                  {...form.register('email')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.email?.message} />
              </div>
              <div>
                <label className="text-sm font-medium">Senha provisória</label>
                <input
                  {...form.register('senha_provisoria')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.senha_provisoria?.message} />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={conceder.isPending}>
                  {conceder.isPending ? 'Concedendo…' : 'Conceder acesso'}
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/associados')}>
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
