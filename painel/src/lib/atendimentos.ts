import type {
  AtendimentoDaFila,
  SituacaoDoPrazo,
  StatusDeAtendimento,
  TipoDeAtendimento,
} from '@/lib/api'
import { formatarData, formatarDia } from '@/lib/datas'

// v5.5a - o que a fila de atendimento mostra: textos e cores dos avisos de prazo, o aviso sobre o e-mail da resposta e a prévia da mensagem.
// Fica fora da tela para poder ser testado sozinho, sem depender de relógio nem de servidor.

export const TIPOS_DE_ATENDIMENTO: {
  valor: TipoDeAtendimento
  rotulo: string
}[] = [
  { valor: 'CONTATO', rotulo: 'Contato' },
  {
    valor: 'PEDIDO_INFORMACAO',
    rotulo: 'Pedido de informação sobre recursos públicos',
  },
  {
    valor: 'TITULAR_LGPD',
    rotulo: 'Solicitação de titular de dados (LGPD)',
  },
  { valor: 'VOLUNTARIO', rotulo: 'Voluntariado' },
]

// O que a lista pede ao servidor quando a pessoa não escolhe nada: só os pedidos ainda abertos (Novo e Em atendimento).
export const SITUACAO_PADRAO_DA_FILA = 'abertos'
export const TODAS_AS_SITUACOES = 'todas'

export const SITUACOES_DA_FILA: { valor: string; rotulo: string }[] = [
  { valor: SITUACAO_PADRAO_DA_FILA, rotulo: 'Abertos' },
  { valor: 'Novo', rotulo: 'Novo' },
  { valor: 'Em atendimento', rotulo: 'Em atendimento' },
  { valor: 'Respondido', rotulo: 'Respondido' },
  { valor: 'Encerrado', rotulo: 'Encerrado' },
  { valor: TODAS_AS_SITUACOES, rotulo: 'Todas' },
]

export const COR_DA_SITUACAO_DO_ATENDIMENTO: Record<
  StatusDeAtendimento,
  string
> = {
  Novo: 'bg-sky-100 text-sky-900',
  'Em atendimento': 'bg-indigo-100 text-indigo-900',
  Respondido: 'bg-emerald-100 text-emerald-900',
  Encerrado: 'bg-slate-200 text-slate-900',
}

export const COR_DO_PRAZO: Record<SituacaoDoPrazo, string> = {
  no_prazo: 'bg-slate-100 text-slate-900',
  vence_logo: 'bg-amber-100 text-amber-900',
  vencido: 'bg-rose-100 text-rose-900',
  cumprido: 'bg-emerald-100 text-emerald-900',
  cumprido_com_atraso: 'bg-amber-100 text-amber-900',
  encerrado: 'bg-slate-200 text-slate-900',
}

function dias(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`
}

type PrazoDoAtendimento = Pick<
  AtendimentoDaFila,
  'situacao_do_prazo' | 'dias_restantes' | 'prazo_em'
>

// O servidor conta os dias restantes arredondando para cima (1 = vence em até 24 horas): quando o prazo cai no dia de hoje, o texto diz "hoje".
export function textoDoPrazo(
  a: PrazoDoAtendimento,
  agora: Date = new Date(),
): string {
  switch (a.situacao_do_prazo) {
    case 'cumprido':
      return 'Respondido no prazo'
    case 'cumprido_com_atraso':
      return 'Respondido com atraso'
    case 'encerrado':
      return 'Encerrado'
    case 'vencido': {
      const atraso = Math.abs(a.dias_restantes)
      return atraso < 1 ? 'Vencido hoje' : `Vencido há ${dias(atraso)}`
    }
    default: {
      if (
        a.dias_restantes <= 0 ||
        (a.dias_restantes === 1 &&
          formatarData(a.prazo_em) === formatarData(agora))
      )
        return 'Vence hoje'
      return `Vence em ${dias(a.dias_restantes)}`
    }
  }
}

// O que dizer sobre o e-mail da resposta. `noAviso` = o texto vai num aviso solto no alto da tela (o cartão do pedido pode ter saído da lista),
// por isso nele os dados de contato vêm junto em vez de "acima".
export function avisoDoEnvioDaResposta(
  a: Pick<
    AtendimentoDaFila,
    'resposta_enviada_por_email' | 'email_contato' | 'telefone_whatsapp'
  >,
  noAviso = false,
): { texto: string; atencao: boolean } {
  if (a.resposta_enviada_por_email === true)
    return { texto: 'A resposta foi enviada por e-mail.', atencao: false }
  const contato = [
    a.email_contato && `E-mail: ${a.email_contato}`,
    a.telefone_whatsapp && `Telefone: ${a.telefone_whatsapp}`,
  ].filter(Boolean)
  if (a.resposta_enviada_por_email === false)
    return {
      texto: noAviso
        ? `Não foi possível enviar por e-mail: avise a pessoa por outro meio.${contato.length ? ` ${contato.join(' · ')}.` : ''}`
        : 'Não foi possível enviar por e-mail: avise a pessoa por outro meio (e-mail/telefone acima).',
      atencao: true,
    }
  return {
    texto: noAviso
      ? `Sem e-mail cadastrado: avise a pessoa pelo telefone.${a.telefone_whatsapp ? ` Telefone: ${a.telefone_whatsapp}.` : ''}`
      : 'Sem e-mail cadastrado: avise a pessoa pelo telefone.',
    atencao: false,
  }
}

// As primeiras linhas da mensagem para o cartão da lista, cortadas numa palavra inteira.
export function previaDaMensagem(texto: string, limite = 180): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (limpo.length <= limite) return limpo
  const corte = limpo.slice(0, limite)
  const ultimoEspaco = corte.lastIndexOf(' ')
  return `${(ultimoEspaco > limite / 2 ? corte.slice(0, ultimoEspaco) : corte).trimEnd()}…`
}

// ---------------------------------------------------------------------------
// v5.5b - o pedido de voluntariado: a data de nascimento (a idade manda no termo de adesão) e o formulário do termo de adesão.
// ---------------------------------------------------------------------------
export const AVISO_DE_MENOR_DE_IDADE =
  'Menor de 18 anos: o termo de adesão só é aceito com a autorização de um responsável (anote a referência do documento no termo).'

export function textoDaDataDeNascimento(
  a: Pick<AtendimentoDaFila, 'data_nascimento' | 'idade'>,
): string {
  if (!a.data_nascimento) return 'Data de nascimento: não informada.'
  const idade =
    a.idade === null ? '' : ` (${a.idade} ${a.idade === 1 ? 'ano' : 'anos'})`
  return `Data de nascimento: ${formatarDia(a.data_nascimento)}${idade}`
}

// O dia de hoje no formato do campo de data (aaaa-mm-dd), pelo relógio de quem está na tela (não pelo UTC: depois das 21h em Belém o UTC já é amanhã).
export function hojeParaCampoDeData(agora: Date = new Date()): string {
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`
}

export type CamposDoTermoDeAdesao = {
  atividade: string
  carga: string
  inicio: string
  fim: string
  autorizacao: string
}

// A carga horária pode vir com vírgula (4,5): devolve o número, ou null quando não é um número maior que zero.
export function cargaHorariaSemanal(texto: string): number | null {
  const numero = Number(texto.trim().replace(',', '.'))
  return Number.isFinite(numero) && numero > 0 ? numero : null
}

// A primeira coisa que falta no termo, em português; null = pode enviar. O servidor confere tudo de novo (principalmente a menoridade).
export function validarTermoDeAdesao(
  c: CamposDoTermoDeAdesao,
  exigeAutorizacao: boolean,
): string | null {
  if (!c.atividade.trim()) return 'Informe a atividade do voluntário.'
  if (c.carga.trim() === '') return 'Informe a carga horária semanal.'
  if (cargaHorariaSemanal(c.carga) === null)
    return 'A carga horária semanal precisa ser um número maior que zero.'
  if (!c.inicio) return 'Informe o início da vigência.'
  if (!c.fim) return 'Informe o fim da vigência.'
  if (c.fim <= c.inicio)
    return 'O fim da vigência precisa ser depois do início.'
  if (exigeAutorizacao && !c.autorizacao.trim())
    return 'Informe a referência da autorização do responsável: sem ela o termo de menor de 18 anos não vale.'
  return null
}

// A recusa do servidor ao termo de quem é menor de idade (ou de quem ainda não tem data de nascimento no cadastro).
export function recusaPorFaltaDeAutorizacao(mensagem: string): boolean {
  return /menor de idade/i.test(mensagem)
}
