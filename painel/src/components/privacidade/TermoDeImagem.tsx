import { useId, useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import {
  abrirPdfDoTermo,
  type OrigemDeConsentimento,
  type ResumoDoConsentimento,
} from '@/lib/consentimentos'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { useTermoDaTela, type EscolhasDoTermo } from '@/lib/termo-de-imagem'

// v7.1b - o termo de autorização de uso de imagem que a pessoa assina: a versão em vigor, o texto, o PDF para imprimir e assinar, quem autorizou e como. O
// consentimento fica registrado com a versão (Privacidade > Consentimentos); revogar é apagar a foto.
export function TermoDeImagem({
  origem,
  escolhas,
  aoMudar,
  pedeQuem = true,
}: {
  origem: OrigemDeConsentimento
  escolhas: EscolhasDoTermo
  aoMudar: (e: EscolhasDoTermo) => void
  pedeQuem?: boolean
}) {
  const { data: termo, isError, error } = useTermoDaTela(origem)
  const [erroDoPdf, setErroDoPdf] = useState<string | null>(null)
  const idMeio = useId()
  const idData = useId()
  if (isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {mensagemDoErro(error, 'Não foi possível carregar o termo.')}
      </p>
    )
  if (!termo)
    return <p className="text-xs text-muted-foreground">Carregando o termo…</p>
  return (
    <div
      className="space-y-2 rounded-md border border-dashed border-border p-3"
      data-termo={termo.termo}
    >
      <p className="text-sm font-medium">
        {termo.nome} (versão {termo.versao})
      </p>
      <details>
        <summary className="cursor-pointer text-xs">Ler o termo</summary>
        <p className="mt-1 whitespace-pre-line text-xs">{termo.texto}</p>
      </details>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setErroDoPdf(null)
          abrirPdfDoTermo(termo.termo).catch((e) =>
            setErroDoPdf(mensagemDoErro(e, 'Não foi possível abrir o termo.')),
          )
        }}
      >
        Baixar o termo para assinar (PDF)
      </Button>
      {erroDoPdf && (
        <p role="alert" className="text-sm text-destructive">
          {erroDoPdf}
        </p>
      )}
      {pedeQuem && (
        <Campo
          rotulo="Quem autorizou (quem assinou o termo)"
          dica="O nome de quem assinou; numa foto de grupo, por exemplo: “Os responsáveis das 12 crianças da oficina (termos na secretaria)”."
        >
          <input
            className={classeCampo}
            maxLength={300}
            value={escolhas.quem}
            onChange={(e) => aoMudar({ ...escolhas, quem: e.target.value })}
          />
        </Campo>
      )}
      <div>
        <label htmlFor={idMeio} className="mb-1 block text-sm font-medium">
          Como a autorização foi dada
        </label>
        <select
          id={idMeio}
          className={classeCampo}
          value={escolhas.meio}
          onChange={(e) => aoMudar({ ...escolhas, meio: e.target.value })}
        >
          <option value="">Escolha…</option>
          {termo.meios.map((m) => (
            <option key={m.codigo} value={m.codigo}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={idData} className="mb-1 block text-sm font-medium">
          Data em que o termo foi assinado
        </label>
        <input
          id={idData}
          type="date"
          className={classeCampo}
          value={escolhas.assinadoEm}
          onChange={(e) => aoMudar({ ...escolhas, assinadoEm: e.target.value })}
        />
      </div>
    </div>
  )
}

/** O consentimento de uma foto, em uma linha (quem, o termo e a versão, como, quando). */
export function ConsentimentoDaFoto({
  c,
}: {
  c: ResumoDoConsentimento | null | undefined
}) {
  if (!c)
    return (
      <p className="max-w-56 text-xs text-destructive">
        Sem consentimento registrado.
      </p>
    )
  return (
    <p className="max-w-56 text-xs text-muted-foreground" data-consentimento>
      {c.titular ? `Autorizado por ${c.titular}` : 'Autorizado'} · termo versão{' '}
      {c.versao}
      {c.versao !== c.versao_atual_do_termo && ' (anterior ao termo de hoje)'}
      {' · '}
      {c.meio_rotulo} · {formatarData(c.dado_em)}
    </p>
  )
}
