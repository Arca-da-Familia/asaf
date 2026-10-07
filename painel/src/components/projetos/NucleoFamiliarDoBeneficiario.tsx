import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  listarNucleoFamiliar,
  listarOpcoesCatalogo,
  type Beneficiario,
} from '@/lib/api'

// Núcleo familiar do beneficiário: os vínculos de parentesco que a pessoa tem (como titular da família ou como dependente), com nomes e o grau.
// É leitura: os vínculos se cadastram na ficha de quem é associado (aba Vínculos), e aqui aparecem para quem cuida do projeto.
export function NucleoFamiliarDoBeneficiario({
  beneficiario,
  onFechar,
}: {
  beneficiario: Beneficiario
  onFechar: () => void
}) {
  const { data: vinculos, isLoading } = useQuery({
    queryKey: ['nucleo-familiar', beneficiario.id_beneficiario],
    queryFn: () => listarNucleoFamiliar(beneficiario.id_beneficiario),
  })
  const { data: graus } = useQuery({
    queryKey: ['catalogo-opcoes', 'grau_parentesco'],
    queryFn: () => listarOpcoesCatalogo('grau_parentesco'),
  })
  const rotuloDoGrau = (codigo: string | null) =>
    (graus ?? []).find((g) => g.codigo === codigo)?.rotulo ??
    codigo ??
    'parentesco não informado'
  const nome = beneficiario.nome_completo ?? `Pessoa #${beneficiario.id_pessoa}`

  return (
    <section
      aria-label={`Núcleo familiar de ${nome}`}
      className="mb-4 rounded-md border border-border p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Núcleo familiar de {nome}</h3>
        <Button variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      </div>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      <ul className="space-y-1 text-sm">
        {(vinculos ?? []).map((v) => (
          <li key={v.id_dependente}>
            {v.beneficiario_e === 'titular'
              ? `${v.nome_vinculada} é ${rotuloDoGrau(v.grau_parentesco)} de ${nome}`
              : `${nome} é ${rotuloDoGrau(v.grau_parentesco)} de ${v.nome_titular}`}
          </li>
        ))}
      </ul>
      {vinculos && vinculos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum vínculo familiar cadastrado para esta pessoa. Os vínculos se
          cadastram na ficha de quem é associado, na aba Vínculos.
        </p>
      )}
    </section>
  )
}
