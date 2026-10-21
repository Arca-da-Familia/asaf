import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '@/lib/api'
import {
  minhasPreferencias,
  mudarPreferencia,
  type MinhasPreferencias,
  type TipoDeEmail,
} from '@/lib/comunicacao'

// v6.2b - os e-mails da ASAF que a pessoa pode desligar (avisos que não são obrigatórios, lembretes de mensalidade, avisos de evento). A convocação e a mudança
// de regra não aparecem como opção: são obrigatórias (decisão do Presidente, 2026-10-20), e a tela diz isso. O e-mail que a própria pessoa pede (código,
// recibo, resposta) não é comunicação e não entra aqui. O mesmo vale pelo link "não quero mais receber" que vem em cada um desses e-mails.
export function PreferenciasDeEmail() {
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['minhas-preferencias-de-comunicacao'],
    queryFn: minhasPreferencias,
  })

  const CHAVE = ['minhas-preferencias-de-comunicacao']
  const mudar = useMutation({
    mutationFn: (v: { tipo: TipoDeEmail; recebe: boolean; rotulo: string }) =>
      mudarPreferencia(v.tipo, v.recebe),
    // a caixa muda na hora (quem clica vê o clique); se o servidor recusar, volta ao que era
    onMutate: (v) => {
      const antes = queryClient.getQueryData<MinhasPreferencias>(CHAVE)
      if (antes)
        queryClient.setQueryData<MinhasPreferencias>(CHAVE, {
          ...antes,
          tipos: antes.tipos.map((t) =>
            t.tipo === v.tipo ? { ...t, recebe: v.recebe } : t,
          ),
        })
      return { antes }
    },
    onSuccess: (novas, v) => {
      setErro(null)
      queryClient.setQueryData(CHAVE, novas)
      const rotulo = v.rotulo.charAt(0).toLowerCase() + v.rotulo.slice(1)
      setAviso(
        v.recebe
          ? `Você voltará a receber: ${rotulo}.`
          : `Você não receberá mais: ${rotulo}.`,
      )
    },
    onError: (e, _v, contexto) => {
      if (contexto?.antes) queryClient.setQueryData(CHAVE, contexto.antes)
      setAviso(null)
      setErro(e instanceof ApiError ? e.detail : 'Não foi possível salvar.')
    },
  })

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-1 font-semibold">E-mails da ASAF</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Escolha o que você quer receber por e-mail. No painel, os avisos
        continuam aparecendo no mural e em Meus avisos.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError || !data ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as suas preferências.
        </p>
      ) : !data.tem_cadastro ? (
        <p className="text-sm text-muted-foreground">
          Seu login não está ligado a um cadastro de associado: não há e-mails
          da ASAF para escolher.
        </p>
      ) : (
        <>
          <ul className="space-y-3">
            {data.tipos.map((t) => (
              <li key={t.tipo}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={t.recebe}
                    onChange={(e) =>
                      mudar.mutate({
                        tipo: t.tipo,
                        recebe: e.target.checked,
                        rotulo: t.rotulo,
                      })
                    }
                  />
                  <span>
                    {t.rotulo}
                    {t.link_de_teste && (
                      <span className="block break-all text-xs text-muted-foreground">
                        Link do e-mail (só no ambiente de teste):{' '}
                        <a href={t.link_de_teste} className="underline">
                          {t.link_de_teste}
                        </a>
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            {data.obrigatorias}
          </p>
        </>
      )}
      {aviso && (
        <p role="status" className="mt-3 text-sm">
          {aviso}
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erro}
        </p>
      )}
    </section>
  )
}
