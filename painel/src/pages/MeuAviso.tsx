import { useParams } from 'react-router'

import { LeituraDoAviso } from '@/components/comunicacao/LeituraDoAviso'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAvisoAberto } from '@/lib/use-aviso-aberto'

// v6.1 - um aviso recebido, na própria página (é para onde levam o sino, o mural e os links). Abrir registra a leitura (no servidor, só da primeira vez).
// v9.5b - o conteúdo (texto, "Li e estou ciente") é o mesmo da leitura ao lado da lista em "Meus avisos" (LeituraDoAviso).
export function MeuAvisoPage() {
  const { id } = useParams()
  const idAviso = Number(id)
  const { data: aviso, isLoading, isError } = useAvisoAberto(idAviso)

  const trilha = [
    { rotulo: 'Meus avisos', href: '/meus-avisos' },
    { rotulo: 'Aviso' },
  ]

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError || !aviso)
    return (
      <>
        <PageHeader titulo="Aviso" trilha={trilha} />
        <p role="alert" className="text-sm text-destructive">
          Aviso não encontrado.
        </p>
      </>
    )

  return (
    <>
      <PageHeader titulo={aviso.titulo} trilha={trilha} />
      <LeituraDoAviso aviso={aviso} idAviso={idAviso} />
    </>
  )
}
