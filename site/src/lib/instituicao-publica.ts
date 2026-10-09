import { ORGANIZACAO } from '../config/organizacao'

/**
 * Os dados da Instituição que o painel marcou "vai para o site" (`/api/publico/instituicao`, v5.4h) por cima dos dados fixos do site (`config/organizacao.ts`).
 *
 * REGRA: o painel só SOBRESCREVE o que está preenchido E válido (CNPJ com dígitos que conferem, e-mail, telefone brasileiro, endereço de rede social de verdade); o que
 * está vazio, inválido ou fora do formato cai no texto fixo do site. É assim que o CNPJ de exemplo que veio de fábrica (`00.000.000/0001-00`, inválido) nunca vai ao ar,
 * e que um campo apagado no painel não deixa um buraco no rodapé. O nome da associação, o endereço da sede e o texto de apresentação ficam sempre os do site (vêm do
 * Estatuto e já foram conferidos).
 */
type Largo<T> = {
  -readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends readonly string[]
      ? string[]
      : T[K] extends object
        ? Largo<T[K]>
        : T[K]
}

export type OrganizacaoDoSite = Largo<typeof ORGANIZACAO> & {
  /** "Segunda a sexta, das 8h às 17h" — só aparece se a diretoria preencher. */
  horarioDeAtendimento: string | null
  redes: { instagram: string | null; facebook: string | null }
}

export type DadosDaInstituicao = Record<string, string | undefined>

const soDigitos = (texto: string) => texto.replace(/\D/g, '')

export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const digito = (tamanho: number) => {
    const pesos =
      tamanho === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13])
}

export function formatarCnpj(cnpj: string): string {
  const d = soDigitos(cnpj)
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** Telefone brasileiro (com ou sem 55 na frente): 10 dígitos (fixo) ou 11 com 9 depois do DDD (celular). */
export function telefoneBrasileiro(
  texto: string,
): { texto: string; link: string; internacional: string } | null {
  let d = soDigitos(texto)
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return null
  const ddd = d.slice(0, 2)
  if (Number(ddd) < 11) return null
  if (d.length === 11 && d[2] !== '9') return null
  const numero = d.slice(2)
  const quebra = numero.length - 4
  return {
    texto: `(${ddd}) ${numero.slice(0, quebra)}-${numero.slice(quebra)}`,
    link: `tel:+55${d}`,
    internacional: `+55-${ddd}-${numero.slice(0, quebra)}-${numero.slice(quebra)}`,
  }
}

export function emailValido(texto: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(texto) && texto.length <= 120
}

/** `@perfil` ou endereço completo do próprio Instagram/Facebook; qualquer outro endereço é descartado (o link vai a um lugar que o painel não conferiu). */
export function enderecoDaRede(
  valor: string,
  rede: 'instagram' | 'facebook',
): string | null {
  const texto = valor.trim()
  if (!texto) return null
  const dominio = rede === 'instagram' ? 'instagram.com' : 'facebook.com'
  if (/^https?:\/\//i.test(texto)) {
    try {
      const url = new URL(texto)
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      if (url.protocol === 'https:' && host === dominio && !url.username)
        return url.toString()
    } catch {
      return null
    }
    return null
  }
  const perfil = texto.replace(/^@/, '')
  if (!/^[A-Za-z0-9._-]{2,50}$/.test(perfil)) return null
  return rede === 'instagram'
    ? `https://www.instagram.com/${perfil}/`
    : `https://www.facebook.com/${perfil}`
}

export function organizacaoComInstituicao(
  dados: DadosDaInstituicao = {},
): OrganizacaoDoSite {
  const base = {
    ...ORGANIZACAO,
    endereco: { ...ORGANIZACAO.endereco },
    areasDeAtuacao: [...ORGANIZACAO.areasDeAtuacao],
  } as Largo<typeof ORGANIZACAO>
  const organizacao: OrganizacaoDoSite = {
    ...base,
    horarioDeAtendimento: null,
    redes: { instagram: null, facebook: null },
  }
  const cnpj = (dados.CNPJ ?? '').trim()
  if (cnpj && cnpjValido(cnpj)) organizacao.cnpj = formatarCnpj(cnpj)
  const email = (dados.EMAIL_INSTITUCIONAL ?? '').trim()
  if (email && emailValido(email)) organizacao.email = email
  const telefone = telefoneBrasileiro(dados.TELEFONE_INSTITUCIONAL ?? '')
  if (telefone) {
    organizacao.telefone = telefone.texto
    organizacao.telefoneLink = telefone.link
    organizacao.telefoneInternacional = telefone.internacional
  }
  const horario = (dados.HORARIO_ATENDIMENTO ?? '').trim()
  if (horario && horario.length <= 120)
    organizacao.horarioDeAtendimento = horario
  organizacao.redes = {
    instagram: enderecoDaRede(dados.SITE_INSTAGRAM ?? '', 'instagram'),
    facebook: enderecoDaRede(dados.SITE_FACEBOOK ?? '', 'facebook'),
  }
  return organizacao
}
