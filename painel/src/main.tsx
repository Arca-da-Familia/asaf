import './lib/zod-sem-eval'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from './App'
import { AuthProvider } from './lib/auth-context'
import { inicializarMonitoramentoGlobal } from './lib/monitoramento'
import { criarQueryClient } from './lib/query-client'
import { ThemeProvider } from './lib/theme'
import './index.css'

inicializarMonitoramentoGlobal()

const queryClient = criarQueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
