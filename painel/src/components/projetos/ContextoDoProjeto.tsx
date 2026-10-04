import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import {
  NoticiasDoContexto,
  RelatoriosEDocumentos,
} from '@/components/contexto/BlocosDeContexto'
import { listarEventos, type Projeto } from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'

// v5.5 - "Contexto do projeto": os eventos (edições) ligados a ele, os relatórios (documentos ligados) e as notícias
// (escritas no editor do site e ligadas pelo número do projeto). As fotos são enviadas em cada evento.
export function ContextoDoProjeto({ projeto }: { projeto: Projeto }) {
  const { data: me } = useMe()
  const podeProjetos = me?.permissoes.includes('projetos') ?? false
  const idProjeto = projeto.id_projeto
  const publico = projeto.visibilidade === 'Pública'

  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: listarEventos,
    enabled: podeProjetos,
  })
  const doProjeto = (eventos ?? []).filter((e) => e.id_projeto === idProjeto)

  return (
    <section aria-label="Contexto do projeto" className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Contexto do projeto</h3>
        <p className="text-sm text-muted-foreground">
          Tudo o que está ligado a este projeto: os eventos, os relatórios e as
          notícias.
        </p>
      </div>

      <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        O número deste projeto é{' '}
        <strong className="text-base">{idProjeto}</strong>. É ele que se digita
        no editor do site para ligar uma notícia ao projeto.
      </p>

      <p className="text-sm text-muted-foreground">
        {publico
          ? projeto.destaque_no_site
            ? 'Este projeto é Público e está em destaque na página inicial do site. Os eventos Públicos dele aparecem na página do projeto.'
            : 'Este projeto é Público: tem página no site, com os eventos Públicos dele. Para ele aparecer em destaque na página inicial, use “Editar projeto”.'
          : 'Este projeto é Interno: não aparece no site, nem os eventos ligados a ele aparecem como parte dele.'}
      </p>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Eventos deste projeto</h4>
        <p className="text-xs text-muted-foreground">
          Cada edição é um evento ligado ao projeto. As fotos são enviadas em
          cada evento.
        </p>
        {!podeProjetos ? (
          <p className="text-sm text-muted-foreground">
            Você não tem permissão para ver os eventos.
          </p>
        ) : doProjeto.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum evento ligado a este projeto. Ao criar ou editar um evento,
            escolha este projeto.
          </p>
        ) : (
          <ul className="space-y-1">
            {doProjeto.map((e) => (
              <li
                key={e.id_evento}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-sm"
              >
                <Link
                  to={`/eventos?evento=${e.id_evento}`}
                  className="font-medium hover:underline"
                >
                  {e.titulo}
                </Link>
                <span className="text-xs text-muted-foreground">
                  nº {e.id_evento} ·{' '}
                  {formatarData(e.data_hora_inicio, { comHora: true })} ·{' '}
                  {e.visibilidade === 'Pública' ? 'Público' : 'Interno'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RelatoriosEDocumentos tipo="projeto" id={idProjeto} />

      <NoticiasDoContexto
        tipo="projeto"
        id={idProjeto}
        apareceNoSite={publico}
      />
    </section>
  )
}
