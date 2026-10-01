// Gera TODOS os arquivos derivados da logo institucional a partir do mestre
// (design/logo/asaf-logo-original.png, 2607x2160, fundo transparente) e distribui para o site e o
// painel. É a única forma de produzir esses arquivos — nunca editar os derivados à mão:
// trocou a logo, troca o mestre e roda `npm run logos` (na pasta site/).
//
// Por que raster derivado e não o SVG: o mestre vetorial não está no repositório, e para a web o
// derivado no tamanho certo pesa MUITO menos (o SVG exportado do CorelDRAW tem dezenas de KB só
// de caminhos). Se o SVG for adicionado em design/logo/, este script pode passar a usá-lo.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pastaLogo = path.join(raiz, 'design', 'logo')
const mestre = path.join(pastaLogo, 'asaf-logo-original.png')

const SITE = path.join(raiz, 'site', 'public')
const PAINEL = path.join(raiz, 'painel', 'public')
mkdirSync(SITE, { recursive: true })
mkdirSync(PAINEL, { recursive: true })

const BRANCO = { r: 255, g: 255, b: 255, alpha: 1 }
const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 }

/** Logo redimensionada pela largura, mantendo a transparência. */
function porLargura(largura) {
  return sharp(mestre).resize({ width: largura, kernel: 'lanczos3' })
}

/** Ícone quadrado: a logo (mais larga que alta) centralizada num quadrado, com respiro. */
function quadrado(lado, fundo, respiro = 0.04) {
  const miolo = Math.round(lado * (1 - respiro * 2))
  return sharp(mestre)
    .resize({
      width: miolo,
      height: miolo,
      fit: 'contain',
      background: TRANSPARENTE,
      kernel: 'lanczos3',
    })
    .extend({
      top: Math.floor((lado - miolo) / 2),
      bottom: Math.ceil((lado - miolo) / 2),
      left: Math.floor((lado - miolo) / 2),
      right: Math.ceil((lado - miolo) / 2),
      background: fundo,
    })
}

/** ICO com um único PNG embutido (formato aceito por todos os navegadores atuais). */
function empacotarIco(png, lado) {
  const cabecalho = Buffer.alloc(22)
  cabecalho.writeUInt16LE(0, 0) // reservado
  cabecalho.writeUInt16LE(1, 2) // tipo: ícone
  cabecalho.writeUInt16LE(1, 4) // 1 imagem
  cabecalho.writeUInt8(lado >= 256 ? 0 : lado, 6)
  cabecalho.writeUInt8(lado >= 256 ? 0 : lado, 7)
  cabecalho.writeUInt16LE(1, 10) // planos
  cabecalho.writeUInt16LE(32, 12) // bits por pixel
  cabecalho.writeUInt32LE(png.length, 14)
  cabecalho.writeUInt32LE(22, 18) // deslocamento dos dados
  return Buffer.concat([cabecalho, png])
}

const webp = { quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true }

// 1) Logo para a página: cabeçalho (160) e destaque da home (640).
await porLargura(160)
  .webp(webp)
  .toFile(path.join(pastaLogo, 'asaf-logo-160.webp'))
await porLargura(640)
  .webp(webp)
  .toFile(path.join(pastaLogo, 'asaf-logo-640.webp'))

// 2) PNG para dados estruturados (schema.org Organization.logo) e quem não lê WebP.
await porLargura(600)
  .png({ compressionLevel: 9 })
  .toFile(path.join(pastaLogo, 'asaf-logo-600.png'))

// 3) Ícones: favicon e ícone de aplicativo.
await quadrado(48, TRANSPARENTE, 0.02)
  .png()
  .toFile(path.join(pastaLogo, 'icon-48.png'))
await quadrado(192, TRANSPARENTE, 0.03)
  .png()
  .toFile(path.join(pastaLogo, 'icon-192.png'))
await quadrado(512, TRANSPARENTE, 0.03)
  .png()
  .toFile(path.join(pastaLogo, 'icon-512.png'))
// iOS não aceita transparência no ícone da tela inicial: fundo branco.
await quadrado(180, BRANCO, 0.08)
  .png()
  .toFile(path.join(pastaLogo, 'apple-touch-icon.png'))
writeFileSync(
  path.join(pastaLogo, 'favicon.ico'),
  empacotarIco(await quadrado(48, TRANSPARENTE, 0.02).png().toBuffer(), 48),
)

// 4) Distribuição: o que cada projeto serve em /public.
const paraSite = [
  'asaf-logo-160.webp',
  'asaf-logo-640.webp',
  'asaf-logo-600.png',
  'icon-48.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'favicon.ico',
]
const paraPainel = [
  'asaf-logo-160.webp',
  'asaf-logo-600.png',
  'icon-48.png',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'favicon.ico',
]
for (const arquivo of paraSite)
  copyFileSync(path.join(pastaLogo, arquivo), path.join(SITE, arquivo))
for (const arquivo of paraPainel)
  copyFileSync(path.join(pastaLogo, arquivo), path.join(PAINEL, arquivo))

console.log(
  'Logos geradas em design/logo/ e distribuídas para site/public e painel/public.',
)
