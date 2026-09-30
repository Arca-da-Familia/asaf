import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  atualizarElegibilidadeConfig,
  criarCotaEvento,
  criarEvento,
  criarNovaEdicaoEvento,
  criarPerguntaEvento,
  criarSessaoEvento,
  criarTemplateDocumento,
  criarTokenPortaria,
  emitirCertificadoEvento,
  emitirCrachaEvento,
  exportarPresencasEvento,
  listarAssociados,
  listarCotasEvento,
  listarEdicoesEvento,
  listarElegibilidadeEvento,
  listarEspacos,
  listarEventos,
  listarInscricoesDoContexto,
  listarOpcoesCatalogo,
  listarPerguntasEvento,
  listarSessoesEvento,
  listarTemplatesDocumento,
  listarTokensPortaria,
  revogarTokenPortaria,
  urlArquivo,
  type Evento,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import {
  cotaInscricaoCriarSchema,
  elegibilidadeConfigSchema,
  eventoCriarSchema,
  novaEdicaoEventoCriarSchema,
  perguntaEventoCriarSchema,
  sessaoEventoCriarSchema,
  templateDocumentoCriarSchema,
  tokenPortariaCriarSchema,
} from '@/lib/schemas'
import { useMe } from '@/lib/use-me'

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
    </div>
  )
}

function SecaoInscritos({ evento }: { evento: Evento }) {
  const { data: inscritos } = useQuery({
    queryKey: ['inscricoes', 'Evento', evento.id_evento],
    queryFn: () => listarInscricoesDoContexto('Evento', evento.id_evento),
  })

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">
        Inscritos no evento (autoatendimento pelo painel)
      </h3>
      <div className="space-y-1">
        {(inscritos ?? []).map((i) => (
          <div
            key={i.id_inscricao}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            <span>Pessoa #{i.id_pessoa}</span>
            <span className="text-muted-foreground">{i.status}</span>
          </div>
        ))}
        {(inscritos ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma inscrição registrada ainda.
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
      <SecaoPortaria idEvento={evento.id_evento} />
      <SecaoElegibilidade evento={evento} />
      <SecaoExportarPresencas idEvento={evento.id_evento} />
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
