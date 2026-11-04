import sharp from 'sharp'

import { baixarFotoDaTransparencia } from '../../scripts/lib/conteudo-publico.mjs'

/**
 * v9.2c - as FOTOS LEVES do site: de cada foto de evento, de etapa de parceria e da Diretoria (que a API entrega em JPEG de até 2.000 px), o build gera
 * também duas versões WebP, de 640 e de 1.280 px de largura. A página oferece as duas ao navegador (`<picture>`, componente FotoLeve.astro), que baixa a do
 * tamanho da tela: no celular, a de 640 px, uma fração do JPEG. O JPEG original continua no mesmo endereço, de reserva para navegador antigo.
 */
export const LARGURAS = [640, 1280] as const
export type Largura = (typeof LARGURAS)[number]

/** /midia/eventos/12.jpg -> /midia/eventos/12-640.webp */
export function variante(caminhoJpg: string, largura: Largura): string {
  return caminhoJpg.replace(/\.jpg$/, `-${largura}.webp`)
}

/**
 * O `srcset` das versões leves, cada uma com a largura que TEM: de uma foto de 2.000 px, "…-640.webp 640w, …-1280.webp 1280w"; de uma de 900 px,
 * "…-640.webp 640w, …-1280.webp 900w" (a de 1.280 não aumenta a foto); de uma de 300 px, só "…-640.webp 300w" (as duas seriam iguais). Anunciar uma largura
 * que o arquivo não tem faz o navegador calcular o tamanho errado.
 */
export function srcsetLeve(
  caminhoJpg: string,
  larguraOriginal: number,
): string {
  const vistas = new Set<number>()
  const candidatas: string[] = []
  for (const l of LARGURAS) {
    const real = Math.min(l, larguraOriginal)
    if (vistas.has(real)) continue
    vistas.add(real)
    candidatas.push(`${variante(caminhoJpg, l)} ${real}w`)
  }
  return candidatas.join(', ')
}

/** A versão leve: largura máxima, sem aumentar foto menor, sem nenhum dado da câmera (o WebP sai limpo), girada conforme a câmera indicou. */
export async function paraWebp(
  bytes: Uint8Array,
  largura: Largura,
): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({ width: largura, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
}

// a mesma foto vira 3 arquivos (o JPEG e as duas versões): baixada da API uma vez só por build, conferida (JPEG e SHA-256) nessa vez
const jaBaixadas = new Map<number, Promise<Buffer>>()

export function baixarUmaVez(
  apiUrl: string,
  foto: { id_foto: number; sha256: string; arquivo: string },
  opcoes: { descricao?: string } = {},
): Promise<Buffer> {
  const chave = foto.id_foto
  if (!jaBaixadas.has(chave))
    jaBaixadas.set(chave, baixarFotoDaTransparencia(apiUrl, foto, opcoes))
  return jaBaixadas.get(chave)!
}
