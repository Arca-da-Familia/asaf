import { useEffect, useState } from 'react'

/** O id da mensagem de erro do formulário (o `role="alert"` do alto da tela): o campo com erro aponta para ela em `aria-describedby`. */
export const ID_DO_ERRO = 'erro-do-formulario'

/**
 * v9.1c - o erro de um formulário curto (entrar, esqueci a senha, trocar a senha) LIGADO AO CAMPO. Antes a mensagem aparecia no alto e só: quem usa leitor de
 * tela ouvia o aviso, mas o campo não dizia que estava errado e o foco ficava no botão. Agora `setErro(texto, 'cpf')` mostra a mensagem, marca o campo
 * (`aria-invalid`), liga a mensagem a ele (`aria-describedby`) e leva o foco para lá; sem campo (erro do servidor, como senha errada) fica só o aviso, que o
 * leitor de tela lê na hora (`role="alert"`). Cada campo recebe `{...doCampo('cpf')}`.
 */
export function useErroDeFormulario() {
  const [erro, setTexto] = useState<string | null>(null)
  const [campo, setCampo] = useState<string | null>(null)
  // muda a cada erro: o mesmo campo errado duas vezes seguidas recebe o foco de novo
  const [vez, setVez] = useState(0)

  useEffect(() => {
    if (campo) document.getElementById(campo)?.focus()
  }, [campo, vez])

  function setErro(texto: string | null, idDoCampo: string | null = null) {
    setTexto(texto)
    setCampo(texto ? idDoCampo : null)
    setVez((v) => v + 1)
  }

  function doCampo(id: string) {
    return campo === id
      ? { 'aria-invalid': true as const, 'aria-describedby': ID_DO_ERRO }
      : {}
  }

  return { erro, setErro, doCampo }
}
