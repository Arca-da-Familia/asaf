import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { concluirMeuTreinamento, obterMeuTreinamento } from '@/lib/privacidade'

const CHAVE = ['meu-treinamento-de-privacidade']

// v7.5a - o treinamento de privacidade de quem está logado: o material (com a versão) e o "Li e entendi", que fica registrado. Diretoria Executiva e Conselho
// Fiscal refazem a cada 2 anos; os demais com acesso a dado, todo ano (decisões do Presidente, 2026-11-02).
export function MeuTreinamentoDePrivacidadePage() {
  const cliente = useQueryClient()
  const consulta = useQuery({ queryKey: CHAVE, queryFn: obterMeuTreinamento })
  const concluir = useMutation({
    mutationFn: concluirMeuTreinamento,
    onSuccess: (dados) => cliente.setQueryData(CHAVE, dados),
  })
  const r = consulta.data
  const s = r?.situacao
  return (
    <>
      <PageHeader
        titulo="Treinamento de privacidade"
        descricao="Dez cuidados com os dados das pessoas que a associação atende. Leia com calma e confirme no fim."
      />
      {consulta.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando…
        </p>
      )}
      {consulta.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(consulta.error, 'Não foi possível carregar.')}
        </p>
      )}
      {r && s && (
        <div className="space-y-4">
          <section
            aria-label={r.material.titulo}
            className="rounded-xl border border-border p-4 text-sm"
          >
            <h2 className="mb-2 font-semibold">
              {r.material.titulo}{' '}
              <span className="font-normal text-muted-foreground">
                (versão {r.material.versao})
              </span>
            </h2>
            <ol className="list-decimal space-y-2 pl-5">
              {r.material.itens.map((item) => (
                <li key={item.titulo}>
                  <strong>{item.titulo}.</strong> {item.texto}
                </li>
              ))}
            </ol>
          </section>
          <section
            aria-label="Confirmação"
            data-testid="situacao-do-treinamento"
            data-pendente={s.pendente ? 'sim' : 'nao'}
            className="rounded-xl border border-border p-4 text-sm"
          >
            {!s.precisa ? (
              <p>
                Você só vê os seus próprios dados no painel: o treinamento não é
                obrigatório para você, mas a leitura vale para todos.
              </p>
            ) : s.pendente ? (
              <>
                <p className="mb-2">
                  {s.atrasado
                    ? 'O seu treinamento está atrasado.'
                    : `Faça até ${s.fazer_ate ? formatarData(s.fazer_ate) : '—'}.`}{' '}
                  Depois, ele vale por{' '}
                  {s.com_mandato
                    ? '2 anos (Diretoria Executiva e Conselho Fiscal)'
                    : '1 ano'}
                  .
                </p>
                {concluir.isError && (
                  <p role="alert" className="mb-2 text-destructive">
                    {mensagemDoErro(
                      concluir.error,
                      'Não foi possível registrar.',
                    )}
                  </p>
                )}
                <Button
                  type="button"
                  disabled={concluir.isPending}
                  onClick={() => concluir.mutate()}
                >
                  Li e entendi
                </Button>
              </>
            ) : (
              <p>
                Treinamento feito em{' '}
                {s.ultimo_em ? formatarData(s.ultimo_em) : '—'}; vale até{' '}
                {s.valido_ate ? formatarData(s.valido_ate) : '—'}. Obrigado!
              </p>
            )}
          </section>
        </div>
      )}
    </>
  )
}
