import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HeartHandshake } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'

import { DataTable, type ColunaTabela } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { NucleoFamiliarDoBeneficiario } from '@/components/projetos/NucleoFamiliarDoBeneficiario'
import { Button } from '@/components/ui/button'
import {
  editarBeneficiario,
  exportarBeneficiarios,
  listarBeneficiarios,
  listarProjetos,
  type Beneficiario,
} from '@/lib/api'
import { formatarDia } from '@/lib/datas'
import { useDebounce } from '@/lib/use-debounce'
import { beneficiarioEditarSchema } from '@/lib/schemas'
import { useMe } from '@/lib/use-me'

// v4.10 (FASE 4, último) - primeira tela CRUZADA de beneficiários: até aqui só existiam
// aninhados dentro de um projeto (SecaoBeneficiarios em Projetos.tsx, que continua existindo -
// vínculo, papel, prontuário e encaminhamento são coisas do PROJETO, não da identidade da
// pessoa). Aqui é busca/identidade/consentimento entre projetos - nunca prontuário/encaminhamento
// (são gateados por "é equipe ativa DESTE projeto", não cabe numa lista cruzada sem N+1).
function FormularioEditarBeneficiario({
  beneficiario,
  onFechar,
}: {
  beneficiario: Beneficiario
  onFechar: () => void
}) {
  const queryClient = useQueryClient()

  const salvar = useMutation({
    mutationFn: (v: z.infer<typeof beneficiarioEditarSchema>) =>
      editarBeneficiario(beneficiario.id_beneficiario, {
        ...v,
        data_nascimento: v.data_nascimento || undefined,
        observacao_consentimento: v.observacao_consentimento || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['beneficiarios'] })
      onFechar()
    },
  })

  return (
    <div className="mb-4 rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Editar beneficiário #{beneficiario.id_beneficiario}
        </h3>
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </div>
      <FormShell<z.infer<typeof beneficiarioEditarSchema>>
        schema={beneficiarioEditarSchema}
        defaultValues={{
          nome_completo: beneficiario.nome_completo ?? '',
          // a API devolve data e hora ("1990-03-04T00:00:00"); o campo de data só aceita aaaa-mm-dd
          data_nascimento: beneficiario.data_nascimento?.slice(0, 10) ?? '',
          consentimento_lgpd_registrado:
            beneficiario.consentimento_lgpd_registrado,
          observacao_consentimento: beneficiario.observacao_consentimento ?? '',
        }}
        onSubmit={(v) => salvar.mutateAsync(v)}
        className="flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Nome completo
              </label>
              <input
                {...form.register('nome_completo')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.nome_completo?.message}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Nascimento
              </label>
              <input
                type="date"
                {...form.register('data_nascimento')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="w-full">
              <label className="mb-1 block text-xs text-muted-foreground">
                Observação sobre o consentimento
              </label>
              <input
                {...form.register('observacao_consentimento')}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...form.register('consentimento_lgpd_registrado')}
              />
              Consentimento LGPD registrado
            </label>
            <Button type="submit" size="sm" disabled={salvar.isPending}>
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        )}
      </FormShell>
    </div>
  )
}

function SecaoExportarBeneficiarios({
  busca,
  idProjeto,
}: {
  busca: string
  idProjeto: number | undefined
}) {
  const { data: me } = useMe()
  const podeExportar =
    me?.permissoes.includes('exportar_beneficiarios') ?? false
  const [resultado, setResultado] = useState<Beneficiario[] | null>(null)

  const exportar = useMutation({
    mutationFn: () => exportarBeneficiarios({ busca, idProjeto }),
    onSuccess: setResultado,
  })

  if (!podeExportar) return null

  return (
    <div className="mb-4">
      <Button
        variant="outline"
        size="sm"
        disabled={exportar.isPending}
        onClick={() => exportar.mutate()}
      >
        {exportar.isPending ? 'Exportando…' : 'Exportar (filtro atual)'}
      </Button>
      {exportar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(exportar.error as Error).message}
        </p>
      )}
      {resultado && (
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Nascimento</th>
                <th className="px-3 py-2 font-medium">Consentimento LGPD</th>
              </tr>
            </thead>
            <tbody>
              {resultado.map((b) => (
                <tr
                  key={b.id_beneficiario}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2">
                    {b.nome_completo ?? `Pessoa #${b.id_pessoa}`}
                  </td>
                  <td className="px-3 py-2">
                    {b.data_nascimento ? formatarDia(b.data_nascimento) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {b.consentimento_lgpd_registrado ? 'Sim' : 'Não'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resultado.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhuma linha no resultado.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function BeneficiariosPage() {
  const [buscaInput, setBuscaInput] = useState('')
  const busca = useDebounce(buscaInput)
  const [idProjetoFiltro, setIdProjetoFiltro] = useState<number | undefined>(
    undefined,
  )
  const [idEditando, setIdEditando] = useState<number | null>(null)
  const [idVendoNucleo, setIdVendoNucleo] = useState<number | null>(null)

  const { data: projetos } = useQuery({
    queryKey: ['projetos'],
    queryFn: listarProjetos,
  })

  const { data: beneficiarios, isLoading } = useQuery({
    queryKey: ['beneficiarios', busca, idProjetoFiltro],
    queryFn: () =>
      listarBeneficiarios({
        busca: busca || undefined,
        idProjeto: idProjetoFiltro,
      }),
  })

  const dados = beneficiarios ?? []
  const editando = dados.find((b) => b.id_beneficiario === idEditando) ?? null
  const vendoNucleo =
    dados.find((b) => b.id_beneficiario === idVendoNucleo) ?? null

  const colunas: ColunaTabela<Beneficiario>[] = [
    {
      accessorKey: 'nome_completo',
      header: 'Nome',
      cell: ({ row }) =>
        row.original.nome_completo ?? `Pessoa #${row.original.id_pessoa}`,
    },
    {
      accessorKey: 'data_nascimento',
      header: 'Nascimento',
      cell: ({ row }) =>
        row.original.data_nascimento
          ? formatarDia(row.original.data_nascimento)
          : '—',
    },
    {
      id: 'consentimento',
      header: 'Consentimento LGPD',
      cell: ({ row }) =>
        row.original.consentimento_lgpd_registrado ? (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Registrado
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Pendente</span>
        ),
    },
    {
      id: 'acoes',
      header: '',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setIdEditando((atual) =>
                atual === row.original.id_beneficiario
                  ? null
                  : row.original.id_beneficiario,
              )
            }
          >
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Núcleo familiar de ${row.original.nome_completo ?? `pessoa ${row.original.id_pessoa}`}`}
            onClick={() =>
              setIdVendoNucleo((atual) =>
                atual === row.original.id_beneficiario
                  ? null
                  : row.original.id_beneficiario,
              )
            }
          >
            Núcleo familiar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        titulo="Beneficiários"
        descricao="Busca cruzada entre projetos — identidade e consentimento LGPD. Vínculo, prontuário e encaminhamento continuam dentro de cada projeto."
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">
              Buscar por nome
            </label>
            <input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              placeholder="Nome do beneficiário…"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Projeto
            </label>
            <select
              value={idProjetoFiltro ?? ''}
              onChange={(e) =>
                setIdProjetoFiltro(
                  e.target.value ? Number(e.target.value) : undefined,
                )
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Todos os projetos</option>
              {(projetos ?? []).map((p) => (
                <option key={p.id_projeto} value={p.id_projeto}>
                  {p.nome_projeto}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SecaoExportarBeneficiarios busca={busca} idProjeto={idProjetoFiltro} />

        {editando && (
          <FormularioEditarBeneficiario
            beneficiario={editando}
            onFechar={() => setIdEditando(null)}
          />
        )}

        {vendoNucleo && (
          <NucleoFamiliarDoBeneficiario
            beneficiario={vendoNucleo}
            onFechar={() => setIdVendoNucleo(null)}
          />
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : dados.length === 0 ? (
          <EmptyState
            icone={HeartHandshake}
            titulo="Nenhum beneficiário encontrado"
            descricao="Ajuste a busca/filtro, ou cadastre beneficiários a partir de um projeto."
          />
        ) : (
          <DataTable dados={dados} colunas={colunas} filtroGlobal={false} />
        )}
      </section>
    </>
  )
}
