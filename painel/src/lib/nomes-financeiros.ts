import { semCodigo } from '@/lib/rotulo-do-catalogo'

/**
 * v9.3h (pedido do Presidente, 06/11: nada de nome técnico na tela): o nome em português de cada ORIGEM de lançamento do razão contábil e de
 * cada TIPO de alerta da conferência antifraude. O servidor guarda o código (BAIXA_TITULO, FORNECEDOR_NOVO_PAGAMENTO_ALTO); a tela mostra o nome.
 * Código sem nome aqui aparece sem o sublinhado (e a varredura de usabilidade da homologação aponta).
 */
const ORIGEM_DO_LANCAMENTO: Record<string, string> = {
  APLICACAO_CREDITO: 'Uso de crédito do associado',
  BAIXA_TITULO: 'Pagamento de título',
  DOACAO: 'Doação',
  ESTORNO: 'Estorno',
  RECONHECIMENTO_RECEITA_DIFERIDA: 'Receita do mês (pagamento adiantado)',
  TRANSFERENCIA: 'Transferência entre contas',
}

const TIPO_DE_ALERTA: Record<string, string> = {
  LANCAMENTO_FORA_DO_HORARIO: 'Lançamento fora do horário',
  VALOR_PROXIMO_DO_TETO_DE_ALCADA: 'Valor logo abaixo do limite de aprovação',
  FORNECEDOR_NOVO_PAGAMENTO_ALTO: 'Pagamento alto a fornecedor novo',
  SEQUENCIA_DE_ESTORNOS_MESMO_USUARIO: 'Vários estornos da mesma pessoa',
  PAGAMENTO_APOS_TROCA_DE_DADOS_BANCARIOS:
    'Pagamento logo depois de trocar os dados bancários',
  LANCAMENTO_TARDIO: 'Lançamento feito muito depois da data',
}

export function nomeDaOrigem(codigo: string | null | undefined): string {
  if (!codigo) return ''
  return ORIGEM_DO_LANCAMENTO[codigo] ?? semCodigo(codigo)
}

export function nomeDoAlerta(codigo: string): string {
  return TIPO_DE_ALERTA[codigo] ?? semCodigo(codigo)
}
