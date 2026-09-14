import { startRegistration } from '@simplewebauthn/browser'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { EmptyState } from '@/components/feedback/EmptyState'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  alterarSenha,
  atualizarPerfil,
  desativarMfa,
  listarDocumentos,
  listarSessoes,
  obterPerfil,
  regenerarRecuperacao,
  revogarSessao,
  webauthnListarCredenciais,
  webauthnRegistrarConcluir,
  webauthnRegistrarIniciar,
  webauthnRemoverCredencial,
  type Perfil,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { perfilEditavelSchema } from '@/lib/schemas'
import { useMe } from '@/lib/use-me'

// Mesmo schema usado para validar a resposta de GET /auth/perfil (lib/api.ts) — ver
// lib/schemas.ts. Reaproveitar em vez de duplicar é o que faz o "teste de contrato" da v0.2.8
// significar algo: se o campo mudar de nome no backend, o formulário e a leitura quebram
// pelo mesmo motivo, não por dois lugares divergentes.
const schemaPerfil = perfilEditavelSchema
type PerfilForm = z.infer<typeof schemaPerfil>

const schemaSenha = z
  .object({
    senha_atual: z.string().min(1, 'Informe a senha atual.'),
    senha_nova: z
      .string()
      .min(10, 'A senha deve ter pelo menos 10 caracteres.'),
    confirmacao: z.string(),
  })
  .refine((d) => d.senha_nova === d.confirmacao, {
    message: 'As senhas não conferem.',
    path: ['confirmacao'],
  })

const schemaDesativarMfa = z.object({
  senha: z.string().min(1, 'Informe a senha.'),
  codigo_totp: z.string().length(6, 'Informe o código de 6 dígitos.'),
})

const schemaRegenerar = z.object({
  senha: z.string().min(1, 'Informe a senha.'),
})

type Aba = 'dados' | 'seguranca' | 'sessoes' | 'documentos'

function DadosForm({ perfil }: { perfil: Perfil }) {
  const queryClient = useQueryClient()
  const salvar = useMutation({
    mutationFn: atualizarPerfil,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['perfil'] })
      queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  return (
    <FormShell<PerfilForm>
      schema={schemaPerfil}
      defaultValues={{
        email_contato: perfil.email_contato ?? '',
        telefone_whatsapp: perfil.telefone_whatsapp ?? '',
        cep: perfil.endereco?.cep ?? '',
        logradouro: perfil.endereco?.logradouro ?? '',
        numero: perfil.endereco?.numero ?? '',
        bairro: perfil.endereco?.bairro ?? '',
        cidade: perfil.endereco?.cidade ?? '',
        estado: perfil.endereco?.estado ?? '',
      }}
      onSubmit={(v) => salvar.mutateAsync(v)}
    >
      {(form) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">E-mail</label>
              <input
                {...form.register('email_contato')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.email_contato?.message}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Telefone (WhatsApp)</label>
              <input
                {...form.register('telefone_whatsapp')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.telefone_whatsapp?.message}
              />
            </div>
            <div>
              <label className="text-sm font-medium">CEP</label>
              <input
                {...form.register('cep')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Logradouro</label>
              <input
                {...form.register('logradouro')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Número</label>
              <input
                {...form.register('numero')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Bairro</label>
              <input
                {...form.register('bairro')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Cidade</label>
              <input
                {...form.register('cidade')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Estado (UF)</label>
              <input
                {...form.register('estado')}
                maxLength={2}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
              />
            </div>
          </div>
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </>
      )}
    </FormShell>
  )
}

export function PerfilPage() {
  const navigate = useNavigate()
  const [aba, setAba] = useState<Aba>('dados')
  const { data: me } = useMe()
  const { data: perfil, isLoading: perfilCarregando } = useQuery({
    queryKey: ['perfil'],
    queryFn: obterPerfil,
  })

  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'dados', rotulo: 'Dados cadastrais' },
    { id: 'seguranca', rotulo: 'Segurança' },
    { id: 'sessoes', rotulo: 'Sessões ativas' },
    { id: 'documentos', rotulo: 'Meus documentos' },
  ]

  return (
    <>
      <PageHeader
        titulo="Meu perfil"
        descricao="Seus dados, segurança da conta e sessões."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {abas.map((a) => (
          <Button
            key={a.id}
            variant={aba === a.id ? 'default' : 'outline'}
            onClick={() => setAba(a.id)}
          >
            {a.rotulo}
          </Button>
        ))}
      </div>

      {aba === 'dados' && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 font-semibold">Dados cadastrais</h2>
          {perfilCarregando ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : perfil ? (
            <>
              <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Nome:</dt>
                  <dd>{perfil.nome_completo ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">CPF:</dt>
                  <dd>{perfil.cpf ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Categoria:</dt>
                  <dd>{perfil.categoria ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Situação:</dt>
                  <dd>{perfil.status_arrolamento ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">Admissão:</dt>
                  <dd>
                    {perfil.data_admissao
                      ? formatarData(perfil.data_admissao)
                      : '—'}
                  </dd>
                </div>
              </dl>
              <DadosForm perfil={perfil} />
            </>
          ) : (
            <EmptyState
              titulo="Sem associado vinculado"
              descricao="Nenhum cadastro de associado está vinculado a este usuário."
            />
          )}
        </section>
      )}

      {aba === 'seguranca' && (
        <SegurancaSection
          mfaAtivado={!!me?.mfa_ativado}
          onAtivar={() => navigate('/mfa/setup')}
        />
      )}
      {aba === 'sessoes' && <SessoesSection />}
      {aba === 'documentos' && <DocumentosSection />}
    </>
  )
}

function SegurancaSection({
  mfaAtivado,
  onAtivar,
}: {
  mfaAtivado: boolean
  onAtivar: () => void
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 font-semibold">Troca de senha</h2>
        <SenhaForm />
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-1 font-semibold">
          Autenticação em duas etapas (MFA)
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {mfaAtivado
            ? 'O MFA está ativo. Você pode regenerar os códigos de recuperação ou desativá-lo.'
            : 'O MFA está desativado. Ative para proteger sua conta.'}
        </p>
        {mfaAtivado ? (
          <div className="space-y-6">
            <RegenerarForm />
            <DesativarMfaForm />
          </div>
        ) : (
          <Button onClick={onAtivar}>Ativar MFA</Button>
        )}
      </section>

      <PasskeySection />
    </div>
  )
}

function PasskeySection() {
  const queryClient = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const { data: credenciais, isLoading } = useQuery({
    queryKey: ['webauthn-credenciais'],
    queryFn: webauthnListarCredenciais,
  })

  const adicionar = useMutation({
    mutationFn: async () => {
      const { opcoes, desafio_token } = await webauthnRegistrarIniciar()
      const resposta = await startRegistration({ optionsJSON: opcoes as never })
      const apelido = window.prompt(
        'Como quer chamar este dispositivo? (ex.: "Notebook do trabalho")',
      )
      return webauthnRegistrarConcluir({
        credencial: resposta as unknown as Record<string, unknown>,
        desafio_token,
        apelido: apelido || undefined,
      })
    },
    onSuccess: () => {
      setErro(null)
      queryClient.invalidateQueries({ queryKey: ['webauthn-credenciais'] })
    },
    onError: (err) => {
      setErro(err instanceof ApiError ? err.detail : (err as Error).message)
    },
  })

  const remover = useMutation({
    mutationFn: webauthnRemoverCredencial,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['webauthn-credenciais'] }),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-1 font-semibold">Chaves de acesso (passkey)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Entre neste sistema usando a biometria ou PIN do próprio dispositivo
        (Windows Hello, Face ID/Touch ID), sem digitar senha nem código. A
        chave fica só neste dispositivo — adicione um dispositivo por vez.
      </p>

      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : credenciais && credenciais.length > 0 ? (
        <ul className="mb-4 divide-y divide-border">
          {credenciais.map((c) => (
            <li
              key={c.id_credencial}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {c.apelido ?? 'Dispositivo sem nome'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Adicionada em{' '}
                  {c.criado_em ? formatarData(c.criado_em) : '—'}
                  {c.ultimo_uso_em &&
                    ` · último uso em ${formatarData(c.ultimo_uso_em)}`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => remover.mutate(c.id_credencial)}
                disabled={remover.isPending}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted-foreground">
          Nenhuma chave de acesso cadastrada ainda.
        </p>
      )}

      <Button onClick={() => adicionar.mutate()} disabled={adicionar.isPending}>
        {adicionar.isPending
          ? 'Aguardando o dispositivo…'
          : 'Adicionar este dispositivo'}
      </Button>
    </section>
  )
}

function SenhaForm() {
  const trocar = useMutation({ mutationFn: alterarSenha })

  return (
    <FormShell
      schema={schemaSenha}
      defaultValues={{ senha_atual: '', senha_nova: '', confirmacao: '' }}
      onSubmit={(v) =>
        trocar.mutateAsync({
          senha_atual: v.senha_atual,
          senha_nova: v.senha_nova,
        })
      }
    >
      {(form) => (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="text-sm font-medium">Senha atual</label>
            <input
              type="password"
              {...form.register('senha_atual')}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.senha_atual?.message} />
          </div>
          <div>
            <label className="text-sm font-medium">Nova senha</label>
            <input
              type="password"
              {...form.register('senha_nova')}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.senha_nova?.message} />
          </div>
          <div>
            <label className="text-sm font-medium">Confirmação</label>
            <input
              type="password"
              {...form.register('confirmacao')}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.confirmacao?.message} />
          </div>
          <div>
            <Button type="submit" disabled={trocar.isPending}>
              {trocar.isPending ? 'Alterando…' : 'Alterar senha'}
            </Button>
          </div>
        </div>
      )}
    </FormShell>
  )
}

function DesativarMfaForm() {
  const queryClient = useQueryClient()
  const desativar = useMutation({
    mutationFn: desativarMfa,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-destructive">
        Desativar MFA
      </h3>
      <FormShell
        schema={schemaDesativarMfa}
        defaultValues={{ senha: '', codigo_totp: '' }}
        onSubmit={(v) => desativar.mutateAsync(v)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium">Senha</label>
              <input
                type="password"
                {...form.register('senha')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.senha?.message} />
            </div>
            <div>
              <label className="text-sm font-medium">Código TOTP</label>
              <input
                inputMode="numeric"
                {...form.register('codigo_totp')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.codigo_totp?.message}
              />
            </div>
            <div>
              <Button
                type="submit"
                variant="destructive"
                disabled={desativar.isPending}
              >
                {desativar.isPending ? 'Desativando…' : 'Desativar'}
              </Button>
            </div>
          </div>
        )}
      </FormShell>
    </div>
  )
}

function RegenerarForm() {
  const [codigos, setCodigos] = useState<string[] | null>(null)
  const regenerar = useMutation({
    mutationFn: regenerarRecuperacao,
    onSuccess: (r) => setCodigos(r.codigos_recuperacao),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Códigos de recuperação</h3>
      {codigos ? (
        <>
          <p className="text-sm text-muted-foreground">
            Guarde estes códigos. Eles são mostrados uma única vez.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">
            {codigos.map((c) => (
              <li key={c} className="rounded-md bg-muted px-3 py-2 text-center">
                {c}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <FormShell
          schema={schemaRegenerar}
          defaultValues={{ senha: '' }}
          onSubmit={(v) => regenerar.mutateAsync(v)}
        >
          {(form) => (
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-sm font-medium">Senha</label>
                <input
                  type="password"
                  {...form.register('senha')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.senha?.message} />
              </div>
              <Button type="submit" disabled={regenerar.isPending}>
                Regenerar
              </Button>
            </div>
          )}
        </FormShell>
      )}
    </div>
  )
}

function SessoesSection() {
  const queryClient = useQueryClient()
  const { data: sessoes, isLoading } = useQuery({
    queryKey: ['sessoes'],
    queryFn: listarSessoes,
  })
  const revogar = useMutation({
    mutationFn: revogarSessao,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessoes'] }),
  })
  const encerrarTodas = useMutation({
    mutationFn: async () => {
      const outras = (sessoes ?? []).filter((s) => !s.is_atual)
      await Promise.all(outras.map((s) => revogarSessao(s.id_token)))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessoes'] }),
  })

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Sessões ativas</h2>
        {(sessoes ?? []).filter((s) => !s.is_atual).length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => encerrarTodas.mutate()}
            disabled={encerrarTodas.isPending}
          >
            Encerrar todas as outras
          </Button>
        )}
      </div>
      {sessoes && sessoes.length > 0 ? (
        <ul className="divide-y divide-border">
          {sessoes.map((s) => (
            <li
              key={s.id_token}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {s.user_agent ?? 'Dispositivo desconhecido'}
                  {s.is_atual && (
                    <span className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      atual
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  IP {s.ip_origem ?? '—'} · criada em{' '}
                  {s.criado_em ? formatarData(s.criado_em) : '—'}
                </p>
              </div>
              {!s.is_atual && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revogar.mutate(s.id_token)}
                  disabled={revogar.isPending}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          titulo="Nenhuma sessão"
          descricao="Não há sessões ativas registradas."
        />
      )}
    </section>
  )
}

function DocumentosSection() {
  const { data: documentos, isLoading } = useQuery({
    queryKey: ['documentos'],
    queryFn: listarDocumentos,
  })

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Meus documentos</h2>
      {documentos && documentos.length > 0 ? (
        <ul className="divide-y divide-border">
          {documentos.map((d) => (
            <li
              key={d.id_documento}
              className="flex items-center justify-between gap-4 py-3"
            >
              <span className="text-sm">{d.tipo_documento ?? 'Documento'}</span>
              <span className="text-xs text-muted-foreground">
                {d.data_upload ? formatarData(d.data_upload) : '—'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          titulo="Nenhum documento"
          descricao="Nenhum documento anexado ao seu cadastro."
        />
      )}
    </section>
  )
}
