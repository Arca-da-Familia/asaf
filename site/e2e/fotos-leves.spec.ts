import { expect, test } from '@playwright/test'

// v9.2c - as FOTOS LEVES: cada foto de evento, de etapa de parceria e da Diretoria vem com duas versões WebP (640 e 1.280 px) que o navegador escolhe pelo
// tamanho da tela; o JPEG original fica de reserva. Prova: a página oferece as duas, elas abrem como WebP e não são maiores que o JPEG; o navegador de
// celular carrega a de 640.
const PAGINAS = [
  { caminho: '/diretoria/', foto: 'img[data-foto-da-diretoria]' },
  { caminho: '/projetos/3/', foto: '[data-foto] img' },
  { caminho: '/transparencia/emendas/1/', foto: 'figure img' },
]

for (const { caminho, foto } of PAGINAS) {
  test(`fotos com versões leves — ${caminho}`, async ({ page, request }) => {
    await page.goto(caminho)
    const imagem = page.locator(foto).first()
    await expect(imagem).toBeVisible()
    const jpg = await imagem.getAttribute('src')
    expect(jpg).toMatch(/\.jpg$/)
    const fonte = page.locator('picture source[type="image/webp"]').first()
    // cada versão anunciada com a largura que TEM (as fotos de teste são pequenas: menos de 640 px, então só uma versão, com a largura real)
    const srcset = (await fonte.getAttribute('srcset')) ?? ''
    const larguraReal = Number(await imagem.getAttribute('width'))
    const base = jpg!.replace(/\.jpg$/, '')
    expect(srcset).toContain(`${base}-640.webp ${Math.min(640, larguraReal)}w`)
    if (larguraReal > 640)
      expect(srcset).toContain(
        `${base}-1280.webp ${Math.min(1280, larguraReal)}w`,
      )
    else expect(srcset).not.toContain('-1280.webp')
    expect(await fonte.getAttribute('sizes')).toBeTruthy()
    const original = await request.get(jpg!)
    for (const largura of [640, 1280]) {
      const leve = await request.get(jpg!.replace(/\.jpg$/, `-${largura}.webp`))
      expect(leve.status()).toBe(200)
      expect(leve.headers()['content-type']).toContain('image/webp')
      const corpo = await leve.body()
      expect(corpo.subarray(8, 12).toString('latin1')).toBe('WEBP')
      expect(corpo.length).toBeLessThanOrEqual((await original.body()).length)
    }
  })
}

test('no celular o navegador baixa a versão de 640 px, não o JPEG', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 })
  const baixadas: string[] = []
  page.on('requestfinished', (r) => {
    if (r.url().includes('/midia/diretoria/')) baixadas.push(r.url())
  })
  await page.goto('/diretoria/')
  await page.waitForLoadState('networkidle')
  expect(baixadas.length).toBeGreaterThan(0)
  expect(baixadas.every((u) => u.endsWith('-640.webp'))).toBe(true)
})
