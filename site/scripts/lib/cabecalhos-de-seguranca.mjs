// Cabeçalhos de segurança do site (v5.7) e o `security.txt`. Funções PURAS, testadas em tests/cabecalhos-de-seguranca.test.ts; quem as liga ao build é a integração de
// astro.config.mjs (`astro:build:done`), que escreve o resultado dentro de `dist` — por isso valem igual em produção, na homologação e no build de teste, cada um com a SUA API.
//
// O site é estático: só carrega arquivos dele mesmo (`/_astro/*`, `/midia/*`) e fala com a API (listas ao vivo, formulários, fotos de evento). Não tem script nem estilo escrito dentro
// da página, nem fonte, nem mapa, nem anúncio de terceiro: por isso a política pode ser fechada ("tudo só de si mesmo e da API"). Se uma página nova precisar de algo de fora, o teste
// de navegador (e2e/seguranca.spec.ts) acusa a violação ANTES de publicar, e a política é ampliada de propósito, nunca por tentativa.

/** A API pública quando nenhuma `PUBLIC_API_URL` é dada — o mesmo padrão de `src/config/organizacao.ts`. */
export const API_PADRAO = 'https://api.asaf.org.br'

/** Só a origem (esquema + servidor + porta) de uma URL: é o que a política precisa saber da API. */
export function origemDe(url) {
  return new URL(url).origin
}

/** A política de conteúdo (CSP) do site, para a API `urlDaApi`. */
export function politicaDeConteudo(urlDaApi = API_PADRAO) {
  const api = origemDe(urlDaApi)
  const diretivas = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${api}`,
    "font-src 'self'",
    `connect-src 'self' ${api}`,
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]
  // só faz sentido (e só funciona) quando a API também é https: o build de teste usa a API simulada em http://127.0.0.1
  if (api.startsWith('https://')) diretivas.push('upgrade-insecure-requests')
  return diretivas.join('; ')
}

/** Os cabeçalhos de resposta que o Static Web App passa a mandar em TODA resposta do site (`globalHeaders`). */
export function cabecalhosDeSeguranca(urlDaApi = API_PADRAO) {
  return {
    'Content-Security-Policy': politicaDeConteudo(urlDaApi),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy':
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
}

/** A configuração do Static Web App (`staticwebapp.config.json`) com os cabeçalhos de segurança por cima; o que já estava nela (rotas, 404) é mantido. */
export function configComCabecalhos(base, urlDaApi = API_PADRAO) {
  return {
    ...base,
    globalHeaders: {
      ...(base.globalHeaders ?? {}),
      ...cabecalhosDeSeguranca(urlDaApi),
    },
  }
}

/** Dias de validade do `security.txt` (a RFC 9116 pede menos de um ano). */
export const VALIDADE_DO_SECURITY_TXT_EM_DIAS = 330

/**
 * O `/.well-known/security.txt` (RFC 9116): para onde vai quem achar um problema de segurança. O contato é o que o site já publica (e-mail e página de Contato); a data de
 * validade é recalculada a cada publicação do site, então só vence se o site ficar quase um ano sem ser publicado.
 */
export function securityTxt({ email, urlDoSite, agora = new Date() }) {
  const validade = new Date(
    agora.getTime() + VALIDADE_DO_SECURITY_TXT_EM_DIAS * 86_400_000,
  )
  const semMilissegundos = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
  return [
    `Contact: mailto:${email}`,
    `Contact: ${urlDoSite}/contato/`,
    `Expires: ${semMilissegundos(validade)}`,
    'Preferred-Languages: pt-BR',
    `Canonical: ${urlDoSite}/.well-known/security.txt`,
    '',
  ].join('\n')
}
