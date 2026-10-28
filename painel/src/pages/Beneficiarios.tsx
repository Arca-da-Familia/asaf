import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { HeartHandshake } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { z } from 'zod'

import { DataTable, type ColunaTabela } from '@/components/data/DataTable'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConsentimentoDoBeneficiario } from '@/components/privacidade/ConsentimentoDoBeneficiario'
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
                    {b.consentimento_lgpd_registrado
                      ? `Sim (termo versão ${b.consentimento?.versao ?? '—'})`
                      : b.consentimento
                        ? 'Só a marca antiga (sem o termo)'
                        : 'Não'}
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
  // v7.2a: o atalho do pedido do titular abre a tela já filtrada (`?busca=`)
  const [parametros] = useSearchParams()
  const [buscaInput, setBuscaInput] = useState(
    () => parametros.get('busca') ?? '',
  )
  const busca = useDebounce(buscaInput)
  const [idProjetoFiltro, setIdProjetoFiltro] = useState<number | undefined>(
    undefined,
  )
  const [idEditando, setIdEditando] = useState<number | null>(null)
  const [idVendoNucleo, setIdVendoNucleo] = useState<number | null>(null)
  const [idConsentimento, setIdConsentimento] = useState<number | null>(null)

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
    // v7.1c: enquanto a busca nova carrega, a lista anterior fica: sem isso o bloco aberto (consentimento, edição, núcleo) era desmontado e perdia o que
    // estava sendo preenchido (o robô v7.1c-01 pegou: digitar o nome e abrir o bloco antes de a busca responder)
    placeholderData: keepPreviousData,
  })

  const dados = beneficiarios ?? []
  const editando = dados.find((b) => b.id_beneficiario === idEditando) ?? null
  const vendoNucleo =
    dados.find((b) => b.id_beneficiario === idVendoNucleo) ?? null
  const vendoConsentimento =
    dados.find((b) => b.id_beneficiario === idConsentimento) ?? null

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
        row.original.consentimento ? (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
            {row.original.consentimento.meio === 'declaracao_antiga'
              ? 'Só a marca antiga (o prontuário não grava)'
              : `Termo versão ${row.original.consentimento.versao}`}
          </span>
        ) : (
          <span className="text-xs text-destructive">
            Sem consentimento (o prontuário não grava)
          </span>
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
          <Button
            variant="outline"
            size="sm"
            aria-label={`Consentimento de ${row.original.nome_completo ?? `pessoa ${row.original.id_pessoa}`}`}
            onClick={() =>
              setIdConsentimento((atual) =>
                atual === row.original.id_beneficiario
                  ? null
                  : row.original.id_beneficiario,
              )
            }
          >
            Consentimento
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        titulo="Beneficiários"
        descricao="Busca cruzada entre projetos — identidade e o consentimento do atendimento social (o termo assinado). Vínculo, prontuário e encaminhamento continuam dentro de cada projeto."
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

        {vendoConsentimento && (
          <ConsentimentoDoBeneficiario
            key={vendoConsentimento.id_beneficiario}
            beneficiario={vendoConsentimento}
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
