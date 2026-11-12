// v9.3 (plano: "ajuda contextual por módulo, no lugar de manual em PDF que ninguém lê"): o "Como usar esta tela" de cada tela, em linguagem simples.
// Cada texto descreve o que a tela FAZ hoje (conferido no código da tela); tela sem texto aqui não mostra o botão. A chave é o endereço da tela; endereço
// com número (/associados/12) usa a chave com `:id`.
export type AjudaDaTela = {
  /** para que a tela serve, numa frase */
  paraQue: string
  /** os primeiros passos, na ordem */
  passos: string[]
  /** o que merece cuidado (opcional) */
  atencao?: string
}

export const AJUDA: Record<string, AjudaDaTela> = {
  '/atendimentos': {
    paraQue:
      'Aqui chega o que as pessoas mandam pelo site: contato, pedido de informação sobre recursos públicos, pedido sobre os próprios dados e oferta de voluntariado. Cada pedido tem um número de protocolo e um prazo.',
    passos: [
      'Os quadros do alto mostram quantos pedidos estão novos, em atendimento, vencidos e perto de vencer.',
      'Use "Buscar atendimento" (nome, e-mail ou protocolo) e os filtros de tipo e situação para achar um pedido.',
      'Abra o pedido e clique em "Assumir" para dizer que é você quem cuida dele.',
      'Escreva a resposta em "Responder"; quando não houver mais nada a fazer, use "Encerrar", com o motivo.',
    ],
    atencao:
      'Pedido sobre os próprios dados (LGPD) tem prazo de até 15 dias e, antes de responder, é preciso validar a identidade de quem pediu.',
  },
  '/financeiro/fornecedores': {
    paraQue:
      'O cadastro das empresas e pessoas de quem a associação compra, usado nos títulos a pagar e nas compras.',
    passos: [
      'Para achar um fornecedor, use "Procurar fornecedor" (razão social ou CNPJ).',
      'Para cadastrar, clique em "Novo fornecedor" e preencha razão social, CNPJ, categoria e telefone.',
      '"Validar situação" consulta a situação do CNPJ nos dados públicos da Receita Federal.',
      'Em "Dados bancários" fica o histórico da conta para pagamento: a troca só vale depois que outra pessoa aprova.',
    ],
    atencao:
      'Quem pediu a troca de dados bancários nunca pode aprová-la: é a proteção contra o golpe mais comum em organizações.',
  },
  '/financeiro/alcadas-aprovacao': {
    paraQue:
      'Quem pode aprovar cada compra, conforme o valor (as faixas), e as delegações temporárias (por exemplo, nas férias de quem aprova).',
    passos: [
      'A aba "Em vigor" mostra as faixas que valem hoje, do menor valor para o maior.',
      'Para criar uma faixa, clique em "Nova alçada", informe os valores, marque os cargos que podem aprovar e, se for o caso, a dupla assinatura.',
      'Uma faixa inativada vai para a aba "Inativas", de onde pode ser reativada.',
      'Em "Delegações temporárias", registre quem aprova no lugar de quem, até quando e por quê.',
    ],
  },
  '/financeiro/planos-contribuicao': {
    paraQue:
      'As mensalidades por categoria de associado, as isenções e a campanha de desconto para quem paga vários meses de uma vez.',
    passos: [
      'Na aba "Planos", veja o valor de cada plano; "Reajustar" cria um valor novo a partir de uma data (o anterior fica no histórico).',
      'Na aba "Isenções", registre o desconto de um associado, com o motivo e o período.',
      'Na aba "Desconto por pagamento antecipado", fica a campanha decidida em assembleia.',
    ],
  },
  '/financeiro/centros-custo': {
    paraQue:
      'Os centros de custo agrupam receitas e despesas por projeto, evento ou área, para saber quanto cada um custou.',
    passos: [
      'Use "Procurar centro de custo" (código ou nome) para achar um centro.',
      '"Novo centro de custo" cria um, opcionalmente ligado a um projeto ou a um evento.',
      '"Marcar como destinação restrita" serve para doação com finalidade específica: o saldo só pode ser usado nela.',
      'Na aba "Remanejamentos de destinação" fica o registro formal de quando um saldo restrito muda de finalidade.',
    ],
  },
  '/financeiro/contas-financeiras': {
    paraQue:
      'O caixa, as contas no banco e as aplicações. O saldo de cada uma é sempre a soma do que foi lançado nela.',
    passos: [
      'Use "Procurar conta financeira" (código ou nome) para achar uma conta.',
      '"Nova conta financeira" liga uma conta do plano de contas (do tipo Ativo) a um caixa, conta corrente ou aplicação.',
    ],
  },
  '/documentos': {
    paraQue:
      'O arquivo da associação: estatuto, atas, balanços, certidões e termos. O original fica guardado em área privada; ao site só vai a versão pública, aprovada por outra pessoa.',
    passos: [
      'Na aba "Biblioteca", cada tipo mostra os primeiros documentos; "Ver todos" abre a lista inteira daquele tipo.',
      'Use "Buscar" e os filtros (tipo, ano, situação, classificação) para achar um documento.',
      '"Novo documento" cadastra um documento novo.',
      'As abas "Contas do exercício" e "Relatório anual" preparam o que vai para o site de transparência.',
    ],
  },
}

/** A ajuda da tela no endereço `caminho`: a da chave exata ou, para endereço com número, a da chave com `:id`. */
export function ajudaDaTela(caminho: string): AjudaDaTela | undefined {
  const limpo = caminho.replace(/\/+$/, '') || '/'
  return AJUDA[limpo] ?? AJUDA[limpo.replace(/\/\d+(?=\/|$)/g, '/:id')]
}
