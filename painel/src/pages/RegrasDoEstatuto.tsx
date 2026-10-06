import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  historicoDaRegraEstatutaria,
  listarRegrasEstatutarias,
  reformarRegraEstatutaria,
  type RegraEstatutaria,
} from '@/lib/api'
import { formatarVigencia } from '@/lib/datas'
import { validarValorDaRegra } from '@/lib/estatuto'

// v5.4d - "Regras do Estatuto" (backend v2.0): os números do estatuto (quórum de cada convocação, prazos, duração do mandato, vagas do Conselho
// Fiscal) vivem no banco, com vigência, e não no código: uma reforma aprovada em assembleia muda o parâmetro, não o sistema. Reformar FECHA a
// vigência atual e abre outra: nada se apaga, e o histórico mostra quanto valia em cada época. A rota do servidor existia desde a v2.0 sem tela.
function HistoricoDaRegra({ parametro }: { parametro: string }) {
  const { data: historico, isLoading } = useQuery({
    queryKey: ['regra-historico', parametro],
    queryFn: () => historicoDaRegraEstatutaria(parametro),
  })
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
      <p className="mb-1 font-medium">Histórico de vigências</p>
      {isLoading && <p className="text-muted-foreground">Carregando…</p>}
      <ul className="v3-space-y-1">
        {(historico ?? []).map((h) => (
          <li key={h.id_regra}>
            <span className="font-mono">{h.valor}</span> — de{' '}
            {formatarVigencia(h.vigencia_inicio)}{' '}
            {h.vigencia_fim
              ? `até ${formatarVigencia(h.vigencia_fim)}`
              : '(vigente)'}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReformarRegra({
  regra,
  onFechar,
}: {
  regra: RegraEstatutaria
  onFechar: () => void
}) {
  const queryClient = useQueryClient()
  const [valor, setValor] = useState(regra.valor)
  const [artigo, setArtigo] = useState(regra.artigo_origem ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  const reformar = useMutation({
    mutationFn: () =>
      reformarRegraEstatutaria(regra.parametro, {
        valor: valor.trim(),
        artigo_origem: artigo.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regras-estatuto'] })
      queryClient.invalidateQueries({
        queryKey: ['regra-historico', regra.parametro],
      })
      onFechar()
    },
    onError: (e) => {
      setErro(e.message)
      setConfirmando(false)
    },
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    const recusa = validarValorDaRegra(regra.parametro, regra.tipo, valor)
    if (recusa) return setErro(recusa)
    if (valor.trim().replace(/\s/g, '') === regra.valor.replace(/\s/g, '')) {
      return setErro('O valor novo é igual ao que já vale.')
    }
    setErro(null)
    setConfirmando(true)
  }

  return (
    <form
      onSubmit={enviar}
      noValidate
      className="mt-2 v3-space-y-2 rounded-md border border-border bg-muted/20 p-3"
    >
      <label className="block text-xs font-medium">
        Novo valor de {regra.parametro}
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          aria-label="Novo valor"
          aria-invalid={erro ? true : undefined}
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-mono"
        />
      </label>
      <label className="block text-xs font-medium">
        Artigo de origem (opcional)
        <input
          value={artigo}
          onChange={(e) => setArtigo(e.target.value)}
          aria-label="Artigo de origem"
          className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      </label>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Reformar regra
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
      <ConfirmDialog
        aberto={confirmando}
        onAbertoChange={setConfirmando}
        titulo={`Reformar ${regra.parametro}?`}
        descricao={`De “${regra.valor}” para “${valor.trim()}”. A regra atual deixa de valer agora e a nova passa a valer na hora, para tudo que ainda for apurado (quórum de sessões em andamento, prazos novos). O histórico guarda as duas, e a Auditoria registra quem reformou. Faça isto só com a reforma aprovada em assembleia.`}
        rotuloConfirmar="Reformar regra"
        carregando={reformar.isPending}
        onConfirmar={() => reformar.mutate()}
      />
    </form>
  )
}

export function RegrasDoEstatutoPage() {
  const [aberta, setAberta] = useState<{
    parametro: string
    acao: 'historico' | 'reformar'
  } | null>(null)
  const { data: regras, isLoading } = useQuery({
    queryKey: ['regras-estatuto'],
    queryFn: listarRegrasEstatutarias,
  })

  return (
    <>
      <PageHeader
        titulo="Regras do Estatuto"
        descricao="Quórum, prazos e mandatos que o sistema aplica, com o artigo de origem e o histórico de cada mudança."
        trilha={[
          { rotulo: 'Governança', href: '/governanca' },
          { rotulo: 'Regras do Estatuto' },
        ]}
      />

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {!isLoading && (regras ?? []).length === 0 && (
        <EmptyState
          icone={Scale}
          titulo="Nenhuma regra cadastrada"
          descricao="As regras do estatuto são criadas junto com o sistema."
        />
      )}
      <div className="v3-space-y-2">
        {(regras ?? []).map((r) => (
          <div
            key={r.id_regra}
            className="rounded-md border border-border bg-card p-3 text-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-mono text-xs text-muted-foreground">
                  {r.parametro}
                </p>
                <p className="mt-0.5">
                  <span className="font-mono font-semibold">{r.valor}</span>
                  {r.artigo_origem && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {r.artigo_origem}
                    </span>
                  )}
                </p>
                {r.descricao && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.descricao}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Vale desde {formatarVigencia(r.vigencia_inicio)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Histórico de ${r.parametro}`}
                  onClick={() =>
                    setAberta((a) =>
                      a?.parametro === r.parametro && a.acao === 'historico'
                        ? null
                        : { parametro: r.parametro, acao: 'historico' },
                    )
                  }
                >
                  Histórico
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Reformar ${r.parametro}`}
                  onClick={() =>
                    setAberta((a) =>
                      a?.parametro === r.parametro && a.acao === 'reformar'
                        ? null
                        : { parametro: r.parametro, acao: 'reformar' },
                    )
                  }
                >
                  Reformar
                </Button>
              </div>
            </div>
            {aberta?.parametro === r.parametro &&
              aberta.acao === 'historico' && (
                <HistoricoDaRegra parametro={r.parametro} />
              )}
            {aberta?.parametro === r.parametro &&
              aberta.acao === 'reformar' && (
                <ReformarRegra regra={r} onFechar={() => setAberta(null)} />
              )}
          </div>
        ))}
      </div>
    </>
  )
}
