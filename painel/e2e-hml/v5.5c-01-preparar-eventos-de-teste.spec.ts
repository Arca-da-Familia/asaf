import { expect, test } from '@playwright/test'

import { API_HML, entrar, exigirHomologacao, RODADA, vigiar } from './apoio'

// v5.5c - preparo para o roteiro v5.5c-02 (a pessoa se inscrevendo pelo SITE): cria, pelo sistema de teste, um evento PÚBLICO e GRATUITO com 2 vagas e duas perguntas
// (uma obrigatória, uma opcional) e um evento PÚBLICO com valor. O site de teste só ganha a página de cada evento quando a homologação é publicada de novo (ele lê a API NO
// BUILD): por isso este roteiro roda primeiro, depois a homologação é publicada, e só então o v5.5c-02.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const S = String(RODADA)
const PREFIXO_GRATUITO = 'Oficina de Inscrição do Robô'
const PREFIXO_COM_VALOR = 'Jantar com Valor do Robô'

const dias = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 19)

test('o sistema de teste ganha um evento público gratuito com 2 vagas e perguntas, e um evento com valor', async ({
  page,
}) => {
  const vigia = vigiar(page)
  const token: { valor: string } = { valor: '' }
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token.valor = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => token.valor, { timeout: 15_000 }).not.toBe('')
  const cabecalho = {
    Authorization: token.valor,
    'Content-Type': 'application/json',
  }

  const gratuito = await page.request.fetch(`${API_HML}/api/eventos/`, {
    method: 'POST',
    headers: cabecalho,
    data: JSON.stringify({
      titulo: `${PREFIXO_GRATUITO} ${S}`,
      descricao: 'Evento de teste para provar a inscrição pelo site.',
      categoria: 'PALESTRA',
      data_hora_inicio: dias(10),
      data_hora_fim: new Date(Date.now() + 10 * 86_400_000 + 2 * 3_600_000)
        .toISOString()
        .slice(0, 19),
      endereco_avulso: 'Salão da ASAF (teste)',
      vagas: 2,
      gratuito: true,
      visibilidade: 'Pública',
    }),
  })
  expect(gratuito.status(), await gratuito.text()).toBe(200)
  const idGratuito = ((await gratuito.json()) as { id_evento: number })
    .id_evento

  for (const pergunta of [
    {
      enunciado: 'Como você soube da oficina?',
      tipo: 'SELECAO_UNICA',
      opcoes: 'Redes sociais,Amigos,Igreja',
      obrigatoria: true,
      ordem: 1,
    },
    {
      enunciado: 'Alguma restrição alimentar?',
      tipo: 'TEXTO_CURTO',
      obrigatoria: false,
      ordem: 2,
    },
  ]) {
    const r = await page.request.fetch(
      `${API_HML}/api/eventos/${idGratuito}/perguntas`,
      { method: 'POST', headers: cabecalho, data: JSON.stringify(pergunta) },
    )
    expect(r.status(), await r.text()).toBe(200)
  }

  const comValor = await page.request.fetch(`${API_HML}/api/eventos/`, {
    method: 'POST',
    headers: cabecalho,
    data: JSON.stringify({
      titulo: `${PREFIXO_COM_VALOR} ${S}`,
      categoria: 'PALESTRA',
      data_hora_inicio: dias(20),
      vagas: 10,
      gratuito: false,
      visibilidade: 'Pública',
    }),
  })
  expect(comValor.status(), await comValor.text()).toBe(200)

  // os dois aparecem na lista pública (a API), com as vagas certas e as perguntas só no detalhe
  const publicos = (await (
    await page.request.get(`${API_HML}/api/publico/eventos`)
  ).json()) as Array<{
    id_evento: number
    titulo: string
    vagas: number | null
    vagas_livres: number | null
    gratuito: boolean
  }>
  const doGratuito = publicos.find((e) => e.id_evento === idGratuito)
  expect(doGratuito?.vagas).toBe(2)
  expect(doGratuito?.vagas_livres).toBe(2)
  expect(doGratuito?.gratuito).toBe(true)
  const detalhe = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/${idGratuito}`)
  ).json()) as { perguntas: Array<{ enunciado: string; obrigatoria: boolean }> }
  expect(detalhe.perguntas.map((p) => p.enunciado)).toEqual([
    'Como você soube da oficina?',
    'Alguma restrição alimentar?',
  ])
  expect(
    publicos.some(
      (e) => e.titulo === `${PREFIXO_COM_VALOR} ${S}` && e.gratuito === false,
    ),
  ).toBe(true)
  expect(vigia.problemas()).toEqual([])
})
