import { formatarReais, type DadosDoPix } from './doacao'
import { desenharQr } from './qr-pix'

/**
 * O painel "Pague pelo Pix" (v5.6a): o código "copia e cola" em texto selecionável com o botão Copiar, o QR Code desenhado no navegador e a chave, o beneficiário e a cidade
 * como texto, para quem prefere digitar. Serve às duas formas de doar (sem se identificar e identificando-se).
 *
 * O código em texto está SEMPRE ao lado do QR Code (quem não enxerga o desenho, ou usa o leitor de tela, não perde nada). Copiar tenta a área de transferência do navegador e, se ela não
 * estiver disponível (página sem HTTPS, navegador antigo, permissão negada), seleciona o texto e tenta o comando antigo de copiar; se nem isso funcionar, deixa o código selecionado
 * e diz à pessoa como copiar com o dedo. A mensagem do resultado fica numa região `role="status"`.
 *
 * SEGURANÇA: tudo vem da API como texto e entra só por `textContent`/atributos.
 */

export function criar<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const elemento = document.createElement(tag)
  if (classe) elemento.className = classe
  if (texto !== undefined) elemento.textContent = texto
  return elemento
}

export const TEXTO_DA_COPIA_OK =
  'Copiado. Agora é só colar no aplicativo do seu banco.'
export const TEXTO_DA_COPIA_MANUAL =
  'Não consegui copiar sozinho. O texto está selecionado: toque nele, segure e escolha “Copiar”.'

export interface OpcoesDaCopia {
  /** A área de transferência (nos testes, trocada; `null` = indisponível). */
  clipboard?: Pick<Clipboard, 'writeText'> | null
}

interface ComComandoAntigo {
  execCommand?: (comando: string) => boolean
}

function selecionar(elemento: HTMLElement): void {
  const selecao = window.getSelection()
  if (!selecao) return
  const faixa = document.createRange()
  faixa.selectNodeContents(elemento)
  selecao.removeAllRanges()
  selecao.addRange(faixa)
}

/**
 * Copia `texto` para a área de transferência. `elemento` é onde o mesmo texto está escrito na página: serve de alternativa (seleção + comando antigo de copiar) e, se tudo
 * falhar, fica selecionado para a pessoa copiar com o dedo. Devolve se copiou de verdade.
 */
export async function copiarTexto(
  texto: string,
  elemento: HTMLElement | null,
  opcoes: OpcoesDaCopia = {},
): Promise<boolean> {
  const clipboard =
    opcoes.clipboard === undefined ? navigator.clipboard : opcoes.clipboard
  if (clipboard) {
    try {
      await clipboard.writeText(texto)
      return true
    } catch {
      // sem permissão ou fora de contexto seguro: cai na alternativa
    }
  }
  if (elemento) {
    selecionar(elemento)
    // o comando antigo de copiar (marcado como "obsoleto" nos tipos, mas é o que resta quando a área de transferência não existe): lido como propriedade opcional
    const comando = (document as unknown as ComComandoAntigo).execCommand
    try {
      if (comando?.call(document, 'copy')) return true
    } catch {
      // o comando antigo também pode falhar
    }
  }
  return false
}

let contador = 0

/** Liga um botão "Copiar" ao texto: cada clique copia e escreve o resultado na região de aviso. */
export function ligarBotaoDeCopiar(
  botao: HTMLButtonElement,
  aviso: HTMLElement,
  texto: () => string,
  elemento: HTMLElement | null,
  opcoes: OpcoesDaCopia = {},
): void {
  botao.addEventListener('click', () => {
    void copiarTexto(texto(), elemento, opcoes).then((copiou) => {
      aviso.textContent = copiou ? TEXTO_DA_COPIA_OK : TEXTO_DA_COPIA_MANUAL
    })
  })
}

const CLASSE_DO_BOTAO =
  'rounded-md bg-primary px-5 py-3 font-medium text-primary-foreground hover:opacity-90'

/** A linha do valor: o que o código já traz (ou o aviso de que a pessoa digita o valor no aplicativo do banco). */
export function textoDoValor(valor: number | null): string {
  return valor === null
    ? 'Sem valor definido: você digita o valor no aplicativo do seu banco.'
    : `Valor: ${formatarReais(valor)}. Ele já está dentro do código.`
}

export function criarPainelDoPix(
  dados: DadosDoPix,
  opcoes: OpcoesDaCopia = {},
): HTMLElement {
  contador += 1
  const id = `painel-pix-${contador}`
  const painel = criar('div', 'grid gap-5')
  painel.setAttribute('data-painel-pix', '')
  painel.setAttribute('aria-labelledby', `${id}-titulo`)
  painel.setAttribute('role', 'group')

  const titulo = criar('h4', 'text-lg font-bold', 'Pague pelo Pix')
  titulo.id = `${id}-titulo`
  const valor = criar('p', 'font-medium', textoDoValor(dados.valor))
  valor.setAttribute('data-valor-pix', '')
  const passos = criar('ol', 'flex list-decimal flex-col gap-1 pl-6')
  for (const passo of [
    'Abra o aplicativo do seu banco e escolha pagar com Pix.',
    'Escolha “Pix Copia e Cola” e cole o código, ou “Ler QR Code” e aponte a câmera para o desenho.',
    'Antes de confirmar, confira se o nome de quem vai receber é o da ASAF.',
  ])
    passos.append(criar('li', undefined, passo))
  painel.append(titulo, valor, passos)

  // o QR Code (com o código escrito logo abaixo, sempre)
  const figura = criar('div', 'flex flex-col items-start gap-2')
  figura.setAttribute('data-qr', '')
  try {
    figura.append(
      desenharQr(
        dados.copia_e_cola,
        'QR Code do Pix da ASAF. O mesmo código está escrito logo abaixo, para copiar.',
      ),
    )
    figura.append(
      criar(
        'p',
        'text-sm text-muted-foreground',
        'QR Code do Pix: aponte a câmera do aplicativo do banco.',
      ),
    )
  } catch {
    figura.append(
      criar(
        'p',
        'text-sm font-medium',
        'Não foi possível desenhar o QR Code. Use o código escrito abaixo.',
      ),
    )
  }
  painel.append(figura)

  const bloco = criar('div', 'grid gap-2')
  const rotulo = criar('p', 'text-sm font-medium', 'Código Pix (copia e cola)')
  const codigo = criar(
    'p',
    'select-all break-all rounded-md border bg-background p-3 font-mono text-sm',
    dados.copia_e_cola,
  )
  codigo.setAttribute('data-codigo-pix', '')
  const botao = criar('button', CLASSE_DO_BOTAO, 'Copiar o código')
  botao.type = 'button'
  botao.setAttribute('data-copiar-codigo', '')
  const aviso = criar('p', 'text-sm font-medium')
  aviso.setAttribute('role', 'status')
  aviso.setAttribute('data-aviso-da-copia', '')
  ligarBotaoDeCopiar(botao, aviso, () => dados.copia_e_cola, codigo, opcoes)
  const linhaDoBotao = criar('div', 'flex flex-wrap items-center gap-3')
  linhaDoBotao.append(botao, aviso)
  bloco.append(rotulo, codigo, linhaDoBotao)
  painel.append(bloco)

  // quem prefere digitar
  const lista = criar('dl', 'grid gap-3 text-sm sm:grid-cols-3')
  for (const [nome, texto, marca] of [
    ['Chave Pix', dados.chave_pix, 'data-chave-pix'],
    ['Beneficiário', dados.beneficiario, 'data-beneficiario'],
    ['Cidade', dados.cidade, 'data-cidade'],
  ] as const) {
    const item = criar('div')
    const descricao = criar('dd', 'break-all text-muted-foreground', texto)
    descricao.setAttribute(marca, '')
    item.append(criar('dt', 'font-medium', nome), descricao)
    lista.append(item)
  }
  painel.append(
    criar(
      'p',
      'text-sm font-medium',
      'Prefere digitar? Estes são os dados de quem recebe:',
    ),
    lista,
  )
  return painel
}
