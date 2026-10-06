import { zodResolver } from '@hookform/resolvers/zod'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
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

// Quais mensagens de erro de campo a tela JÁ mostra (cada `ErroCampo` se registra aqui). O que o formulário recusou e nenhum `ErroCampo` mostra
// (um select obrigatório sem lugar para o erro, por exemplo) aparece num resumo no alto do formulário: o clique em "Enviar" nunca pode parecer
// que não aconteceu nada. Achado ao vivo da v5.4d: vários formulários recusavam o envio em silêncio.
type RegistroDeMensagens = {
  adicionar: (mensagem: string) => void
  remover: (mensagem: string) => void
}
const MensagensExibidas = createContext<RegistroDeMensagens | null>(null)

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
  const [exibidas, setExibidas] = useState<Record<string, number>>({})
  const registro = useMemo<RegistroDeMensagens>(
    () => ({
      adicionar: (mensagem) =>
        setExibidas((e) => ({ ...e, [mensagem]: (e[mensagem] ?? 0) + 1 })),
      remover: (mensagem) =>
        setExibidas((e) => {
          const proximo = { ...e }
          if ((e[mensagem] ?? 0) > 1) proximo[mensagem] = e[mensagem]! - 1
          else delete proximo[mensagem]
          return proximo
        }),
    }),
    [],
  )
  const soltas = [
    ...new Set(
      Object.values(form.formState.errors)
        .map((e) => (e as { message?: unknown } | undefined)?.message)
        .filter(
          (m): m is string => typeof m === 'string' && m !== '' && !exibidas[m],
        ),
    ),
  ]

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
        // regra que olha vários campos juntos (fim antes do início) vem do servidor sem nome de campo: não tem onde pendurar, então vai no alto
        const semCampo = err.errosCampos.filter((e) => !e.campo)
        if (semCampo.length)
          setErroGeral(semCampo.map((e) => e.mensagem).join(' '))
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
      {soltas.length > 0 && (
        <div
          role="alert"
          className="col-span-full w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <p className="font-medium">Corrija para continuar:</p>
          <ul className="list-disc pl-5">
            {soltas.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <MensagensExibidas.Provider value={registro}>
        {children(form)}
      </MensagensExibidas.Provider>
    </form>
  )
}

// Erro de campo, para uso junto com o FormShell (form.formState.errors.campo?.message).
export function ErroCampo({ mensagem }: { mensagem?: string }) {
  const registro = useContext(MensagensExibidas)
  // layout effect: registra ANTES da tela pintar, para o resumo do formulário não piscar com uma mensagem que já está no campo
  useLayoutEffect(() => {
    if (!mensagem || !registro) return
    registro.adicionar(mensagem)
    return () => registro.remover(mensagem)
  }, [mensagem, registro])
  if (!mensagem) return null
  return (
    <p role="alert" className="mt-1 text-sm text-destructive">
      {mensagem}
    </p>
  )
}
