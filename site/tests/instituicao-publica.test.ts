import { describe, expect, it } from 'vitest'

import { ORGANIZACAO } from '../src/config/organizacao'
import {
  cnpjValido,
  emailValido,
  enderecoDaRede,
  formatarCnpj,
  organizacaoComInstituicao,
  telefoneBrasileiro,
} from '../src/lib/instituicao-publica'
import { jsonLdOrganizacao } from '../src/lib/seo'
import { impressaoDoConteudo } from '../scripts/lib/conteudo-publico.mjs'

describe('organizacaoComInstituicao (v5.4h): só o que está preenchido E válido sobrepõe o texto fixo', () => {
  it('sem dado nenhum (ou com a rota ausente), vale tudo o que o site já tinha', () => {
    for (const dados of [undefined, {}]) {
      const org = organizacaoComInstituicao(dados)
      expect(org.cnpj).toBe(ORGANIZACAO.cnpj)
      expect(org.telefone).toBe(ORGANIZACAO.telefone)
      expect(org.telefoneLink).toBe(ORGANIZACAO.telefoneLink)
      expect(org.email).toBe(ORGANIZACAO.email)
      expect(org.nome).toBe(ORGANIZACAO.nome)
      expect(org.horarioDeAtendimento).toBeNull()
      expect(org.redes).toEqual({ instagram: null, facebook: null })
    }
  })

  it('o CNPJ de exemplo que veio de fábrica (inválido) nunca vai ao ar, nem o que sobra de um campo apagado ou mal digitado', () => {
    for (const cnpj of [
      '00.000.000/0001-00',
      '',
      '   ',
      '11.222.333/0001-82', // dígito verificador errado
      '11.111.111/1111-11', // todos iguais
      '1122233300018', // faltou um dígito
    ]) {
      expect(organizacaoComInstituicao({ CNPJ: cnpj }).cnpj).toBe(
        ORGANIZACAO.cnpj,
      )
    }
  })

  it('dado válido sobrepõe, no formato do site', () => {
    const org = organizacaoComInstituicao({
      CNPJ: '11222333000181',
      TELEFONE_INSTITUCIONAL: '94 99999-8888',
      EMAIL_INSTITUCIONAL: ' contato.teste@asaf.org.br ',
      HORARIO_ATENDIMENTO: 'Segunda a sexta, das 8h às 17h',
      SITE_INSTAGRAM: '@asaf.teste',
      SITE_FACEBOOK: 'https://www.facebook.com/asaf.teste',
    })
    expect(org.cnpj).toBe('11.222.333/0001-81')
    expect(org.telefone).toBe('(94) 99999-8888')
    expect(org.telefoneLink).toBe('tel:+5594999998888')
    expect(org.telefoneInternacional).toBe('+55-94-99999-8888')
    expect(org.email).toBe('contato.teste@asaf.org.br')
    expect(org.horarioDeAtendimento).toBe('Segunda a sexta, das 8h às 17h')
    expect(org.redes.instagram).toBe('https://www.instagram.com/asaf.teste/')
    expect(org.redes.facebook).toBe('https://www.facebook.com/asaf.teste')
  })

  it('cada campo é independente: um inválido não derruba os válidos', () => {
    const org = organizacaoComInstituicao({
      CNPJ: 'lixo',
      TELEFONE_INSTITUCIONAL: '123',
      EMAIL_INSTITUCIONAL: 'nao-e-email',
      HORARIO_ATENDIMENTO: 'Terça e quinta, das 14h às 18h',
    })
    expect(org.cnpj).toBe(ORGANIZACAO.cnpj)
    expect(org.telefone).toBe(ORGANIZACAO.telefone)
    expect(org.email).toBe(ORGANIZACAO.email)
    expect(org.horarioDeAtendimento).toBe('Terça e quinta, das 14h às 18h')
  })

  it('o nome, o endereço da sede e a apresentação são sempre os do Estatuto, mesmo se a Instituição mandar outros', () => {
    const org = organizacaoComInstituicao({
      NOME_INSTITUICAO: 'Outro Nome',
      ENDERECO: 'Rua Qualquer, 1',
    })
    expect(org.nome).toBe(ORGANIZACAO.nome)
    expect(org.endereco).toEqual(ORGANIZACAO.endereco)
  })

  it('não altera o objeto fixo do site (cada chamada parte dos dados do Estatuto)', () => {
    const antes = JSON.stringify(ORGANIZACAO)
    organizacaoComInstituicao({
      CNPJ: '11.222.333/0001-81',
      SITE_INSTAGRAM: '@x1',
    })
    expect(JSON.stringify(ORGANIZACAO)).toBe(antes)
    expect(organizacaoComInstituicao({}).cnpj).toBe(ORGANIZACAO.cnpj)
  })
})

describe('validadores da Instituição', () => {
  it('CNPJ: só passa com os dígitos verificadores certos', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido(ORGANIZACAO.cnpj)).toBe(true)
    expect(cnpjValido('00.000.000/0001-00')).toBe(false)
    expect(cnpjValido('11.222.333/0001-80')).toBe(false)
    expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81')
  })

  it('telefone: fixo de 10 dígitos ou celular de 11 com 9; com ou sem o 55; recusa o resto', () => {
    expect(telefoneBrasileiro('(94) 3322-1100')?.texto).toBe('(94) 3322-1100')
    expect(telefoneBrasileiro('+55 94 98412-0703')?.link).toBe(
      'tel:+5594984120703',
    )
    expect(telefoneBrasileiro('94984120703')?.internacional).toBe(
      '+55-94-98412-0703',
    )
    for (const ruim of [
      '',
      '123',
      '(94) 8412-07031',
      '(09) 98412-0703',
      '(94) 88412-0703',
    ]) {
      expect(telefoneBrasileiro(ruim)).toBeNull()
    }
  })

  it('e-mail: precisa ter forma de endereço', () => {
    expect(emailValido('a@b.org')).toBe(true)
    for (const ruim of [
      '',
      'a@b',
      'a b@c.org',
      '<a@b.org>',
      `${'x'.repeat(120)}@b.org`,
    ]) {
      expect(emailValido(ruim)).toBe(false)
    }
  })

  it('redes: só o endereço do próprio Instagram/Facebook (por HTTPS) ou @perfil; qualquer outro destino é descartado', () => {
    expect(enderecoDaRede('@asaf.teste', 'instagram')).toBe(
      'https://www.instagram.com/asaf.teste/',
    )
    expect(enderecoDaRede('https://instagram.com/asaf', 'instagram')).toBe(
      'https://instagram.com/asaf',
    )
    expect(enderecoDaRede('asaf.fb', 'facebook')).toBe(
      'https://www.facebook.com/asaf.fb',
    )
    for (const ruim of [
      '',
      '   ',
      '@',
      'http://instagram.com/asaf', // sem HTTPS
      'https://evil.example/instagram.com',
      'https://instagram.com.evil.example/asaf',
      'https://user:senha@instagram.com/asaf',
      'javascript:alert(1)',
      '@com espaço',
    ]) {
      expect(enderecoDaRede(ruim, 'instagram')).toBeNull()
    }
    // o Facebook não aceita endereço do Instagram, e vice-versa
    expect(enderecoDaRede('https://instagram.com/asaf', 'facebook')).toBeNull()
  })
})

describe('a Instituição no que o site publica', () => {
  it('muda a impressão do conteúdo quando a diretoria preenche ou troca um dado (o site é reconstruído sozinho)', () => {
    const base = { eventos: [], instituicao: {} as Record<string, string> }
    const original = impressaoDoConteudo(base)
    const preenchido = impressaoDoConteudo({
      ...base,
      instituicao: { TELEFONE_INSTITUCIONAL: '(94) 99999-8888' },
    })
    const trocado = impressaoDoConteudo({
      ...base,
      instituicao: { TELEFONE_INSTITUCIONAL: '(94) 99999-0000' },
    })
    expect(preenchido).not.toBe(original)
    expect(trocado).not.toBe(preenchido)
    expect(impressaoDoConteudo({ ...base, instituicao: {} })).toBe(original)
  })

  it('o JSON-LD da organização usa o CNPJ/telefone/e-mail sobrepostos e só cita as redes que existem', () => {
    const sem = jsonLdOrganizacao(organizacaoComInstituicao({}))
    expect(sem.taxID).toBe(ORGANIZACAO.cnpj)
    expect('sameAs' in sem).toBe(false)
    const com = jsonLdOrganizacao(
      organizacaoComInstituicao({
        CNPJ: '11.222.333/0001-81',
        SITE_INSTAGRAM: '@asaf.teste',
      }),
    )
    expect(com.taxID).toBe('11.222.333/0001-81')
    expect((com as { sameAs?: string[] }).sameAs).toEqual([
      'https://www.instagram.com/asaf.teste/',
    ])
  })
})
