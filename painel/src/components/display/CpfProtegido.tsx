import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { type OrigemDoCpf, revelarCpf } from '@/lib/cpf-protegido'

// v7.3a - o CPF escondido e, para quem pode, o botão "Mostrar o CPF" (cada clique fica na Auditoria). O completo vive só no estado deste componente:
// não vai para o cache das consultas, e some ao sair da tela.
export function CpfProtegido({
  origem,
  id,
  mascarado,
  podeRevelar,
}: {
  origem: OrigemDoCpf
  id: number
  mascarado: string | null | undefined
  podeRevelar: boolean
}) {
  const [completo, setCompleto] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  if (!mascarado) return <span>—</span>

  async function mostrar() {
    setCarregando(true)
    setErro(null)
    try {
      setCompleto((await revelarCpf(origem, id)).cpf)
    } catch (e) {
      setErro(mensagemDoErro(e, 'Não foi possível mostrar o CPF.'))
    } finally {
      setCarregando(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className="font-mono"
        data-cpf={completo ? 'completo' : 'escondido'}
      >
        {completo ?? mascarado}
      </span>
      {podeRevelar && !completo && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          onClick={mostrar}
          disabled={carregando}
        >
          Mostrar o CPF
        </Button>
      )}
      {erro && (
        <span role="alert" className="text-sm text-destructive">
          {erro}
        </span>
      )}
    </span>
  )
}
