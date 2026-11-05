import fs from 'node:fs'
import path from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { entrar, exigirHomologacao } from './apoio'
import { esperarATela, linksInternos, padrao, PULAR } from './varredura'

// v9.3a - USABILIDADE NO CELULAR, verificada de forma virtual (decisão do Presidente, 05/11: não há como reunir 3 a 5 pessoas reais; o robô simula o uso
// e tira o print de cada tela para ele conferir depois, "celular em primeiro lugar"). Num celular de 360 px (o Android mais comum e o mais estreito que se
// usa hoje), com toque, o robô entra como Presidente, abre TODAS as telas seguindo os links do painel e mede, em cada uma, o que atrapalha quem usa o telefone:
//   GRAVE (reprova): a página rola de lado; botão, campo ou link cortado fora da tela (sem rolagem própria para alcançá-lo); campo com letra menor que 16 px
//   (o iPhone amplia a tela sozinho ao tocar); o título da tela fora da primeira tela; o menu lateral aberto por cima do conteúdo ao chegar; alvo de toque
//   menor que 24 px (critério 2.5.8 da WCAG 2.2; a caixinha dentro de um rótulo conta pelo rótulo, que também marca; link no meio do texto é exceção);
//   letra menor que 12 px. (Os dois últimos foram AVISO na 1ª rodada, 05/11: 69 alvos e 124 letras, todos corrigidos; passaram a reprovar.)
//   AVISO (vai para o relatório, sem reprovar): tela com mais de 10 alturas de celular; tabela que só se lê rolando de lado.
// Os prints (um por tela, a página inteira) e o relatório ficam na pasta da execução, para o Presidente olhar quando puder.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())

const LARGURA = 360
const ALTURA = 740
test.use({
  viewport: { width: LARGURA, height: ALTURA },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
})

const LIMITE = 220
const PASTA = path.join('prints-hml', 'v9.3a-01-usabilidade-no-celular')

type Achado = { grave: boolean; tipo: string; detalhe: string }

/** O que se mede numa tela já aberta (roda dentro do navegador). */
async function medir(page: Page): Promise<Achado[]> {
  return page.evaluate(
    ({ altura, largura }) => {
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
      if (aside && aside.getBoundingClientRect().right > 0)
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
      if (camposMiudos.size)
        achados.push({
          grave: true,
          tipo: 'campo com letra menor que 16 px (o iPhone amplia a tela ao tocar)',
          detalhe: [...camposMiudos].slice(0, 8).join('; '),
        })
      if (pequenos.size)
        achados.push({
          grave: true,
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

      const telas = doc.scrollHeight / altura
      if (telas > 10)
        achados.push({
          grave: false,
          tipo: 'tela muito longa no celular',
          detalhe: `${telas.toFixed(1)} alturas de celular`,
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
      return achados
    },
    { altura: ALTURA, largura: LARGURA },
  )
}

async function fotografar(page: Page, numero: number, caminho: string) {
  const nome = `${String(numero).padStart(3, '0')}-${
    padrao(caminho)
      .replace(/[^a-zA-Z0-9À-ÿ]+/g, '-')
      .replace(/^-|-$/g, '') || 'inicio'
  }.png`
  const arquivo = path.join(PASTA, nome)
  try {
    await page.screenshot({ path: arquivo, fullPage: true, scale: 'css' })
  } catch {
    // tela alta demais para fotografar inteira: fica a parte de cima
    await page.screenshot({ path: arquivo, fullPage: false, scale: 'css' })
  }
  return nome
}

test('todas as telas do painel num celular de 360 px: nada rola de lado, nada cortado, campos sem zoom do iPhone, título na primeira tela', async ({
  page,
}, info) => {
  test.setTimeout(60 * 60_000)
  fs.mkdirSync(PASTA, { recursive: true })
  await entrar(page, 'presidente')
  const visitados = new Set<string>()
  const fila: string[] = ['/']
  const relatorio: { caminho: string; print: string; achados: Achado[] }[] = []
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
    const achados = await medir(page)
    const print = await fotografar(page, visitados.size, final)
    relatorio.push({ caminho: final, print, achados })
    for (const link of await linksInternos(page)) {
      if (!visitados.has(padrao(link)) && !PULAR.test(link)) fila.push(link)
    }
  }

  // o menu do celular abre pelo botão e fecha ao escolher uma tela (conferido uma vez, no Início)
  await page.goto('/')
  await esperarATela(page)
  const menu = page.locator('aside')
  await page.getByRole('button', { name: /menu/i }).first().click()
  await expect
    .poll(async () => (await menu.boundingBox())?.x ?? -999)
    .toBeGreaterThanOrEqual(0)
  await page.screenshot({
    path: path.join(PASTA, '000-menu-aberto-no-celular.png'),
    scale: 'css',
  })

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
    `${relatorio.length} telas abertas num celular de ${LARGURA} px (um print de cada nesta pasta):`,
    ...relatorio.map((r) => `  ${r.print}  ${r.caminho}`),
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
    path.join(PASTA, 'relatorio-de-usabilidade.txt'),
    texto,
    'utf-8',
  )
  fs.writeFileSync(
    path.join(PASTA, 'relatorio-de-usabilidade.json'),
    JSON.stringify({ largura: LARGURA, telas: relatorio, naoAbriram }, null, 2),
    'utf-8',
  )
  await info.attach('relatorio-de-usabilidade', {
    path: path.join(PASTA, 'relatorio-de-usabilidade.txt'),
    contentType: 'text/plain',
  })

  expect(
    visitados.size,
    'o robô achou poucas telas: o menu mudou?',
  ).toBeGreaterThanOrEqual(60)
  expect(naoAbriram, naoAbriram.join('\n')).toEqual([])
  expect(graves, texto).toEqual([])
})
