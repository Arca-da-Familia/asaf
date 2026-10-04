import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, FileCheck2, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'

import { ResultadoDaVerificacao } from '@/components/documentos/ResultadoDaVerificacao'
import {
  SeloDeClassificacao,
  SeloDeSituacao,
  SeloDeValidade,
} from '@/components/documentos/Selos'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  abrirVersaoPublica,
  aprovarDocumento,
  baixarOriginal,
  criarNovaVersao,
  enviarOriginal,
  enviarParaRevisao,
  enviarVersaoPublica,
  formatarTamanho,
  listarDocumentos,
  listarHistoricoDoDocumento,
  obterDocumento,
  proximoPasso,
  recusarDocumento,
  retirarDocumento,
  tornarVigente,
  usarOriginalComoVersaoPublica,
  type Documento,
  type ResultadoDaVerificacao as Resultado,
} from '@/lib/documentos'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section
      aria-label={titulo}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <h2 className="font-semibold">{titulo}</h2>
      {children}
    </section>
  )
}

// A API grava datetime ingênuo em UTC: `formatarData` converte para a hora de quem está vendo.
function dataHora(valor: string | null): string {
  return valor ? formatarData(valor, { comHora: true }) : '—'
}

type Confirmacao = 'aprovar' | 'recusar' | 'retirar' | null

export function DocumentoDetalhePage() {
  const { id } = useParams()
  const idDocumento = Number(id)
  const queryClient = useQueryClient()
  const { data: eu } = useMe()
  const podePreparar = eu?.permissoes.includes('documentos') ?? false

  const [erro, setErro] = useState<string | null>(null)
  const [recusado, setRecusado] = useState<Resultado | null>(null)
  const [arquivoOriginal, setArquivoOriginal] = useState<File | null>(null)
  const [arquivoPublico, setArquivoPublico] = useState<File | null>(null)
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null)
  const [motivo, setMotivo] = useState('')

  const { data: doc, isLoading } = useQuery({
    queryKey: ['documento', idDocumento],
    queryFn: () => obterDocumento(idDocumento),
    enabled: Number.isFinite(idDocumento),
  })
  const { data: versoes } = useQuery({
    queryKey: ['documentos', 'versoes', doc?.grupo_versao],
    queryFn: () => listarDocumentos({ grupo_versao: doc!.grupo_versao }),
    enabled: !!doc,
  })
  const { data: trilha } = useQuery({
    queryKey: ['documento-historico', idDocumento],
    queryFn: () => listarHistoricoDoDocumento(idDocumento),
    enabled: !!doc,
  })

  function atualizar() {
    queryClient.invalidateQueries({ queryKey: ['documento', idDocumento] })
    queryClient.invalidateQueries({ queryKey: ['documentos'] })
    queryClient.invalidateQueries({
      queryKey: ['documento-historico', idDocumento],
    })
  }

  function tratarErro(e: unknown) {
    setRecusado(null)
    if (e instanceof ApiError) {
      const resultado = e.dados?.resultado as Resultado | undefined
      if (e.status === 422 && resultado) setRecusado(resultado)
      setErro(e.detail)
    } else {
      setErro('Algo deu errado. Tente de novo.')
    }
  }

  function executar<T>(funcao: () => Promise<T>, aposSucesso?: () => void) {
    return async () => {
      setErro(null)
      try {
        await funcao()
        setRecusado(null)
        aposSucesso?.()
        atualizar()
      } catch (e) {
        tratarErro(e)
      }
    }
  }

  const original = useMutation({
    mutationFn: () => enviarOriginal(idDocumento, arquivoOriginal!),
  })
  const publica = useMutation({
    mutationFn: () => enviarVersaoPublica(idDocumento, arquivoPublico!),
  })

  if (isLoading || !doc) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  }

  const d: Documento = doc
  const noSite = d.publicar_no_site

  return (
    <>
      <PageHeader
        titulo={d.titulo}
        trilha={[
          { rotulo: 'Documentos', href: '/documentos' },
          { rotulo: d.tipo_rotulo },
        ]}
      />

      <div className="max-w-3xl space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <SeloDeSituacao situacao={d.situacao} />
          <SeloDeClassificacao classificacao={d.classificacao} />
          <span className="text-sm text-muted-foreground">
            versão {d.versao}
            {d.vigente ? ' (vigente)' : ' (não vigente)'}
          </span>
          <SeloDeValidade validade={d.validade} />
        </div>

        <p
          role="status"
          className="rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          <strong>Próximo passo:</strong> {proximoPasso(d)}
        </p>

        {erro && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}
        {recusado && <ResultadoDaVerificacao resultado={recusado} />}

        <Secao titulo="Dados do documento">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="font-medium">Tipo</dt>
            <dd>{d.tipo_rotulo}</dd>
            {d.descricao && (
              <>
                <dt className="font-medium">Descrição</dt>
                <dd className="whitespace-pre-line">{d.descricao}</dd>
              </>
            )}
            <dt className="font-medium">Ano</dt>
            <dd>{d.ano ?? '—'}</dd>
            {d.vinculo_tipo && (
              <>
                <dt className="font-medium">Vinculado a</dt>
                <dd>
                  {d.vinculo_tipo} nº {d.vinculo_id}
                </dd>
              </>
            )}
            <dt className="font-medium">Cadastrado em</dt>
            <dd>{dataHora(d.criado_em)}</dd>
            <dt className="font-medium">No site</dt>
            <dd>
              {noSite
                ? d.situacao === 'Aprovado'
                  ? `Sim, desde ${dataHora(d.aprovado_em)}`
                  : 'Ainda não'
                : 'Não é para o site'}
            </dd>
          </dl>
        </Secao>

        <Secao titulo="Arquivo original (área privada)">
          {d.tem_original ? (
            <p className="text-sm">
              {d.original_nome_arquivo} — {formatarTamanho(d.original_tamanho)}
              <span className="block break-all text-xs text-muted-foreground">
                SHA-256: {d.original_sha256}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum arquivo original enviado.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {d.tem_original && d.pode_baixar_original && (
              <Button
                type="button"
                variant="outline"
                onClick={executar(() => baixarOriginal(d))}
              >
                <Download aria-hidden="true" /> Baixar o original
              </Button>
            )}
            {d.tem_original && !d.pode_baixar_original && (
              <p className="text-sm text-muted-foreground">
                Você não tem a permissão para baixar este original (pode ter
                dado pessoal).
              </p>
            )}
            {d.pode_editar && (
              <div className="flex items-end gap-2">
                <label className="text-sm">
                  <span className="mb-1 block">
                    {d.tem_original ? 'Trocar o arquivo' : 'Enviar o arquivo'}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) =>
                      setArquivoOriginal(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!arquivoOriginal || original.isPending}
                  onClick={executar(
                    () => original.mutateAsync(),
                    () => setArquivoOriginal(null),
                  )}
                >
                  <Upload aria-hidden="true" /> Enviar
                </Button>
              </div>
            )}
          </div>
        </Secao>

        {noSite && (
          <Secao titulo="Versão pública (a que pode ir ao site)">
            <p className="text-sm text-muted-foreground">
              Cópia do documento com os dados pessoais (CPF, RG, endereço,
              telefone e e-mail de pessoas) <strong>cobertos de verdade</strong>
              , em PDF com texto pesquisável. É conferida por máquina antes de
              ser aceita.
            </p>
            {d.tem_versao_publica ? (
              <p className="text-sm">
                Versão pública aceita — {formatarTamanho(d.publico_tamanho)},{' '}
                {d.publico_paginas} página(s).
                <span className="block break-all text-xs text-muted-foreground">
                  SHA-256: {d.publico_sha256}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma versão pública aceita ainda.
              </p>
            )}
            {d.verificacao && d.tem_versao_publica && (
              <ResultadoDaVerificacao resultado={d.verificacao} />
            )}
            <div className="flex flex-wrap items-end gap-3">
              {d.tem_versao_publica && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={executar(() => abrirVersaoPublica(d))}
                >
                  <Eye aria-hidden="true" /> Ver a versão pública
                </Button>
              )}
              {d.pode_editar &&
                d.classificacao === 'Pública' &&
                d.tem_original && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={executar(() =>
                      usarOriginalComoVersaoPublica(idDocumento),
                    )}
                  >
                    <FileCheck2 aria-hidden="true" /> Usar o original como
                    versão pública
                  </Button>
                )}
              {d.pode_editar && (
                <div className="flex items-end gap-2">
                  <label className="text-sm">
                    <span className="mb-1 block">
                      {d.tem_versao_publica
                        ? 'Trocar a versão pública (PDF)'
                        : 'Enviar a versão pública (PDF)'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={(e) =>
                        setArquivoPublico(e.target.files?.[0] ?? null)
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!arquivoPublico || publica.isPending}
                    onClick={executar(
                      () => publica.mutateAsync(),
                      () => setArquivoPublico(null),
                    )}
                  >
                    <Upload aria-hidden="true" /> Enviar e conferir
                  </Button>
                </div>
              )}
            </div>
          </Secao>
        )}

        <Secao titulo="Publicação">
          {d.motivo_recusa && d.situacao === 'Rascunho' && (
            <p className="text-sm text-destructive">
              Última recusa ({dataHora(d.recusado_em)}): {d.motivo_recusa}
            </p>
          )}
          {d.situacao === 'Retirado' && (
            <p className="text-sm">
              Retirado do site em {dataHora(d.retirado_em)}: {d.motivo_retirada}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {podePreparar &&
              noSite &&
              d.situacao === 'Rascunho' &&
              d.tem_versao_publica && (
                <Button
                  type="button"
                  onClick={executar(() => enviarParaRevisao(idDocumento))}
                >
                  Enviar para revisão
                </Button>
              )}
            {d.pode_aprovar && confirmacao === null && (
              <>
                <Button type="button" onClick={() => setConfirmacao('aprovar')}>
                  Aprovar a publicação
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmacao('recusar')}
                >
                  Recusar
                </Button>
              </>
            )}
            {d.pode_retirar && confirmacao === null && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmacao('retirar')}
              >
                Retirar do site
              </Button>
            )}
            {podePreparar && !noSite && !d.vigente && (
              <Button
                type="button"
                variant="outline"
                onClick={executar(() => tornarVigente(idDocumento))}
              >
                Tornar esta a versão vigente
              </Button>
            )}
            {podePreparar && (
              <Button
                type="button"
                variant="outline"
                onClick={executar(async () => {
                  const nova = await criarNovaVersao(idDocumento)
                  window.location.assign(`/documentos/${nova.id_documento}`)
                })}
              >
                Criar nova versão
              </Button>
            )}
          </div>

          {confirmacao === 'aprovar' && (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p>
                Ao aprovar, a <strong>versão pública</strong> passa a ser vista
                por qualquer pessoa no site de transparência (o arquivo é
                conferido de novo agora). Você leu a versão pública e confirma
                que ela não expõe dado pessoal?
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={executar(
                    () => aprovarDocumento(idDocumento),
                    () => setConfirmacao(null),
                  )}
                >
                  Confirmar aprovação
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmacao(null)}
                >
                  Voltar
                </Button>
              </div>
            </div>
          )}

          {(confirmacao === 'recusar' || confirmacao === 'retirar') && (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <label className="block">
                <span className="mb-1 block font-medium">
                  {confirmacao === 'recusar'
                    ? 'Por que a publicação foi recusada? (pelo menos 10 letras)'
                    : 'Por que sair do site? (pelo menos 10 letras)'}
                </span>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={
                    confirmacao === 'retirar' ? 'destructive' : 'default'
                  }
                  onClick={executar(
                    () =>
                      confirmacao === 'recusar'
                        ? recusarDocumento(idDocumento, motivo)
                        : retirarDocumento(idDocumento, motivo),
                    () => {
                      setConfirmacao(null)
                      setMotivo('')
                    },
                  )}
                >
                  {confirmacao === 'recusar'
                    ? 'Confirmar recusa'
                    : 'Confirmar retirada'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setConfirmacao(null)
                    setMotivo('')
                  }}
                >
                  Voltar
                </Button>
              </div>
            </div>
          )}
        </Secao>

        {versoes && versoes.length > 1 && (
          <Secao titulo="Versões deste documento">
            <ul className="space-y-1 text-sm">
              {versoes.map((v) => (
                <li key={v.id_documento}>
                  {v.id_documento === d.id_documento ? (
                    <strong>Versão {v.versao} (esta)</strong>
                  ) : (
                    <Link
                      to={`/documentos/${v.id_documento}`}
                      className="underline"
                    >
                      Versão {v.versao}
                    </Link>
                  )}{' '}
                  — {v.situacao}
                  {v.vigente ? ', vigente' : ''}
                </li>
              ))}
            </ul>
          </Secao>
        )}

        <Secao titulo="Histórico (quem fez o quê)">
          {!trilha || trilha.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem registros.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {trilha.map((e, i) => (
                <li key={`${e.acao}-${e.quando}-${i}`}>
                  <span className="text-muted-foreground">
                    {dataHora(e.quando)}
                  </span>{' '}
                  — <strong>{e.rotulo}</strong>
                  {e.quem ? ` por ${e.quem}` : ''}
                  {typeof e.detalhes.motivo === 'string'
                    ? `: ${e.detalhes.motivo}`
                    : ''}
                </li>
              ))}
            </ol>
          )}
        </Secao>
      </div>
    </>
  )
}
