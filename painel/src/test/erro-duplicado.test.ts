import { describe, expect, it } from 'vitest'

// Achado da conferência ao vivo (v5.4d): o formulário (FormShell) já mostra a recusa do servidor quando o envio é feito com
// `mutateAsync`; a tela repetir a mesma mensagem logo abaixo (`X.isError && <p>…`) fazia o texto vermelho aparecer DUAS vezes em 70 formulários.
// Trava: mutação enviada só por formulário (`onSubmit={(v) => X.mutateAsync(v)}`) não tem o seu `isError` repetido na tela.
const fontes = {
  ...import.meta.glob('../pages/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../components/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
} as Record<string, string>

function repetidas(codigo: string): string[] {
  const nomes = new Set(
    [...codigo.matchAll(/(\w+)\.mutateAsync/g)].map((m) => m[1]!),
  )
  return [...nomes].filter((n) => {
    const soPeloFormulario =
      !new RegExp(`\\b${n}\\.mutate\\(`).test(codigo) &&
      codigo
        .split('\n')
        .filter((l) => l.includes(`${n}.mutateAsync`))
        .every((l) => l.includes('onSubmit'))
    return soPeloFormulario && new RegExp(`\\b${n}\\.isError &&`).test(codigo)
  })
}

describe('mensagem de erro do formulário não se repete na tela', () => {
  it('examina as telas e os componentes (e não está vazio)', () => {
    expect(Object.keys(fontes).length).toBeGreaterThan(30)
  })

  it('nenhuma mutação enviada só por formulário repete o erro com isError', () => {
    const achados = Object.entries(fontes).flatMap(([arquivo, codigo]) =>
      repetidas(codigo).map((n) => `${arquivo}: ${n}`),
    )
    expect(achados).toEqual([])
  })

  it('o detector enxerga o defeito (prova de que a trava não é cega)', () => {
    const ruim = `
      const criar = useMutation({})
      <FormShell onSubmit={(v) => criar.mutateAsync(v)}>
        {criar.isError && (<p>{(criar.error as Error).message}</p>)}
      </FormShell>`
    expect(repetidas(ruim)).toEqual(['criar'])
    const botao = `${ruim}\n<Button onClick={() => criar.mutate(1)} />`
    expect(repetidas(botao)).toEqual([])
  })
})
