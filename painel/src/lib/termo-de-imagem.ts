import { useQuery } from '@tanstack/react-query'

import { hojeParaCampoDeData } from '@/lib/atendimentos'
import {
  obterTermoDaTela,
  type OrigemDeConsentimento,
  type TermoDaTela,
} from '@/lib/consentimentos'

// v7.1b - o que a tela de envio de foto precisa do termo de imagem (o componente fica em components/privacidade/TermoDeImagem.tsx).
export type EscolhasDoTermo = { quem: string; meio: string; assinadoEm: string }

/** As escolhas em branco; a data da assinatura começa em hoje (pelo relógio de quem está na tela). */
export function escolhasEmBranco(): EscolhasDoTermo {
  return { quem: '', meio: '', assinadoEm: hojeParaCampoDeData() }
}

/** O termo em vigor para a tela (a versão volta no envio); só é pedido quando o formulário de envio pode aparecer. */
export function useTermoDaTela(origem: OrigemDeConsentimento, pedir = true) {
  return useQuery({
    queryKey: ['termo-da-tela', origem],
    queryFn: () => obterTermoDaTela(origem),
    staleTime: 60_000,
    enabled: pedir,
  })
}

/** O que falta para enviar (a mensagem para a pessoa), ou null. O servidor confere tudo de novo. */
export function faltaNoTermo(
  termo: TermoDaTela | undefined,
  escolhas: EscolhasDoTermo,
  documento: string,
  pedeQuem: boolean,
  falhouAoCarregar = false,
): string | null {
  if (!termo)
    return falhouAoCarregar
      ? 'Não foi possível carregar o termo de autorização: recarregue a página.'
      : 'O termo de autorização ainda está carregando: espere um pouco.'
  if (pedeQuem && escolhas.quem.trim().length < 3)
    return 'Diga quem autorizou (o nome de quem assinou o termo).'
  if (!escolhas.meio) return 'Diga como a autorização foi dada.'
  if (!escolhas.assinadoEm) return 'Informe a data em que o termo foi assinado.'
  if (escolhas.assinadoEm > hojeParaCampoDeData())
    return 'A data da assinatura do termo não pode ser depois de hoje.'
  if (escolhas.meio === 'termo_digitalizado' && !documento.trim())
    return 'Informe o número do documento do termo digitalizado.'
  return null
}
