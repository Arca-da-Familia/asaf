// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { iniciarEventoVivo } from '../src/lib/evento-vivo'

function pagina(fim = '2026-10-10T21:00:00'): HTMLElement {
  const raiz = document.createElement('div')
  raiz.dataset.apiUrl = 'https://api.teste'
  raiz.dataset.id = '2'
  raiz.dataset.fim = fim
  raiz.innerHTML = `
    <p data-aviso-retirado hidden>retirado</p>
    <p data-aviso-realizado hidden>já aconteceu</p>
    <dd data-vagas>12 vagas disponíveis</dd>`
  return raiz
}

// 1º/out/2026, meio-dia em Parauapebas.
const AGORA = new Date('2026-10-01T15:00:00Z')
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const oculto = (raiz: HTMLElement, seletor: string) =>
  (raiz.querySelector(seletor) as HTMLElement).hidden

describe('iniciarEventoVivo', () => {
  it('atualiza as vagas com o número de AGORA (o do build é velho)', async () => {
    const raiz = pagina()
    const fetchImpl = vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 }))
    await iniciarEventoVivo(raiz, { agora: AGORA, fetchImpl })
    expect(raiz.querySelector('[data-vagas]')!.textContent).toBe(
      '1 vaga disponível',
    )
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.teste/api/publico/eventos/2',
    )
  })

  it('vagas esgotadas e evento sem limite de vagas', async () => {
    const a = pagina()
    await iniciarEventoVivo(a, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: 0 })),
    })
    expect(a.querySelector('[data-vagas]')!.textContent).toBe('Vagas esgotadas')

    const b = pagina()
    await iniciarEventoVivo(b, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: null })),
    })
    expect(oculto(b, '[data-vagas]')).toBe(true)
  })

  it('404 = evento retirado do ar depois do build: avisa e esconde as vagas', async () => {
    const raiz = pagina()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404)),
    })
    expect(oculto(raiz, '[data-aviso-retirado]')).toBe(false)
    expect(oculto(raiz, '[data-vagas]')).toBe(true)
  })

  it('erro de rede ou 500 NÃO alarma o visitante (a página continua útil)', async () => {
    for (const fetchImpl of [
      vi.fn().mockRejectedValue(new TypeError('rede')),
      vi.fn().mockResolvedValue(resposta({}, 500)),
    ]) {
      const raiz = pagina()
      await iniciarEventoVivo(raiz, {
        agora: AGORA,
        fetchImpl,
        esperaEntreTentativasMs: 0,
      })
      expect(oculto(raiz, '[data-aviso-retirado]')).toBe(true)
      expect(raiz.querySelector('[data-vagas]')!.textContent).toBe(
        '12 vagas disponíveis',
      )
    }
  })

  it('"já aconteceu" só depois do fim do evento (no horário de Parauapebas)', async () => {
    const api = () => vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 }))
    const passado = pagina('2026-09-30T18:00:00')
    await iniciarEventoVivo(passado, { agora: AGORA, fetchImpl: api() })
    expect(oculto(passado, '[data-aviso-realizado]')).toBe(false)

    const futuro = pagina('2026-10-10T21:00:00')
    await iniciarEventoVivo(futuro, { agora: AGORA, fetchImpl: api() })
    expect(oculto(futuro, '[data-aviso-realizado]')).toBe(true)
  })

  it('SEGURANÇA: nada da API entra como HTML', async () => {
    const raiz = pagina()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi
        .fn()
        .mockResolvedValue(
          resposta({ vagas_livres: '<img src=x onerror=alert(1)>' }),
        ),
    })
    expect(raiz.querySelector('img')).toBeNull()
  })
})

// v5.5c — a inscrição acompanha o evento ao vivo: vagas de agora no formulário, e o bloco "Como participar" some quando o evento já aconteceu ou saiu do ar.
describe('a inscrição na página do evento', () => {
  function paginaComInscricao(fim = '2026-10-10T21:00:00'): HTMLElement {
    const raiz = pagina(fim)
    raiz.insertAdjacentHTML(
      'beforeend',
      `<div data-como-participar>
        <section data-inscricao-formulario data-vagas-livres="12">
          <p data-aviso-esgotado hidden>As vagas acabaram.</p>
          <select data-campo="sessao">
            <option value="">Todo o evento</option>
            <option value="21" data-sessao="21" data-rotulo="Oficina" data-vagas-livres="5">Oficina — 5 vagas</option>
          </select>
        </section>
      </div>`,
    )
    return raiz
  }

  it('as vagas de agora chegam ao formulário: o aviso aparece quando o evento esgota e o texto das sessões muda', async () => {
    const raiz = paginaComInscricao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(
        resposta({
          vagas_livres: 0,
          sessoes: [{ id_sessao: 21, vagas_livres: 2 }],
        }),
      ),
    })
    expect(oculto(raiz, '[data-aviso-esgotado]')).toBe(false)
    expect(raiz.querySelector('option[data-sessao="21"]')!.textContent).toBe(
      'Oficina — 2 vagas',
    )
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
  })

  it('evento que já aconteceu: o bloco "Como participar" (e o formulário) some', async () => {
    const raiz = paginaComInscricao('2026-09-30T18:00:00')
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 })),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
  })

  it('evento retirado do ar (404): o bloco "Como participar" some', async () => {
    const raiz = paginaComInscricao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404)),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
  })

  it('API fora do ar: a inscrição continua como foi publicada', async () => {
    const raiz = paginaComInscricao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('rede')),
      esperaEntreTentativasMs: 0,
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
    expect(oculto(raiz, '[data-aviso-esgotado]')).toBe(true)
  })

  it('quem acabou de se inscrever não perde a tela de resultado, mesmo que o evento "acabe" depois', async () => {
    const raiz = paginaComInscricao('2026-09-30T18:00:00')
    raiz
      .querySelector('[data-inscricao-formulario]')!
      .setAttribute('data-concluida', '')
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ vagas_livres: 1 })),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
  })
})

// v5.5d — a situação do evento ao vivo: a diretoria cancela, adia, remarca ou reativa no painel, e a página (gerada no build) acompanha na hora
describe('a situação do evento na página', () => {
  /** A página como a Astro a escreve: o aviso (escondido quando o evento é só programado), o "Quando", as vagas, a programação e o bloco de inscrição. */
  function paginaDeSituacao(
    status = 'Programado',
    fim = '2026-10-10T21:00:00',
  ): HTMLElement {
    const raiz = pagina(fim)
    raiz.dataset.status = status
    raiz.innerHTML = `
      <div data-aviso-situacao data-situacao-do-evento="${status}" role="status" hidden>
        <p data-situacao-frase></p>
        <p data-situacao-motivo hidden></p>
        <p data-situacao-complemento hidden></p>
      </div>
      <p data-aviso-retirado hidden>retirado</p>
      <p data-aviso-realizado hidden>já aconteceu</p>
      <dl>
        <dd data-quando><time datetime="2026-10-10T19:00:00-03:00">sábado, 10 de outubro de 2026, às 19:00</time> até <time datetime="2026-10-10T21:00:00-03:00">21:00</time></dd>
        <dt data-vagas-rotulo>Vagas</dt>
        <dd data-vagas>12 vagas disponíveis</dd>
      </dl>
      <ol>
        <li><time data-sessao-horario="21" datetime="2026-10-10T19:00:00-03:00">sábado, 10 de outubro de 2026, 19:00</time></li>
        <li><time data-sessao-horario="22" datetime="2026-10-10T20:00:00-03:00">sábado, 10 de outubro de 2026, 20:00</time></li>
      </ol>
      <p data-inscricoes-paradas hidden></p>
      <div data-como-participar><section data-inscricao-formulario>formulário</section></div>`
    return raiz
  }
  const texto = (raiz: HTMLElement, seletor: string) =>
    raiz.querySelector(seletor)!.textContent
  const api = (corpo: Record<string, unknown>) =>
    vi.fn().mockResolvedValue(resposta(corpo))
  const base = {
    data_hora_inicio: '2026-10-10T19:00:00',
    data_hora_fim: '2026-10-10T21:00:00',
    vagas_livres: 12,
  }

  it('CANCELADO depois do build: o aviso e o motivo aparecem no topo, o formulário some e a frase de inscrição encerrada ocupa o lugar', async () => {
    const raiz = paginaDeSituacao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({
        ...base,
        status: 'Cancelado',
        motivo_status: 'O local ficou indisponível por causa da chuva.',
      }),
    })
    const aviso = raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!
    expect(aviso.hidden).toBe(false)
    expect(aviso.dataset.situacaoDoEvento).toBe('Cancelado')
    expect(aviso.hasAttribute('data-evento-remarcado')).toBe(false)
    expect(texto(raiz, '[data-situacao-frase]')).toBe(
      'Este evento foi cancelado.',
    )
    expect(oculto(raiz, '[data-situacao-motivo]')).toBe(false)
    expect(texto(raiz, '[data-situacao-motivo]')).toBe(
      'Motivo: O local ficou indisponível por causa da chuva.',
    )
    expect(oculto(raiz, '[data-situacao-complemento]')).toBe(true)
    expect(aviso.className).toContain('border-destructive')
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
    expect(oculto(raiz, '[data-inscricoes-paradas]')).toBe(false)
    expect(texto(raiz, '[data-inscricoes-paradas]')).toBe(
      'As inscrições estão encerradas porque o evento foi cancelado.',
    )
    // evento parado não anuncia vagas (a linha inteira some, título e número)
    expect(oculto(raiz, '[data-vagas]')).toBe(true)
    expect(oculto(raiz, '[data-vagas-rotulo]')).toBe(true)
  })

  it('ADIADO: a nova data ainda não foi definida, o motivo e quando as inscrições reabrem; o formulário some', async () => {
    const raiz = paginaDeSituacao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({
        ...base,
        status: 'Adiado',
        motivo_status: 'Aguardando a prefeitura.',
      }),
    })
    expect(texto(raiz, '[data-situacao-frase]')).toBe(
      'Este evento foi adiado. A nova data ainda não foi definida.',
    )
    expect(texto(raiz, '[data-situacao-motivo]')).toBe(
      'Motivo: Aguardando a prefeitura.',
    )
    expect(texto(raiz, '[data-situacao-complemento]')).toBe(
      'As inscrições reabrem quando a nova data for definida.',
    )
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
    expect(texto(raiz, '[data-inscricoes-paradas]')).toBe(
      'As inscrições reabrem quando a nova data for definida.',
    )
    expect(
      raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!.className,
    ).toContain('border-brand-secondary')
  })

  it('REMARCADO: o aviso diz a data anterior e o motivo, a data de AGORA entra no "Quando" e na programação, e o formulário continua', async () => {
    const raiz = paginaDeSituacao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({
        status: 'Programado',
        motivo_status: 'O espaço estava ocupado.',
        data_hora_inicio_anterior: '2026-10-10T19:00:00',
        data_hora_inicio: '2026-10-17T19:00:00',
        data_hora_fim: '2026-10-17T21:30:00',
        vagas_livres: 9,
        sessoes: [
          { id_sessao: 21, data_hora_inicio: '2026-10-17T19:00:00' },
          { id_sessao: 22, data_hora_inicio: '2026-10-17T20:00:00' },
        ],
      }),
    })
    const aviso = raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!
    expect(aviso.hidden).toBe(false)
    expect(aviso.dataset.situacaoDoEvento).toBe('Programado')
    expect(aviso.hasAttribute('data-evento-remarcado')).toBe(true)
    expect(texto(raiz, '[data-situacao-frase]')).toBe(
      'Este evento foi remarcado. A data anterior era sábado, 10 de outubro de 2026, às 19:00.',
    )
    expect(texto(raiz, '[data-situacao-motivo]')).toBe(
      'Motivo: O espaço estava ocupado.',
    )
    expect(aviso.className).toContain('border-primary')
    // a inscrição segue como sempre
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
    expect(oculto(raiz, '[data-inscricoes-paradas]')).toBe(true)
    expect(texto(raiz, '[data-vagas]')).toBe('9 vagas disponíveis')
    // a data de agora (a do build seria a de antes)
    const tempos = raiz.querySelectorAll('[data-quando] time')
    expect(tempos[0]!.textContent).toBe(
      'sábado, 17 de outubro de 2026, às 19:00',
    )
    expect(tempos[0]!.getAttribute('datetime')).toBe(
      '2026-10-17T19:00:00-03:00',
    )
    expect(tempos[1]!.textContent).toBe('21:30')
    expect(texto(raiz, '[data-quando]')).toContain(' até ')
    const sessoes = raiz.querySelectorAll('time[data-sessao-horario]')
    expect(sessoes[0]!.textContent).toBe('sábado, 17 de outubro de 2026, 19:00')
    expect(sessoes[1]!.getAttribute('datetime')).toBe(
      '2026-10-17T20:00:00-03:00',
    )
  })

  it('REALIZADO: o aviso, o formulário some e a frase "As inscrições estão encerradas."', async () => {
    const raiz = paginaDeSituacao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({ ...base, status: 'Realizado' }),
    })
    expect(texto(raiz, '[data-situacao-frase]')).toBe(
      'Este evento já foi realizado.',
    )
    expect(oculto(raiz, '[data-situacao-motivo]')).toBe(true)
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
    expect(texto(raiz, '[data-inscricoes-paradas]')).toBe(
      'As inscrições estão encerradas.',
    )
  })

  it('REATIVADO: o evento cancelado no build volta a programado — o aviso some e o formulário e as vagas voltam, sem reconstruir o site', async () => {
    const raiz = paginaDeSituacao('Cancelado')
    // como o build deixa a página cancelada
    raiz.querySelector<HTMLElement>('[data-como-participar]')!.hidden = true
    raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!.hidden = false
    raiz.querySelector<HTMLElement>('[data-inscricoes-paradas]')!.hidden = false
    raiz.querySelector('[data-inscricoes-paradas]')!.textContent =
      'As inscrições estão encerradas porque o evento foi cancelado.'
    raiz.querySelector<HTMLElement>('[data-vagas]')!.hidden = true
    raiz.querySelector<HTMLElement>('[data-vagas-rotulo]')!.hidden = true
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({ ...base, status: 'Programado', vagas_livres: 7 }),
    })
    expect(oculto(raiz, '[data-aviso-situacao]')).toBe(true)
    expect(
      raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!.dataset
        .situacaoDoEvento,
    ).toBe('Programado')
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
    expect(oculto(raiz, '[data-inscricoes-paradas]')).toBe(true)
    expect(oculto(raiz, '[data-vagas]')).toBe(false)
    expect(oculto(raiz, '[data-vagas-rotulo]')).toBe(false)
    expect(texto(raiz, '[data-vagas]')).toBe('7 vagas disponíveis')
  })

  it('evento cancelado, adiado ou realizado com a data já passada: só o aviso da situação (nada de "A data deste evento já passou")', async () => {
    for (const status of ['Cancelado', 'Adiado', 'Realizado']) {
      const raiz = paginaDeSituacao(status, '2026-09-01T21:00:00')
      await iniciarEventoVivo(raiz, {
        agora: AGORA,
        fetchImpl: api({
          status,
          motivo_status: 'Motivo de teste.',
          data_hora_inicio: '2026-09-01T19:00:00',
          data_hora_fim: '2026-09-01T21:00:00',
        }),
      })
      expect(oculto(raiz, '[data-aviso-realizado]'), status).toBe(true)
      expect(oculto(raiz, '[data-aviso-situacao]'), status).toBe(false)
    }
  })

  it('evento programado com a data já passada: continua o aviso "A data deste evento já passou" e sem formulário', async () => {
    const raiz = paginaDeSituacao('Programado', '2026-09-01T21:00:00')
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({
        status: 'Programado',
        data_hora_inicio: '2026-09-01T19:00:00',
        data_hora_fim: '2026-09-01T21:00:00',
      }),
    })
    expect(oculto(raiz, '[data-aviso-realizado]')).toBe(false)
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
    expect(oculto(raiz, '[data-aviso-situacao]')).toBe(true)
    // a frase curta é só dos eventos parados: a data que passou já tem o seu aviso
    expect(oculto(raiz, '[data-inscricoes-paradas]')).toBe(true)
  })

  it('SEGURANÇA: o motivo digitado pela diretoria vira TEXTO, nunca HTML', async () => {
    const raiz = paginaDeSituacao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({
        ...base,
        status: 'Cancelado',
        motivo_status: '<img src=x onerror="window.__xss=1"><b>negrito</b>',
      }),
    })
    expect(raiz.querySelector('img')).toBeNull()
    expect(raiz.querySelector('b')).toBeNull()
    expect(texto(raiz, '[data-situacao-motivo]')).toBe(
      'Motivo: <img src=x onerror="window.__xss=1"><b>negrito</b>',
    )
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('a situação do build já está certa: o aviso NÃO é reescrito (o leitor de tela não anuncia duas vezes)', async () => {
    const raiz = paginaDeSituacao('Cancelado')
    const aviso = raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!
    aviso.hidden = false
    aviso.className =
      'rounded-lg border-2 bg-card p-4 text-card-foreground border-destructive'
    raiz.querySelector('[data-situacao-frase]')!.textContent =
      'Este evento foi cancelado.'
    const motivo = raiz.querySelector<HTMLElement>('[data-situacao-motivo]')!
    motivo.hidden = false
    motivo.textContent = 'Motivo: Chuva.'
    // o observador entrega os registros num microtask: guarda os que chegam e junta os que ainda estão na fila
    const mudancas: MutationRecord[] = []
    const observador = new MutationObserver((registros) =>
      mudancas.push(...registros),
    )
    // o que o leitor de tela anuncia é o CONTEÚDO da região (texto que entra ou muda), não um atributo regravado com o mesmo valor
    observador.observe(aviso, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({ ...base, status: 'Cancelado', motivo_status: 'Chuva.' }),
    })
    mudancas.push(...observador.takeRecords())
    observador.disconnect()
    expect(mudancas).toEqual([])
  })

  it('resposta sem situação (API antiga ou parcial) vale "programado": nunca derruba a página nem esconde o formulário por engano', async () => {
    const raiz = paginaDeSituacao()
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({ vagas_livres: 3 }),
    })
    expect(oculto(raiz, '[data-aviso-situacao]')).toBe(true)
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
    expect(texto(raiz, '[data-vagas]')).toBe('3 vagas disponíveis')
    // sem data na resposta, o "Quando" do build fica
    expect(texto(raiz, '[data-quando]')).toContain(
      'sábado, 10 de outubro de 2026',
    )
  })

  it('API fora do ar: a situação do build fica como foi publicada (formulário escondido no evento cancelado)', async () => {
    const raiz = paginaDeSituacao('Cancelado')
    raiz.querySelector<HTMLElement>('[data-como-participar]')!.hidden = true
    raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!.hidden = false
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('rede')),
      esperaEntreTentativasMs: 0,
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
    expect(oculto(raiz, '[data-aviso-situacao]')).toBe(false)
  })

  it('evento retirado do ar (404): some também o aviso da situação e a frase de inscrição — fica só o aviso de retirado', async () => {
    const raiz = paginaDeSituacao('Adiado')
    raiz.querySelector<HTMLElement>('[data-aviso-situacao]')!.hidden = false
    raiz.querySelector<HTMLElement>('[data-inscricoes-paradas]')!.hidden = false
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: vi.fn().mockResolvedValue(resposta({ detail: 'x' }, 404)),
    })
    expect(oculto(raiz, '[data-aviso-retirado]')).toBe(false)
    expect(oculto(raiz, '[data-aviso-situacao]')).toBe(true)
    expect(oculto(raiz, '[data-inscricoes-paradas]')).toBe(true)
    expect(oculto(raiz, '[data-como-participar]')).toBe(true)
  })

  it('quem acabou de se inscrever não perde a tela de resultado, nem se o evento for cancelado logo depois', async () => {
    const raiz = paginaDeSituacao()
    raiz
      .querySelector('[data-inscricao-formulario]')!
      .setAttribute('data-concluida', '')
    await iniciarEventoVivo(raiz, {
      agora: AGORA,
      fetchImpl: api({ ...base, status: 'Cancelado', motivo_status: 'Chuva.' }),
    })
    expect(oculto(raiz, '[data-como-participar]')).toBe(false)
    expect(oculto(raiz, '[data-aviso-situacao]')).toBe(false)
  })
})
