import fs from 'node:fs'
import path from 'node:path'

import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

// Apoio dos roteiros de conferência ao vivo na homologação (v5.4c em diante). Nada aqui conhece a produção: o endereço é conferido
// em playwright.hml.config.ts e de novo em `exigirHomologacao`.

export type Papel =
  | 'presidente'
  | 'secretario'
  | 'tesoureiro'
  // quem tem cargo de verdade na diretoria (Ana Lúcia = Presidente do cargo, Bruno = 1º Vice, Carla = 2ª Vice) e no Conselho Fiscal (Heitor):
  // existem para o que depende de várias pessoas (quórum de decisão da disciplina, parecer do Conselho Fiscal)
  | 'cargo_presidente'
  | 'vice_presidente'
  | 'vice_presidente_2'
  | 'conselheiro'
  // os outros dois do Conselho Fiscal (Art. 24: três membros): a auditoria financeira só aprova e trava com a maioria, 2 de 3
  | 'conselheiro_2'
  | 'conselheiro_3'

// CPFs inventados (não são segredo; estão no HOMOLOGACAO.md). As senhas vêm do cofre pelo fluxo.
const CPF: Record<Papel, string> = {
  presidente: '111.000.111-88',
  secretario: '222.023.757-59',
  tesoureiro: '222.039.595-25',
  cargo_presidente: '222.000.000-14',
  vice_presidente: '222.007.919-84',
  vice_presidente_2: '222.015.838-11',
  conselheiro: '222.055.433-34',
  conselheiro_2: '222.063.352-71',
  conselheiro_3: '222.071.271-09',
}

/** A senha de teste do papel (do cofre, pelo fluxo). Nunca é impressa nem anexada; só vai para a API de teste, quando o roteiro dá acesso a alguém. */
export function senhaDe(papel: Papel): string {
  const senha =
    papel === 'presidente'
      ? process.env.HML_ADMIN_SENHA
      : (
          JSON.parse(process.env.HML_USUARIOS_JSON ?? '{}') as Record<
            string,
            string
          >
        )[papel]
  if (!senha) {
    throw new Error(
      `Falta a senha de teste do papel ${papel}: o fluxo testar-homologacao.yml a lê do cofre.`,
    )
  }
  return senha
}

export function exigirHomologacao(): void {
  const alvo = process.env.HML_PAINEL_URL ?? 'https://hml-painel.asaf.org.br'
  if (new URL(alvo).hostname !== 'hml-painel.asaf.org.br') {
    throw new Error(`RECUSADO: só a homologação, não ${alvo}.`)
  }
}

/**
 * Entra pelo caminho de verdade (CPF e senha, na tela). O passo é "boxed": o relatório não mostra o que foi digitado,
 * então a senha de teste nunca aparece nos arquivos de resultado.
 */
export async function entrar(page: Page, papel: Papel): Promise<void> {
  await test.step(
    `entrar como ${papel}`,
    async () => {
      await page.goto('/login')
      await page.getByLabel('CPF').fill(CPF[papel])
      await page.getByLabel('Senha').fill(senhaDe(papel))
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
    },
    { box: true },
  )
}

export async function sair(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

/** Print da tela inteira, numerado, guardado em prints-hml/<roteiro>/ e anexado ao relatório. */
export async function ver(
  page: Page,
  info: TestInfo,
  nome: string,
): Promise<void> {
  // print de tela "Carregando…" não prova nada: espera o dado chegar (uma tela travada nisso é defeito e reprova aqui)
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  const roteiro = path.basename(info.file).replace(/\.spec\.ts$/, '')
  const pasta = path.join('prints-hml', roteiro)
  fs.mkdirSync(pasta, { recursive: true })
  const numero = String(fs.readdirSync(pasta).length + 1).padStart(2, '0')
  const arquivo = path.join(
    pasta,
    `${numero}-${nome.replace(/[^a-zA-Z0-9À-ÿ]+/g, '-').slice(0, 70)}.png`,
  )
  await page.screenshot({ path: arquivo, fullPage: true })
  await info.attach(nome, { path: arquivo, contentType: 'image/png' })
}

/** Junta o que deu errado de verdade durante o roteiro: erro de página e resposta 5xx (4xx esperado é parte do teste). */
export function vigiar(page: Page): { problemas: () => string[] } {
  const achados: string[] = []
  page.on('pageerror', (erro) =>
    achados.push(`erro na página: ${erro.message}`),
  )
  page.on('response', (resposta) => {
    if (resposta.status() >= 500) {
      achados.push(
        `${resposta.status()} em ${resposta.request().method()} ${resposta.url()}`,
      )
    }
  })
  return { problemas: () => achados }
}

/** A API de TESTE (nunca a de produção). O robô só a usa onde o sistema ainda não tem tela de entrada (ex.: o formulário público do site). */
export const API_HML = 'https://hml-api.asaf.org.br'

/** Cadastra um associado pelo formulário (Novo associado); com `forcar`, aperta "cadastrar mesmo assim" depois do aviso de cadastro parecido. */
export async function cadastrarPelaTela(
  page: Page,
  d: {
    nome: string
    cpf: string
    email: string
    telefone?: string
    nascimento?: string
    forcar?: boolean
  },
) {
  await page.goto('/associados/novo')
  await campo(page, 'Nome completo *').fill(d.nome)
  await campo(page, 'CPF *').fill(d.cpf)
  await campo(page, 'E-mail *').fill(d.email)
  await campo(page, 'Telefone (WhatsApp) *').fill(d.telefone ?? '91911112222')
  await campo(page, 'Categoria *').selectOption({ index: 1 })
  if (d.nascimento) await campo(page, 'Data de nascimento').fill(d.nascimento)
  await campo(page, 'CEP *').fill('68515000')
  await campo(page, 'Logradouro *').fill('Rua das Flores de Teste')
  await campo(page, 'Número *').fill('5')
  await campo(page, 'Bairro *').fill('Bairro de Teste')
  await campo(page, 'Cidade *').fill('Parauapebas')
  await campo(page, 'Estado (UF) *').fill('PA')
  await page.getByRole('button', { name: 'Cadastrar associado' }).click()
  if (d.forcar) {
    await expect(page.getByRole('alert').first()).toContainText(
      'Já existe um cadastro parecido',
    )
    await page.getByRole('button', { name: /Cadastrar mesmo assim/ }).click()
  }
  await expect(page).toHaveURL(/\/associados$/)
}

/** O aviso de sucesso de uma tela (a faixa AMBIENTE DE TESTE também tem papel de aviso: por isso a busca é pelo <p>). */
export const AVISO = 'p[role="status"]'

/** A faixa fixa "AMBIENTE DE TESTE" (painel/src/components/layout/AvisoDeAmbiente.tsx). */
export const FAIXA_DE_TESTE = '[data-ambiente="homologacao"]'

/** Campo de formulário pelo texto do rótulo (os formulários do painel não ligam `label` ao `input`, então `getByLabel` não acha). */
export function campo(page: Page, rotulo: string): Locator {
  return page.locator(
    `label:text-is("${rotulo}") + :is(input, select, textarea)`,
  )
}

/** CPF com dígitos verificadores certos, no formato 000.000.000-00, a partir de um número de 9 dígitos (inventado). */
export function cpfValido(base: number): string {
  const digitos = String(base).padStart(9, '0').split('').map(Number)
  for (const tamanho of [9, 10]) {
    const soma = digitos
      .slice(0, tamanho)
      .reduce((acc, d, i) => acc + d * (tamanho + 1 - i), 0)
    digitos.push(((soma * 10) % 11) % 10)
  }
  const t = digitos.join('')
  return `${t.slice(0, 3)}.${t.slice(3, 6)}.${t.slice(6, 9)}-${t.slice(9)}`
}

/** Um número que muda a cada rodada: nomes e CPFs novos para o roteiro poder rodar de novo sem reiniciar o banco de teste. */
export const RODADA = Date.now()

/** Foto de verdade (JPEG gerado pelo próprio navegador), para subir pela tela. */
export async function fotoDeTeste(page: Page, rotulo: string): Promise<Buffer> {
  const base64 = await page.evaluate((texto) => {
    const tela = document.createElement('canvas')
    tela.width = 640
    tela.height = 480
    const c = tela.getContext('2d')!
    c.fillStyle = '#2563eb'
    c.fillRect(0, 0, 640, 480)
    c.fillStyle = '#ffffff'
    c.font = '28px sans-serif'
    c.fillText(`FOTO DE TESTE (inventada) - ${texto}`, 24, 240)
    return tela.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
  }, rotulo)
  return Buffer.from(base64, 'base64')
}

/**
 * Inventário da tela atual (títulos, botões, links, campos com o rótulo, cabeçalhos de tabela), gravado em prints-hml/<roteiro>/inventario-<nome>.txt
 * e anexado ao relatório. Serve para conhecer, na homologação de verdade, o que cada tela oferece antes de escrever o roteiro dela; e, como o
 * robô só chega à tela se ela abre sem erro, vira também uma conferência de que a tela abre.
 */
export async function inventariar(
  page: Page,
  info: TestInfo,
  nome: string,
): Promise<string> {
  await expect(page.getByText(/^Carregando/)).toHaveCount(0)
  const dados = await page.evaluate(() => {
    const texto = (el: Element | null) =>
      (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const unicos = (lista: string[]) => [...new Set(lista.filter(Boolean))]
    const rotuloDe = (campo: Element): string => {
      const id = campo.getAttribute('id')
      const porId = id ? document.querySelector(`label[for="${id}"]`) : null
      const anterior = campo.previousElementSibling
      return (
        campo.getAttribute('aria-label') ||
        texto(porId) ||
        (anterior?.tagName === 'LABEL' ? texto(anterior) : '') ||
        texto(campo.closest('label')) ||
        campo.getAttribute('placeholder') ||
        campo.getAttribute('name') ||
        ''
      )
    }
    // campo SEM rótulo de verdade: o navegador (`labels`) é quem diz o que um leitor de tela vai ler. Rótulo parado AO LADO, sem `for` nem envolver
    // o campo, não conta; o `name` técnico também não.
    const semRotuloReal = (campo: Element): boolean => {
      if (campo.getAttribute('type') === 'hidden') return false
      const controle = campo as HTMLInputElement
      return !(
        (controle.labels && controle.labels.length > 0) ||
        campo.getAttribute('aria-label') ||
        campo.getAttribute('aria-labelledby') ||
        campo.getAttribute('placeholder') ||
        campo.getAttribute('title')
      )
    }
    const semRotulo = [...document.querySelectorAll('input, select, textarea')]
      .filter(semRotuloReal)
      .map(
        (c) =>
          `${c.tagName.toLowerCase()} name=${c.getAttribute('name') ?? ''}`,
      )
    const campos = [
      ...document.querySelectorAll('input, select, textarea'),
    ].map(
      (c) =>
        `${c.tagName.toLowerCase()}${c.getAttribute('type') ? `[${c.getAttribute('type')}]` : ''}: ${rotuloDe(c)}`,
    )
    return {
      titulos: unicos([...document.querySelectorAll('h1, h2, h3')].map(texto)),
      botoes: unicos(
        [...document.querySelectorAll('button')].map(
          (b) => texto(b) || b.getAttribute('aria-label') || '',
        ),
      ),
      links: unicos(
        [...document.querySelectorAll('main a, aside a')].map(
          (a) => `${texto(a)} -> ${a.getAttribute('href')}`,
        ),
      ),
      campos: unicos(campos),
      colunas: unicos([...document.querySelectorAll('th')].map(texto)),
      avisos: unicos(
        [...document.querySelectorAll('[role="alert"], p[role="status"]')].map(
          texto,
        ),
      ),
      semRotulo,
    }
  })
  const linhas = [
    `URL: ${page.url()}`,
    `TÍTULOS: ${dados.titulos.join(' | ')}`,
    `BOTÕES: ${dados.botoes.join(' | ')}`,
    `CAMPOS: ${dados.campos.join(' | ')}`,
    `COLUNAS: ${dados.colunas.join(' | ')}`,
    `LINKS: ${dados.links.slice(0, 40).join(' | ')}`,
    `AVISOS: ${dados.avisos.join(' | ')}`,
    `SEM RÓTULO: ${dados.semRotulo.join(' | ')}`,
  ].join('\n')
  const roteiro = path.basename(info.file).replace(/\.spec\.ts$/, '')
  const pasta = path.join('prints-hml', roteiro)
  fs.mkdirSync(pasta, { recursive: true })
  const arquivo = path.join(
    pasta,
    `inventario-${nome.replace(/[^a-zA-Z0-9]+/g, '-')}.txt`,
  )
  fs.writeFileSync(arquivo, linhas, 'utf-8')
  await info.attach(`inventario ${nome}`, {
    path: arquivo,
    contentType: 'text/plain',
  })
  expect(
    dados.semRotulo,
    `campo(s) sem rótulo acessível em "${nome}": quem usa leitor de tela não sabe o que preencher`,
  ).toEqual([])
  return linhas
}

/** Escolhe, num <select>, a opção cujo texto contém `trecho` (as opções de associado têm o nome completo). */
export async function escolherPorTexto(
  seletor: Locator,
  trecho: string,
): Promise<void> {
  const valor = await seletor.evaluate((el, t) => {
    const opcao = [...(el as HTMLSelectElement).options].find((o) =>
      o.textContent?.includes(t),
    )
    return opcao?.value ?? null
  }, trecho)
  if (valor === null)
    throw new Error(`opção com "${trecho}" não existe neste campo`)
  await seletor.selectOption(valor)
}

/**
 * Na sessão de assembleia, credencia (marca presença) quem faltar até o quórum de instalação ser atingido. Lê "credenciados / mínimo exigido"
 * da própria tela, então serve para qualquer tamanho de base. Devolve o mínimo exigido.
 */
export async function atingirQuorum(page: Page): Promise<number> {
  const placar = page.getByText(/^\d+ \/ \d+$/).first()
  for (let i = 0; i < 150; i += 1) {
    const [credenciados, minimo] = (await placar.innerText())
      .split('/')
      .map((n) => Number(n.trim())) as [number, number]
    if (credenciados >= minimo) return minimo
    await page.getByRole('button', { name: 'Marcar presença' }).first().click()
    await expect(placar).toHaveText(new RegExp(`^${credenciados + 1} / `))
  }
  throw new Error(
    'o quórum não foi atingido nem credenciando todos os faltantes',
  )
}
