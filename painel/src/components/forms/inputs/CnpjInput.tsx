import { formatarCnpj } from '@/lib/cnpj'
import { cn } from '@/lib/utils'

type CnpjInputProps = {
  value: string
  onChange: (valor: string) => void
  onBlur?: () => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-invalid'?: boolean
}

export function CnpjInput({
  value,
  onChange,
  onBlur,
  disabled,
  id,
  className,
  ...rest
}: CnpjInputProps) {
  return (
    <input
      id={id}
      inputMode="numeric"
      maxLength={18}
      value={value}
      onChange={(e) => onChange(formatarCnpj(e.target.value))}
      onBlur={onBlur}
      disabled={disabled}
      placeholder="00.000.000/0000-00"
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
        className,
      )}
      {...rest}
    />
  )
}
