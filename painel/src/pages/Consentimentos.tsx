import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { LerAviso } from '@/components/privacidade/LerAviso'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import {
  obterConsentimentos,
  type OrigemDeConsentimento,
  type ResumoDoConsentimento,
} from '@/lib/consentimentos'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'

function Linha({ c }: { c: ResumoDoConsentimento }) {
  return (
    <li
      className="rounded-md border border-border p-3 text-sm"
      data-consentimento={c.id_consentimento}
    >
      <p className="font-medium">
        {c.origem_rotulo} nº {c.id_origem} · {c.titular}
      </p>
      <p className="text-xs text-muted-foreground">
        Termo versão {c.versao}
        {c.versao !== c.versao_atual_do_termo &&
          ` (hoje vale a ${c.versao_atual_do_termo})`}{' '}
        · {c.meio_rotulo}
        {c.id_documento !== null && ` (documento nº ${c.id_documento})`} ·{' '}
        {c.meio === 'declaracao_antiga' ? 'declarado em' : 'assinado em'}{' '}
        {formatarData(c.dado_em.slice(0, 10))}
      </p>
      {c.encerrado_em ? (
        <p className="text-xs text-destructive">
          {c.encerramento_rotulo} em{' '}
          {formatarData(c.encerrado_em, { comHora: true })}
          {c.motivo_encerramento && `: ${c.motivo_encerramento}`}
        </p>
      ) : (
        <p className="text-xs text-green-800 dark:text-green-400">Vigente</p>
      )}
      <LerAviso ponto={c.termo} versao={c.versao} />
    </li>
  )
}

// v7.1b - a PROVA de cada consentimento (LGPD, art. 8º): o termo e a versão que a pessoa assinou, quem, como, quando e, se acabou, quando e por quê. Revogar é
// apagar a foto (na tela da foto); o consentimento encerrado continua aqui pelo prazo de guarda da prova (Regras do sistema) e depois a rotina o apaga.
export function ConsentimentosPage() {
  const [situacao, setSituacao] = useState<'' | 'vigentes' | 'encerrados'>('')
  const [origem, setOrigem] = useState<'' | OrigemDeConsentimento>('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const idSituacao = useId()
  const idOrigem = useId()
  const idBusca = useId()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      'privacidade',
      'consentimentos',
      situacao,
      origem,
      busca,
      pagina,
    ],
    queryFn: () => obterConsentimentos(situacao, origem, busca, pagina),
    placeholderData: keepPreviousData,
  })
  const paginas = data
    ? Math.max(1, Math.ceil(data.total / data.por_pagina))
    : 1
  return (
    <>
      <PageHeader
        titulo="Consentimentos"
        descricao="A prova de cada consentimento dado: o termo e a versão que a pessoa assinou, quem, como e quando; e, se acabou, quando e por quê. Revogar é apagar a foto, na tela dela."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Privacidade' },
          { rotulo: 'Consentimentos' },
        ]}
      />
      <div className="mb-2 flex flex-wrap gap-3">
        <div>
          <label htmlFor={idSituacao} className="block text-sm font-medium">
            Situação
          </label>
          <select
            id={idSituacao}
            className={classeCampo}
            value={situacao}
            onChange={(e) => {
              setSituacao(e.target.value as typeof situacao)
              setPagina(1)
            }}
          >
            <option value="">Todos</option>
            <option value="vigentes">Vigentes</option>
            <option value="encerrados">Encerrados</option>
          </select>
        </div>
        <div>
          <label htmlFor={idOrigem} className="block text-sm font-medium">
            O que ele cobre
          </label>
          <select
            id={idOrigem}
            className={classeCampo}
            value={origem}
            onChange={(e) => {
              setOrigem(e.target.value as typeof origem)
              setPagina(1)
            }}
          >
            <option value="">Tudo</option>
            {Object.entries(data?.origens ?? {}).map(([codigo, rotulo]) => (
              <option key={codigo} value={codigo}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={idBusca} className="block text-sm font-medium">
            Nome de quem assinou
          </label>
          <input
            id={idBusca}
            type="search"
            className={classeCampo}
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value)
              setPagina(1)
            }}
          />
        </div>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Quem retira a autorização das fotos de atividade tem de ter TODAS as
        fotos em que aparece apagadas: procure o nome aqui.
      </p>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(error, 'Não foi possível carregar.')}
        </p>
      )}
      {data && data.consentimentos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum consentimento com estes filtros.
        </p>
      )}
      {data && data.consentimentos.length > 0 && (
        <>
          <p className="mb-2 text-xs text-muted-foreground" role="status">
            {data.total} consentimento(s) · página {data.pagina} de {paginas}
          </p>
          <ul className="v3-space-y-2">
            {data.consentimentos.map((c) => (
              <Linha key={c.id_consentimento} c={c} />
            ))}
          </ul>
          {paginas > 1 && (
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pagina <= 1}
                onClick={() => setPagina(pagina - 1)}
              >
                Página anterior
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pagina >= paginas}
                onClick={() => setPagina(pagina + 1)}
              >
                Próxima página
              </Button>
            </div>
          )}
        </>
      )}
    </>
  )
}
