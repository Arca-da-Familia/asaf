import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Tailwind 4 pelo plugin do Vite (sem PostCSS/autoprefixer: o prefixo é feito pelo próprio
  // Tailwind). Tema e tokens vêm de ../design/ via src/index.css; não existe mais
  // tailwind.config.js. O vitest.config.ts não carrega o plugin (css: false nos testes).
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Em dev, o painel chama /auth na MESMA origem (localhost:5173) e o Vite
      // encaminha para o backend local. Isso faz o cookie HttpOnly de refresh
      // funcionar sem CORS nem TLS. Estenda com as rotas de API que forem usadas.
      '/auth': 'http://localhost:8000',
      '/uploads': 'http://localhost:8000',
      '/api': 'http://localhost:8000',
      '/carteirinha': 'http://localhost:8000',
      // v4.8 - tela da portaria (/portaria/:token no painel, ver PortariaGate.tsx) chama
      // GET /portaria/evento e POST /portaria/checkin|checkout, fora de /api (de propósito,
      // mesmo padrão de /carteirinha - ver app/routers/portaria.py).
      '/portaria': 'http://localhost:8000',
      // v2.5.8/v2.5.9 (achado ao testar Plano de Contas/Fornecedores, mesmo padrão se repetiu
      // em Títulos/baixa) - rotas de escrita do backend que não vivem sob /api (compatibilidade
      // de URL antiga, ver app/routers/financeiro.py). Sem isso o Vite não sabe pra onde
      // encaminhar o POST e devolve 404 da própria página em dev - só afeta desenvolvimento
      // local, produção usa VITE_API_URL absoluto (sem proxy).
      '/plano-contas': 'http://localhost:8000',
      '/fornecedores': 'http://localhost:8000',
      '/titulos': 'http://localhost:8000',
      '/baixar-titulo': 'http://localhost:8000',
    },
  },
})
