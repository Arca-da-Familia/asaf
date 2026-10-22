import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { ResultadoDaVerificacao } from '@/components/documentos/ResultadoDaVerificacao'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  prepararContasParaOSite,
  situacaoDasContasNoSite,
  type ResultadoDaVerificacao as Resultado,
} from '@/lib/documentos'
import { formatarDia } from '@/lib/datas'

// v6.3b - documentos GERADOS PELO SISTEMA para a Transparência. As contas do exercício só vão ao site depois de a Assembleia aprovar (a deliberação de
// aprovação de contas numa ata assinada de assembleia realizada) e de outra pessoa (Presidente ou Secretário) aprovar a publicação; o texto e os números
// vêm dos lançamentos registrados até a Assembleia: ninguém digita nada. Abrir as contas que já existem só ABRE; gerar de novo é um botão à parte, e
// depois de publicado abre uma versão nova (com confirmação; a publicada continua no ar até a nova ser aprovada).
const anoPassado = new Date().getFullYear() - 1

export function GeradosPeloSistema() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [ano, setAno] = useState(anoPassado)
  const [erro, setErro] = useState<string | null>(null)
  const [recusado, setRecusado] = useState<Resultado | null>(null)
  const [confirmandoVersaoNova, setConfirmandoVersaoNova] = useState(false)
  const anoValido = Number.isInteger(ano) && ano >= 2000 && ano <= 2100
  const { data: situacao } = useQuery({
    queryKey: ['contas-no-site', ano],
    queryFn: () => situacaoDasContasNoSite(ano),
    enabled: anoValido,
  })
  const preparar = useMutation({
    mutationFn: () => prepararContasParaOSite(ano),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['contas-no-site', ano] })
      navigate(`/documentos/${r.id_documento}`)
    },
    onError: (e) => {
      setConfirmandoVersaoNova(false)
      if (e instanceof ApiError) {
        // a recusa por dado pessoal traz os achados MASCARADOS: mostra o que corrigir na origem
        const resultado = e.dados?.resultado as Resultado | undefined
        setRecusado(e.status === 422 && resultado ? resultado : null)
        setErro(e.detail)
      } else {
        setErro('Não foi possível preparar as contas. Tente de novo.')
      }
    },
  })
  const prepararDeNovo = () => {
    setErro(null)
    setRecusado(null)
    preparar.mutate()
  }
  const documento = situacao?.documento
  const publicado = documento?.situacao === 'Aprovado'

  return (
    <section
      aria-labelledby="gerados-pelo-sistema"
      className="mb-6 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="gerados-pelo-sistema" className="font-semibold">
        Contas do exercício para o site
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        O resumo das receitas e despesas do ano, com os pareceres do Conselho
        Fiscal, é montado dos lançamentos registrados até a Assembleia que
        aprovou as contas (ninguém digita). Só vai ao site depois dessa
        aprovação e de outra pessoa aprovar a publicação.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block">Exercício</span>
          <input
            type="number"
            min={2000}
            max={2100}
            className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
            value={ano}
            onChange={(e) => {
              setErro(null)
              setRecusado(null)
              setConfirmandoVersaoNova(false)
              setAno(Number(e.target.value))
            }}
          />
        </label>
        {documento ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(`/documentos/${documento.id_documento}`)}
            >
              Abrir as contas deste exercício
            </Button>
            {documento.situacao === 'Rascunho' && (
              <Button
                type="button"
                variant="outline"
                disabled={preparar.isPending}
                onClick={prepararDeNovo}
              >
                Gerar os números de novo
              </Button>
            )}
            {publicado && !confirmandoVersaoNova && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmandoVersaoNova(true)}
              >
                Preparar uma versão nova
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={!anoValido || preparar.isPending}
            onClick={prepararDeNovo}
          >
            Preparar as contas para o site
          </Button>
        )}
      </div>
      {publicado && confirmandoVersaoNova && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          <p>
            As contas de {ano} já estão no site. Uma versão nova é gerada com os
            números da aprovação mais recente da Assembleia e precisa de nova
            aprovação; a publicada continua no site até lá.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={preparar.isPending}
              onClick={prepararDeNovo}
            >
              Confirmar a versão nova
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmandoVersaoNova(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {situacao && (
        <p role="status" className="mt-2 text-sm">
          {situacao.aprovadas_pela_assembleia
            ? `Contas de ${situacao.ano} aprovadas pela Assembleia${
                situacao.aprovadas_em
                  ? ` em ${formatarDia(situacao.aprovadas_em)}`
                  : ''
              }.`
            : `As contas de ${situacao.ano} ainda não foram aprovadas pela Assembleia.`}
          {documento &&
            ` Documento: versão ${documento.versao}, ${documento.situacao.toLowerCase()}.`}
        </p>
      )}
      {situacao && situacao.lancamentos_registrados_depois > 0 && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {situacao.lancamentos_registrados_depois === 1
            ? '1 lançamento deste exercício foi registrado'
            : `${situacao.lancamentos_registrados_depois} lançamentos deste exercício foram registrados`}{' '}
          depois da Assembleia e não entram no que vai ao site (o site mostra o
          que a Assembleia aprovou). Para incluí-los, as contas precisam de nova
          aprovação em Assembleia.
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
      {recusado && (
        <div className="mt-2">
          <ResultadoDaVerificacao resultado={recusado} />
        </div>
      )}
    </section>
  )
}
