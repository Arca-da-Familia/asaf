import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  cabecalhosDeSeguranca,
  configComCabecalhos,
  politicaDeConteudo,
  resumosDosScriptsInline,
} from '../../scripts/cabecalhos-de-seguranca.mjs'

// v7.3b - os cabeçalhos de segurança do painel (escritos no build em dist/staticwebapp.config.json)
describe('cabeçalhos de segurança do painel', () => {
  it('a política só deixa carregar o próprio painel e a API; o script do tema entra pelo resumo, nunca por unsafe-inline', () => {
    const html = readFileSync('index.html', 'utf-8')
    const resumos = resumosDosScriptsInline(html)
    expect(resumos).toHaveLength(1)
    const tema = html.match(/<script>([\s\S]*?)<\/script>/)![1]!
    expect(resumos[0]).toBe(
      `'sha256-${createHash('sha256').update(tema, 'utf8').digest('base64')}'`,
    )
    const csp = politicaDeConteudo('https://hml-api.asaf.org.br/', resumos)
    expect(csp).toContain(`script-src 'self' ${resumos[0]}`)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).toContain("connect-src 'self' https://hml-api.asaf.org.br;")
    expect(csp).toContain(
      "img-src 'self' data: blob: https://hml-api.asaf.org.br",
    )
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(politicaDeConteudo('http://127.0.0.1:8000')).not.toContain(
      'upgrade-insecure-requests',
    )
  })

  it('a câmera (portaria) e as chaves de acesso ficam liberadas só para o próprio painel; o resto, fechado', () => {
    const c = cabecalhosDeSeguranca()
    expect(c['Permissions-Policy']).toContain('camera=(self)')
    expect(c['Permissions-Policy']).toContain(
      'publickey-credentials-get=(self)',
    )
    expect(c['Permissions-Policy']).toContain('geolocation=()')
    expect(c['X-Frame-Options']).toBe('DENY')
    expect(c['X-Content-Type-Options']).toBe('nosniff')
    expect(c['Content-Security-Policy']).toContain('https://api.asaf.org.br')
  })

  it('a configuração do Static Web App mantém a navegação da página única', () => {
    const base = JSON.parse(
      readFileSync('public/staticwebapp.config.json', 'utf-8'),
    ) as { navigationFallback: unknown }
    const config = configComCabecalhos(base)
    expect(config.navigationFallback).toEqual(base.navigationFallback)
    expect(config.globalHeaders['Content-Security-Policy']).toBeTruthy()
  })
})
