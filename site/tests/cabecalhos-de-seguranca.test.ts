import { describe, expect, it } from 'vitest'

import {
  API_PADRAO,
  VALIDADE_DO_SECURITY_TXT_EM_DIAS,
  cabecalhosDeSeguranca,
  configComCabecalhos,
  origemDe,
  politicaDeConteudo,
  securityTxt,
} from '../scripts/lib/cabecalhos-de-seguranca.mjs'
import { API_URL } from '../src/config/organizacao'

function diretivas(politica: string): Record<string, string[]> {
  return Object.fromEntries(
    politica.split('; ').map((d) => {
      const [nome, ...valores] = d.split(' ')
      return [nome!, valores]
    }),
  )
}

describe('a política de conteúdo (CSP)', () => {
  const p = diretivas(politicaDeConteudo('https://api.asaf.org.br'))

  it('começa fechada: nada de fora, a não ser o que cada diretiva libera', () => {
    expect(p['default-src']).toEqual(["'none'"])
  })

  it('script e estilo só do próprio site: nada escrito dentro da página, nada de terceiro', () => {
    expect(p['script-src']).toEqual(["'self'"])
    expect(p['style-src']).toEqual(["'self'"])
    for (const nome of ['script-src', 'style-src', 'default-src']) {
      expect(p[nome]).not.toContain("'unsafe-inline'")
      expect(p[nome]).not.toContain("'unsafe-eval'")
      expect(p[nome]).not.toContain('*')
    }
  })

  it('só a API da própria associação entra nas chamadas e nas imagens (fotos de evento)', () => {
    expect(p['connect-src']).toEqual(["'self'", 'https://api.asaf.org.br'])
    expect(p['img-src']).toEqual(["'self'", 'data:', 'https://api.asaf.org.br'])
  })

  it('ninguém embute o site, nenhum plugin, nenhuma base trocada', () => {
    expect(p['frame-ancestors']).toEqual(["'none'"])
    expect(p['object-src']).toEqual(["'none'"])
    expect(p['base-uri']).toEqual(["'none'"])
    expect(p['form-action']).toEqual(["'self'"])
  })

  it('manda subir para https quando a API é https', () => {
    expect(p['upgrade-insecure-requests']).toEqual([])
  })

  it('cada ambiente tem a SUA API: a homologação libera a dela e não a de produção', () => {
    const hml = diretivas(politicaDeConteudo('https://hml-api.asaf.org.br'))
    expect(hml['connect-src']).toEqual([
      "'self'",
      'https://hml-api.asaf.org.br',
    ])
    expect(politicaDeConteudo('https://hml-api.asaf.org.br')).not.toContain(
      'https://api.asaf.org.br',
    )
  })

  it('no build de teste (API simulada em http) não manda subir para https, senão nada carregaria', () => {
    const teste = politicaDeConteudo('http://127.0.0.1:4322/')
    expect(teste).toContain("connect-src 'self' http://127.0.0.1:4322;")
    expect(teste).not.toContain('upgrade-insecure-requests')
  })

  it('o padrão é a API de produção, a mesma que o site usa quando ninguém configura outra', () => {
    expect(API_PADRAO).toBe(API_URL)
    expect(politicaDeConteudo()).toBe(politicaDeConteudo(API_PADRAO))
  })
})

describe('os cabeçalhos de segurança', () => {
  const c = cabecalhosDeSeguranca('https://api.asaf.org.br')

  it('trazem os cinco que o plano pede e os valores certos', () => {
    expect(c['X-Frame-Options']).toBe('DENY')
    expect(c['X-Content-Type-Options']).toBe('nosniff')
    expect(c['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(c['Content-Security-Policy']).toBe(
      politicaDeConteudo('https://api.asaf.org.br'),
    )
  })

  it('a política de permissões desliga câmera, microfone, localização e pagamento (o site não usa nenhum)', () => {
    for (const recurso of ['camera', 'microphone', 'geolocation', 'payment']) {
      expect(c['Permissions-Policy']).toContain(`${recurso}=()`)
    }
  })
})

describe('configComCabecalhos', () => {
  const base = {
    responseOverrides: { '404': { rewrite: '/404.html', statusCode: 404 } },
    routes: [
      { route: '/version.json', headers: { 'cache-control': 'no-store' } },
    ],
  }

  it('mantém as rotas e a página 404 que já existiam e acrescenta os cabeçalhos globais', () => {
    const config = configComCabecalhos(base, 'https://api.asaf.org.br')
    expect(config.responseOverrides).toEqual(base.responseOverrides)
    expect(config.routes).toEqual(base.routes)
    expect(config.globalHeaders['Content-Security-Policy']).toContain(
      "default-src 'none'",
    )
  })

  it('não mexe na configuração original e respeita cabeçalho global que já existia', () => {
    const comUm = { ...base, globalHeaders: { 'X-Outro': '1' } }
    const config = configComCabecalhos(comUm, 'https://api.asaf.org.br')
    expect(config.globalHeaders['X-Outro']).toBe('1')
    expect(comUm.globalHeaders).toEqual({ 'X-Outro': '1' })
    expect((base as Record<string, unknown>).globalHeaders).toBeUndefined()
  })

  it('a configuração que o site publica de fato (public/) não traz cabeçalho próprio: quem os põe é o build', async () => {
    const { default: publicada } =
      await import('../public/staticwebapp.config.json')
    expect((publicada as Record<string, unknown>).globalHeaders).toBeUndefined()
  })
})

describe('origemDe', () => {
  it('fica só com esquema, servidor e porta', () => {
    expect(origemDe('https://api.asaf.org.br/api/publico/eventos')).toBe(
      'https://api.asaf.org.br',
    )
    expect(origemDe('http://127.0.0.1:4322/x?y=1')).toBe(
      'http://127.0.0.1:4322',
    )
  })
})

describe('security.txt (RFC 9116)', () => {
  const agora = new Date('2026-10-15T12:00:00.000Z')
  const texto = securityTxt({
    email: 'asaf@asaf.org.br',
    urlDoSite: 'https://asaf.org.br',
    agora,
  })

  it('tem o contato (e-mail e página de Contato), a validade, o idioma e o endereço canônico', () => {
    const linhas = texto.trim().split('\n')
    expect(linhas).toContain('Contact: mailto:asaf@asaf.org.br')
    expect(linhas).toContain('Contact: https://asaf.org.br/contato/')
    expect(linhas).toContain('Preferred-Languages: pt-BR')
    expect(linhas).toContain(
      'Canonical: https://asaf.org.br/.well-known/security.txt',
    )
    expect(texto.endsWith('\n')).toBe(true)
  })

  it('a validade fica no futuro e a menos de um ano, no formato ISO sem milissegundos', () => {
    const linha = texto.split('\n').find((l) => l.startsWith('Expires: '))!
    const data = linha.replace('Expires: ', '')
    expect(data).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    const dias = (new Date(data).getTime() - agora.getTime()) / 86_400_000
    expect(dias).toBeGreaterThan(300)
    expect(dias).toBeLessThan(365)
    expect(Math.round(dias)).toBe(VALIDADE_DO_SECURITY_TXT_EM_DIAS)
  })
})
