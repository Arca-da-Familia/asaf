import { mascaraData } from '@/lib/datas'
import { cn } from '@/lib/utils'

type DateInputProps = {
  value: string
  onChange: (valor: string) => void
  onBlur?: () => void
  disabled?: boolean
  id?: string
  className?: string
  'aria-invalid'?: boolean
}

// Entrada de data no formato brasileiro (dd/mm/aaaa). O valor canônico é a string
// mascarada; use dataBrParaIso() de lib/datas.ts na hora de enviar ao backend.
export function DateInput({
  value,
  onChange,
  onBlur,
  disabled,
  id,
  className,
  ...rest
}: DateInputProps) {
  return (
    <input
      id={id}
      inputMode="numeric"
      maxLength={10}
      value={value}
      onChange={(e) => onChange(mascaraData(e.target.value))}
      onBlur={onBlur}
      disabled={disabled}
      placeholder="dd/mm/aaaa"
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
        className,
      )}
      {...rest}
    />
  )
}
