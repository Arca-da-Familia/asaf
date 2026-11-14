import { describe, expect, it } from 'vitest'

import {
  CAMPOS_SISTEMA,
  COLUNAS_DA_PLANILHA_MODELO,
  aplicarMapeamento,
  dataParaOSistema,
  parseArquivoCsv,
  planilhaModeloCsv,
  sugerirMapeamento,
} from '@/lib/importacao'

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

// v9.5d (pedido do Presidente, 13/11): a planilha modelo e a data do jeito brasileiro
describe('planilha modelo', () => {
  it('os nomes das colunas do modelo são todos reconhecidos sozinhos pelo assistente', () => {
    const mapeamento = sugerirMapeamento(COLUNAS_DA_PLANILHA_MODELO)
    expect(Object.keys(mapeamento).sort()).toEqual(
      CAMPOS_SISTEMA.map((c) => c.chave).sort(),
    )
  })

  it('sai com a marca de acentos, separada por ponto e vírgula e sem linha de exemplo', () => {
    const csv = planilhaModeloCsv()
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).trimEnd().split('\r\n')).toEqual([
      'Nome completo;CPF;E-mail;Telefone;Data de nascimento;Categoria',
    ])
  })

  it('o arquivo do modelo, preenchido e lido de volta, chega ao sistema com a data no formato dele', async () => {
    const conteudo = `${planilhaModeloCsv()}Maria de Teste;000.000.000-00;maria@exemplo.com;(91) 98888-1234;22/7/1975;Efetivo\r\n`
    const planilha = await parseArquivoCsv(
      new File([conteudo], 'modelo.csv', { type: 'text/csv' }),
    )
    const linhas = aplicarMapeamento(
      planilha.linhas,
      sugerirMapeamento(planilha.cabecalhos),
    )
    expect(linhas[0]).toMatchObject({
      nome_completo: 'Maria de Teste',
      cpf: '000.000.000-00',
      email_contato: 'maria@exemplo.com',
      telefone_whatsapp: '(91) 98888-1234',
      data_nascimento: '1975-07-22',
      categoria: 'Efetivo',
    })
  })

  it('data do jeito brasileiro vira a do sistema; a do sistema e o resto seguem como vieram', () => {
    expect(dataParaOSistema('22/07/1975')).toBe('1975-07-22')
    expect(dataParaOSistema('1/2/2001')).toBe('2001-02-01')
    expect(dataParaOSistema('1975-07-22')).toBe('1975-07-22')
    expect(dataParaOSistema('ontem')).toBe('ontem')
    expect(dataParaOSistema('')).toBe('')
  })
})
