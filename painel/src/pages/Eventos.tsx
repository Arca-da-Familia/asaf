import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  atualizarElegibilidadeConfig,
  atualizarStatusInscricao,
  configurarCobrancaEvento,
  configurarReembolsoEvento,
  convidarPesquisaSatisfacao,
  criarCotaEvento,
  criarCupomEvento,
  criarEvento,
  criarFaixaPrecoEvento,
  criarIsencaoTaxaEvento,
  criarNovaEdicaoEvento,
  criarPerguntaEvento,
  criarSessaoEvento,
  criarTemplateDocumento,
  criarTokenPortaria,
  emitirCertificadoEvento,
  emitirCrachaEvento,
  exportarInscricoesDoContexto,
  exportarPresencasEvento,
  gerarFechamentoEvento,
  listarAssociados,
  listarCentrosCusto,
  listarCotasEvento,
  listarCuponsEvento,
  listarEdicoesEvento,
  listarElegibilidadeEvento,
  listarEspacos,
  listarEventos,
  listarFaixasPrecoEvento,
  listarFechamentosEvento,
  listarInscricoesDoContexto,
  listarIsencoesTaxaEvento,
  listarOpcoesCatalogo,
  listarPerguntasEvento,
  listarPlanoContas,
  listarSessoesEvento,
  listarTemplatesDocumento,
  listarTokensPortaria,
  obterAssociado,
  obterComparacaoEdicoesEvento,
  obterResultadoPesquisaSatisfacao,
  revogarTokenPortaria,
  urlArquivo,
  type Evento,
  type InscricaoExportada,
  type InscricaoMotor,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  cobrancaEventoConfigSchema,
  cotaInscricaoCriarSchema,
  cupomDescontoCriarSchema,
  elegibilidadeConfigSchema,
  eventoCriarSchema,
  faixaPrecoEventoCriarSchema,
  isencaoTaxaCriarSchema,
  novaEdicaoEventoCriarSchema,
  perguntaEventoCriarSchema,
  reembolsoEventoConfigSchema,
  sessaoEventoCriarSchema,
  templateDocumentoCriarSchema,
  tokenPortariaCriarSchema,
} from '@/lib/schemas'
import { useDebounce } from '@/lib/use-debounce'
import { useMe } from '@/lib/use-me'

// v4.9 - valores financeiros de evento chegam em reais (Decimal serializado como número JSON,
// nunca centavos) - mesmo formato já confirmado em Espacos.tsx/Titulos.tsx.
function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// v4.5 (FASE 4) - Evento como entidade única e pontual: UM registro só (nunca duas tabelas),
// consumido por esta tela de gestão e pelo endpoint público (`/api/publico/eventos`) que o site
// institucional lê. Sessões são a programação (congresso de um dia, várias atividades sem
// precisar criar "vários eventos"); edições recorrentes ficam ligadas entre si por
// `id_edicao_anterior`. Inscrição reaproveita o motor genérico da v4.0 (`/api/inscricoes/`) -
// autoatendimento do próprio associado (`/api/eventos/{id}/inscricao`) é consumido por outra
// tela, esta aqui é a visão de gestão.
function FormularioEvento({ onCancelar }: { onCancelar: () => void }) {
  const queryClient = useQueryClient()
  const { data: categorias } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_evento'],
    queryFn: () => listarOpcoesCatalogo('tipo_evento'),
  })
  const { data: espacos } = useQuery({
    queryKey: ['espacos'],
    queryFn: listarEspacos,
  })
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof eventoCriarSchema>) => criarEvento(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      onCancelar()
    },
  })

  return (
    <FormShell<z.infer<typeof eventoCriarSchema>>
      schema={eventoCriarSchema}
      defaultValues={{
        titulo: '',
        categoria: '',
        data_hora_inicio: '',
        data_hora_fim: '',
        descricao: '',
        endereco_avulso: '',
        gratuito: true,
        visibilidade: 'Interna',
      }}
      onSubmit={(v) => criar.mutateAsync(v)}
      className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      {(form) => (
        <>
          <div className="sm:col-span-2">
            <input
              {...form.register('titulo')}
              placeholder="Título do evento"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.titulo?.message} />
          </div>
          <div>
            <select
              {...form.register('categoria')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Categoria…</option>
              {(categorias ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <ErroCampo mensagem={form.formState.errors.categoria?.message} />
          </div>
          <div>
            <select
              {...form.register('visibilidade')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="Interna">Interna</option>
              <option value="Pública">Pública (site institucional)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Início
            </label>
            <input
              type="datetime-local"
              {...form.register('data_hora_inicio')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo
              mensagem={form.formState.errors.data_hora_inicio?.message}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Fim (opcional)
            </label>
            <input
              type="datetime-local"
              {...form.register('data_hora_fim')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <select
              {...form.register('id_espaco')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sem espaço próprio…</option>
              {(espacos ?? []).map((e) => (
                <option key={e.id_espaco} value={e.id_espaco}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <input
              {...form.register('endereco_avulso')}
              placeholder="Ou endereço avulso"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
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
            <input
              type="number"
              min={1}
              {...form.register('vagas')}
              placeholder="Vagas (opcional)"
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...form.register('gratuito')} />
            Evento gratuito
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Criar evento'}
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

function SecaoSessoes({ idEvento }: { idEvento: number }) {
  const queryClient = useQueryClient()
  const { data: sessoes } = useQuery({
    queryKey: ['sessoes-evento', idEvento],
    queryFn: () => listarSessoesEvento(idEvento),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof sessaoEventoCriarSchema>) =>
      criarSessaoEvento(idEvento, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['sessoes-evento', idEvento],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Programação (sessões/atividades)
      </h3>
      <FormShell<z.infer<typeof sessaoEventoCriarSchema>>
        schema={sessaoEventoCriarSchema}
        defaultValues={{ titulo: '', data_hora_inicio: '', data_hora_fim: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div className="flex-1">
              <input
                {...form.register('titulo')}
                placeholder="Título da sessão"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.titulo?.message} />
            </div>
            <input
              type="datetime-local"
              {...form.register('data_hora_inicio')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <input
              type="datetime-local"
              {...form.register('data_hora_fim')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar
            </Button>
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(sessoes ?? []).map((s) => (
          <div
            key={s.id_sessao}
            className="rounded-md border border-border p-2 text-sm"
          >
            {s.titulo} — {formatarData(s.data_hora_inicio, { comHora: true })}
          </div>
        ))}
        {(sessoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma sessão cadastrada — evento simples, sem programação.
          </p>
        )}
      </div>
    </div>
  )
}

// v4.6 (FASE 4) - perguntas personalizadas do formulário de inscrição pública. O formulário em
// si (onde a resposta é preenchida) vive no site institucional (Astro/Directus, outro projeto,
// fora deste repositório) - aqui é só a gestão de QUAIS perguntas existem, mesma decisão de
// escopo já registrada na v4.5 pro autoatendimento.
function SecaoPerguntas({ idEvento }: { idEvento: number }) {
  const queryClient = useQueryClient()
  const { data: perguntas } = useQuery({
    queryKey: ['perguntas-evento', idEvento],
    queryFn: () => listarPerguntasEvento(idEvento),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof perguntaEventoCriarSchema>) =>
      criarPerguntaEvento(idEvento, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['perguntas-evento', idEvento],
      }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Perguntas do formulário de inscrição pública
      </h3>
      <FormShell<z.infer<typeof perguntaEventoCriarSchema>>
        schema={perguntaEventoCriarSchema}
        defaultValues={{
          enunciado: '',
          tipo: 'TEXTO_CURTO',
          opcoes: '',
          obrigatoria: true,
          ordem: (perguntas ?? []).length,
        }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div className="flex-1">
              <input
                {...form.register('enunciado')}
                placeholder="Enunciado da pergunta"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.enunciado?.message} />
            </div>
            <select
              {...form.register('tipo')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="TEXTO_CURTO">Texto curto</option>
              <option value="TEXTO_LONGO">Texto longo</option>
              <option value="SELECAO_UNICA">Seleção única</option>
              <option value="SELECAO_MULTIPLA">Seleção múltipla</option>
              <option value="NUMERO">Número</option>
              <option value="DATA">Data</option>
              <option value="ARQUIVO">Arquivo</option>
            </select>
            <input
              {...form.register('opcoes')}
              placeholder="Opções (CSV, só seleção)"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register('obrigatoria')} />
              Obrigatória
            </label>
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar
            </Button>
            {criar.isError && (
              <p className="w-full text-sm text-destructive">
                {(criar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(perguntas ?? []).map((p) => (
          <div
            key={p.id_pergunta}
            className="rounded-md border border-border p-2 text-sm"
          >
            {p.enunciado} — {p.tipo}
            {p.obrigatoria && ' · obrigatória'}
          </div>
        ))}
        {(perguntas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma pergunta personalizada — o formulário público pede só
            nome/CPF/e-mail/ telefone.
          </p>
        )}
      </div>
    </div>
  )
}

// v4.7 (FASE 4) - cota de vagas por categoria (associado x comunidade externa). Opcional: sem
// nenhuma cota cadastrada, o limite genérico do evento (campo "Vagas" do formulário de criação)
// vale pra todo mundo, como já era desde a v4.5 — só que agora com trava real sob concorrência.
function SecaoCotas({ idEvento }: { idEvento: number }) {
  const queryClient = useQueryClient()
  const { data: categorias } = useQuery({
    queryKey: ['opcoes-catalogo', 'categoria_cota_inscricao'],
    queryFn: () => listarOpcoesCatalogo('categoria_cota_inscricao'),
  })
  const { data: cotas } = useQuery({
    queryKey: ['cotas-evento', idEvento],
    queryFn: () => listarCotasEvento(idEvento),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof cotaInscricaoCriarSchema>) =>
      criarCotaEvento(idEvento, v),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['cotas-evento', idEvento] }),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Cotas de vagas por categoria
      </h3>
      <FormShell<z.infer<typeof cotaInscricaoCriarSchema>>
        schema={cotaInscricaoCriarSchema}
        defaultValues={{ categoria: '', vagas_limite: 1 }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <select
              {...form.register('categoria')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Categoria…</option>
              {(categorias ?? []).map((o) => (
                <option key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              {...form.register('vagas_limite')}
              placeholder="Vagas"
              className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar cota
            </Button>
            {criar.isError && (
              <p className="w-full text-sm text-destructive">
                {(criar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(cotas ?? []).map((c) => (
          <div
            key={c.id_cota}
            className="rounded-md border border-border p-2 text-sm"
          >
            {c.categoria} — {c.vagas_ocupadas}/{c.vagas_limite} ocupada(s)
          </div>
        ))}
        {(cotas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma cota configurada — o limite genérico de vagas do evento vale
            pra todo mundo.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoEdicoes({ evento }: { evento: Evento }) {
  const queryClient = useQueryClient()
  const [mostrarForm, setMostrarForm] = useState(false)
  const { data: edicoes } = useQuery({
    queryKey: ['edicoes-evento', evento.id_evento],
    queryFn: () => listarEdicoesEvento(evento.id_evento),
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof novaEdicaoEventoCriarSchema>) =>
      criarNovaEdicaoEvento(evento.id_evento, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      queryClient.invalidateQueries({
        queryKey: ['edicoes-evento', evento.id_evento],
      })
      setMostrarForm(false)
    },
  })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Edições recorrentes (ligadas entre si)
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMostrarForm((v) => !v)}
        >
          {mostrarForm ? 'Cancelar' : 'Criar nova edição'}
        </Button>
      </div>
      {mostrarForm && (
        <FormShell<z.infer<typeof novaEdicaoEventoCriarSchema>>
          schema={novaEdicaoEventoCriarSchema}
          defaultValues={{
            titulo: '',
            data_hora_inicio: '',
            data_hora_fim: '',
          }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
        >
          {(form) => (
            <>
              <input
                {...form.register('titulo')}
                placeholder="Título da nova edição (opcional)"
                className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <input
                type="datetime-local"
                {...form.register('data_hora_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" size="sm" disabled={criar.isPending}>
                Criar
              </Button>
            </>
          )}
        </FormShell>
      )}
      <div className="space-y-1">
        {(edicoes ?? []).map((e) => (
          <div
            key={e.id_evento}
            className={`rounded-md border p-2 text-sm ${e.id_evento === evento.id_evento ? 'border-primary' : 'border-border'}`}
          >
            {e.titulo} — {formatarData(e.data_hora_inicio)}
            {e.id_evento === evento.id_evento && ' (esta edição)'}
          </div>
        ))}
      </div>
      <ComparacaoEdicoes idEvento={evento.id_evento} />
    </div>
  )
}

// v4.10 - comparação lado a lado das edições da mesma cadeia recorrente (mesma semântica "cadeia
// inteira, independente de qual edição chamou" de `listarEdicoesEvento` acima).
function ComparacaoEdicoes({ idEvento }: { idEvento: number }) {
  const { data: comparacao } = useQuery({
    queryKey: ['comparacao-edicoes', idEvento],
    queryFn: () => obterComparacaoEdicoesEvento(idEvento),
  })

  if (!comparacao || comparacao.length === 0) return null

  return (
    <div className="mt-4 overflow-x-auto">
      <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        Comparação entre edições
      </h4>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1 pr-4">Edição</th>
            <th className="py-1 pr-4">Data</th>
            <th className="py-1 pr-4">Inscritos</th>
            <th className="py-1 pr-4">Presentes</th>
            <th className="py-1 pr-4">Arrecadado</th>
            <th className="py-1 pr-4">Resultado</th>
            <th className="py-1 pr-4">Satisfação</th>
          </tr>
        </thead>
        <tbody>
          {comparacao.map((e) => (
            <tr
              key={e.id_evento}
              className={`border-b border-border last:border-0 ${e.id_evento === idEvento ? 'bg-muted/30' : ''}`}
            >
              <td className="py-1 pr-4">{e.titulo}</td>
              <td className="py-1 pr-4">{formatarData(e.data_hora_inicio)}</td>
              <td className="py-1 pr-4">{e.total_inscritos}</td>
              <td className="py-1 pr-4">{e.total_presentes}</td>
              <td className="py-1 pr-4">
                {e.total_arrecadado != null
                  ? formatarReais(e.total_arrecadado)
                  : '—'}
              </td>
              <td className="py-1 pr-4">
                {e.resultado_financeiro != null
                  ? formatarReais(e.resultado_financeiro)
                  : '—'}
              </td>
              <td className="py-1 pr-4">
                {e.nota_media_satisfacao != null
                  ? `${e.nota_media_satisfacao.toFixed(1)} / 10`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// v4.10 - status do motor de inscrição (Pré-inscrito/Confirmado/Lista de
// Espera/Cancelado/Presente/Ausente, ver app/routers/motores.py). O MAPA abaixo só evita
// oferecer uma transição obviamente inválida no <select> - quem valida de verdade é o backend
// (400 com mensagem descritiva fora disso, que o painel repassa).
const STATUS_INSCRICAO = [
  'Pré-inscrito',
  'Confirmado',
  'Lista de Espera',
  'Cancelado',
  'Presente',
  'Ausente',
] as const

const TRANSICOES_VALIDAS_INSCRICAO: Record<string, string[]> = {
  'Pré-inscrito': ['Confirmado', 'Lista de Espera', 'Cancelado'],
  Confirmado: ['Cancelado', 'Presente', 'Ausente'],
  'Lista de Espera': ['Confirmado', 'Cancelado'],
  Cancelado: ['Pré-inscrito'],
  Presente: [],
  Ausente: [],
}

function LinhaInscrito({
  inscrito,
  onErro,
}: {
  inscrito: InscricaoMotor
  onErro: (mensagem: string | null) => void
}) {
  const queryClient = useQueryClient()
  const transicoes = TRANSICOES_VALIDAS_INSCRICAO[inscrito.status] ?? []

  const alterarStatus = useMutation({
    mutationFn: (status: string) =>
      atualizarStatusInscricao(inscrito.id_inscricao, status),
    onSuccess: () => {
      onErro(null)
      queryClient.invalidateQueries({ queryKey: ['inscricoes'] })
    },
    onError: (err) => onErro((err as Error).message),
  })

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
      <span>{inscrito.nome_pessoa ?? `Pessoa #${inscrito.id_pessoa}`}</span>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{inscrito.status}</span>
        {transicoes.length > 0 ? (
          <select
            value=""
            disabled={alterarStatus.isPending}
            onChange={(e) => {
              if (e.target.value) alterarStatus.mutate(e.target.value)
              e.target.value = ''
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Alterar status…</option>
            {transicoes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted-foreground">(final)</span>
        )}
      </div>
    </div>
  )
}

function SecaoInscritos({ evento }: { evento: Evento }) {
  const { data: me } = useMe()
  const podeExportar =
    me?.permissoes.includes('exportar_inscricoes_evento') ?? false
  const [buscaInput, setBuscaInput] = useState('')
  const busca = useDebounce(buscaInput)
  const [status, setStatus] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const { data: inscritos } = useQuery({
    queryKey: ['inscricoes', 'Evento', evento.id_evento, busca, status],
    queryFn: () =>
      listarInscricoesDoContexto('Evento', evento.id_evento, {
        busca: busca || undefined,
        status: status || undefined,
      }),
  })

  const [resultadoExportacao, setResultadoExportacao] = useState<
    InscricaoExportada[] | null
  >(null)
  const exportar = useMutation({
    mutationFn: () => exportarInscricoesDoContexto('Evento', evento.id_evento),
    onSuccess: setResultadoExportacao,
  })

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Inscritos no evento (autoatendimento pelo painel)
        </h3>
        {podeExportar && (
          <Button
            size="sm"
            variant="outline"
            disabled={exportar.isPending}
            onClick={() => exportar.mutate()}
          >
            {exportar.isPending ? 'Exportando…' : 'Exportar'}
          </Button>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={buscaInput}
          onChange={(e) => setBuscaInput(e.target.value)}
          placeholder="Buscar por nome…"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Todos os status</option>
          {STATUS_INSCRICAO.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {erro && <p className="mb-2 text-sm text-destructive">{erro}</p>}
      {exportar.isError && (
        <p className="mb-2 text-sm text-destructive">
          {(exportar.error as Error).message}
        </p>
      )}
      {resultadoExportacao && (
        <div className="mb-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Inscrito em</th>
              </tr>
            </thead>
            <tbody>
              {resultadoExportacao.map((i) => (
                <tr
                  key={i.id_inscricao}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-2">{i.nome_pessoa ?? '—'}</td>
                  <td className="px-3 py-2">{i.status}</td>
                  <td className="px-3 py-2">
                    {formatarData(i.data_inscricao, { comHora: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {resultadoExportacao.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              Nenhuma linha no resultado.
            </p>
          )}
        </div>
      )}
      <div className="space-y-1">
        {(inscritos ?? []).map((i) => (
          <LinhaInscrito key={i.id_inscricao} inscrito={i} onErro={setErro} />
        ))}
        {(inscritos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma inscrição encontrada.
          </p>
        )}
      </div>
    </div>
  )
}

// ==========================================
// FINANCEIRO DE EVENTO (v4.9) - cobrança de inscrição (faixa de preço por categoria/vigência,
// cupom de desconto, isenção justificada), política de reembolso por cancelamento e fechamento
// financeiro (snapshot imutável, manual ou pela tarefa diária agendada). Gate por "projetos"
// (não "financeiro"), mesmo critério já usado pelos campos financeiros de `Espaco` (v4.3) - nunca
// devolvido pelo GET /api/eventos (mesmo padrão "só PUT, sem leitura de volta" da elegibilidade
// v4.8 abaixo), por isso nenhum formulário aqui pré-carrega o valor já configurado.
// ==========================================
function SecaoCobranca({ evento }: { evento: Evento }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false
  const idEvento = evento.id_evento
  const queryClient = useQueryClient()

  const { data: contas } = useQuery({
    queryKey: ['plano-contas'],
    queryFn: listarPlanoContas,
    enabled: podeGerenciar,
  })
  const { data: centros } = useQuery({
    queryKey: ['centros-custo'],
    queryFn: listarCentrosCusto,
    enabled: podeGerenciar,
  })
  const contasReceita = (contas ?? []).filter(
    (c) => c.tipo === 'Receita' && !c.sintetica,
  )

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['eventos'] })
  }

  const configurar = useMutation({
    mutationFn: (v: z.infer<typeof cobrancaEventoConfigSchema>) =>
      configurarCobrancaEvento(idEvento, {
        valor_base: v.valor_base,
        id_conta_contabil_receita: v.id_conta_contabil_receita,
        id_centro_custo: v.id_centro_custo,
      }),
    onSuccess: invalidar,
  })

  // Ação EXPLÍCITA e separada do formulário acima, de propósito (achado real evitado aqui): só
  // deixar o campo de valor em branco e reenviar o formulário nunca é como se torna um evento
  // gratuito de novo - isso exigiria confiar que ninguém vai submeter o formulário sem querer.
  const tornarGratuito = useMutation({
    mutationFn: () => configurarCobrancaEvento(idEvento, { valor_base: null }),
    onSuccess: invalidar,
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Cobrança de inscrição</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Atualmente: {evento.gratuito ? 'gratuito' : 'pago'}.
      </p>
      <FormShell<z.infer<typeof cobrancaEventoConfigSchema>>
        schema={cobrancaEventoConfigSchema}
        defaultValues={{ valor_base: 0, id_conta_contabil_receita: 0 }}
        onSubmit={(v) => configurar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
      >
        {(form) => (
          <>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Valor da inscrição (R$)
              </label>
              <input
                type="number"
                step="0.01"
                min={0.01}
                {...form.register('valor_base')}
                className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.valor_base?.message} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Conta contábil de receita
              </label>
              <select
                {...form.register('id_conta_contabil_receita')}
                className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="0">Selecione…</option>
                {contasReceita.map((c) => (
                  <option key={c.id_conta} value={c.id_conta}>
                    {c.codigo_contabil} — {c.descricao_conta}
                  </option>
                ))}
              </select>
              <ErroCampo
                mensagem={
                  form.formState.errors.id_conta_contabil_receita?.message
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Centro de custo (opcional)
              </label>
              <select
                {...form.register('id_centro_custo', {
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
                className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sem centro de custo</option>
                {(centros ?? [])
                  .filter((c) => c.ativo)
                  .map((c) => (
                    <option key={c.id_centro_custo} value={c.id_centro_custo}>
                      {c.codigo} — {c.nome}
                    </option>
                  ))}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={configurar.isPending}>
              {configurar.isPending ? 'Salvando…' : 'Salvar cobrança'}
            </Button>
            {configurar.isError && (
              <p className="w-full text-sm text-destructive">
                {(configurar.error as Error).message}
              </p>
            )}
            {configurar.isSuccess && (
              <p className="w-full text-sm text-emerald-600">
                Cobrança configurada.
              </p>
            )}
          </>
        )}
      </FormShell>
      <Button
        variant="outline"
        size="sm"
        disabled={tornarGratuito.isPending || evento.gratuito}
        onClick={() => tornarGratuito.mutate()}
      >
        {tornarGratuito.isPending
          ? 'Removendo cobrança…'
          : 'Tornar evento gratuito (remover cobrança)'}
      </Button>
      {tornarGratuito.isError && (
        <p className="mt-1 text-sm text-destructive">
          {(tornarGratuito.error as Error).message}
        </p>
      )}
    </div>
  )
}

function SecaoFaixasPreco({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false
  const queryClient = useQueryClient()
  const { data: categorias } = useQuery({
    queryKey: ['opcoes-catalogo', 'categoria_cota_inscricao'],
    queryFn: () => listarOpcoesCatalogo('categoria_cota_inscricao'),
    enabled: podeGerenciar,
  })
  const { data: faixas } = useQuery({
    queryKey: ['faixas-preco-evento', idEvento],
    queryFn: () => listarFaixasPrecoEvento(idEvento),
    enabled: podeGerenciar,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof faixaPrecoEventoCriarSchema>) =>
      criarFaixaPrecoEvento(idEvento, v),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['faixas-preco-evento', idEvento],
      }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Faixas de preço por categoria
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Sem edição ou exclusão — pra corrigir um valor, cadastre uma nova faixa
        com vigência a partir de agora.
      </p>
      <FormShell<z.infer<typeof faixaPrecoEventoCriarSchema>>
        schema={faixaPrecoEventoCriarSchema}
        defaultValues={{ categoria: '', valor: 0 }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div>
              <select
                {...form.register('categoria')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Categoria…</option>
                {(categorias ?? []).map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <ErroCampo mensagem={form.formState.errors.categoria?.message} />
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                min={0}
                {...form.register('valor')}
                placeholder="Valor (R$)"
                className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.valor?.message} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Vigência início (opcional)
              </label>
              <input
                type="datetime-local"
                {...form.register('data_vigencia_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Vigência fim (opcional)
              </label>
              <input
                type="datetime-local"
                {...form.register('data_vigencia_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Adicionar faixa
            </Button>
            {criar.isError && (
              <p className="w-full text-sm text-destructive">
                {(criar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(faixas ?? []).map((f) => (
          <div
            key={f.id_faixa}
            className="rounded-md border border-border p-2 text-sm"
          >
            {f.categoria} — {formatarReais(f.valor)}
            {f.data_vigencia_inicio &&
              ` · a partir de ${formatarData(f.data_vigencia_inicio, { comHora: true })}`}
            {f.data_vigencia_fim &&
              ` até ${formatarData(f.data_vigencia_fim, { comHora: true })}`}
          </div>
        ))}
        {(faixas ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma faixa de preço cadastrada — vale o valor base configurado na
            cobrança.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoCupons({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false
  const queryClient = useQueryClient()
  const { data: cupons } = useQuery({
    queryKey: ['cupons-evento', idEvento],
    queryFn: () => listarCuponsEvento(idEvento),
    enabled: podeGerenciar,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof cupomDescontoCriarSchema>) =>
      criarCupomEvento(idEvento, v),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['cupons-evento', idEvento] }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Cupons de desconto</h3>
      <FormShell<z.infer<typeof cupomDescontoCriarSchema>>
        schema={cupomDescontoCriarSchema}
        defaultValues={{
          codigo: '',
          tipo_desconto: 'percentual',
          valor_desconto: 0,
        }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div>
              <input
                {...form.register('codigo')}
                placeholder="Código (ex.: AMIGO10)"
                className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.codigo?.message} />
            </div>
            <div>
              <select
                {...form.register('tipo_desconto')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="percentual">Percentual (%)</option>
                <option value="valor_fixo">Valor fixo (R$)</option>
              </select>
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                min={0.01}
                {...form.register('valor_desconto')}
                placeholder="Valor do desconto"
                className="h-9 w-32 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.valor_desconto?.message}
              />
            </div>
            <div>
              <input
                type="number"
                min={1}
                {...form.register('limite_uso', {
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
                placeholder="Limite de uso (opcional)"
                className="h-9 w-44 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Vigência início (opcional)
              </label>
              <input
                type="datetime-local"
                {...form.register('data_vigencia_inicio')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Vigência fim (opcional)
              </label>
              <input
                type="datetime-local"
                {...form.register('data_vigencia_fim')}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Criar cupom
            </Button>
            {criar.isError && (
              <p className="w-full text-sm text-destructive">
                {(criar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(cupons ?? []).map((c) => (
          <div
            key={c.id_cupom}
            className="rounded-md border border-border p-2 text-sm"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.codigo}</span>
              <span
                className={c.ativo ? 'text-green-600' : 'text-muted-foreground'}
              >
                {c.ativo ? 'Ativo' : 'Inativo'}
              </span>
            </div>
            <p className="text-muted-foreground">
              {c.tipo_desconto === 'percentual'
                ? `${c.valor_desconto}% de desconto`
                : `${formatarReais(c.valor_desconto)} de desconto`}
              {' · '}
              {c.limite_uso != null
                ? `${c.usos_atuais} / ${c.limite_uso} usos`
                : `${c.usos_atuais} usos, sem limite`}
            </p>
          </div>
        ))}
        {(cupons ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum cupom cadastrado.
          </p>
        )}
      </div>
    </div>
  )
}

// Isenção justificada - o motor é genérico (mesmo backend usado por Espacos.tsx), vale pra
// qualquer inscrição futura da mesma pessoa neste evento, não só pra uma inscrição já existente.
function SecaoIsencoesEvento({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false
  const queryClient = useQueryClient()
  const { data: associados } = useQuery({
    queryKey: ['associados'],
    queryFn: listarAssociados,
    enabled: podeGerenciar,
  })
  const { data: motivos } = useQuery({
    queryKey: ['opcoes-catalogo', 'motivo_isencao_taxa_evento'],
    queryFn: () => listarOpcoesCatalogo('motivo_isencao_taxa_evento'),
    enabled: podeGerenciar,
  })
  const { data: isencoes } = useQuery({
    queryKey: ['isencoes-evento', idEvento],
    queryFn: () => listarIsencoesTaxaEvento(idEvento),
    enabled: podeGerenciar,
  })

  const conceder = useMutation({
    mutationFn: async (v: z.infer<typeof isencaoTaxaCriarSchema>) => {
      // O backend exige `id_pessoa` (não `id_associado`) - resolvido aqui buscando o associado
      // escolhido, já que `listarAssociados` (usado no seletor abaixo) não devolve `id_pessoa`.
      const idPessoa = v.id_associado
        ? (await obterAssociado(v.id_associado)).id_pessoa
        : v.id_pessoa_manual!
      return criarIsencaoTaxaEvento(idEvento, {
        id_pessoa: idPessoa,
        motivo: v.motivo,
        percentual_isencao: v.percentual_isencao,
      })
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['isencoes-evento', idEvento],
      }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Isenções justificadas de taxa de inscrição
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Vale pra qualquer inscrição futura desta pessoa neste evento. Selecione
        um associado cadastrado ou, se a pessoa não for associada (ex.:
        palestrante convidado), informe o ID da pessoa manualmente.
      </p>
      <FormShell<z.infer<typeof isencaoTaxaCriarSchema>>
        schema={isencaoTaxaCriarSchema}
        defaultValues={{ motivo: '', percentual_isencao: 100 }}
        onSubmit={(v) => conceder.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div>
              <select
                {...form.register('id_associado', {
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
                className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Associado…</option>
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
              <input
                type="number"
                min={1}
                {...form.register('id_pessoa_manual', {
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
                placeholder="ou ID da pessoa (avançado)"
                className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <select
                {...form.register('motivo')}
                className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Motivo…</option>
                {(motivos ?? []).map((o) => (
                  <option key={o.codigo} value={o.codigo}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
              <ErroCampo mensagem={form.formState.errors.motivo?.message} />
            </div>
            <div>
              <input
                type="number"
                step="0.01"
                min={0.01}
                max={100}
                {...form.register('percentual_isencao')}
                placeholder="% isento"
                className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.percentual_isencao?.message}
              />
            </div>
            <Button type="submit" size="sm" disabled={conceder.isPending}>
              Conceder isenção
            </Button>
            {conceder.isError && (
              <p className="w-full text-sm text-destructive">
                {(conceder.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
      <div className="space-y-1">
        {(isencoes ?? []).map((i) => (
          <div
            key={i.id_isencao}
            className="rounded-md border border-border p-2 text-sm"
          >
            Pessoa #{i.id_pessoa} — {i.percentual_isencao}% isento · {i.motivo}
          </div>
        ))}
        {(isencoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma isenção concedida.
          </p>
        )}
      </div>
    </div>
  )
}

function SecaoReembolsoEvento({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false

  const configurar = useMutation({
    mutationFn: (v: z.infer<typeof reembolsoEventoConfigSchema>) =>
      configurarReembolsoEvento(idEvento, {
        prazo_cancelamento_horas: v.prazo_cancelamento_horas,
        percentual_reembolso_cancelamento: v.usar_padrao_reembolso
          ? null
          : (v.percentual_reembolso_cancelamento ?? null),
      }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Política de reembolso por cancelamento
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Vale pro cancelamento de uma inscrição paga neste evento.
      </p>
      <FormShell<z.infer<typeof reembolsoEventoConfigSchema>>
        schema={reembolsoEventoConfigSchema}
        defaultValues={{
          prazo_cancelamento_horas: 24,
          usar_padrao_reembolso: true,
        }}
        onSubmit={(v) => configurar.mutateAsync(v)}
        className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
      >
        {(form) => {
          const usarPadrao = form.watch('usar_padrao_reembolso')
          return (
            <>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Prazo de cancelamento (horas)
                </label>
                <input
                  type="number"
                  min={0}
                  {...form.register('prazo_cancelamento_horas')}
                  className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo
                  mensagem={
                    form.formState.errors.prazo_cancelamento_horas?.message
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  {...form.register('usar_padrao_reembolso')}
                />
                Usar percentual padrão do sistema
              </label>
              {!usarPadrao && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Percentual de reembolso (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    {...form.register('percentual_reembolso_cancelamento', {
                      setValueAs: (v) => (v === '' ? undefined : Number(v)),
                    })}
                    className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo
                    mensagem={
                      form.formState.errors.percentual_reembolso_cancelamento
                        ?.message
                    }
                  />
                </div>
              )}
              <Button type="submit" size="sm" disabled={configurar.isPending}>
                {configurar.isPending ? 'Salvando…' : 'Salvar política'}
              </Button>
              {configurar.isError && (
                <p className="w-full text-sm text-destructive">
                  {(configurar.error as Error).message}
                </p>
              )}
              {configurar.isSuccess && (
                <p className="w-full text-sm text-emerald-600">
                  Política de reembolso atualizada.
                </p>
              )}
            </>
          )
        }}
      </FormShell>
    </div>
  )
}

function SecaoFechamentoEvento({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false
  const queryClient = useQueryClient()
  const { data: fechamentos } = useQuery({
    queryKey: ['fechamentos-evento', idEvento],
    queryFn: () => listarFechamentosEvento(idEvento),
    enabled: podeGerenciar,
  })

  const gerar = useMutation({
    mutationFn: () => gerarFechamentoEvento(idEvento),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['fechamentos-evento', idEvento],
      }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Fechamento financeiro</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Uma tarefa diária já gera este fechamento sozinha quando o evento
        termina — use o botão abaixo só pra gerar agora, sem esperar. Cada linha
        abaixo é um retrato imutável (nunca editado depois).
      </p>
      <Button
        size="sm"
        disabled={gerar.isPending}
        onClick={() => gerar.mutate()}
      >
        {gerar.isPending ? 'Gerando…' : 'Gerar fechamento agora'}
      </Button>
      {gerar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(gerar.error as Error).message}
        </p>
      )}
      <div className="mt-3 space-y-1">
        {(fechamentos ?? []).map((f) => (
          <div
            key={f.id_fechamento}
            className="rounded-md border border-border p-2 text-sm"
          >
            <p className="font-medium">
              {formatarData(f.gerado_em, { comHora: true })} —{' '}
              {f.id_usuario_geracao == null
                ? 'automático (tarefa agendada)'
                : `usuário #${f.id_usuario_geracao}`}
            </p>
            <p className="text-muted-foreground">
              {f.total_inscritos} inscrito(s) · {f.total_presentes} presente(s)
              · arrecadado {formatarReais(f.total_arrecadado)} · custos{' '}
              {formatarReais(f.total_custos)} · resultado{' '}
              {formatarReais(f.resultado)}
            </p>
          </div>
        ))}
        {(fechamentos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum fechamento gerado ainda.
          </p>
        )}
      </div>
    </div>
  )
}

// ==========================================
// PORTARIA (v4.8) - emitir/listar/revogar o link `/portaria/:token` que a organização passa pra
// quem vai operar o check-in na entrada, sem precisar logar no painel (ver
// painel/src/pages/PortariaGate.tsx). Gate de permissão própria (`gerenciar_checkin_evento`),
// igual ao resto desta seção - ver app/routers/eventos.py.
// ==========================================
function SecaoPortaria({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar =
    me?.permissoes.includes('gerenciar_checkin_evento') ?? false
  const queryClient = useQueryClient()
  const [linkRecemGerado, setLinkRecemGerado] = useState<string | null>(null)

  const { data: tokens } = useQuery({
    queryKey: ['tokens-portaria', idEvento],
    queryFn: () => listarTokensPortaria(idEvento),
    enabled: podeGerenciar,
  })

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof tokenPortariaCriarSchema>) =>
      criarTokenPortaria(idEvento, v),
    onSuccess: (r) => {
      // `url_portaria` é relativa ao PAINEL (rota `/portaria/:token`, não à API) - por isso
      // prefixa `window.location.origin`, nunca a origem da API (ver `urlArquivo`, que é o
      // inverso: caminho relativo à API).
      setLinkRecemGerado(`${window.location.origin}${r.url_portaria}`)
      queryClient.invalidateQueries({ queryKey: ['tokens-portaria', idEvento] })
    },
  })

  const revogar = useMutation({
    mutationFn: (idTokenPortaria: number) =>
      revogarTokenPortaria(idEvento, idTokenPortaria),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['tokens-portaria', idEvento],
      }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Portaria (check-in sem login)
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Gere um link pra quem vai operar o check-in na entrada do evento — abre
        num celular/tablet sem precisar logar no painel, e continua registrando
        mesmo se a internet do local cair (sincroniza depois).
      </p>
      <FormShell<z.infer<typeof tokenPortariaCriarSchema>>
        schema={tokenPortariaCriarSchema}
        defaultValues={{ descricao: '', horas_validade: 48 }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        {(form) => (
          <>
            <div className="flex-1">
              <input
                {...form.register('descricao')}
                placeholder="Descrição (ex.: entrada principal)"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <input
              type="number"
              min={1}
              {...form.register('horas_validade')}
              placeholder="Validade (horas)"
              className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Gerar link da portaria
            </Button>
            {criar.isError && (
              <p className="w-full text-sm text-destructive">
                {(criar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>

      {linkRecemGerado && (
        <div className="mb-3 flex flex-col items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center">
          <QRCodeSVG value={linkRecemGerado} size={120} />
          <div className="text-sm">
            <p className="font-medium">
              Link gerado — imprima o QR ou copie o link abaixo:
            </p>
            <a
              href={linkRecemGerado}
              target="_blank"
              rel="noreferrer"
              className="break-all text-primary underline"
            >
              {linkRecemGerado}
            </a>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {(tokens ?? []).map((t) => (
          <div
            key={t.id_token_portaria}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
          >
            <span>
              {t.descricao || 'Sem descrição'} · expira em{' '}
              {formatarData(t.expira_em, { comHora: true })}
              {t.revogado_em && ' · REVOGADO'}
            </span>
            {!t.revogado_em && (
              <Button
                size="sm"
                variant="outline"
                disabled={revogar.isPending}
                onClick={() => revogar.mutate(t.id_token_portaria)}
              >
                Revogar
              </Button>
            )}
          </div>
        ))}
        {(tokens ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum link de portaria gerado ainda.
          </p>
        )}
      </div>
    </div>
  )
}

// v4.8 (achado do ponto de revisão) - até aqui NENHUMA tela do painel cadastrava um
// `TemplateDocumento` (motor genérico da v4.0, app/routers/motores.py): o backend sempre teve o
// motor, mas emitir_documento recusa com 404 "Template não encontrado ou inativo" sem um
// registro ativo pro `codigo_template` pedido. Emitir crachá/certificado de evento (abaixo)
// depende de existir CRACHA_EVENTO/CERTIFICADO_EVENTO - sem este editor embutido, os botões de
// emissão nunca funcionariam na prática. Fica só isto, escopado ao que a v4.8 precisa (nunca um
// módulo genérico de "templates de documento" à parte) - o motor não suporta editar um template
// em cima do existente, só criar um novo, então isto também não tenta ser um editor completo.
const VARIAVEIS_TEMPLATE_EVENTO =
  '{{nome_completo}}, {{titulo_evento}}, {{data_evento}}, {{carga_horaria_horas}}'

function FormularioTemplateDocumento({
  codigo,
  rotulo,
  sugestaoNome,
  onCriado,
}: {
  codigo: string
  rotulo: string
  sugestaoNome: string
  onCriado: () => void
}) {
  const criar = useMutation({
    mutationFn: (v: z.infer<typeof templateDocumentoCriarSchema>) =>
      criarTemplateDocumento(v),
    onSuccess: onCriado,
  })

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="mb-1 text-sm font-medium">
        Modelo de "{rotulo}" ainda não cadastrado
      </p>
      <p className="mb-2 text-xs text-muted-foreground">
        Sem este modelo, emitir {rotulo.toLowerCase()} vai falhar com "template
        não encontrado". Variáveis disponíveis no texto:{' '}
        {VARIAVEIS_TEMPLATE_EVENTO}.
      </p>
      <FormShell<z.infer<typeof templateDocumentoCriarSchema>>
        schema={templateDocumentoCriarSchema}
        defaultValues={{ codigo, nome: sugestaoNome, corpo_texto: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
        className="space-y-2"
      >
        {(form) => (
          <>
            {/* Campo fixo, nunca editável pela pessoa usuária - registrado (em vez de só
                confiar no defaultValues) pra garantir que vai junto no submit. */}
            <input type="hidden" {...form.register('codigo')} />
            <input
              {...form.register('nome')}
              placeholder="Nome do modelo"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.nome?.message} />
            <textarea
              {...form.register('corpo_texto')}
              placeholder="Ex.: Certificamos que {{nome_completo}} participou de {{titulo_evento}} em {{data_evento}}, com carga horária de {{carga_horaria_horas}}h."
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <ErroCampo mensagem={form.formState.errors.corpo_texto?.message} />
            <Button type="submit" size="sm" disabled={criar.isPending}>
              Cadastrar modelo
            </Button>
            {criar.isError && (
              <p className="text-sm text-destructive">
                {(criar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>
    </div>
  )
}

// ==========================================
// ELEGIBILIDADE, CRACHÁ E CERTIFICADO (v4.8) - elegibilidade é sempre CALCULADA (nunca um campo
// editável por pessoa aqui, de propósito - ver app/services/certificados.py). Crachá nunca exige
// elegibilidade (é só etiqueta de identificação); certificado recusa com 400 se a pessoa não
// bateu o percentual mínimo.
// ==========================================
function SecaoElegibilidade({ evento }: { evento: Evento }) {
  const { data: me } = useMe()
  const podeGerenciar =
    me?.permissoes.includes('gerenciar_checkin_evento') ?? false
  // v4.8 - cadastrar o TemplateDocumento (CRACHA_EVENTO/CERTIFICADO_EVENTO) chama
  // POST /api/templates-documento/, que é o motor GENÉRICO de documento (v4.0,
  // app/routers/motores.py) - gated por "projetos", de propósito nunca reaproveitado por
  // "gerenciar_checkin_evento" (esse motor também serve outros consumidores futuros, ex. FASE
  // 14). Quem só tem "gerenciar_checkin_evento" consegue emitir/gerenciar a portaria e o
  // certificado normalmente, mas precisa de alguém com "projetos" pra cadastrar o modelo uma
  // única vez.
  const podeCadastrarTemplate = me?.permissoes.includes('projetos') ?? false
  const idEvento = evento.id_evento
  const queryClient = useQueryClient()

  const { data: templates, refetch: recarregarTemplates } = useQuery({
    queryKey: ['templates-documento'],
    queryFn: listarTemplatesDocumento,
    enabled: podeGerenciar,
  })

  const { data: elegibilidade } = useQuery({
    queryKey: ['elegibilidade-evento', idEvento],
    queryFn: () => listarElegibilidadeEvento(idEvento),
    enabled: podeGerenciar,
  })

  const configurar = useMutation({
    mutationFn: (v: z.infer<typeof elegibilidadeConfigSchema>) =>
      atualizarElegibilidadeConfig(idEvento, {
        percentual_minimo: v.percentual_minimo ?? null,
        carga_horaria_horas: v.carga_horaria_horas ?? null,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['elegibilidade-evento', idEvento],
      }),
  })

  const [resultados, setResultados] = useState<
    Record<string, { ok: boolean; mensagem: string; caminho?: string }>
  >({})

  const emitirCracha = useMutation({
    mutationFn: (idPessoa: number) => emitirCrachaEvento(idEvento, idPessoa),
  })
  const emitirCertificado = useMutation({
    mutationFn: (idPessoa: number) =>
      emitirCertificadoEvento(idEvento, idPessoa),
  })

  function aoEmitirCracha(idPessoa: number) {
    const chave = `cracha:${idPessoa}`
    emitirCracha.mutate(idPessoa, {
      onSuccess: (r) =>
        setResultados((s) => ({
          ...s,
          [chave]: {
            ok: true,
            mensagem: 'Crachá emitido.',
            caminho: r.caminho_arquivo,
          },
        })),
      onError: (e) =>
        setResultados((s) => ({
          ...s,
          [chave]: { ok: false, mensagem: (e as Error).message },
        })),
    })
  }

  function aoEmitirCertificado(idPessoa: number) {
    const chave = `certificado:${idPessoa}`
    emitirCertificado.mutate(idPessoa, {
      onSuccess: (r) =>
        setResultados((s) => ({
          ...s,
          [chave]: {
            ok: true,
            mensagem: 'Certificado emitido.',
            caminho: r.caminho_arquivo,
          },
        })),
      onError: (e) =>
        setResultados((s) => ({
          ...s,
          [chave]: { ok: false, mensagem: (e as Error).message },
        })),
    })
  }

  if (!podeGerenciar) return null

  const listaTemplates = templates ?? []
  const temCracha = listaTemplates.some((t) => t.codigo === 'CRACHA_EVENTO')
  const temCertificado = listaTemplates.some(
    (t) => t.codigo === 'CERTIFICADO_EVENTO',
  )

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Elegibilidade, crachá e certificado
      </h3>

      <div className="mb-3 space-y-2">
        {(!temCracha || !temCertificado) && !podeCadastrarTemplate && (
          <p className="rounded-md border border-border bg-muted/30 p-2 text-sm text-muted-foreground">
            Ainda falta cadastrar o modelo de{' '}
            {!temCracha && !temCertificado
              ? 'crachá e de certificado'
              : !temCracha
                ? 'crachá'
                : 'certificado'}{' '}
            deste evento — peça a alguém com permissão de "projetos" para
            cadastrar (emitir crachá/certificado vai falhar até lá).
          </p>
        )}
        {!temCracha && podeCadastrarTemplate && (
          <FormularioTemplateDocumento
            codigo="CRACHA_EVENTO"
            rotulo="Crachá de evento"
            sugestaoNome="Crachá de evento ASAF"
            onCriado={() => recarregarTemplates()}
          />
        )}
        {!temCertificado && podeCadastrarTemplate && (
          <FormularioTemplateDocumento
            codigo="CERTIFICADO_EVENTO"
            rotulo="Certificado de participação em evento"
            sugestaoNome="Certificado de participação ASAF"
            onCriado={() => recarregarTemplates()}
          />
        )}
      </div>

      <FormShell<z.infer<typeof elegibilidadeConfigSchema>>
        schema={elegibilidadeConfigSchema}
        defaultValues={{}}
        onSubmit={(v) => configurar.mutateAsync(v)}
        className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-2"
      >
        {(form) => (
          <>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                % mínimo de presença (em branco = padrão institucional)
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={100}
                {...form.register('percentual_minimo', {
                  // '' -> undefined ANTES da validação (ver o comentário em schemas.ts): sem
                  // isto, limpar o campo coagiria pra 0% em vez de "não sobrescrever".
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
                className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Carga horária do evento, em horas (em branco = usa sessões)
              </label>
              <input
                type="number"
                step="0.5"
                min={0}
                {...form.register('carga_horaria_horas', {
                  setValueAs: (v) => (v === '' ? undefined : Number(v)),
                })}
                className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" size="sm" disabled={configurar.isPending}>
              Salvar configuração
            </Button>
            {configurar.isError && (
              <p className="w-full text-sm text-destructive">
                {(configurar.error as Error).message}
              </p>
            )}
          </>
        )}
      </FormShell>

      <div className="space-y-1">
        {(elegibilidade ?? []).map((p) => {
          const resultadoCracha = resultados[`cracha:${p.id_pessoa}`]
          const resultadoCertificado = resultados[`certificado:${p.id_pessoa}`]
          return (
            <div
              key={p.id_pessoa}
              className="rounded-md border border-border p-2 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {p.nome_completo ?? `Pessoa #${p.id_pessoa}`}
                  </p>
                  <p className="text-muted-foreground">
                    {p.nivel === 'indisponivel'
                      ? 'Elegibilidade indisponível — evento sem carga horária nem sessões configuradas.'
                      : `${p.percentual}% de presença (mínimo exigido: ${p.limite_aplicado}%) · ${
                          p.elegivel ? 'elegível' : 'não elegível'
                        }`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={emitirCracha.isPending}
                    onClick={() => aoEmitirCracha(p.id_pessoa)}
                  >
                    Emitir crachá
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={emitirCertificado.isPending || !p.elegivel}
                    title={
                      !p.elegivel
                        ? 'Pessoa não elegível ao certificado neste momento.'
                        : undefined
                    }
                    onClick={() => aoEmitirCertificado(p.id_pessoa)}
                  >
                    Emitir certificado
                  </Button>
                </div>
              </div>
              {resultadoCracha && (
                <p
                  className={`mt-1 text-xs ${resultadoCracha.ok ? 'text-emerald-600' : 'text-destructive'}`}
                >
                  {resultadoCracha.ok && resultadoCracha.caminho ? (
                    <a
                      className="underline"
                      href={urlArquivo(resultadoCracha.caminho)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Crachá emitido — baixar PDF
                    </a>
                  ) : (
                    resultadoCracha.mensagem
                  )}
                </p>
              )}
              {resultadoCertificado && (
                <p
                  className={`mt-1 text-xs ${resultadoCertificado.ok ? 'text-emerald-600' : 'text-destructive'}`}
                >
                  {resultadoCertificado.ok && resultadoCertificado.caminho ? (
                    <a
                      className="underline"
                      href={urlArquivo(resultadoCertificado.caminho)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Certificado emitido — baixar PDF
                    </a>
                  ) : (
                    resultadoCertificado.mensagem
                  )}
                </p>
              )}
            </div>
          )
        })}
        {(elegibilidade ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum inscrito com elegibilidade calculada ainda.
          </p>
        )}
      </div>
    </div>
  )
}

// ==========================================
// EXPORTAÇÃO DE PRESENÇA/ELEGIBILIDADE (v4.8) - permissão PRÓPRIA (`exportar_presencas_evento`,
// separada de `gerenciar_checkin_evento` de propósito - ver app/routers/eventos.py) e sempre
// auditada no backend.
// ==========================================
const COLUNAS_EXPORTAVEIS_PRESENCA: { chave: string; rotulo: string }[] = [
  { chave: 'id_pessoa', rotulo: 'ID da pessoa' },
  { chave: 'nome_completo', rotulo: 'Nome completo' },
  { chave: 'percentual', rotulo: 'Percentual de presença' },
  { chave: 'limite_aplicado', rotulo: 'Limite mínimo aplicado' },
  { chave: 'elegivel', rotulo: 'Elegível ao certificado' },
]

function SecaoExportarPresencas({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeExportar =
    me?.permissoes.includes('exportar_presencas_evento') ?? false
  const [colunasSelecionadas, setColunasSelecionadas] = useState<string[]>(
    COLUNAS_EXPORTAVEIS_PRESENCA.map((c) => c.chave),
  )
  const [resultado, setResultado] = useState<{
    colunas: string[]
    linhas: Record<string, unknown>[]
  } | null>(null)

  const exportar = useMutation({
    mutationFn: () => exportarPresencasEvento(idEvento, colunasSelecionadas),
    onSuccess: setResultado,
  })

  if (!podeExportar) return null

  function alternarColuna(chave: string) {
    setColunasSelecionadas((atual) =>
      atual.includes(chave)
        ? atual.filter((c) => c !== chave)
        : [...atual, chave],
    )
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Exportar presença/elegibilidade
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Esta exportação fica registrada na auditoria (quem exportou, quando e
        quais colunas).
      </p>
      <div className="mb-3 flex flex-wrap gap-3">
        {COLUNAS_EXPORTAVEIS_PRESENCA.map((c) => (
          <label key={c.chave} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={colunasSelecionadas.includes(c.chave)}
              onChange={() => alternarColuna(c.chave)}
            />
            {c.rotulo}
          </label>
        ))}
      </div>
      <Button
        size="sm"
        disabled={exportar.isPending || colunasSelecionadas.length === 0}
        onClick={() => exportar.mutate()}
      >
        {exportar.isPending ? 'Exportando…' : 'Exportar'}
      </Button>
      {exportar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(exportar.error as Error).message}
        </p>
      )}
      {resultado && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {resultado.colunas.map((c) => (
                  <th key={c} className="border-b border-border pb-1 pr-4">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resultado.linhas.map((linha, i) => (
                <tr key={i}>
                  {resultado.colunas.map((c) => (
                    <td key={c} className="border-b border-border py-1 pr-4">
                      {String(linha[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {resultado.linhas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma linha no resultado.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ==========================================
// PESQUISA DE SATISFAÇÃO PÓS-EVENTO (v4.10) - convite manual (idempotente, nunca duplica convite
// já enviado; roda automaticamente 1x/dia pra eventos encerrados, mesmo ciclo diário do
// fechamento financeiro v4.9 - este botão só não espera o ciclo) e resultado SEMPRE agregado e
// anônimo - não existe, em nenhum endpoint, dado por respondente (quem respondeu, de quem é cada
// comentário). A página pública de resposta (link sem login) é escopo do site institucional
// (Astro/Directus, outro repositório), fora deste painel.
// ==========================================
function SecaoPesquisaSatisfacao({ idEvento }: { idEvento: number }) {
  const { data: me } = useMe()
  const podeGerenciar = me?.permissoes.includes('projetos') ?? false
  const queryClient = useQueryClient()

  const { data: resultado } = useQuery({
    queryKey: ['pesquisa-satisfacao', idEvento],
    queryFn: () => obterResultadoPesquisaSatisfacao(idEvento),
    enabled: podeGerenciar,
  })

  const convidar = useMutation({
    mutationFn: () => convidarPesquisaSatisfacao(idEvento),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['pesquisa-satisfacao', idEvento],
      }),
  })

  if (!podeGerenciar) return null

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Pesquisa de satisfação</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Resultado sempre agregado e anônimo — não há como saber quem respondeu,
        nem de quem é cada comentário.
      </p>
      <Button
        size="sm"
        disabled={convidar.isPending}
        onClick={() => convidar.mutate()}
      >
        {convidar.isPending ? 'Convidando…' : 'Convidar inscritos'}
      </Button>
      {convidar.isSuccess && (
        <p className="mt-2 text-sm text-emerald-600">
          {convidar.data.mensagem} ({convidar.data.quantidade_convites_novos}{' '}
          novo(s)).
        </p>
      )}
      {convidar.isError && (
        <p className="mt-2 text-sm text-destructive">
          {(convidar.error as Error).message}
        </p>
      )}
      {resultado && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          <p>
            {resultado.total_respondidos} de {resultado.total_convidados}{' '}
            convidado(s) responderam
            {resultado.nota_media != null &&
              ` · nota média ${resultado.nota_media.toFixed(1)} / 10`}
          </p>
          {resultado.comentarios.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {resultado.comentarios.map((c, i) => (
                <li key={i} className="rounded-md bg-muted/40 p-2 text-xs">
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Nenhum comentário ainda.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DetalheEvento({ evento }: { evento: Evento }) {
  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="font-semibold">{evento.titulo}</h2>
        {evento.descricao && (
          <p className="text-sm text-muted-foreground">{evento.descricao}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {formatarData(evento.data_hora_inicio, { comHora: true })}
          {evento.data_hora_fim &&
            ` até ${formatarData(evento.data_hora_fim, { comHora: true })}`}{' '}
          · {evento.categoria} · {evento.visibilidade} ·{' '}
          {evento.gratuito ? 'Gratuito' : 'Pago'}
          {evento.vagas != null &&
            ` · ${evento.vagas_ocupadas}/${evento.vagas} vaga(s) ocupada(s) (${evento.vagas_livres} livre(s))`}
        </p>
      </div>
      <SecaoSessoes idEvento={evento.id_evento} />
      <SecaoCotas idEvento={evento.id_evento} />
      <SecaoPerguntas idEvento={evento.id_evento} />
      <SecaoEdicoes evento={evento} />
      <SecaoInscritos evento={evento} />
      <SecaoCobranca evento={evento} />
      <SecaoFaixasPreco idEvento={evento.id_evento} />
      <SecaoCupons idEvento={evento.id_evento} />
      <SecaoIsencoesEvento idEvento={evento.id_evento} />
      <SecaoReembolsoEvento idEvento={evento.id_evento} />
      <SecaoFechamentoEvento idEvento={evento.id_evento} />
      <SecaoPortaria idEvento={evento.id_evento} />
      <SecaoElegibilidade evento={evento} />
      <SecaoExportarPresencas idEvento={evento.id_evento} />
      <SecaoPesquisaSatisfacao idEvento={evento.id_evento} />
    </div>
  )
}

export function EventosPage() {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [idSelecionado, setIdSelecionado] = useState<number | null>(null)
  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: listarEventos,
  })

  const eventoSelecionado =
    (eventos ?? []).find((e) => e.id_evento === idSelecionado) ?? null

  return (
    <>
      <PageHeader
        titulo="Eventos"
        descricao="Evento como entidade única e pontual — programação por sessões, edições recorrentes ligadas entre si, o mesmo registro lido pelo site institucional."
      />

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Todos os eventos</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Novo evento'}
          </Button>
        </div>
        {mostrarForm && (
          <FormularioEvento onCancelar={() => setMostrarForm(false)} />
        )}
        <div className="space-y-2">
          {(eventos ?? []).map((e) => (
            <div
              key={e.id_evento}
              className="cursor-pointer rounded-md border border-border p-3 text-sm hover:bg-muted/30"
              onClick={() =>
                setIdSelecionado(
                  e.id_evento === idSelecionado ? null : e.id_evento,
                )
              }
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{e.titulo}</p>
                <span className="text-muted-foreground">{e.visibilidade}</span>
              </div>
              <p className="text-muted-foreground">
                {formatarData(e.data_hora_inicio, { comHora: true })} ·{' '}
                {e.categoria}
              </p>
            </div>
          ))}
          {(eventos ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum evento cadastrado.
            </p>
          )}
        </div>
      </section>

      {eventoSelecionado && <DetalheEvento evento={eventoSelecionado} />}
    </>
  )
}
