import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ErroCampo, FormShell } from '@/components/forms/FormShell'
import { ApiError } from '@/lib/api'

const schema = z.object({
  nome: z.string().min(1, 'Informe o nome.'),
})

function Formulario({
  onSubmit,
}: {
  onSubmit: (v: { nome: string }) => void | Promise<unknown>
}) {
  return (
    <FormShell schema={schema} defaultValues={{ nome: '' }} onSubmit={onSubmit}>
      {(form) => (
        <>
          <input aria-label="nome" {...form.register('nome')} />
          <ErroCampo mensagem={form.formState.errors.nome?.message} />
          <button type="submit">Enviar</button>
        </>
      )}
    </FormShell>
  )
}

describe('FormShell', () => {
  it('bloqueia o envio e mostra o erro do Zod quando o campo é inválido', async () => {
    const onSubmit = vi.fn()
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.click(screen.getByText('Enviar'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe o nome.',
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('chama onSubmit com os valores quando válido', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.click(screen.getByText('Enviar'))

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ nome: 'Maria' }),
    )
  })

  it('mapeia erro 422 do backend para o campo certo, sem exigir mapeamento manual', async () => {
    const erro422 = new ApiError(422, 'Dados inválidos.', [
      { campo: 'nome', mensagem: 'Este nome já está em uso.' },
    ])
    const onSubmit = vi.fn().mockRejectedValue(erro422)
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.click(screen.getByText('Enviar'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este nome já está em uso.',
    )
  })

  it('mostra erro geral (não role=alert de campo) para falha genérica', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Falha de rede.'))
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.click(screen.getByText('Enviar'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede.')
  })
})
