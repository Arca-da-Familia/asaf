// v9.5k - o desenho da credencial (o criador de credencial): as mesmas regras do servidor (app/services/modelo_credencial.py), para a tela avisar
// ENQUANTO a pessoa arrasta, antes de guardar. O servidor confere de novo e recusa o que não cumpre.
//
// O cartão tem 85,6 × 54 mm. Cada parte tem lugar e tamanho em milímetros (x e y a partir do canto de cima, à esquerda). As faixas ficam sempre por
// baixo; as outras partes, por cima, na ordem da lista. A situação NÃO é parte do cartão (ela muda; quem lê o QR vê a de agora), nem CPF, endereço
// ou telefone.

export const LARGURA_MM = 85.6
export const ALTURA_MM = 54
export const QR_MINIMO_MM = 18
export const LADO_MINIMO_MM = 2
export const LETRA_MINIMA = 5
export const LETRA_MAXIMA = 24
export const CONTRASTE_MINIMO = 4.5
export const MAXIMO_DE_TEXTO = 60
const FOLGA = 0.01

export type TipoDeParte =
  | 'faixa'
  | 'logo'
  | 'foto'
  | 'nome'
  | 'matricula'
  | 'categoria'
  | 'desde'
  | 'qr'
  | 'texto'

export type Parte = {
  id: string
  tipo: TipoDeParte
  x: number
  y: number
  largura: number
  altura: number
  tamanho?: number
  negrito?: boolean
  alinhamento?: 'esquerda' | 'centro' | 'direita'
  cor?: string
  texto?: string
  forma?: 'retangulo' | 'redonda'
}

export type Desenho = { fundo: string; partes: Parte[] }

export const COM_LETRA: ReadonlySet<TipoDeParte> = new Set([
  'nome',
  'matricula',
  'categoria',
  'desde',
  'texto',
])
const NO_MAXIMO_UMA: TipoDeParte[] = [
  'logo',
  'foto',
  'nome',
  'matricula',
  'categoria',
  'desde',
  'qr',
]
export const LIMITE: Partial<Record<TipoDeParte, number>> = {
  faixa: 3,
  texto: 4,
}
export const OBRIGATORIAS: TipoDeParte[] = ['nome', 'qr']
export const NOME_DA_PARTE: Record<TipoDeParte, string> = {
  faixa: 'Faixa',
  logo: 'Logo da ASAF',
  foto: 'Foto',
  nome: 'Nome',
  matricula: 'Matrícula',
  categoria: 'Categoria',
  desde: 'Associado desde',
  qr: 'QR de conferência',
  texto: 'Texto',
}

/** Quantas partes deste tipo o cartão aceita (1 para as de dado, 3 faixas, 4 textos). */
export function limiteDe(tipo: TipoDeParte): number {
  return LIMITE[tipo] ?? 1
}

export function nomeDaParte(p: Parte): string {
  if (p.tipo !== 'texto') return NOME_DA_PARTE[p.tipo]
  const t = (p.texto ?? '').trim()
  return t ? `Texto "${t.slice(0, 20)}"` : 'Texto'
}

function luminancia(cor: string): number {
  const canal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = parseInt(cor.slice(1, 3), 16)
  const g = parseInt(cor.slice(3, 5), 16)
  const b = parseInt(cor.slice(5, 7), 16)
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** A razão de contraste (WCAG) entre duas cores #rrggbb: de 1 (igual) a 21 (preto no branco). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** A letra que se lê melhor sobre uma cor: branca ou preta (com essas duas, o contraste é sempre de pelo menos 4,58 : 1). */
export function letraSobre(fundo: string): string {
  return contraste('#ffffff', fundo) >= contraste('#000000', fundo)
    ? '#ffffff'
    : '#000000'
}

function sobrepoe(a: Parte, b: Parte): boolean {
  return (
    a.x < b.x + b.largura - FOLGA &&
    b.x < a.x + a.largura - FOLGA &&
    a.y < b.y + b.altura - FOLGA &&
    b.y < a.y + a.altura - FOLGA
  )
}

function cobre(f: Parte, p: Parte): boolean {
  return (
    f.x <= p.x + FOLGA &&
    f.y <= p.y + FOLGA &&
    p.x + p.largura <= f.x + f.largura + FOLGA &&
    p.y + p.altura <= f.y + f.altura + FOLGA
  )
}

/** As cores que ficam atrás da parte: as faixas que encostam nela, a caixa branca do logo se encostar e, se nenhuma faixa a cobre inteira, o
 * fundo do cartão. */
export function coresAtras(d: Desenho, p: Parte): string[] {
  const faixas = d.partes.filter(
    (f) => f.tipo === 'faixa' && f.cor && sobrepoe(f, p),
  )
  const cores = faixas.map((f) => f.cor!.toLowerCase())
  if (!faixas.some((f) => cobre(f, p))) cores.push(d.fundo.toLowerCase())
  if (d.partes.some((o) => o.tipo === 'logo' && sobrepoe(o, p)))
    cores.push('#ffffff')
  return [...new Set(cores)]
}

// quebra de linha, tabulação, caracteres de controle e a marca invisível de início de texto (o servidor confere o mesmo)
function temControle(texto: string): boolean {
  for (const c of texto) {
    const n = c.charCodeAt(0)
    if (n < 32 || n === 127 || n === 0xfeff) return true
  }
  return false
}

export function numeroBR(v: number, casas = 1): string {
  return v.toFixed(casas).replace('.', ',')
}

export type Aviso = { idParte: string | null; texto: string }

/** Tudo o que impede o modelo de ser guardado (vazio = pode guardar). Mesmas frases do servidor. */
export function avisosDoDesenho(d: Desenho): Aviso[] {
  const avisos: Aviso[] = []
  const conta = (t: TipoDeParte) => d.partes.filter((p) => p.tipo === t).length
  if (new Set(d.partes.map((p) => p.id)).size !== d.partes.length)
    avisos.push({
      idParte: null,
      texto: 'Duas partes com o mesmo identificador: recarregue o editor.',
    })
  for (const tipo of OBRIGATORIAS)
    if (conta(tipo) === 0)
      avisos.push({
        idParte: null,
        texto: `Falta a parte "${NOME_DA_PARTE[tipo]}": todo cartão tem o nome e o QR.`,
      })
  for (const tipo of NO_MAXIMO_UMA)
    if (conta(tipo) > 1)
      avisos.push({
        idParte: null,
        texto: `"${NOME_DA_PARTE[tipo]}" aparece mais de uma vez.`,
      })
  for (const [tipo, limite] of Object.entries(LIMITE) as [
    TipoDeParte,
    number,
  ][])
    if (conta(tipo) > limite)
      avisos.push({
        idParte: null,
        texto: `No máximo ${limite} partes "${NOME_DA_PARTE[tipo]}".`,
      })

  for (const p of d.partes) {
    const nome = nomeDaParte(p)
    const aviso = (texto: string) => avisos.push({ idParte: p.id, texto })
    if (p.largura < LADO_MINIMO_MM - FOLGA || p.altura < LADO_MINIMO_MM - FOLGA)
      aviso(
        `${nome}: pequeno demais (o mínimo é ${numeroBR(LADO_MINIMO_MM)} mm de lado).`,
      )
    if (
      p.x < -FOLGA ||
      p.y < -FOLGA ||
      p.x + p.largura > LARGURA_MM + FOLGA ||
      p.y + p.altura > ALTURA_MM + FOLGA
    )
      aviso(`${nome}: passa da borda do cartão.`)
    if (p.tipo === 'qr') {
      if (Math.abs(p.largura - p.altura) > 0.05)
        aviso('QR de conferência: tem de ser quadrado.')
      if (Math.min(p.largura, p.altura) < QR_MINIMO_MM - FOLGA)
        aviso(
          `QR de conferência: pequeno demais para o celular ler (o mínimo é ${numeroBR(QR_MINIMO_MM)} mm).`,
        )
      for (const outra of d.partes)
        if (outra !== p && outra.tipo !== 'faixa' && sobrepoe(p, outra))
          aviso(
            `${outra.tipo === 'texto' ? 'Um texto' : NOME_DA_PARTE[outra.tipo]} está em cima do QR: o celular não lê.`,
          )
    }
    if (p.tipo === 'faixa' && !p.cor) aviso('Faixa sem cor.')
    if (p.tipo === 'texto') {
      const original = p.texto ?? ''
      const t = original.trim()
      if (temControle(original))
        aviso('Texto com quebra de linha, tabulação ou caractere de controle.')
      else if (!t) aviso('Texto vazio: escreva ou tire a parte.')
      else if (t.length > MAXIMO_DE_TEXTO)
        aviso(`Texto com mais de ${MAXIMO_DE_TEXTO} letras.`)
    }
    if (
      COM_LETRA.has(p.tipo) &&
      d.partes.some((o) => o.tipo === 'foto' && sobrepoe(o, p))
    )
      aviso(`${nome} está em cima da foto: não dá para ler.`)
    if (COM_LETRA.has(p.tipo)) {
      const t = p.tamanho ?? 0
      if (t < LETRA_MINIMA - FOLGA || t > LETRA_MAXIMA + FOLGA)
        aviso(
          `${nome}: a letra vai de ${numeroBR(LETRA_MINIMA)} a ${numeroBR(LETRA_MAXIMA)} pontos.`,
        )
      if (!p.cor) aviso(`${nome}: sem cor de letra.`)
      else {
        for (const atras of coresAtras(d, p)) {
          const razao = contraste(p.cor, atras)
          if (razao < CONTRASTE_MINIMO) {
            aviso(
              `${nome}: contraste ${numeroBR(razao)} : 1 com o que fica atrás (o mínimo é ${numeroBR(CONTRASTE_MINIMO)} : 1); escolha outra cor.`,
            )
            break
          }
        }
      }
    }
  }
  const vistos = new Set<string>()
  return avisos.filter((a) => {
    const chave = `${a.idParte}|${a.texto}`
    if (vistos.has(chave)) return false
    vistos.add(chave)
    return true
  })
}

/** Um id que ainda não existe no desenho. */
export function idNovo(d: Desenho, tipo: TipoDeParte): string {
  for (let i = 1; ; i++) {
    const id = `${tipo}-${i}`
    if (!d.partes.some((p) => p.id === id)) return id
  }
}

/** A parte nova, num lugar livre e num tamanho que cabem no cartão (a pessoa arrasta depois). */
/** O primeiro lugar do cartão onde a parte nova não encosta em nenhuma outra (nem em faixa); sem lugar livre, perto do canto de baixo. */
function lugarLivre(
  d: Desenho,
  largura: number,
  altura: number,
): { x: number; y: number } {
  for (let y = 2; y + altura <= ALTURA_MM - 1; y += 1)
    for (let x = 2; x + largura <= LARGURA_MM - 1; x += 1) {
      const caixa: Parte = { id: '', tipo: 'texto', x, y, largura, altura }
      if (!d.partes.some((o) => sobrepoe(o, caixa))) return { x, y }
    }
  return { x: 4, y: Math.max(0, ALTURA_MM - altura - 2) }
}

export function parteNova(d: Desenho, tipo: TipoDeParte): Parte {
  const nova = parteNovaNoCanto(d, tipo)
  if (tipo === 'faixa') return nova
  return { ...nova, ...lugarLivre(d, nova.largura, nova.altura) }
}

function parteNovaNoCanto(d: Desenho, tipo: TipoDeParte): Parte {
  const id = idNovo(d, tipo)
  const tinta = '#0b1611'
  const base = { id, tipo, x: 4, y: 40 }
  switch (tipo) {
    case 'faixa':
      return {
        ...base,
        x: 0,
        y: 0,
        largura: LARGURA_MM,
        altura: 6,
        cor: '#14532d',
      }
    case 'logo':
      return { ...base, largura: 8, altura: 7 }
    case 'foto':
      return { ...base, y: 14, largura: 20, altura: 26, forma: 'retangulo' }
    case 'qr':
      return { ...base, x: 62, y: 14, largura: 20, altura: 20 }
    case 'texto':
      return {
        ...base,
        largura: 40,
        altura: 4,
        tamanho: 7,
        cor: tinta,
        texto: 'Texto novo',
      }
    case 'nome':
      return {
        ...base,
        largura: 40,
        altura: 9,
        tamanho: 9,
        negrito: true,
        cor: tinta,
      }
    default:
      return { ...base, largura: 34, altura: 3.8, tamanho: 7.5, cor: tinta }
  }
}

/** As cores prontas da faixa: a cor e a letra que se lê sobre ela. */
export const CORES_PRONTAS: { nome: string; faixa: string; letra: string }[] = [
  { nome: 'Verde', faixa: '#14532d', letra: '#ffffff' },
  { nome: 'Azul', faixa: '#0a5a84', letra: '#ffffff' },
  { nome: 'Grafite', faixa: '#1f2a24', letra: '#ffffff' },
  { nome: 'Ouro', faixa: '#e3c435', letra: '#1c1a08' },
]

/** Troca a cor de todas as faixas e a letra dos textos que ficam em cima delas. */
export function aplicarCorPronta(
  d: Desenho,
  cor: { faixa: string; letra: string },
): Desenho {
  const faixas = d.partes.filter((p) => p.tipo === 'faixa')
  return {
    ...d,
    partes: d.partes.map((p) => {
      if (p.tipo === 'faixa') return { ...p, cor: cor.faixa }
      if (
        COM_LETRA.has(p.tipo) &&
        faixas.some(
          (f) =>
            f.x <= p.x + FOLGA &&
            f.y <= p.y + FOLGA &&
            p.x + p.largura <= f.x + f.largura + FOLGA &&
            p.y + p.altura <= f.y + f.altura + FOLGA,
        )
      )
        return { ...p, cor: cor.letra }
      return p
    }),
  }
}

/** A cor do cabeçalho da carteirinha no celular: a da primeira faixa (ou o verde da ASAF). */
export function corDoCabecalho(d: Desenho | null | undefined): string {
  return d?.partes.find((p) => p.tipo === 'faixa')?.cor ?? '#14532d'
}

/** O que aparece em cada parte de dado, para uma pessoa (ou o exemplo do criador). */
export type DadosDoCartao = {
  nome: string
  matricula: number | null
  categoria: string | null
  desde: string | null // mm/aaaa
  foto: string | null // endereço já pronto para <img>
  qr: string // o endereço que o QR abre
}

export const EXEMPLO: DadosDoCartao = {
  nome: 'Maria das Graças de Exemplo',
  matricula: 123,
  categoria: 'Efetivo',
  desde: '03/2019',
  foto: null,
  qr: 'https://painel.asaf.org.br/credencial/exemplo-do-criador',
}
