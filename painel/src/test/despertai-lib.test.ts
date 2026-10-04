import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  apagarFotoDoEvento,
  caminhoDaFotoDoEvento,
  criarProjeto,
  editarEvento,
  editarProjeto,
  enviarFotoDoEvento,
  listarFotosDoEvento,
} from '@/lib/api'
import { clearSession, setAccessToken } from '@/lib/auth'
import {
  diaDoProjeto,
  enderecoDoNovoRelatorio,
  fraseDaPublicacaoNoProjeto,
} from '@/lib/contexto'
import {
  frasePertenceA,
  listarDocumentos,
  rotuloDoVinculo,
} from '@/lib/documentos'
import { mensagemDoErro } from '@/lib/erro-da-api'
import { eventoCriarSchema, projetoCriarSchema } from '@/lib/schemas'

import { evento, projeto } from './fabricas-despertai'

// Despertai e o contexto do evento (v5.5) - a parte sem tela: chamadas à API, textos e conferência dos formulários.

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('chamadas à API do contexto do evento', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    setAccessToken('token-de-teste')
    fetchMock = vi.fn().mockImplementation(async () => resposta([]))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearSession()
  })

  const ultima = () => {
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    return { url, init }
  }

  it('editar projeto: PUT /api/projetos/{id} só com o que mudou', async () => {
    fetchMock.mockImplementation(async () => resposta(projeto()))
    await editarProjeto(3, { descricao: 'Novo texto', destaque_no_site: true })
    const { url, init } = ultima()
    expect(url).toMatch(/\/api\/projetos\/3$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({
      descricao: 'Novo texto',
      destaque_no_site: true,
    })
  })

  it('criar projeto leva destaque_no_site', async () => {
    fetchMock.mockImplementation(async () =>
      resposta({ mensagem: 'ok', id_projeto: 9 }),
    )
    await criarProjeto({
      nome_projeto: 'Despertai',
      tipo_foco: 'Social',
      necessita_alvara_bombeiros: false,
      data_inicio: '2026-10-01',
      data_fim_prevista: '2026-12-31',
      visibilidade: 'Pública',
      destaque_no_site: true,
    })
    const { url, init } = ultima()
    expect(url).toMatch(/\/projetos\/$/)
    expect(JSON.parse(init.body as string)).toMatchObject({
      destaque_no_site: true,
    })
  })

  it('editar evento: PUT /api/eventos/{id}; null desliga do projeto', async () => {
    fetchMock.mockImplementation(async () => resposta(evento()))
    await editarEvento(12, { id_projeto: null })
    const { url, init } = ultima()
    expect(url).toMatch(/\/api\/eventos\/12$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body as string)).toEqual({ id_projeto: null })
  })

  it('relatórios do evento: GET /api/documentos?vinculo_tipo=evento&vinculo_id=N', async () => {
    await listarDocumentos({ vinculo_tipo: 'evento', vinculo_id: 12 })
    expect(ultima().url).toMatch(
      /\/api\/documentos\?vinculo_tipo=evento&vinculo_id=12$/,
    )
  })

  it('fotos do evento: listar, enviar (multipart com a confirmação), apagar', async () => {
    await listarFotosDoEvento(12)
    expect(ultima().url).toMatch(/\/api\/eventos\/12\/fotos$/)
    expect(caminhoDaFotoDoEvento(12, 9)).toBe('/api/eventos/12/fotos/9/arquivo')

    const arquivo = new File(['x'], 'foto.jpg', { type: 'image/jpeg' })
    await enviarFotoDoEvento(12, {
      arquivo,
      alt: 'Crianças tocando tambores na quadra',
      autorizacaoImagem: true,
      idDocumentoAutorizacao: '47',
    })
    const { url, init } = ultima()
    expect(url).toMatch(/\/api\/eventos\/12\/fotos$/)
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('arquivo')).toBeInstanceOf(File)
    expect(form.get('alt')).toBe('Crianças tocando tambores na quadra')
    expect(form.get('autorizacao_imagem')).toBe('true')
    expect(form.get('id_documento_autorizacao')).toBe('47')

    await enviarFotoDoEvento(12, {
      arquivo,
      alt: 'Crianças tocando tambores na quadra',
      autorizacaoImagem: true,
    })
    expect(
      (ultima().init.body as FormData).has('id_documento_autorizacao'),
    ).toBe(false)

    await apagarFotoDoEvento(12, 9)
    expect(ultima().url).toMatch(/\/api\/eventos\/12\/fotos\/9$/)
    expect(ultima().init.method).toBe('DELETE')
  })

  it('erro do servidor chega em português ao texto da tela; erro de rede vira o texto padrão', async () => {
    fetchMock.mockImplementation(async () =>
      resposta(
        {
          detail:
            'Só um projeto Público pode ficar em destaque no site: mude a visibilidade para Pública.',
        },
        422,
      ),
    )
    const erro = await editarProjeto(3, { destaque_no_site: true }).catch(
      (e: unknown) => e,
    )
    expect(erro).toBeInstanceOf(ApiError)
    expect(mensagemDoErro(erro, 'padrão')).toMatch(/Só um projeto Público/)
    expect(mensagemDoErro(new TypeError('Failed to fetch'), 'padrão')).toBe(
      'padrão',
    )
  })
})

describe('formulários de criar: campo em branco não vira 0 nem texto vazio', () => {
  const eventoBase = {
    titulo: 'Despertai 2027',
    categoria: 'PALESTRA',
    data_hora_inicio: '2027-02-10T19:00',
    gratuito: true,
    visibilidade: 'Interna',
  }

  it('evento: espaço, responsável, vagas e projeto em branco somem; preenchidos viram número', () => {
    const vazio = eventoCriarSchema.parse({
      ...eventoBase,
      id_espaco: '',
      id_associado_responsavel: '',
      vagas: '',
      id_projeto: '',
    })
    for (const campo of [
      'id_espaco',
      'id_associado_responsavel',
      'vagas',
      'id_projeto',
    ] as const) {
      expect(vazio[campo]).toBeUndefined()
    }
    const cheio = eventoCriarSchema.parse({
      ...eventoBase,
      id_espaco: '2',
      vagas: '40',
      id_projeto: '3',
    })
    expect(cheio).toMatchObject({ id_espaco: 2, vagas: 40, id_projeto: 3 })
  })

  it('projeto: tipo, responsável e centro de custo em branco somem; destaque é opcional', () => {
    const base = {
      nome_projeto: 'Despertai',
      tipo_foco: 'Social',
      necessita_alvara_bombeiros: false,
      data_inicio: '2026-10-01',
      data_fim_prevista: '2026-12-31',
      visibilidade: 'Pública',
    }
    const vazio = projetoCriarSchema.parse({
      ...base,
      tipo_projeto: '',
      id_associado_responsavel: '',
      id_centro_custo: '',
    })
    expect(vazio.tipo_projeto).toBeUndefined()
    expect(vazio.id_associado_responsavel).toBeUndefined()
    expect(vazio.id_centro_custo).toBeUndefined()
    expect(vazio.destaque_no_site).toBeUndefined()
    expect(
      projetoCriarSchema.parse({
        ...base,
        tipo_projeto: 'SOCIAL',
        id_centro_custo: '7',
        destaque_no_site: true,
      }),
    ).toMatchObject({
      tipo_projeto: 'SOCIAL',
      id_centro_custo: 7,
      destaque_no_site: true,
    })
  })
})

describe('textos do contexto', () => {
  it('o botão de novo relatório leva ao cadastro já preenchido', () => {
    expect(enderecoDoNovoRelatorio('evento', 12)).toBe(
      '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=evento&vinculo_id=12',
    )
    expect(enderecoDoNovoRelatorio('projeto', 3)).toBe(
      '/documentos/novo?tipo=RELATORIO_EVENTO&vinculo_tipo=projeto&vinculo_id=3',
    )
  })

  it('a data do projeto é só o dia', () => {
    expect(diaDoProjeto('2026-10-01T00:00:00')).toBe('2026-10-01')
    expect(diaDoProjeto('2026-10-01')).toBe('2026-10-01')
    expect(diaDoProjeto(null)).toBe('')
  })

  it('diz se o evento aparece na página do projeto no site', () => {
    expect(fraseDaPublicacaoNoProjeto(evento(), projeto())).toMatch(
      /aparece na página do projeto “Despertai” no site/,
    )
    expect(
      fraseDaPublicacaoNoProjeto(
        evento({ visibilidade: 'Interna' }),
        projeto(),
      ),
    ).toMatch(/Este evento é Interno/)
    expect(
      fraseDaPublicacaoNoProjeto(
        evento(),
        projeto({ visibilidade: 'Interna' }),
      ),
    ).toMatch(/O projeto “Despertai” é Interno/)
    expect(
      fraseDaPublicacaoNoProjeto(evento({ id_projeto: null }), projeto()),
    ).toBeNull()
    expect(fraseDaPublicacaoNoProjeto(evento(), undefined)).toBeNull()
  })

  it('o vínculo do documento em português simples', () => {
    expect(rotuloDoVinculo('evento', 12)).toBe('Evento nº 12')
    expect(rotuloDoVinculo('projeto', 3)).toBe('Projeto nº 3')
    expect(rotuloDoVinculo('evento', null)).toBe('Evento')
    expect(rotuloDoVinculo(null, null)).toBeNull()
    expect(rotuloDoVinculo('algo-novo', 1)).toBe('Algo-novo nº 1')
    expect(frasePertenceA('evento', 12)).toBe(
      'Este documento pertence ao evento nº 12.',
    )
    expect(frasePertenceA('projeto', 3)).toBe(
      'Este documento pertence ao projeto nº 3.',
    )
    expect(frasePertenceA('parceria', 7)).toBe(
      'Este documento pertence à parceria nº 7.',
    )
    expect(frasePertenceA('', 7)).toBeNull()
  })
})
