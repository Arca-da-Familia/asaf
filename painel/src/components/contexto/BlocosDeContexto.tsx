import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FilePlus2 } from 'lucide-react'
import { Link } from 'react-router'

import { SeloDeSituacao } from '@/components/documentos/Selos'
import { Button } from '@/components/ui/button'
import {
  ENDERECO_DE_NOVA_NOTICIA,
  enderecoDoNovoRelatorio,
  type TipoDeContexto,
} from '@/lib/contexto'
import { listarDocumentos } from '@/lib/documentos'
import { useMe } from '@/lib/use-me'

// Quem pode ler a biblioteca de Documentos (a mesma regra do servidor); quem pode criar é só `documentos`.
const PERMISSOES_DE_LEITURA_DE_DOCUMENTOS = [
  'documentos',
  'documentos_originais',
  'aprovar_publicacao',
  'auditoria',
]

// "Relatórios e documentos": o que a biblioteca de Documentos já tem ligado a este evento ou projeto, com a situação de
// cada um, e o atalho para escrever um relatório novo já ligado a ele.
export function RelatoriosEDocumentos({
  tipo,
  id,
}: {
  tipo: TipoDeContexto
  id: number
}) {
  const { data: me } = useMe()
  const permissoes = me?.permissoes ?? []
  const podeVer = PERMISSOES_DE_LEITURA_DE_DOCUMENTOS.some((p) =>
    permissoes.includes(p),
  )
  const podeCriar = permissoes.includes('documentos')
  const nome = tipo

  const {
    data: documentos,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['documentos', 'vinculo', tipo, id],
    queryFn: () => listarDocumentos({ vinculo_tipo: tipo, vinculo_id: id }),
    enabled: podeVer,
  })

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Relatórios e documentos</h4>
      <p className="text-xs text-muted-foreground">
        Os relatórios ficam na biblioteca de Documentos, ligados a este {nome}.
        Para aparecer no site, o relatório precisa de uma versão pública
        conferida e da aprovação de outra pessoa.
      </p>
      {!podeVer ? (
        <p className="text-sm text-muted-foreground">
          Você não tem permissão para ver os documentos.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar os documentos. Tente de novo.
        </p>
      ) : (documentos ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum relatório ou documento ligado a este {nome} ainda.
        </p>
      ) : (
        <ul className="space-y-1">
          {(documentos ?? []).map((d) => (
            <li
              key={d.id_documento}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
            >
              <Link
                to={`/documentos/${d.id_documento}`}
                className="font-medium hover:underline"
              >
                {d.titulo}
              </Link>
              <span className="text-xs text-muted-foreground">
                {d.tipo_rotulo}
                {d.versao > 1 && ` · versão ${d.versao}`}
                {!d.vigente && ' (não vigente)'}
              </span>
              <SeloDeSituacao situacao={d.situacao} />
            </li>
          ))}
        </ul>
      )}
      {podeCriar && (
        <Button asChild variant="outline" size="sm">
          <Link to={enderecoDoNovoRelatorio(tipo, id)}>
            <FilePlus2 aria-hidden="true" /> Novo relatório deste {nome}
          </Link>
        </Button>
      )}
    </div>
  )
}

// "Notícias deste evento/projeto": a notícia é escrita no editor do site; aqui só se explica como ligar pelo número.
export function NoticiasDoContexto({
  tipo,
  id,
  apareceNoSite,
}: {
  tipo: TipoDeContexto
  id: number
  // O evento/projeto Interno não tem página no site: a notícia pode ser ligada, mas não aparece nele.
  apareceNoSite: boolean
}) {
  const nome = tipo
  const campo = tipo === 'evento' ? 'Número do evento' : 'Número do projeto'
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">
        Notícias {tipo === 'evento' ? 'deste evento' : 'deste projeto'}
      </h4>
      <p className="text-sm">
        As notícias são escritas no editor do site, não aqui. Ao escrever, abra
        a parte “Ligada a um projeto ou evento”. No campo “{campo}”, digite{' '}
        <strong>{id}</strong>. Depois de publicada, a notícia entra sozinha na
        página do {nome} no site, em até 25 minutos.
      </p>
      {!apareceNoSite && (
        <p className="text-sm text-muted-foreground">
          Este {nome} é Interno e não tem página no site. Para a notícia
          aparecer nele, deixe-o Público.
        </p>
      )}
      <Button asChild variant="outline" size="sm">
        <a
          href={ENDERECO_DE_NOVA_NOTICIA}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink aria-hidden="true" /> Escrever notícia deste {nome}
          <span className="sr-only"> (abre em outra aba)</span>
        </a>
      </Button>
    </div>
  )
}
