import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { expect } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

// `findBy*`/`waitFor` esperam até 5 s (padrão 1 s): a consulta por papel/nome acessível é lenta em tela grande.
configure({ asyncUtilTimeout: 5000 })
