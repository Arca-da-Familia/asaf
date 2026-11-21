import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'

import { CartaoDesenhado } from '@/components/credencial/CartaoDesenhado'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  alterarModeloDeCredencial,
  guardarModeloDeCredencial,
  listarModelosDeCredencial,
  obterModeloDeCredencial,
  usarModeloDeCredencial,
} from '@/lib/api'
import {
  ALTURA_MM,
  COM_LETRA,
  CORES_PRONTAS,
  EXEMPLO,
  LARGURA_MM,
  LETRA_MAXIMA,
  LETRA_MINIMA,
  MAXIMO_DE_TEXTO,
  NOME_DA_PARTE,
  OBRIGATORIAS,
  aplicarCorPronta,
  avisosDoDesenho,
  corDoCabecalho,
  letraSobre,
  limiteDe,
  nomeDaParte,
  numeroBR,
  parteNova,
  type Desenho,
  type Parte,
  type TipoDeParte,
} from '@/lib/credencial-desenho'
import { cn } from '@/lib/utils'

// v9.5k - o EDITOR do criador de credencial (rodada 6, a opção 3 que o Presidente pediu depois da página inicial: "a pessoa edita a credencial,
// arrasta e edita, ele consegue configurar o que vai em cada lugar e se quiser adicionar texto... mexer no cabeçalho... tanto para digital como para
// física"). O cartão em tamanho grande: arrastar cada parte (o mouse ou o dedo), mudar o tamanho pelo canto, linhas-guia que aparecem quando alinha
// com o centro, a borda ou outra parte. Pelo teclado: as setas movem a parte escolhida (Shift move mais) e os números do painel ajustam tudo. Os
// avisos (QR pequeno, cor difícil de ler, parte fora do cartão) aparecem na hora e travam o "Guardar"; o servidor confere de novo.

const PASSO_MM = 0.5
const PASSO_GRANDE_MM = 2
const IMA_MM = 0.8
const MAXIMO_DESFAZER = 30
const CORES_DE_LETRA = [
  { nome: 'Quase preta', cor: '#0b1611' },
  { nome: 'Branca', cor: '#ffffff' },
  { nome: 'Cinza', cor: '#525252' },
  { nome: 'Verde', cor: '#14532d' },
]

const arredonda = (v: number) => Math.round(v * 10) / 10

function limitar(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

type Guias = { x: number[]; y: number[] }
type Arrasto = {
  id: string
  modo: 'mover' | 'tamanho'
  px0: number
  py0: number
  parte0: Parte
  lembrado: boolean
}

/** Encosta a parte nas linhas próximas (bordas e centro do cartão, bordas e centro das outras partes). */
function imantar(
  p: Parte,
  outras: Parte[],
): { x: number; y: number; guias: Guias } {
  const linhasX = [0, LARGURA_MM / 2, LARGURA_MM]
  const linhasY = [0, ALTURA_MM / 2, ALTURA_MM]
  for (const o of outras) {
    linhasX.push(o.x, o.x + o.largura / 2, o.x + o.largura)
    linhasY.push(o.y, o.y + o.altura / 2, o.y + o.altura)
  }
  const melhor = (pontos: number[], linhas: number[]) => {
    let ajuste = 0
    let linha: number | null = null
    let menor = IMA_MM
    for (const ponto of pontos)
      for (const l of linhas) {
        const d = l - ponto
        if (Math.abs(d) < menor) {
          menor = Math.abs(d)
          ajuste = d
          linha = l
        }
      }
    return { ajuste, linha }
  }
  const mx = melhor([p.x, p.x + p.largura / 2, p.x + p.largura], linhasX)
  const my = melhor([p.y, p.y + p.altura / 2, p.y + p.altura], linhasY)
  return {
    x: p.x + mx.ajuste,
    y: p.y + my.ajuste,
    guias: {
      x: mx.linha === null ? [] : [mx.linha],
      y: my.linha === null ? [] : [my.linha],
    },
  }
}

/** O número com vírgula decimal, no padrão brasileiro (o campo `type="number"` mostrava "31.8" no navegador em inglês, visto nos prints da homologação). */
function comVirgula(v: number): string {
  return String(arredonda(v)).replace('.', ',')
}

/** O campo de número: enquanto a pessoa digita, o cartão só muda quando o valor cabe no intervalo; ao sair do campo (ou no Enter), o valor é
 * ajustado ao mínimo ou ao máximo (antes, cada tecla já era ajustada: "15" virava "25"). Aceita vírgula ou ponto; as setas para cima e para baixo
 * somam ou tiram um passo, como no campo de número do navegador. */
function Numero({
  rotulo,
  valor,
  min,
  max,
  passo = 0.5,
  onMudar,
}: {
  rotulo: string
  valor: number
  min: number
  max: number
  passo?: number
  onMudar: (v: number) => void
}) {
  const id = `campo-${rotulo.replace(/\W+/g, '-').toLowerCase()}`
  const [texto, setTexto] = useState<string | null>(null)
  const ler = (t: string) => Number(t.replace(',', '.'))
  const fechar = () => {
    if (texto === null) return
    const v = ler(texto)
    if (texto.trim() !== '' && Number.isFinite(v))
      onMudar(arredonda(limitar(v, min, max)))
    setTexto(null)
  }
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm font-semibold">
      {rotulo}
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={texto ?? comVirgula(valor)}
        onChange={(e) => {
          setTexto(e.target.value)
          const v = ler(e.target.value)
          if (
            e.target.value.trim() !== '' &&
            Number.isFinite(v) &&
            v >= min &&
            v <= max
          )
            onMudar(arredonda(v))
        }}
        onBlur={fechar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') fechar()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const atual = texto === null ? valor : ler(texto)
            const base = Number.isFinite(atual) ? atual : valor
            const v = arredonda(
              limitar(base + (e.key === 'ArrowUp' ? passo : -passo), min, max),
            )
            setTexto(null)
            onMudar(v)
          }
        }}
        className="min-h-11 rounded-md border border-input bg-background px-3 text-base sm:min-h-9 sm:text-sm"
      />
    </label>
  )
}

function Amostras({
  rotulo,
  cores,
  atual,
  onEscolher,
}: {
  rotulo: string
  cores: { nome: string; cor: string }[]
  atual: string | undefined
  onEscolher: (cor: string) => void
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-2">
      {cores.map((c) => (
        <button
          key={c.cor}
          type="button"
          aria-label={c.nome}
          aria-pressed={atual?.toLowerCase() === c.cor}
          onClick={() => onEscolher(c.cor)}
          className={cn(
            'h-11 w-11 rounded-lg border-2 sm:h-9 sm:w-9',
            atual?.toLowerCase() === c.cor
              ? 'border-brand-secondary ring-2 ring-brand-secondary'
              : 'border-border',
          )}
          style={{ background: c.cor }}
        />
      ))}
    </div>
  )
}

function Editor({
  chave,
  idModelo,
  emUso,
  nomeInicial,
  desenhoInicial,
}: {
  chave: string
  idModelo: number | null
  emUso: boolean
  nomeInicial: string
  desenhoInicial: Desenho
}) {
  const navegar = useNavigate()
  const cliente = useQueryClient()
  const [nome, setNome] = useState(nomeInicial)
  const [desenho, setDesenho] = useState<Desenho>(desenhoInicial)
  const [historico, setHistorico] = useState<Desenho[]>([])
  const [escolhida, setEscolhida] = useState<string | null>(
    desenhoInicial.partes.find((p) => p.tipo === 'nome')?.id ?? null,
  )
  const [guias, setGuias] = useState<Guias>({ x: [], y: [] })
  const [tipoNovo, setTipoNovo] = useState<TipoDeParte | ''>('')
  const [confirmarUso, setConfirmarUso] = useState(false)
  const [aviso, setAviso] = useState('')
  const arrasto = useRef<Arrasto | null>(null)
  const area = useRef<HTMLDivElement>(null)
  const [mmPx, setMmPx] = useState(6)

  // a escala: o cartão ocupa a largura que houver (no máximo 7 px por milímetro; no celular, uns 4)
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    const medir = () =>
      setMmPx(
        limitar(Math.floor((el.clientWidth / LARGURA_MM) * 10) / 10, 3, 7),
      )
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const avisos = useMemo(() => avisosDoDesenho(desenho), [desenho])
  const parte = desenho.partes.find((p) => p.id === escolhida) ?? null
  const podeGuardar =
    avisos.length === 0 && nome.trim().length > 0 && nome.trim().length <= 60

  // um passo do Desfazer; mudanças SEGUIDAS do mesmo campo (digitar, arrastar no seletor de cor, as setas na mesma parte) viram UM passo
  const ultimoGrupo = useRef<string | null>(null)
  const lembrar = (grupo?: string) => {
    if (grupo && ultimoGrupo.current === grupo) return
    ultimoGrupo.current = grupo ?? null
    setHistorico((h) => [...h.slice(-(MAXIMO_DESFAZER - 1)), desenho])
  }
  const desfazer = () => {
    const anterior = historico[historico.length - 1]
    if (!anterior) return
    setHistorico((h) => h.slice(0, -1))
    setDesenho(anterior)
  }
  const mudarParte = (
    id: string,
    mudanca: Partial<Parte>,
    grupo: string | false | undefined = undefined,
  ) => {
    if (grupo !== false) lembrar(grupo)
    setDesenho((d) => ({
      ...d,
      partes: d.partes.map((p) => (p.id === id ? { ...p, ...mudanca } : p)),
    }))
  }
  const mudarTamanho = (p: Parte, largura: number, altura: number) => {
    if (p.tipo === 'qr') {
      const lado = limitar(
        Math.max(largura, altura),
        2,
        Math.min(LARGURA_MM - p.x, ALTURA_MM - p.y),
      )
      return { largura: arredonda(lado), altura: arredonda(lado) }
    }
    return {
      largura: arredonda(limitar(largura, 2, LARGURA_MM - p.x)),
      altura: arredonda(limitar(altura, 2, ALTURA_MM - p.y)),
    }
  }

  // ---------- arrastar (mouse ou dedo) ----------
  const comecar = (
    e: PointerEvent<HTMLElement>,
    p: Parte,
    modo: Arrasto['modo'],
  ) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // navegador sem captura: o arrasto segue enquanto o ponteiro estiver em cima
    }
    // o foco vai para o botão da parte na lista "Partes do cartão": depois do clique, as setas já movem a parte
    document.getElementById(`parte-${p.id}`)?.focus({ preventScroll: true })
    setEscolhida(p.id)
    arrasto.current = {
      id: p.id,
      modo,
      px0: e.clientX,
      py0: e.clientY,
      parte0: p,
      lembrado: false,
    }
  }
  const mover = (e: PointerEvent<HTMLElement>) => {
    const a = arrasto.current
    if (!a) return
    const dx = (e.clientX - a.px0) / mmPx
    const dy = (e.clientY - a.py0) / mmPx
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return
    if (!a.lembrado) {
      lembrar()
      a.lembrado = true
    }
    const p0 = a.parte0
    if (a.modo === 'tamanho') {
      mudarParte(a.id, mudarTamanho(p0, p0.largura + dx, p0.altura + dy), false)
      return
    }
    const solto = {
      ...p0,
      x: limitar(p0.x + dx, 0, LARGURA_MM - p0.largura),
      y: limitar(p0.y + dy, 0, ALTURA_MM - p0.altura),
    }
    const outras = desenho.partes.filter((o) => o.id !== a.id)
    const ima = imantar(solto, outras)
    setGuias(ima.guias)
    mudarParte(
      a.id,
      {
        x: arredonda(limitar(ima.x, 0, LARGURA_MM - p0.largura)),
        y: arredonda(limitar(ima.y, 0, ALTURA_MM - p0.altura)),
      },
      false,
    )
  }
  const soltar = () => {
    arrasto.current = null
    setGuias({ x: [], y: [] })
  }

  // ---------- teclado: as setas movem a parte escolhida ----------
  const teclar = (e: KeyboardEvent<HTMLElement>, p: Parte) => {
    const passo = e.shiftKey ? PASSO_GRANDE_MM : PASSO_MM
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-passo, 0],
      ArrowRight: [passo, 0],
      ArrowUp: [0, -passo],
      ArrowDown: [0, passo],
    }
    const d = delta[e.key]
    if (!d) return
    e.preventDefault()
    mudarParte(
      p.id,
      {
        x: arredonda(limitar(p.x + d[0], 0, LARGURA_MM - p.largura)),
        y: arredonda(limitar(p.y + d[1], 0, ALTURA_MM - p.altura)),
      },
      `setas-${p.id}`,
    )
  }

  const acrescentar = () => {
    if (!tipoNovo) return
    lembrar()
    const nova = parteNova(desenho, tipoNovo)
    setDesenho((d) => ({ ...d, partes: [...d.partes, nova] }))
    setEscolhida(nova.id)
    setTipoNovo('')
  }
  const tirar = (p: Parte) => {
    lembrar()
    setDesenho((d) => ({ ...d, partes: d.partes.filter((o) => o.id !== p.id) }))
    setEscolhida(null)
  }
  const tiposQueCabem = (Object.keys(NOME_DA_PARTE) as TipoDeParte[]).filter(
    (t) => desenho.partes.filter((p) => p.tipo === t).length < limiteDe(t),
  )

  // ---------- guardar ----------
  const podeAlterar = idModelo !== null && !emUso
  const guardar = useMutation({
    mutationFn: async (usarParaTodos: boolean) => {
      const m = podeAlterar
        ? await alterarModeloDeCredencial(idModelo!, nome.trim(), desenho)
        : await guardarModeloDeCredencial(nome.trim(), desenho)
      if (!usarParaTodos) return { m, uso: null, erroDoUso: null }
      try {
        return {
          m,
          uso: await usarModeloDeCredencial(m.id_modelo),
          erroDoUso: null,
        }
      } catch (erro) {
        // o modelo foi guardado, o "usar" falhou: o editor passa a ser o do modelo guardado (repetir não cria outro)
        return { m, uso: null, erroDoUso: erro }
      }
    },
    onSuccess: ({ m, uso, erroDoUso }) => {
      cliente.setQueryData(['modelo-de-credencial', m.id_modelo], m)
      cliente.invalidateQueries({ queryKey: ['modelos-de-credencial'] })
      cliente.invalidateQueries({ queryKey: ['modelo-de-credencial-em-uso'] })
      setConfirmarUso(false)
      if (uso) {
        cliente.invalidateQueries({ queryKey: ['modelo-de-credencial'] })
        navegar('/associados/credenciais/criador', {
          state: { aviso: uso.mensagem },
        })
        return
      }
      setAviso(
        erroDoUso
          ? `Guardado: "${m.nome}", mas não deu para usar para todos agora: ${erroDoUso instanceof ApiError ? erroDoUso.detail : 'tente de novo.'}`
          : `Guardado: "${m.nome}". Ele só vale para todos quando você escolher "Usar para todos".`,
      )
      if (!podeAlterar)
        navegar(`/associados/credenciais/criador/${m.id_modelo}`, {
          replace: true,
          state: { chaveDoEditor: chave },
        })
    },
    onError: (e) =>
      setAviso(
        e instanceof ApiError ? e.detail : 'Não foi possível guardar agora.',
      ),
  })

  const corCabecalho = corDoCabecalho(desenho)

  return (
    <>
      <PageHeader
        titulo={idModelo === null ? 'Modelo novo' : 'Editar modelo'}
        descricao="Arraste cada parte para onde quiser e mude o tamanho pelo canto. Pelo teclado: escolha a parte e use as setas (Shift move mais)."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Credenciais', href: '/associados/credenciais' },
          {
            rotulo: 'Criador de credencial',
            href: '/associados/credenciais/criador',
          },
          { rotulo: idModelo === null ? 'Modelo novo' : 'Editar' },
        ]}
      />
      {emUso && (
        <p className="mb-4 rounded-xl bg-ouro-tinta p-3 text-sm text-ouro-texto">
          Este é o modelo em uso: as mudanças ficam num modelo novo, que só vale
          para todos quando você escolher.
        </p>
      )}

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* a barra do alto: cores e partes */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold">
                  Cores prontas da faixa
                </span>
                <Amostras
                  rotulo="Cores prontas da faixa"
                  cores={CORES_PRONTAS.map((c) => ({
                    nome: `Faixa ${c.nome.toLowerCase()}`,
                    cor: c.faixa,
                  }))}
                  atual={corCabecalho}
                  onEscolher={(cor) => {
                    lembrar()
                    setDesenho((d) =>
                      aplicarCorPronta(
                        d,
                        CORES_PRONTAS.find((c) => c.faixa === cor)!,
                      ),
                    )
                  }}
                />
              </div>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Fundo do cartão
                <input
                  type="color"
                  value={desenho.fundo}
                  onChange={(e) => {
                    lembrar('fundo')
                    setDesenho((d) => ({ ...d, fundo: e.target.value }))
                  }}
                  className="h-11 w-16 cursor-pointer rounded-md border border-input bg-background sm:h-9"
                />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Acrescentar parte
                  <select
                    value={tipoNovo}
                    onChange={(e) =>
                      setTipoNovo(e.target.value as TipoDeParte | '')
                    }
                    className="min-h-11 rounded-md border border-input bg-background px-3 text-base sm:min-h-9 sm:text-sm"
                  >
                    <option value="">Escolha…</option>
                    {tiposQueCabem.map((t) => (
                      <option key={t} value={t}>
                        {NOME_DA_PARTE[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 sm:min-h-9"
                  disabled={!tipoNovo}
                  onClick={acrescentar}
                >
                  <Plus aria-hidden="true" />
                  Acrescentar
                </Button>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 sm:min-h-9"
                disabled={historico.length === 0}
                onClick={desfazer}
              >
                <Undo2 aria-hidden="true" />
                Desfazer
              </Button>
            </div>
          </div>

          {/* o cartão grande, com as partes que se arrastam */}
          <div ref={area} className="w-full max-w-[600px]">
            <CartaoDesenhado
              desenho={desenho}
              dados={EXEMPLO}
              mmPx={mmPx}
              className="rounded-lg border border-border shadow-card"
            >
              {guias.x.map((g) => (
                <span
                  key={`gx${g}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-azul-texto"
                  style={{ left: `calc(var(--mm) * ${g})` }}
                />
              ))}
              {guias.y.map((g) => (
                <span
                  key={`gy${g}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute right-0 left-0 h-px bg-azul-texto"
                  style={{ top: `calc(var(--mm) * ${g})` }}
                />
              ))}
              {[
                ...desenho.partes.filter((p) => p.tipo === 'faixa'),
                ...desenho.partes.filter((p) => p.tipo !== 'faixa'),
              ].map((p) => (
                // a parte no cartão é só para o mouse e o dedo (arrastar); quem usa teclado ou leitor de tela escolhe pela lista "Partes do cartão",
                // logo abaixo, de botões grandes — a parte miúda no cartão (3 mm de altura) não chega ao alvo mínimo de 24 px (WCAG 2.5.8)
                <div
                  key={p.id}
                  aria-hidden="true"
                  data-arrastar={p.id}
                  onPointerDown={(e) => comecar(e, p, 'mover')}
                  onPointerMove={mover}
                  onPointerUp={soltar}
                  onPointerCancel={soltar}
                  className={cn(
                    'absolute cursor-move touch-none rounded-[2px] outline-offset-0 hover:outline hover:outline-1 hover:outline-azul-texto/70',
                    p.id === escolhida &&
                      'outline-2 outline-brand-secondary outline',
                  )}
                  style={{
                    left: `calc(var(--mm) * ${p.x})`,
                    top: `calc(var(--mm) * ${p.y})`,
                    width: `calc(var(--mm) * ${p.largura})`,
                    height: `calc(var(--mm) * ${p.altura})`,
                  }}
                >
                  {p.id === escolhida && (
                    <span
                      aria-hidden="true"
                      onPointerDown={(e) => comecar(e, p, 'tamanho')}
                      onPointerMove={mover}
                      onPointerUp={soltar}
                      onPointerCancel={soltar}
                      className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-brand-secondary shadow"
                    />
                  )}
                </div>
              ))}
            </CartaoDesenhado>
          </div>

          <div
            role="group"
            aria-labelledby="titulo-partes"
            className="flex flex-col gap-2"
          >
            <p id="titulo-partes" className="text-sm font-semibold">
              Partes do cartão{' '}
              <span className="font-normal text-muted-foreground">
                (escolha uma e use as setas para mover)
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                ...desenho.partes.filter((p) => p.tipo === 'faixa'),
                ...desenho.partes.filter((p) => p.tipo !== 'faixa'),
              ].map((p) => (
                <button
                  key={p.id}
                  id={`parte-${p.id}`}
                  type="button"
                  aria-label={`${nomeDaParte(p)}: ${numeroBR(p.x)} mm da esquerda, ${numeroBR(p.y)} mm do alto`}
                  aria-pressed={p.id === escolhida}
                  onClick={() => setEscolhida(p.id)}
                  onKeyDown={(e) => teclar(e, p)}
                  className={cn(
                    'inline-flex min-h-11 max-w-full items-center rounded-full border px-3 text-sm font-semibold break-words sm:min-h-9',
                    p.id === escolhida
                      ? 'border-brand-secondary bg-brand-secondary text-brand-secondary-foreground'
                      : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  {nomeDaParte(p)}
                </button>
              ))}
            </div>
          </div>

          <section
            aria-labelledby="titulo-celular"
            className="flex flex-col gap-2"
          >
            <h2 id="titulo-celular" className="text-sm font-semibold">
              Na Minha carteirinha (celular), o cabeçalho fica assim:
            </h2>
            <div
              className="flex max-w-[360px] items-center gap-3 rounded-t-[22px] px-4 py-3"
              style={{
                background: corCabecalho,
                color: letraSobre(corCabecalho),
              }}
            >
              <span className="flex h-10 w-11 shrink-0 items-center justify-center rounded-lg bg-white">
                <img
                  src="/asaf-logo-160.webp"
                  alt=""
                  className="h-9 w-9 object-contain"
                />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-titulo text-lg font-extrabold">ASAF</span>
                <span className="text-sm">Carteirinha de associado</span>
              </span>
            </div>
          </section>

          <section
            aria-labelledby="titulo-avisos"
            aria-live="polite"
            className={cn(
              'rounded-2xl border p-4',
              avisos.length > 0
                ? 'border-destructive bg-perigo-tinta'
                : 'border-border bg-card',
            )}
          >
            <h2 id="titulo-avisos" className="font-semibold">
              {avisos.length > 0
                ? `Antes de guardar, corrija ${avisos.length === 1 ? '1 ponto' : `${avisos.length} pontos`}:`
                : 'Tudo certo: o QR tem tamanho para o celular ler e todas as letras têm contraste.'}
            </h2>
            {avisos.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {avisos.map((a) => (
                  <li key={`${a.idParte}-${a.texto}`}>
                    {a.idParte ? (
                      <button
                        type="button"
                        className="min-h-11 text-left underline underline-offset-2 sm:min-h-0"
                        onClick={() => setEscolhida(a.idParte)}
                      >
                        {a.texto}
                      </button>
                    ) : (
                      a.texto
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* a parte escolhida */}
        <aside
          aria-labelledby="titulo-parte"
          className="flex w-full flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-card xl:w-80 xl:shrink-0"
        >
          {!parte ? (
            <p id="titulo-parte" className="text-sm text-muted-foreground">
              Clique numa parte do cartão para ajustar.
            </p>
          ) : (
            <>
              <h2
                id="titulo-parte"
                className="font-titulo text-lg font-extrabold"
              >
                {nomeDaParte(parte)}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <Numero
                  rotulo="Da esquerda (mm)"
                  valor={parte.x}
                  min={0}
                  max={arredonda(LARGURA_MM - parte.largura)}
                  onMudar={(v) =>
                    mudarParte(parte.id, { x: v }, `x-${parte.id}`)
                  }
                />
                <Numero
                  rotulo="Do alto (mm)"
                  valor={parte.y}
                  min={0}
                  max={arredonda(ALTURA_MM - parte.altura)}
                  onMudar={(v) =>
                    mudarParte(parte.id, { y: v }, `y-${parte.id}`)
                  }
                />
                {parte.tipo === 'qr' ? (
                  <Numero
                    rotulo="Lado (mm)"
                    valor={parte.largura}
                    min={2}
                    max={arredonda(
                      Math.min(LARGURA_MM - parte.x, ALTURA_MM - parte.y),
                    )}
                    onMudar={(v) =>
                      mudarParte(
                        parte.id,
                        mudarTamanho(parte, v, v),
                        `lado-${parte.id}`,
                      )
                    }
                  />
                ) : (
                  <>
                    <Numero
                      rotulo="Largura (mm)"
                      valor={parte.largura}
                      min={2}
                      max={arredonda(LARGURA_MM - parte.x)}
                      onMudar={(v) =>
                        mudarParte(
                          parte.id,
                          mudarTamanho(parte, v, parte.altura),
                          `largura-${parte.id}`,
                        )
                      }
                    />
                    <Numero
                      rotulo="Altura (mm)"
                      valor={parte.altura}
                      min={2}
                      max={arredonda(ALTURA_MM - parte.y)}
                      onMudar={(v) =>
                        mudarParte(
                          parte.id,
                          mudarTamanho(parte, parte.largura, v),
                          `altura-${parte.id}`,
                        )
                      }
                    />
                  </>
                )}
              </div>

              {parte.tipo === 'texto' && (
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  O texto
                  <input
                    type="text"
                    maxLength={MAXIMO_DE_TEXTO}
                    value={parte.texto ?? ''}
                    onChange={(e) =>
                      mudarParte(
                        parte.id,
                        { texto: e.target.value },
                        `texto-${parte.id}`,
                      )
                    }
                    className="min-h-11 rounded-md border border-input bg-background px-3 text-base sm:min-h-9 sm:text-sm"
                  />
                </label>
              )}

              {COM_LETRA.has(parte.tipo) && (
                <>
                  <Numero
                    rotulo="Tamanho da letra (pontos)"
                    valor={parte.tamanho ?? 7}
                    min={LETRA_MINIMA}
                    max={LETRA_MAXIMA}
                    onMudar={(v) =>
                      mudarParte(parte.id, { tamanho: v }, `letra-${parte.id}`)
                    }
                  />
                  <label className="flex min-h-11 items-center gap-2 text-sm font-semibold sm:min-h-9">
                    <input
                      type="checkbox"
                      checked={Boolean(parte.negrito)}
                      onChange={(e) =>
                        mudarParte(parte.id, { negrito: e.target.checked })
                      }
                      className="h-5 w-5"
                    />
                    Negrito
                  </label>
                  <div
                    role="group"
                    aria-label="Alinhamento"
                    className="flex gap-1"
                  >
                    {(
                      [
                        ['esquerda', 'À esquerda'],
                        ['centro', 'No centro'],
                        ['direita', 'À direita'],
                      ] as const
                    ).map(([v, t]) => (
                      <Button
                        key={v}
                        type="button"
                        variant={
                          (parte.alinhamento ?? 'esquerda') === v
                            ? 'default'
                            : 'outline'
                        }
                        aria-pressed={(parte.alinhamento ?? 'esquerda') === v}
                        className="min-h-11 flex-1 px-2 sm:min-h-9"
                        onClick={() => mudarParte(parte.id, { alinhamento: v })}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">Cor da letra</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Amostras
                        rotulo="Cor da letra"
                        cores={CORES_DE_LETRA}
                        atual={parte.cor}
                        onEscolher={(cor) => mudarParte(parte.id, { cor })}
                      />
                      <input
                        type="color"
                        aria-label="Outra cor de letra"
                        value={parte.cor ?? '#0b1611'}
                        onChange={(e) =>
                          mudarParte(
                            parte.id,
                            { cor: e.target.value },
                            `cor-${parte.id}`,
                          )
                        }
                        className="h-11 w-14 cursor-pointer rounded-md border border-input bg-background sm:h-9"
                      />
                    </div>
                  </div>
                </>
              )}

              {parte.tipo === 'faixa' && (
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  Cor da faixa
                  <input
                    type="color"
                    value={parte.cor ?? '#14532d'}
                    onChange={(e) =>
                      mudarParte(
                        parte.id,
                        { cor: e.target.value },
                        `cor-${parte.id}`,
                      )
                    }
                    className="h-11 w-16 cursor-pointer rounded-md border border-input bg-background sm:h-9"
                  />
                </label>
              )}

              {parte.tipo === 'foto' && (
                <div
                  role="group"
                  aria-label="Forma da foto"
                  className="flex gap-1"
                >
                  {(
                    [
                      ['retangulo', 'Retângulo'],
                      ['redonda', 'Redonda'],
                    ] as const
                  ).map(([v, t]) => (
                    <Button
                      key={v}
                      type="button"
                      variant={
                        (parte.forma ?? 'retangulo') === v
                          ? 'default'
                          : 'outline'
                      }
                      aria-pressed={(parte.forma ?? 'retangulo') === v}
                      className="min-h-11 flex-1 sm:min-h-9"
                      onClick={() => mudarParte(parte.id, { forma: v })}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              )}

              {parte.tipo === 'qr' && (
                <p className="text-sm text-muted-foreground">
                  O QR é a credencial: quem o lê vê a situação de agora. Tem de
                  ter pelo menos 18 mm e nada por cima.
                </p>
              )}

              {!OBRIGATORIAS.includes(parte.tipo) && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 self-start sm:min-h-9"
                  onClick={() => tirar(parte)}
                >
                  <Trash2 aria-hidden="true" />
                  Tirar esta parte
                </Button>
              )}
            </>
          )}
        </aside>
      </div>

      {/* guardar */}
      <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-card">
        <label className="flex max-w-md flex-col gap-1 text-sm font-semibold">
          Nome do modelo
          <input
            type="text"
            maxLength={60}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="min-h-11 rounded-md border border-input bg-background px-3 text-base sm:min-h-9 sm:text-sm"
          />
        </label>
        {!confirmarUso ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" className="min-h-11 sm:min-h-9">
              <Link to="/associados/credenciais/criador">
                <ArrowLeft aria-hidden="true" />
                Voltar aos modelos
              </Link>
            </Button>
            <span className="flex-1" />
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              disabled={!podeGuardar || guardar.isPending}
              onClick={() => guardar.mutate(false)}
            >
              <Save aria-hidden="true" />
              {podeAlterar ? 'Guardar' : 'Guardar como modelo novo'}
            </Button>
            <Button
              type="button"
              className="min-h-11 sm:min-h-9"
              disabled={!podeGuardar || guardar.isPending}
              onClick={() => setConfirmarUso(true)}
            >
              <CheckCircle2 aria-hidden="true" />
              Guardar e usar para todos
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg bg-ouro-tinta p-3 text-sm text-ouro-texto">
            <p>
              Todas as credenciais passam a sair com este desenho (na folha A4 e
              na Minha carteirinha). O QR de cada uma não muda; o modelo de
              agora fica guardado e pode voltar.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11 sm:min-h-9"
                disabled={guardar.isPending}
                onClick={() => guardar.mutate(true)}
              >
                Sim, usar para todos
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 sm:min-h-9"
                onClick={() => setConfirmarUso(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {!podeGuardar && avisos.length > 0 && (
          <p className="text-sm text-muted-foreground">
            O "Guardar" volta quando os pontos acima estiverem corrigidos.
          </p>
        )}
        <p role="status" className="text-sm font-semibold empty:hidden">
          {aviso}
        </p>
      </div>
    </>
  )
}

export function EditorDeCredencialPage() {
  const { id = 'novo' } = useParams()
  const [parametros] = useSearchParams()
  const estado = useLocation().state as { chaveDoEditor?: string } | null
  const de = parametros.get('de') ?? 'faixa-no-alto'
  const numero = /^\d+$/.test(id) ? Number(id) : null
  const continuando = Boolean(estado?.chaveDoEditor)
  const doGuardado = useQuery({
    queryKey: ['modelo-de-credencial', numero],
    queryFn: () => obterModeloDeCredencial(numero!),
    enabled: numero !== null,
    refetchOnMount: 'always',
  })
  const lista = useQuery({
    queryKey: ['modelos-de-credencial'],
    queryFn: listarModelosDeCredencial,
    enabled: numero === null,
    refetchOnMount: 'always',
  })

  if (numero !== null) {
    const m = doGuardado.data
    // abre só com o que o servidor tem agora (a cópia guardada no navegador pode ser de antes de um "Guardar")
    if (!m || (!continuando && !doGuardado.isFetchedAfterMount)) {
      if (doGuardado.isError)
        return (
          <EmptyState
            titulo="Modelo não encontrado"
            descricao="Volte ao criador de credencial e escolha outro."
          />
        )
      return <p className="text-sm text-muted-foreground">Carregando…</p>
    }
    const chave = estado?.chaveDoEditor ?? `modelo-${m.id_modelo}`
    return (
      <Editor
        key={chave}
        chave={chave}
        idModelo={m.id_modelo}
        emUso={m.em_uso}
        nomeInicial={m.nome}
        desenhoInicial={m.desenho}
      />
    )
  }
  if (!lista.isFetchedAfterMount)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  const guardado = /^\d+$/.test(de)
    ? lista.data?.guardados.find((g) => g.id_modelo === Number(de))
    : undefined
  const pronto = lista.data?.prontos.find((p) => p.chave === de)
  const base = guardado ?? pronto
  if (!base)
    return (
      <EmptyState
        titulo="Modelo não encontrado"
        descricao="Volte ao criador de credencial e escolha de onde começar."
      />
    )
  const chave = `novo-${de}`
  return (
    <Editor
      key={chave}
      chave={chave}
      idModelo={null}
      emUso={false}
      nomeInicial={`Cópia de ${base.nome}`.slice(0, 60)}
      desenhoInicial={structuredClone(base.desenho)}
    />
  )
}
