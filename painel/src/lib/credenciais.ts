// v9.5j: a folha de impressão das credenciais abre numa SEGUNDA ABA (o Presidente, rodada 6: "abrir uma outra aba... a pessoa imprime ou salva o
// PDF"); lá se confere, se justifica o que falta e se imprime
export function abrirFolhaDeImpressao(ids: number[]) {
  window.open(
    `/associados/credenciais/imprimir?ids=${ids.join(',')}`,
    '_blank',
    'noopener',
  )
}
