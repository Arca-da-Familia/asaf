import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  anexarDocumentoAssinado,
  ApiError,
  assinarAta,
  atualizarRelatoSecretaria,
  concluirDeliberacao,
  criarDeliberacao,
  emitirCertidao,
  gerarAta,
  listarAssociados,
  listarCertidoes,
  listarDeliberacoesDaAta,
  obterAssembleia,
  obterAtaDaAssembleia,
  retificarAta,
  revogarDeliberacao,
  urlArquivo,
  type Ata,
  type Deliberacao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  ataRetificarSchema,
  deliberacaoCriarSchema,
  deliberacaoRevogarSchema,
  mandatoCriarSchema,
} from '@/lib/schemas'

const CORES_STATUS_EXECUCAO: Record<string, string> = {
  Pendente: 'text-amber-600',
  Concluída: 'text-green-600',
  Revogada: 'text-destructive',
}

function BlocoCertidoes({ idDeliberacao }: { idDeliberacao: number }) {
  const queryClient = useQueryClient()
  const { data: certidoes } = useQuery({
    queryKey: ['certidoes', idDeliberacao],
    queryFn: () => listarCertidoes(idDeliberacao),
  })
  const [ultimoTexto, setUltimoTexto] = useState<string | null>(null)

  const emitir = useMutation({
    mutationFn: () => emitirCertidao(idDeliberacao),
    onSuccess: (certidao) => {
      setUltimoTexto(certidao.texto_gerado ?? null)
      queryClient.invalidateQueries({
        queryKey: ['certidoes', idDeliberacao],
      })
    },
  })

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {(certidoes ?? []).length} certidão(ões) emitida(s)
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={emitir.isPending}
          onClick={() => emitir.mutate()}
        >
          {emitir.isPending ? 'Emitindo…' : 'Emitir certidão'}
        </Button>
      </div>
      {ultimoTexto && (
        <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
          {ultimoTexto}
        </pre>
      )}
    </div>
  )
}

function LinhaDeliberacao({ deliberacao }: { deliberacao: Deliberacao }) {
  const queryClient = useQueryClient()
  const [aba, setAba] = useState<'nenhuma' | 'concluir' | 'revogar'>('nenhuma')
  const [observacao, setObservacao] = useState('')
  const [mandato, setMandato] = useState<z.infer<
    typeof mandatoCriarSchema
  > | null>(null)

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['deliberacoes', deliberacao.id_ata],
    })
    setAba('nenhuma')
  }

  const concluir = useMutation({
    mutationFn: () =>
      concluirDeliberacao(deliberacao.id_deliberacao, {
        observacao: observacao || undefined,
        mandatos_criar: mandato ? [mandato] : [],
      }),
    onSuccess: invalidar,
  })
  const revogar = useMutation({
    mutationFn: (v: z.infer<typeof deliberacaoRevogarSchema>) =>
      revogarDeliberacao(deliberacao.id_deliberacao, v.motivo),
    onSuccess: invalidar,
  })

  const ehEleicao = deliberacao.tipo === 'Eleição'

  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{deliberacao.tipo}</p>
          <p className="text-muted-foreground">{deliberacao.texto}</p>
          {deliberacao.ano_exercicio && (
            <p className="text-xs text-muted-foreground">
              Exercício {deliberacao.ano_exercicio}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 font-medium ${CORES_STATUS_EXECUCAO[deliberacao.status_execucao] ?? ''}`}
        >
          {deliberacao.status_execucao}
        </span>
      </div>

      {deliberacao.status_execucao === 'Pendente' && (
        <div className="mt-2 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setAba((a) => (a === 'concluir' ? 'nenhuma' : 'concluir'))
            }
          >
            Concluir
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setAba((a) => (a === 'revogar' ? 'nenhuma' : 'revogar'))
            }
          >
            Revogar
          </Button>
        </div>
      )}

      {deliberacao.observacao_conclusao && (
        <p className="mt-2 text-xs text-muted-foreground">
          {deliberacao.status_execucao === 'Revogada' ? 'Motivo' : 'Observação'}
          : {deliberacao.observacao_conclusao}
        </p>
      )}

      {aba === 'concluir' && (
        <div className="mt-3 space-y-2 rounded-md border border-border p-3">
          <input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Observação da conclusão"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          {ehEleicao && <FormMandato onChange={setMandato} />}
          <Button
            size="sm"
            disabled={concluir.isPending || (ehEleicao && !mandato)}
            onClick={() => concluir.mutate()}
          >
            {concluir.isPending ? 'Concluindo…' : 'Concluir deliberação'}
          </Button>
          {concluir.isError && (
            <p className="text-sm text-destructive">
              {(concluir.error as Error).message}
            </p>
          )}
          {concluir.data?.pendencia && (
            <p className="text-sm text-amber-600">{concluir.data.pendencia}</p>
          )}
        </div>
      )}

      {aba === 'revogar' && (
        <FormShell<z.infer<typeof deliberacaoRevogarSchema>>
          schema={deliberacaoRevogarSchema}
          defaultValues={{ motivo: '' }}
          onSubmit={(v) => revogar.mutateAsync(v)}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <div className="min-w-[16rem] flex-1">
                <input
                  {...form.register('motivo')}
                  placeholder="Motivo da revogação"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              </div>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={revogar.isPending}
              >
                {revogar.isPending ? 'Revogando…' : 'Revogar'}
              </Button>
            </>
          )}
        </FormShell>
      )}

      {deliberacao.status_execucao === 'Concluída' && (
        <BlocoCertidoes idDeliberacao={deliberacao.id_deliberacao} />
      )}
    </div>
  )
}

function FormMandato({
  onChange,
}: {
  onChange: (v: z.infer<typeof mandatoCriarSchema> | null) => void
}) {
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const [valores, setValores] = useState({
    id_associado: 0,
    orgao_codigo: '',
    cargo_codigo: '',
    data_inicio: '',
  })

  function atualizar(campo: keyof typeof valores, valor: string) {
    const novo = { ...valores, [campo]: valor }
    setValores(novo)
    const parsed = mandatoCriarSchema.safeParse({
      ...novo,
      id_associado: Number(novo.id_associado),
    })
    onChange(parsed.success ? parsed.data : null)
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Mandato criado junto (Eleição, v2.1)
      </p>
      <select
        value={valores.id_associado}
        onChange={(e) => atualizar('id_associado', e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="0">Selecione o eleito…</option>
        {(associados ?? []).map((a) => (
          <option key={a.id_associado} value={a.id_associado}>
            {a.nome_completo}
          </option>
        ))}
      </select>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={valores.orgao_codigo}
          onChange={(e) => atualizar('orgao_codigo', e.target.value)}
          placeholder="Órgão (ex.: DIRETORIA_EXECUTIVA)"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <input
          value={valores.cargo_codigo}
          onChange={(e) => atualizar('cargo_codigo', e.target.value)}
          placeholder="Cargo (ex.: PRESIDENTE)"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <input
          type="date"
          value={valores.data_inicio}
          onChange={(e) => atualizar('data_inicio', e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
    </div>
  )
}

function BlocoDeliberacoes({ idAta }: { idAta: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)

  const { data: deliberacoes } = useQuery({
    queryKey: ['deliberacoes', idAta],
    queryFn: () => listarDeliberacoesDaAta(idAta),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof deliberacaoCriarSchema>) =>
      criarDeliberacao(idAta, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliberacoes', idAta] })
      setMostrarForm(false)
    },
  })

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Deliberações</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Registrar deliberação'}
        </Button>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof deliberacaoCriarSchema>>
          schema={deliberacaoCriarSchema}
          defaultValues={{ tipo: 'Genérica', texto: '' }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-4 space-y-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <select
                {...form.register('tipo')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="Genérica">Genérica</option>
                <option value="Eleição">Eleição</option>
                <option value="Reforma de estatuto">Reforma de estatuto</option>
                <option value="Aprovação de contas">Aprovação de contas</option>
                <option value="Dissolução">Dissolução</option>
              </select>
              {form.watch('tipo') === 'Aprovação de contas' && (
                <input
                  type="number"
                  {...form.register('ano_exercicio')}
                  placeholder="Ano de exercício"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              )}
              <textarea
                {...form.register('texto')}
                rows={3}
                placeholder="Texto da deliberação"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.texto?.message} />
              <Button type="submit" size="sm" disabled={criar.isPending}>
                {criar.isPending ? 'Registrando…' : 'Registrar'}
              </Button>
              {criar.isError && (
                <p className="text-sm text-destructive">
                  {(criar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(deliberacoes ?? []).map((d) => (
          <LinhaDeliberacao key={d.id_deliberacao} deliberacao={d} />
        ))}
        {(deliberacoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma deliberação registrada ainda.
          </p>
        )}
      </div>
    </section>
  )
}

function BlocoAta({
  ata,
  onAtaAtualizada,
}: {
  ata: Ata
  onAtaAtualizada: (a: Ata) => void
}) {
  const [relato, setRelato] = useState(ata.relato_secretaria ?? '')
  const [mostrarRetificar, setMostrarRetificar] = useState(false)
  const emRascunho = ata.status === 'Rascunho'

  const salvarRelato = useMutation({
    mutationFn: () => atualizarRelatoSecretaria(ata.id_ata, relato),
    onSuccess: onAtaAtualizada,
  })
  const assinar = useMutation({
    mutationFn: () => assinarAta(ata.id_ata),
    onSuccess: onAtaAtualizada,
  })
  const retificar = useMutation({
    mutationFn: (v: z.infer<typeof ataRetificarSchema>) =>
      retificarAta(ata.id_ata, v.motivo),
    onSuccess: (nova) => {
      onAtaAtualizada(nova)
      setMostrarRetificar(false)
    },
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">
          Ata{' '}
          {ata.numero_sequencial ? `nº ${ata.numero_sequencial}` : '(rascunho)'}
        </h2>
        <span className={emRascunho ? 'text-amber-600' : 'text-green-600'}>
          {ata.status}
        </span>
      </div>
      {ata.id_ata_retificada && (
        <p className="mb-2 text-sm text-muted-foreground">
          Retificação da ata #{ata.id_ata_retificada} — motivo:{' '}
          {ata.motivo_retificacao}
        </p>
      )}

      <p className="mb-3 rounded-md border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-400">
        Isto é um registro interno do sistema, sem valor cartorial — não é
        assinatura digital ICP-Brasil. O corpo abaixo é texto pra copiar para o
        documento oficial (Word/PDF), que continua sendo assinado à mão (ou com
        certificado digital de verdade) fora do sistema. O documento real se
        anexa mais abaixo, depois de pronto.
      </p>

      <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
        Corpo da ata (gerado do registro da sessão - copie para o documento
        oficial)
      </p>
      <pre className="mb-4 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
        {ata.corpo_texto}
      </pre>

      <label className="text-sm font-medium">
        Relato da secretaria (único texto livre)
      </label>
      <textarea
        value={relato}
        disabled={!emRascunho}
        onChange={(e) => setRelato(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {emRascunho && (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={salvarRelato.isPending}
              onClick={() => salvarRelato.mutate()}
            >
              {salvarRelato.isPending ? 'Salvando…' : 'Salvar relato'}
            </Button>
            <Button
              size="sm"
              disabled={assinar.isPending}
              onClick={() => assinar.mutate()}
            >
              {assinar.isPending
                ? 'Travando…'
                : 'Travar registro interno (numerar)'}
            </Button>
          </>
        )}
        {!emRascunho && !ata.id_ata_retificada && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarRetificar((v) => !v)}
          >
            {mostrarRetificar ? 'Cancelar' : 'Retificar (corrigir sem editar)'}
          </Button>
        )}
      </div>

      {mostrarRetificar && (
        <FormShell<z.infer<typeof ataRetificarSchema>>
          schema={ataRetificarSchema}
          defaultValues={{ motivo: '' }}
          onSubmit={(v) => retificar.mutateAsync(v)}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <div className="min-w-[16rem] flex-1">
                <input
                  {...form.register('motivo')}
                  placeholder="Motivo da retificação"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.motivo?.message} />
              </div>
              <Button type="submit" size="sm" disabled={retificar.isPending}>
                {retificar.isPending ? 'Criando…' : 'Criar retificação'}
              </Button>
            </>
          )}
        </FormShell>
      )}

      <BlocoDocumentoAssinado ata={ata} onAtaAtualizada={onAtaAtualizada} />
    </section>
  )
}

function BlocoDocumentoAssinado({
  ata,
  onAtaAtualizada,
}: {
  ata: Ata
  onAtaAtualizada: (a: Ata) => void
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [numeroProtocolo, setNumeroProtocolo] = useState(
    ata.numero_protocolo_cartorio ?? '',
  )
  const [dataProtocolo, setDataProtocolo] = useState(
    ata.data_protocolo_cartorio?.slice(0, 10) ?? '',
  )

  const anexar = useMutation({
    mutationFn: () => {
      if (!arquivo)
        throw new Error('Selecione o arquivo do documento assinado.')
      return anexarDocumentoAssinado(ata.id_ata, arquivo, {
        numero_protocolo_cartorio: numeroProtocolo || undefined,
        data_protocolo_cartorio: dataProtocolo || undefined,
      })
    },
    onSuccess: onAtaAtualizada,
  })

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="mb-1 text-sm font-semibold">
        Documento oficial (assinado, e protocolado no cartório se houver)
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Este é o documento que de fato vale — o PDF/foto do papel assinado pela
        diretoria, com o número de protocolo se já foi levado ao cartório.
      </p>

      {ata.arquivo_documento_assinado && (
        <p className="mb-3 text-sm">
          <a
            href={urlArquivo(ata.arquivo_documento_assinado)}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Ver documento anexado
          </a>
          {ata.numero_protocolo_cartorio && (
            <>
              {' '}
              · Protocolo {ata.numero_protocolo_cartorio}
              {ata.data_protocolo_cartorio &&
                ` em ${formatarData(ata.data_protocolo_cartorio)}`}
            </>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <input
          value={numeroProtocolo}
          onChange={(e) => setNumeroProtocolo(e.target.value)}
          placeholder="Nº de protocolo no cartório (opcional)"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <input
          type="date"
          value={dataProtocolo}
          onChange={(e) => setDataProtocolo(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={anexar.isPending || !arquivo}
          onClick={() => anexar.mutate()}
        >
          {anexar.isPending
            ? 'Enviando…'
            : ata.arquivo_documento_assinado
              ? 'Substituir anexo'
              : 'Anexar documento'}
        </Button>
      </div>
      {anexar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(anexar.error as Error).message}
        </p>
      )}
    </div>
  )
}

// v2.5.4 (FASE 2.5 - Painel) - ata (gerada do registro, nunca digitada livre - ver
// app/services/ata.py) e deliberações vinculadas. Só existe depois de "Realizada" - a sessão
// precisa ter acontecido pra ter o que registrar.
export function AtaAssembleiaPage() {
  const { id } = useParams<{ id: string }>()
  const idAssembleia = Number(id)
  const queryClient = useQueryClient()

  const { data: assembleia } = useQuery({
    queryKey: ['assembleia', idAssembleia],
    queryFn: () => obterAssembleia(idAssembleia),
  })

  const { data: ata, isLoading } = useQuery({
    queryKey: ['ata', idAssembleia],
    queryFn: () => obterAtaDaAssembleia(idAssembleia),
    retry: false,
  })

  const gerar = useMutation({
    mutationFn: () => gerarAta(idAssembleia),
    onSuccess: (nova) => queryClient.setQueryData(['ata', idAssembleia], nova),
  })

  function atualizarAtaLocal(nova: Ata) {
    queryClient.setQueryData(['ata', idAssembleia], nova)
  }

  if (!assembleia) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  const ataNaoExiste =
    !ata &&
    !isLoading &&
    !(gerar.error instanceof ApiError && gerar.error.status !== 404)

  return (
    <>
      <PageHeader
        titulo={`Ata — Assembleia ${assembleia.tipo}`}
        descricao="Gerada do registro da sessão, deliberações e certidões."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          {
            rotulo: `Assembleia ${assembleia.tipo}`,
            href: `/governanca/${idAssembleia}`,
          },
          { rotulo: 'Ata' },
        ]}
      />

      {assembleia.status !== 'Realizada' ? (
        <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          A ata só existe depois da sessão encerrada (&quot;Realizada&quot;) —
          esta assembleia está &quot;{assembleia.status}&quot;.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : ata ? (
        <>
          <BlocoAta ata={ata} onAtaAtualizada={atualizarAtaLocal} />
          <BlocoDeliberacoes idAta={ata.id_ata} />
        </>
      ) : ataNaoExiste ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="mb-3 text-sm text-muted-foreground">
            Esta assembleia ainda não tem ata gerada.
          </p>
          <Button disabled={gerar.isPending} onClick={() => gerar.mutate()}>
            {gerar.isPending ? 'Gerando…' : 'Gerar ata'}
          </Button>
          {gerar.isError && (
            <p className="mt-2 text-sm text-destructive">
              {(gerar.error as Error).message}
            </p>
          )}
        </div>
      ) : null}
    </>
  )
}
