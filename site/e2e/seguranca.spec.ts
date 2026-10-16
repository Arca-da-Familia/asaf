import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { PAGINAS_NAO_INDEXAVEIS, caminhosIndexaveis } from './paginas'

// v5.7 — a CONFIANÇA do site: os cabeçalhos de segurança que o build escreve para o Azure, o `security.txt`, e a prova de que o site de verdade (cada página, no navegador de verdade)
// convive com a política de conteúdo (CSP). O servidor de teste (`astro preview`) manda os MESMOS cabeçalhos que o build publicou em `dist/staticwebapp.config.json` (ver
// `SITE_PREVIEW_COM_CABECALHOS` em astro.config.mjs e playwright.config.ts): por isso TODO teste de navegador do site já roda sob a política. Uma página que passasse a carregar
// algo de fora (script, estilo, fonte, imagem, mapa) é pega aqui, antes de publicar.

const PORTA_DA_API = process.env.MOCK_API_PORT ?? '4322'
const ORIGEM_DA_API = `http://127.0.0.1:${PORTA_DA_API}`
// a porta do servidor de teste do site (a mesma de playwright.config.ts): outra cópia do projeto pode ocupar a 4321
const ORIGEM_DO_SITE = `http://127.0.0.1:${process.env.PORTA_DO_SITE_DE_TESTE ?? '4321'}`

const cabecalhos = (
  JSON.parse(readFileSync('dist/staticwebapp.config.json', 'utf-8')) as {
    globalHeaders: Record<string, string>
  }
).globalHeaders

function arquivosHtml(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = path.join(pasta, nome)
    if (statSync(caminho).isDirectory()) return arquivosHtml(caminho)
    return caminho.endsWith('.html') ? [caminho] : []
  })
}

test.describe('o que o build publica', () => {
  test('os cabeçalhos de segurança estão na configuração do Static Web App, com a API deste build', () => {
    expect(Object.keys(cabecalhos).sort()).toEqual([
      'Content-Security-Policy',
      'Cross-Origin-Opener-Policy',
      'Permissions-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
    ])
    expect(cabecalhos['X-Frame-Options']).toBe('DENY')
    expect(cabecalhos['X-Content-Type-Options']).toBe('nosniff')
    const csp = cabecalhos['Content-Security-Policy']!
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain(`connect-src 'self' ${ORIGEM_DA_API}`)
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
  })

  test('nenhuma página tem script ou estilo escrito DENTRO dela (a política só deixa rodar o que vem de arquivo do site)', () => {
    const comProblema: string[] = []
    for (const arquivo of arquivosHtml('dist')) {
      const html = readFileSync(arquivo, 'utf-8')
      const scriptsDentro = [
        ...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
      ].filter(
        (m) => !/\bsrc=/.test(m[1]!) && !/application\/ld\+json/.test(m[1]!),
      )
      if (scriptsDentro.length > 0) comProblema.push(`${arquivo}: script`)
      if (/<style\b/.test(html)) comProblema.push(`${arquivo}: <style>`)
      if (/\sstyle="/.test(html)) comProblema.push(`${arquivo}: style=""`)
      if (/\son[a-z]+="/.test(html)) comProblema.push(`${arquivo}: on…=""`)
    }
    expect(comProblema).toEqual([])
  })

  test('o security.txt tem contato, validade no futuro e endereço canônico', () => {
    const texto = readFileSync('dist/.well-known/security.txt', 'utf-8')
    expect(texto).toContain('Contact: mailto:asaf@asaf.org.br')
    expect(texto).toContain('Contact: https://asaf.org.br/contato/')
    expect(texto).toContain(
      'Canonical: https://asaf.org.br/.well-known/security.txt',
    )
    const validade = /^Expires: (.+)$/m.exec(texto)?.[1]
    expect(validade).toBeTruthy()
    const dias = (new Date(validade!).getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(300)
    expect(dias).toBeLessThan(365)
  })

  test('a configuração publicada mantém a página 404 e as rotas de cache de antes', () => {
    const inteira = JSON.parse(
      readFileSync('dist/staticwebapp.config.json', 'utf-8'),
    ) as {
      responseOverrides: Record<string, { rewrite: string }>
      routes: Array<{ route: string }>
    }
    expect(inteira.responseOverrides['404']?.rewrite).toBe('/404.html')
    expect(inteira.routes.map((r) => r.route)).toEqual(
      expect.arrayContaining(['/_astro/*', '/version.json', '/conteudo.json']),
    )
  })
})

/** Vigia as violações da política (o navegador as anuncia no próprio documento). */
async function vigiarViolacoes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const violacoes: string[] = []
    ;(window as unknown as { __violacoes: string[] }).__violacoes = violacoes
    document.addEventListener('securitypolicyviolation', (e) => {
      violacoes.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'}`)
    })
  })
}

const violacoesDa = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __violacoes: string[] }).__violacoes,
  )

test.describe('o servidor de teste manda os cabeçalhos e a página não viola a política', () => {
  const caminhos = [...caminhosIndexaveis(), ...PAGINAS_NAO_INDEXAVEIS]
  for (const caminho of caminhos) {
    test(`${caminho}`, async ({ page }) => {
      const erros: string[] = []
      page.on('console', (m) => {
        if (
          m.type() === 'error' &&
          /Content Security Policy|Refused to/i.test(m.text())
        )
          erros.push(m.text())
      })
      await vigiarViolacoes(page)
      const resposta = await page.goto(caminho, { waitUntil: 'networkidle' })
      // o teste só vale se os cabeçalhos estão de fato na resposta (servidor de teste ligado do jeito certo)
      const recebidos = resposta!.headers()
      expect(recebidos['content-security-policy']).toBe(
        cabecalhos['Content-Security-Policy'],
      )
      expect(recebidos['x-frame-options']).toBe('DENY')
      expect(await violacoesDa(page)).toEqual([])
      expect(erros).toEqual([])
    })
  }
})

test.describe('sob a política, o que depende da API continua funcionando', () => {
  test('a agenda de eventos carrega a lista ao vivo', async ({ page }) => {
    await vigiarViolacoes(page)
    await page.goto('/eventos/', { waitUntil: 'networkidle' })
    await expect(
      page.locator('#eventos [data-eventos] li').first(),
    ).toBeVisible()
    expect(await violacoesDa(page)).toEqual([])
  })

  test('a página de quem tem o link da inscrição lê o resumo na API', async ({
    page,
  }) => {
    await vigiarViolacoes(page)
    await page.goto('/cancelar-inscricao/?token=fixo-evento-cancelado', {
      waitUntil: 'networkidle',
    })
    await expect(page.locator('[data-situacao]')).toBeVisible()
    expect(await violacoesDa(page)).toEqual([])
  })

  test('a política REALMENTE bloqueia o que não é do site (prova de que ela está valendo)', async ({
    page,
  }) => {
    await vigiarViolacoes(page)
    await page.goto('/contato/', { waitUntil: 'networkidle' })
    const resultado = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/', { mode: 'no-cors' })
        return 'passou'
      } catch {
        return 'bloqueado'
      }
    })
    expect(resultado).toBe('bloqueado')
    expect((await violacoesDa(page)).join(' ')).toContain('connect-src')
  })
})

test.describe('sem rastreamento: nenhum cookie, nenhum servidor de terceiro', () => {
  const caminhos = [...caminhosIndexaveis(), ...PAGINAS_NAO_INDEXAVEIS]
  for (const caminho of caminhos) {
    test(`${caminho}`, async ({ page, context }) => {
      const origensPermitidas = new Set([ORIGEM_DO_SITE, ORIGEM_DA_API])
      const deFora = new Set<string>()
      page.on('request', (r) => {
        const url = new URL(r.url())
        if (url.protocol === 'data:' || url.protocol === 'blob:') return
        if (!origensPermitidas.has(url.origin)) deFora.add(url.origin)
      })
      await page.goto(caminho, { waitUntil: 'networkidle' })
      expect([...deFora]).toEqual([])
      expect(await context.cookies()).toEqual([])
      expect(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
      ).toBe(0)
    })
  }
})
