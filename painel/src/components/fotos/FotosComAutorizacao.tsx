import { useEffect, useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import {
  ConsentimentoDaFoto,
  TermoDeImagem,
} from '@/components/privacidade/TermoDeImagem'
import {
  escolhasEmBranco,
  faltaNoTermo,
  useTermoDaTela,
} from '@/lib/termo-de-imagem'
import { Button } from '@/components/ui/button'
import { apiFetchBlob } from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import type {
  ComoApagar,
  DadosDoConsentimento,
  OrigemDeConsentimento,
  ResumoDoConsentimento,
} from '@/lib/consentimentos'
import { mensagemDoErro } from '@/lib/erro-da-api'

export type FotoDaLista = {
  id_foto: number
  alt: string
  largura: number
  altura: number
  // v7.1b: o consentimento registrado da foto (quem, o termo e a versão, como)
  consentimento?: ResumoDoConsentimento | null
}

export type DadosDaFoto = {
  arquivo: File
  alt: string
  autorizacaoImagem: boolean
  idDocumentoAutorizacao?: string
  consentimento: DadosDoConsentimento
}

// A foto fica em área privada: o navegador a busca com o token do usuário e mostra a miniatura por um endereço local.
function Miniatura({ caminho, foto }: { caminho: string; foto: FotoDaLista }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelado = false
    let local: string | null = null
    apiFetchBlob(caminho)
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
  }, [caminho])
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

// Fotos com AUTORIZAÇÃO DE IMAGEM (etapa de parceria, evento...). Só entra foto com a autorização confirmada e com a
// descrição (para quem não enxerga): sem as duas coisas o servidor recusa e este formulário nem envia. O servidor também
// regrava a imagem, tirando localização e dados do aparelho. Quem usa só diz de onde vêm as fotos e o que fazer ao enviar
// e ao apagar: `onEnviar` devolve `true` quando deu certo (para o formulário limpar); erro lançado vira mensagem aqui
// (quem já mostra o erro por conta própria, como o `executar` das parcerias, só devolve `false`).
export function FotosComAutorizacao({
  origem,
  titulo,
  fotos,
  urlDoArquivo,
  podeEditar,
  onEnviar,
  onApagar,
  textoSemFotos = 'Nenhuma foto.',
  className = '',
}: {
  origem: OrigemDeConsentimento
  titulo?: string
  fotos: FotoDaLista[]
  urlDoArquivo: (idFoto: number) => string
  podeEditar: boolean
  onEnviar: (dados: DadosDaFoto) => Promise<boolean>
  onApagar: (idFoto: number, como: ComoApagar) => Promise<unknown>
  textoSemFotos?: string
  className?: string
}) {
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [alt, setAlt] = useState('')
  const [autorizacao, setAutorizacao] = useState(false)
  const [documento, setDocumento] = useState('')
  const [escolhas, setEscolhas] = useState(escolhasEmBranco)
  const { data: termo, isError: termoFalhou } = useTermoDaTela(
    origem,
    podeEditar,
  )
  // apagar pergunta por quê: a pessoa retirou a autorização (o consentimento fica revogado) ou outro motivo
  const [apagando, setApagando] = useState<number | null>(null)
  // sem escolha marcada: apagar uma foto errada não pode virar "revogado" por descuido
  const [revogado, setRevogado] = useState<boolean | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Trocar a chave recria o campo de arquivo: é a única forma de esvaziá-lo depois de enviar.
  const [chaveDoArquivo, setChaveDoArquivo] = useState(0)

  async function enviar() {
    setErro(null)
    setAviso(null)
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
    const falta = faltaNoTermo(termo, escolhas, documento, true, termoFalhou)
    if (falta || !termo) return setErro(falta)
    setEnviando(true)
    try {
      const resultado = await onEnviar({
        arquivo,
        alt: alt.trim(),
        autorizacaoImagem: autorizacao,
        idDocumentoAutorizacao: documento.trim() || undefined,
        consentimento: {
          quemAutorizou: escolhas.quem.trim(),
          meio: escolhas.meio,
          versaoDoTermo: termo.versao,
          assinadoEm: escolhas.assinadoEm,
        },
      })
      if (resultado) {
        setArquivo(null)
        setAlt('')
        setAutorizacao(false)
        setDocumento('')
        setEscolhas(escolhasEmBranco())
        setChaveDoArquivo((n) => n + 1)
        setAviso('Foto enviada.')
      }
    } catch (e) {
      setErro(
        mensagemDoErro(e, 'Não foi possível enviar a foto. Tente de novo.'),
      )
    } finally {
      setEnviando(false)
    }
  }

  async function apagar(idFoto: number) {
    setErro(null)
    setAviso(null)
    if (revogado === null)
      return setErro(
        'Diga por que a foto sai: a pessoa retirou a autorização, ou outro motivo.',
      )
    try {
      await onApagar(idFoto, { revogado, motivo })
      setApagando(null)
      setMotivo('')
      setAviso(
        revogado
          ? 'Foto apagada e consentimento revogado (fica registrado em Privacidade > Consentimentos).'
          : 'Foto apagada.',
      )
    } catch (e) {
      setErro(
        mensagemDoErro(e, 'Não foi possível apagar a foto. Tente de novo.'),
      )
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {titulo && <p className="text-sm font-medium">{titulo}</p>}
      {fotos.length === 0 ? (
        <p className="text-xs text-muted-foreground">{textoSemFotos}</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {fotos.map((f) => (
            <li key={f.id_foto} className="space-y-1">
              <Miniatura caminho={urlDoArquivo(f.id_foto)} foto={f} />
              <p className="max-w-40 text-xs text-muted-foreground">{f.alt}</p>
              <ConsentimentoDaFoto c={f.consentimento} />
              {podeEditar && apagando !== f.id_foto && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Apagar a foto: ${f.alt}`}
                  onClick={() => {
                    setApagando(f.id_foto)
                    setRevogado(null)
                    setMotivo('')
                  }}
                >
                  Apagar
                </Button>
              )}
              {podeEditar && apagando === f.id_foto && (
                <fieldset className="max-w-56 space-y-1 rounded-md border border-border p-2 text-xs">
                  <legend className="font-medium">Por que a foto sai?</legend>
                  <label className="flex items-start gap-1">
                    <input
                      type="radio"
                      name={`por-que-${f.id_foto}`}
                      // o foco vai para a pergunta assim que ela abre
                      autoFocus
                      checked={revogado === true}
                      onChange={() => setRevogado(true)}
                    />
                    A pessoa retirou a autorização
                  </label>
                  <label className="flex items-start gap-1">
                    <input
                      type="radio"
                      name={`por-que-${f.id_foto}`}
                      checked={revogado === false}
                      onChange={() => setRevogado(false)}
                    />
                    Outro motivo (foto errada, repetida)
                  </label>
                  <input
                    className={classeCampo}
                    aria-label="Motivo (opcional)"
                    placeholder="Motivo (opcional)"
                    maxLength={500}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                  />
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      aria-label={`Confirmar: apagar a foto ${f.alt}`}
                      onClick={() => void apagar(f.id_foto)}
                    >
                      Apagar a foto
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setApagando(null)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Enviar foto (JPG, PNG ou WEBP, até 10 MB)
            </span>
            <input
              key={chaveDoArquivo}
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
          <TermoDeImagem
            origem={origem}
            escolhas={escolhas}
            aoMudar={setEscolhas}
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={autorizacao}
              onChange={(e) => setAutorizacao(e.target.checked)}
            />
            <span>
              <strong>
                Todas as pessoas que aparecem na foto assinaram o termo
              </strong>{' '}
              (os responsáveis, no caso de criança ou adolescente). Marque
              somente se é verdade.
            </span>
          </label>
          <Campo
            rotulo="Nº do documento do termo digitalizado"
            dica="Obrigatório se o termo foi digitalizado na biblioteca de Documentos."
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
            disabled={enviando}
            onClick={() => void enviar()}
          >
            Enviar a foto
          </Button>
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
            A foto é guardada sem localização nem dados do aparelho. Se alguém
            retirar a autorização, apague TODAS as fotos em que a pessoa aparece
            (procure o nome dela em Privacidade &gt; Consentimentos) e marque “A
            pessoa retirou a autorização”: elas saem do sistema na hora e do
            site na próxima publicação (o site se atualiza algumas vezes ao dia:
            pode levar algumas horas), e cada consentimento fica registrado como
            revogado. O armazenamento ainda guarda uma cópia de segurança por 30
            dias.
          </p>
        </div>
      )}
    </div>
  )
}
