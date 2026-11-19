import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Copy, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'

import { CartaoDesenhado } from '@/components/credencial/CartaoDesenhado'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  apagarModeloDeCredencial,
  listarModelosDeCredencial,
  usarModeloDeCredencial,
  type ModeloDeCredencial,
} from '@/lib/api'
import { EXEMPLO, type Desenho } from '@/lib/credencial-desenho'

// v9.5k - o CRIADOR DE CREDENCIAL, página inicial (rodada 6, escolha do Presidente: "uma página inicial... que já mostra os existentes... alguns
// modelos e aí depois... a pessoa edita a credencial, arrasta e edita"). Mostra o modelo em uso (o desenho de todas as credenciais), os guardados (usar
// para todos, editar, apagar) e os modelos prontos para começar. As prévias usam uma pessoa inventada; o QR da prévia não é de ninguém.

function dataBR(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem' }).format(
    new Date(iso),
  )
}

function Previa({
  desenho,
  nome,
  grande = false,
}: {
  desenho: Desenho
  nome: string
  grande?: boolean
}) {
  return (
    <CartaoDesenhado
      desenho={desenho}
      dados={EXEMPLO}
      mmPx="classe"
      rotulo={`Prévia do modelo ${nome}`}
      className={
        grande
          ? 'rounded-lg border border-border shadow-card [--mm:3.4px] lg:[--mm:4.2px]'
          : 'rounded-lg border border-border shadow-card [--mm:2.9px]'
      }
    />
  )
}

function CartaoDeModeloGuardado({
  m,
  onAviso,
}: {
  m: ModeloDeCredencial
  onAviso: (texto: string) => void
}) {
  const cliente = useQueryClient()
  const [confirmando, setConfirmando] = useState<'usar' | 'apagar' | null>(null)
  const recarregar = () => {
    cliente.invalidateQueries({ queryKey: ['modelos-de-credencial'] })
    cliente.invalidateQueries({ queryKey: ['modelo-de-credencial-em-uso'] })
  }
  const usar = useMutation({
    mutationFn: () => usarModeloDeCredencial(m.id_modelo),
    onSuccess: (r) => {
      setConfirmando(null)
      onAviso(r.mensagem)
      recarregar()
    },
    onError: (e) =>
      onAviso(e instanceof ApiError ? e.detail : 'Não deu para usar agora.'),
  })
  const apagar = useMutation({
    mutationFn: () => apagarModeloDeCredencial(m.id_modelo),
    onSuccess: (r) => {
      setConfirmando(null)
      onAviso(r.mensagem)
      recarregar()
    },
    onError: (e) =>
      onAviso(e instanceof ApiError ? e.detail : 'Não deu para apagar agora.'),
  })
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
      <Previa desenho={m.desenho} nome={m.nome} />
      <div className="flex flex-col">
        <h3 className="font-titulo text-base font-extrabold break-words">
          {m.nome}
        </h3>
        <p className="text-sm text-muted-foreground">
          Alterado em {dataBR(m.atualizado_em)}
        </p>
      </div>
      {confirmando === null ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11 sm:min-h-9"
            onClick={() => setConfirmando('usar')}
          >
            <CheckCircle2 aria-hidden="true" />
            Usar para todos
          </Button>
          <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
            <Link
              to={`/associados/credenciais/criador/${m.id_modelo}`}
              aria-label={`Editar ${m.nome}`}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            aria-label={`Apagar ${m.nome}`}
            onClick={() => setConfirmando('apagar')}
          >
            <Trash2 aria-hidden="true" />
            Apagar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-ouro-tinta p-3 text-sm text-ouro-texto">
          <p>
            {confirmando === 'usar'
              ? 'Todas as credenciais passam a sair com este desenho (na folha A4 e na Minha carteirinha). O QR de cada uma não muda; o modelo de agora fica guardado.'
              : 'O modelo some da lista. Isso não muda nenhuma credencial.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11 sm:min-h-9"
              disabled={usar.isPending || apagar.isPending}
              onClick={() =>
                confirmando === 'usar' ? usar.mutate() : apagar.mutate()
              }
            >
              {confirmando === 'usar' ? 'Sim, usar para todos' : 'Sim, apagar'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setConfirmando(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

export function CriadorDeCredencialPage() {
  // o editor volta para cá depois de "Guardar e usar para todos", com a mensagem do servidor
  const estado = useLocation().state as { aviso?: string } | null
  const [aviso, setAviso] = useState(estado?.aviso ?? '')
  const { data, isLoading, error } = useQuery({
    queryKey: ['modelos-de-credencial'],
    queryFn: listarModelosDeCredencial,
  })
  const outros = (data?.guardados ?? []).filter((m) => !m.em_uso)
  const cheio = data ? data.guardados.length >= data.maximo_guardados : false

  return (
    <>
      <PageHeader
        titulo="Criador de credencial"
        descricao="O desenho da credencial de todos os associados: no cartão impresso e na Minha carteirinha. O QR de cada um não muda."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Credenciais', href: '/associados/credenciais' },
          { rotulo: 'Criador de credencial' },
        ]}
      />
      <p role="status" className="mb-4 text-sm font-semibold empty:hidden">
        {aviso}
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : error || !data ? (
        <EmptyState
          titulo="Não foi possível abrir os modelos"
          descricao={
            error instanceof ApiError
              ? error.detail
              : 'Confira a conexão e tente de novo.'
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          <section
            aria-labelledby="titulo-em-uso"
            className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card lg:flex-row lg:items-center lg:gap-8"
          >
            <Previa
              desenho={data.em_uso.desenho}
              nome={data.em_uso.nome}
              grande
            />
            <div className="flex flex-col gap-2">
              <p className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">
                Em uso agora
              </p>
              <h2
                id="titulo-em-uso"
                className="font-titulo text-xl font-extrabold break-words"
              >
                {data.em_uso.nome}
              </h2>
              <p className="max-w-prose text-sm">
                {data.em_uso.pronto
                  ? 'É o modelo pronto que vale enquanto nenhum outro for escolhido.'
                  : 'É o desenho de todas as credenciais agora. Para mudar, edite uma cópia e use-a para todos.'}
              </p>
              {!cheio && (
                <Button asChild className="mt-1 min-h-11 self-start">
                  <Link
                    to={`/associados/credenciais/criador/novo?de=${
                      data.em_uso.id_modelo ?? data.em_uso.pronto
                    }`}
                  >
                    <Copy aria-hidden="true" />
                    Editar uma cópia
                  </Link>
                </Button>
              )}
            </div>
          </section>

          <section
            aria-labelledby="titulo-guardados"
            className="flex flex-col gap-3"
          >
            <h2
              id="titulo-guardados"
              className="font-titulo text-lg font-extrabold"
            >
              Modelos guardados
            </h2>
            {outros.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum outro modelo guardado. Comece de um modelo pronto, logo
                abaixo.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {outros.map((m) => (
                  <CartaoDeModeloGuardado
                    key={m.id_modelo}
                    m={m}
                    onAviso={setAviso}
                  />
                ))}
              </ul>
            )}
            {cheio && (
              <p className="text-sm">
                Já há {data.maximo_guardados} modelos guardados: apague algum
                para criar outro.
              </p>
            )}
          </section>

          <section
            aria-labelledby="titulo-prontos"
            className="flex flex-col gap-3"
          >
            <h2
              id="titulo-prontos"
              className="font-titulo text-lg font-extrabold"
            >
              Começar de um modelo pronto
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {data.prontos.map((p) => (
                <li
                  key={p.chave}
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card"
                >
                  <Previa desenho={p.desenho} nome={p.nome} />
                  <h3 className="font-titulo text-base font-extrabold">
                    {p.nome}
                  </h3>
                  {!cheio && (
                    <Button
                      asChild
                      variant="outline"
                      className="min-h-11 self-start sm:min-h-9"
                    >
                      <Link
                        to={`/associados/credenciais/criador/novo?de=${p.chave}`}
                        aria-label={`Começar do modelo ${p.nome}`}
                      >
                        <Pencil aria-hidden="true" />
                        Começar deste
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  )
}
