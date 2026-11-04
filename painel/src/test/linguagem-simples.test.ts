import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// v9.1d - LINGUAGEM SIMPLES: quem usa o painel é gente da associação (secretaria, tesouraria, diretoria, associado idoso), não técnico. Este teste lê o texto que
// APARECE na tela (o que fica entre as marcas do JSX e o que vai em placeholder, title, aria-label, rótulo e mensagem) e reprova o jargão de informática.
// Achado na primeira varredura e trocado: "Todos os status" -> "Todas as situações", "E-mail de login" -> "E-mail para entrar", "ID da pessoa" -> "Número da
// pessoa", "Cole o token" -> "Cole o código", "sincronizando" -> "enviando", "Sessão de login expirada" -> "O tempo para entrar acabou". Palavra nova
// proibida entra em JARGAO; um uso que precisa ficar (nome próprio) entra em PERMITIDOS com o motivo.
const JARGAO: Array<[RegExp, string]> = [
  [/\btoken\b/i, 'código'],
  [/\blogin\b/i, 'entrar'],
  [/\blog(ar|ado|ue)\b/i, 'entrar'],
  [/\bdelet/i, 'apagar'],
  [/\btemplates?\b/i, 'modelo'],
  [/\bupload\b/i, 'enviar'],
  [/\bdownload\b/i, 'baixar'],
  [/\bdashboard\b/i, 'início ou painel'],
  [/\b(backend|frontend|payload|endpoint|request)\b/i, 'dizer o que acontece'],
  [/\bstatus\b/i, 'situação'],
  // "Face ID" e "Touch ID" são nomes dos recursos da Apple (tela de Perfil)
  [/(?<!(?:Face|Touch) )\bID\b/, 'número'],
  [/\bsincroniz/i, 'enviar'],
]

// arquivo: motivo
const PERMITIDOS: Record<string, string> = {
  'DevComponents.tsx':
    'catálogo de componentes de quem desenvolve (/dev/componentes), fora do menu',
}

const RAIZ = path.resolve(process.cwd(), 'src')

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = path.join(pasta, nome)
    if (statSync(caminho).isDirectory())
      return nome === 'test' ? [] : arquivos(caminho)
    return nome.endsWith('.tsx') ? [caminho] : []
  })
}

/** O texto que aparece na tela: o de dentro das marcas do JSX e o dos atributos e chaves que viram texto. */
function textosVisiveis(codigo: string): string[] {
  const semComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const textos: string[] = []
  for (const m of semComentarios.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g))
    textos.push(m[1]!)
  for (const m of semComentarios.matchAll(
    /\b(?:placeholder|title|aria-label|rotulo|label|titulo|descricao|mensagem|texto)=?\s*[:=]?\s*\{?\s*(['"`])([^'"`]*[A-Za-zÀ-ÿ][^'"`]*)\1/g,
  ))
    textos.push(m[2]!)
  // mensagens: setErro('...'), toast('...'), avisar('...')
  for (const m of semComentarios.matchAll(
    /\b(?:setErro|setAviso|toast(?:\.\w+)?|avisar|mostrar)\(\s*(['"`])([^'"`]+)\1/g,
  ))
    textos.push(m[2]!)
  return (
    textos
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      // o que fica entre um `>` e um `<` também pode ser CÓDIGO (os tipos do TypeScript: useState<string | null>(null) ... useRef<): texto de tela não tem
      // atribuição, comparação nem `const`
      .filter((t) => !/[=;]|\bconst\b|\breturn\b|&&|\|\||=>|\btype\b/.test(t))
  )
}

describe('linguagem simples no painel (v9.1d)', () => {
  const lista = arquivos(RAIZ)

  it('o leitor achou as telas', () => {
    expect(lista.length).toBeGreaterThan(150)
    expect(textosVisiveis('<p>Todas as situações</p>')).toEqual([
      'Todas as situações',
    ])
    expect(textosVisiveis('<input placeholder="Cole o código" />')).toEqual([
      'Cole o código',
    ])
  })

  it('nenhum texto da tela usa jargão de informática', () => {
    const achados: string[] = []
    for (const arquivo of lista) {
      if (PERMITIDOS[path.basename(arquivo)]) continue
      for (const texto of textosVisiveis(readFileSync(arquivo, 'utf-8'))) {
        for (const [padrao, troca] of JARGAO) {
          if (padrao.test(texto))
            achados.push(
              `${path.relative(RAIZ, arquivo)}: "${texto.slice(0, 90)}" (troque por: ${troca})`,
            )
        }
      }
    }
    expect(achados, achados.join('\n')).toEqual([])
  })

  it('a trava pega o jargão de volta (teste do teste)', () => {
    const texto = textosVisiveis(
      '<option value="">Todos os status</option>',
    )[0]!
    expect(JARGAO.some(([padrao]) => padrao.test(texto))).toBe(true)
  })
})
