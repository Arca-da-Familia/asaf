import { render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { DevComponents } from '@/pages/DevComponents'

// Auditoria de acessibilidade (v0.2.6) com axe-core. Roda no CI via `npm run test`.
describe('Acessibilidade (axe-core)', () => {
  it('o catálogo de componentes não tem violações', async () => {
    const { container } = render(
      <MemoryRouter>
        <DevComponents />
      </MemoryRouter>,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
