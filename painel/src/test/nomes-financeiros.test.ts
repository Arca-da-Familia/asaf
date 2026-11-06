import { describe, expect, it } from 'vitest'

import { nomeDaOrigem, nomeDoAlerta } from '@/lib/nomes-financeiros'

// v9.3h (pedido do Presidente, 06/11): o razão e a conferência antifraude mostram o nome em português, nunca o código.
describe('nomes do financeiro em português', () => {
  it('a origem do lançamento', () => {
    expect(nomeDaOrigem('BAIXA_TITULO')).toBe('Pagamento de título')
    expect(nomeDaOrigem('TRANSFERENCIA')).toBe('Transferência entre contas')
    expect(nomeDaOrigem(null)).toBe('')
  })

  it('o tipo de alerta', () => {
    expect(nomeDoAlerta('FORNECEDOR_NOVO_PAGAMENTO_ALTO')).toBe(
      'Pagamento alto a fornecedor novo',
    )
  })

  it('código sem nome ainda aparece sem o sublinhado', () => {
    expect(nomeDaOrigem('ORIGEM_NOVA')).toBe('Origem nova')
    expect(nomeDoAlerta('ALERTA_NOVO')).toBe('Alerta novo')
  })
})
