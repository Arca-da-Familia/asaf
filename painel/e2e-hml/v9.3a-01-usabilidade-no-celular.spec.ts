import { test } from '@playwright/test'

import { exigirHomologacao } from './apoio'
import { CELULAR, varrer } from './usabilidade'

// v9.3a - USABILIDADE NO CELULAR (360 × 740, toque): a varredura e as medidas estão em ./usabilidade.ts.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.use({
  viewport: { width: CELULAR.largura, height: CELULAR.altura },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
})

test('todas as telas do painel num celular de 360 px: nada rola de lado, nada cortado, campos sem zoom do iPhone, título na primeira tela', async ({
  page,
}, info) => {
  await varrer(page, info, CELULAR)
})
