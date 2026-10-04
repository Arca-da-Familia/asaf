import { useEffect, useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import { apiFetchBlob } from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import {
  apagarFoto,
  enviarFoto,
  type Etapa,
  type Executar,
  type FotoDaEtapa,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

// A foto fica em área privada: o navegador a busca com o token do usuário e mostra a miniatura por um endereço local.
function Miniatura({
  idParceria,
  foto,
}: {
  idParceria: number
  foto: FotoDaEtapa
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelado = false
    let local: string | null = null
    apiFetchBlob(`/api/parcerias/${idParceria}/fotos/${foto.id_foto}/arquivo`)
      .then(({ blob }) => {
        if (cancelado) return
        local = URL.createObjectURL(blob)
        setUrl(local)
      })
      .catch(() => setUrl(null))
    return () => {
      cancelado = true
      if (local) URL.revokeObjectURL(local)
    }
  }, [idParceria, foto.id_foto])
  return url ? (
    <img
      src={url}
      alt={foto.alt}
      width={foto.largura}
      height={foto.altura}
      className="h-24 w-auto rounded-md border border-border object-cover"
    />
  ) : (
    <div
      role="img"
      aria-label={foto.alt}
      className="h-24 w-32 rounded-md border border-border bg-muted"
    />
  )
}

// Fotos de uma etapa. Só entra foto com a AUTORIZAÇÃO DE IMAGEM confirmada e com a descrição (para quem não enxerga):
// sem as duas coisas o servidor recusa. O servidor também regrava a imagem, tirando localização e dados do aparelho.
export function FotosDaEtapa({
  d,
  etapa,
  executar,
}: {
  d: ParceriaDetalhe
  etapa: Etapa
  executar: Executar
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [alt, setAlt] = useState('')
  const [autorizacao, setAutorizacao] = useState(false)
  const [documento, setDocumento] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  async function enviar() {
    setErro(null)
    if (!arquivo) return setErro('Escolha a foto.')
    if (!autorizacao) {
      return setErro(
        'Confirme a autorização de uso de imagem: sem ela a foto não é aceita.',
      )
    }
    if (alt.trim().length < 10) {
      return setErro(
        'Descreva a foto para quem não enxerga (pelo menos 10 letras).',
      )
    }
    const ok = await executar(() =>
      enviarFoto(d.id_parceria, etapa.id_etapa, {
        arquivo,
        alt: alt.trim(),
        autorizacaoImagem: autorizacao,
        idDocumentoAutorizacao: documento.trim() || undefined,
      }),
    )
    if (ok) {
      setArquivo(null)
      setAlt('')
      setAutorizacao(false)
      setDocumento('')
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <p className="text-sm font-medium">Fotos da etapa</p>
      {etapa.fotos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma foto.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {etapa.fotos.map((f) => (
            <li key={f.id_foto} className="space-y-1">
              <Miniatura idParceria={d.id_parceria} foto={f} />
              <p className="max-w-40 text-xs text-muted-foreground">{f.alt}</p>
              {d.pode_editar && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void executar(() => apagarFoto(d.id_parceria, f.id_foto))
                  }
                >
                  Apagar<span className="sr-only"> a foto: {f.alt}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {d.pode_editar && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Enviar foto (JPG, PNG ou WEBP, até 10 MB)
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            />
          </label>
          <Campo
            rotulo="Descrição da foto (para quem não enxerga)"
            dica="Ex.: Crianças tocando tambores na quadra da escola. Não escreva nomes de pessoas."
          >
            <input
              className={classeCampo}
              value={alt}
              maxLength={300}
              onChange={(e) => setAlt(e.target.value)}
            />
          </Campo>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={autorizacao}
              onChange={(e) => setAutorizacao(e.target.checked)}
            />
            <span>
              <strong>Há autorização de uso de imagem</strong> de todas as
              pessoas que aparecem na foto (dos responsáveis, no caso de criança
              ou adolescente). Marque somente se existe de verdade.
            </span>
          </label>
          <Campo
            rotulo="Nº do documento do termo de autorização (opcional)"
            dica="Se o termo assinado está na biblioteca de Documentos, informe o número dele."
          >
            <input
              className={classeCampo}
              inputMode="numeric"
              value={documento}
              onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))}
            />
          </Campo>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void enviar()}
          >
            Enviar a foto
          </Button>
          {erro && (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            A foto é guardada sem localização nem dados do aparelho. Se alguém
            retirar a autorização, apague a foto: ela sai do site e do
            armazenamento.
          </p>
        </div>
      )}
    </div>
  )
}
