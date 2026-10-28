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

// v7.1c - o consentimento do atendimento social de um beneficiário (o termo assinado; registrar de novo substitui o vigente)
export type ConsentimentoDoBeneficiarioEnviado = {
  dado_por: '' | 'titular' | 'responsavel'
  nome_responsavel: string | null
  vinculo: string | null
  meio: string
  id_documento: number | null
  assinado_em: string
  versao_do_termo: string
}

export const registrarConsentimentoDoBeneficiario = (
  idBeneficiario: number,
  dados: ConsentimentoDoBeneficiarioEnviado,
) =>
  apiFetch<ResumoDoConsentimento>(
    `/api/beneficiarios/${idBeneficiario}/consentimento`,
    { method: 'POST', body: JSON.stringify(dados) },
  )

export const revogarConsentimentoDoBeneficiario = (
  idBeneficiario: number,
  motivo: string,
) =>
  apiFetch<ResumoDoConsentimento>(
    `/api/beneficiarios/${idBeneficiario}/consentimento/revogar`,
    { method: 'POST', body: JSON.stringify({ motivo: motivo.trim() || null }) },
  )

/** Menor de 18 anos hoje (pelo relógio de quem está na tela); sem data de nascimento, não se sabe. */
export function menorDeIdade(
  nascimento: string | null,
  hoje: Date = new Date(),
): boolean {
  if (!nascimento) return false
  const [ano, mes, dia] = nascimento.slice(0, 10).split('-').map(Number)
  if (!ano || !mes || !dia) return false
  let idade = hoje.getFullYear() - ano
  if (
    hoje.getMonth() + 1 < mes ||
    (hoje.getMonth() + 1 === mes && hoje.getDate() < dia)
  )
    idade -= 1
  return idade < 18
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
