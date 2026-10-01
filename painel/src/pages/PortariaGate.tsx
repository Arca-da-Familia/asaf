// v4.8 (FASE 4) - tela da portaria: check-in/check-out por código curto, carteirinha digital (QR)
// ou câmera, SEM login do painel - só o token de operação da URL (`/portaria/:token`) autentica.
// Standalone de propósito (ver `lib/api-portaria.ts` e `lib/portaria-queue.ts`): só importa
// desses dois módulos, de primitivas de UI burras (`@/components/ui/button`) e de APIs de
// navegador/React/roteamento - nunca de `lib/api.ts`, `lib/auth-context.tsx` ou `lib/use-me.ts`.
// O plano da v4.8 já prevê esta tela sendo levada quase pronta pro site institucional (outro
// repositório, ainda não construído) - o acoplamento zero é o que evita ter que desembaraçar isso
// depois.
//
// Todo check-in/check-out passa por `portaria-queue.ts` (nunca um fetch direto daqui), mesmo
// online: o caminho online e o offline são o MESMO caminho, sem caso especial.
import type { IScannerControls } from '@zxing/browser'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  ErroPortaria,
  obterEventoPortaria,
  STATUS_FALHA_DE_REDE,
  type EventoPortaria,
  type MetodoCheckinPortaria,
} from '@/lib/api-portaria'
import {
  enfileirarCheckin,
  enfileirarCheckout,
  reenviarItemComErro,
  useFilaPortaria,
  type ItemFilaPortaria,
  type PayloadAcaoPortaria,
} from '@/lib/portaria-queue'

type AcaoSelecionada = 'checkin' | 'checkout'

// Mesma convenção documentada em `lib/datas.ts` desde a v4.3: datetime sem timezone na string,
// vindo da API, é sempre UTC - nunca hora local crua. Duplicado aqui (em vez de importar
// `lib/datas.ts`) porque esta tela é standalone de propósito (ver cabeçalho do arquivo).
function formatarDataHoraServidor(iso: string | null): string {
  if (!iso) return ''
  const comZ = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(comZ))
}

// `criado_em` da fila já nasce com `Z` (gerado aqui mesmo, via `Date.toISOString()`) - não
// precisa da normalização acima.
function formatarHoraLocal(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' }).format(
    new Date(iso),
  )
}

function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroPortaria) return erro.detail
  if (erro instanceof Error) return erro.message
  return 'Erro inesperado.'
}

// ---------------------------------------------------------------------------
// Leitor de QR por câmera - modo SECUNDÁRIO/opcional (o campo de código manual abaixo é sempre o
// caminho primário, funciona com zero câmera/permissão). Biblioteca: `@zxing/browser` (MIT,
// ~1,3M downloads/semana, release em jul/2026 - ativamente mantida). Decodifica pro MESMO texto
// que o campo manual aceitaria; nunca uma resolução paralela.
// ---------------------------------------------------------------------------
function useLeitorQr(aoLer: (texto: string) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const aoLerRef = useRef(aoLer)
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    aoLerRef.current = aoLer
  }, [aoLer])

  const parar = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setAberto(false)
  }, [])

  const abrir = useCallback(() => {
    setErro(null)
    setAberto(true)
  }, [])

  // Depende só de `aberto` (nunca de `aoLer`, que muda de identidade a cada render do
  // componente pai) - senão a câmera reiniciaria sozinha toda vez que qualquer outro estado da
  // tela mudasse (ex.: o contador de pendentes da fila, atualizado a cada ~18s).
  useEffect(() => {
    const videoElement = videoRef.current
    if (!aberto || !videoElement) return
    let cancelado = false

    // Import dinâmico de propósito: `@zxing/browser`/`@zxing/library` só é baixado quando a
    // pessoa realmente abre a câmera (modo secundário/opcional - o campo de código manual é
    // sempre o caminho primário). Sem isso, a biblioteca de decodificação de QR - não pequena -
    // entraria no bundle principal do painel pra todo mundo, mesmo quem nunca opera a portaria.
    import('@zxing/browser')
      .then(({ BrowserQRCodeReader }) => {
        if (cancelado) return
        const leitor = new BrowserQRCodeReader()
        return leitor.decodeFromVideoDevice(
          undefined,
          videoElement,
          (resultado, _erro, controls) => {
            // O 2º argumento (erro de decodificação) dispara a cada frame sem QR legível - é o
            // normal enquanto a câmera procura o código, nunca uma falha pra mostrar na tela.
            if (resultado && !cancelado) {
              cancelado = true
              controls.stop()
              controlsRef.current = null
              setAberto(false)
              aoLerRef.current(resultado.getText())
            }
          },
        )
      })
      .then((controls) => {
        if (!controls) return
        if (cancelado) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      })
      .catch(() => {
        if (!cancelado) {
          setErro(
            'Não foi possível acessar a câmera. Use o código manual abaixo.',
          )
          setAberto(false)
        }
      })
    return () => {
      cancelado = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [aberto])

  return { videoRef, aberto, erro, abrir, parar }
}

// ---------------------------------------------------------------------------
// Indicador sempre visível de conectividade + sincronização pendente (requisito (g) do plano).
// ---------------------------------------------------------------------------
function FaixaStatusFila({
  online,
  pendentes,
  sincronizando,
}: {
  online: boolean
  pendentes: number
  sincronizando: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-destructive'}`}
          aria-hidden
        />
        {online ? 'Conectado' : 'Sem conexão — registrando neste aparelho'}
      </span>
      <span className="text-muted-foreground">
        {sincronizando
          ? 'Sincronizando…'
          : pendentes > 0
            ? `${pendentes} registro(s) aguardando sincronizar`
            : 'Tudo sincronizado'}
      </span>
    </div>
  )
}

function CartaoConfirmacao({
  item,
  onCheckout,
  onTentarNovamente,
  enviando,
}: {
  item: ItemFilaPortaria
  onCheckout: (item: ItemFilaPortaria) => void
  onTentarNovamente: (item: ItemFilaPortaria) => void
  enviando: boolean
}) {
  const rotuloStatus =
    item.status === 'sincronizado'
      ? 'Sincronizado com o servidor.'
      : item.status === 'erro'
        ? `Recusado pelo servidor: ${item.ultimo_erro ?? 'motivo não informado.'}`
        : 'Registrado neste aparelho — sincronizando…'

  const valorLido = item.payload.codigo ?? item.payload.token_carteirinha ?? ''

  return (
    <div
      className={`rounded-md border p-3 text-sm ${
        item.status === 'erro'
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-border bg-card'
      }`}
    >
      <p className="font-medium">
        {item.tipo === 'checkin'
          ? 'Check-in registrado'
          : 'Check-out registrado'}{' '}
        <span className="font-normal text-muted-foreground">
          às {formatarHoraLocal(item.criado_em)}
        </span>
      </p>
      <p className="mt-1 text-muted-foreground">
        Método: {item.payload.metodo === 'codigo' ? 'código' : 'carteirinha'}
        {valorLido && ` · ${valorLido}`}
      </p>
      <p className="mt-1">{rotuloStatus}</p>
      {item.tipo === 'checkin' && item.status !== 'erro' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={enviando}
          onClick={() => onCheckout(item)}
        >
          Registrar check-out desta pessoa
        </Button>
      )}
      {item.status === 'erro' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={enviando}
          onClick={() => onTentarNovamente(item)}
        >
          Tentar novamente
        </Button>
      )}
    </div>
  )
}

export function PortariaGate() {
  const { token = '' } = useParams<{ token: string }>()
  // `key` = token: se o token da URL mudar, a tela recomeça do zero (evento, erro e "carregando"
  // de volta ao estado inicial) sem precisar resetar estado dentro de um efeito.
  return <PortariaGateConteudo key={token} token={token} />
}

function PortariaGateConteudo({ token }: { token: string }) {
  const [evento, setEvento] = useState<EventoPortaria | null>(null)
  const [erroEvento, setErroEvento] = useState<unknown>(null)
  const [carregandoEvento, setCarregandoEvento] = useState(true)

  // Botão "Tentar novamente" (manipulador de evento: pode zerar o estado antes de buscar).
  const carregarEvento = useCallback(() => {
    setCarregandoEvento(true)
    setErroEvento(null)
    obterEventoPortaria(token)
      .then(setEvento)
      .catch(setErroEvento)
      .finally(() => setCarregandoEvento(false))
  }, [token])

  // Carga inicial: o estado já nasce "carregando, sem erro" (useState acima), então o efeito só
  // busca e grava o resultado — nada de setState síncrono dentro do efeito.
  useEffect(() => {
    let cancelado = false
    obterEventoPortaria(token)
      .then((e) => {
        if (!cancelado) setEvento(e)
      })
      .catch((e: unknown) => {
        if (!cancelado) setErroEvento(e)
      })
      .finally(() => {
        if (!cancelado) setCarregandoEvento(false)
      })
    return () => {
      cancelado = true
    }
  }, [token])

  const fila = useFilaPortaria()

  const [acao, setAcao] = useState<AcaoSelecionada>('checkin')
  const [metodo, setMetodo] = useState<MetodoCheckinPortaria>('codigo')
  const [valor, setValor] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)
  const [chaveUltimaAcao, setChaveUltimaAcao] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const registrar = useCallback(
    async (acaoParaEnviar: AcaoSelecionada, valorLido: string) => {
      const texto = valorLido.trim()
      if (!texto) return
      setErroEnvio(null)
      setEnviando(true)
      try {
        const payload: PayloadAcaoPortaria =
          metodo === 'codigo'
            ? { metodo: 'codigo', codigo: texto.toUpperCase() }
            : { metodo: 'carteirinha', token_carteirinha: texto }
        const item =
          acaoParaEnviar === 'checkin'
            ? await enfileirarCheckin(token, payload)
            : await enfileirarCheckout(token, payload)
        setChaveUltimaAcao(item.chave_idempotencia)
        setValor('')
        inputRef.current?.focus()
      } catch (erro) {
        setErroEnvio(mensagemDeErro(erro))
      } finally {
        setEnviando(false)
      }
    },
    [metodo, token],
  )

  const registrarCheckoutDoItem = useCallback(
    async (item: ItemFilaPortaria) => {
      setErroEnvio(null)
      setEnviando(true)
      try {
        const novo = await enfileirarCheckout(token, item.payload)
        setChaveUltimaAcao(novo.chave_idempotencia)
      } catch (erro) {
        setErroEnvio(mensagemDeErro(erro))
      } finally {
        setEnviando(false)
      }
    },
    [token],
  )

  // Reenvio explícito de um item `erro` (recusa definitiva do servidor) - a fila nunca insiste
  // nele sozinha (ver comentário em `lib/portaria-queue.ts::sincronizarFilaPortaria`); isto é o
  // botão "Tentar novamente" do CartaoConfirmacao, pra depois de a causa ter sido corrigida por
  // fora (ex.: organizador reabriu a vaga da pessoa).
  const tentarNovamente = useCallback(async (item: ItemFilaPortaria) => {
    setErroEnvio(null)
    setEnviando(true)
    try {
      await reenviarItemComErro(item.chave_idempotencia)
    } catch (erro) {
      setErroEnvio(mensagemDeErro(erro))
    } finally {
      setEnviando(false)
    }
  }, [])

  // Desestruturado de propósito: `videoRef` é uma ref, e a regra react-hooks/refs do React 19
  // trata o objeto inteiro como "contém ref" e reprova ler `leitor.aberto` durante o render.
  const {
    videoRef,
    aberto: leitorAberto,
    erro: erroLeitor,
    abrir: abrirLeitor,
    parar: pararLeitor,
  } = useLeitorQr((texto) => {
    void registrar(acao, texto)
  })

  function aoSubmeterFormulario(e: FormEvent) {
    e.preventDefault()
    void registrar(acao, valor)
  }

  // ---- Tela cheia de erro: token ausente/inválido/expirado/revogado (401) - nada mais a fazer
  // por aqui, só orientar a pedir um link novo. Qualquer outro erro no carregamento inicial
  // (ex.: sem conexão) ganha um botão de tentar de novo, porque é exatamente o caso que esta
  // tela existe pra tolerar.
  if (erroEvento instanceof ErroPortaria && erroEvento.status === 401) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Link da portaria inválido</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Este link expirou, foi revogado ou está incorreto. Peça um link novo
            à organização do evento.
          </p>
        </div>
      </main>
    )
  }

  if (erroEvento && !evento) {
    const detalhe =
      erroEvento instanceof ErroPortaria &&
      erroEvento.status !== STATUS_FALHA_DE_REDE
        ? erroEvento.detail
        : 'Sem conexão com o servidor.'
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">
            Não foi possível abrir a portaria
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{detalhe}</p>
          <Button className="mt-4" onClick={carregarEvento}>
            Tentar novamente
          </Button>
        </div>
      </main>
    )
  }

  const itemUltimaAcao =
    fila.itens.find((i) => i.chave_idempotencia === chaveUltimaAcao) ?? null

  return (
    <main className="mx-auto min-h-screen max-w-md space-y-4 bg-background px-4 py-6">
      <header>
        {carregandoEvento || !evento ? (
          <p className="text-sm text-muted-foreground">Carregando evento…</p>
        ) : (
          <>
            <h1 className="text-lg font-bold">{evento.titulo}</h1>
            <p className="text-sm text-muted-foreground">
              {formatarDataHoraServidor(evento.data_hora_inicio)}
              {evento.data_hora_fim &&
                ` até ${formatarDataHoraServidor(evento.data_hora_fim)}`}
            </p>
          </>
        )}
      </header>

      <FaixaStatusFila
        online={fila.online}
        pendentes={fila.pendentes}
        sincronizando={fila.sincronizando}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            variant={acao === 'checkin' ? 'default' : 'outline'}
            onClick={() => setAcao('checkin')}
          >
            Check-in
          </Button>
          <Button
            type="button"
            size="sm"
            className="flex-1"
            variant={acao === 'checkout' ? 'default' : 'outline'}
            onClick={() => setAcao('checkout')}
          >
            Check-out
          </Button>
        </div>

        <div className="mb-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={metodo === 'codigo' ? 'secondary' : 'ghost'}
            className="flex-1"
            onClick={() => setMetodo('codigo')}
          >
            Código
          </Button>
          <Button
            type="button"
            size="sm"
            variant={metodo === 'carteirinha' ? 'secondary' : 'ghost'}
            className="flex-1"
            onClick={() => setMetodo('carteirinha')}
          >
            Carteirinha
          </Button>
        </div>

        <form onSubmit={aoSubmeterFormulario} className="space-y-3">
          <div>
            <label
              htmlFor="valor-portaria"
              className="mb-1 block text-xs text-muted-foreground"
            >
              {metodo === 'codigo'
                ? 'Código de check-in (8 caracteres)'
                : 'Token da carteirinha digital'}
            </label>
            <input
              id="valor-portaria"
              ref={inputRef}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoCapitalize={metodo === 'codigo' ? 'characters' : 'off'}
              value={valor}
              onChange={(e) =>
                setValor(
                  metodo === 'codigo'
                    ? e.target.value.toUpperCase()
                    : e.target.value,
                )
              }
              placeholder={
                metodo === 'codigo'
                  ? 'EX.: A1B2C3D4'
                  : 'Cole o token ou use a câmera'
              }
              className="h-14 w-full rounded-md border border-input bg-background px-4 text-center text-2xl tracking-widest"
            />
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={enviando || !valor.trim()}
          >
            {enviando
              ? 'Registrando…'
              : acao === 'checkin'
                ? 'Registrar check-in'
                : 'Registrar check-out'}
          </Button>

          {erroEnvio && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {erroEnvio}
            </p>
          )}
        </form>

        <div className="mt-3 border-t border-border pt-3">
          {leitorAberto ? (
            <div className="space-y-2">
              <video
                ref={videoRef}
                muted
                playsInline
                className="w-full rounded-md border border-border"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={pararLeitor}
              >
                Fechar câmera
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={abrirLeitor}
            >
              Ler QR pela câmera (opcional)
            </Button>
          )}
          {erroLeitor && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {erroLeitor}
            </p>
          )}
        </div>
      </section>

      {itemUltimaAcao && (
        <CartaoConfirmacao
          item={itemUltimaAcao}
          onCheckout={(item) => void registrarCheckoutDoItem(item)}
          onTentarNovamente={(item) => void tentarNovamente(item)}
          enviando={enviando}
        />
      )}

      <p className="text-center text-xs text-muted-foreground">
        Crachás e certificados são gerados pela organização depois que este
        aparelho sincronizar — nada é gerado aqui.
      </p>
    </main>
  )
}
