import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// v9.2a - quanto tempo o navegador guarda cada arquivo do painel (public/staticwebapp.config.json, que o Static Web App lê). Os pedaços em /assets/ têm o
// conteúdo no nome (mudou o código, mudou o nome): podem ficar guardados um ano, e quem volta ao painel no celular não baixa tudo de novo. O index.html e o
// version.json NUNCA ficam velhos: são eles que apontam para a versão nova (e o aviso "nova versão disponível" lê o version.json).
const config = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), 'public/staticwebapp.config.json'),
    'utf-8',
  ),
) as { routes: Array<{ route: string; headers: Record<string, string> }> }

const cache = (rota: string) =>
  config.routes.find((r) => r.route === rota)?.headers['cache-control']

describe('cache dos arquivos do painel (v9.2a)', () => {
  it('os pedaços com o conteúdo no nome ficam guardados um ano', () => {
    expect(cache('/assets/*')).toBe('public, max-age=31536000, immutable')
  })
  it('o index.html e o version.json nunca ficam velhos', () => {
    expect(cache('/index.html')).toBe('no-cache')
    expect(cache('/version.json')).toBe('no-store')
  })
})
