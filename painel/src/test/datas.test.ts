import { beforeAll, describe, expect, it } from 'vitest'

// Fuso fixo pro teste ser determinístico independente de onde ele rodar (CI, máquina do dev).
// Precisa ser setado antes de qualquer `new Date()`/`Intl.DateTimeFormat` do módulo sob teste.
beforeAll(() => {
  process.env.TZ = 'America/Sao_Paulo'
})

describe('formatarData/paraUtcIso - convenção UTC ingênuo (achado 2026-09-18)', () => {
  it('formatarData trata datetime sem timezone como UTC, convertendo pra hora local (Brasília, UTC-3)', async () => {
    const { formatarData } = await import('@/lib/datas')
    // 13:13 UTC = 10:13 em Brasília (UTC-3) - exatamente o caso real relatado: sem a correção,
    // isso aparecia como "13:13" (a hora UTC crua, ~3h adiantada da hora local de verdade).
    expect(formatarData('2026-09-18T13:13:15', { comHora: true })).toContain(
      '10:13',
    )
  })

  it('formatarData não altera datetime que já vem com timezone explícito', async () => {
    const { formatarData } = await import('@/lib/datas')
    expect(
      formatarData('2026-09-18T10:13:15-03:00', { comHora: true }),
    ).toContain('10:13')
  })

  it('formatarData sem hora continua tratando como data-only (meia-noite local, sem deslocar dia)', async () => {
    const { formatarData } = await import('@/lib/datas')
    expect(formatarData('2026-09-18')).toBe('18/09/2026')
  })

  it('paraUtcIso converte o valor local de um <input type="datetime-local"> pro UTC equivalente', async () => {
    const { paraUtcIso } = await import('@/lib/datas')
    // Usuário digita "19:00" em Brasília (UTC-3) -> deve virar 22:00 UTC.
    expect(paraUtcIso('2026-09-18T19:00')).toBe('2026-09-18T22:00:00.000Z')
  })

  it('paraUtcIso e formatarData são inversos - o que o usuário digita é o que ele vê de volta', async () => {
    const { formatarData, paraUtcIso } = await import('@/lib/datas')
    const digitado = '2026-09-18T19:00'
    const enviadoParaApi = paraUtcIso(digitado)
    expect(formatarData(enviadoParaApi, { comHora: true })).toContain('19:00')
  })
})
