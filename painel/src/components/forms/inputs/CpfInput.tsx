import { formatarCpf } from '@/lib/cpf'
import { cn } from '@/lib/utils'

type CpfInputProps = {
  value: string
  onChange: (valor: string) => void
  onBlur?: () => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-invalid'?: boolean
}

export function CpfInput({
  value,
  onChange,
  onBlur,
  disabled,
  id,
  className,
  ...rest
}: CpfInputProps) {
  return (
    <input
      id={id}
      inputMode="numeric"
      maxLength={14}
      value={value}
      onChange={(e) => onChange(formatarCpf(e.target.value))}
      onBlur={onBlur}
      disabled={disabled}
      placeholder="000.000.000-00"
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
        className,
      )}
      {...rest}
    />
  )
}
