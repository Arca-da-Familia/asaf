import { describe, expect, it } from 'vitest'

import { aplicarMapeamento, sugerirMapeamento } from '@/lib/importacao'

describe('sugerirMapeamento', () => {
  it('reconhece cabeçalhos óbvios, com e sem acento/maiúsculas', () => {
    const mapeamento = sugerirMapeamento([
      'Nome Completo',
      'CPF',
      'E-mail',
      'Data de Nascimento',
    ])
    expect(mapeamento.nome_completo).toBe('Nome Completo')
    expect(mapeamento.cpf).toBe('CPF')
    expect(mapeamento.email_contato).toBe('E-mail')
    expect(mapeamento.data_nascimento).toBe('Data de Nascimento')
  })

  it('não mapeia campo sem cabeçalho correspondente', () => {
    const mapeamento = sugerirMapeamento(['Coluna Aleatória'])
    expect(mapeamento.nome_completo).toBeUndefined()
    expect(mapeamento.cpf).toBeUndefined()
  })
})

describe('aplicarMapeamento', () => {
  it('extrai os campos do sistema a partir das colunas mapeadas', () => {
    const linhas = [{ Nome: 'Fulano', Documento: '12345678900' }]
    const resultado = aplicarMapeamento(linhas, {
      nome_completo: 'Nome',
      cpf: 'Documento',
    })
    expect(resultado[0]?.nome_completo).toBe('Fulano')
    expect(resultado[0]?.cpf).toBe('12345678900')
    expect(resultado[0]?.email_contato).toBe('')
  })

  it('campo não mapeado vira string vazia, nunca undefined', () => {
    const resultado = aplicarMapeamento([{ Nome: 'Fulano' }], {
      nome_completo: 'Nome',
    })
    expect(resultado[0]?.cpf).toBe('')
  })
})
