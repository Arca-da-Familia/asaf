import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type Tema = 'claro' | 'escuro' | 'sistema'

const CHAVE_TEMA = 'asaf-tema'

function temaSalvo(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE_TEMA)
    if (salvo === 'claro' || salvo === 'escuro' || salvo === 'sistema')
      return salvo
  } catch {
    // localStorage indisponível (ex.: modo privado) — segue em 'sistema'
  }
  return 'sistema'
}

function aplicaTema(tema: Tema) {
  const escuro =
    tema === 'escuro' ||
    (tema === 'sistema' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', escuro)
}

type ThemeContextValue = {
  tema: Tema
  ehEscuro: boolean
  alternar: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(temaSalvo)

  useEffect(() => {
    aplicaTema(tema)
    try {
      localStorage.setItem(CHAVE_TEMA, tema)
    } catch {
      // ignora falha de persistência
    }
  }, [tema])

  // Se o usuário está em "sistema", reage à mudança de preferência do SO em tempo real.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (tema === 'sistema') aplicaTema(tema)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [tema])

  const value = useMemo<ThemeContextValue>(() => {
    const ehEscuro =
      tema === 'escuro' ||
      (tema === 'sistema' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    return {
      tema,
      ehEscuro,
      // Alternância simples: o "sistema" é respeitado até o usuário escolher manualmente.
      alternar: () => setTema(ehEscuro ? 'claro' : 'escuro'),
    }
  }, [tema])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme deve ser usado dentro de <ThemeProvider>')
  return ctx
}
