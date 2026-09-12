/* eslint-disable @typescript-eslint/no-explicit-any */
// Tipos mínimos para o jest-axe (não envia tipos próprios).
declare module 'jest-axe' {
  export function axe(
    html: Element | string,
    options?: Record<string, unknown>,
  ): Promise<unknown>

  export const toHaveNoViolations: any
}
