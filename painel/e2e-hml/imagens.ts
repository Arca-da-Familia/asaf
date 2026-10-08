// Imagem de teste montada no próprio roteiro, byte a byte (sem biblioteca e sem navegador): uma fotografia pequena (120x80) que traz ESCONDIDO dentro do arquivo o que um
// celular costuma gravar sem a pessoa ver: um bloco Exif com o nome do aparelho e a LOCALIZAÇÃO (GPS: 6° 4' 30" S, 49° 54' 0" W, que é Parauapebas) e um COMENTÁRIO do JPEG.
// Serve para provar que o servidor regrava a foto do evento e que o arquivo servido ao público não leva nada disso (app/services/fotos.py::tratar_imagem).
// A base (a imagem em si) foi gerada uma vez com o Pillow e conferida contra o próprio tratar_imagem do servidor; o que o roteiro monta é só o que vai por cima.

/** Texto único gravado no campo "fabricante" do Exif: se aparecer no arquivo servido ao público, o servidor deixou passar o metadado do aparelho. */
export const APARELHO_ESCONDIDO = 'ROBO-V54G-APARELHO-DE-TESTE'
/** Texto único gravado no comentário do JPEG (o lugar onde há programa que escreve texto livre). */
export const COMENTARIO_ESCONDIDO = 'ROBO-V54G-COMENTARIO-ESCONDIDO'

const BASE_JPEG = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoL',
  'Cw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABQAHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA',
  'AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6',
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx',
  '8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV',
  'YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE',
  'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnsUYp2KMV9fznhWG4oxTsUYo5wsNxRinYoxRzhYbijFOxRijnCw3FGKdijFHOFhuK',
  'MU7FGKOcLDcUYp2KMUc4WG4op2KKOcLD8UYqTFGK5Oc1sR4oxUmKMUc4WI8VLb2013cJBBGZJXOFUd6TFeheHdETSrMPLGPtco/eNnO0dlH6Z9/wrzMzzSOBo828nsv6',
  '6I6cNhnWnbp1Miw8DK0avqFy6sy8xRAZU/7xznj2/Gtj/hE9E/58v/Ir/wCNa9Ffn1fOMdWlzOq16O35fqe5DCUYKyivnqcte+BreTc9lcvEeSEkG5fYA9QPzrkrywud',
  'PuDBdRGKQAHB5yPUEcGvVqoazpMOr2LROo81QTC542t9fQ9//wBVerlvEVelNQxL5ovr1X+fnc5sRgISV6aszzDFGKmmheCZ4ZF2vGxVhnOCODTcV9+qiaujw+WxHijF',
  'SYoxRzhYjxRUmKKOcLD8UYp+KMVy85rYZijFPxRijnCxc0O0W81q1hfG0vuYFcghRuxj3xivSK888Pyrb67aOwJBfZx6sCo/U16HXw/EkpPEQT2t+N3f9D2MvSVN97hR',
  'RRXzJ6IUUUUAcF4stFt9cdkwBOgkwFxg8g/XJGfxrFxW/wCLpVl1vYoOYYlRs9zy3H4MKw8V+n5bOTwdPm3sv+B+B85iEvayt3GYoxT8UYrv5zGwzFFPxRRzhYfijFPx',
  'RiuTnNLDMUYp+KMUc4WGYr0LR9UTVLJZflWZeJUU/dP+B6//AKq4DFT2V5Pp9ytxbttcdQejD0PtXmZngljKVk7SW3+XzOnD1nRl5M9HorCsvFdnLGouw0EgX5iFypPt',
  'jJrU/tPT/wDn+tv+/q/418TVweIpS5ZwZ7EasJK6ZZqvqF9Fp9nJcSkfKPlUnG9uwFZ934n0+3ysTNcOMjCDjI9z29xmuU1HUrnVJxLcMPlGFReFX6V6GBymrWmnVXLH',
  '8WYVsVGCtHVlW4la5uJZ3ADSuXIHTJOajxT8UYr7hSSVkeM1cZijFPxRinzisMxRT8UUc4WMyiiivCOIKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z',
].join('')

// ------------------------------------------------------------------------------------------------------------------------ montagem do Exif
const TIPO_TEXTO = 2
const TIPO_LONGO = 4
const TIPO_RACIONAL = 5

type EntradaDoIfd = {
  tag: number
  tipo: number
  contagem: number
  /** Número = valor inline de 4 bytes (ex.: ponteiro); Buffer = o dado (vai inline se couber em 4 bytes, senão numa área logo depois do bloco). */
  valor: Buffer | number
}

/** Um bloco IFD do TIFF (little-endian), com a área de dados logo depois dele. `inicio` = posição do bloco dentro do TIFF (os endereços são relativos ao TIFF). */
function ifd(entradas: EntradaDoIfd[], inicio: number): Buffer {
  const tamanho = 2 + entradas.length * 12 + 4
  const bloco = Buffer.alloc(tamanho)
  bloco.writeUInt16LE(entradas.length, 0)
  const dados: Buffer[] = []
  let usado = 0
  entradas.forEach((entrada, i) => {
    const base = 2 + i * 12
    bloco.writeUInt16LE(entrada.tag, base)
    bloco.writeUInt16LE(entrada.tipo, base + 2)
    bloco.writeUInt32LE(entrada.contagem, base + 4)
    if (typeof entrada.valor === 'number') {
      bloco.writeUInt32LE(entrada.valor, base + 8)
    } else if (entrada.valor.length <= 4) {
      entrada.valor.copy(bloco, base + 8)
    } else {
      bloco.writeUInt32LE(inicio + tamanho + usado, base + 8)
      const alinhado =
        entrada.valor.length % 2 === 0
          ? entrada.valor
          : Buffer.concat([entrada.valor, Buffer.alloc(1)])
      dados.push(alinhado)
      usado += alinhado.length
    }
  })
  return Buffer.concat([bloco, ...dados])
}

/** Três racionais (graus, minutos, segundos), cada um como numerador/denominador. */
function racionais(valores: Array<[number, number]>): Buffer {
  const saida = Buffer.alloc(valores.length * 8)
  valores.forEach(([numerador, denominador], i) => {
    saida.writeUInt32LE(numerador, i * 8)
    saida.writeUInt32LE(denominador, i * 8 + 4)
  })
  return saida
}

const texto = (valor: string) => Buffer.from(`${valor}\0`, 'latin1')

/** O conteúdo do bloco APP1: "Exif" + um TIFF com o fabricante do aparelho (IFD0) e a localização (IFD de GPS). */
function exifComGps(): Buffer {
  const cabecalhoDoTiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
  ]) // "II", 42, o primeiro IFD começa no byte 8
  const montarIfd0 = (ponteiroDoGps: number) =>
    ifd(
      [
        {
          tag: 0x010f, // fabricante
          tipo: TIPO_TEXTO,
          contagem: texto(APARELHO_ESCONDIDO).length,
          valor: texto(APARELHO_ESCONDIDO),
        },
        { tag: 0x8825, tipo: TIPO_LONGO, contagem: 1, valor: ponteiroDoGps }, // GPSInfo
      ],
      cabecalhoDoTiff.length,
    )
  const inicioDoGps = cabecalhoDoTiff.length + montarIfd0(0).length
  const gps = ifd(
    [
      { tag: 0x0001, tipo: TIPO_TEXTO, contagem: 2, valor: texto('S') },
      {
        tag: 0x0002,
        tipo: TIPO_RACIONAL,
        contagem: 3,
        valor: racionais([
          [6, 1],
          [4, 1],
          [3000, 100],
        ]),
      },
      { tag: 0x0003, tipo: TIPO_TEXTO, contagem: 2, valor: texto('W') },
      {
        tag: 0x0004,
        tipo: TIPO_RACIONAL,
        contagem: 3,
        valor: racionais([
          [49, 1],
          [54, 1],
          [0, 1],
        ]),
      },
    ],
    inicioDoGps,
  )
  return Buffer.concat([
    Buffer.from('Exif\0\0', 'latin1'),
    cabecalhoDoTiff,
    montarIfd0(inicioDoGps),
    gps,
  ])
}

/** Um segmento do JPEG: FF, o marcador, o tamanho (que conta os 2 bytes dele) e o conteúdo. */
function segmento(marcador: number, conteudo: Buffer): Buffer {
  const cabecalho = Buffer.alloc(4)
  cabecalho.writeUInt8(0xff, 0)
  cabecalho.writeUInt8(marcador, 1)
  cabecalho.writeUInt16BE(conteudo.length + 2, 2)
  return Buffer.concat([cabecalho, conteudo])
}

/**
 * A foto de teste COM metadado escondido: o bloco Exif (aparelho + GPS) e o comentário do JPEG entram logo depois do início do arquivo, como num JPEG de celular.
 * É uma imagem de verdade (abre em qualquer visualizador) de 120x80.
 */
export function jpegComLocalizacao(): Buffer {
  const base = Buffer.from(BASE_JPEG, 'base64')
  return Buffer.concat([
    base.subarray(0, 2), // FF D8: começo do JPEG
    segmento(0xe1, exifComGps()),
    segmento(0xfe, Buffer.from(COMENTARIO_ESCONDIDO, 'latin1')),
    base.subarray(2),
  ])
}

// ------------------------------------------------------------------------------------------------------------------------ leitura
// Marcadores de início de quadro (SOF): trazem a altura e a largura. FF C4 (tabela), FF C8 e FF CC não são quadro.
const MARCADORES_DE_QUADRO = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/** Os marcadores do cabeçalho do JPEG (até o começo da imagem) e as dimensões. Lança erro se o arquivo não for um JPEG inteiro e coerente. */
export function lerJpeg(jpeg: Buffer): {
  marcadores: number[]
  largura: number
  altura: number
} {
  if (jpeg.length < 4 || jpeg.readUInt16BE(0) !== 0xffd8) {
    throw new Error('o arquivo não começa com FF D8: não é um JPEG')
  }
  const marcadores: number[] = []
  let largura = 0
  let altura = 0
  let posicao = 2
  while (posicao + 4 <= jpeg.length) {
    if (jpeg.readUInt8(posicao) !== 0xff) {
      throw new Error(`esperava um marcador de JPEG na posição ${posicao}`)
    }
    const marcador = jpeg.readUInt8(posicao + 1)
    if (marcador === 0xff) {
      posicao += 1 // byte de enchimento
      continue
    }
    marcadores.push(marcador)
    if (marcador === 0xda || marcador === 0xd9) break // daqui em diante é a imagem em si
    if (MARCADORES_DE_QUADRO.has(marcador)) {
      altura = jpeg.readUInt16BE(posicao + 5)
      largura = jpeg.readUInt16BE(posicao + 7)
    }
    posicao += 2 + jpeg.readUInt16BE(posicao + 2)
  }
  return { marcadores, largura, altura }
}

/** O que há no JPEG que carrega dado de fora da imagem: blocos APP1 a APP15 (Exif com GPS, XMP, perfil de cor...) e comentário. Lista vazia = imagem limpa. */
export function metadadosDoJpeg(jpeg: Buffer): string[] {
  return lerJpeg(jpeg)
    .marcadores.filter((m) => (m >= 0xe1 && m <= 0xef) || m === 0xfe)
    .map((m) =>
      m === 0xfe
        ? 'comentário do JPEG (FF FE)'
        : m === 0xe1
          ? 'bloco APP1 (Exif/GPS ou XMP)'
          : `bloco APP${m - 0xe0} (FF ${m.toString(16).toUpperCase()})`,
    )
}
