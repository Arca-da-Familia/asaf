import { describe, expect, it } from 'vitest'

import { descricaoParaMeta, tituloCurto } from '../src/lib/texto'

const RESERVA =
  'Projeto da Associação Arca da Família (ASAF), em Parauapebas (PA), voltado às famílias atendidas.'

describe('descricaoParaMeta', () => {
  it('usa o texto da página quando tem tamanho bom', () => {
    const texto =
      'Aulas de reforço escolar para crianças de 6 a 12 anos, aos sábados.'
    expect(descricaoParaMeta(texto, RESERVA)).toBe(texto)
  })
  it('cai na reserva quando o texto é curto ou vazio (SEO exige >= 50)', () => {
    expect(descricaoParaMeta('Curto.', RESERVA)).toBe(RESERVA)
    expect(descricaoParaMeta(null, RESERVA)).toBe(RESERVA)
    expect(descricaoParaMeta('   ', RESERVA)).toBe(RESERVA)
  })
  it('corta na última palavra inteira, com reticências, em até 160', () => {
    const longo = 'palavra '.repeat(60)
    const meta = descricaoParaMeta(longo, RESERVA)
    expect(meta.length).toBeLessThanOrEqual(160)
    expect(meta.endsWith('…')).toBe(true)
    expect(meta).not.toMatch(/palavr…$/) // não corta palavra no meio
  })
  it('junta quebras de linha e espaços repetidos', () => {
    const meta = descricaoParaMeta(
      `Linha um\n\nlinha   dois ${'x'.repeat(40)}`,
      RESERVA,
    )
    expect(meta).not.toMatch(/\s{2,}|\n/)
  })
})

describe('tituloCurto', () => {
  it('mantém título curto', () => {
    expect(tituloCurto('Horta comunitária')).toBe('Horta comunitária')
  })
  it('limita para caber em "Título | ASAF" (<= 70)', () => {
    const t = tituloCurto(
      'Projeto de acolhimento e fortalecimento de vínculos familiares na comunidade',
    )
    expect(`${t} | ASAF`.length).toBeLessThanOrEqual(70)
    expect(t.endsWith('…')).toBe(true)
  })
})
