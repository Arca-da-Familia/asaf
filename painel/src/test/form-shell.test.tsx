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

  it('campo numérico com z.coerce: entrega número ao onSubmit e a mensagem do schema quando inválido', async () => {
    // Mesmo padrão das telas de dinheiro/ano: <input> de texto + z.coerce.number() no schema
    // (no Zod 4 a ENTRADA do coerce é `unknown`, a saída é number - o FormShell tem de aceitar).
    const schemaNumero = z.object({
      valor: z.coerce.number().positive('Informe um valor maior que zero.'),
    })
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <FormShell<z.infer<typeof schemaNumero>>
        schema={schemaNumero}
        defaultValues={{ valor: undefined }}
        onSubmit={onSubmit}
      >
        {(form) => (
          <>
            <input aria-label="valor" {...form.register('valor')} />
            <ErroCampo mensagem={form.formState.errors.valor?.message} />
            <button type="submit">Enviar</button>
          </>
        )}
      </FormShell>,
    )

    await userEvent.type(screen.getByLabelText('valor'), '0')
    await userEvent.click(screen.getByText('Enviar'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Informe um valor maior que zero.',
    )
    expect(onSubmit).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByLabelText('valor'))
    await userEvent.type(screen.getByLabelText('valor'), '125.5')
    await userEvent.click(screen.getByText('Enviar'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ valor: 125.5 }))
  })

  it('mostra erro geral (não role=alert de campo) para falha genérica', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Falha de rede.'))
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.click(screen.getByText('Enviar'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede.')
  })

  it('recusa que nenhum ErroCampo mostra aparece num resumo (o envio nunca parece não ter acontecido), sem repetir o que já está no campo', async () => {
    const schemaDois = z.object({
      nome: z.string().min(1, 'Informe o nome.'),
      id_conta: z.coerce.number().min(1, 'Selecione a conta.'),
    })
    const onSubmit = vi.fn()
    render(
      <FormShell<z.infer<typeof schemaDois>>
        schema={schemaDois}
        defaultValues={{ nome: '', id_conta: 0 }}
        onSubmit={onSubmit}
      >
        {(form) => (
          <>
            <input aria-label="nome" {...form.register('nome')} />
            <ErroCampo mensagem={form.formState.errors.nome?.message} />
            {/* o select obrigatório não tem ErroCampo: o erro dele tem de aparecer mesmo assim */}
            <select aria-label="conta" {...form.register('id_conta')}>
              <option value="0">Selecione…</option>
            </select>
            <button type="submit">Enviar</button>
          </>
        )}
      </FormShell>,
    )

    await userEvent.click(screen.getByText('Enviar'))

    const alertas = await screen.findAllByRole('alert')
    const texto = alertas.map((a) => a.textContent).join(' | ')
    expect(texto).toContain('Selecione a conta.')
    // "Informe o nome." está no campo e NÃO é repetido no resumo
    expect(screen.getAllByText('Informe o nome.')).toHaveLength(1)
    expect(onSubmit).not.toHaveBeenCalled()

    // corrigido o campo com resumo, o resumo some
    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.selectOptions(screen.getByLabelText('conta'), '0')
    expect(screen.queryByText('Informe o nome.')).toBeNull()
  })

  it('recusa 422 do servidor SEM nome de campo (regra que olha vários campos) aparece no alto do formulário', async () => {
    const erro422 = new ApiError(422, 'O fim precisa ser depois do início.', [
      { campo: '', mensagem: 'O fim precisa ser depois do início.' },
    ])
    const onSubmit = vi.fn().mockRejectedValue(erro422)
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.click(screen.getByText('Enviar'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O fim precisa ser depois do início.',
    )
  })

  it('recusa 422 que aponta um campo que a tela não tem também aparece (nunca em silêncio)', async () => {
    const erro422 = new ApiError(422, 'Valor inválido.', [
      { campo: 'campo_que_a_tela_nao_tem', mensagem: 'Valor inválido.' },
    ])
    const onSubmit = vi.fn().mockRejectedValue(erro422)
    render(<Formulario onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('nome'), 'Maria')
    await userEvent.click(screen.getByText('Enviar'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Valor inválido.',
    )
  })
})
