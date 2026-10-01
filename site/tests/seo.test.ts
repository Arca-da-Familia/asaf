import { describe, expect, it } from 'vitest'

import {
  jsonLdEvento,
  jsonLdOrganizacao,
  serializarJsonLd,
  tituloDaPagina,
  urlCanonica,
} from '../src/lib/seo'

describe('tituloDaPagina', () => {
  it('home usa o nome completo', () => {
    expect(tituloDaPagina()).toBe('ASAF — Associação Arca da Família')
  })
  it('página interna vira "Título | ASAF"', () => {
    expect(tituloDaPagina('Contato')).toBe('Contato | ASAF')
  })
})

describe('urlCanonica', () => {
  it('é sempre absoluta, no domínio de produção', () => {
    expect(urlCanonica('/')).toBe('https://asaf.org.br/')
  })
  it('normaliza com barra final (o Astro gera pasta/index.html)', () => {
    expect(urlCanonica('/quem-somos')).toBe('https://asaf.org.br/quem-somos/')
    expect(urlCanonica('quem-somos')).toBe('https://asaf.org.br/quem-somos/')
    expect(urlCanonica('/quem-somos/')).toBe('https://asaf.org.br/quem-somos/')
  })
  it('descarta query string e fragmento (mesmo conteúdo = mesma URL)', () => {
    expect(urlCanonica('/noticias?pagina=2#topo')).toBe(
      'https://asaf.org.br/noticias/',
    )
  })
  it('não põe barra em arquivo', () => {
    expect(urlCanonica('/sitemap-0.xml')).toBe(
      'https://asaf.org.br/sitemap-0.xml',
    )
  })
})

describe('serializarJsonLd', () => {
  it('escapa "<" — título com </script> não fecha a tag nem injeta HTML', () => {
    const hostil = { name: '</script><script>alert(1)</script>' }
    const saida = serializarJsonLd(hostil)
    expect(saida).not.toContain('</script>')
    expect(saida).not.toContain('<')
    // E continua sendo JSON válido que devolve o dado original intacto.
    expect(JSON.parse(saida)).toEqual(hostil)
  })
})

describe('jsonLdOrganizacao', () => {
  const org = jsonLdOrganizacao()

  it('descreve a ASAF como organização com dados do Estatuto', () => {
    expect(org['@type']).toBe('NGO')
    expect(org.name).toBe('Associação Arca da Família')
    expect(org.alternateName).toBe('ASAF')
    expect(org.foundingDate).toBe('2013-02-10')
    expect(org.address.addressLocality).toBe('Parauapebas')
    expect(org.address.addressRegion).toBe('PA')
  })

  it('não declara dado que ainda não foi confirmado (CNPJ, telefone, e-mail, rua)', () => {
    const chaves = Object.keys(org)
    for (const proibida of ['telephone', 'email', 'vatID', 'taxID', 'logo']) {
      expect(chaves).not.toContain(proibida)
    }
    expect(Object.keys(org.address)).not.toContain('streetAddress')
  })
})

describe('jsonLdEvento', () => {
  const base = {
    id_evento: 7,
    titulo: 'Encontro de Famílias',
    descricao: 'Tarde de convivência.',
    data_hora_inicio: '2026-10-10T19:00:00',
    data_hora_fim: '2026-10-10T21:30:00',
    endereco_avulso: 'Salão Paroquial, Parauapebas',
    gratuito: true,
  }
  const url = 'https://asaf.org.br/eventos/7/'

  it('gera schema.org/Event com data COM fuso (senão o Google erra 3 horas)', () => {
    const ev = jsonLdEvento(base, url)
    expect(ev['@type']).toBe('Event')
    expect(ev.name).toBe('Encontro de Famílias')
    expect(ev.startDate).toBe('2026-10-10T19:00:00-03:00')
    expect(ev.endDate).toBe('2026-10-10T21:30:00-03:00')
    expect(Number.isNaN(Date.parse(ev.startDate))).toBe(false)
    expect(ev.isAccessibleForFree).toBe(true)
    expect(ev.url).toBe(url)
    expect(ev.eventAttendanceMode).toBe(
      'https://schema.org/OfflineEventAttendanceMode',
    )
  })

  it('liga o evento à organização pelo mesmo @id', () => {
    expect(jsonLdEvento(base, url).organizer['@id']).toBe(
      jsonLdOrganizacao()['@id'],
    )
  })

  it('omite o que não existe em vez de inventar', () => {
    const ev = jsonLdEvento(
      { ...base, descricao: null, data_hora_fim: null, endereco_avulso: null },
      url,
    )
    expect(Object.keys(ev)).not.toContain('description')
    expect(Object.keys(ev)).not.toContain('endDate')
    expect(Object.keys(ev)).not.toContain('offers')
    expect(Object.keys(ev)).not.toContain('image')
    expect(ev.location.name).toBe('Sede da ASAF')
  })

  it('evento pago não é marcado como gratuito', () => {
    expect(
      jsonLdEvento({ ...base, gratuito: false }, url).isAccessibleForFree,
    ).toBe(false)
  })
})
