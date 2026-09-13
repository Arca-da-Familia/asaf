import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    },
  },
})
