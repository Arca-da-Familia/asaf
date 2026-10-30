// v7.3b - Cabeçalhos de segurança do painel. Funções PURAS, testadas em src/test/cabecalhos-de-seguranca.test.ts; quem as liga ao build é o plugin de vite.config.ts
// (`closeBundle`), que escreve o resultado dentro de `dist/staticwebapp.config.json` - por isso valem igual em produção e na homologação, cada um com a SUA API.
//
// O painel só carrega arquivos dele mesmo (`/assets/*`) e fala com a API. O único script escrito dentro da página é o do tema (index.html), liberado pelo seu
// resumo (sha256), nunca por 'unsafe-inline'. O estilo aceita 'unsafe-inline' de propósito: bibliotecas da interface (avisos, gráficos) injetam <style> e
// atributos de estilo, e estilo não executa código. Fotos e PDFs abertos dentro do painel chegam por `blob:` (baixados com a sessão); o QR é desenhado no
// próprio navegador. A câmera fica liberada só para o próprio painel (a portaria lê o QR) e as chaves de acesso (passkey) também.
import { createHash } from 'node:crypto'

/** A API quando nenhuma `VITE_API_URL` é dada - o mesmo padrão de src/lib/api.ts. */
export const API_PADRAO = 'https://api.asaf.org.br'

export function origemDe(url) {
  return new URL(url).origin
}

/** O resumo (sha256, base64) de cada `<script>` escrito dentro do HTML, no formato da CSP. */
export function resumosDosScriptsInline(html) {
  const resumos = []
  for (const m of html.matchAll(
    /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    resumos.push(
      `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`,
    )
  }
  return resumos
}

/** A política de conteúdo (CSP) do painel, para a API `urlDaApi` e os scripts inline `resumos`. */
export function politicaDeConteudo(urlDaApi = API_PADRAO, resumos = []) {
  const api = origemDe(urlDaApi)
  const diretivas = [
    "default-src 'none'",
    ["script-src 'self'", ...resumos].join(' '),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${api}`,
    "font-src 'self' data:",
    `connect-src 'self' ${api}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ]
  if (api.startsWith('https://')) diretivas.push('upgrade-insecure-requests')
  return diretivas.join('; ')
}

export function cabecalhosDeSeguranca(urlDaApi = API_PADRAO, resumos = []) {
  return {
    'Content-Security-Policy': politicaDeConteudo(urlDaApi, resumos),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy':
      'accelerometer=(), camera=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), ' +
      'publickey-credentials-get=(self), publickey-credentials-create=(self)',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
}

/** A configuração do Static Web App com os cabeçalhos por cima; o que já estava nela (a navegação da página única) é mantido. */
export function configComCabecalhos(base, urlDaApi = API_PADRAO, resumos = []) {
  return {
    ...base,
    globalHeaders: {
      ...(base.globalHeaders ?? {}),
      ...cabecalhosDeSeguranca(urlDaApi, resumos),
    },
  }
}
