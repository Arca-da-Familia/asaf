import { existsSync, readFileSync } from 'node:fs'

/**
 * Trava de segurança: o e2e só faz sentido contra o build de TESTE (ilha apontando para a API
 * simulada). Se alguém rodar `npm run build` (produção) e depois `test:e2e`, os testes
 * bateriam na API real — falhariam por motivo errado ou, pior, passariam dependendo dela.
 */
export default function globalSetup() {
  if (!existsSync('dist/index.html')) {
    throw new Error(
      'dist/ não existe. Rode `npm run build:teste` antes do e2e.',
    )
  }
  const html = readFileSync('dist/index.html', 'utf-8')
  const portaDoMock = process.env.MOCK_API_PORT ?? '4322'
  if (!html.includes(`data-api-url="http://127.0.0.1:${portaDoMock}"`)) {
    throw new Error(
      'dist/ foi gerado com a API de produção. Rode `npm run build:teste` (ilha de eventos ' +
        'apontando para a API simulada) antes do e2e.',
    )
  }
}
