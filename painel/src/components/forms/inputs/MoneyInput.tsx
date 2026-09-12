import { cn } from '@/lib/utils'

type MoneyInputProps = {
  value: number | null
  onChange: (valor: number | null) => void
  onBlur?: () => void
  disabled?: boolean
  placeholder?: string
  id?: string
  className?: string
  'aria-invalid'?: boolean
}

// Valor canônico em CENTAVOS (inteiro) — evita erro de ponto flutuante. Exibido como "1.234,56".
function centavosParaTexto(centavos: number | null): string {
  if (centavos === null || Number.isNaN(centavos)) return ''
  return (centavos / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function textoParaCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,]/g, '').replace(',', '.')
  if (!limpo) return null
  const numero = Number(limpo)
  if (Number.isNaN(numero)) return null
  return Math.round(numero * 100)
}

export function MoneyInput({
  value,
  onChange,
  onBlur,
  disabled,
  placeholder = '0,00',
  id,
  className,
  ...rest
}: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <input
        id={id}
        inputMode="decimal"
        value={centavosParaTexto(value)}
        onChange={(e) => onChange(textoParaCentavos(e.target.value))}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={placeholder}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm',
          className,
        )}
        {...rest}
      />
    </div>
  )
}
