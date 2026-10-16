// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DadosDoPix } from '../src/lib/doacao'
import {
  TEXTO_DA_COPIA_MANUAL,
  TEXTO_DA_COPIA_OK,
  copiarTexto,
  criarPainelDoPix,
  textoDoValor,
} from '../src/lib/doacao-pix-dom'
import { matrizDoCaminho } from '../src/lib/qr-pix'
import { lerMatriz } from './ajuda-qr'

const CODIGO =
  '00020126730014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740000211Doacao ASAF520400005303986540550.005802BR5910ASAF TESTE6011PARAUAPEBAS62130509ASAFCAMP163046DB5'

const dados = (extra: Partial<DadosDoPix> = {}): DadosDoPix => ({
  copia_e_cola: CODIGO,
  chave_pix: '123e4567-e89b-12d3-a456-426614174000',
  beneficiario: 'ASAF TESTE',
  cidade: 'PARAUAPEBAS',
  valor: 50,
  id_campanha: 1,
  ...extra,
})

const semEspacoEspecial = (texto: string | null | undefined) =>
  (texto ?? '').replace(/\s/g, ' ')

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('criarPainelDoPix', () => {
  it('mostra o código em texto, a chave, o beneficiário e a cidade, o valor e os passos', () => {
    const painel = criarPainelDoPix(dados())
    document.body.append(painel)
    expect(painel.querySelector('[data-codigo-pix]')!.textContent).toBe(CODIGO)
    expect(painel.querySelector('[data-chave-pix]')!.textContent).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    )
    expect(painel.querySelector('[data-beneficiario]')!.textContent).toBe(
      'ASAF TESTE',
    )
    expect(painel.querySelector('[data-cidade]')!.textContent).toBe(
      'PARAUAPEBAS',
    )
    expect(
      semEspacoEspecial(painel.querySelector('[data-valor-pix]')!.textContent),
    ).toBe('Valor: R$ 50,00. Ele já está dentro do código.')
    expect(painel.querySelectorAll('ol li')).toHaveLength(3)
    expect(painel.textContent).toContain(
      'confira se o nome de quem vai receber é o da ASAF',
    )
    expect(painel.querySelector('h4')!.textContent).toBe('Pague pelo Pix')
  })

  it('sem valor, diz que a pessoa digita o valor no aplicativo do banco', () => {
    const painel = criarPainelDoPix(dados({ valor: null }))
    expect(painel.querySelector('[data-valor-pix]')!.textContent).toBe(
      'Sem valor definido: você digita o valor no aplicativo do seu banco.',
    )
    expect(textoDoValor(null)).toContain('você digita o valor')
  })

  it('o QR Code tem texto alternativo e carrega exatamente o código que está escrito ao lado', () => {
    const painel = criarPainelDoPix(dados())
    const svg = painel.querySelector('svg')!
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toContain('QR Code do Pix')
    expect(svg.getAttribute('aria-label')).toContain('escrito logo abaixo')
    const lado = Number(svg.getAttribute('viewBox')!.split(' ')[2])
    const lido = lerMatriz(
      matrizDoCaminho(svg.querySelector('path')!.getAttribute('d')!, lado),
    )
    expect(lido).toBe(painel.querySelector('[data-codigo-pix]')!.textContent)
    expect(lido).toBe(CODIGO)
  })

  it('texto que não cabe num QR Code: o código escrito continua lá e a página avisa', () => {
    const enorme = 'A'.repeat(9000)
    const painel = criarPainelDoPix(dados({ copia_e_cola: enorme }))
    expect(painel.querySelector('svg')).toBeNull()
    expect(painel.querySelector('[data-qr]')!.textContent).toContain(
      'Não foi possível desenhar o QR Code. Use o código escrito abaixo.',
    )
    expect(painel.querySelector('[data-codigo-pix]')!.textContent).toBe(enorme)
  })

  it('dois painéis na mesma página não repetem id', () => {
    const a = criarPainelDoPix(dados())
    const b = criarPainelDoPix(dados())
    document.body.append(a, b)
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('tudo o que vem da API entra como texto, nunca como HTML', () => {
    const painel = criarPainelDoPix(
      dados({
        beneficiario: '<img src=x onerror=alert(1)>',
        cidade: '<b>cidade</b>',
        chave_pix: '<script>alert(1)</script>',
      }),
    )
    document.body.append(painel)
    expect(painel.querySelector('img')).toBeNull()
    expect(painel.querySelector('b')).toBeNull()
    expect(painel.querySelector('script')).toBeNull()
    expect(painel.querySelector('[data-beneficiario]')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    )
  })
})

describe('copiar o código', () => {
  it('o botão copia o código inteiro e avisa em uma região role="status"', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined)
    const painel = criarPainelDoPix(dados(), {
      clipboard: { writeText: escrever },
    })
    document.body.append(painel)
    const aviso = painel.querySelector<HTMLElement>('[data-aviso-da-copia]')!
    expect(aviso.getAttribute('role')).toBe('status')
    expect(aviso.textContent).toBe('')
    painel.querySelector<HTMLButtonElement>('[data-copiar-codigo]')!.click()
    await vi.waitFor(() => expect(aviso.textContent).toBe(TEXTO_DA_COPIA_OK))
    expect(escrever).toHaveBeenCalledExactlyOnceWith(CODIGO)
  })

  it('sem área de transferência: seleciona o texto e usa o comando antigo de copiar', async () => {
    const painel = criarPainelDoPix(dados(), { clipboard: null })
    document.body.append(painel)
    const comando = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      value: comando,
      configurable: true,
    })
    const aviso = painel.querySelector<HTMLElement>('[data-aviso-da-copia]')!
    painel.querySelector<HTMLButtonElement>('[data-copiar-codigo]')!.click()
    await vi.waitFor(() => expect(aviso.textContent).toBe(TEXTO_DA_COPIA_OK))
    expect(comando).toHaveBeenCalledWith('copy')
    expect(window.getSelection()!.toString()).toBe(CODIGO)
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('permissão negada e comando antigo também falham: o texto fica selecionado e a mensagem ensina a copiar com o dedo', async () => {
    const painel = criarPainelDoPix(dados(), {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) },
    })
    document.body.append(painel)
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    })
    const aviso = painel.querySelector<HTMLElement>('[data-aviso-da-copia]')!
    painel.querySelector<HTMLButtonElement>('[data-copiar-codigo]')!.click()
    await vi.waitFor(() =>
      expect(aviso.textContent).toBe(TEXTO_DA_COPIA_MANUAL),
    )
    expect(window.getSelection()!.toString()).toBe(CODIGO)
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('copiarTexto devolve se copiou de verdade (e não explode sem nenhum recurso)', async () => {
    expect(
      await copiarTexto('x', null, {
        clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
      }),
    ).toBe(true)
    expect(await copiarTexto('x', null, { clipboard: null })).toBe(false)
    const elemento = document.createElement('p')
    elemento.textContent = 'x'
    document.body.append(elemento)
    // jsdom não tem `document.execCommand`: o que sobra é a seleção, e o resultado é "não copiou"
    expect(await copiarTexto('x', elemento, { clipboard: null })).toBe(false)
  })
})
