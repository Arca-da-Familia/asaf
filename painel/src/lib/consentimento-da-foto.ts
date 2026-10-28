// v7.1b - o consentimento de uma foto: os tipos e o que vai no formulário e no endereço de apagar (sem depender da API: o api.ts e o
// parcerias.ts usam isto, e lib/consentimentos.ts tem as chamadas).
export type OrigemDeConsentimento =
  | 'foto_da_diretoria'
  | 'foto_de_evento'
  | 'foto_de_etapa_de_parceria'
  | 'beneficiario'

export type ResumoDoConsentimento = {
  id_consentimento: number
  termo: string
  versao: string
  titular: string
  dado_por: string | null
  // v7.1c: quem consentiu pela criança ou pelo adolescente
  nome_responsavel: string | null
  vinculo_responsavel: string | null
  vinculo_rotulo: string | null
  meio: string
  meio_rotulo: string
  id_documento: number | null
  dado_em: string
  origem: OrigemDeConsentimento
  origem_rotulo: string
  id_origem: number
  encerrado_em: string | null
  encerramento:
    | 'revogado'
    | 'apagado'
    | 'fim do prazo'
    | 'substituido'
    | 'invalidado'
    | null
  encerramento_rotulo: string | null
  motivo_encerramento: string | null
  versao_atual_do_termo: string
}

/** O que a tela de envio manda junto da foto (o servidor confere que a versão é a em vigor). */
export type DadosDoConsentimento = {
  quemAutorizou: string
  meio: string
  versaoDoTermo: string
  // a data em que o termo foi assinado (aaaa-mm-dd): é ela que vale como prova, não a do envio da foto
  assinadoEm: string
}

export function anexarConsentimento(form: FormData, d: DadosDoConsentimento) {
  form.append('quem_autorizou', d.quemAutorizou)
  form.append('meio', d.meio)
  form.append('versao_do_termo', d.versaoDoTermo)
  form.append('assinado_em', d.assinadoEm)
}

/** Por que a foto sai: a pessoa retirou a autorização (revogado), ou outro motivo (foto errada, repetida). */
export type ComoApagar = { revogado: boolean; motivo: string }

/** O corpo do DELETE da foto: o motivo vai no corpo, nunca no endereço (o endereço fica no registro de acesso do servidor). */
export function corpoDeApagar(como?: ComoApagar): string | undefined {
  if (!como) return undefined
  return JSON.stringify({
    revogado: como.revogado,
    motivo: como.motivo.trim() || null,
  })
}
