import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { EmptyState } from '@/components/feedback/EmptyState'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  adicionarDependente,
  criarCargo,
  editarAssociado,
  encerrarCargo,
  enviarFotoAssociado,
  listarAssociados,
  listarCargos,
  listarDependentesDaPessoa,
  listarOpcoesCatalogo,
  listarOpcoesLegado,
  obterAssociado,
  removerCargo,
  removerDependente,
} from '@/lib/api'
import {
  associadoEditarSchema,
  cargoCriarSchema,
  dependenteCriarSchema,
} from '@/lib/schemas'

type Aba = 'dados' | 'cargos' | 'familia'
type AssociadoEditarForm = z.infer<typeof associadoEditarSchema>

// v2.5.1 (FASE 2.5 - Painel) - completa o módulo Associados: editar dados/foto, gerenciar
// cargos e vínculos familiares. Antes disso só existia via `/admin/secretaria` (removida em
// 2026-09-15) - nenhuma dessas ações tinha tela no painel único.
export function AssociadoDetalhePage() {
  const { id } = useParams<{ id: string }>()
  const idAssociado = Number(id)
  const navigate = useNavigate()
  const [aba, setAba] = useState<Aba>('dados')

  const { data: associado, isLoading } = useQuery({
    queryKey: ['associado', idAssociado],
    queryFn: () => obterAssociado(idAssociado),
  })

  const abas: { id: Aba; rotulo: string }[] = [
    { id: 'dados', rotulo: 'Dados e foto' },
    { id: 'cargos', rotulo: 'Cargos' },
    { id: 'familia', rotulo: 'Família' },
  ]

  return (
    <>
      <PageHeader
        titulo={associado?.nome_completo ?? 'Associado'}
        descricao={
          associado
            ? `Matrícula ${associado.numero_matricula ?? '—'} · CPF ${associado.cpf}`
            : undefined
        }
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Detalhe' },
        ]}
        acoes={
          <Button variant="outline" onClick={() => navigate('/associados')}>
            Voltar
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !associado ? (
        <EmptyState titulo="Associado não encontrado" />
      ) : (
        <>
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
            <DadosEFotoTab idAssociado={idAssociado} associado={associado} />
          )}
          {aba === 'cargos' && <CargosTab idAssociado={idAssociado} />}
          {aba === 'familia' && (
            <FamiliaTab idPessoaTitular={associado.id_pessoa} />
          )}
        </>
      )}
    </>
  )
}

function DadosEFotoTab({
  idAssociado,
  associado,
}: {
  idAssociado: number
  associado: NonNullable<
    ReturnType<
      typeof useQuery<Awaited<ReturnType<typeof obterAssociado>>>
    >['data']
  >
}) {
  const queryClient = useQueryClient()
  const [erroFoto, setErroFoto] = useState<string | null>(null)

  const { data: categorias } = useQuery({
    queryKey: ['opcoes-legado', 'categoria_associado'],
    queryFn: () => listarOpcoesLegado('categoria_associado'),
  })
  const { data: estadosCivis } = useQuery({
    queryKey: ['opcoes-legado', 'estado_civil'],
    queryFn: () => listarOpcoesLegado('estado_civil'),
  })

  const salvar = useMutation({
    mutationFn: (v: AssociadoEditarForm) =>
      editarAssociado(idAssociado, {
        ...v,
        data_nascimento: v.data_nascimento || undefined,
        estado_civil: v.estado_civil || undefined,
        profissao: v.profissao || undefined,
        naturalidade: v.naturalidade || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['associado', idAssociado] })
      queryClient.invalidateQueries({ queryKey: ['associados'] })
    },
  })

  const enviarFoto = useMutation({
    mutationFn: (arquivo: File) => enviarFotoAssociado(idAssociado, arquivo),
    onSuccess: () => {
      setErroFoto(null)
      queryClient.invalidateQueries({ queryKey: ['associado', idAssociado] })
    },
    onError: (err) => setErroFoto((err as Error).message),
  })

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 font-semibold">Foto</h2>
        <div className="flex items-center gap-4">
          {associado.foto ? (
            <img
              src={associado.foto}
              alt=""
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
              Sem foto
            </div>
          )}
          <div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const arquivo = e.target.files?.[0]
                if (arquivo) enviarFoto.mutate(arquivo)
              }}
              disabled={enviarFoto.isPending}
              className="text-sm"
            />
            {erroFoto && (
              <p className="mt-1 text-sm text-destructive">{erroFoto}</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 font-semibold">Dados cadastrais</h2>
        <FormShell<AssociadoEditarForm>
          schema={associadoEditarSchema}
          defaultValues={{
            nome_completo: associado.nome_completo,
            email_contato: associado.email_contato,
            telefone_whatsapp: associado.telefone_whatsapp,
            categoria: associado.categoria,
            cep: associado.endereco.cep,
            logradouro: associado.endereco.logradouro,
            numero: associado.endereco.numero,
            bairro: associado.endereco.bairro,
            cidade: associado.endereco.cidade,
            estado: associado.endereco.estado,
            data_nascimento: associado.data_nascimento ?? '',
            estado_civil: associado.estado_civil ?? '',
            profissao: associado.profissao ?? '',
            naturalidade: associado.naturalidade ?? '',
          }}
          onSubmit={(v) => salvar.mutateAsync(v)}
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
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
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

              <h3 className="pt-2 text-sm font-semibold">Endereço</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">CEP *</label>
                  <input
                    {...form.register('cep')}
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

              <Button type="submit" disabled={salvar.isPending}>
                {salvar.isPending ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            </>
          )}
        </FormShell>
      </section>
    </div>
  )
}

function CargosTab({ idAssociado }: { idAssociado: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: cargos, isLoading } = useQuery({
    queryKey: ['cargos', idAssociado],
    queryFn: () => listarCargos(idAssociado),
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['cargos', idAssociado] })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof cargoCriarSchema>) =>
      criarCargo(idAssociado, v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const encerrar = useMutation({
    mutationFn: (idHistorico: number) =>
      encerrarCargo(idHistorico, new Date().toISOString().slice(0, 10)),
    onSuccess: invalidar,
  })
  const remover = useMutation({
    mutationFn: removerCargo,
    onSuccess: invalidar,
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Histórico de cargos</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Registrar posse'}
        </Button>
      </div>

      {mostrarForm && (
        <div className="mb-6 rounded-lg border border-border p-4">
          <FormShell<z.infer<typeof cargoCriarSchema>>
            schema={cargoCriarSchema}
            defaultValues={{
              titulo_cargo: '',
              data_posse: new Date().toISOString().slice(0, 10),
            }}
            onSubmit={(v) => criar.mutateAsync(v)}
          >
            {(form) => (
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-sm font-medium">Cargo *</label>
                  <input
                    {...form.register('titulo_cargo')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.titulo_cargo?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Data de posse *</label>
                  <input
                    type="date"
                    {...form.register('data_posse')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <Button type="submit" disabled={criar.isPending}>
                  {criar.isPending ? 'Registrando…' : 'Registrar'}
                </Button>
              </div>
            )}
          </FormShell>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !cargos?.length ? (
        <EmptyState titulo="Nenhum cargo registrado ainda" />
      ) : (
        <ul className="divide-y divide-border">
          {cargos.map((c) => (
            <li
              key={c.id_historico}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{c.titulo_cargo}</p>
                <p className="text-xs text-muted-foreground">
                  Posse em {c.data_posse ?? '—'}
                  {c.data_saida ? ` · saiu em ${c.data_saida}` : ' · vigente'}
                </p>
              </div>
              <div className="flex gap-2">
                {!c.data_saida && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => encerrar.mutate(c.id_historico)}
                    disabled={encerrar.isPending}
                  >
                    Encerrar hoje
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => remover.mutate(c.id_historico)}
                  disabled={remover.isPending}
                >
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FamiliaTab({ idPessoaTitular }: { idPessoaTitular: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: dependentes, isLoading } = useQuery({
    queryKey: ['dependentes', idPessoaTitular],
    queryFn: () => listarDependentesDaPessoa(idPessoaTitular),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: graus } = useQuery({
    queryKey: ['catalogo-opcoes', 'grau_parentesco'],
    queryFn: () => listarOpcoesCatalogo('grau_parentesco'),
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['dependentes', idPessoaTitular],
    })
  }

  const adicionar = useMutation({
    mutationFn: (v: z.infer<typeof dependenteCriarSchema>) =>
      adicionarDependente(idPessoaTitular, v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const remover = useMutation({
    mutationFn: removerDependente,
    onSuccess: invalidar,
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Vínculos familiares</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Adicionar familiar'}
        </Button>
      </div>

      {mostrarForm && (
        <div className="mb-6 rounded-lg border border-border p-4">
          <FormShell<z.infer<typeof dependenteCriarSchema>>
            schema={dependenteCriarSchema}
            defaultValues={{ grau_parentesco: '', nome_completo: '' }}
            onSubmit={(v) => adicionar.mutateAsync(v)}
          >
            {(form) => (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">
                    Grau de parentesco *
                  </label>
                  <select
                    {...form.register('grau_parentesco')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Selecione…</option>
                    {(graus ?? []).map((o) => (
                      <option key={o.id_opcao} value={o.codigo}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                  <ErroCampo
                    mensagem={form.formState.errors.grau_parentesco?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Já é associado?</label>
                  <select
                    {...form.register('id_pessoa_vinculada')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Não - é uma pessoa nova</option>
                    {(associados ?? []).map((a) => (
                      <option key={a.id_associado} value={a.id_associado}>
                        {a.nome_completo}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    O seletor acima lista associados - se for um familiar sem
                    cadastro (ex.: filho menor), deixe em branco e informe o
                    nome abaixo.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Nome (se pessoa nova)
                  </label>
                  <input
                    {...form.register('nome_completo')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.nome_completo?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Data de nascimento (se pessoa nova)
                  </label>
                  <input
                    type="date"
                    {...form.register('data_nascimento')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
                <Button type="submit" disabled={adicionar.isPending}>
                  {adicionar.isPending ? 'Adicionando…' : 'Adicionar'}
                </Button>
              </div>
            )}
          </FormShell>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !dependentes?.length ? (
        <EmptyState titulo="Nenhum vínculo familiar registrado ainda" />
      ) : (
        <ul className="divide-y divide-border">
          {dependentes.map((d) => (
            <li
              key={d.id_dependente}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">
                  {d.nome_completo ?? '(sem nome)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.grau_parentesco}
                  {d.e_associado
                    ? ' · é associado'
                    : ' · sem cadastro de associado'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => remover.mutate(d.id_dependente)}
                disabled={remover.isPending}
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
