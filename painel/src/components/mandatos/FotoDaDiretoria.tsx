import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import {
  apagarFotoDaDiretoria,
  apiFetchBlob,
  caminhoDaFotoDaDiretoria,
  enviarFotoDaDiretoria,
  obterFotoDaDiretoria,
  type FotoDaDiretoria as DadosDaFoto,
  type SituacaoDaFotoDaDiretoria,
} from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { useMe } from '@/lib/use-me'

const FRASE_SEM_AUTORIZACAO =
  'Sem a autorização de uso de imagem a foto não é aceita: marque a caixa só se a pessoa autorizou de verdade.'

// A foto fica em área privada: o navegador a busca com o token do usuário e mostra a miniatura por um endereço local.
function Miniatura({ caminho, foto }: { caminho: string; foto: DadosDaFoto }) {
  const [url, setUrl] = useState<string | null>(null)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    let cancelado = false
    let local: string | null = null
    apiFetchBlob(caminho)
      .then(({ blob }) => {
        if (cancelado) return
        local = URL.createObjectURL(blob)
        setUrl(local)
      })
      .catch(() => {
        if (!cancelado) setFalhou(true)
      })
    return () => {
      cancelado = true
      if (local) URL.revokeObjectURL(local)
    }
  }, [caminho])
  if (url) {
    return (
      <img
        src={url}
        alt={foto.alt}
        width={foto.largura}
        height={foto.altura}
        className="h-24 w-auto rounded-md border border-border object-cover"
      />
    )
  }
  return (
    <div
      role="img"
      aria-label={foto.alt}
      className="flex h-24 w-20 items-center justify-center rounded-md border border-border bg-muted p-1 text-center text-xs text-muted-foreground"
    >
      {falhou ? 'Miniatura indisponível' : null}
    </div>
  )
}

// v5.7c - "Foto no site" de quem tem mandato vigente: o site mostra nome, cargo e a foto de quem AUTORIZOU o uso da
// imagem. Só entra foto com a autorização marcada (sem ela o servidor recusa e este formulário nem envia); é uma foto por
// pessoa (enviar de novo troca); quem retira a autorização tem a foto apagada de verdade. O servidor regrava a imagem sem
// localização nem dados do aparelho e registra tudo na Auditoria.
export function FotoDaDiretoria({
  idAssociado,
  nome,
}: {
  idAssociado: number
  nome: string
}) {
  const queryClient = useQueryClient()
  const { data: me } = useMe()
  const pode = me?.permissoes.includes('governanca') ?? false
  const idCaixa = useId()
  const idExplicacao = useId()

  const chave = ['foto-da-diretoria', idAssociado]
  const {
    data: situacao,
    isLoading: carregando,
    isError: falhouAoCarregar,
    refetch,
  } = useQuery({
    queryKey: chave,
    queryFn: () => obterFotoDaDiretoria(idAssociado),
    enabled: pode,
  })

  const [formularioAberto, setFormularioAberto] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [autorizacao, setAutorizacao] = useState(false)
  const [documento, setDocumento] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // Trocar a chave recria o campo de arquivo: é a única forma de esvaziá-lo depois de enviar.
  const [chaveDoArquivo, setChaveDoArquivo] = useState(0)
  const [confirmandoApagar, setConfirmandoApagar] = useState(false)
  const [erroAoApagar, setErroAoApagar] = useState<string | null>(null)
  const [avisoAoApagar, setAvisoAoApagar] = useState<string | null>(null)

  function atualizar(nova: SituacaoDaFotoDaDiretoria) {
    queryClient.setQueryData(chave, nova)
    void queryClient.invalidateQueries({ queryKey: chave })
  }

  const enviar = useMutation({
    mutationFn: (dados: {
      arquivo: File
      autorizacaoImagem: boolean
      idDocumentoAutorizacao?: string
    }) => enviarFotoDaDiretoria(idAssociado, dados),
    onSuccess: (nova) => {
      atualizar(nova)
      setArquivo(null)
      setAutorizacao(false)
      setDocumento('')
      setChaveDoArquivo((n) => n + 1)
      setAvisoAoApagar(null)
      setAviso(
        nova.aparece_no_site
          ? 'Foto enviada. Ela aparece no site na próxima publicação (o site se atualiza algumas vezes ao dia: pode levar algumas horas).'
          : 'Foto enviada, mas ela não aparece no site: a pessoa não tem mandato vigente.',
      )
    },
    onError: (e) =>
      setErro(
        mensagemDoErro(e, 'Não foi possível enviar a foto. Tente de novo.'),
      ),
  })

  const apagar = useMutation({
    mutationFn: () => apagarFotoDaDiretoria(idAssociado),
    onSuccess: () => {
      atualizar({ foto: null, aparece_no_site: false })
      setConfirmandoApagar(false)
      setAviso(null)
      setAvisoAoApagar(
        'Foto apagada. Ela saiu do sistema na hora e some do site na próxima publicação (o site se atualiza algumas vezes ao dia: pode levar algumas horas).',
      )
    },
    onError: (e) => {
      // 404 (a foto já foi apagada em outra aba) e erro de rede: o diálogo não pode esconder o motivo, e a tela confere de novo.
      setConfirmandoApagar(false)
      setErroAoApagar(
        mensagemDoErro(e, 'Não foi possível apagar a foto. Tente de novo.'),
      )
      void queryClient.invalidateQueries({ queryKey: chave })
    },
  })

  function tentarEnviar() {
    setErro(null)
    setAviso(null)
    if (!arquivo) return setErro('Escolha a foto.')
    if (!autorizacao) return setErro(FRASE_SEM_AUTORIZACAO)
    enviar.mutate({
      arquivo,
      autorizacaoImagem: autorizacao,
      idDocumentoAutorizacao: documento.trim() || undefined,
    })
  }

  function fecharFormulario() {
    setFormularioAberto(false)
    setArquivo(null)
    setAutorizacao(false)
    setDocumento('')
    setErro(null)
    setAviso(null)
    setChaveDoArquivo((n) => n + 1)
  }

  // Ainda não se sabe quem é o usuário: nada a mostrar (evita piscar a frase de "sem permissão").
  if (!me) return null

  if (!pode) {
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Você não tem permissão para ver a foto de {nome} no site.
      </p>
    )
  }

  const foto = situacao?.foto ?? null

  return (
    <section
      aria-label={`Foto no site de ${nome}`}
      className="mt-3 space-y-2 rounded-md border border-border bg-muted/20 p-3"
    >
      <h3 className="text-sm font-semibold">Foto no site</h3>

      {carregando && (
        <p className="text-xs text-muted-foreground">Carregando a foto…</p>
      )}

      {falhouAoCarregar && (
        <div className="space-y-1">
          <p role="alert" className="text-sm text-destructive">
            Não foi possível ver a foto de {nome}. Tente de novo.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      )}

      {situacao && (
        <>
          <div className="flex flex-wrap items-start gap-3">
            {foto ? (
              <>
                <Miniatura
                  key={foto.criado_em}
                  caminho={caminhoDaFotoDaDiretoria(
                    idAssociado,
                    foto.criado_em,
                  )}
                  foto={foto}
                />
                <p
                  className={
                    situacao.aparece_no_site
                      ? 'text-sm font-medium text-green-700 dark:text-green-400'
                      : 'max-w-xs text-sm text-amber-800 dark:text-amber-400'
                  }
                >
                  {situacao.aparece_no_site
                    ? 'Aparece no site'
                    : 'Cadastrada, mas não aparece no site (a pessoa não tem mandato vigente)'}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Sem foto: o site mostra só o nome e o cargo
              </p>
            )}
          </div>

          {!formularioAberto && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setAvisoAoApagar(null)
                  setErroAoApagar(null)
                  setFormularioAberto(true)
                }}
              >
                {foto ? 'Trocar foto' : 'Enviar foto'}{' '}
                <span className="sr-only">de {nome}</span>
              </Button>
              {foto && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setErroAoApagar(null)
                    setAvisoAoApagar(null)
                    setConfirmandoApagar(true)
                  }}
                >
                  Apagar a foto (retirou a autorização){' '}
                  <span className="sr-only">de {nome}</span>
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {formularioAberto && (
        <form
          aria-label={`Formulário da foto no site de ${nome}`}
          noValidate
          className="space-y-2 rounded-md border border-border bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault()
            tentarEnviar()
          }}
        >
          <Campo rotulo="Foto (JPG, PNG ou WEBP, até 10 MB)">
            <input
              key={chaveDoArquivo}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null)
                setErro(null)
              }}
            />
          </Campo>
          <div className="flex items-start gap-2 text-sm">
            <input
              id={idCaixa}
              type="checkbox"
              className="mt-1"
              aria-describedby={idExplicacao}
              checked={autorizacao}
              onChange={(e) => {
                setAutorizacao(e.target.checked)
                setErro(null)
              }}
            />
            <div>
              <label htmlFor={idCaixa} className="font-medium">
                Esta pessoa autorizou o uso da imagem dela no site da ASAF
              </label>
              <p
                id={idExplicacao}
                className="mt-1 text-xs text-muted-foreground"
              >
                A foto fica pública na página Diretoria. Se ela retirar a
                autorização, use “Apagar a foto”: some do sistema na hora e do
                site na próxima publicação.
              </p>
            </div>
          </div>
          <Campo
            rotulo="Número do termo de autorização (documento do sistema)"
            dica="Opcional. Se o termo assinado está na biblioteca de Documentos, informe o número dele."
          >
            <input
              className={classeCampo}
              inputMode="numeric"
              value={documento}
              onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))}
            />
          </Campo>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={enviar.isPending}>
              {enviar.isPending ? 'Enviando…' : 'Enviar a foto'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={enviar.isPending}
              onClick={fecharFormulario}
            >
              {aviso ? 'Fechar' : 'Cancelar'}
            </Button>
          </div>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          {aviso && (
            <p role="status" className="text-sm text-muted-foreground">
              {aviso}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A foto é guardada sem localização nem dados do aparelho, e cada
            pessoa tem uma só: enviar de novo troca a anterior. Quando o mandato
            termina, a foto é apagada sozinha.
          </p>
        </form>
      )}

      {erroAoApagar && (
        <p role="alert" className="text-sm text-destructive">
          {erroAoApagar}
        </p>
      )}
      {avisoAoApagar && (
        <p role="status" className="text-sm text-muted-foreground">
          {avisoAoApagar}
        </p>
      )}

      <ConfirmDialog
        aberto={confirmandoApagar}
        onAbertoChange={(aberto) => {
          if (!aberto) setConfirmandoApagar(false)
        }}
        titulo={`Apagar a foto de ${nome}?`}
        descricao="Use quando a pessoa retirar a autorização de uso da imagem. A foto some do sistema na hora, e do site na próxima publicação (o site se atualiza algumas vezes ao dia: pode levar algumas horas). Não dá para desfazer: para voltar, é preciso enviar a foto de novo. Fica registrado na Auditoria."
        rotuloConfirmar="Apagar a foto"
        carregando={apagar.isPending}
        onConfirmar={() => apagar.mutate()}
      />
    </section>
  )
}
