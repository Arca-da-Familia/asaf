// Roda uma função com a API simulada de pé (e a derruba no fim). Usado pelos builds de teste: desde a
// v5.2 as páginas são geradas lendo a API NO BUILD, então o mock tem que existir enquanto o Astro roda.
import { criarServidor, PORTA_DO_MOCK } from './mock-api.mjs'

export const API_DE_TESTE = `http://127.0.0.1:${PORTA_DO_MOCK}`

export async function comMock(opcoes, funcao) {
  const servidor = criarServidor(opcoes)
  const reaproveitado = await new Promise((resolver, rejeitar) => {
    servidor.once('error', (erro) => {
      // Porta ocupada = já existe um mock rodando (ex.: o do Playwright na sua máquina).
      if (erro.code === 'EADDRINUSE') resolver(true)
      else rejeitar(erro)
    })
    servidor.listen(PORTA_DO_MOCK, '127.0.0.1', () => resolver(false))
  })
  if (reaproveitado) {
    console.warn(
      `[com-mock] a porta ${PORTA_DO_MOCK} já está em uso: usando o mock que já roda ali. ` +
        'Se ele não for o certo (cheio x vazio), pare-o e rode de novo.',
    )
  }
  try {
    return await funcao()
  } finally {
    if (!reaproveitado) servidor.close()
  }
}
