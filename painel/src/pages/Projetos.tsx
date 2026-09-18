import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  adicionarMembroEquipe,
  alterarStatusProjeto,
  aprovarHorasVoluntariado,
  concluirItemCronograma,
  confirmarAlocacao,
  confirmarTrocaTurno,
  criarBeneficiario,
  criarItemCronograma,
  criarProjeto,
  criarVagaEscala,
  encerrarParticipacaoEquipe,
  gerarRelatorioFinalProjeto,
  listarAssociados,
  listarAtendimentos,
  listarBeneficiarios,
  listarBeneficiariosDoProjeto,
  listarCandidaturasPendentes,
  listarCentrosCusto,
  listarCronograma,
  listarEncaminhamentos,
  listarEquipeProjeto,
  listarHorasPendentesDoProjeto,
  listarOpcoesCatalogo,
  listarProjetos,
  listarRelatoriosFinaisProjeto,
  listarTrocasTurno,
  listarVagasEscala,
  obterOrcamentoDoProjeto,
  recusarAlocacao,
  recusarHorasVoluntariado,
  recusarTrocaTurno,
  registrarAtendimento,
  registrarEncaminhamento,
  vincularBeneficiarioAoProjeto,
  type Projeto,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  beneficiarioCriarSchema,
  encaminhamentoCriarSchema,
  equipeProjetoCriarSchema,
  itemCronogramaCriarSchema,
  projetoCriarSchema,
  registroAtendimentoCriarSchema,
  vagaEscalaCriarSchema,
  vincularBeneficiarioSchema,
} from '@/lib/schemas'

// v4.1 (FASE 4) - Projeto como entidade única e configurável: tipo/status de catálogo,
// cronograma com status sempre derivado (nunca escolhido à mão), equipe com papel, orçamento via
// centro de custo (reaproveita o motor Orcamento, v3.5) e encerramento formal versionado.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioProjeto({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: tiposProjeto } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_projeto'],
    queryFn: () => listarOpcoesCatalogo('tipo_projeto'),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof projetoCriarSchema>) => criarProjeto(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projetos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof projetoCriarSchema>>
      schema={projetoCriarSchema}
      defaultValues={{
        nome_projeto: '',
        tipo_foco: '',
        necessita_alvara_bombeiros: false,
        data_inicio: '',
        data_fim_prevista: '',
        descricao: '',
        publico_alvo: '',
        visibilidade: 'Interna',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div className="sm:col-span-2">
            <input
              {...form.register('nome_projeto')}
              placeholder="Nome do projeto"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.nome_projeto?.message} />
          </div>
          <div>
            <input
              {...form.register('tipo_foco')}
              placeholder="Foco (ex.: Social, Educacional)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.tipo_foco?.message} />
          </div>
          <div>
            <select
              {...form.register('tipo_projeto')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Tipo de projeto…</option>
              {(tiposProjeto ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Data de início
            </label>
            <input
              type="date"
              {...form.register('data_inicio')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.data_inicio?.message} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Data de fim prevista
            </label>
            <input
              type="date"
              {...form.register('data_fim_prevista')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.data_fim_prevista?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_associado_responsavel')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Responsável…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              {...form.register('id_centro_custo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem centro de custo</option>
              {(centros ?? []).map((c) => (
                <option key={c.id_centro_custo} value={c.id_centro_custo}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <input
              {...form.register('publico_alvo')}
              placeholder="Público-alvo"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <textarea
              {...form.register('descricao')}
              placeholder="Descrição"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <select
              {...form.register('visibilidade')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Interna">Interna</option>
              <option value="Pública">Pública</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...form.register('necessita_alvara_bombeiros')}
            />
            Necessita alvará dos bombeiros
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Criar projeto'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelar}
            >
              Cancelar
            </Button>
          </div>
          {criar.isError && (
            <p className="text-sm text-destructive sm:col-span-2">
              {(criar.error as Error).message}
            </p>
          )}
        </>
      )}
    </FormShell>
  )
}

function SecaoCronograma({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const { data: cronograma } = useQuery({
    queryKey: ['cronograma-projeto', idProjeto],
    queryFn: () => listarCronograma(idProjeto),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof itemCronogramaCriarSchema>) =>
      criarItemCronograma(idProjeto, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['cronograma-projeto', idProjeto],
      }),
  })
  const concluir = useMutation({
    mutationFn: (idItem: number) => concluirItemCronograma(idItem),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['cronograma-projeto', idProjeto],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Cronograma</h3>
      <FormShell<z.infer<typeof itemCronogramaCriarSchema>>
        schema={itemCronogramaCriarSchema}
        defaultValues={{ tipo: 'Marco', titulo: '', prazo: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <select
              {...form.register('tipo')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Marco">Marco</option>
              <option value="Tarefa">Tarefa</option>
            </select>
            <div className="flex-1">
              <input
                {...form.register('titulo')}
                placeholder="Título"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.titulo?.message} />
            </div>
            <input
              type="date"
              {...form.register('prazo')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <select
              {...form.register('id_associado_responsavel')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Responsável…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar
            </Button>
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(cronograma ?? []).map((item) => (
          <div
            key={item.id_item}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            <span>
              [{item.tipo}] {item.titulo} — prazo {formatarData(item.prazo)}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={
                  item.status === 'Atrasado'
                    ? 'text-destructive'
                    : item.status === 'Concluído'
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                }
              >
                {item.status}
              </span>
              {item.status !== 'Concluído' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => concluir.mutate(item.id_item)}
                >
                  Concluir
                </Button>
              )}
            </div>
          </div>
        ))}
        {(cronograma ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum item de cronograma.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoEquipe({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const { data: equipe } = useQuery({
    queryKey: ['equipe-projeto', idProjeto],
    queryFn: () => listarEquipeProjeto(idProjeto),
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })
  const { data: papeis } = useQuery({
    queryKey: ['opcoes-catalogo', 'papel_equipe_projeto'],
    queryFn: () => listarOpcoesCatalogo('papel_equipe_projeto'),
  })

  const adicionar = useMutation({
    mutationFn: (v: z.infer<typeof equipeProjetoCriarSchema>) =>
      adicionarMembroEquipe(idProjeto, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['equipe-projeto', idProjeto],
      }),
  })
  const encerrar = useMutation({
    mutationFn: (idMembro: number) => encerrarParticipacaoEquipe(idMembro),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['equipe-projeto', idProjeto],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Equipe</h3>
      <FormShell<z.infer<typeof equipeProjetoCriarSchema>>
        schema={equipeProjetoCriarSchema}
        defaultValues={{ id_associado: 0, papel: '' }}
        onSubmit={(v) => adicionar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <select
              {...form.register('id_associado')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Associado…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <select
              {...form.register('papel')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Papel…</option>
              {(papeis ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" disabled={adicionar.isPending}>
              Adicionar
            </Button>
            {adicionar.isError && (
              <p className="text-sm text-destructive">
                {(adicionar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(equipe ?? []).map((m) => {
          const associado = (associados ?? []).find(
            (a) => a.id_associado === m.id_associado,
          )
          return (
            <div
              key={m.id_membro}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span>
                {associado?.nome_completo ?? `Associado #${m.id_associado}`} —{' '}
                {m.papel}
                {m.data_fim && ' (encerrado)'}
              </span>
              {!m.data_fim && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => encerrar.mutate(m.id_membro)}
                >
                  Encerrar
                </Button>
              )}
            </div>
          )
        })}
        {(equipe ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum membro na equipe.
          </p>
        )}
      </div>
    </div>
  )
}

// v4.4 (FASE 4) - escala de voluntariado vinculada a projeto: vaga de turno publicada pelo
// coordenador, candidatura autoatendida (tela "Meu Voluntariado", fora deste módulo), confirmação/
// recusa aqui, troca de turno entre voluntários e aprovação de horas - tudo do lado de quem
// GERE o projeto (permissão "projetos"); a visão do próprio voluntário é outra tela.
function SecaoVoluntariado({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const { data: vagas } = useQuery({
    queryKey: ['vagas-escala', idProjeto],
    queryFn: () => listarVagasEscala(idProjeto),
  })
  const { data: candidaturas } = useQuery({
    queryKey: ['candidaturas-pendentes', idProjeto],
    queryFn: () => listarCandidaturasPendentes(idProjeto),
  })
  const { data: trocas } = useQuery({
    queryKey: ['trocas-turno', idProjeto],
    queryFn: () => listarTrocasTurno(idProjeto),
  })
  const { data: horasPendentes } = useQuery({
    queryKey: ['horas-pendentes', idProjeto],
    queryFn: () => listarHorasPendentesDoProjeto(idProjeto),
  })

  function invalidarTudo() {
    queryClient.invalidateQueries({ queryKey: ['vagas-escala', idProjeto] })
    queryClient.invalidateQueries({
      queryKey: ['candidaturas-pendentes', idProjeto],
    })
    queryClient.invalidateQueries({ queryKey: ['trocas-turno', idProjeto] })
    queryClient.invalidateQueries({ queryKey: ['horas-pendentes', idProjeto] })
  }

  const criarVaga = useMutation({
    mutationFn: (v: z.infer<typeof vagaEscalaCriarSchema>) =>
      criarVagaEscala(idProjeto, v),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['vagas-escala', idProjeto] }),
  })
  const confirmar = useMutation({
    mutationFn: (idAlocacao: number) => confirmarAlocacao(idAlocacao),
    onSuccess: invalidarTudo,
  })
  const recusar = useMutation({
    mutationFn: (idAlocacao: number) => recusarAlocacao(idAlocacao),
    onSuccess: invalidarTudo,
  })
  const confirmarTroca = useMutation({
    mutationFn: (idTroca: number) => confirmarTrocaTurno(idTroca),
    onSuccess: invalidarTudo,
  })
  const recusarTroca = useMutation({
    mutationFn: (idTroca: number) => recusarTrocaTurno(idTroca),
    onSuccess: invalidarTudo,
  })
  const aprovarHoras = useMutation({
    mutationFn: (idRegistro: number) => aprovarHorasVoluntariado(idRegistro),
    onSuccess: invalidarTudo,
  })
  const recusarHoras = useMutation({
    mutationFn: (idRegistro: number) => recusarHorasVoluntariado(idRegistro),
    onSuccess: invalidarTudo,
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Voluntariado — escala, candidaturas, trocas e horas
      </h3>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Vagas de turno
        </p>
        <FormShell<z.infer<typeof vagaEscalaCriarSchema>>
          schema={vagaEscalaCriarSchema}
          defaultValues={{
            funcao_desempenhada: '',
            turno_data_hora_inicio: '',
            turno_data_hora_fim: '',
            habilidades_exigidas: '',
            vagas_disponiveis: 1,
            horas_previstas: 0,
          }}
          onSubmit={(v) => criarVaga.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <div className="flex-1">
                <input
                  {...form.register('funcao_desempenhada')}
                  placeholder="Função (ex.: Apoio na cozinha)"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.funcao_desempenhada?.message}
                />
              </div>
              <input
                type="datetime-local"
                {...form.register('turno_data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="datetime-local"
                {...form.register('turno_data_hora_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                {...form.register('habilidades_exigidas')}
                placeholder="Habilidades (códigos separados por vírgula)"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="number"
                min={1}
                {...form.register('vagas_disponiveis')}
                placeholder="Vagas"
                className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="number"
                min={0}
                step="0.5"
                {...form.register('horas_previstas')}
                placeholder="Horas previstas"
                className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" size="sm" disabled={criarVaga.isPending}>
                Publicar vaga
              </Button>
            </>
          )}
        </FormShell>
        <div className="space-y-1">
          {(vagas ?? []).map((v) => (
            <div
              key={v.id_vaga}
              className="rounded-md border border-border p-2 text-sm"
            >
              {v.funcao_desempenhada} —{' '}
              {formatarData(v.turno_data_hora_inicio, { comHora: true })} até{' '}
              {formatarData(v.turno_data_hora_fim, { comHora: true })} ·{' '}
              {v.vagas_disponiveis} vaga(s)
            </div>
          ))}
          {(vagas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma vaga de escala publicada.
            </p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Candidaturas pendentes (autocandidatura pelo painel)
        </p>
        <div className="space-y-1">
          {(candidaturas ?? []).map((a) => (
            <div
              key={a.id_alocacao}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span>
                Associado #{a.id_associado} — {a.funcao_desempenhada}
                {a.turno_data_hora_inicio &&
                  ` · ${formatarData(a.turno_data_hora_inicio, { comHora: true })}`}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={confirmar.isPending}
                  onClick={() => confirmar.mutate(a.id_alocacao)}
                >
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recusar.isPending}
                  onClick={() => recusar.mutate(a.id_alocacao)}
                >
                  Recusar
                </Button>
              </div>
            </div>
          ))}
          {(candidaturas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma candidatura pendente.
            </p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Trocas de turno
        </p>
        <div className="space-y-1">
          {(trocas ?? []).map((t) => (
            <div
              key={t.id_troca}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span>
                Alocação #{t.id_alocacao} → substituto associado #
                {t.id_associado_substituto} — {t.status}
              </span>
              {t.status === 'SOLICITADA' && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={confirmarTroca.isPending}
                    onClick={() => confirmarTroca.mutate(t.id_troca)}
                  >
                    Confirmar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={recusarTroca.isPending}
                    onClick={() => recusarTroca.mutate(t.id_troca)}
                  >
                    Recusar
                  </Button>
                </div>
              )}
            </div>
          ))}
          {(trocas ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma troca de turno solicitada.
            </p>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Horas de voluntariado pendentes de aprovação
        </p>
        <div className="space-y-1">
          {(horasPendentes ?? []).map((r) => (
            <div
              key={r.id_registro}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span>
                {formatarData(r.data)} — {r.horas}h
                {r.descricao_atividade && ` · ${r.descricao_atividade}`}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={aprovarHoras.isPending}
                  onClick={() => aprovarHoras.mutate(r.id_registro)}
                >
                  Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recusarHoras.isPending}
                  onClick={() => recusarHoras.mutate(r.id_registro)}
                >
                  Recusar
                </Button>
              </div>
            </div>
          ))}
          {(horasPendentes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma hora pendente de aprovação.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SecaoOrcamentoRelatorio({ projeto }: { projeto: Projeto }) {
  const queryClient = useQueryClient()
  const { data: orcamentos } = useQuery({
    queryKey: ['orcamento-projeto', projeto.id_projeto],
    queryFn: () => obterOrcamentoDoProjeto(projeto.id_projeto),
    enabled: projeto.id_centro_custo != null,
  })
  const { data: relatorios } = useQuery({
    queryKey: ['relatorios-finais-projeto', projeto.id_projeto],
    queryFn: () => listarRelatoriosFinaisProjeto(projeto.id_projeto),
  })
  const [aberta, setAberta] = useState<number | null>(null)

  const gerar = useMutation({
    mutationFn: () => gerarRelatorioFinalProjeto(projeto.id_projeto),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['relatorios-finais-projeto', projeto.id_projeto],
      }),
  })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Orçamento (via centro de custo)
        </h3>
        {projeto.id_centro_custo == null && (
          <p className="text-sm text-muted-foreground">
            Projeto sem centro de custo vinculado.
          </p>
        )}
        <div className="space-y-1">
          {(orcamentos ?? []).map((o) => (
            <div
              key={o.id_orcamento}
              className="rounded-md border border-border p-2 text-sm"
            >
              <p>
                Previsto {formatarReais(o.valor_previsto)} — Realizado{' '}
                {formatarReais(o.realizado)}
              </p>
              <p
                className={o.estourado ? 'text-destructive' : 'text-green-600'}
              >
                {o.estourado ? 'Estourado' : 'Dentro do previsto'}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Encerramento formal (relatório final)
        </h3>
        <Button
          size="sm"
          disabled={gerar.isPending}
          onClick={() => gerar.mutate()}
        >
          {gerar.isPending ? 'Gerando…' : 'Gerar nova versão'}
        </Button>
        <div className="mt-2 space-y-1">
          {(relatorios ?? []).map((r) => (
            <div
              key={r.id_relatorio}
              className="rounded-md border border-border p-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <span>Versão {r.versao}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAberta((v) =>
                      v === r.id_relatorio ? null : r.id_relatorio,
                    )
                  }
                >
                  {aberta === r.id_relatorio ? 'Fechar' : 'Ver'}
                </Button>
              </div>
              {aberta === r.id_relatorio && (
                <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2 text-xs">
                  {r.conteudo}
                </pre>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// v4.2 (FASE 4) - prontuário e encaminhamento são **visíveis só pra equipe ativa deste projeto**
// (dado sensível) - a API recusa com 403 quem não está na equipe, mesmo com permissão geral de
// projetos; o painel só repassa a mensagem de erro, nunca finge que decide isso sozinho.
function PainelProntuario({ idVinculo }: { idVinculo: number }) {
  const queryClient = useQueryClient()
  const {
    data: atendimentos,
    isError: erroAtendimentos,
    error: erroAtendimentosDetalhe,
  } = useQuery({
    queryKey: ['atendimentos', idVinculo],
    queryFn: () => listarAtendimentos(idVinculo),
  })
  const { data: encaminhamentos } = useQuery({
    queryKey: ['encaminhamentos', idVinculo],
    queryFn: () => listarEncaminhamentos(idVinculo),
    enabled: !erroAtendimentos,
  })
  const { data: tiposRede } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_rede_externa'],
    queryFn: () => listarOpcoesCatalogo('tipo_rede_externa'),
  })

  const registrarRelato = useMutation({
    mutationFn: (v: z.infer<typeof registroAtendimentoCriarSchema>) =>
      registrarAtendimento(idVinculo, v.relato),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['atendimentos', idVinculo] }),
  })
  const registrarEncam = useMutation({
    mutationFn: (v: z.infer<typeof encaminhamentoCriarSchema>) =>
      registrarEncaminhamento(idVinculo, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['encaminhamentos', idVinculo],
      }),
  })

  if (erroAtendimentos) {
    return (
      <p className="text-sm text-destructive">
        {(erroAtendimentosDetalhe as Error).message}
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-4 rounded-md border border-border bg-muted/10 p-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Prontuário de atendimento
        </p>
        <FormShell<z.infer<typeof registroAtendimentoCriarSchema>>
          schema={registroAtendimentoCriarSchema}
          defaultValues={{ relato: '' }}
          onSubmit={(v) => registrarRelato.mutateAsync(v)}
          className="mb-2 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <div className="flex-1">
                <input
                  {...form.register('relato')}
                  placeholder="Relato do atendimento"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.relato?.message} />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={registrarRelato.isPending}
              >
                Registrar
              </Button>
            </>
          )}
        </FormShell>
        <div className="space-y-1">
          {(atendimentos ?? []).map((a) => (
            <div
              key={a.id_registro}
              className="rounded-md border border-border p-2 text-xs"
            >
              <p className="text-muted-foreground">
                {formatarData(a.data_atendimento, { comHora: true })}
              </p>
              <p>{a.relato}</p>
            </div>
          ))}
          {(atendimentos ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum atendimento registrado.
            </p>
          )}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">
          Encaminhamento à rede externa
        </p>
        <FormShell<z.infer<typeof encaminhamentoCriarSchema>>
          schema={encaminhamentoCriarSchema}
          defaultValues={{ tipo_rede: '', descricao: '' }}
          onSubmit={(v) => registrarEncam.mutateAsync(v)}
          className="mb-2 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <select
                {...form.register('tipo_rede')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Tipo de rede…</option>
                {(tiposRede ?? []).map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <div className="flex-1">
                <input
                  {...form.register('descricao')}
                  placeholder="Descrição do encaminhamento"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.descricao?.message}
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={registrarEncam.isPending}
              >
                Registrar
              </Button>
            </>
          )}
        </FormShell>
        <div className="space-y-1">
          {(encaminhamentos ?? []).map((e) => (
            <div
              key={e.id_encaminhamento}
              className="rounded-md border border-border p-2 text-xs"
            >
              <p className="text-muted-foreground">
                {e.tipo_rede} — {formatarData(e.data_encaminhamento)}
              </p>
              <p>{e.descricao}</p>
            </div>
          ))}
          {(encaminhamentos ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nenhum encaminhamento registrado.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function SecaoBeneficiarios({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)
  const [vinculoAberto, setVinculoAberto] = useState<number | null>(null)
  const { data: vinculos } = useQuery({
    queryKey: ['beneficiarios-projeto', idProjeto],
    queryFn: () => listarBeneficiariosDoProjeto(idProjeto),
  })
  const { data: beneficiarios } = useQuery({
    queryKey: ['beneficiarios'],
    queryFn: listarBeneficiarios,
  })
  const { data: papeis } = useQuery({
    queryKey: ['opcoes-catalogo', 'papel_beneficiario_projeto'],
    queryFn: () => listarOpcoesCatalogo('papel_beneficiario_projeto'),
  })

  const criarENovo = useMutation({
    mutationFn: async (v: z.infer<typeof beneficiarioCriarSchema>) => {
      const { id_beneficiario } = await criarBeneficiario(v)
      return vincularBeneficiarioAoProjeto({
        id_beneficiario,
        id_projeto: idProjeto,
        papel: 'ATENDIDO',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['beneficiarios-projeto', idProjeto],
      })
      queryClient.invalidateQueries({ queryKey: ['beneficiarios'] })
      setMostrarForm(false)
    },
  })
  const vincularExistente = useMutation({
    mutationFn: (v: z.infer<typeof vincularBeneficiarioSchema>) =>
      vincularBeneficiarioAoProjeto({ ...v, id_projeto: idProjeto }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['beneficiarios-projeto', idProjeto],
      }),
  })

  const naoVinculados = (beneficiarios ?? []).filter(
    (b) =>
      !(vinculos ?? []).some((v) => v.id_beneficiario === b.id_beneficiario),
  )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Beneficiários</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Novo beneficiário'}
        </Button>
      </div>
      {mostrarForm && (
        <FormShell<z.infer<typeof beneficiarioCriarSchema>>
          schema={beneficiarioCriarSchema}
          defaultValues={{
            nome_completo: '',
            consentimento_lgpd_registrado: false,
          }}
          onSubmit={(v) => criarENovo.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <div className="flex-1">
                <input
                  {...form.register('nome_completo')}
                  placeholder="Nome do beneficiário"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={form.formState.errors.nome_completo?.message}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  {...form.register('consentimento_lgpd_registrado')}
                />
                Consentimento registrado
              </label>
              <Button type="submit" size="sm" disabled={criarENovo.isPending}>
                Criar e vincular
              </Button>
            </>
          )}
        </FormShell>
      )}
      {naoVinculados.length > 0 && (
        <FormShell<z.infer<typeof vincularBeneficiarioSchema>>
          schema={vincularBeneficiarioSchema}
          defaultValues={{
            id_beneficiario: 0,
            papel: '',
            atendimento_por_familia: false,
          }}
          onSubmit={(v) => vincularExistente.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2"
        >
          {(form) => (
            <>
              <select
                {...form.register('id_beneficiario')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Vincular beneficiário já cadastrado…</option>
                {naoVinculados.map((b) => (
                  <option key={b.id_beneficiario} value={b.id_beneficiario}>
                    Beneficiário #{b.id_beneficiario}
                  </option>
                ))}
              </select>
              <select
                {...form.register('papel')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Papel…</option>
                {(papeis ?? []).map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  {...form.register('atendimento_por_familia')}
                />
                Atendimento por família
              </label>
              <Button
                type="submit"
                size="sm"
                disabled={vincularExistente.isPending}
              >
                Vincular
              </Button>
            </>
          )}
        </FormShell>
      )}
      <div className="space-y-2">
        {(vinculos ?? []).map((v) => (
          <div
            key={v.id_vinculo}
            className="rounded-md border border-border p-2 text-sm"
          >
            <div className="flex items-center justify-between">
              <span>
                Beneficiário #{v.id_beneficiario} — {v.papel}
                {v.atendimento_por_familia && ' · por família'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setVinculoAberto((atual) =>
                    atual === v.id_vinculo ? null : v.id_vinculo,
                  )
                }
              >
                {vinculoAberto === v.id_vinculo ? 'Fechar' : 'Prontuário'}
              </Button>
            </div>
            {vinculoAberto === v.id_vinculo && (
              <PainelProntuario idVinculo={v.id_vinculo} />
            )}
          </div>
        ))}
        {(vinculos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum beneficiário vinculado a este projeto.
          </p>
        )}
      </div>
    </div>
  )
}

function DetalheProjeto({ projeto }: { projeto: Projeto }) {
  const queryClient = useQueryClient()
  const { data: statusOpcoes } = useQuery({
    queryKey: ['opcoes-catalogo', 'status_projeto'],
    queryFn: () => listarOpcoesCatalogo('status_projeto'),
  })
  const alterarStatus = useMutation({
    mutationFn: (status: string) =>
      alterarStatusProjeto(projeto.id_projeto, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projetos'] }),
  })

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{projeto.nome_projeto}</h2>
          <select
            value={projeto.status}
            onChange={(e) => alterarStatus.mutate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {(statusOpcoes ?? []).map((o) => (
              <option key={o.codigo} value={o.codigo}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
        {projeto.descricao && (
          <p className="text-sm text-muted-foreground">{projeto.descricao}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {formatarData(projeto.data_inicio)} —{' '}
          {formatarData(projeto.data_fim_prevista)}
          {projeto.publico_alvo && ` · Público-alvo: ${projeto.publico_alvo}`}
        </p>
      </div>
      <SecaoCronograma idProjeto={projeto.id_projeto} />
      <SecaoEquipe idProjeto={projeto.id_projeto} />
      <SecaoVoluntariado idProjeto={projeto.id_projeto} />
      <SecaoBeneficiarios idProjeto={projeto.id_projeto} />
      <SecaoOrcamentoRelatorio projeto={projeto} />
    </div>
  )
}

export function ProjetosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [idSelecionado, setIdSelecionado] = useState<number | null>(null)
  const { data: projetos } = useQuery({
    queryKey: ['projetos'],
    queryFn: listarProjetos,
  })

  const projetoSelecionado =
    (projetos ?? []).find((p) => p.id_projeto === idSelecionado) ?? null

  return (
    <>
      <PageHeader
        titulo="Projetos"
        descricao="Projeto como entidade única e configurável — cronograma, equipe, orçamento (via centro de custo) e encerramento formal."
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Todos os projetos</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo projeto'}
          </Button>
        </div>
        {mostrarForm && (
          <FormularioProjeto onCancelar={() => setMostrarForm(false)} />
        )}
        <div className="space-y-2">
          {(projetos ?? []).map((p) => (
            <div
              key={p.id_projeto}
              className="cursor-pointer rounded-md border border-border p-3 text-sm hover:bg-muted/30"
              onClick={() =>
                setIdSelecionado(
                  p.id_projeto === idSelecionado ? null : p.id_projeto,
                )
              }
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.nome_projeto}</p>
                <span className="text-muted-foreground">{p.status}</span>
              </div>
              <p className="text-muted-foreground">
                {p.tipo_projeto ?? p.tipo_foco} · {p.visibilidade}
              </p>
            </div>
          ))}
          {(projetos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum projeto cadastrado.
            </p>
          )}
        </div>
      </section>

      {projetoSelecionado && <DetalheProjeto projeto={projetoSelecionado} />}
    </>
  )
}
