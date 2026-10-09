import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { Button } from '@/components/ui/button'
import {
  alocarVoluntario,
  listarAlocacoesDoProjeto,
  listarVoluntariosParaSelecao,
  type VoluntarioParaSelecao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { alocacaoDiretaSchema } from '@/lib/schemas'

// Alocar voluntário direto num turno (sem passar por vaga e candidatura) e ver a escala do projeto. A equipe escolhe a pessoa (associada ou não), a
// função e o turno; a alocação já nasce confirmada. O servidor exige o termo de voluntariado vigente da pessoa e recusa em português quando não há.

// O nome vem primeiro (quem escolhe a opção pelo nome continua achando); depois, o que a equipe precisa saber antes de tentar escalar.
function textoDaOpcao(v: VoluntarioParaSelecao): string {
  return `${v.nome_completo}${v.eh_associado ? '' : ' (não associado)'}${v.tem_termo_vigente ? '' : ' — sem termo vigente'}`
}

export function AlocarVoluntarioNoTurno({ idProjeto }: { idProjeto: number }) {
  const queryClient = useQueryClient()
  const { data: escala } = useQuery({
    queryKey: ['escala-do-projeto', idProjeto],
    queryFn: () => listarAlocacoesDoProjeto(idProjeto),
  })
  const { data: voluntarios } = useQuery({
    queryKey: ['voluntarios-para-selecao'],
    queryFn: listarVoluntariosParaSelecao,
  })
  const alocar = useMutation({
    mutationFn: (v: z.infer<typeof alocacaoDiretaSchema>) =>
      alocarVoluntario({ id_projeto: idProjeto, ...v }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['escala-do-projeto', idProjeto],
      }),
  })

  return (
    <div className="mb-4">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        Alocar voluntário direto num turno
      </p>
      <FormShell<z.infer<typeof alocacaoDiretaSchema>>
        schema={alocacaoDiretaSchema}
        defaultValues={{
          id_pessoa: 0,
          funcao_desempenhada: '',
          turno_data_hora_inicio: '',
          turno_data_hora_fim: '',
          horas_previstas: 0,
        }}
        onSubmit={(v) => alocar.mutateAsync(v).then(() => undefined)}
        className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
      >
        {(form) => (
          <>
            <div>
              <select
                aria-label="Voluntário"
                {...form.register('id_pessoa')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Escolha o voluntário</option>
                {(voluntarios ?? []).map((v) => (
                  <option key={v.id_pessoa} value={v.id_pessoa}>
                    {textoDaOpcao(v)}
                  </option>
                ))}
              </select>
              <ErroCampo mensagem={form.formState.errors.id_pessoa?.message} />
            </div>
            <div className="flex-1">
              <input
                aria-label="Função do voluntário"
                {...form.register('funcao_desempenhada')}
                placeholder="Função (ex.: Apoio na cozinha)"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.funcao_desempenhada?.message}
              />
            </div>
            <div>
              <input
                type="datetime-local"
                aria-label="Início do turno do voluntário"
                {...form.register('turno_data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.turno_data_hora_inicio?.message}
              />
            </div>
            <div>
              <input
                type="datetime-local"
                aria-label="Fim do turno do voluntário"
                {...form.register('turno_data_hora_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.turno_data_hora_fim?.message}
              />
            </div>
            <input
              type="number"
              min={0}
              step="0.5"
              aria-label="Horas previstas do voluntário"
              {...form.register('horas_previstas')}
              placeholder="Horas previstas"
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={alocar.isPending}>
              Alocar agora
            </Button>
          </>
        )}
      </FormShell>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        Escala do projeto
      </p>
      <div className="v3-space-y-1">
        {(escala ?? []).map((a) => (
          <div
            key={a.id_alocacao}
            className="rounded-md border border-border p-2 text-sm"
          >
            {a.nome_voluntario}
            {a.eh_associado ? '' : ' (não associado)'} — {a.funcao_desempenhada}
            {a.turno_data_hora_inicio &&
              ` · ${formatarData(a.turno_data_hora_inicio, { comHora: true })}`}
            {a.turno_data_hora_fim &&
              ` até ${formatarData(a.turno_data_hora_fim, { comHora: true })}`}
            {` · ${a.horas_previstas} h previstas · ${a.status}`}
          </div>
        ))}
        {(escala ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ninguém está na escala deste projeto ainda.
          </p>
        )}
      </div>
    </div>
  )
}
