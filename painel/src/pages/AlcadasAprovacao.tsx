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
  alternarAlcadaAprovacao,
  criarAlcadaAprovacao,
  criarDelegacaoAprovacao,
  listarAlcadasAprovacao,
  listarAssociadosParaSelecao,
  listarDelegacoesAprovacao,
  listarOpcoesCatalogo,
  type AlcadaAprovacao,
} from '@/lib/api'
import {
  alcadaAprovacaoCriarSchema,
  delegacaoAprovacaoCriarSchema,
} from '@/lib/schemas'
import { formatarDia } from '@/lib/datas'
import { usePaginaLocal } from '@/lib/pagina-local'
import { lerValorEmReais } from '@/lib/valores'
import { useRotuloDoCatalogo } from '@/lib/rotulo-do-catalogo'

// v3.3 (FASE 3 - Financeiro) - alçada de aprovação (faixa de valor -> cargo(s) autorizados, com
// ou sem dupla assinatura) e delegação temporária rastreável (ex.: tesoureiro de férias delega
// ao vice, sem precisar de um usuário "fantasma" - quem realmente aprova continua registrado).
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

function FormularioAlcada({
  onCancelar,
  aoCriar,
}: {
  onCancelar: () => void
  aoCriar?: (idAlcada: number) => void
}) {
  const queryClient = useQueryClient()
  // v9.3r (nada de nome técnico na tela): os cargos vêm da lista das Configurações e a pessoa MARCA quais podem aprovar — antes digitava o
  // código ("TESOUREIRO,PRESIDENTE"). A ordem guardada é a da lista (a do Estatuto), não a ordem dos cliques.
  const { data: cargos } = useQuery({
    queryKey: ['opcoes-catalogo', 'titulo_cargo'],
    queryFn: () => listarOpcoesCatalogo('titulo_cargo'),
  })
  const criar = useMutation({
    mutationFn: (v: z.infer<typeof alcadaAprovacaoCriarSchema>) =>
      criarAlcadaAprovacao({
        valor_minimo: v.valor_minimo,
        valor_maximo: v.valor_maximo
          ? Number(lerValorEmReais(String(v.valor_maximo)))
          : null,
        cargos_autorizados: v.cargos_autorizados,
        exige_dupla_assinatura: v.exige_dupla_assinatura,
      }),
    onSuccess: async (criada) => {
      await queryClient.invalidateQueries({ queryKey: ['alcadas-aprovacao'] })
      aoCriar?.(criada.id_alcada)
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof alcadaAprovacaoCriarSchema>>
      schema={alcadaAprovacaoCriarSchema}
      defaultValues={{
        valor_minimo: 0,
        valor_maximo: '',
        cargos_autorizados: [],
        exige_dupla_assinatura: false,
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-3"
    >
      {(form) => (
        <>
          <div>
            <label
              htmlFor="alcada-valor-minimo"
              className="mb-1 block text-sm font-medium"
            >
              Valor mínimo (R$)
            </label>
            <input
              id="alcada-valor-minimo"
              type="number"
              step="0.01"
              {...form.register('valor_minimo')}
              placeholder="Valor mínimo"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor_minimo?.message} />
          </div>
          <div>
            <label
              htmlFor="alcada-valor-maximo"
              className="mb-1 block text-sm font-medium"
            >
              Valor máximo (R$)
            </label>
            <input
              id="alcada-valor-maximo"
              {...form.register('valor_maximo')}
              placeholder="Valor máximo (vazio = sem teto)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.valor_maximo?.message} />
          </div>
          <fieldset className="sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">
              Cargos que podem aprovar
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {(cargos ?? []).map((c) => {
                const marcados = form.watch('cargos_autorizados')
                return (
                  <label
                    key={c.codigo}
                    className="flex min-h-9 items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={marcados.includes(c.codigo)}
                      onChange={(e) => {
                        const escolhidos = new Set(marcados)
                        if (e.target.checked) escolhidos.add(c.codigo)
                        else escolhidos.delete(c.codigo)
                        form.setValue(
                          'cargos_autorizados',
                          (cargos ?? [])
                            .map((o) => o.codigo)
                            .filter((codigo) => escolhidos.has(codigo)),
                          { shouldValidate: form.formState.isSubmitted },
                        )
                      }}
                    />
                    {c.rotulo}
                  </label>
                )
              })}
            </div>
            <ErroCampo
              mensagem={form.formState.errors.cargos_autorizados?.message}
            />
          </fieldset>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              {...form.register('exige_dupla_assinatura')}
            />
            Exige dupla assinatura (duas aprovações distintas)
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Cadastrar alçada'}
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
        </>
      )}
    </FormShell>
  )
}

function FormularioDelegacao({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados-selecao'],
    queryFn: listarAssociadosParaSelecao,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof delegacaoAprovacaoCriarSchema>) =>
      criarDelegacaoAprovacao(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegacoes-aprovacao'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof delegacaoAprovacaoCriarSchema>>
      schema={delegacaoAprovacaoCriarSchema}
      defaultValues={{
        id_associado_delegante: 0,
        id_associado_delegado: 0,
        data_fim: '',
        motivo: '',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div>
            <select
              {...form.register('id_associado_delegante')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Quem delega…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_associado_delegante?.message}
            />
          </div>
          <div>
            <select
              {...form.register('id_associado_delegado')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="0">Delegado (quem vai aprovar)…</option>
              {(associados ?? []).map((a) => (
                <option key={a.id_associado} value={a.id_associado}>
                  {a.nome_completo}
                </option>
              ))}
            </select>
            <ErroCampo
              mensagem={form.formState.errors.id_associado_delegado?.message}
            />
          </div>
          <div>
            <input
              type="date"
              {...form.register('data_fim')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.data_fim?.message} />
          </div>
          <div>
            <input
              {...form.register('motivo')}
              placeholder="Motivo (ex.: férias)"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.motivo?.message} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Registrar delegação'}
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
        </>
      )}
    </FormShell>
  )
}

const POR_PAGINA = 10

function faixaEmTexto(a: AlcadaAprovacao): string {
  return `${formatarReais(a.valor_minimo)} até ${
    a.valor_maximo != null ? formatarReais(a.valor_maximo) : 'sem teto'
  }`
}

export function AlcadasAprovacaoPage() {
  const nomeDoCargo = useRotuloDoCatalogo('titulo_cargo')
  const [mostrarAlcada, setMostrarAlcada] = useState(false)
  const [mostrarDelegacao, setMostrarDelegacao] = useState(false)
  const queryClient = useQueryClient()
  // v9.3s (a tela tinha 10,6 alturas de notebook na homologação: todas as faixas, ativas e inativas, numa lista só): as faixas EM VIGOR (por
  // valor, como se lê uma tabela de alçadas) e as INATIVAS (a mais recente primeiro) em abas, 10 por página; as delegações também em páginas.
  const [parametros, setParametros] = useSearchParams()
  const aba = parametros.get('alcadas') === 'inativas' ? 'inativas' : 'em-vigor'
  function irParaAba(chave: string) {
    setParametros(
      (atual) => {
        const novo = new URLSearchParams(atual)
        if (chave === 'inativas') novo.set('alcadas', 'inativas')
        else novo.delete('alcadas')
        return novo
      },
      { replace: true },
    )
  }
  // o que acabou de mudar de aba ("Faixa ... inativada"): a pessoa sabe para onde ela foi
  const [aviso, setAviso] = useState('')

  const { data: alcadas } = useQuery({
    queryKey: ['alcadas-aprovacao'],
    queryFn: listarAlcadasAprovacao,
  })
  const { data: delegacoes } = useQuery({
    queryKey: ['delegacoes-aprovacao'],
    queryFn: listarDelegacoesAprovacao,
  })

  const emVigor = (alcadas ?? []).filter((a) => a.ativo)
  const inativas = (alcadas ?? [])
    .filter((a) => !a.ativo)
    .sort((a, b) => b.id_alcada - a.id_alcada)
  const lista = aba === 'inativas' ? inativas : emVigor
  const pagina = usePaginaLocal(lista, POR_PAGINA, aba)
  // a faixa recém-cadastrada: a lista vai à página onde ela está (uma vez por faixa)
  const [mostrar, setMostrar] = useState<number | null>(null)
  if (mostrar !== null && aba === 'em-vigor') {
    const posicao = emVigor.findIndex((a) => a.id_alcada === mostrar)
    if (posicao >= 0) {
      setMostrar(null)
      pagina.setPagina(Math.floor(posicao / POR_PAGINA) + 1)
    }
  }
  const paginaDelegacoes = usePaginaLocal(delegacoes, POR_PAGINA)

  const alternar = useMutation({
    mutationFn: ({ alcada }: { alcada: AlcadaAprovacao }) =>
      alternarAlcadaAprovacao(alcada.id_alcada, !alcada.ativo),
    onSuccess: async (_r, { alcada }) => {
      await queryClient.invalidateQueries({ queryKey: ['alcadas-aprovacao'] })
      setAviso(
        alcada.ativo
          ? `Faixa de ${faixaEmTexto(alcada)} inativada — ela agora está na aba Inativas.`
          : `Faixa de ${faixaEmTexto(alcada)} reativada — ela voltou para a aba Em vigor.`,
      )
    },
  })

  const conteudoDaLista = (
    <>
      <div className="grid items-start gap-2 lg:grid-cols-2">
        {pagina.daPagina.map((a) => (
          <div
            key={a.id_alcada}
            data-alcada={a.id_alcada}
            className="rounded-md border border-border p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{faixaEmTexto(a)}</p>
              <span
                className={
                  a.ativo
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-muted-foreground'
                }
              >
                {a.ativo ? 'Ativa' : 'Inativa'}
              </span>
            </div>
            <p className="text-muted-foreground">
              Cargos: {a.cargos_autorizados.map(nomeDoCargo).join(', ')}
              {a.exige_dupla_assinatura && ' · exige dupla assinatura'}
            </p>
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={alternar.isPending}
                onClick={() => {
                  setAviso('')
                  alternar.mutate({ alcada: a })
                }}
              >
                {a.ativo ? 'Inativar' : 'Reativar'}
              </Button>
            </div>
          </div>
        ))}
        {alcadas && lista.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {aba === 'inativas'
              ? 'Nenhuma alçada inativa.'
              : 'Nenhuma alçada em vigor.'}
          </p>
        )}
      </div>
      <Paginador
        pagina={pagina.pagina}
        porPagina={pagina.porPagina}
        total={pagina.total}
        aoMudar={pagina.setPagina}
        rotulo="Páginas das alçadas"
      />
    </>
  )

  return (
    <>
      <PageHeader
        titulo="Alçadas de Aprovação"
        descricao="Faixas de valor, cargo exigido e dupla assinatura para aprovar compras — e delegação temporária rastreável."
        trilha={[
          { rotulo: 'Financeiro', href: '/financeiro' },
          { rotulo: 'Alçadas de Aprovação' },
        ]}
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Alçadas cadastradas</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarAlcada((v) => !v)}
          >
            {mostrarAlcada ? 'Cancelar' : 'Nova alçada'}
          </Button>
        </div>
        {mostrarAlcada && (
          <FormularioAlcada
            onCancelar={() => setMostrarAlcada(false)}
            aoCriar={(id) => {
              setAviso('')
              irParaAba('em-vigor')
              setMostrar(id)
            }}
          />
        )}
        <p aria-live="polite" className="mb-2 text-sm" data-aviso-alcada>
          {aviso}
        </p>
        <Abas
          rotulo="Situação das alçadas"
          atual={aba}
          aoMudar={(chave) => {
            setAviso('')
            irParaAba(chave)
          }}
          abas={[
            {
              chave: 'em-vigor',
              rotulo: `Em vigor (${emVigor.length})`,
              conteudo: aba === 'em-vigor' ? conteudoDaLista : null,
            },
            {
              chave: 'inativas',
              rotulo: `Inativas (${inativas.length})`,
              conteudo: aba === 'inativas' ? conteudoDaLista : null,
            },
          ]}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Delegações temporárias</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarDelegacao((v) => !v)}
          >
            {mostrarDelegacao ? 'Cancelar' : 'Nova delegação'}
          </Button>
        </div>
        {mostrarDelegacao && (
          <FormularioDelegacao onCancelar={() => setMostrarDelegacao(false)} />
        )}
        <div className="grid items-start gap-2 lg:grid-cols-2">
          {paginaDelegacoes.daPagina.map((d) => (
            <div
              key={d.id_delegacao}
              className="rounded-md border border-border p-3 text-sm"
            >
              <p className="font-medium">
                {d.nome_delegante ?? `Associado #${d.id_associado_delegante}`} →{' '}
                {d.nome_delegado ?? `Associado #${d.id_associado_delegado}`}
              </p>
              <p className="text-muted-foreground">
                {d.motivo} · até {formatarDia(d.data_fim)}
              </p>
            </div>
          ))}
          {(delegacoes ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma delegação registrada.
            </p>
          )}
        </div>
        <Paginador
          pagina={paginaDelegacoes.pagina}
          porPagina={paginaDelegacoes.porPagina}
          total={paginaDelegacoes.total}
          aoMudar={paginaDelegacoes.setPagina}
          rotulo="Páginas das delegações"
        />
      </section>
    </>
  )
}
