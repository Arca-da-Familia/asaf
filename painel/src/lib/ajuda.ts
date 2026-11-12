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
  '/': {
    paraQue:
      'A página de entrada: os seus avisos e os módulos que o seu nível de acesso libera.',
    passos: [
      'Em "Mural de avisos", clique no título para ler; "Pede a sua confirmação" marca o aviso que espera a sua confirmação.',
      '"Todos os meus avisos" abre a lista completa.',
      'Em "Módulos", clique no cartão do módulo que quer usar.',
    ],
  },
  '/associados': {
    paraQue:
      'O cadastro dos associados: categoria, situação e acesso ao painel.',
    passos: [
      'Busque por nome, CPF, e-mail, telefone ou matrícula e use os filtros "Situação" e "Categoria".',
      'Clique no nome ou em "Ver / editar" para abrir a ficha.',
      'Quem ainda não entra no painel tem o botão "Conceder acesso".',
      '"Novo associado" cadastra uma pessoa; "Importar em lote" traz várias de uma vez.',
    ],
    atencao:
      'Na lista o CPF fica escondido; o completo só aparece na ficha, em "Mostrar o CPF", para quem tem permissão.',
  },
  '/associados/novo': {
    paraQue:
      'Cadastro completo de um novo associado: dados pessoais e endereço.',
    passos: [
      'Preencha os campos com asterisco: "Nome completo", "CPF", "E-mail", "Telefone (WhatsApp)" e "Categoria".',
      'Em "Endereço", preencha "CEP", "Logradouro", "Número", "Bairro", "Cidade" e "Estado (UF)".',
      'Clique em "Cadastrar associado"; a tela volta para a lista.',
    ],
    atencao:
      'Se já existir um cadastro parecido, o sistema recusa; só quem tem a permissão para isso vê "Cadastrar mesmo assim (confirmo que é outra pessoa)".',
  },
  '/associados/propostas': {
    paraQue:
      'Os pedidos de quem quer virar associado: conferir a documentação e aprovar ou recusar.',
    passos: [
      'Use "Situação da proposta" para ver só um tipo de pedido.',
      'Conferidos os papéis, clique em "Marcar documentação conferida".',
      'Depois, em "Aprovar e efetivar", escolha a "Categoria" e clique em "Efetivar associado" (cria o cadastro e a matrícula).',
      'Para negar, use "Recusar proposta", escreva o "Motivo da recusa" e clique em "Confirmar recusa".',
    ],
    atencao:
      '"Aprovar e efetivar" só é liberado quando há o número de sócios propondo que o Estatuto pede (veja "Sócios que propõem").',
  },
  '/financeiro': {
    paraQue:
      'O retrato do dia no Financeiro e o caminho para cada tela do módulo.',
    passos: [
      'Os quadros do alto mostram o saldo nas contas financeiras, o que está a receber vencido, o que há a pagar em até 30 dias e as compras aguardando aprovação.',
      '"Próximos vencimentos em aberto" lista os cinco títulos em aberto de vencimento mais antigo.',
      'Em "Telas do módulo", clique na tela que quer abrir.',
    ],
  },
  '/financeiro/titulos': {
    paraQue:
      'Os títulos a pagar e a receber e a baixa de cada um (o registro de que foi pago ou recebido).',
    passos: [
      'Escolha o "Mês de vencimento" (começa no mês atual) ou "Todo o período", e filtre por situação, tipo, categoria ou busca.',
      '"Novo título" lança uma conta a pagar ou a receber; termine em "Registrar título".',
      'Num título em aberto, "Baixar" pede valor pago, forma de pagamento e conta de contrapartida (caixa ou banco); termine em "Confirmar baixa".',
      'Em títulos a receber, "Ver Pix" mostra o código para pagar e "Aplicar crédito" usa um crédito do associado.',
    ],
    atencao:
      'Se o valor pago passar do saldo, a sobra vira crédito do associado e a tela pede a conta onde registrá-la.',
  },
  '/financeiro/entradas': {
    paraQue:
      'As entradas (títulos a receber): mensalidades, doações e taxas, mês a mês.',
    passos: [
      'Escolha o "Mês de vencimento" ou "Todo o período" e filtre por situação, categoria ou busca.',
      '"Novo título" lança uma entrada nova.',
      '"Ver Pix" mostra o código e o botão "Copiar código Pix", para mandar a quem vai pagar.',
      'Quando o dinheiro entrar, clique em "Baixar" e termine em "Confirmar baixa".',
    ],
    atencao:
      'Se o valor pago passar do saldo, a sobra vira crédito do associado e a tela pede a conta onde registrá-la.',
  },
  '/financeiro/saidas': {
    paraQue:
      'As saídas (títulos a pagar): despesas, compras e reembolsos, mês a mês.',
    passos: [
      'Escolha o "Mês de vencimento" ou "Todo o período" e filtre por situação, categoria ou busca.',
      'Para uma despesa que já foi paga, use "Registrar saída (já paga)".',
      '"Novo título" lança uma conta a pagar; quando pagar, use "Baixar" e "Confirmar baixa".',
      '"Ver nota fiscal" abre a nota anexada ao título.',
    ],
  },
  '/financeiro/registrar-saida': {
    paraQue:
      'Registrar uma saída que já aconteceu (por exemplo, um Pix feito no banco). Aqui não há fila de aprovação: é só o registro.',
    passos: [
      'Escolha a "Categoria da saída", escreva a "Descrição" e diga em "Quem recebeu" se foi um fornecedor ou um associado (reembolso).',
      'Preencha "Valor (R$)", "Forma de pagamento", "Data da despesa", "Data do pagamento" e "De onde saiu o dinheiro".',
      'Anexe a "Nota fiscal" e o "Comprovante do pagamento" (os dois são obrigatórios) e clique em "Registrar saída".',
    ],
    atencao:
      'Saída lançada muitos dias depois do pagamento fica marcada como lançamento tardio para o Conselho Fiscal.',
  },
  '/financeiro/conciliacao': {
    paraQue:
      'Comparar o extrato do banco com os títulos em aberto e fechar o mês conferido.',
    passos: [
      'Escolha o arquivo do extrato (.ofx ou .csv) no campo do alto.',
      'Para cada movimento, a tela sugere o título que corresponde; a baixa é feita na tela Títulos.',
      'Em "Fechamento mensal", informe o mês, a conta financeira e o "Saldo do extrato (R$)" e clique em "Fechar mês".',
    ],
    atencao:
      'Se o saldo do extrato não bater com o saldo calculado pelo sistema, o fechamento é recusado.',
  },
  '/financeiro/gerar-cobrancas': {
    paraQue:
      'Gerar de uma vez as mensalidades de um mês, sempre com uma prévia antes de confirmar.',
    passos: [
      'Preencha "Competência (AAAA-MM)", por exemplo 2026-10, e clique em "Ver prévia".',
      'Confira quantas cobranças serão geradas, o total, as já existentes e os isentos; se estiver certo, clique em "Confirmar geração".',
      'Para quem paga vários meses adiantado, use "Gerar cobrança em bloco", com o associado, o plano e o mês-gatilho.',
    ],
    atencao:
      'Gerar o mesmo mês de novo não duplica: quem já tem cobrança naquela competência fica de fora.',
  },
  '/financeiro/compras': {
    paraQue:
      'O caminho de uma compra: solicitação, cotação, aprovação pela alçada e pagamento.',
    passos: [
      'Em "Nova solicitação", informe a descrição, o valor estimado, a conta contábil e, se quiser, a justificativa; termine em "Criar solicitação".',
      'Numa solicitação aguardando aprovação, "Cotações / Aprovar" registra cada cotação em "Adicionar cotação".',
      'Quem aprova usa "Aprovar"; para negar, "Reprovar", com o motivo, e "Confirmar reprovação".',
      '"Ver aprovações" mostra quem aprovou e quando.',
    ],
    atencao: 'Quem solicita nunca aprova a própria compra.',
  },
  '/financeiro/reembolso-despesa': {
    paraQue:
      'O reembolso de despesa que um voluntário ou dirigente pagou do próprio bolso, com comprovante e aprovação.',
    passos: [
      'Clique em "Solicitar reembolso" e informe o associado que vai receber, o valor, a descrição e a conta contábil.',
      'Anexe o comprovante (obrigatório) e clique em "Solicitar reembolso".',
      'Num pedido "Solicitado", outra pessoa clica em "Aprovar", ou em "Reprovar", com o motivo, e em "Confirmar".',
    ],
    atencao:
      'Nem quem pediu o reembolso nem quem vai recebê-lo podem aprová-lo ou reprová-lo.',
  },
  '/financeiro/relatorios': {
    paraQue:
      'Os relatórios do Financeiro, um por aba: balancete, receitas e despesas, inadimplência, extrato por conta, por projeto, padrões suspeitos e prestação de contas.',
    passos: [
      'Clique na aba do relatório que quer ver.',
      'Em "Balancete", "Receitas x despesas" e "Por projeto", ajuste o período em "De" e "Até".',
      'Em "Receitas x despesas", "Ver por centro de custo" troca o agrupamento.',
      'Em "Prestação de contas", informe o "Ano do exercício" e clique em "Gerar nova versão"; "Ver" abre cada versão.',
    ],
    atencao:
      'Quem só audita (Conselho Fiscal) lê as versões da prestação de contas, mas não gera uma nova.',
  },
  '/financeiro/orcamento': {
    paraQue:
      'O orçamento anual aprovado em assembleia (realizado x previsto), o fluxo de caixa projetado e a reserva de contingência.',
    passos: [
      'Em "Novo orçamento", informe o ano, o valor previsto, a conta contábil e a deliberação da assembleia que aprovou; termine em "Cadastrar orçamento".',
      'Cada linha compara o realizado com o previsto: "Dentro do previsto", "Estourado", "Meta atingida" ou "Abaixo do previsto".',
      '"Fluxo de caixa projetado" mostra, mês a mês, entradas, saídas e o saldo projetado.',
      '"Nova reserva" marca uma conta financeira como reserva, com a regra de uso e, se quiser, um valor mínimo.',
    ],
    atencao:
      'Todo orçamento precisa estar ligado à deliberação da assembleia que o aprovou.',
  },
  '/financeiro/conselho-fiscal': {
    paraQue:
      'A tela do Conselho Fiscal: leitura completa dos títulos e do razão contábil, pareceres e questionamentos à tesouraria.',
    passos: [
      'Em "Títulos financeiros (leitura irrestrita)", busque pela descrição ou filtre pela situação.',
      'Para perguntar sobre um título, clique em "Ver questionamentos", depois em "Questionar" e em "Enviar questionamento"; a tesouraria responde ali mesmo.',
      'Em "Pareceres sobre prestação de contas", "Emitir parecer" registra o parecer do ano: Favorável, Com ressalva ou Contrário.',
    ],
    atencao:
      'Toda consulta nesta tela fica registrada na Auditoria: o Conselho lê tudo, mas deixa rastro de quem viu o quê.',
  },
  '/governanca': {
    paraQue:
      'A lista das assembleias: convocação, condução da sessão e habilitação dos associados.',
    passos: [
      'Cada linha mostra o tipo, a ordem do dia, a 1ª convocação e o status; use "Filtrar…" para achar uma.',
      'Clique no tipo da assembleia para abrir os detalhes.',
      '"Nova assembleia" cadastra uma assembleia; "Petições de convocação" reúne os pedidos de convocação feitos por um quinto dos associados ativos.',
    ],
  },
  '/governanca/mandatos': {
    paraQue:
      'Quem ocupa cada cargo nos órgãos da associação: posse, encerramento e conflito de interesse.',
    passos: [
      '"Mandatos vencendo" mostra os mandatos que terminam no prazo escolhido (de 30 a 365 dias).',
      'Para dar posse, use "Registrar mandato" com associado, órgão, cargo e "Data de início"; "Data de fim previsto (opcional)" em branco usa a duração padrão do mandato.',
      '"Encerrar mandato" pede o motivo (Renúncia, Destituição ou Impedimento temporário) e "Confirmar encerramento".',
      '"Declarar conflito" registra um conflito de interesse; "Encerrar" o encerra.',
    ],
    atencao:
      'Quem fica sem nenhum mandato tem a foto do site apagada; se voltar a ter mandato, é preciso enviar a foto de novo.',
  },
  '/projetos': {
    paraQue:
      'Os projetos da associação, cada um com cronograma, equipe, voluntariado, beneficiários, indicadores, orçamento e encerramento formal.',
    passos: [
      '"Novo projeto" pede nome, foco, tipo, datas, responsável, centro de custo, público-alvo, descrição e quem pode ver; termine em "Criar projeto".',
      'Clique num projeto para abri-lo; com a lista grande, use "Procurar projeto" (nome ou número).',
      'No projeto aberto, troque a situação na caixa junto ao nome e use "Editar projeto" para corrigir os dados.',
      'No fim, "Gerar nova versão" em "Encerramento formal (relatório final)" cria o relatório final.',
    ],
    atencao:
      'Projeto "Pública (site institucional)" leva nome, descrição e público-alvo ao site: não escreva telefone, e-mail nem documento de pessoas.',
  },
  '/eventos': {
    paraQue:
      'Os eventos da associação: programação, inscritos, cobrança, presença e certificado. O mesmo cadastro é lido pelo site.',
    passos: [
      '"Novo evento" pede título, categoria, quem pode ver, local, responsável, vagas e descrição; termine em "Criar evento".',
      'Clique num evento para abri-lo; com a lista grande, use "Procurar evento" (título ou número).',
      'O evento aberto tem as abas "Programação", "Inscritos", "Cobrança" e "Presença e certificado"; "Editar evento" corrige os dados.',
      'Em "Presença e certificado", "Gerar link da portaria" cria o link de check-in, que abre no celular sem entrar no painel.',
    ],
  },
  '/comunicacao': {
    paraQue:
      'Os avisos publicados no mural do painel e quem recebeu, leu e confirmou cada um.',
    passos: [
      '"Novo aviso" publica um aviso no mural de um grupo.',
      'Use "Buscar pelo título" e "Situação" (No mural, Vencido, Retirado) para achar um aviso.',
      'A tabela mostra para quem foi e quantos receberam, leram e confirmaram; clique no título para ver quem leu e confirmou.',
    ],
  },
  '/privacidade': {
    paraQue:
      'Quem responde pelos dados pessoais da associação (o encarregado, pela LGPD), o substituto e o ato de designação assinado.',
    passos: [
      '"Hoje, pelos mandatos" mostra o encarregado (o Presidente) e o substituto, vindos dos mandatos de Governança; "O que falta" lista as pendências.',
      'Clique em "Gerar o ato de designação" e depois em "Abrir o PDF para imprimir".',
      'Colha as assinaturas, escolha o arquivo em "Cópia assinada (PDF, JPG ou PNG)" e clique em "Registrar a assinatura".',
      'Com o ato valendo, use "Ver o texto em PDF" ou "Baixar a cópia assinada"; os anteriores ficam em "Histórico dos atos".',
    ],
    atencao:
      'O ato só vale depois que a cópia assinada é registrada, e só o Presidente gera o ato e registra a assinatura.',
  },
  '/acesso': {
    paraQue: 'Os níveis de acesso do painel e as permissões de cada um.',
    passos: [
      'Marque ou desmarque a caixinha no cruzamento do nível com a permissão: vale na hora, sem botão de salvar.',
      'No celular, escolha o nível em "Nível" e marque as permissões dele.',
      '"Ver como" mostra o painel como aquele nível vê, só para leitura; "Encerrar", na faixa do alto, volta ao seu acesso.',
      '"Novo nível de acesso" cria um nível novo.',
    ],
    atencao:
      'Nível marcado com "Segundo passo" exige o segundo passo de segurança de quem o tem.',
  },
  '/auditoria': {
    paraQue:
      'O registro de quem mudou o quê e quando. É só leitura: nada pode ser apagado por aqui.',
    passos: [
      'Filtre por "Nº do usuário", "Assunto", "O que aconteceu" e pelo período em "Desde" e "Até".',
      'Cada linha mostra quando, o usuário, o que aconteceu, o assunto, o número do registro e o endereço de rede de onde veio.',
    ],
  },
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
