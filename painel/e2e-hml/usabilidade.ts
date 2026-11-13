import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { entrar } from './apoio'
import {
  esperarATela,
  linksInternos,
  padrao,
  PULAR,
  ROTAS_PESSOAIS,
} from './varredura'

// v9.3a/b - USABILIDADE NO CELULAR E NO NOTEBOOK (a mesma varredura com o aparelho como parâmetro; roteiros v9.3a-01 e v9.3b-01), verificada de forma virtual (decisão do Presidente, 05/11: não há como reunir 3 a 5 pessoas reais; o robô simula o uso
// e tira o print de cada tela para ele conferir depois, "celular em primeiro lugar"). Num celular de 360 px (o Android mais comum e o mais estreito que se
// usa hoje), com toque, o robô entra como Presidente, abre TODAS as telas seguindo os links do painel e mede, em cada uma, o que atrapalha quem usa o telefone:
//   GRAVE (reprova): a página rola de lado; botão, campo ou link cortado fora da tela (sem rolagem própria para alcançá-lo); campo com letra menor que 16 px
//   (o iPhone amplia a tela sozinho ao tocar); o título da tela fora da primeira tela; o menu lateral aberto por cima do conteúdo ao chegar; alvo de toque
//   menor que 24 px (critério 2.5.8 da WCAG 2.2; a caixinha dentro de um rótulo conta pelo rótulo, que também marca; link no meio do texto é exceção);
//   letra menor que 12 px. (Os dois últimos foram AVISO na 1ª rodada, 05/11: 69 alvos e 124 letras, todos corrigidos; passaram a reprovar.)
//   Palavra PARTIDA no meio (desenhada em duas linhas, "Co/nc/ed/er"): tabela ou botão espremido fica ilegível sem sair da tela (4ª rodada, 05/11).
//   AVISO (vai para o relatório, sem reprovar): tela com mais de 10 alturas de celular; tabela que só se lê rolando de lado.
// Os prints (um por tela, a página inteira) e o relatório ficam na pasta da execução, para o Presidente olhar quando puder.
const LIMITE = 220

export type Achado = { grave: boolean; tipo: string; detalhe: string }

/** O aparelho da varredura: o tamanho da tela, se é celular (toque, menu escondido) e quantas alturas de tela uma página pode ter antes do aviso. */
export type Aparelho = {
  nome: string
  largura: number
  altura: number
  celular: boolean
  limiteDeAlturas: number
  pasta: string
}

export const CELULAR: Aparelho = {
  nome: 'celular',
  largura: 360,
  altura: 740,
  celular: true,
  limiteDeAlturas: 10,
  pasta: path.join('prints-hml', 'v9.3a-01-usabilidade-no-celular'),
}

// v9.3b: o notebook mais comum (1366 × 768); a janela do navegador tira uns 100 px da altura, por isso 660
export const NOTEBOOK: Aparelho = {
  nome: 'notebook',
  largura: 1366,
  altura: 660,
  celular: false,
  limiteDeAlturas: 5,
  pasta: path.join('prints-hml', 'v9.3b-01-usabilidade-no-notebook'),
}

/** O que se mede numa tela já aberta (roda dentro do navegador). */
async function medir(
  page: Page,
  ap: Aparelho,
): Promise<{ achados: Achado[]; alturas: number }> {
  return page.evaluate(
    ({ altura, largura, celular, limiteDeAlturas, nomeDoAparelho }) => {
      const W = largura
      const achados: { grave: boolean; tipo: string; detalhe: string }[] = []
      const nome = (el: Element) => {
        const rotulo =
          el.getAttribute('aria-label') ??
          el.getAttribute('placeholder') ??
          (el.textContent ?? '').trim().replace(/\s+/g, ' ')
        return `<${el.tagName.toLowerCase()}> "${rotulo.slice(0, 50)}"`
      }
      const visivel = (el: Element) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return (
          r.width > 1 &&
          r.height > 1 &&
          cs.visibility !== 'hidden' &&
          cs.display !== 'none' &&
          Number(cs.opacity) > 0
        )
      }
      // o menu lateral fechado fica fora da tela DE PROPÓSITO (abre pelo botão de menu)
      const noMenuFechado = (el: Element) => {
        const aside = el.closest('aside')
        return !!aside && aside.getBoundingClientRect().right <= 0
      }
      const temRolagemPropria = (el: Element) => {
        for (
          let p = el.parentElement;
          p && p !== document.body;
          p = p.parentElement
        ) {
          const ox = getComputedStyle(p).overflowX
          if (
            (ox === 'auto' || ox === 'scroll') &&
            p.scrollWidth > p.clientWidth + 1
          )
            return true
        }
        return false
      }

      const doc = document.documentElement
      if (doc.scrollWidth > W + 1) {
        // QUEM estica: o elemento que passa da tela cujo "pai" ainda cabe nela (ou rola sozinho) - aponta a peça a corrigir, não as que só foram empurradas
        const culpados: string[] = []
        for (const el of document.body.querySelectorAll('*')) {
          if (culpados.length >= 4 || noMenuFechado(el) || !visivel(el))
            continue
          const pai = el.parentElement
          if (!pai || el.getBoundingClientRect().right <= W + 1) continue
          // a barra fixa do topo acompanha a largura da página: é empurrada, não empurra
          if (getComputedStyle(el).position === 'fixed') continue
          const paiCabe =
            pai.getBoundingClientRect().right <= W + 1 ||
            ['auto', 'scroll'].includes(getComputedStyle(pai).overflowX)
          if (paiCabe && !temRolagemPropria(el))
            culpados.push(
              `${nome(el)} [${String(el.getAttribute('class') ?? '').slice(0, 90)}] até ${Math.round(el.getBoundingClientRect().right)} px`,
            )
        }
        achados.push({
          grave: true,
          tipo: 'a página rola de lado',
          detalhe: `${doc.scrollWidth} px de largura numa tela de ${W} px; quem estica: ${culpados.join(' | ') || '(não achado)'}`,
        })
      }

      const aside = document.querySelector('aside')
      if (celular && aside && aside.getBoundingClientRect().right > 0)
        achados.push({
          grave: true,
          tipo: 'menu lateral aberto ao chegar',
          detalhe:
            'no celular o menu tem de começar fechado (abre pelo botão de menu)',
        })

      const h1 = document.querySelector('main h1, h1')
      if (h1 && h1.getBoundingClientRect().top + window.scrollY > altura)
        achados.push({
          grave: true,
          tipo: 'título fora da primeira tela',
          detalhe: `${nome(h1)} começa a ${Math.round(h1.getBoundingClientRect().top + window.scrollY)} px do topo`,
        })

      const interativos = [
        ...document.querySelectorAll(
          'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"]',
        ),
      ].filter((el) => visivel(el) && !noMenuFechado(el))

      const cortados = new Set<string>()
      const pequenos = new Set<string>()
      const camposMiudos = new Set<string>()
      for (const el of interativos) {
        const r = el.getBoundingClientRect()
        if ((r.right > W + 1 || r.left < -1) && !temRolagemPropria(el))
          cortados.add(nome(el))
        const cs = getComputedStyle(el)
        const tipo = el.getAttribute('type') ?? ''
        const ehCampoDeTexto =
          (el.tagName === 'INPUT' &&
            ![
              'checkbox',
              'radio',
              'range',
              'file',
              'color',
              'hidden',
              'submit',
              'button',
            ].includes(tipo)) ||
          el.tagName === 'SELECT' ||
          el.tagName === 'TEXTAREA'
        if (ehCampoDeTexto && parseFloat(cs.fontSize) < 16)
          camposMiudos.add(`${nome(el)} (${cs.fontSize})`)
        // link no meio de um texto segue o tamanho da letra (exceção do critério 2.5.8)
        const linkNoTexto = el.tagName === 'A' && cs.display === 'inline'
        // a caixinha (ou a bolinha) dentro de um rótulo: tocar no rótulo também marca, então o alvo é o rótulo inteiro
        const rotulo =
          el.tagName === 'INPUT' && ['checkbox', 'radio'].includes(tipo)
            ? el.closest('label')
            : null
        const alvo = rotulo ? rotulo.getBoundingClientRect() : r
        if (!linkNoTexto && (alvo.width < 24 || alvo.height < 24))
          pequenos.add(
            `${nome(el)} (${Math.round(alvo.width)}×${Math.round(alvo.height)})`,
          )
      }
      if (cortados.size)
        achados.push({
          grave: true,
          tipo: 'cortado fora da tela',
          detalhe: [...cortados].slice(0, 8).join('; '),
        })
      if (celular && camposMiudos.size)
        achados.push({
          grave: true,
          tipo: 'campo com letra menor que 16 px (o iPhone amplia a tela ao tocar)',
          detalhe: [...camposMiudos].slice(0, 8).join('; '),
        })
      // no celular reprova (o dedo); no notebook é aviso: com mouse, o critério 2.5.8 aceita alvo menor com espaço em volta, e quem confere isso é o axe
      // (robô v9.1a-01, que mede o espaçamento)
      if (pequenos.size)
        achados.push({
          grave: celular,
          tipo: 'alvo de toque menor que 24 px',
          detalhe: `${pequenos.size}: ${[...pequenos].slice(0, 6).join('; ')}`,
        })

      const miuda = new Set<string>()
      for (const el of document.body.querySelectorAll('*')) {
        if (noMenuFechado(el) || !visivel(el)) continue
        const temTexto = [...el.childNodes].some(
          (n) =>
            n.nodeType === Node.TEXT_NODE &&
            (n.textContent ?? '').trim().length > 1,
        )
        if (temTexto && parseFloat(getComputedStyle(el).fontSize) < 12)
          miuda.add(`${nome(el)} (${getComputedStyle(el).fontSize})`)
      }
      if (miuda.size)
        achados.push({
          grave: true,
          tipo: 'letra menor que 12 px',
          detalhe: `${miuda.size}: ${[...miuda].slice(0, 6).join('; ')}`,
        })

      // palavra partida no meio: cada palavra de 4 letras ou mais do conteúdo, desenhada em mais de uma linha (o retângulo dela se divide em alturas diferentes)
      const partidas = new Set<string>()
      const andador = document.createTreeWalker(
        document.querySelector('main') ?? document.body,
        NodeFilter.SHOW_TEXT,
      )
      let vistas = 0
      for (
        let n = andador.nextNode();
        n && vistas < 4000;
        n = andador.nextNode()
      ) {
        const pai = n.parentElement
        if (!pai || !visivel(pai) || noMenuFechado(pai)) continue
        const texto = n.textContent ?? ''
        // só a palavra INTEIRA, feita só de letras (sem a pontuação das pontas); código técnico (SEGUNDA_VIA_DE_CARTEIRINHA), e-mail e lista de campos
        // não têm onde quebrar e quebram de propósito quando não cabem (5ª rodada, 05/11)
        for (const m of texto.matchAll(/\S+/gu)) {
          const nucleo = /^[^\p{L}]*([\p{L}]{4,})[^\p{L}]*$/u.exec(m[0])
          if (!nucleo) continue
          vistas++
          const inicio = m.index + m[0].indexOf(nucleo[1])
          const faixa = document.createRange()
          faixa.setStart(n, inicio)
          faixa.setEnd(n, inicio + nucleo[1].length)
          const linhas = new Set(
            [...faixa.getClientRects()]
              .filter((r) => r.width > 0)
              .map((r) => Math.round(r.top)),
          )
          if (linhas.size > 1) partidas.add(`"${nucleo[1]}" em ${nome(pai)}`)
        }
      }
      if (partidas.size)
        achados.push({
          grave: true,
          tipo: 'palavra partida no meio',
          detalhe: `${partidas.size}: ${[...partidas].slice(0, 6).join('; ')}`,
        })

      // nome técnico na tela (pedido do Presidente, 06/11: "a setinha embaixo" — o sublinhado — "dá a entender que aquilo é nome de uma tabela"):
      // palavra_com_sublinhado (nome de tabela, de campo, de catálogo) e CÓDIGO EM MAIÚSCULAS de 5 letras ou mais (PALESTRA no lugar de Palestra).
      // Fica de fora o que é técnico de propósito: dentro de <code>/<kbd>, e-mail e endereço da internet.
      const tecnicos = new Set<string>()
      const andador2 = document.createTreeWalker(
        document.querySelector('main') ?? document.body,
        NodeFilter.SHOW_TEXT,
      )
      for (let n = andador2.nextNode(); n; n = andador2.nextNode()) {
        const pai = n.parentElement
        if (!pai || !visivel(pai) || noMenuFechado(pai)) continue
        if (pai.closest('code, kbd, pre, [data-tecnico], [data-ambiente]'))
          continue
        // v9.3v: o texto EXATO que a pessoa leu ou assinou (aviso de privacidade, termo): o destaque em maiúsculas é do texto legal ("CRIANÇA OU
        // ADOLESCENTE:"), não código — ali só a palavra_com_sublinhado conta
        const textoFiel = pai.closest('[data-texto-fiel]') !== null
        for (const m of (n.textContent ?? '').matchAll(/\S+/gu)) {
          const palavra = m[0]
          // e-mail, endereço, marcador que a pessoa digita ({primeiro_nome}) e sigla conhecida não são nome técnico
          if (/@|:\/\/|^www\.|[{}]/.test(palavra)) continue
          if (/^\W*(HTTPS|WCAG)\W*$/.test(palavra)) continue
          const sub = /[\p{L}\d]+(?:_[\p{L}\d]+)+/u.exec(palavra)
          if (sub) tecnicos.add(sub[0])
          else if (!textoFiel) {
            const maiusc = /^[^\p{L}]*(\p{Lu}{5,})[^\p{L}]*$/u.exec(palavra)
            if (maiusc) tecnicos.add(maiusc[1]!)
          }
        }
      }
      if (tecnicos.size)
        achados.push({
          grave: false,
          tipo: 'nome técnico na tela',
          detalhe: `${tecnicos.size}: ${[...tecnicos].slice(0, 40).join(', ')}`,
        })

      const telas = doc.scrollHeight / altura
      if (telas > limiteDeAlturas)
        achados.push({
          grave: false,
          tipo: `tela muito longa no ${nomeDoAparelho}`,
          detalhe: `${telas.toFixed(1)} alturas de ${nomeDoAparelho} (o limite é ${limiteDeAlturas})`,
        })

      const tabelasLargas = [...document.querySelectorAll('table')].filter(
        (t) => visivel(t) && !noMenuFechado(t) && t.scrollWidth > W,
      ).length
      if (tabelasLargas)
        achados.push({
          grave: false,
          tipo: 'tabela que só se lê rolando de lado',
          detalhe: `${tabelasLargas} tabela(s)`,
        })
      return { achados, alturas: +telas.toFixed(1) }
    },
    {
      altura: ap.altura,
      largura: ap.largura,
      celular: ap.celular,
      limiteDeAlturas: ap.limiteDeAlturas,
      nomeDoAparelho: ap.nome,
    },
  )
}

async function fotografar(
  page: Page,
  ap: Aparelho,
  numero: number,
  caminho: string,
) {
  const nome = `${String(numero).padStart(3, '0')}-${
    padrao(caminho)
      .replace(/[^a-zA-Z0-9À-ÿ]+/g, '-')
      .replace(/^-|-$/g, '') || 'inicio'
  }.png`
  const arquivo = path.join(ap.pasta, nome)
  try {
    await page.screenshot({ path: arquivo, fullPage: true, scale: 'css' })
  } catch {
    // tela alta demais para fotografar inteira: fica a parte de cima
    await page.screenshot({ path: arquivo, fullPage: false, scale: 'css' })
  }
  return nome
}

/** Abre todas as telas do painel neste aparelho, mede cada uma, tira o print e reprova se houver achado grave. */
export async function varrer(
  page: Page,
  info: TestInfo,
  ap: Aparelho,
): Promise<void> {
  test.setTimeout(60 * 60_000)
  fs.mkdirSync(ap.pasta, { recursive: true })
  await entrar(page, 'presidente')
  const visitados = new Set<string>()
  const fila: string[] = ['/', ...ROTAS_PESSOAIS]
  const relatorio: {
    caminho: string
    print: string
    alturas: number
    achados: Achado[]
  }[] = []
  const naoAbriram: string[] = []

  while (fila.length > 0 && visitados.size < LIMITE) {
    const caminho = fila.shift()!
    if (PULAR.test(caminho) || visitados.has(padrao(caminho))) continue
    visitados.add(padrao(caminho))
    await page.goto(caminho)
    try {
      await esperarATela(page)
    } catch {
      naoAbriram.push(`${caminho}: ficou em "Carregando"`)
      continue
    }
    const final = new URL(page.url()).pathname
    if (final === '/login') throw new Error(`a sessão caiu ao abrir ${caminho}`)
    const { achados, alturas } = await medir(page, ap)
    const print = await fotografar(page, ap, visitados.size, final)
    relatorio.push({ caminho: final, print, alturas, achados })
    for (const link of await linksInternos(page)) {
      if (!visitados.has(padrao(link)) && !PULAR.test(link)) fila.push(link)
    }
  }

  // v9.5b: no celular, o Início não tem coluna: a barra de baixo fica sempre à vista e os atalhos pessoais abrem pela lista suspensa do botão com o nome;
  // dentro de um módulo, a coluna do módulo abre pelo botão "Abrir menu" (conferido uma vez cada)
  if (ap.celular) {
    await page.goto('/')
    await esperarATela(page)
    await expect(
      page.getByRole('navigation', { name: 'Navegação principal' }),
    ).toBeVisible()
    await page.getByRole('button', { name: /menu pessoal/i }).click()
    await expect(
      page.getByRole('navigation', { name: 'Menu pessoal' }),
    ).toBeVisible()
    await page.screenshot({
      path: path.join(ap.pasta, '000-menu-pessoal-no-celular.png'),
      scale: 'css',
    })
    await page.goto('/associados')
    await esperarATela(page)
    const menu = page.locator('aside')
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    await expect
      .poll(async () => (await menu.boundingBox())?.x ?? -999)
      .toBeGreaterThanOrEqual(0)
    await page.screenshot({
      path: path.join(ap.pasta, '000-menu-do-modulo-no-celular.png'),
      scale: 'css',
    })
  }

  const graves = relatorio.flatMap((r) =>
    r.achados
      .filter((a) => a.grave)
      .map((a) => `${r.caminho}: ${a.tipo} — ${a.detalhe}`),
  )
  const avisos = relatorio.flatMap((r) =>
    r.achados
      .filter((a) => !a.grave)
      .map((a) => `${r.caminho}: ${a.tipo} — ${a.detalhe}`),
  )
  const texto = [
    `${relatorio.length} telas abertas num ${ap.nome} de ${ap.largura} × ${ap.altura} px (um print de cada nesta pasta):`,
    ...relatorio.map(
      (r) => `  ${r.print}  ${r.caminho}  (${r.alturas} alturas)`,
    ),
    '',
    `GRAVES (${graves.length}):`,
    ...graves,
    '',
    `AVISOS (${avisos.length}):`,
    ...avisos,
    '',
    ...naoAbriram,
  ].join('\n')
  fs.writeFileSync(
    path.join(ap.pasta, 'relatorio-de-usabilidade.txt'),
    texto,
    'utf-8',
  )
  fs.writeFileSync(
    path.join(ap.pasta, 'relatorio-de-usabilidade.json'),
    JSON.stringify(
      {
        aparelho: ap.nome,
        largura: ap.largura,
        altura: ap.altura,
        telas: relatorio,
        naoAbriram,
      },
      null,
      2,
    ),
    'utf-8',
  )
  await info.attach('relatorio-de-usabilidade', {
    path: path.join(ap.pasta, 'relatorio-de-usabilidade.txt'),
    contentType: 'text/plain',
  })

  expect(
    visitados.size,
    'o robô achou poucas telas: o menu mudou?',
  ).toBeGreaterThanOrEqual(60)
  expect(naoAbriram, naoAbriram.join('\n')).toEqual([])
  expect(graves, texto).toEqual([])
}
