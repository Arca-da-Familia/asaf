import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { EmptyState } from '@/components/feedback/EmptyState'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { SituacaoGuardadaECalculada } from '@/components/associados/CompletudeECategoria'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { Button } from '@/components/ui/button'
import {
  anonimizarAssociado,
  desligarAssociado,
  listarHistoricoDeSituacao,
  listarOpcoesCatalogo,
  readmitirAssociado,
  registrarLicenca,
  type MudancaDeSituacao,
  type OpcaoDeCatalogo,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  desligamentoSchema,
  licencaSchema,
  readmissaoSchema,
} from '@/lib/schemas'

type Acao = 'licenca' | 'desligamento' | 'readmissao' | null

const ROTULO_DO_TIPO: Record<string, string> = {
  licenca: 'Licença',
  desligamento: 'Desligamento',
  readmissao: 'Readmissão',
}

const campoClasse =
  'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

// Licença e desligamento guardam um DIA (o servidor grava meia-noite sem fuso). Passar isso por `formatarData` como se fosse um instante
// em UTC faz o dia recuar no Brasil (05/10 aparecia como 04/10 — achado AO VIVO na homologação). Só a readmissão guarda o instante de verdade.
function diaDoEvento(m: MudancaDeSituacao): string {
  return m.tipo === 'readmissao' ? m.data_efetiva : m.data_efetiva.slice(0, 10)
}

function rotuloDoMotivo(
  motivo: string | null,
  opcoes: OpcaoDeCatalogo[] | undefined,
): string {
  if (!motivo) return '—'
  return opcoes?.find((o) => o.codigo === motivo)?.rotulo ?? motivo
}

// v1.4 no servidor, tela só na v5.4c (achado AO VIVO na homologação, 2026-10-05): licença, desligamento, readmissão, histórico e
// anonimização existiam como rotas, testadas, e nenhuma tela as chamava — quem cuida do cadastro não tinha como usá-las.
export function SituacaoDoAssociado({
  idAssociado,
  nome,
  situacao,
}: {
  idAssociado: number
  nome: string
  situacao: string | null
}) {
  const queryClient = useQueryClient()
  const [acao, setAcao] = useState<Acao>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<
    null | 'desligar' | 'anonimizar'
  >(null)
  const [desligamentoPendente, setDesligamentoPendente] = useState<z.infer<
    typeof desligamentoSchema
  > | null>(null)

  const desligado = situacao === 'Desligado'

  const { data: historico, isLoading } = useQuery({
    queryKey: ['historico-situacao', idAssociado],
    queryFn: () => listarHistoricoDeSituacao(idAssociado),
  })
  const { data: motivosLicenca } = useQuery({
    queryKey: ['catalogo-opcoes', 'motivo_licenca'],
    queryFn: () => listarOpcoesCatalogo('motivo_licenca'),
  })
  const { data: motivosDesligamento } = useQuery({
    queryKey: ['catalogo-opcoes', 'motivo_desligamento'],
    queryFn: () => listarOpcoesCatalogo('motivo_desligamento'),
  })

  function atualizarTela() {
    queryClient.invalidateQueries({ queryKey: ['associado', idAssociado] })
    queryClient.invalidateQueries({
      queryKey: ['historico-situacao', idAssociado],
    })
    queryClient.invalidateQueries({ queryKey: ['associados'] })
    queryClient.invalidateQueries({
      queryKey: ['categoria-calculada', idAssociado],
    })
  }

  function concluir(mensagem: string) {
    setErro(null)
    setAviso(mensagem)
    setAcao(null)
    setConfirmando(null)
    setDesligamentoPendente(null)
    atualizarTela()
  }

  function falhar(e: unknown) {
    setAviso(null)
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    setConfirmando(null)
  }

  const licenca = useMutation({
    mutationFn: (v: z.infer<typeof licencaSchema>) =>
      registrarLicenca(idAssociado, {
        ...v,
        documento_referencia: v.documento_referencia || undefined,
      }),
    onSuccess: (r) => concluir(r.mensagem),
  })
  const desligar = useMutation({
    mutationFn: (v: z.infer<typeof desligamentoSchema>) =>
      desligarAssociado(idAssociado, {
        ...v,
        documento_referencia: v.documento_referencia || undefined,
      }),
    onSuccess: (r) =>
      concluir(
        `${r.mensagem} ${r.titulos_cancelados} cobrança(s) futura(s) cancelada(s).`,
      ),
    onError: falhar,
  })
  const readmitir = useMutation({
    mutationFn: (v: z.infer<typeof readmissaoSchema>) =>
      readmitirAssociado(idAssociado, {
        cpf: v.cpf || undefined,
        email_contato: v.email_contato || undefined,
        telefone_whatsapp: v.telefone_whatsapp || undefined,
      }),
    onSuccess: (r) => concluir(r.mensagem),
  })
  const anonimizar = useMutation({
    mutationFn: () => anonimizarAssociado(idAssociado),
    onSuccess: (r) => concluir(r.mensagem),
    onError: falhar,
  })

  return (
    <div className="v3-space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Situação do associado</h2>
            <p className="mt-1 text-sm">
              Situação atual:{' '}
              <strong data-testid="situacao-atual">{situacao ?? '—'}</strong>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!desligado && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAcao(acao === 'licenca' ? null : 'licenca')}
                >
                  Registrar licença
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAcao(acao === 'desligamento' ? null : 'desligamento')
                  }
                >
                  Desligar associado
                </Button>
              </>
            )}
            {desligado && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAcao(acao === 'readmissao' ? null : 'readmissao')
                  }
                >
                  Readmitir associado
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmando('anonimizar')}
                >
                  Anonimizar dado pessoal
                </Button>
              </>
            )}
          </div>
        </div>

        {aviso && (
          <p
            role="status"
            className="mt-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
          >
            {aviso}
          </p>
        )}
        {erro && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}

        {acao === 'licenca' && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <FormShell<z.infer<typeof licencaSchema>>
              schema={licencaSchema}
              defaultValues={{
                motivo: '',
                data_inicio: hoje(),
                data_fim_prevista: '',
                documento_referencia: '',
              }}
              onSubmit={(v) => licenca.mutateAsync(v)}
            >
              {(form) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="licenca-motivo"
                      className="text-sm font-medium"
                    >
                      Motivo *
                    </label>
                    <select
                      id="licenca-motivo"
                      {...form.register('motivo')}
                      className={campoClasse}
                    >
                      <option value="">Selecione…</option>
                      {(motivosLicenca ?? []).map((o) => (
                        <option key={o.id_opcao} value={o.codigo}>
                          {o.rotulo}
                        </option>
                      ))}
                    </select>
                    <ErroCampo
                      mensagem={form.formState.errors.motivo?.message}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="licenca-inicio"
                      className="text-sm font-medium"
                    >
                      Início da licença *
                    </label>
                    <input
                      id="licenca-inicio"
                      type="date"
                      {...form.register('data_inicio')}
                      className={campoClasse}
                    />
                    <ErroCampo
                      mensagem={form.formState.errors.data_inicio?.message}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="licenca-fim"
                      className="text-sm font-medium"
                    >
                      Retorno previsto *
                    </label>
                    <input
                      id="licenca-fim"
                      type="date"
                      {...form.register('data_fim_prevista')}
                      className={campoClasse}
                    />
                    <ErroCampo
                      mensagem={
                        form.formState.errors.data_fim_prevista?.message
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="licenca-documento"
                      className="text-sm font-medium"
                    >
                      Documento de referência
                    </label>
                    <input
                      id="licenca-documento"
                      {...form.register('documento_referencia')}
                      placeholder="Ex.: ata, ofício, atestado"
                      className={campoClasse}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={licenca.isPending}>
                      {licenca.isPending ? 'Registrando…' : 'Confirmar licença'}
                    </Button>
                  </div>
                </div>
              )}
            </FormShell>
          </div>
        )}

        {acao === 'desligamento' && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <FormShell<z.infer<typeof desligamentoSchema>>
              schema={desligamentoSchema}
              defaultValues={{
                motivo: '',
                data_efetiva: hoje(),
                documento_referencia: '',
              }}
              onSubmit={(v) => {
                setDesligamentoPendente(v)
                setConfirmando('desligar')
              }}
            >
              {(form) => (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="deslig-motivo"
                      className="text-sm font-medium"
                    >
                      Motivo *
                    </label>
                    <select
                      id="deslig-motivo"
                      {...form.register('motivo')}
                      className={campoClasse}
                    >
                      <option value="">Selecione…</option>
                      {(motivosDesligamento ?? []).map((o) => (
                        <option key={o.id_opcao} value={o.codigo}>
                          {o.rotulo}
                        </option>
                      ))}
                    </select>
                    <ErroCampo
                      mensagem={form.formState.errors.motivo?.message}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="deslig-data"
                      className="text-sm font-medium"
                    >
                      Data do desligamento *
                    </label>
                    <input
                      id="deslig-data"
                      type="date"
                      {...form.register('data_efetiva')}
                      className={campoClasse}
                    />
                    <ErroCampo
                      mensagem={form.formState.errors.data_efetiva?.message}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="deslig-documento"
                      className="text-sm font-medium"
                    >
                      Documento de referência
                    </label>
                    <input
                      id="deslig-documento"
                      {...form.register('documento_referencia')}
                      placeholder="Ex.: ata da reunião que decidiu"
                      className={campoClasse}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" variant="destructive">
                      Desligar associado…
                    </Button>
                  </div>
                </div>
              )}
            </FormShell>
          </div>
        )}

        {acao === 'readmissao' && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Volta o mesmo cadastro (nenhum cadastro novo), devolve o acesso ao
              painel e a carteirinha. Preencha CPF, e-mail e telefone{' '}
              <strong>só se o dado pessoal já foi anonimizado</strong>.
            </p>
            <FormShell<z.infer<typeof readmissaoSchema>>
              schema={readmissaoSchema}
              defaultValues={{
                cpf: '',
                email_contato: '',
                telefone_whatsapp: '',
              }}
              onSubmit={(v) => readmitir.mutateAsync(v)}
            >
              {(form) => (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor="readm-cpf" className="text-sm font-medium">
                      CPF (se anonimizado)
                    </label>
                    <input
                      id="readm-cpf"
                      {...form.register('cpf')}
                      className={campoClasse}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="readm-email"
                      className="text-sm font-medium"
                    >
                      E-mail (se anonimizado)
                    </label>
                    <input
                      id="readm-email"
                      {...form.register('email_contato')}
                      className={campoClasse}
                    />
                  </div>
                  <div>
                    <label htmlFor="readm-tel" className="text-sm font-medium">
                      Telefone (se anonimizado)
                    </label>
                    <input
                      id="readm-tel"
                      {...form.register('telefone_whatsapp')}
                      className={campoClasse}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Button type="submit" disabled={readmitir.isPending}>
                      {readmitir.isPending
                        ? 'Readmitindo…'
                        : 'Confirmar readmissão'}
                    </Button>
                  </div>
                </div>
              )}
            </FormShell>
          </div>
        )}
      </section>

      <SituacaoGuardadaECalculada idAssociado={idAssociado} />

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 font-semibold">Histórico de situação</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !historico?.length ? (
          <EmptyState titulo="Nenhuma mudança de situação registrada" />
        ) : (
          <ul className="divide-y divide-border">
            {historico.map((m: MudancaDeSituacao) => (
              <li key={m.id_mudanca} className="py-3">
                <p className="text-sm font-medium">
                  {ROTULO_DO_TIPO[m.tipo] ?? m.tipo}
                  {m.motivo &&
                    ` — ${rotuloDoMotivo(
                      m.motivo,
                      m.tipo === 'licenca'
                        ? motivosLicenca
                        : motivosDesligamento,
                    )}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Em {formatarData(diaDoEvento(m))}
                  {m.data_fim_prevista &&
                    ` · retorno previsto em ${formatarData(m.data_fim_prevista.slice(0, 10))}`}
                  {m.documento_referencia &&
                    ` · documento: ${m.documento_referencia}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        aberto={confirmando === 'desligar'}
        onAbertoChange={(aberto) => {
          if (!aberto) setConfirmando(null)
        }}
        titulo={`Desligar ${nome}?`}
        descricao="O desligamento revoga o acesso ao painel, deixa a carteirinha sem valor e cancela as cobranças futuras ainda pendentes. O dado financeiro continua guardado. Dá para readmitir depois."
        rotuloConfirmar="Desligar associado"
        carregando={desligar.isPending}
        onConfirmar={() => {
          if (desligamentoPendente) desligar.mutate(desligamentoPendente)
        }}
      />
      <ConfirmDialog
        aberto={confirmando === 'anonimizar'}
        onAbertoChange={(aberto) => {
          if (!aberto) setConfirmando(null)
        }}
        titulo={`Anonimizar o dado pessoal de ${nome}?`}
        descricao="Apaga de forma definitiva o CPF, o contato e o endereço deste cadastro. O sistema só permite depois que o prazo de retenção do desligamento terminar; antes disso ele recusa e nada muda."
        rotuloConfirmar="Anonimizar dado pessoal"
        carregando={anonimizar.isPending}
        onConfirmar={() => anonimizar.mutate()}
      />
    </div>
  )
}
