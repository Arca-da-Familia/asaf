import { describe, expect, it } from 'vitest'

import {
  jsonLdEvento,
  jsonLdMigalhas,
  jsonLdOrganizacao,
  serializarJsonLd,
  tituloDaPagina,
  urlCanonica,
} from '../src/lib/seo'

describe('jsonLdMigalhas (BreadcrumbList)', () => {
  it('começa pela Início e numera as posições a partir de 1', () => {
    const dados = jsonLdMigalhas([
      { rotulo: 'Projetos', caminho: '/projetos/' },
      { rotulo: 'Horta comunitária', caminho: '/projetos/horta/' },
    ])
    expect(dados['@type']).toBe('BreadcrumbList')
    expect(
      dados.itemListElement.map((i) => [i.position, i.name, i.item]),
    ).toEqual([
      [1, 'Início', 'https://asaf.org.br/'],
      [2, 'Projetos', 'https://asaf.org.br/projetos/'],
      [3, 'Horta comunitária', 'https://asaf.org.br/projetos/horta/'],
    ])
  })
})

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

  it('traz a logo institucional como imagem absoluta em https', () => {
    expect(org.logo['@type']).toBe('ImageObject')
    expect(org.logo.url).toBe('https://asaf.org.br/asaf-logo-600.png')
    // Mínimo exigido pelo Google para logo de organização: 112x112.
    expect(org.logo.width).toBeGreaterThanOrEqual(112)
    expect(org.logo.height).toBeGreaterThanOrEqual(112)
  })

  it('traz os dados de contato confirmados pelo usuário em 2026-10-01', () => {
    expect(org.taxID).toBe('17.631.942/0001-70')
    expect(org.telephone).toBe('+55-94-98412-0703')
    expect(org.email).toBe('asaf@asaf.org.br')
    expect(org.address.streetAddress).toBe('Rua Paulo Afonso, 150')
    expect(org.address.postalCode).toBe('68515-000')
  })

  it('não declara o que ninguém informou (redes sociais, horário, etc.)', () => {
    const chaves = Object.keys(org)
    for (const ausente of ['sameAs', 'contactPoint', 'openingHours']) {
      expect(chaves).not.toContain(ausente)
    }
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
    // Sem local próprio o sistema NÃO sabe onde é (pode ser online ou em outro lugar): não se presume
    // a sede nem o modo presencial. Melhor omitir do que declarar dado falso.
    expect(Object.keys(ev)).not.toContain('location')
    expect(Object.keys(ev)).not.toContain('eventAttendanceMode')
    expect(JSON.stringify(ev)).not.toContain('Rua Paulo Afonso')
  })

  it('evento com local próprio NÃO herda o endereço da sede', () => {
    const ev = jsonLdEvento(base, url)
    // Só com endereço próprio o evento tem `location` (e o modo presencial).
    const local = ev.location!
    expect(local.name).toBe('Salão Paroquial, Parauapebas')
    expect(local.address).not.toHaveProperty('streetAddress')
    expect(local.address.addressLocality).toBe('Parauapebas')
  })

  it('evento pago não é marcado como gratuito', () => {
    expect(
      jsonLdEvento({ ...base, gratuito: false }, url).isAccessibleForFree,
    ).toBe(false)
  })
})
