import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import type { AtendimentoAberto } from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { liberarRelatorioAoTitular } from '@/lib/privacidade'

// v7.2c (FASE 7) - a entrega do relatório dos dados à pessoa pela Minha conta do site (decisão 2 do Presidente, 2026-10-28): no pedido, o estado e o caminho para
// conferir; a liberação é feita na tela do relatório (LiberarRelatorio), com a impressão do que está na tela - o servidor recusa se o relatório mudou.
export function EntregaDoRelatorio({ a }: { a: AtendimentoAberto }) {
  const liberadoAte = a.relatorio_liberado_ate
  return (
    <section
      aria-label="Entregar o relatório pela Minha conta"
      data-entrega={liberadoAte ? 'liberada' : 'pendente'}
      className="space-y-2 rounded-lg border border-border p-3 text-sm"
    >
      <h2 className="text-sm font-semibold">
        Entregar o relatório pela Minha conta
      </h2>
      {liberadoAte ? (
        <p data-liberado-ate>
          Liberado: a pessoa baixa o relatório (PDF) e o arquivo para levar a
          outro serviço na Minha conta do site até{' '}
          <strong>{formatarData(liberadoAte, { comHora: true })}</strong>.
          Depois disso a cópia é apagada.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Confira o relatório e libere: por 15 dias a pessoa baixa, na Minha
          conta do site (com o código enviado ao e-mail do pedido), o PDF e o
          arquivo para levar a outro serviço. Ela baixa exatamente o que você
          conferir.
        </p>
      )}
      {a.identidade_validacao === 'CODIGO_NO_EMAIL' && (
        <p className="text-muted-foreground" data-so-o-email>
          A identidade foi provada só pelo código mandado ao e-mail: o relatório
          traz só o que foi feito com este e-mail, não o cadastro ligado a ele.
          Para entregar o cadastro, confira a identidade da pessoa por outro
          meio e entregue impresso.
        </p>
      )}
      <p>
        <Link
          className="text-primary underline"
          to={`/privacidade/titulares?id_atendimento=${a.id_atendimento}`}
        >
          {liberadoAte
            ? 'Conferir e liberar de novo (substitui o anterior)'
            : 'Conferir e liberar o relatório'}
        </Link>
      </p>
    </section>
  )
}

// na tela do relatório aberto pelo número do pedido: marcar que conferiu e liberar ESTE relatório (a impressão vai junto)
export function LiberarRelatorio({
  idAtendimento,
  impressao,
  aoMudar,
}: {
  idAtendimento: number
  impressao: string
  // o servidor recusou porque o relatório mudou: quem desenha a tela busca de novo
  aoMudar: () => void
}) {
  const queryClient = useQueryClient()
  const [conferi, setConferi] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [liberadoAte, setLiberadoAte] = useState<string | null>(null)

  const liberar = useMutation({
    mutationFn: () => liberarRelatorioAoTitular(idAtendimento, impressao),
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      setConferi(false)
      setLiberadoAte(r.valido_ate)
      queryClient.invalidateQueries({
        queryKey: ['atendimentos', 'detalhe', idAtendimento],
      })
    },
    onError: (e) => {
      setErro(mensagemDoErro(e, 'Não foi possível liberar o relatório.'))
      setConferi(false)
      aoMudar()
    },
  })

  return (
    <section
      aria-label="Liberar este relatório na Minha conta"
      className="space-y-2 rounded-lg border border-border p-3 text-sm print:hidden"
    >
      <h2 className="text-sm font-semibold">
        Liberar este relatório na Minha conta
      </h2>
      {liberadoAte ? (
        <p role="status" data-liberado-ate>
          Liberado: a pessoa baixa este relatório na Minha conta do site até{' '}
          <strong>{formatarData(liberadoAte, { comHora: true })}</strong>.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Por 15 dias a pessoa baixa, na Minha conta do site, exatamente o que
          está nesta tela: o PDF e o arquivo para levar a outro serviço.
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
        >
          {erro}
        </p>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={conferi}
          onChange={(e) => setConferi(e.target.checked)}
        />
        Conferi o relatório: não há nele dado de outra pessoa
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!conferi || liberar.isPending}
        onClick={() => liberar.mutate()}
      >
        {liberadoAte
          ? 'Liberar de novo (substitui o anterior)'
          : 'Liberar na Minha conta por 15 dias'}
      </Button>
    </section>
  )
}
