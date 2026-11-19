import { UserRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useLayoutEffect, useRef, type CSSProperties } from 'react'

import {
  ALTURA_MM,
  COM_LETRA,
  LARGURA_MM,
  LETRA_MINIMA,
  type DadosDoCartao,
  type Desenho,
  type Parte,
} from '@/lib/credencial-desenho'

// v9.5k - o cartão da credencial desenhado pelo MODELO em uso (o criador de credencial): a mesma peça na folha A4 das credenciais emitidas, na
// impressão da Minha carteirinha e nas prévias do criador. As medidas são em milímetros: no papel, `mm` de verdade; na tela, `mmPx` pixels por milímetro.
// O nome comprido diminui a letra até caber na caixa (nunca abaixo de 5 pontos); o QR tem uma borda branca própria (o celular precisa dela para ler).

const PONTO_EM_MM = 0.3528

function mm(v: number): string {
  return `calc(var(--mm) * ${v})`
}

function caixa(p: Parte): CSSProperties {
  return {
    position: 'absolute',
    left: mm(p.x),
    top: mm(p.y),
    width: mm(p.largura),
    height: mm(p.altura),
  }
}

/** O texto que diminui a letra até caber na caixa (o nome de quem tem muitos sobrenomes). */
function TextoQueCabe({ p, texto }: { p: Parte; texto: string }) {
  const fora = useRef<HTMLDivElement>(null)
  const dentro = useRef<HTMLSpanElement>(null)
  const tamanho = p.tamanho ?? 7
  useLayoutEffect(() => {
    const a = fora.current
    const b = dentro.current
    if (!a || !b) return
    let t = tamanho
    b.style.fontSize = mm(t * PONTO_EM_MM)
    while (
      t > LETRA_MINIMA &&
      (b.offsetHeight > a.clientHeight + 0.5 ||
        b.scrollWidth > a.clientWidth + 0.5)
    ) {
      t = Math.max(LETRA_MINIMA, t - 0.25)
      b.style.fontSize = mm(t * PONTO_EM_MM)
    }
  }, [texto, tamanho, p.largura, p.altura, p.negrito])
  const alinhar =
    p.alinhamento === 'centro'
      ? 'center'
      : p.alinhamento === 'direita'
        ? 'flex-end'
        : 'flex-start'
  return (
    <div
      ref={fora}
      data-parte={p.id}
      style={{
        ...caixa(p),
        display: 'flex',
        alignItems: 'center',
        justifyContent: alinhar,
        overflow: 'hidden',
        color: p.cor,
      }}
    >
      <span
        ref={dentro}
        style={{
          fontSize: mm(tamanho * PONTO_EM_MM),
          fontWeight: p.negrito ? 800 : 400,
          lineHeight: 1.15,
          textAlign:
            p.alinhamento === 'centro'
              ? 'center'
              : p.alinhamento === 'direita'
                ? 'right'
                : 'left',
          overflowWrap: 'anywhere',
          maxWidth: '100%',
        }}
      >
        {texto}
      </span>
    </div>
  )
}

function textoDaParte(p: Parte, dados: DadosDoCartao): string {
  switch (p.tipo) {
    case 'nome':
      return dados.nome || 'Sem nome'
    case 'matricula':
      return dados.matricula
        ? `Matrícula nº ${dados.matricula}`
        : 'Sem matrícula'
    case 'categoria':
      return dados.categoria ?? ''
    case 'desde':
      return dados.desde ? `Associado desde ${dados.desde}` : ''
    default:
      return p.texto ?? ''
  }
}

function ParteDesenhada({ p, dados }: { p: Parte; dados: DadosDoCartao }) {
  if (p.tipo === 'faixa')
    return <div data-parte={p.id} style={{ ...caixa(p), background: p.cor }} />
  if (p.tipo === 'logo')
    return (
      <div
        data-parte={p.id}
        style={{
          ...caixa(p),
          background: '#ffffff',
          borderRadius: mm(1.2),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: mm(0.6),
        }}
      >
        <img
          src="/asaf-logo-160.webp"
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
    )
  if (p.tipo === 'foto') {
    const raio = p.forma === 'redonda' ? '50%' : mm(1.5)
    return dados.foto ? (
      <img
        data-parte={p.id}
        src={dados.foto}
        alt=""
        style={{ ...caixa(p), objectFit: 'cover', borderRadius: raio }}
      />
    ) : (
      <div
        data-parte={p.id}
        style={{
          ...caixa(p),
          borderRadius: raio,
          background: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <UserRound
          aria-hidden="true"
          style={{ width: '45%', height: '45%', color: '#a3a3a3' }}
        />
      </div>
    )
  }
  if (p.tipo === 'qr')
    return (
      <div
        data-parte={p.id}
        style={{
          ...caixa(p),
          background: '#ffffff',
          padding: mm(1.2),
        }}
      >
        <QRCodeSVG
          value={dados.qr}
          size={256}
          level="M"
          aria-hidden="true"
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    )
  if (COM_LETRA.has(p.tipo)) {
    const texto = textoDaParte(p, dados)
    return texto ? <TextoQueCabe p={p} texto={texto} /> : null
  }
  return null
}

export function CartaoDesenhado({
  desenho,
  dados,
  mmPx,
  rotulo,
  className,
  children,
}: {
  desenho: Desenho
  dados: DadosDoCartao
  /** pixels por milímetro na tela; sem ele, milímetros de verdade (o papel); 'classe' = a escala vem do className (`[--mm:3px] lg:[--mm:4px]`) */
  mmPx?: number | 'classe'
  rotulo?: string
  className?: string
  /** por cima do cartão (as alças do editor, a linha de corte da folha) */
  children?: React.ReactNode
}) {
  const faixas = desenho.partes.filter((p) => p.tipo === 'faixa')
  const resto = desenho.partes.filter((p) => p.tipo !== 'faixa')
  return (
    <div
      aria-label={rotulo}
      role={rotulo ? 'img' : undefined}
      className={className}
      style={
        {
          ...(mmPx === 'classe' ? {} : { '--mm': mmPx ? `${mmPx}px` : '1mm' }),
          position: 'relative',
          width: mm(LARGURA_MM),
          height: mm(ALTURA_MM),
          overflow: 'hidden',
          background: desenho.fundo,
          color: '#0b1611',
          fontFamily: 'Inter, system-ui, sans-serif',
          printColorAdjust: 'exact',
          WebkitPrintColorAdjust: 'exact',
          flexShrink: 0,
        } as CSSProperties
      }
    >
      {[...faixas, ...resto].map((p) => (
        <ParteDesenhada key={p.id} p={p} dados={dados} />
      ))}
      {children}
    </div>
  )
}
