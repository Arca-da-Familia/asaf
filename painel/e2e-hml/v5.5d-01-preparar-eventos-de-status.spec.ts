import { expect, test } from '@playwright/test'

import {
  API_HML,
  cpfValido,
  entrar,
  exigirHomologacao,
  RODADA,
  vigiar,
} from './apoio'

// v5.5d - preparo para o roteiro v5.5d-02 (mudar a situação do evento pelo painel e ver o efeito no SITE e na API): cria, pelo sistema de teste, três eventos PÚBLICOS e
// gratuitos (um para cancelar, um para adiar e remarcar, um que já aconteceu para marcar como realizado) e inscreve duas pessoas no primeiro e uma no segundo, pela API pública
// (como o formulário do site faz). O site de teste só ganha a página de cada evento quando a homologação é publicada de novo (ele lê a API NO BUILD): por isso este roteiro roda
// primeiro, depois a homologação é publicada, e só então o v5.5d-02.
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => exigirHomologacao())
test.setTimeout(240_000)

const S = String(RODADA)
const PREFIXO_CANCELAR = 'Oficina para Cancelar do Robô'
const PREFIXO_ADIAR = 'Encontro para Adiar do Robô'
const PREFIXO_REALIZAR = 'Evento para Realizar do Robô'
const base = (k: number) => 700000000 + ((RODADA + k * 6101) % 200000000)

const hora = (n: number, horasDepois = 0): string =>
  new Date(Date.now() + n * 86_400_000 + horasDepois * 3_600_000)
    .toISOString()
    .slice(0, 19)

test('o sistema de teste ganha os três eventos de situação e as inscrições para o aviso', async ({
  page,
}) => {
  const vigia = vigiar(page)
  const token: { valor: string } = { valor: '' }
  page.on('request', (r) => {
    const cab = r.headers()['authorization']
    if (cab && r.url().startsWith(API_HML)) token.valor = cab
  })
  await entrar(page, 'presidente')
  await expect.poll(() => token.valor, { timeout: 15_000 }).not.toBe('')
  const cabecalho = {
    Authorization: token.valor,
    'Content-Type': 'application/json',
  }

  const criar = async (
    titulo: string,
    inicio: string,
    fim: string,
  ): Promise<number> => {
    const r = await page.request.fetch(`${API_HML}/api/eventos/`, {
      method: 'POST',
      headers: cabecalho,
      data: JSON.stringify({
        titulo,
        descricao: 'Evento de teste para provar a situação do evento.',
        categoria: 'PALESTRA',
        data_hora_inicio: inicio,
        data_hora_fim: fim,
        endereco_avulso: 'Salão da ASAF (teste)',
        vagas: 5,
        gratuito: true,
        visibilidade: 'Pública',
      }),
    })
    expect(r.status(), await r.text()).toBe(200)
    return ((await r.json()) as { id_evento: number }).id_evento
  }

  const idCancelar = await criar(
    `${PREFIXO_CANCELAR} ${S}`,
    hora(10),
    hora(10, 2),
  )
  const idAdiar = await criar(`${PREFIXO_ADIAR} ${S}`, hora(15), hora(15, 2))
  await criar(`${PREFIXO_REALIZAR} ${S}`, hora(-3), hora(-3, 2))

  const consentimento = (await (
    await page.request.get(`${API_HML}/api/publico/eventos/consentimento-lgpd`)
  ).json()) as { versao: string }
  const inscrever = async (
    idEvento: number,
    k: number,
    nome: string,
  ): Promise<void> => {
    const r = await page.request.post(
      `${API_HML}/api/publico/eventos/${idEvento}/inscrever-se`,
      {
        data: {
          nome_completo: `${nome} ${S} de Teste`,
          cpf: cpfValido(base(k)),
          email: `status.${k}.${S}@homologacao.example.com`,
          telefone: `9198888${String(1000 + k).slice(-4)}`,
          consentimento_lgpd: true,
          versao_texto_consentimento: consentimento.versao,
        },
      },
    )
    expect(r.status(), await r.text()).toBe(200)
  }
  await inscrever(idCancelar, 1, 'Inscrita Cancelar Um')
  await inscrever(idCancelar, 2, 'Inscrito Cancelar Dois')
  await inscrever(idAdiar, 3, 'Inscrita Adiar Tres')

  // os três aparecem na lista pública como Programado, e o do cancelamento tem as duas vagas ocupadas
  const publicos = (await (
    await page.request.get(`${API_HML}/api/publico/eventos`)
  ).json()) as Array<{
    id_evento: number
    titulo: string
    status: string
    vagas_livres: number | null
  }>
  for (const prefixo of [PREFIXO_CANCELAR, PREFIXO_ADIAR, PREFIXO_REALIZAR]) {
    const e = publicos.find((x) => x.titulo === `${prefixo} ${S}`)
    expect(e, `o evento "${prefixo}" está na lista pública`).toBeTruthy()
    expect(e?.status).toBe('Programado')
  }
  expect(publicos.find((e) => e.id_evento === idCancelar)?.vagas_livres).toBe(3)
  expect(publicos.find((e) => e.id_evento === idAdiar)?.vagas_livres).toBe(4)
  expect(vigia.problemas()).toEqual([])
})
