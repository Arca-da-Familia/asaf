/**
 * v9.2a - cada tela do painel é baixada só quando é aberta (antes o painel inteiro, 2 MB, vinha de uma vez, inclusive para quem só ia entrar). O risco que isso
 * traz: logo depois de uma publicação nova, quem já estava com o painel aberto pede o pedaço ANTIGO de uma tela, que não existe mais (o nome muda a cada
 * versão), e a tela não abre. Aqui, se o pedaço não vier, a página recarrega UMA vez (pega a versão nova inteira); se falhar de novo logo em seguida (sem
 * internet, por exemplo), o erro segue para a tela de erro, sem ficar recarregando sem parar.
 */
const CHAVE = 'asaf-recarregou-para-a-versao-nova'

export async function carregarTela<T>(carregar: () => Promise<T>): Promise<T> {
  try {
    const modulo = await carregar()
    try {
      sessionStorage.removeItem(CHAVE)
    } catch {
      /* sem armazenamento: nada a limpar */
    }
    return modulo
  } catch (erro) {
    let jaRecarregou = true
    try {
      jaRecarregou = sessionStorage.getItem(CHAVE) === '1'
      sessionStorage.setItem(CHAVE, '1')
    } catch {
      /* sem armazenamento: não arrisca recarregar sem parar */
    }
    if (!jaRecarregou) {
      window.location.reload()
      // a página vai recarregar: a tela fica em "Carregando…" até lá
      return new Promise<T>(() => {})
    }
    throw erro
  }
}
