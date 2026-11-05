import { test } from '@playwright/test'

import { exigirHomologacao } from './apoio'
import { NOTEBOOK, varrer } from './usabilidade'

// v9.3b - USABILIDADE NO NOTEBOOK (pedido do Presidente, 05/11: "se é comprido no telefone, no notebook já é grande demais"): a mesma varredura do
// celular (./usabilidade.ts) num notebook comum de 1366 × 768 (660 px de altura útil no navegador), com o print de cada tela e quantas alturas de tela
// cada página tem.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.use({ viewport: { width: NOTEBOOK.largura, height: NOTEBOOK.altura } })

test('todas as telas do painel num notebook de 1366 px: nada rola de lado, nada cortado, título na primeira tela, e quantas alturas cada tela tem', async ({
  page,
}, info) => {
  await varrer(page, info, NOTEBOOK)
})
