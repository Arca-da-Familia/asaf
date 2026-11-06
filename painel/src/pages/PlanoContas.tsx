import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { z } from 'zod'

import { Paginador } from '@/components/data/Paginador'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Abas } from '@/components/ui/abas'
import { Button } from '@/components/ui/button'
import {
  atualizarContaContabil,
  criarContaContabil,
  excluirContaContabil,
  listarOpcoesCatalogo,
  listarPlanoContas,
  type PlanoDeContas,
} from '@/lib/api'
import { usePaginaLocal } from '@/lib/pagina-local'
import { contaContabilCriarSchema } from '@/lib/schemas'
import { simplificar } from '@/lib/texto'

// v2.5.8 (FASE 2.5 - Painel) - Plano de Contas (backend v3.0, só faltava a tela). `tipo` usa o
// RÓTULO do catálogo `tipo_conta_contabil` como value do <select> (não o código técnico) -
// confirmado em app/services/contabilidade.py::NATUREZA_POR_TIPO, que só reconhece os rótulos
// ("Ativo", "Despesa"...).
//
// v3.1 - hierarquia (sintética x analítica): `codigo_contabil_pai` opcional torna a conta filha
// de outra, que passa a ser SINTÉTICA e não recebe mais lançamento direto (`sintetica` vem
// calculado pelo backend, nunca recalculado aqui). Exclusão agora existe no backend, mas é
// bloqueada se a conta tiver filha, movimento ou for uma Conta Financeira - a mensagem real de
// erro é mostrada.
function FormularioConta({
  conta,
  contas,
  onSalvar,
  onCancelar,
}: {
  conta?: PlanoDeContas
  contas: PlanoDeContas[]
  onSalvar: (v: z.infer<typeof contaContabilCriarSchema>) => Promise<unknown>
  onCancelar?: () => void
}) {
  const { data: tipos } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_conta_contabil'],
    queryFn: () => listarOpcoesCatalogo('tipo_conta_contabil'),
  })
  const possiveisPais = contas.filter(
    (c) => c.codigo_contabil !== conta?.codigo_contabil,
  )

  return (
    <FormShell<z.infer<typeof contaContabilCriarSchema>>
      schema={contaContabilCriarSchema}
      defaultValues={{
        codigo_contabil: conta?.codigo_contabil ?? '',
        descricao_conta: conta?.descricao_conta ?? '',
        tipo: conta?.tipo ?? '',
        codigo_contabil_pai: conta?.codigo_contabil_pai ?? '',
      }}
      onSubmit={onSalvar}
      className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-4"
    >
      {(form) => (
        <>
          <div>
            <input
              {...form.register('codigo_contabil')}
              placeholder="Código contábil"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.codigo_contabil?.message}
            />
          </div>
          <div>
            <input
              {...form.register('descricao_conta')}
              placeholder="Descrição"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.descricao_conta?.message}
            />
          </div>
          <div>
            <select
              {...form.register('tipo')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Selecione o tipo…</option>
              {(tipos ?? []).map((t) => (
                <option key={t.id_opcao} value={t.rotulo}>
                  {t.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.tipo?.message} />
          </div>
          <div>
            <select
              {...form.register('codigo_contabil_pai')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem conta pai (raiz)</option>
              {possiveisPais.map((c) => (
                <option key={c.id_conta} value={c.codigo_contabil}>
                  {c.codigo_contabil} — {c.descricao_conta}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" size="sm">
              Salvar
            </Button>
            {onCancelar && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancelar}
              >
                Cancelar
              </Button>
            )}
          </div>
        </>
      )}
    </FormShell>
  )
}

// v9.3e: a ordem dos tipos contábeis nas abas (a do catálogo); um tipo novo do catálogo entra no fim
const ORDEM_DOS_TIPOS = [
  'Ativo',
  'Passivo',
  'Patrimônio Líquido',
  'Receita',
  'Despesa',
]
const CONTAS_POR_PAGINA = 20

function chaveDoTipo(tipo: string): string {
  return simplificar(tipo).replace(/\s+/g, '-')
}

export function PlanoContasPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
  })

  // v9.3e (pedido do Presidente, 05/11: tela comprida vira "submenu"): a lista inteira tinha 16 alturas de notebook. Agora uma aba por tipo
  // contábil (no endereço, `?tipo=receita`), em páginas de 20, e a busca (código ou descrição) procura em todos os tipos de uma vez.
  const [parametros, setParametros] = useSearchParams()
  const [busca, setBusca] = useState('')
  const tipos = [...new Set((contas ?? []).map((c) => c.tipo))].sort(
    (a, b) =>
      (ORDEM_DOS_TIPOS.indexOf(a) + 1 || 99) -
        (ORDEM_DOS_TIPOS.indexOf(b) + 1 || 99) || a.localeCompare(b),
  )
  const tipoPedido = parametros.get('tipo') ?? ''
  const tipoAtual =
    tipos.find((t) => chaveDoTipo(t) === tipoPedido) ?? tipos[0] ?? ''
  const termo = simplificar(busca.trim())
  const visiveis = termo
    ? (contas ?? []).filter(
        (c) =>
          simplificar(c.codigo_contabil).includes(termo) ||
          simplificar(c.descricao_conta).includes(termo),
      )
    : (contas ?? []).filter((c) => c.tipo === tipoAtual)
  const pagina = usePaginaLocal(
    contas ? visiveis : undefined,
    CONTAS_POR_PAGINA,
    `${tipoAtual}|${termo}`,
  )
  // a conta recém-criada: a aba do tipo dela e a página onde ela está (ajuste durante a renderização, uma vez)
  const [mostrar, setMostrar] = useState<number | null>(null)
  if (mostrar !== null && contas) {
    const posicao = visiveis.findIndex((c) => c.id_conta === mostrar)
    if (posicao >= 0) {
      setMostrar(null)
      pagina.setPagina(Math.floor(posicao / CONTAS_POR_PAGINA) + 1)
    }
  }
  function mudarDeTipo(chave: string) {
    setParametros(
      (p) => {
        p.set('tipo', chave)
        return p
      },
      { replace: true },
    )
  }

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['plano-contas'] })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof contaContabilCriarSchema>) =>
      criarContaContabil(v),
    onSuccess: (criada, dados) => {
      invalidar()
      setMostrarForm(false)
      setErro(null)
      // a conta nova aparece: se a busca em curso a acha, fica na busca; senão, a aba do tipo dela e a página onde ela está
      const achadaPelaBusca =
        termo !== '' &&
        (simplificar(dados.codigo_contabil).includes(termo) ||
          simplificar(dados.descricao_conta).includes(termo))
      if (!achadaPelaBusca) {
        setBusca('')
        mudarDeTipo(chaveDoTipo(dados.tipo))
      }
      setMostrar(criada.id_conta)
    },
  })

  const editar = useMutation({
    mutationFn: ({
      idConta,
      dados,
    }: {
      idConta: number
      dados: z.infer<typeof contaContabilCriarSchema>
    }) => atualizarContaContabil(idConta, dados),
    onSuccess: () => {
      invalidar()
      setEditando(null)
      setErro(null)
    },
  })

  const excluir = useMutation({
    mutationFn: (idConta: number) => excluirContaContabil(idConta),
    onSuccess: () => {
      invalidar()
      setErro(null)
    },
    onError: (e: Error) => setErro(e.message),
  })

  const listaDeContas = (
    <div>
      <div className="flex flex-col gap-2">
        {pagina.daPagina.map((c) =>
          editando === c.id_conta ? (
            <FormularioConta
              key={c.id_conta}
              conta={c}
              contas={contas ?? []}
              onSalvar={(v) =>
                editar.mutateAsync({ idConta: c.id_conta, dados: v })
              }
              onCancelar={() => setEditando(null)}
            />
          ) : (
            <div
              key={c.id_conta}
              className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {c.codigo_contabil} — {c.descricao_conta}
                  {c.sintetica && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Sintética
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {c.tipo}
                  {c.codigo_contabil_pai &&
                    ` · filha de ${c.codigo_contabil_pai}`}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditando(c.id_conta)}
                >
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => excluir.mutate(c.id_conta)}
                  disabled={excluir.isPending}
                >
                  Excluir
                </Button>
              </div>
            </div>
          ),
        )}
        {termo && pagina.total === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma conta com esse código ou descrição.
          </p>
        )}
      </div>
      <Paginador
        pagina={pagina.pagina}
        porPagina={pagina.porPagina}
        total={pagina.total}
        aoMudar={pagina.setPagina}
        rotulo="Páginas das contas"
      />
    </div>
  )

  return (
    <>
      <PageHeader
        titulo="Plano de Contas"
        descricao="Contas contábeis usadas nos lançamentos do razão."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Plano de Contas' },
        ]}
      />

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Contas cadastradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova conta'}
          </Button>
        </div>

        {mostrarForm && (
          <div className="mb-4">
            <FormularioConta
              contas={contas ?? []}
              onSalvar={(v) => criar.mutateAsync(v)}
              onCancelar={() => setMostrarForm(false)}
            />
          </div>
        )}

        {erro && <p className="mb-2 text-sm text-destructive">{erro}</p>}

        {(contas ?? []).length > 0 && (
          <div className="mb-3 max-w-md">
            <label htmlFor="procurar-conta" className="text-sm font-medium">
              Procurar conta
            </label>
            <input
              id="procurar-conta"
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Código ou descrição, em todos os tipos"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            {termo && (
              <p
                aria-live="polite"
                className="mt-1 text-xs text-muted-foreground"
              >
                {pagina.total}{' '}
                {pagina.total === 1 ? 'conta encontrada' : 'contas encontradas'}
                .
              </p>
            )}
          </div>
        )}

        {termo ? (
          listaDeContas
        ) : tipos.length > 0 ? (
          <Abas
            rotulo="Tipos de conta"
            atual={chaveDoTipo(tipoAtual)}
            aoMudar={mudarDeTipo}
            abas={tipos.map((t) => ({
              chave: chaveDoTipo(t),
              rotulo: t,
              conteudo: listaDeContas,
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma conta cadastrada.
          </p>
        )}
      </section>
    </>
  )
}
