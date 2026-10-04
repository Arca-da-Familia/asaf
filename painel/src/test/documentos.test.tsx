import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { describe, expect, it } from 'vitest'

import { ResultadoDaVerificacao } from '@/components/documentos/ResultadoDaVerificacao'
import {
  SeloDeClassificacao,
  SeloDeSituacao,
  SeloDeValidade,
} from '@/components/documentos/Selos'
import {
  alertaDeValidade,
  formatarTamanho,
  proximoPasso,
  type Documento,
  type ResultadoDaVerificacao as Resultado,
} from '@/lib/documentos'

function documento(sobrescrever: Partial<Documento> = {}): Documento {
  return {
    id_documento: 1,
    tipo: 'ATA',
    tipo_rotulo: 'Ata',
    titulo: 'Ata de eleição',
    descricao: null,
    data_documento: null,
    ano: 2026,
    validade: null,
    classificacao: 'Restrita',
    publicar_no_site: true,
    vinculo_tipo: null,
    vinculo_id: null,
    grupo_versao: 'g1',
    versao: 1,
    vigente: true,
    tem_original: false,
    original_nome_arquivo: null,
    original_tamanho: null,
    original_sha256: null,
    tem_versao_publica: false,
    publico_formato: null,
    publico_tamanho: null,
    publico_paginas: null,
    publico_sha256: null,
    verificacao: null,
    verificacao_em: null,
    situacao: 'Rascunho',
    enviado_revisao_em: null,
    aprovado_em: null,
    motivo_recusa: null,
    recusado_em: null,
    motivo_retirada: null,
    retirado_em: null,
    criado_em: null,
    atualizado_em: null,
    pode_baixar_original: false,
    pode_editar: true,
    pode_aprovar: false,
    pode_retirar: false,
    ...sobrescrever,
  }
}

describe('alertaDeValidade', () => {
  const hoje = new Date(2026, 9, 3) // 03/10/2026

  it('sem validade, nada a avisar', () => {
    expect(alertaDeValidade(null, hoje)).toBeNull()
  })
  it('vencida: a data já passou', () => {
    expect(alertaDeValidade('2026-10-02', hoje)).toBe('vencida')
  })
  it('vence hoje ainda vale (não é vencida)', () => {
    expect(alertaDeValidade('2026-10-03', hoje)).toBe('vence-em-breve')
  })
  it('vence em até 30 dias avisa', () => {
    expect(alertaDeValidade('2026-11-02', hoje)).toBe('vence-em-breve')
  })
  it('31 dias ou mais não avisa', () => {
    expect(alertaDeValidade('2026-11-03', hoje)).toBeNull()
  })
  it('data malformada não quebra', () => {
    expect(alertaDeValidade('lixo', hoje)).toBeNull()
  })
})

describe('proximoPasso - diz em português o que falta', () => {
  it('documento interno não vai ao site', () => {
    expect(proximoPasso(documento({ publicar_no_site: false }))).toMatch(
      /não vai ao site/,
    )
  })
  it('sem original, pede o original', () => {
    expect(proximoPasso(documento())).toMatch(/original/)
  })
  it('com original e sem versão pública, pede a versão pública coberta', () => {
    expect(proximoPasso(documento({ tem_original: true }))).toMatch(
      /versão pública.*cobertos/,
    )
  })
  it('documento público oferece usar o original como versão pública', () => {
    expect(
      proximoPasso(documento({ tem_original: true, classificacao: 'Pública' })),
    ).toMatch(/Use o original/)
  })
  it('versão pública aceita: manda para revisão', () => {
    expect(
      proximoPasso(documento({ tem_original: true, tem_versao_publica: true })),
    ).toMatch(/Envie para revisão/)
  })
  it('recusa mostra o motivo antes de tudo', () => {
    expect(
      proximoPasso(documento({ motivo_recusa: 'Falta cobrir o CPF.' })),
    ).toMatch(/Recusado: Falta cobrir o CPF\./)
  })
  it('em revisão: quem pode aprovar é chamado a aprovar; os demais esperam', () => {
    expect(
      proximoPasso(documento({ situacao: 'Em revisão', pode_aprovar: true })),
    ).toMatch(/aprove ou recuse/)
    expect(
      proximoPasso(documento({ situacao: 'Em revisão', pode_aprovar: false })),
    ).toMatch(/Aguardando a aprovação de outra pessoa/)
  })
  it('aprovado e retirado', () => {
    expect(proximoPasso(documento({ situacao: 'Aprovado' }))).toMatch(
      /Publicado/,
    )
    expect(proximoPasso(documento({ situacao: 'Retirado' }))).toMatch(
      /Retirado/,
    )
  })
})

describe('formatarTamanho', () => {
  it('escolhe a unidade certa', () => {
    expect(formatarTamanho(null)).toBe('—')
    expect(formatarTamanho(512)).toBe('512 B')
    expect(formatarTamanho(2048)).toBe('2.0 KB')
    expect(formatarTamanho(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('ResultadoDaVerificacao', () => {
  const recusado: Resultado = {
    ok: false,
    paginas: 3,
    caracteres: 1200,
    bloqueios: [
      {
        codigo: 'CPF',
        mensagem: 'CPF visível no texto.',
        pagina: 2,
        amostra: '111.***.***-35',
      },
    ],
    avisos: [
      {
        codigo: 'TELEFONE_FIXO',
        mensagem: 'Telefone fixo encontrado.',
        pagina: null,
        amostra: null,
      },
    ],
  }
  const aceito: Resultado = {
    ok: true,
    paginas: 1,
    caracteres: 300,
    bloqueios: [],
    avisos: [],
  }

  it('recusado: lista o que corrigir, só com a amostra mascarada, e os avisos', () => {
    const { getByText, queryByText } = render(
      <ResultadoDaVerificacao resultado={recusado} />,
    )
    expect(getByText(/Não pode ir ao site/)).toBeInTheDocument()
    expect(getByText(/CPF visível no texto/)).toBeInTheDocument()
    expect(getByText('111.***.***-35')).toBeInTheDocument()
    expect(getByText(/Telefone fixo encontrado/)).toBeInTheDocument()
    expect(queryByText(/Passou na conferência/)).not.toBeInTheDocument()
  })

  it('aceito: mostra que passou e não pede correção', () => {
    const { getByText, queryByText } = render(
      <ResultadoDaVerificacao resultado={aceito} />,
    )
    expect(getByText(/Passou na conferência automática/)).toBeInTheDocument()
    expect(queryByText(/O que precisa ser corrigido/)).not.toBeInTheDocument()
  })

  it.each([
    ['recusado', recusado],
    ['aceito', aceito],
  ])('%s: sem violações de acessibilidade (axe)', async (_nome, resultado) => {
    const { container } = render(
      <ResultadoDaVerificacao resultado={resultado} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Selos', () => {
  it('validade vencida, a vencer e em dia têm textos diferentes', () => {
    const vencida = render(<SeloDeValidade validade="2000-01-01" />)
    expect(vencida.getByText(/Vencida em 01\/01\/2000/)).toBeInTheDocument()
    const emDia = render(<SeloDeValidade validade="2999-12-31" />)
    expect(emDia.getByText(/Válida até 31\/12\/2999/)).toBeInTheDocument()
    const nenhuma = render(<SeloDeValidade validade={null} />)
    expect(nenhuma.container).toBeEmptyDOMElement()
  })

  it('situação e classificação aparecem em texto (não só por cor/ícone)', async () => {
    const { container, getByText } = render(
      <div>
        <SeloDeSituacao situacao="Em revisão" />
        <SeloDeClassificacao classificacao="Restrita" />
        <SeloDeClassificacao classificacao="Pública" />
      </div>,
    )
    expect(getByText('Em revisão')).toBeInTheDocument()
    expect(getByText('Restrita')).toBeInTheDocument()
    expect(getByText('Pública')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})
