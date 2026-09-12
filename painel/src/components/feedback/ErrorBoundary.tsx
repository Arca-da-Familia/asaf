import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { registrarErro } from '@/lib/monitoramento'

type ErrorBoundaryProps = {
  children: ReactNode
  tituloModulo?: string
}

type ErrorBoundaryState = { erro: Error | null }

// Boundary por módulo (v0.2.4): um erro num módulo não derruba o painel inteiro.
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { erro: null }

  static getDerivedStateFromError(erro: Error): ErrorBoundaryState {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    registrarErro(erro, {
      origem: 'ErrorBoundary',
      modulo: this.props.tituloModulo ?? 'desconhecido',
      componentStack: info.componentStack ?? '',
    })
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <h2 className="text-lg font-semibold">
            Algo deu errado
            {this.props.tituloModulo ? ` em ${this.props.tituloModulo}` : ''}.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            O restante do painel continua funcionando. Recarregue esta área para
            tentar de novo.
          </p>
          <Button
            className="mt-4"
            onClick={() => this.setState({ erro: null })}
          >
            Tentar de novo
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
