import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  atualizarOpcaoCatalogo,
  criarOpcaoCatalogo,
  excluirOpcaoCatalogo,
  listarOpcoesCatalogo,
  type Catalogo,
} from '@/lib/api'
import { rotaDoCatalogo, useCatalogosVisiveis } from '@/lib/catalogos-visiveis'
import {
  opcaoCatalogoCriarSchema,
  opcaoCatalogoEditarSchema,
} from '@/lib/schemas'

// v2.5.8 (FASE 2.5 - Painel) - módulo transversal Configurações (decisão registrada desde a
// v2.5.1, só construída agora que Governança também tem módulos reais o bastante pra confirmar
// que "agrupar por módulo dono" faz sentido na prática): edita os CATÁLOGOS (categoria, status,
// motivos, tipos...) usados pelos módulos de negócio - nunca uma tela por módulo, nunca
// duplicada, sempre a mesma origem de dado.
//
// Achado do usuário ao pedir esta versão: gerenciar catálogo exigia SEMPRE `gerenciar_acesso`
// (mesma permissão de Níveis e permissões) - um secretário (permissão `associados`) precisava de
// acesso bem mais amplo que o necessário só pra ajustar a categoria de associado. Corrigido no
// backend (`Catalogo.permissao_gerenciamento`, migração 75fa21fb920d): cada catálogo agora
// declara o módulo dono, e quem tem a permissão daquele módulo (ou `gerenciar_acesso`, sempre,
// como reforço) pode gerenciar. Por isso esta tela é uma rota GLOBAL (não travada atrás de uma
// permissão única) - mesmo padrão de Conselho Fiscal/Disciplina/Calendário: cada usuário só vê
// (e só consegue editar) os catálogos dos módulos que já tem permissão.

function BlocoOpcoes({ catalogo }: { catalogo: Catalogo }) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<number | null>(null)
  const queryClient = useQueryClient()

  const { data: opcoes } = useQuery({
    queryKey: ['opcoes-catalogo-config', catalogo.chave],
    queryFn: () => listarOpcoesCatalogo(catalogo.chave, true),
  })

  function invalidar() {
    queryClient.invalidateQueries({
      queryKey: ['opcoes-catalogo-config', catalogo.chave],
    })
    // outras telas do sistema usam a mesma chave de cache sem o "true" de incluir inativos
    queryClient.invalidateQueries({
      queryKey: ['opcoes-catalogo', catalogo.chave],
    })
  }

  const criar = useMutation({
    mutationFn: (v: z.infer<typeof opcaoCatalogoCriarSchema>) =>
      criarOpcaoCatalogo(catalogo.chave, v),
    onSuccess: () => {
      invalidar()
      setMostrarForm(false)
    },
  })
  const editar = useMutation({
    mutationFn: ({
      idOpcao,
      dados,
    }: {
      idOpcao: number
      dados: z.infer<typeof opcaoCatalogoEditarSchema>
    }) => atualizarOpcaoCatalogo(idOpcao, dados),
    onSuccess: () => {
      invalidar()
      setEditando(null)
    },
  })
  const alternarAtivo = useMutation({
    mutationFn: ({ idOpcao, ativo }: { idOpcao: number; ativo: boolean }) =>
      atualizarOpcaoCatalogo(idOpcao, { ativo }),
    onSuccess: invalidar,
  })
  const excluir = useMutation({
    mutationFn: (idOpcao: number) => excluirOpcaoCatalogo(idOpcao),
    onSuccess: invalidar,
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{catalogo.nome_exibido}</h2>
          {catalogo.descricao && (
            <p className="text-sm text-muted-foreground">
              {catalogo.descricao}
            </p>
          )}
          {!catalogo.editavel_pelo_usuario && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Catálogo de sistema - código fixo, só rótulo/ordem/ativo podem
              mudar.
            </p>
          )}
        </div>
        {catalogo.editavel_pelo_usuario && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMostrarForm((v) => !v)}
          >
            {mostrarForm ? 'Cancelar' : 'Nova opção'}
          </Button>
        )}
      </div>

      {mostrarForm && (
        <FormShell<z.infer<typeof opcaoCatalogoCriarSchema>>
          schema={opcaoCatalogoCriarSchema}
          defaultValues={{ codigo: '', rotulo: '' }}
          onSubmit={(v) => criar.mutateAsync(v)}
          className="mb-4 grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
        >
          {(form) => (
            <>
              <div>
                <input
                  {...form.register('codigo')}
                  placeholder="CODIGO_TECNICO"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm uppercase"
                />
                <ErroCampo mensagem={form.formState.errors.codigo?.message} />
              </div>
              <div>
                <input
                  {...form.register('rotulo')}
                  placeholder="Rótulo exibido"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <ErroCampo mensagem={form.formState.errors.rotulo?.message} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={criar.isPending}>
                  {criar.isPending ? 'Adicionando…' : 'Adicionar opção'}
                </Button>
              </div>
            </>
          )}
        </FormShell>
      )}

      <div className="v3-space-y-2">
        {(opcoes ?? []).map((o) => (
          <div
            key={o.id_opcao}
            className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
          >
            {editando === o.id_opcao ? (
              <FormShell<z.infer<typeof opcaoCatalogoEditarSchema>>
                schema={opcaoCatalogoEditarSchema}
                defaultValues={{ rotulo: o.rotulo }}
                onSubmit={(v) =>
                  editar.mutateAsync({ idOpcao: o.id_opcao, dados: v })
                }
                className="flex flex-1 items-center gap-2"
              >
                {(form) => (
                  <>
                    <input
                      {...form.register('rotulo')}
                      className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    />
                    <Button type="submit" size="sm" disabled={editar.isPending}>
                      Salvar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEditando(null)}
                    >
                      Cancelar
                    </Button>
                  </>
                )}
              </FormShell>
            ) : (
              <>
                <div>
                  <span
                    className={
                      o.ativo ? '' : 'text-muted-foreground line-through'
                    }
                  >
                    {o.rotulo}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {o.codigo}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditando(o.id_opcao)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alternarAtivo.isPending}
                    onClick={() =>
                      alternarAtivo.mutate({
                        idOpcao: o.id_opcao,
                        ativo: !o.ativo,
                      })
                    }
                  >
                    {o.ativo ? 'Desativar' : 'Reativar'}
                  </Button>
                  {!o.ativo && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={excluir.isPending}
                      onClick={() => excluir.mutate(o.id_opcao)}
                    >
                      Excluir
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
        {excluir.isError && (
          <p className="text-sm text-destructive">
            {(excluir.error as Error).message}
          </p>
        )}
        {(opcoes ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma opção cadastrada.
          </p>
        )}
      </div>
    </section>
  )
}

export function ConfiguracoesPage() {
  // v9.3 (achado do Presidente, 05/11): a lista dos catálogos saiu da página e foi para a barra lateral, como o menu de qualquer módulo (o menu principal
  // dá lugar a "← Início" + os catálogos, e cada coluna rola sozinha); no celular o conteúdo aparece direto e os catálogos ficam no botão de menu, em vez
  // de uma lista inteira antes do que se quer editar. Cada catálogo tem o seu endereço (/configuracoes/<chave>).
  const { chave } = useParams<{ chave?: string }>()
  const { todos, carregado } = useCatalogosVisiveis()

  if (carregado && todos.length === 0) {
    return (
      <>
        <PageHeader
          titulo="Configurações"
          descricao="Catálogos usados pelos módulos de negócio."
        />
        <p className="text-sm text-muted-foreground">
          Nenhuma configuração disponível para o seu nível de acesso.
        </p>
      </>
    )
  }
  // sem catálogo no endereço: abre o primeiro (a barra lateral marca qual é)
  const primeiro = todos[0]
  if (!chave && primeiro) {
    return <Navigate to={rotaDoCatalogo(primeiro.chave)} replace />
  }
  const catalogoAtivo = todos.find((c) => c.chave === chave)

  return (
    <>
      <PageHeader
        titulo="Configurações"
        descricao="Catálogos usados pelos módulos de negócio - cada um só aparece pra quem tem a permissão do módulo dono. Escolha o catálogo no menu."
      />
      {catalogoAtivo ? (
        <BlocoOpcoes key={catalogoAtivo.chave} catalogo={catalogoAtivo} />
      ) : (
        carregado && (
          <p className="text-sm text-muted-foreground">
            Este catálogo não existe ou não está disponível para o seu nível de
            acesso. Escolha outro no menu.
          </p>
        )
      )}
    </>
  )
}
