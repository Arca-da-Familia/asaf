import { zodResolver } from '@hookform/resolvers/zod'
import { useState, type ReactNode } from 'react'
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form'
import { z } from 'zod'

import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

type FormShellProps<T extends FieldValues> = {
  schema: z.ZodType<T, FieldValues>
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
  // zodResolver (v5) tipa o resolver pela ENTRADA do schema; o FormShell só conhece a SAÍDA (T) —
  // com z.coerce, por exemplo, entrada e saída diferem. O elenco é o único ponto de contato.
  const form = useForm<T>({
    resolver: zodResolver(schema) as unknown as Resolver<T>,
    defaultValues,
  })
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
      // Espaçamento padrão entre os filhos. `v3-space-y-*` (design/theme.css) e não `space-y-*`: as telas
      // passam `flex flex-wrap items-end`/`grid` em className e só a regra do Tailwind 3 mantém esses
      // formulários como eram. O twMerge não conhece o nome novo, então o padrão sai quando a tela
      // traz o seu próprio `v3-space-y-*`.
      className={cn(
        !/(^|\s)v3-space-y-/.test(className ?? '') && 'v3-space-y-4',
        className,
      )}
      noValidate
    >
      {erroGeral && (
        // `col-span-full` e `w-full`: o formulário pode ser uma grade ou uma linha que quebra; a mensagem ocupa a largura
        // toda em vez de empurrar os campos uma casa.
        <p
          role="alert"
          className="col-span-full w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
