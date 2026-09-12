/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import 'vitest'

// Matcher customizado `toHaveNoViolations` (jest-axe) registrado no expect do Vitest.
declare module 'vitest' {
  interface Assertion<T = any> {
    toHaveNoViolations(): void
  }
}
