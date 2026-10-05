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

export type Papel = 'presidente' | 'secretario' | 'tesoureiro'

// CPFs inventados (não são segredo; estão no HOMOLOGACAO.md). As senhas vêm do cofre pelo fluxo.
const CPF: Record<Papel, string> = {
  presidente: '111.000.111-88',
  secretario: '222.023.757-59',
  tesoureiro: '222.039.595-25',
}

function senhaDe(papel: Papel): string {
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
