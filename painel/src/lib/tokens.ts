// Fonte única dos tokens de design (v0.2.4) para uso em JavaScript (gráficos Recharts,
// SVG inline, etc.), onde classes do Tailwind não se aplicam. No CSS/Tailwind a mesma
// identidade vive em src/index.css (variáveis) + tailwind.config.js (mapeamento) — trocar a
// identidade visual da associação é mudar UM lugar, nunca caçar cor em 40 arquivos.
export const cores = {
  // Paleta da marca (2026-10-01), a mesma de design/tokens.css e da logo institucional.
  brand: '#145238', // verde bandeira — cor primária da ASAF
  brandForte: '#0e3a28', // verde mais escuro (hover/ênfase)
  brandSuave: '#2a8f64', // verde mais claro (séries secundárias de gráfico)
  ouro: '#e3c435', // secundária — amarelo ouro
  azulClaro: '#5fbbe9', // terciária — azul claro (provisório, ver design/tokens.css)
  neutro: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  status: {
    sucesso: '#16a34a',
    alerta: '#d97706',
    erro: '#dc2626',
    info: '#2563eb',
  },
} as const

export const tipografia = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const

export const raio = {
  sm: 'calc(var(--radius) - 4px)',
  md: 'calc(var(--radius) - 2px)',
  lg: 'var(--radius)',
} as const
