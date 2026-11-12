import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'

import { EmptyState } from '@/components/feedback/EmptyState'
import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  atribuirPermissao,
  criarNivelAcesso,
  criarPermissao,
  listarNiveisAcesso,
  listarPermissoes,
  removerPermissao,
  type NivelAcesso,
  type PermissaoSistema,
} from '@/lib/api'
import { useImpersonacao } from '@/lib/impersonacao'
import { cn } from '@/lib/utils'

// v0.2.9 — matriz nível × permissão (CRUD da v0.1.5, que até aqui só existia via API/Swagger).
// Marcar/desmarcar uma célula chama imediatamente o backend (sem botão "salvar" separado) — o
// mesmo padrão de "ação = efeito imediato" que o resto do painel já usa em toggles simples.
/** v9.3z2: no celular, as permissões de UM nível por vez (escolhido numa lista), cada uma com o nome e a explicação; a partir do tablet, a matriz. */
function PermissoesDeUmNivel({
  niveis,
  permissoes,
  escolhido,
  aoEscolher,
  ocupado,
  aoAlternar,
  aoVerComo,
}: {
  niveis: NivelAcesso[]
  permissoes: PermissaoSistema[]
  escolhido: number | null
  aoEscolher: (id: number) => void
  ocupado: boolean
  aoAlternar: (
    nivel: NivelAcesso,
    permissao: PermissaoSistema,
    marcado: boolean,
  ) => void
  aoVerComo: (nivel: NivelAcesso) => void
}) {
  const nivel = niveis.find((n) => n.id_nivel === escolhido) ?? niveis[0]
  if (!nivel) return null
  return (
    <section aria-label="Permissões de um nível" className="sm:hidden">
      <label htmlFor="nivel-no-celular" className="text-sm font-medium">
        Nível
      </label>
      <select
        id="nivel-no-celular"
        value={nivel.id_nivel}
        onChange={(e) => aoEscolher(Number(e.target.value))}
        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3"
      >
        {niveis.map((n) => (
          <option key={n.id_nivel} value={n.id_nivel}>
            {n.nome_nivel}
          </option>
        ))}
      </select>
      {nivel.exige_mfa && (
        <p className="mt-1 text-xs text-primary">Exige o segundo passo</p>
      )}
      <ul
        aria-label={`Permissões de ${nivel.nome_nivel}`}
        className="mt-3 divide-y divide-border rounded-lg border border-border"
      >
        {permissoes.map((p) => {
          const marcado = nivel.permissoes.includes(p.id_permissao)
          return (
            <li key={p.id_permissao}>
              <label className="flex cursor-pointer items-start gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={marcado}
                  disabled={ocupado}
                  onChange={() => aoAlternar(nivel, p, marcado)}
                />
                <span>
                  <span className="block text-sm font-medium">
                    {p.nome ?? p.codigo_permissao}
                  </span>
                  {p.descricao && (
                    <span className="block text-xs text-muted-foreground">
                      {p.descricao}
                    </span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => aoVerComo(nivel)}
      >
        <Eye className="h-4 w-4" /> Ver como {nivel.nome_nivel}
      </Button>
    </section>
  )
}

export function AcessoPage() {
  const queryClient = useQueryClient()
  const { iniciar } = useImpersonacao()
  const [criandoNivel, setCriandoNivel] = useState(false)
  const [criandoPermissao, setCriandoPermissao] = useState(false)
  // v9.3z2 (no celular a matriz tinha 21,5 alturas de tela: um cartão por nível com todas as caixinhas): no celular, um nível por vez
  const [nivelNoCelular, setNivelNoCelular] = useState<number | null>(null)

  const { data: niveis, isLoading: carregandoNiveis } = useQuery({
    queryKey: ['niveis-acesso'],
    queryFn: listarNiveisAcesso,
  })
  const { data: permissoes, isLoading: carregandoPermissoes } = useQuery({
    queryKey: ['permissoes'],
    queryFn: listarPermissoes,
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['niveis-acesso'] })
  }

  const atribuir = useMutation({
    mutationFn: ({
      idNivel,
      idPermissao,
    }: {
      idNivel: number
      idPermissao: number
    }) => atribuirPermissao(idNivel, idPermissao),
    onSuccess: invalidar,
  })
  const remover = useMutation({
    mutationFn: ({
      idNivel,
      idPermissao,
    }: {
      idNivel: number
      idPermissao: number
    }) => removerPermissao(idNivel, idPermissao),
    onSuccess: invalidar,
  })

  function alternar(
    nivel: NivelAcesso,
    permissao: PermissaoSistema,
    marcado: boolean,
  ) {
    if (marcado) {
      remover.mutate({
        idNivel: nivel.id_nivel,
        idPermissao: permissao.id_permissao,
      })
    } else {
      atribuir.mutate({
        idNivel: nivel.id_nivel,
        idPermissao: permissao.id_permissao,
      })
    }
  }

  const carregando = carregandoNiveis || carregandoPermissoes

  return (
    <>
      <PageHeader
        titulo="Níveis e permissões"
        descricao="Marque ou desmarque uma célula para atribuir/remover a permissão do nível. Some efeito na hora — não há botão de salvar."
      />

      {carregando ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !niveis?.length || !permissoes?.length ? (
        <EmptyState
          titulo="Nada cadastrado ainda"
          descricao="Crie ao menos um nível e uma permissão para montar a matriz."
        />
      ) : (
        <>
          <PermissoesDeUmNivel
            niveis={niveis}
            permissoes={permissoes}
            escolhido={nivelNoCelular}
            aoEscolher={setNivelNoCelular}
            ocupado={atribuir.isPending || remover.isPending}
            aoAlternar={alternar}
            aoVerComo={(n) => iniciar(n.id_nivel, n.nome_nivel)}
          />
          <div
            role="region"
            aria-label="Quem tem acesso"
            tabIndex={0}
            className="relative hidden overflow-x-auto rounded-lg border border-border sm:block"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">Nível</th>
                  {permissoes.map((p) => (
                    <th
                      key={p.id_permissao}
                      className="px-3 py-2 text-center font-medium"
                      title={p.descricao ?? undefined}
                    >
                      {p.nome ?? p.codigo_permissao}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center font-medium">
                    Ver como
                  </th>
                </tr>
              </thead>
              <tbody>
                {niveis.map((nivel) => (
                  <tr
                    key={nivel.id_nivel}
                    className="border-b border-border last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-3 py-2 font-medium">
                      {nivel.nome_nivel}
                      {nivel.exige_mfa && (
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          Segundo passo
                        </span>
                      )}
                    </td>
                    {permissoes.map((permissao) => {
                      const marcado = nivel.permissoes.includes(
                        permissao.id_permissao,
                      )
                      return (
                        <td
                          key={permissao.id_permissao}
                          className="px-3 py-2 text-center"
                        >
                          {/* v9.3z: a caixinha dentro de uma área de 24 px (WCAG 2.5.8): a matriz tem centenas delas */}
                          <label className="inline-flex size-6 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              aria-label={`${permissao.nome ?? permissao.codigo_permissao} — ${nivel.nome_nivel}`}
                              checked={marcado}
                              disabled={atribuir.isPending || remover.isPending}
                              onChange={() =>
                                alternar(nivel, permissao, marcado)
                              }
                            />
                          </label>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          iniciar(nivel.id_nivel, nivel.nome_nivel)
                        }
                      >
                        <Eye className="h-4 w-4" />
                        <span className="sr-only">
                          Ver como {nivel.nome_nivel}
                        </span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setCriandoNivel((v) => !v)}>
          {criandoNivel ? 'Cancelar' : 'Novo nível de acesso'}
        </Button>
        <Button
          variant="outline"
          onClick={() => setCriandoPermissao((v) => !v)}
        >
          {criandoPermissao ? 'Cancelar' : 'Nova permissão'}
        </Button>
      </div>

      {criandoNivel && (
        <NovoNivelForm
          onCriado={() => {
            setCriandoNivel(false)
            invalidar()
          }}
        />
      )}
      {criandoPermissao && (
        <NovaPermissaoForm
          onCriada={() => {
            setCriandoPermissao(false)
            queryClient.invalidateQueries({ queryKey: ['permissoes'] })
          }}
        />
      )}
    </>
  )
}

const schemaNivel = z.object({
  nome_nivel: z.string().min(2, 'Informe um nome.'),
  descricao: z.string().optional(),
})

function NovoNivelForm({ onCriado }: { onCriado: () => void }) {
  const criar = useMutation({
    mutationFn: criarNivelAcesso,
    onSuccess: onCriado,
  })
  return (
    <section className={cn('mt-4 rounded-xl border border-border bg-card p-6')}>
      <h2 className="mb-4 font-semibold">Novo nível de acesso</h2>
      <FormShell
        schema={schemaNivel}
        defaultValues={{ nome_nivel: '', descricao: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Nome</label>
              <input
                {...form.register('nome_nivel')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.nome_nivel?.message} />
            </div>
            <div>
              <label className="text-sm font-medium">Descrição</label>
              <input
                {...form.register('descricao')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Criando…' : 'Criar nível'}
            </Button>
          </div>
        )}
      </FormShell>
    </section>
  )
}

const schemaPermissao = z.object({
  modulo: z.string().min(2, 'Informe o módulo.'),
  codigo_permissao: z.string().min(2, 'Informe o código.'),
  descricao: z.string().optional(),
})

function NovaPermissaoForm({ onCriada }: { onCriada: () => void }) {
  const criar = useMutation({ mutationFn: criarPermissao, onSuccess: onCriada })
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">Nova permissão</h2>
      <FormShell
        schema={schemaPermissao}
        defaultValues={{ modulo: '', codigo_permissao: '', descricao: '' }}
        onSubmit={(v) => criar.mutateAsync(v)}
      >
        {(form) => (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium">Módulo</label>
              <input
                {...form.register('modulo')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo mensagem={form.formState.errors.modulo?.message} />
            </div>
            <div>
              <label className="text-sm font-medium">Código</label>
              <input
                {...form.register('codigo_permissao')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <ErroCampo
                mensagem={form.formState.errors.codigo_permissao?.message}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Descrição</label>
              <input
                {...form.register('descricao')}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Criando…' : 'Criar permissão'}
            </Button>
          </div>
        )}
      </FormShell>
    </section>
  )
}
