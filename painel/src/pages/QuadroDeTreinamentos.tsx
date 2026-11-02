import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '@/components/layout/PageHeader'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { obterQuadroDeTreinamentos } from '@/lib/privacidade'

// v7.5a - quem precisa do treinamento de privacidade e em que pé está: atrasado, pendente (com o prazo) ou feito (até quando vale). Para quem vê o módulo
// Privacidade; a prova (quem, quando, qual versão) fica no banco e na Auditoria.
export function QuadroDeTreinamentosPage() {
  const consulta = useQuery({
    queryKey: ['privacidade', 'treinamentos'],
    queryFn: obterQuadroDeTreinamentos,
  })
  const r = consulta.data
  return (
    <>
      <PageHeader
        titulo="Treinamento de privacidade"
        descricao="Quem tem acesso a dado de outras pessoas faz o treinamento: a Diretoria Executiva e o Conselho Fiscal ao entrar no cargo e a cada 2 anos; os demais todo ano."
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
      {r && (
        <section aria-label="Quem precisa do treinamento">
          <p className="mb-2 text-sm text-muted-foreground">
            Material na versão {r.versao_material}; prazo de {r.dias_para_fazer}{' '}
            dias para fazer depois que fica pendente.
          </p>
          {r.itens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ninguém precisa do treinamento agora.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Pessoa</th>
                  <th className="py-1 pr-3 font-medium">Regra</th>
                  <th className="py-1 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {r.itens.map((i) => (
                  <tr
                    key={i.id_usuario}
                    data-situacao={
                      i.atrasado
                        ? 'atrasado'
                        : i.pendente
                          ? 'pendente'
                          : 'feito'
                    }
                    className="border-t border-border"
                  >
                    <td className="py-1 pr-3">{i.nome}</td>
                    <td className="py-1 pr-3">
                      {i.com_mandato ? 'Cargo: a cada 2 anos' : 'Todo ano'}
                    </td>
                    <td className="py-1">
                      {i.atrasado
                        ? 'Atrasado'
                        : i.pendente
                          ? `Pendente (até ${i.fazer_ate ? formatarData(i.fazer_ate) : '—'})`
                          : `Feito em ${i.ultimo_em ? formatarData(i.ultimo_em) : '—'}; vale até ${i.valido_ate ? formatarData(i.valido_ate) : '—'}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  )
}
