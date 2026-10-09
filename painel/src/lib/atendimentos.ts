import type {
  AtendimentoDaFila,
  SituacaoDoPrazo,
  StatusDeAtendimento,
  TipoDeAtendimento,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

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
