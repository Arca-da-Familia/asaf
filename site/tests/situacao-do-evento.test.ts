import { describe, expect, it } from 'vitest'

import {
  aindaVaiAcontecer,
  avisoDaSituacao,
  CLASSES_DO_AVISO,
  CLASSES_DO_SELO,
  fraseDeInscricaoParada,
  inscricoesParadas,
  seloDoEvento,
  situacaoDoEvento,
  statusDoEvento,
  textoOuNulo,
  type SeloDoEvento,
} from '../src/lib/situacao-do-evento'

// A situação do evento (v5.5d): Programado, Adiado, Cancelado ou Realizado, com o motivo; "remarcado" é Programado COM a data de antes.
// Tudo aqui é função pura — o que a página escreve, o selo da lista e o que o Google recebe saem destas contas.

describe('statusDoEvento', () => {
  it('os quatro status do sistema passam como vieram', () => {
    for (const status of ['Programado', 'Adiado', 'Cancelado', 'Realizado'])
      expect(statusDoEvento(status)).toBe(status)
  })

  it('ausente (API antiga), vazio, de outro tipo ou desconhecido vale "Programado" (o servidor é quem recusa a inscrição)', () => {
    for (const valor of [undefined, null, '', 'programado', 'Suspenso', 7, {}])
      expect(statusDoEvento(valor), String(valor)).toBe('Programado')
  })
})

describe('textoOuNulo', () => {
  it('tira os espaços das pontas; vazio e o que não é texto viram null', () => {
    expect(textoOuNulo('  Chuva forte  ')).toBe('Chuva forte')
    expect(textoOuNulo('   ')).toBeNull()
    expect(textoOuNulo('')).toBeNull()
    expect(textoOuNulo(null)).toBeNull()
    expect(textoOuNulo(undefined)).toBeNull()
    expect(textoOuNulo(5)).toBeNull()
  })
})

describe('situacaoDoEvento', () => {
  it('evento sem os campos novos (API antiga) é programado, sem motivo e nunca remarcado', () => {
    expect(situacaoDoEvento({})).toEqual({
      status: 'Programado',
      motivo: null,
      inicioAnterior: null,
      remarcado: false,
    })
  })

  it('REMARCADO é "Programado" com a data de antes', () => {
    const s = situacaoDoEvento({
      status: 'Programado',
      data_hora_inicio_anterior: '2026-10-01T19:00:00',
    })
    expect(s.remarcado).toBe(true)
    expect(s.inicioAnterior).toBe('2026-10-01T19:00:00')
  })

  it('cancelado, adiado ou realizado com data de antes NÃO é remarcado (o status manda)', () => {
    for (const status of ['Cancelado', 'Adiado', 'Realizado'])
      expect(
        situacaoDoEvento({
          status,
          data_hora_inicio_anterior: '2026-10-01T19:00:00',
        }).remarcado,
        status,
      ).toBe(false)
  })

  it('data de antes em branco não é remarcação', () => {
    expect(
      situacaoDoEvento({ data_hora_inicio_anterior: '  ' }).remarcado,
    ).toBe(false)
  })

  it('o motivo vem sem os espaços das pontas', () => {
    expect(
      situacaoDoEvento({ status: 'Cancelado', motivo_status: ' Chuva. ' })
        .motivo,
    ).toBe('Chuva.')
  })
})

describe('seloDoEvento', () => {
  it('evento só programado não leva selo', () => {
    expect(seloDoEvento({})).toBeNull()
    expect(seloDoEvento({ status: 'Programado' })).toBeNull()
  })

  it('cada situação tem o seu selo escrito', () => {
    expect(seloDoEvento({ status: 'Cancelado' })).toBe('Cancelado')
    expect(seloDoEvento({ status: 'Adiado' })).toBe('Adiado')
    expect(seloDoEvento({ status: 'Realizado' })).toBe('Realizado')
    expect(
      seloDoEvento({
        status: 'Programado',
        data_hora_inicio_anterior: '2026-10-01T19:00:00',
      }),
    ).toBe('Remarcado')
  })

  it('todo selo tem classes de selo e de aviso (nenhuma situação fica sem visual)', () => {
    const selos: SeloDoEvento[] = [
      'Cancelado',
      'Adiado',
      'Remarcado',
      'Realizado',
    ]
    for (const selo of selos) {
      expect(CLASSES_DO_SELO[selo], selo).toBeTruthy()
      expect(CLASSES_DO_AVISO[selo], selo).toBeTruthy()
    }
  })
})

describe('avisoDaSituacao — o texto do aviso do topo da página do evento', () => {
  it('evento só programado não tem aviso', () => {
    expect(avisoDaSituacao({})).toBeNull()
    expect(
      avisoDaSituacao({ status: 'Programado', motivo_status: 'sobrou' }),
    ).toBeNull()
  })

  it('cancelado: "Este evento foi cancelado." e "Motivo: ..."', () => {
    expect(
      avisoDaSituacao({
        status: 'Cancelado',
        motivo_status: 'O local ficou indisponível.',
      }),
    ).toEqual({
      status: 'Cancelado',
      remarcado: false,
      selo: 'Cancelado',
      frase: 'Este evento foi cancelado.',
      motivo: 'Motivo: O local ficou indisponível.',
      complemento: null,
    })
  })

  it('adiado: a nova data ainda não foi definida, o motivo e quando as inscrições reabrem', () => {
    expect(
      avisoDaSituacao({
        status: 'Adiado',
        motivo_status: 'Aguardando a prefeitura.',
      }),
    ).toEqual({
      status: 'Adiado',
      remarcado: false,
      selo: 'Adiado',
      frase: 'Este evento foi adiado. A nova data ainda não foi definida.',
      motivo: 'Motivo: Aguardando a prefeitura.',
      complemento:
        'Enquanto estiver adiado, o evento não recebe novas inscrições; se voltar a ser programado, elas reabrem nesta página.',
    })
  })

  it('remarcado: diz a data anterior (dia e hora de Parauapebas) e o motivo, se houver', () => {
    const aviso = avisoDaSituacao({
      status: 'Programado',
      data_hora_inicio_anterior: '2026-10-10T22:00:00',
      motivo_status: 'O espaço estava ocupado.',
    })
    expect(aviso).toEqual({
      status: 'Programado',
      remarcado: true,
      selo: 'Remarcado',
      frase:
        'Este evento foi remarcado. A data anterior era sábado, 10 de outubro de 2026, às 19:00.',
      motivo: 'Motivo: O espaço estava ocupado.',
      complemento: null,
    })
    expect(
      avisoDaSituacao({
        status: 'Programado',
        data_hora_inicio_anterior: '2026-10-10T22:00:00',
      })!.motivo,
    ).toBeNull()
  })

  it('realizado: só "Este evento já foi realizado." (sem motivo, mesmo que haja um guardado)', () => {
    expect(
      avisoDaSituacao({ status: 'Realizado', motivo_status: 'antigo' }),
    ).toEqual({
      status: 'Realizado',
      remarcado: false,
      selo: 'Realizado',
      frase: 'Este evento já foi realizado.',
      motivo: null,
      complemento: null,
    })
  })

  it('cancelado sem motivo (dado antigo) não escreve "Motivo:" vazio', () => {
    expect(avisoDaSituacao({ status: 'Cancelado' })!.motivo).toBeNull()
    expect(
      avisoDaSituacao({ status: 'Cancelado', motivo_status: '   ' })!.motivo,
    ).toBeNull()
  })

  it('o motivo é devolvido como TEXTO: o HTML digitado não é interpretado nem escapado aqui (quem escreve na página usa textContent)', () => {
    const aviso = avisoDaSituacao({
      status: 'Cancelado',
      motivo_status: '<img src=x onerror=alert(1)>',
    })
    expect(aviso!.motivo).toBe('Motivo: <img src=x onerror=alert(1)>')
  })
})

describe('a inscrição quando o evento está parado', () => {
  it('cancelado, adiado e realizado não recebem inscrição; programado recebe', () => {
    expect(inscricoesParadas('Cancelado')).toBe(true)
    expect(inscricoesParadas('Adiado')).toBe(true)
    expect(inscricoesParadas('Realizado')).toBe(true)
    expect(inscricoesParadas('Programado')).toBe(false)
  })

  it('a frase curta que ocupa o lugar do formulário', () => {
    expect(fraseDeInscricaoParada('Cancelado')).toBe(
      'As inscrições estão encerradas porque o evento foi cancelado.',
    )
    expect(fraseDeInscricaoParada('Adiado')).toBe(
      'Enquanto o evento estiver adiado, não recebemos novas inscrições.',
    )
    expect(fraseDeInscricaoParada('Realizado')).toBe(
      'As inscrições estão encerradas.',
    )
    expect(fraseDeInscricaoParada('Programado')).toBeNull()
  })
})

describe('aindaVaiAcontecer — o que conta como "próximo evento"', () => {
  it('programado: enquanto a data não passou', () => {
    expect(aindaVaiAcontecer('Programado', false)).toBe(true)
    expect(aindaVaiAcontecer('Programado', true)).toBe(false)
  })

  it('adiado: sempre (não aconteceu e ainda não tem data nova), mesmo com a data original no passado', () => {
    expect(aindaVaiAcontecer('Adiado', false)).toBe(true)
    expect(aindaVaiAcontecer('Adiado', true)).toBe(true)
  })

  it('cancelado e realizado: nunca', () => {
    for (const passou of [false, true]) {
      expect(aindaVaiAcontecer('Cancelado', passou)).toBe(false)
      expect(aindaVaiAcontecer('Realizado', passou)).toBe(false)
    }
  })
})
