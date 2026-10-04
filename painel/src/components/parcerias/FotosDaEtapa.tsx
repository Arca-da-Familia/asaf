import { FotosComAutorizacao } from '@/components/fotos/FotosComAutorizacao'
import {
  apagarFoto,
  enviarFoto,
  type Etapa,
  type Executar,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

// Fotos de uma etapa. Só entra foto com a AUTORIZAÇÃO DE IMAGEM confirmada e com a descrição (para quem não enxerga):
// sem as duas coisas o servidor recusa. O servidor também regrava a imagem, tirando localização e dados do aparelho.
// As regras e a tela são do componente genérico `FotosComAutorizacao` (o evento usa o mesmo).
export function FotosDaEtapa({
  d,
  etapa,
  executar,
}: {
  d: ParceriaDetalhe
  etapa: Etapa
  executar: Executar
}) {
  return (
    <FotosComAutorizacao
      className="mt-3 border-t border-border pt-3"
      titulo="Fotos da etapa"
      fotos={etapa.fotos}
      urlDoArquivo={(idFoto) =>
        `/api/parcerias/${d.id_parceria}/fotos/${idFoto}/arquivo`
      }
      podeEditar={d.pode_editar}
      onEnviar={(dados) =>
        executar(() => enviarFoto(d.id_parceria, etapa.id_etapa, dados))
      }
      onApagar={(idFoto) => executar(() => apagarFoto(d.id_parceria, idFoto))}
    />
  )
}
