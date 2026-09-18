import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HeartHandshake } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'

import { EmptyState } from '@/components/feedback/EmptyState'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  cancelarAlocacao,
  candidatarSeAVaga,
  listarMeuHistoricoHoras,
  listarMinhaEscala,
  listarVagasAbertas,
  registrarMinhasHoras,
  solicitarTrocaTurno,
  type AlocacaoVoluntario,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  horasVoluntariadoAutoatendimentoSchema,
  trocaTurnoCriarSchema,
} from '@/lib/schemas'

const CORES_STATUS: Record<string, string> = {
  PENDENTE: 'text-amber-600',
  CONFIRMADA: 'text-green-600',
  RECUSADA: 'text-destructive',
  CANCELADA: 'text-muted-foreground',
}

// v4.4 (FASE 4) - autoatendimento do voluntário: candidatar-se a uma vaga de turno, ver a própria
// escala/histórico de horas e pedir troca de turno - mesmo padrão de "Minhas assembleias"
// (v2.5.3b): tela fora de qualquer módulo com permissão própria, porque o nível "Voluntário
// Externo" não tem nenhuma permissão de módulo (ver seed_niveis_e_permissoes no backend) - só
// precisa estar autenticado e vinculado a um associado.
function CardAlocacao({ alocacao }: { alocacao: AlocacaoVoluntario }) {
  const queryClient = useQueryClient()
  const [mostrarTroca, setMostrarTroca] = useState(false)

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['minha-escala'] })
    setMostrarTroca(false)
  }

  const cancelar = useMutation({
    mutationFn: () => cancelarAlocacao(alocacao.id_alocacao),
    onSuccess: invalidar,
  })
  const solicitarTroca = useMutation({
    mutationFn: (v: z.infer<typeof trocaTurnoCriarSchema>) =>
      solicitarTrocaTurno(alocacao.id_alocacao, v),
    onSuccess: invalidar,
  })

  const podeAgir =
    alocacao.status === 'PENDENTE' || alocacao.status === 'CONFIRMADA'

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{alocacao.funcao_desempenhada}</p>
          {alocacao.turno_data_hora_inicio && (
            <p className="text-sm text-muted-foreground">
              {formatarData(alocacao.turno_data_hora_inicio, { comHora: true })}{' '}
              até{' '}
              {alocacao.turno_data_hora_fim &&
                formatarData(alocacao.turno_data_hora_fim, { comHora: true })}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Horas previstas: {alocacao.horas_previstas} · Realizadas:{' '}
            {alocacao.horas_realizadas}
          </p>
        </div>
        <span
          className={`shrink-0 text-sm font-medium ${CORES_STATUS[alocacao.status] ?? ''}`}
        >
          {alocacao.status}
        </span>
      </div>

      {podeAgir && (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={cancelar.isPending}
            onClick={() => cancelar.mutate()}
          >
            Cancelar
          </Button>
          {alocacao.status === 'CONFIRMADA' && (
            <Button
              size="sm"
              variant={mostrarTroca ? 'default' : 'outline'}
              onClick={() => setMostrarTroca((v) => !v)}
            >
              Pedir troca de turno
            </Button>
          )}
        </div>
      )}

      {mostrarTroca && (
        <FormShell<z.infer<typeof trocaTurnoCriarSchema>>
          schema={trocaTurnoCriarSchema}
          defaultValues={{ id_associado_substituto: 0, motivo: '' }}
          onSubmit={(v) => solicitarTroca.mutateAsync(v)}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        >
          {(form) => (
            <>
              <div>
                <label className="text-sm font-medium">
                  Nº do associado substituto
                </label>
                <input
                  type="number"
                  {...form.register('id_associado_substituto')}
                  className="mt-1 h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={
                    form.formState.errors.id_associado_substituto?.message
                  }
                />
              </div>
              <div className="min-w-[16rem] flex-1">
                <label className="text-sm font-medium">Motivo</label>
                <input
                  {...form.register('motivo')}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={solicitarTroca.isPending}
              >
                {solicitarTroca.isPending ? 'Enviando…' : 'Solicitar troca'}
              </Button>
              {solicitarTroca.isError && (
                <p className="w-full text-sm text-destructive">
                  {(solicitarTroca.error as Error).message}
                </p>
              )}
            </>
          )}
        </FormShell>
      )}
    </div>
  )
}

function SecaoVagasAbertas() {
  const queryClient = useQueryClient()
  const { data: vagas } = useQuery({
    queryKey: ['vagas-abertas'],
    queryFn: listarVagasAbertas,
  })
  const candidatar = useMutation({
    mutationFn: (idVaga: number) => candidatarSeAVaga(idVaga),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vagas-abertas'] })
      queryClient.invalidateQueries({ queryKey: ['minha-escala'] })
    },
  })

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Vagas abertas para candidatura</h2>
      <div className="space-y-2">
        {(vagas ?? []).map((v) => (
          <div
            key={v.id_vaga}
            className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
          >
            <div>
              <p className="font-medium">{v.funcao_desempenhada}</p>
              <p className="text-muted-foreground">
                {formatarData(v.turno_data_hora_inicio, { comHora: true })} até{' '}
                {formatarData(v.turno_data_hora_fim, { comHora: true })} ·{' '}
                {v.vagas_livres} vaga(s) livre(s)
              </p>
              {v.habilidades_exigidas && (
                <p className="text-muted-foreground">
                  Habilidades: {v.habilidades_exigidas}
                </p>
              )}
            </div>
            <Button
              size="sm"
              disabled={candidatar.isPending}
              onClick={() => candidatar.mutate(v.id_vaga)}
            >
              Candidatar-se
            </Button>
          </div>
        ))}
        {(vagas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma vaga aberta no momento.
          </p>
        )}
        {candidatar.isError && (
          <p className="text-sm text-destructive">
            {(candidatar.error as Error).message}
          </p>
        )}
      </div>
    </section>
  )
}

function SecaoMeuHistoricoHoras() {
  const queryClient = useQueryClient()
  const { data: historico } = useQuery({
    queryKey: ['meu-historico-horas'],
    queryFn: listarMeuHistoricoHoras,
  })
  const { data: escala } = useQuery({
    queryKey: ['minha-escala'],
    queryFn: listarMinhaEscala,
  })

  const registrar = useMutation({
    mutationFn: (v: z.infer<typeof horasVoluntariadoAutoatendimentoSchema>) =>
      registrarMinhasHoras(v),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['meu-historico-horas'] }),
  })

  const alocacoesConfirmadas = (escala ?? []).filter(
    (a) => a.status === 'CONFIRMADA',
  )

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Meu histórico de horas</h2>
      <FormShell<z.infer<typeof horasVoluntariadoAutoatendimentoSchema>>
        schema={horasVoluntariadoAutoatendimentoSchema}
        defaultValues={{ data: '', horas: 0, descricao_atividade: '' }}
        onSubmit={(v) => registrar.mutateAsync(v)}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
      >
        {(form) => (
          <>
            <div>
              <label className="text-sm font-medium">Data</label>
              <input
                type="date"
                {...form.register('data')}
                className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.data?.message} />
            </div>
            <div>
              <label className="text-sm font-medium">Horas</label>
              <input
                type="number"
                step="0.5"
                {...form.register('horas')}
                className="mt-1 h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.horas?.message} />
            </div>
            <div className="min-w-[14rem] flex-1">
              <label className="text-sm font-medium">Atividade</label>
              <input
                {...form.register('descricao_atividade')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Alocação (opcional)</label>
              <select
                {...form.register('id_alocacao')}
                className="mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sem alocação</option>
                {alocacoesConfirmadas.map((a) => (
                  <option key={a.id_alocacao} value={a.id_alocacao}>
                    {a.funcao_desempenhada}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={registrar.isPending}>
              {registrar.isPending ? 'Registrando…' : 'Registrar horas'}
            </Button>
            {registrar.isError && (
              <p className="w-full text-sm text-destructive">
                {(registrar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(historico ?? []).map((r) => (
          <div
            key={r.id_registro}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            <span>
              {formatarData(r.data)} — {r.horas}h
              {r.descricao_atividade && ` · ${r.descricao_atividade}`}
            </span>
            <span className={CORES_STATUS[r.status] ?? ''}>{r.status}</span>
          </div>
        ))}
        {(historico ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma hora registrada ainda.
          </p>
        )}
      </div>
    </section>
  )
}

export function MeuVoluntariadoPage() {
  const { data: escala, isLoading } = useQuery({
    queryKey: ['minha-escala'],
    queryFn: listarMinhaEscala,
  })

  return (
    <>
      <PageHeader
        titulo="Meu voluntariado"
        descricao="Candidate-se a turnos, acompanhe sua escala e registre suas horas de voluntariado."
      />

      <SecaoVagasAbertas />

      <section className="mb-6">
        <h2 className="mb-4 font-semibold">Minha escala</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (escala ?? []).length === 0 ? (
          <EmptyState
            icone={HeartHandshake}
            titulo="Você ainda não está em nenhuma escala"
            descricao="Candidate-se a uma vaga aberta acima para aparecer aqui."
          />
        ) : (
          <div className="grid gap-4">
            {(escala ?? []).map((a) => (
              <CardAlocacao key={a.id_alocacao} alocacao={a} />
            ))}
          </div>
        )}
      </section>

      <SecaoMeuHistoricoHoras />
    </>
  )
}
