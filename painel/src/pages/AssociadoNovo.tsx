import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError, criarAssociadoMaster, listarOpcoesLegado } from '@/lib/api'
import { useMe } from '@/lib/use-me'
import { associadoMasterSchema } from '@/lib/schemas'
import { cn } from '@/lib/utils'

type AssociadoForm = z.infer<typeof associadoMasterSchema>
type Campo = keyof AssociadoForm

// v9.5e (desenho aprovado pelo Presidente, rodada 4: "fica menos coisa na tela e a pessoa foca naquele passo"): o cadastro em 4 passos - Pessoa,
// Contato, Endereço e Conferir. "Continuar" confere só os campos do passo; no último, o resumo de cada parte com "Corrigir" e o botão de cadastrar.
// O passo aparece em texto e numa barrinha (ele não gostou das bolinhas numeradas). Os campos dos outros passos continuam no formulário (escondidos),
// então nada do que foi digitado se perde ao voltar.
const PASSOS: { nome: string; campos: Campo[] }[] = [
  {
    nome: 'Pessoa',
    campos: [
      'nome_completo',
      'cpf',
      'categoria',
      'data_nascimento',
      'estado_civil',
      'profissao',
      'naturalidade',
    ],
  },
  { nome: 'Contato', campos: ['email_contato', 'telefone_whatsapp'] },
  {
    nome: 'Endereço',
    campos: ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'estado'],
  },
  { nome: 'Conferir', campos: [] },
]
const ULTIMO = PASSOS.length - 1

const ROTULOS: Record<Campo, string> = {
  nome_completo: 'Nome completo',
  cpf: 'CPF',
  categoria: 'Categoria',
  data_nascimento: 'Data de nascimento',
  estado_civil: 'Estado civil',
  profissao: 'Profissão',
  naturalidade: 'Naturalidade',
  email_contato: 'E-mail',
  telefone_whatsapp: 'Telefone (WhatsApp)',
  cep: 'CEP',
  logradouro: 'Logradouro',
  numero: 'Número',
  bairro: 'Bairro',
  cidade: 'Cidade',
  estado: 'Estado (UF)',
}

const classeCampo =
  'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm'

function PassoEmTexto({ atual }: { atual: number }) {
  const proximo = PASSOS[atual + 1]
  return (
    <div className="mb-5">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-extrabold" aria-live="polite">
          Passo {atual + 1} de {PASSOS.length} · {PASSOS[atual]!.nome}
        </span>
        {proximo && (
          <span className="text-xs text-muted-foreground">
            Depois: {proximo.nome}
          </span>
        )}
      </p>
      <div
        className="mt-2 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${PASSOS.length}, 1fr)` }}
        aria-hidden="true"
      >
        {PASSOS.map((p, i) => (
          <span
            key={p.nome}
            className={cn(
              'h-1.5 rounded-full',
              i <= atual ? 'bg-primary' : 'bg-border',
            )}
          />
        ))}
      </div>
    </div>
  )
}

// o resumo de uma parte no passo "Conferir": o que foi digitado e, se o servidor recusou algum campo dela, o motivo (os campos ficam no passo dela)
function ResumoDaParte({
  form,
  indice,
  aoCorrigir,
}: {
  form: UseFormReturn<AssociadoForm>
  indice: number
  aoCorrigir: (indice: number) => void
}) {
  const passo = PASSOS[indice]!
  const valores = form.watch()
  const erros = passo.campos
    .map((c) => form.formState.errors[c]?.message)
    .filter((m): m is string => typeof m === 'string' && m !== '')
  const preenchidos = passo.campos.filter((c) => valores[c])
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        erros.length
          ? 'border-destructive/40 bg-perigo-tinta'
          : 'border-border bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold">{passo.nome}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => aoCorrigir(indice)}
          aria-label={`Corrigir ${passo.nome}`}
        >
          Corrigir
        </Button>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        {preenchidos.map((c) => (
          <div key={c} className="contents">
            <dt className="text-muted-foreground">{ROTULOS[c]}</dt>
            <dd className="font-medium break-words">{valores[c]}</dd>
          </div>
        ))}
      </dl>
      {erros.map((m) => (
        <p key={m} className="mt-2 text-sm font-semibold text-destructive">
          {m}
        </p>
      ))}
    </div>
  )
}

export function AssociadoNovoPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [passo, setPasso] = useState(0)

  const { data: categorias, isLoading: carregandoCategorias } = useQuery({
    queryKey: ['opcoes-legado', 'categoria_associado'],
    queryFn: () => listarOpcoesLegado('categoria_associado'),
  })
  const { data: estadosCivis } = useQuery({
    queryKey: ['opcoes-legado', 'estado_civil'],
    queryFn: () => listarOpcoesLegado('estado_civil'),
  })

  // v5.4c (achado AO VIVO): o servidor barra cadastro parecido com um que já existe e diz "só o Presidente pode forçar", mas esta tela
  // não oferecia como — só a caixa de propostas tinha o "aprovar mesmo assim".
  const { data: eu } = useMe()
  const podeForcar = !!eu?.permissoes.includes('forcar_cadastro_duplicado')
  const [cadastroParecido, setCadastroParecido] = useState(false)

  const criar = useMutation({
    // Campos opcionais chegam como string vazia do formulário (input não preenchido) - o
    // backend espera ausência do campo (None), não "" (Pydantic recusaria "" como data).
    mutationFn: (v: AssociadoForm & { forcar?: boolean }) =>
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

  async function continuar(form: UseFormReturn<AssociadoForm>) {
    if (await form.trigger(PASSOS[passo]!.campos)) {
      setPasso((p) => Math.min(ULTIMO, p + 1))
      window.scrollTo?.({ top: 0 })
    }
  }

  return (
    <>
      <PageHeader
        titulo="Novo associado"
        descricao="Cadastro em 4 passos: a pessoa, o contato, o endereço e a conferência."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Novo associado' },
        ]}
      />

      <section className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
        <PassoEmTexto atual={passo} />
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
          onSubmit={(v) =>
            criar.mutateAsync(v).catch((e: unknown) => {
              if (e instanceof ApiError && e.status === 409)
                setCadastroParecido(true)
              throw e
            })
          }
        >
          {(form) => (
            <>
              {/* 1. Pessoa */}
              <div hidden={passo !== 0} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium">Nome completo *</label>
                  <input
                    {...form.register('nome_completo')}
                    autoComplete="off"
                    className={classeCampo}
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
                    inputMode="numeric"
                    className={classeCampo}
                  />
                  <ErroCampo mensagem={form.formState.errors.cpf?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Categoria *</label>
                  <select
                    {...form.register('categoria')}
                    disabled={carregandoCategorias}
                    className={classeCampo}
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
                    className={classeCampo}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Estado civil</label>
                  <select
                    {...form.register('estado_civil')}
                    className={classeCampo}
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
                    className={classeCampo}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Naturalidade</label>
                  <input
                    {...form.register('naturalidade')}
                    className={classeCampo}
                  />
                </div>
              </div>

              {/* 2. Contato */}
              <div hidden={passo !== 1} className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">E-mail *</label>
                  <input
                    {...form.register('email_contato')}
                    type="email"
                    autoComplete="off"
                    className={classeCampo}
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
                    inputMode="tel"
                    className={classeCampo}
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.telefone_whatsapp?.message}
                  />
                </div>
              </div>

              {/* 3. Endereço */}
              <div hidden={passo !== 2} className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">CEP *</label>
                  <input
                    {...form.register('cep')}
                    placeholder="00000-000"
                    inputMode="numeric"
                    className={classeCampo}
                  />
                  <ErroCampo mensagem={form.formState.errors.cep?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Logradouro *</label>
                  <input
                    {...form.register('logradouro')}
                    className={classeCampo}
                  />
                  <ErroCampo
                    mensagem={form.formState.errors.logradouro?.message}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Número *</label>
                  <input {...form.register('numero')} className={classeCampo} />
                  <ErroCampo mensagem={form.formState.errors.numero?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Bairro *</label>
                  <input {...form.register('bairro')} className={classeCampo} />
                  <ErroCampo mensagem={form.formState.errors.bairro?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Cidade *</label>
                  <input {...form.register('cidade')} className={classeCampo} />
                  <ErroCampo mensagem={form.formState.errors.cidade?.message} />
                </div>
                <div>
                  <label className="text-sm font-medium">Estado (UF) *</label>
                  <input
                    {...form.register('estado')}
                    maxLength={2}
                    className={`${classeCampo} uppercase`}
                  />
                  <ErroCampo mensagem={form.formState.errors.estado?.message} />
                </div>
              </div>

              {/* 4. Conferir */}
              {passo === ULTIMO && (
                <div className="grid gap-3">
                  <p className="text-sm text-muted-foreground">
                    Confira antes de cadastrar. Para mudar alguma coisa, use
                    "Corrigir" na parte.
                  </p>
                  {[0, 1, 2].map((i) => (
                    <ResumoDaParte
                      key={i}
                      form={form}
                      indice={i}
                      aoCorrigir={setPasso}
                    />
                  ))}
                </div>
              )}

              {/* os botões ficam no FIM do formulário, longe da borda de baixo do celular (desenho aprovado, rodada 5) */}
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:flex-wrap">
                {passo === 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => navigate('/associados')}
                  >
                    Cancelar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setPasso((p) => Math.max(0, p - 1))}
                  >
                    Voltar
                  </Button>
                )}
                {passo < ULTIMO ? (
                  <Button
                    type="button"
                    className="min-h-11 sm:min-w-40"
                    onClick={() => continuar(form)}
                  >
                    Continuar
                  </Button>
                ) : (
                  <>
                    <Button
                      type="submit"
                      className="min-h-11"
                      disabled={criar.isPending}
                    >
                      {criar.isPending ? 'Cadastrando…' : 'Cadastrar associado'}
                    </Button>
                    {cadastroParecido && podeForcar && (
                      <Button
                        type="button"
                        variant="destructive"
                        className="min-h-11"
                        disabled={criar.isPending}
                        onClick={form.handleSubmit((v) =>
                          criar.mutateAsync({ ...v, forcar: true }),
                        )}
                      >
                        Cadastrar mesmo assim (confirmo que é outra pessoa)
                      </Button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </FormShell>
      </section>
    </>
  )
}
