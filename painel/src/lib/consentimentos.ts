import { apiFetch, apiFetchBlob } from '@/lib/api'
import type {
  OrigemDeConsentimento,
  ResumoDoConsentimento,
} from '@/lib/consentimento-da-foto'
import { entregar } from '@/lib/privacidade'

// v7.1b - o REGISTRO dos consentimentos (a prova do termo de imagem que a pessoa assinou). Quem envia a foto diz quem autorizou e como; apagar a foto encerra o
// consentimento (revogado, quando a pessoa retirou a autorização, com o motivo).
export type TermoDaTela = {
  termo: string
  versao: string
  nome: string
  texto: string
  meios: { codigo: string; rotulo: string }[]
}

export const obterTermoDaTela = (origem: OrigemDeConsentimento) =>
  apiFetch<TermoDaTela>(`/api/consentimentos/termo-da-tela/${origem}`)

export async function abrirPdfDoTermo(termo: string) {
  const { blob } = await apiFetchBlob(`/api/consentimentos/termos/${termo}/pdf`)
  entregar(blob, `termo-${termo.toLowerCase()}.pdf`, 'abrir')
}

export type ListaDeConsentimentos = {
  consentimentos: ResumoDoConsentimento[]
  origens: Record<string, string>
  total: number
  pagina: number
  por_pagina: number
}

export const obterConsentimentos = (
  situacao: 'vigentes' | 'encerrados' | '',
  origem: OrigemDeConsentimento | '',
  busca = '',
  pagina = 1,
) => {
  const consulta = new URLSearchParams()
  if (situacao) consulta.set('situacao', situacao)
  if (origem) consulta.set('origem', origem)
  if (busca.trim()) consulta.set('busca', busca.trim())
  if (pagina > 1) consulta.set('pagina', String(pagina))
  const q = consulta.toString()
  return apiFetch<ListaDeConsentimentos>(
    `/api/privacidade/consentimentos${q ? `?${q}` : ''}`,
  )
}

export * from '@/lib/consentimento-da-foto'
