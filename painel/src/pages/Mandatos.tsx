import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  criarMandato,
  declararConflitoInteresse,
  encerrarConflitoInteresse,
  encerrarMandato,
  listarAssociados,
  listarConflitosInteresse,
  listarMandatos,
  listarOpcoesCatalogo,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  declaracaoConflitoCriarSchema,
  mandatoCriarSchema,
  mandatoEncerrarSchema,
} from '@/lib/schemas'

// v2.5.5 (FASE 2.5 - Painel) - Mandatos/órgãos (backend v2.1) e conflito de interesse (Art. 20,
// §único) nunca tiveram tela própria: só apareciam embutidos dentro da conclusão de uma
// deliberação de "Eleição" (Ata.tsx, v2.5.4). Esta tela cobre o resto do ciclo de vida -
// registrar posse fora de uma eleição (ex.: recomposição por vacância, Art. 26), encerrar
// mandato antecipadamente e declarar/encerrar conflito de interesse - sem duplicar nenhuma
// regra que o backend já valida.
function BlocoEncerrarMandato({
  idMandato,
  onFechar,
}: {
  idMandato: number
  onFechar: () => void
}) {
  const queryClient = useQueryClient()
  const encerrar = useMutation({
    mutationFn: (v: z.infer<typeof mandatoEncerrarSchema>) =>
      encerrarMandato(idMandato, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mandatos'] })
      onFechar()
    },
  })

  return (
    <FormShell<z.infer<typeof mandatoEncerrarSchema>>
      schema={mandatoEncerrarSchema}
      defaultValues={{ motivo: 'Renúncia', referencia_ato: '' }}
      onSubmit={(v) => encerrar.mutateAsync(v)}
      className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-3"
    >
      {(form) => (
        <>
          <select
            {...form.register('motivo')}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="Renúncia">Renúncia</option>
            <option value="Destituição">Destituição</option>
            <option value="Impedimento temporário">
              Impedimento temporário
            </option>
          </select>
          <input
            {...form.register('referencia_ato')}
            placeholder="Referência do ato (opcional)"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={encerrar.isPending}>
              {encerrar.isPending ? 'Encerrando…' : 'Confirmar encerramento'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onFechar}
            >
              Cancelar
            </Button>
          </div>
          {encerrar.isError && (
            <p className="text-sm text-destructive">
              {(encerrar.error as Error).message}
            </p>
          )}
          {encerrar.data?.pendencia && (
            <p className="text-sm text-amber-600">
              {encerrar.data.pendencia}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

function BlocoMandatos() {
  const [apenasVigentes, setApenasVigentes] = useState(true)
  const [idParaEncerrar, setIdParaEncerrar] = useState<number | null>(null)
  const [mostrarNovo, setMostrarNovo] = useState(false)
  const queryClient = useQueryClient()

  const { data: mandatos } = useQuery({
    queryKey: ['mandatos', apenasVigentes],
    queryFn: () => listarMandatos({ apenasVigentes }),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: orgaos } = useQuery({
    queryKey: ['opcoes-catalogo', 'orgao_direcao'],
    queryFn: () => listarOpcoesCatalogo('orgao_direcao'),
  })
  const { data: cargos } = useQuery({
    queryKey: ['opcoes-catalogo', 'titulo_cargo'],
    queryFn: () => listarOpcoesCatalogo('titulo_cargo'),
  })

  const nomesPorId = new Map(
    (associados ?? []).map((a) => [a.id_associado, a.nome_completo]),
  )
  const rotuloOrgao = new Map((orgaos ?? []).map((o) => [o.codigo, o.rotulo]))
  const rotuloCargo = new Map((cargos ?? []).map((o) => [o.codigo, o.rotulo]))

  const criar = useMutation({
    // Campos opcionais em branco chegam do formulário como '' (react-hook-form nunca deixa
    // undefined um input registrado) - backend espera ausência do campo (ou null), não uma
    // string vazia tentando virar data (mesmo padrão já usado em BlocoPauta::criarItemPauta).
    mutationFn: (v: z.infer<typeof mandatoCriarSchema>) =>
      criarMandato({
        ...v,
        data_fim_previsto: v.data_fim_previsto || undefined,
        ato_origem: v.ato_origem || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mandatos'] })
      setMostrarNovo(false)
    },
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Mandatos por órgão e cargo</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={apenasVigentes}
              onChange={(e) => setApenasVigentes(e.target.checked)}
            />
            Só vigentes
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarNovo((v) => !v)}
          >
            {mostrarNovo ? 'Cancelar' : 'Registrar mandato'}
          </Button>
        </div>
      </div>

      {mostrarNovo && (
        <FormShell<z.infer<typeof mandatoCriarSchema>>
          schema={mandatoCriarSchema}
          defaultValues={{
            id_associado: 0,
            orgao_codigo: '',
            cargo_codigo: '',
            data_inicio: '',
            data_fim_previsto: '',
            ato_origem: '',
          }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
        >
          {(form) => (
            <>
              <div>
                <select
                  {...form.register('id_associado')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="0">Selecione o associado…</option>
                  {(associados ?? []).map((a) => (
                    <option key={a.id_associado} value={a.id_associado}>
                      {a.nome_completo}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={form.formState.errors.id_associado?.message}
                />
              </div>
              <div>
                <select
                  {...form.register('orgao_codigo')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o órgão…</option>
                  {(orgaos ?? []).map((o) => (
                    <option key={o.codigo} value={o.codigo}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={form.formState.errors.orgao_codigo?.message}
                />
              </div>
              <div>
                <select
                  {...form.register('cargo_codigo')}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o cargo…</option>
                  {(cargos ?? []).map((o) => (
                    <option key={o.codigo} value={o.codigo}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
                <ErroCampo
                  mensagem={form.formState.errors.cargo_codigo?.message}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Data de início</label>
                <input
                  type="date"
                  {...form.register('data_inicio')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.data_inicio?.message}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  Data de fim previsto (opcional)
                </label>
                <input
                  type="date"
                  {...form.register('data_fim_previsto')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Em branco, usa a duração padrão do mandato (regra
                  estatutária vigente).
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Ato de origem (opcional)
                </label>
                <input
                  {...form.register('ato_origem')}
                  placeholder="Ex.: Ata nº 3, deliberação de eleição"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={criar.isPending}>
                  {criar.isPending ? 'Registrando…' : 'Registrar mandato'}
                </Button>
                {criar.isError && (
                  <p className="mt-2 text-sm text-destructive">
                    {(criar.error as Error).message}
                  </p>
                )}
              </div>
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(mandatos ?? []).map((m) => (
          <div
            key={m.id_mandato}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {nomesPorId.get(m.id_associado) ??
                  `Associado #${m.id_associado}`}
              </p>
              <span
                className={
                  m.vigente
                    ? 'font-medium text-green-600'
                    : 'text-muted-foreground'
                }
              >
                {m.vigente ? 'Vigente' : 'Encerrado'}
              </span>
            </div>
            <p className="text-muted-foreground">
              {rotuloOrgao.get(m.orgao_codigo) ?? m.orgao_codigo} ·{' '}
              {rotuloCargo.get(m.cargo_codigo) ?? m.cargo_codigo}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatarData(m.data_inicio)} até{' '}
              {formatarData(m.data_fim_efetivo ?? m.data_fim_previsto)}
              {m.data_fim_efetivo && ' (encerramento antecipado)'}
              {m.motivo_encerramento && ` - ${m.motivo_encerramento}`}
            </p>
            {m.vigente && idParaEncerrar !== m.id_mandato && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setIdParaEncerrar(m.id_mandato)}
              >
                Encerrar mandato
              </Button>
            )}
            {idParaEncerrar === m.id_mandato && (
              <BlocoEncerrarMandato
                idMandato={m.id_mandato}
                onFechar={() => setIdParaEncerrar(null)}
              />
            )}
          </div>
        ))}
        {(mandatos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum mandato {apenasVigentes ? 'vigente' : 'registrado'} ainda.
          </p>
        )}
      </div>
    </section>
  )
}

function BlocoConflitoInteresse() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const queryClient = useQueryClient()

  const { data: declaracoes } = useQuery({
    queryKey: ['conflitos-interesse'],
    queryFn: () => listarConflitosInteresse(),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const nomesPorId = new Map(
    (associados ?? []).map((a) => [a.id_associado, a.nome_completo]),
  )

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['conflitos-interesse'] })
  }

  const declarar = useMutation({
    mutationFn: (v: z.infer<typeof declaracaoConflitoCriarSchema>) =>
      declararConflitoInteresse(v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const encerrar = useMutation({
    mutationFn: (idDeclaracao: number) =>
      encerrarConflitoInteresse(idDeclaracao),
    onSuccess: invalidar,
  })

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Declarações de conflito de interesse</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Declarar conflito'}
        </Button>
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof declaracaoConflitoCriarSchema>>
          schema={declaracaoConflitoCriarSchema}
          defaultValues={{ id_associado: 0, descricao: '' }}
          onSubmit={(v) => declarar.mutateAsync(v)}
          className="mb-4 space-y-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <select
                {...form.register('id_associado')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Selecione o associado…</option>
                {(associados ?? []).map((a) => (
                  <option key={a.id_associado} value={a.id_associado}>
                    {a.nome_completo}
                  </option>
                ))}
              </select>
              <input
                {...form.register('descricao')}
                placeholder="Descreva o conflito de interesse"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.descricao?.message} />
              <Button type="submit" size="sm" disabled={declarar.isPending}>
                {declarar.isPending ? 'Declarando…' : 'Declarar'}
              </Button>
              {declarar.isError && (
                <p className="text-sm text-destructive">
                  {(declarar.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}

      <div className="space-y-2">
        {(declaracoes ?? []).map((d) => (
          <div
            key={d.id_declaracao}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {nomesPorId.get(d.id_associado) ??
                  `Associado #${d.id_associado}`}
              </p>
              {d.ativa && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={encerrar.isPending}
                  onClick={() => encerrar.mutate(d.id_declaracao)}
                >
                  Encerrar
                </Button>
              )}
            </div>
            <p className="text-muted-foreground">{d.descricao}</p>
            <p className="text-xs text-muted-foreground">
              Declarado em {formatarData(d.criado_em, { comHora: true })}
            </p>
          </div>
        ))}
        {(declaracoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma declaração ativa.
          </p>
        )}
      </div>
    </section>
  )
}

export function MandatosPage() {
  return (
    <>
      <PageHeader
        titulo="Mandatos e órgãos"
        descricao="Posse, encerramento e conflito de interesse (Art. 20/26)."
        trilha={[{ rotulo: 'Governança', href: '/governanca' }, { rotulo: 'Mandatos' }]}
      />
      <BlocoMandatos />
      <BlocoConflitoInteresse />
    </>
  )
}
