import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  NoticiasDoContexto,
  RelatoriosEDocumentos,
} from '@/components/contexto/BlocosDeContexto'
import { Campo } from '@/components/forms/Campo'
import { FotosComAutorizacao } from '@/components/fotos/FotosComAutorizacao'
import { Button } from '@/components/ui/button'
import {
  apagarFotoDoEvento,
  caminhoDaFotoDoEvento,
  editarEvento,
  enviarFotoDoEvento,
  listarFotosDoEvento,
  listarProjetos,
  type Evento,
} from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import { fraseDaPublicacaoNoProjeto } from '@/lib/contexto'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { useMe } from '@/lib/use-me'

// v5.5 - "Contexto do evento": tudo o que se liga a este evento num lugar só: o projeto a que ele pertence, os
// relatórios (documentos ligados), as fotos (com autorização de imagem) e as notícias (escritas no editor do site e
// ligadas pelo número do evento).
export function ContextoDoEvento({ evento }: { evento: Evento }) {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const podeProjetos = me?.permissoes.includes('projetos') ?? false
  const idEvento = evento.id_evento

  const { data: projetos } = useQuery({
    queryKey: ['projetos'],
    queryFn: listarProjetos,
    enabled: podeProjetos,
  })
  const projetoAtual = (projetos ?? []).find(
    (p) => p.id_projeto === evento.id_projeto,
  )

  // ------------------------------------------------------------------ projeto do evento (trocável)
  const [escolhido, setEscolhido] = useState(
    evento.id_projeto != null ? String(evento.id_projeto) : '',
  )
  const [erroProjeto, setErroProjeto] = useState<string | null>(null)
  const [avisoProjeto, setAvisoProjeto] = useState<string | null>(null)
  const atual = evento.id_projeto != null ? String(evento.id_projeto) : ''
  const salvarProjeto = useMutation({
    mutationFn: () =>
      editarEvento(idEvento, {
        id_projeto: escolhido ? Number(escolhido) : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      setAvisoProjeto('Projeto do evento atualizado.')
    },
    onError: (e) =>
      setErroProjeto(
        mensagemDoErro(e, 'Não foi possível trocar o projeto. Tente de novo.'),
      ),
  })

  // ------------------------------------------------------------------ fotos do evento
  const chaveDasFotos = ['fotos-evento', idEvento]
  const { data: fotos } = useQuery({
    queryKey: chaveDasFotos,
    queryFn: () => listarFotosDoEvento(idEvento),
    enabled: podeProjetos,
  })

  // O servidor devolve a lista atualizada depois de enviar ou apagar; sem ela, busca de novo.
  function atualizarFotos(lista: unknown) {
    if (Array.isArray(lista)) queryClient.setQueryData(chaveDasFotos, lista)
    else queryClient.invalidateQueries({ queryKey: chaveDasFotos })
  }

  const frase = fraseDaPublicacaoNoProjeto(evento, projetoAtual)
  const projetoDesconhecido =
    escolhido !== '' &&
    !(projetos ?? []).some((p) => String(p.id_projeto) === escolhido)

  return (
    <section aria-label="Contexto do evento" className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">Contexto do evento</h3>
        <p className="text-sm text-muted-foreground">
          Tudo o que está ligado a este evento: o projeto, os relatórios, as
          fotos e as notícias.
        </p>
      </div>

      <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
        O número deste evento é{' '}
        <strong className="text-base">{idEvento}</strong>. É ele que se digita
        no editor do site para ligar uma notícia ao evento.
      </p>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Projeto</h4>
        <p className="text-sm">
          {evento.id_projeto == null ? (
            'Este evento não está ligado a nenhum projeto.'
          ) : projetoAtual ? (
            <>
              Faz parte do projeto <strong>{projetoAtual.nome_projeto}</strong>{' '}
              (nº {projetoAtual.id_projeto}).
            </>
          ) : (
            `Faz parte do projeto nº ${evento.id_projeto}.`
          )}
        </p>
        {frase && <p className="text-sm text-muted-foreground">{frase}</p>}
        {podeProjetos && (
          <div className="flex flex-wrap items-end gap-2">
            <Campo rotulo="Trocar o projeto deste evento" className="w-72">
              <select
                className={classeCampo}
                value={escolhido}
                onChange={(e) => {
                  setEscolhido(e.target.value)
                  setAvisoProjeto(null)
                  setErroProjeto(null)
                }}
              >
                <option value="">Sem projeto</option>
                {projetoDesconhecido && (
                  <option value={escolhido}>Projeto nº {escolhido}</option>
                )}
                {(projetos ?? []).map((p) => (
                  <option key={p.id_projeto} value={p.id_projeto}>
                    {p.nome_projeto} (nº {p.id_projeto})
                  </option>
                ))}
              </select>
            </Campo>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={escolhido === atual || salvarProjeto.isPending}
              onClick={() => {
                setErroProjeto(null)
                setAvisoProjeto(null)
                salvarProjeto.mutate()
              }}
            >
              {salvarProjeto.isPending ? 'Salvando…' : 'Salvar projeto'}
            </Button>
          </div>
        )}
        {erroProjeto && (
          <p role="alert" className="text-sm text-destructive">
            {erroProjeto}
          </p>
        )}
        {avisoProjeto && (
          <p role="status" className="text-sm text-muted-foreground">
            {avisoProjeto}
          </p>
        )}
      </div>

      <RelatoriosEDocumentos tipo="evento" id={idEvento} />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Fotos do evento</h4>
        <p className="text-xs text-muted-foreground">
          As fotos aparecem na página do evento no site quando o evento é
          Público, e todas as que já foram enviadas aparecem de uma vez: confira
          antes de mudar o evento para Público. A descrição escrita aqui é lida
          por quem usa leitor de tela (não aparece como legenda).
        </p>
        {podeProjetos ? (
          <FotosComAutorizacao
            fotos={fotos ?? []}
            urlDoArquivo={(idFoto) => caminhoDaFotoDoEvento(idEvento, idFoto)}
            podeEditar={podeProjetos}
            onEnviar={async (dados) => {
              atualizarFotos(await enviarFotoDoEvento(idEvento, dados))
              return true
            }}
            onApagar={async (idFoto) => {
              atualizarFotos(await apagarFotoDoEvento(idEvento, idFoto))
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Você não tem permissão para ver as fotos deste evento.
          </p>
        )}
      </div>

      <NoticiasDoContexto
        tipo="evento"
        id={idEvento}
        apareceNoSite={evento.visibilidade === 'Pública'}
      />
    </section>
  )
}
