import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { formatarDia } from '@/lib/datas'
import {
  prepararRelatorioAnual,
  situacaoDoRelatorioAnual,
} from '@/lib/documentos'

// v6.3c - o relatório anual de atividades: o sistema monta os números do ano (projetos, eventos, beneficiários, voluntariado, associados, indicadores,
// contas), a secretaria escreve a apresentação (no documento aberto) e o Presidente ou o Secretário (outra pessoa) aprova. Só de ano encerrado.
// Como nas contas: abrir só abre; gerar de novo é à parte, e depois de publicado abre uma versão nova (com confirmação).
const anoPassado = new Date().getFullYear() - 1

export function RelatorioAnualParaOSite() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [ano, setAno] = useState(anoPassado)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoVersaoNova, setConfirmandoVersaoNova] = useState(false)
  const anoValido = Number.isInteger(ano) && ano >= 2000 && ano <= 2100
  const { data: situacao, isError: semSituacao } = useQuery({
    queryKey: ['relatorio-anual-no-site', ano],
    queryFn: () => situacaoDoRelatorioAnual(ano),
    enabled: anoValido,
  })
  const preparar = useMutation({
    mutationFn: () => prepararRelatorioAnual(ano),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({
        queryKey: ['relatorio-anual-no-site', ano],
      })
      navigate(`/documentos/${r.id_documento}`)
    },
    onError: (e) => {
      setConfirmandoVersaoNova(false)
      setErro(
        e instanceof ApiError
          ? e.detail
          : 'Não foi possível montar o relatório. Tente de novo.',
      )
    },
  })
  const prepararDeNovo = () => {
    setErro(null)
    preparar.mutate()
  }
  const documento = situacao?.documento
  const publicado = documento?.situacao === 'Aprovado'
  const antesDoSistema =
    !!situacao &&
    (situacao.primeiro_ano === null || situacao.ano < situacao.primeiro_ano)
  const podeMontar = !!situacao?.ano_encerrado && !antesDoSistema

  return (
    <section
      aria-labelledby="relatorio-anual"
      className="mb-6 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="relatorio-anual" className="font-semibold">
        Relatório anual de atividades
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        O sistema monta os números do ano (projetos, eventos, beneficiários,
        voluntariado, associados, indicadores e as contas, se já publicadas),
        sem nome de ninguém. A secretaria escreve a apresentação no documento e
        outra pessoa (Presidente ou Secretário) aprova a publicação. Só de ano
        encerrado.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block">Ano do relatório</span>
          <input
            type="number"
            min={2000}
            max={2100}
            className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
            value={ano}
            onChange={(e) => {
              setErro(null)
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
              Abrir o relatório deste ano
            </Button>
            {documento.situacao === 'Rascunho' && (
              <Button
                type="button"
                variant="outline"
                disabled={preparar.isPending}
                onClick={prepararDeNovo}
              >
                Montar os números de novo
              </Button>
            )}
            {publicado && !confirmandoVersaoNova && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmandoVersaoNova(true)}
              >
                Preparar uma versão nova do relatório
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={!anoValido || preparar.isPending || !podeMontar}
            onClick={prepararDeNovo}
          >
            Montar o relatório do ano
          </Button>
        )}
      </div>
      {publicado && confirmandoVersaoNova && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          <p>
            O relatório de {ano} já está no site. A versão nova é montada com os
            números de hoje e a mesma apresentação (para revisar), e precisa de
            nova aprovação; a publicada continua no site até lá.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={preparar.isPending}
              onClick={prepararDeNovo}
            >
              Confirmar a versão nova do relatório
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
          {!situacao.ano_encerrado
            ? `O ano de ${situacao.ano} ainda não acabou: o relatório só pode ser montado a partir de 1º de janeiro de ${situacao.ano + 1}.`
            : antesDoSistema && !documento
              ? `O sistema só tem registros desde ${situacao.registros_desde ? formatarDia(situacao.registros_desde) : 'agora'}: um relatório de ${situacao.ano} sairia com zeros que não correspondem à realidade.`
              : documento
                ? `Relatório de ${situacao.ano}: versão ${documento.versao}, ${documento.situacao.toLowerCase()}.`
                : `O relatório de ${situacao.ano} ainda não foi montado.`}
        </p>
      )}
      {semSituacao && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Não foi possível consultar o relatório deste ano. Tente de novo mais
          tarde.
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      )}
    </section>
  )
}
