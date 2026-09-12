import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

type FormShellProps<T extends FieldValues> = {
  schema: z.ZodType<T>
  defaultValues: DefaultValues<T>
  onSubmit: (valores: T) => void | Promise<unknown>
  children: (form: UseFormReturn<T>) => ReactNode
  className?: string
}

// Mapeia o 422 do FastAPI (detail = [{ loc: ['body', 'campo'], msg }]) para os erros
// de campo do react-hook-form automaticamente — o backend devolve o campo, o front
// aponta o erro no lugar certo sem um mapeamento manual por formulário.
function aplicarErros422<T extends FieldValues>(
  form: UseFormReturn<T>,
  erro: ApiError,
) {
  for (const e of erro.errosCampos) {
    if (e.campo) {
      form.setError(e.campo as never, { type: 'server', message: e.mensagem })
    }
  }
}

export function FormShell<T extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  children,
  className,
}: FormShellProps<T>) {
  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues })
  const [erroGeral, setErroGeral] = useState<string | null>(null)

  async function handleSubmit(valores: T) {
    setErroGeral(null)
    try {
      await onSubmit(valores)
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 422 &&
        err.errosCampos.length
      ) {
        aplicarErros422(form, err)
      } else if (err instanceof Error) {
        setErroGeral(err.message)
      } else {
        setErroGeral('Não foi possível enviar. Tente novamente.')
      }
    }
  }

  return (
    <form
      onSubmit={form.handleSubmit(handleSubmit)}
      className={cn('space-y-4', className)}
      noValidate
    >
      {erroGeral && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erroGeral}
        </p>
      )}
      {children(form)}
    </form>
  )
}

// Erro de campo, para uso junto com o FormShell (form.formState.errors.campo?.message).
export function ErroCampo({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null
  return (
    <p role="alert" className="mt-1 text-sm text-destructive">
      {mensagem}
    </p>
  )
}
