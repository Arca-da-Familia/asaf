import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import '@/lib/zod-sem-eval'

// v7.3b - o zod não tenta eval (a política de conteúdo do painel o proíbe); os esquemas continuam validando
describe('zod sem eval', () => {
  it('fica em modo jitless e continua validando', () => {
    expect(z.config().jitless).toBe(true)
    const esquema = z.object({ nome: z.string().min(2) })
    expect(esquema.safeParse({ nome: 'Ana' }).success).toBe(true)
    expect(esquema.safeParse({ nome: 'A' }).success).toBe(false)
  })
})
