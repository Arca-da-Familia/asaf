import { apiFetch } from './api'

// v7.3a - o CPF fica escondido (`***.***.***-NN`) em toda lista e ficha; o completo vem só por um clique em "Mostrar o CPF", que o servidor registra
// na Auditoria (app/services/cpf_protegido.py). Quem pode: a permissão `ver_cpf_completo` (Presidente, Secretários e Tesoureiros) e quem atende a
// solicitação de titular aberta (só o CPF daquele pedido).
export type OrigemDoCpf =
  'associado' | 'proposta' | 'doacao' | 'intencao' | 'atendimento'

export const PERMISSAO_VER_CPF_COMPLETO = 'ver_cpf_completo'

export function revelarCpf(
  origem: OrigemDoCpf,
  id: number,
): Promise<{ cpf: string }> {
  return apiFetch('/api/cpf/revelar', {
    method: 'POST',
    body: JSON.stringify({ origem, id }),
  })
}
