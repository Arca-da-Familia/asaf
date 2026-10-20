import { expect, test, type Page } from '@playwright/test'

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  ver,
  vigiar,
} from './apoio'

// v5.6a - DOAR PELO SITE com Pix ESTÁTICO (a ASAF não tem Pix dinâmico: o dinheiro cai direto na conta e nada avisa o sistema). Este roteiro confere, na homologação de verdade:
//  1. a API pública da doação: o Pix só abre porque a chave está marcada "vai para o site" (a população de teste faz isso); as campanhas em andamento vêm sem a destinação interna; o código Pix
//     é um BR Code de verdade (CRC conferido aqui), livre ou com valor, e recusa valor e campanha inválidos;
//  2. quem se identifica ganha protocolo (o mesmo pedido duas vezes = o mesmo protocolo), e a tesouraria é avisada no sino;
//  3. a CONFERÊNCIA no painel: confirmar o recebimento com o valor RECEBIDO emite a doação e o recibo numerado (a homologação não manda e-mail: a tela tem de avisar), a campanha só passa a
//     contar depois disso; "Pix não localizado" não apaga nada; a Auditoria guarda tudo;
//  4. as proteções: armadilha de robô, aviso de privacidade com versão, dado errado em português, e ninguém sem login mexe na conferência.
// Fica na homologação, para explorar: uma doação confirmada, uma "Pix não localizado" e uma esperando conferência. O que o VISITANTE vê no site é o v5.6a-02.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(300_000)

let autorizacao = ''
let ipDaVez = 0
const cabecalho = () => ({ Authorization: autorizacao })
/** Cada pedido sai de um endereço novo: a homologação confia no primeiro item do cabeçalho (o limite é por IP e por hora). */
const novoIp = () => `10.57.${(RODADA >> 8) & 255}.${(ipDaVez++ % 250) + 1}`

type Campanha = {
  id_campanha: number
  titulo: string
  meta_valor: number
  valor_arrecadado: number
  percentual: number
}
type PaginaPublica = {
  pix_disponivel: boolean
  chave_pix: string | null
  beneficiario: string | null
  cidade: string | null
  campanhas: Campanha[]
  versao_aviso_de_privacidade: string
  dias_de_validade_do_pedido: number
}
type Intencao = {
  id_intencao: number
  protocolo: string
  status: string
  numero_recibo: number | null
  valor_recebido: number | null
  valor_informado: number | null
  recibo_enviado_por_email: boolean | null
  observacao: string | null
}

async function entrarComoPresidente(page: Page): Promise<void> {
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) autorizacao = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => autorizacao, { timeout: 15_000 }).not.toBe('')
}

const CHAVE_DE_TESTE = 'chave-pix-de-teste@homologacao.example.com'

/** O que a Presidência faz em Instituição: grava a chave e decide se ela "vai para o site". */
async function chavePixNaInstituicao(
  page: Page,
  dados: { valor?: string; publico: boolean },
): Promise<void> {
  const r = await page.request.put(`${API_HML}/api/instituicao/CHAVE_PIX`, {
    headers: cabecalho(),
    data: dados,
  })
  expect(r.status(), await r.text()).toBe(200)
}

async function campoDaInstituicao(
  page: Page,
  chave: string,
  valor: string,
): Promise<void> {
  const r = await page.request.put(`${API_HML}/api/instituicao/${chave}`, {
    headers: cabecalho(),
    data: { valor },
  })
  expect(r.status(), await r.text()).toBe(200)
}

async function paginaPublica(page: Page): Promise<PaginaPublica> {
  const r = await page.request.get(`${API_HML}/api/publico/doacao`)
  expect(r.status()).toBe(200)
  return (await r.json()) as PaginaPublica
}

async function pedir(
  page: Page,
  corpo: Record<string, unknown>,
  ip = novoIp(),
) {
  const publica = await paginaPublica(page)
  return page.request.post(`${API_HML}/api/publico/doacoes/intencoes`, {
    headers: { 'X-Forwarded-For': ip },
    data: {
      consentimento_lgpd: true,
      versao_texto_consentimento: publica.versao_aviso_de_privacidade,
      ...corpo,
    },
  })
}

async function intencaoPorProtocolo(
  page: Page,
  protocolo: string,
): Promise<Intencao> {
  const r = await page.request.get(
    `${API_HML}/api/intencoes-doacao/?busca=${protocolo}&por_pagina=5`,
    { headers: cabecalho() },
  )
  expect(r.status()).toBe(200)
  const { itens } = (await r.json()) as { itens: Intencao[] }
  const achada = itens.find((i) => i.protocolo === protocolo)
  expect(achada, `a conferência lista ${protocolo}`).toBeDefined()
  return achada!
}

/** Os campos do primeiro nível de um BR Code (id -> valor). */
function campos(codigo: string): Record<string, string> {
  const saida: Record<string, string> = {}
  let i = 0
  while (i < codigo.length) {
    const tamanho = Number(codigo.slice(i + 2, i + 4))
    saida[codigo.slice(i, i + 2)] = codigo.slice(i + 4, i + 4 + tamanho)
    i += 4 + tamanho
  }
  return saida
}

/** CRC-16/CCITT-FALSE do padrão do Pix, calculado aqui (independente do servidor). */
function crc16(texto: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc ^= byte << 8
    for (let b = 0; b < 8; b += 1)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

const codigoValido = (codigo: string) =>
  codigo.startsWith('000201') && crc16(codigo.slice(0, -4)) === codigo.slice(-4)

const nomeDaCampanha = `Robô doação ${RODADA}`
let idCampanha = 0
let protocoloConfirmado = ''
let protocoloSumido = ''

test('a API pública da doação: Pix aberto, campanhas sem a destinação interna e código Pix de verdade', async ({
  page,
}) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)

  // a TRAVA: com a chave só interna (o padrão de fábrica), a doação pelo site NÃO existe, mesmo com a chave preenchida
  await chavePixNaInstituicao(page, { valor: CHAVE_DE_TESTE, publico: false })
  const fechada = await paginaPublica(page)
  expect(fechada.pix_disponivel, 'chave só interna: a doação não abre').toBe(
    false,
  )
  expect(fechada.chave_pix).toBeNull()
  const pixFechado = await page.request.get(`${API_HML}/api/publico/doacao/pix`)
  expect(pixFechado.status()).toBe(503)
  const pedidoFechado = await pedir(page, {
    nome_completo: 'Pessoa de Teste',
    email: `fechada.${RODADA}@homologacao.example.com`,
  })
  expect(pedidoFechado.status()).toBe(503)

  // a Presidência marca "vai para o site" (e preenche nome e cidade do Pix): a doação abre, sem novo publicar
  await campoDaInstituicao(page, 'NOME_BENEFICIARIO_PIX', 'ASAF Teste')
  await campoDaInstituicao(page, 'CIDADE_BENEFICIARIO_PIX', 'Belem')
  await chavePixNaInstituicao(page, { publico: true })
  const antes = await paginaPublica(page)
  expect(
    antes.pix_disponivel,
    'chave marcada "vai para o site": a doação abre',
  ).toBe(true)
  expect(antes.chave_pix).toBe(CHAVE_DE_TESTE)
  expect(antes.beneficiario).toBe('ASAF Teste')
  expect(antes.dias_de_validade_do_pedido).toBeGreaterThanOrEqual(1)

  // uma campanha de teste, com a meta redonda para o percentual não depender de arredondamento
  const criada = await page.request.post(
    `${API_HML}/api/campanhas-arrecadacao/`,
    {
      headers: cabecalho(),
      data: {
        titulo: nomeDaCampanha,
        descricao:
          'Campanha inventada pelo robô para conferir a doação pelo site.',
        meta_valor: 1000,
      },
    },
  )
  expect(criada.status(), await criada.text()).toBe(200)
  idCampanha = ((await criada.json()) as { id_campanha: number }).id_campanha

  const depois = await paginaPublica(page)
  const dela = depois.campanhas.find((c) => c.id_campanha === idCampanha)
  expect(dela, 'a campanha em andamento aparece').toBeDefined()
  expect(dela!.valor_arrecadado).toBe(0)
  expect(dela!.percentual).toBe(0)
  expect(Object.keys(dela!).sort()).toEqual(
    [
      'descricao',
      'id_campanha',
      'meta_valor',
      'percentual',
      'prazo',
      'titulo',
      'valor_aplicado',
      'valor_arrecadado',
    ].sort(),
  ) // a destinação (centro de custo) é interna e não sai: só o TOTAL gasto (v5.7g), e vazio nesta campanha (sem centro de custo)
  expect(dela!.valor_aplicado).toBeNull()

  // o código sem se identificar: livre e com valor
  const livre = await page.request.get(`${API_HML}/api/publico/doacao/pix`)
  expect(livre.status()).toBe(200)
  const codigoLivre = ((await livre.json()) as { copia_e_cola: string })
    .copia_e_cola
  expect(codigoValido(codigoLivre), 'CRC do código livre confere').toBe(true)
  expect(
    campos(codigoLivre)['54'],
    'sem valor, quem paga digita no banco',
  ).toBeUndefined()
  expect(codigoLivre).toContain(antes.chave_pix!)

  const comValor = await page.request.get(
    `${API_HML}/api/publico/doacao/pix?valor=25.5&id_campanha=${idCampanha}`,
  )
  expect(comValor.status()).toBe(200)
  const codigo = ((await comValor.json()) as { copia_e_cola: string })
    .copia_e_cola
  expect(codigoValido(codigo), 'CRC do código com valor confere').toBe(true)
  expect(campos(codigo)['54']).toBe('25.50')

  // o que o servidor recusa
  for (const consulta of [
    'valor=0',
    'valor=-5',
    'valor=1000000.01',
    'id_campanha=99999999',
  ]) {
    const r = await page.request.get(
      `${API_HML}/api/publico/doacao/pix?${consulta}`,
    )
    expect([400, 422], consulta).toContain(r.status())
  }
  expect(vigia.problemas()).toEqual([])
})

test('quem se identifica ganha protocolo (o mesmo pedido, o mesmo protocolo) e a tesouraria é avisada no sino', async ({
  page,
}) => {
  await entrarComoPresidente(page)
  const email = `doacao.robo.${RODADA}@homologacao.example.com`
  const corpo = {
    nome_completo: `Doadora Robô ${RODADA}`,
    email,
    cpf: cpfValido(Number(String(RODADA).slice(-9))),
    valor: 100,
    id_campanha: idCampanha,
  }
  const r = await pedir(page, corpo)
  expect(r.status(), await r.text()).toBe(200)
  const resposta = (await r.json()) as {
    protocolo: string
    copia_e_cola: string
    valor: number
  }
  expect(resposta.protocolo).toMatch(/^DOA-\d{4}-\d{5}$/)
  expect(resposta.valor).toBe(100)
  expect(codigoValido(resposta.copia_e_cola)).toBe(true)
  expect(campos(resposta.copia_e_cola)['54']).toBe('100.00')
  protocoloConfirmado = resposta.protocolo

  // o mesmo pedido mandado de novo (duplo clique) é o MESMO protocolo
  const repetido = await pedir(page, corpo)
  expect(((await repetido.json()) as { protocolo: string }).protocolo).toBe(
    protocoloConfirmado,
  )

  // a tesouraria foi avisada, uma vez só
  const avisos = await page.request.get(`${API_HML}/api/minhas-notificacoes/`, {
    headers: cabecalho(),
  })
  const { avisos: lista } = (await avisos.json()) as {
    avisos: Array<{ titulo: string; link: string | null }>
  }
  const doProtocolo = lista.filter((a) =>
    a.titulo.includes(protocoloConfirmado),
  )
  expect(doProtocolo).toHaveLength(1)
  expect(doProtocolo[0]!.link).toBe('/doacoes')

  // ainda NÃO é dinheiro: a campanha segue em zero
  const publica = await paginaPublica(page)
  expect(
    publica.campanhas.find((c) => c.id_campanha === idCampanha)!
      .valor_arrecadado,
  ).toBe(0)
})

test('a tesouraria confirma o recebimento no painel: doação, recibo numerado, aviso de que o e-mail não saiu e a campanha passa a contar', async ({
  page,
}, info) => {
  const vigia = vigiar(page)
  await entrarComoPresidente(page)
  await page.goto('/doacoes')
  await expect(
    page.getByRole('heading', { name: 'Doações do site (Pix)' }),
  ).toBeVisible({ timeout: 30_000 })
  const linha = page
    .getByRole('listitem')
    .filter({ hasText: protocoloConfirmado })
  await expect(linha).toBeVisible({ timeout: 30_000 })
  await expect(linha).toContainText('Aguardando conferência')
  await expect(linha).toContainText(`Doadora Robô ${RODADA}`)
  await ver(page, info, 'doacao-do-site-esperando-conferencia')

  await linha
    .getByRole('button', { name: /^Confirmar recebimento de / })
    .click()
  const dialogo = page.getByRole('alertdialog')
  await expect(dialogo.getByLabel('Valor recebido (R$)')).toHaveValue(/100/)
  await dialogo.getByLabel('Conta de receita').selectOption({ index: 1 })
  await dialogo
    .getByLabel('Conta de caixa ou banco que recebeu')
    .selectOption({ index: 1 })
  await ver(page, info, 'confirmar-recebimento')
  await dialogo.getByRole('button', { name: 'Confirmar recebimento' }).click()

  await expect(page.getByText(/confirmada: recibo nº \d+ emitido/)).toBeVisible(
    { timeout: 30_000 },
  )
  // a homologação não manda e-mail (de propósito): a tela TEM de avisar que o recibo precisa chegar por outro meio
  await expect(
    page.getByText(/o e-mail não saiu: entregue o recibo por outro meio/),
  ).toBeVisible()
  await ver(page, info, 'doacao-confirmada-com-aviso-do-email')

  const confirmada = await intencaoPorProtocolo(page, protocoloConfirmado)
  expect(confirmada.status).toBe('CONFIRMADA')
  expect(confirmada.numero_recibo).toBeGreaterThan(0)
  expect(confirmada.valor_recebido).toBe(100)
  expect(confirmada.recibo_enviado_por_email).toBe(false)

  // a campanha passa a contar o que foi RECEBIDO (100 de 1000 = 10%)
  const publica = await paginaPublica(page)
  const campanha = publica.campanhas.find((c) => c.id_campanha === idCampanha)!
  expect(campanha.valor_arrecadado).toBe(100)
  expect(campanha.percentual).toBe(10)

  // a doação nasceu de verdade: com o recibo
  const recibo = await page.request.get(`${API_HML}/api/doacoes/`, {
    headers: cabecalho(),
  })
  const doacoes = (await recibo.json()) as Array<{
    numero_recibo: number
    nome_doador: string
    valor: number
    id_campanha: number
  }>
  const dela = doacoes.find((d) => d.numero_recibo === confirmada.numero_recibo)
  expect(dela?.valor).toBe(100)
  expect(dela?.id_campanha).toBe(idCampanha)

  // confirmar de novo não duplica: o painel não oferece, e a API recusa
  const segunda = await page.request.post(
    `${API_HML}/api/intencoes-doacao/${confirmada.id_intencao}/confirmar`,
    {
      headers: cabecalho(),
      data: {
        valor_recebido: 100,
        id_conta_contabil: 1,
        id_conta_contabil_caixa: 2,
      },
    },
  )
  expect(segunda.status()).toBe(400)

  // a Auditoria guardou quem confirmou
  const auditoria = await page.request.get(
    `${API_HML}/api/auditoria/?tabela_afetada=intencoes_de_doacao&acao=INTENCAO_DOACAO_CONFIRMADA&por_pagina=200`,
    { headers: cabecalho() },
  )
  const { entradas } = (await auditoria.json()) as {
    entradas: Array<{ id_registro_afetado: number; id_usuario: number | null }>
  }
  const dele = entradas.filter(
    (e) => Number(e.id_registro_afetado) === confirmada.id_intencao,
  )
  expect(dele).toHaveLength(1)
  expect(dele[0]!.id_usuario).not.toBeNull()
  expect(vigia.problemas()).toEqual([])
})

test('"Pix não localizado" não apaga nada e a que sobra fica esperando conferência', async ({
  page,
}, info) => {
  await entrarComoPresidente(page)
  const sumida = await pedir(page, {
    nome_completo: `Doador Sumido ${RODADA}`,
    email: `doacao.sumida.${RODADA}@homologacao.example.com`,
    valor: 60,
  })
  expect(sumida.status()).toBe(200)
  protocoloSumido = ((await sumida.json()) as { protocolo: string }).protocolo
  const esperando = await pedir(page, {
    nome_completo: `Doador Esperando ${RODADA}`,
    email: `doacao.esperando.${RODADA}@homologacao.example.com`,
  })
  expect(esperando.status()).toBe(200)

  await page.goto('/doacoes')
  const linha = page.getByRole('listitem').filter({ hasText: protocoloSumido })
  await expect(linha).toBeVisible({ timeout: 30_000 })
  await linha.getByRole('button', { name: /^Pix não localizado de / }).click()
  const dialogo = page.getByRole('alertdialog')
  await dialogo
    .getByLabel('Observação (opcional)')
    .fill('Procurado no extrato de teste e não achei.')
  await dialogo
    .getByRole('button', { name: 'Marcar como não localizado' })
    .click()
  await expect
    .poll(
      async () => (await intencaoPorProtocolo(page, protocoloSumido)).status,
      {
        timeout: 30_000,
      },
    )
    .toBe('NAO_LOCALIZADA')
  expect((await intencaoPorProtocolo(page, protocoloSumido)).observacao).toBe(
    'Procurado no extrato de teste e não achei.',
  )
  await ver(page, info, 'pix-nao-localizado')

  // nada foi apagado: ainda aparece no filtro certo, e ainda dá para confirmar depois
  await page
    .getByRole('combobox', { name: 'Situação' })
    .selectOption('NAO_LOCALIZADA')
  await expect(
    page.getByRole('listitem').filter({ hasText: protocoloSumido }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: protocoloSumido })
      .getByRole('button', { name: /^Confirmar recebimento de / }),
  ).toBeVisible()
})

test('as proteções: armadilha de robô, aviso de privacidade com versão, dado errado em português e conferência só com login', async ({
  page,
}) => {
  const publica = await paginaPublica(page)
  const base = {
    nome_completo: 'Pessoa de Teste',
    email: `protecao.${RODADA}@homologacao.example.com`,
  }
  // armadilha de robô: finge sucesso, não grava
  const robo = await pedir(page, { ...base, pagina_web: 'http://spam.example' })
  expect(robo.status()).toBe(200)
  expect(((await robo.json()) as { protocolo: unknown }).protocolo).toBeNull()

  // sem aceitar o aviso, e com a versão errada
  const semAviso = await page.request.post(
    `${API_HML}/api/publico/doacoes/intencoes`,
    {
      headers: { 'X-Forwarded-For': novoIp() },
      data: {
        ...base,
        consentimento_lgpd: false,
        versao_texto_consentimento: publica.versao_aviso_de_privacidade,
      },
    },
  )
  expect(semAviso.status()).toBe(400)
  const versaoVelha = await pedir(page, {
    ...base,
    versao_texto_consentimento: '0',
  })
  expect(versaoVelha.status()).toBe(422)

  // dado errado volta em português
  const cpfRuim = await pedir(page, { ...base, cpf: '11111111111' })
  expect(cpfRuim.status()).toBe(422)
  expect(await cpfRuim.text()).toContain('CPF')
  const valorRuim = await pedir(page, { ...base, valor: 0 })
  expect(valorRuim.status()).toBe(422)
  expect(await valorRuim.text()).toContain('maior que zero')
  const campanhaRuim = await pedir(page, { ...base, id_campanha: 99999999 })
  expect(campanhaRuim.status()).toBe(400)

  // a conferência é só de quem tem login
  expect(
    (await page.request.get(`${API_HML}/api/intencoes-doacao/`)).status(),
  ).toBe(401)
  expect(
    (
      await page.request.post(`${API_HML}/api/intencoes-doacao/1/confirmar`, {
        data: {
          valor_recebido: 1,
          id_conta_contabil: 1,
          id_conta_contabil_caixa: 2,
        },
      })
    ).status(),
  ).toBe(401)
})
