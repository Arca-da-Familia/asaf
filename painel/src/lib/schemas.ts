import { z } from 'zod'

// v0.2.8 — schemas Zod compartilhados entre formulário (validação de entrada) e contrato de
// API (validação da resposta em lib/api.ts). O objetivo: se o backend mudar/remover um campo,
// a quebra aparece no `apiFetch` (e no teste de contrato) antes do usuário ver a tela travada
// com `undefined` em algum lugar.

export const enderecoSchema = z.object({
  cep: z.string().nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  estado: z.string().nullish(),
})

// Usado pelo formulário "Novo associado" (pages/AssociadoNovo.tsx) — o backend valida de
// verdade (dígito verificador do CPF, CEP com 8 dígitos, etc.); estas regras aqui são só a
// primeira barreira, pra dar erro na hora em vez de esperar o round-trip da API.
export const associadoMasterSchema = z.object({
  nome_completo: z.string().min(3, 'Informe o nome completo.'),
  cpf: z.string().min(11, 'CPF deve ter 11 dígitos.').max(14),
  email_contato: z.string().email('E-mail inválido.'),
  telefone_whatsapp: z.string().min(10, 'Informe um telefone válido.'),
  categoria: z.string().min(1, 'Selecione uma categoria.'),
  cep: z.string().min(8, 'CEP deve ter 8 dígitos.').max(9),
  logradouro: z.string().min(1, 'Informe o logradouro.'),
  numero: z.string().min(1, 'Informe o número.'),
  bairro: z.string().min(1, 'Informe o bairro.'),
  cidade: z.string().min(1, 'Informe a cidade.'),
  estado: z.string().length(2, 'UF com 2 letras.'),
  data_nascimento: z.string().optional(),
  estado_civil: z.string().optional(),
  profissao: z.string().optional(),
  naturalidade: z.string().optional(),
})

// Usado por "Conceder acesso" (pages/ConcederAcesso.tsx) - o backend também recusa senha curta
// (validar_senha_forte, mínimo 8 hoje) - repetido aqui só pra feedback imediato no formulário.
export const concederAcessoSchema = z.object({
  email: z.string().email('E-mail inválido.'),
  senha_provisoria: z
    .string()
    .min(8, 'A senha deve ter pelo menos 8 caracteres.'),
})

// Usado pelo formulário "Editar associado" (pages/AssociadoDetalhe.tsx, v2.5.1) - mesmos campos
// de associadoMasterSchema, sem CPF (nunca editável depois do cadastro).
export const associadoEditarSchema = z.object({
  nome_completo: z.string().min(3, 'Informe o nome completo.'),
  email_contato: z.string().email('E-mail inválido.'),
  telefone_whatsapp: z.string().min(10, 'Informe um telefone válido.'),
  categoria: z.string().min(1, 'Selecione uma categoria.'),
  cep: z.string().min(8, 'CEP deve ter 8 dígitos.').max(9),
  logradouro: z.string().min(1, 'Informe o logradouro.'),
  numero: z.string().min(1, 'Informe o número.'),
  bairro: z.string().min(1, 'Informe o bairro.'),
  cidade: z.string().min(1, 'Informe a cidade.'),
  estado: z.string().length(2, 'UF com 2 letras.'),
  data_nascimento: z.string().optional(),
  estado_civil: z.string().optional(),
  profissao: z.string().optional(),
  naturalidade: z.string().optional(),
})

export const cargoCriarSchema = z.object({
  titulo_cargo: z.string().min(1, 'Informe o cargo.'),
  data_posse: z.string().min(1, 'Informe a data de posse.'),
})

export const dependenteCriarSchema = z
  .object({
    grau_parentesco: z.string().min(1, 'Selecione o grau de parentesco.'),
    id_pessoa_vinculada: z.coerce.number().int().optional(),
    nome_completo: z.string().optional(),
    data_nascimento: z.string().optional(),
  })
  .refine(
    (d) =>
      d.id_pessoa_vinculada || (d.nome_completo && d.nome_completo.length >= 3),
    {
      message:
        'Selecione uma pessoa existente ou informe o nome de uma pessoa nova.',
      path: ['nome_completo'],
    },
  )

// Usado pelo formulário "Dados cadastrais" (pages/Perfil.tsx) — os únicos campos editáveis do
// próprio associado nesta versão.
export const perfilEditavelSchema = z.object({
  email_contato: z.string().email('E-mail inválido.'),
  telefone_whatsapp: z.string().min(10, 'Informe um telefone válido.'),
  cep: z.string(),
  logradouro: z.string(),
  numero: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  estado: z.string(),
})

// Resposta de GET /auth/perfil — reaproveita perfilEditavelSchema.shape para os campos que
// também existem no formulário, e é mais permissivo (nullable) porque cadastro incompleto é
// um estado real de leitura, não um erro.
export const perfilResponseSchema = z.object({
  id_associado: z.number().nullish(),
  nome_completo: z.string().nullish(),
  cpf: z.string().nullish(),
  email_contato: z.string().nullish(),
  telefone_whatsapp: z.string().nullish(),
  categoria: z.string().nullish(),
  status_arrolamento: z.string().nullish(),
  data_admissao: z.string().nullish(),
  endereco: enderecoSchema.nullish(),
})

// Usado por "Nova assembleia" (pages/AssembleiaNova.tsx, v2.5.2) - `tipo` é um enum fechado do
// estatuto (Art. 5º: Ordinária/Extraordinária/Solene), por isso não vem de catálogo editável.
export const assembleiaCriarSchema = z.object({
  tipo: z.string().min(1, 'Selecione o tipo.'),
  pauta: z.string().min(3, 'Informe a ordem do dia.'),
  data_hora_convocacao: z
    .string()
    .min(1, 'Informe a data e hora da convocação.'),
  local_fisico: z.string().optional(),
  link_remoto: z.string().optional(),
})

// Usado por "Nova petição" (pages/PeticoesConvocacao.tsx, v2.5.2).
export const peticaoCriarSchema = z.object({
  pauta_proposta: z.string().min(3, 'Descreva a pauta proposta.'),
})

// Usado pelo painel da sessão (pages/SessaoAssembleia.tsx, v2.5.2) - credenciamento por busca
// manual do associado (o QR da carteirinha é outro caminho do mesmo endpoint, sem tela ainda).
export const credenciarSchema = z.object({
  id_associado: z.coerce.number().int({ message: 'Selecione um associado.' }),
  modalidade: z.enum(['Presencial', 'Remoto']),
})

export const itemPautaCriarSchema = z.object({
  titulo: z.string().min(2, 'Informe o título do item.'),
  descricao: z.string().optional(),
  // Number('') = 0 (não NaN) - campo em branco chega como 0, tratado como "sem tempo definido"
  // do mesmo jeito que undefined (ver criarItemPauta em lib/api.ts).
  tempo_fala_minutos: z.coerce.number().int().optional(),
})

export const ocorrenciaCriarSchema = z.object({
  descricao: z.string().min(3, 'Descreva a ocorrência.'),
})

// Usado por "Abrir votação" (pages/SessaoAssembleia.tsx, v2.5.3) - `opcoes` fica como texto
// separado por vírgula neste formulário (o campo do backend é uma lista) e é convertido em
// array só no submit; o nome do campo é o MESMO do backend (`opcoes`) para o mapeamento
// automático de erro 422 do FormShell funcionar mesmo com essa conversão.
export const votacaoAbrirSchema = z.object({
  titulo: z.string().min(2, 'Informe o título da votação.'),
  tipo: z.enum(['Aberta/Nominal', 'Secreta', 'Aclamação']),
  escrutinio: z.enum(['Maioria simples', 'Maioria absoluta', 'Qualificada']),
  opcoes: z.string().min(1, 'Informe as opções separadas por vírgula.'),
  fracao_qualificada: z.string().optional(),
  considerar_abstencao_na_base: z.boolean().optional(),
})

export const votoSchema = z.object({
  opcao: z.string().min(1, 'Selecione uma opção.'),
})

export const impugnacaoCriarSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo da impugnação.'),
})

export const resolverEmpateSchema = z.object({
  vencedor: z.string().min(1, 'Selecione o vencedor.'),
  justificativa: z.string().min(5, 'Justifique a resolução do empate.'),
})

export const resolverImpugnacaoSchema = z.object({
  resolucao: z.string().min(3, 'Descreva a resolução da impugnação.'),
})

// Usado por "Bater presença" (pages/MinhasAssembleias.tsx, v2.5.3b) - código anunciado/
// projetado na sala pelo coordenador (`obterCodigoChamada`).
export const baterPresencaSchema = z.object({
  codigo: z.string().min(1, 'Informe o código de chamada.'),
  modalidade: z.enum(['Presencial', 'Remoto']),
})

export const credenciamentoManualSchema = z.object({
  id_associado: z.coerce.number().int({ message: 'Selecione um associado.' }),
  modalidade: z.enum(['Presencial', 'Remoto']),
})

export const justificativaCriarSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo da justificativa.'),
})

// Usado por "Lançar em nome de associado" (pages/AssembleiaDetalhe.tsx, v2.5.3b) - só quem tem
// a permissão `governanca` chama esse caminho (o backend também exige).
export const justificativaManualSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo da justificativa.'),
  id_associado: z.coerce.number().int({ message: 'Selecione um associado.' }),
})

// Usado por "Ata" (pages/Ata.tsx, v2.5.4) - relato_secretaria é o único texto livre da ata,
// só editável enquanto ela está em rascunho (o backend recusa depois de assinada).
export const relatoSecretariaSchema = z.object({
  relato_secretaria: z.string(),
})

export const ataRetificarSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo da retificação.'),
})

export const deliberacaoCriarSchema = z
  .object({
    tipo: z.enum([
      'Eleição',
      'Reforma de estatuto',
      'Aprovação de contas',
      'Dissolução',
      'Genérica',
    ]),
    texto: z.string().min(5, 'Descreva a deliberação.'),
    ano_exercicio: z.coerce.number().int().optional(),
  })
  .refine((d) => d.tipo !== 'Aprovação de contas' || !!d.ano_exercicio, {
    message: 'Informe o ano de exercício.',
    path: ['ano_exercicio'],
  })

export const deliberacaoConcluirSchema = z.object({
  observacao: z.string().optional(),
})

// Usado tanto quando a deliberação concluída é do tipo "Eleição" (cria o mandato de uma vez,
// sem os dois campos opcionais abaixo) quanto pelo formulário standalone "Registrar mandato"
// (pages/Mandatos.tsx, v2.5.5) - `data_fim_previsto`/`ato_origem` ficam de fora do fluxo da
// Eleição de propósito (o backend deriva o fim a partir de `DURACAO_MANDATO_ANOS` quando omitido).
export const mandatoCriarSchema = z.object({
  id_associado: z.coerce.number().int({ message: 'Selecione um associado.' }),
  orgao_codigo: z.string().min(1, 'Informe o código do órgão.'),
  cargo_codigo: z.string().min(1, 'Informe o código do cargo.'),
  data_inicio: z.string().min(1, 'Informe a data de início.'),
  data_fim_previsto: z.string().optional(),
  ato_origem: z.string().optional(),
})

// Usado por "Encerrar mandato" (pages/Mandatos.tsx, v2.5.5) - `motivo` é o enum real do backend
// (app/models/mandatos.py::MOTIVOS_ENCERRAMENTO_ANTECIPADO), nunca texto livre.
export const mandatoEncerrarSchema = z.object({
  motivo: z.enum(['Renúncia', 'Destituição', 'Impedimento temporário']),
  referencia_ato: z.string().optional(),
})

// Usado por "Declarar conflito de interesse" (pages/Mandatos.tsx, v2.5.5).
export const declaracaoConflitoCriarSchema = z.object({
  id_associado: z.coerce.number().int({ message: 'Selecione um associado.' }),
  descricao: z.string().min(3, 'Descreva o conflito de interesse.'),
})

// Usado por "Emitir parecer" (pages/ConselhoFiscal.tsx, v2.5.5) - `tipo` é o enum real do
// backend (app/models/conselho_fiscal.py::TIPOS_PARECER).
export const parecerCriarSchema = z.object({
  ano_exercicio: z.coerce
    .number()
    .int()
    .min(2013, 'Ano inválido - a ASAF existe desde 2013.'),
  tipo: z.enum(['Favorável', 'Com ressalva', 'Contrário']),
  texto: z.string().min(10, 'Descreva o parecer.'),
})

export const questionamentoCriarSchema = z.object({
  pergunta: z.string().min(5, 'Descreva o questionamento.'),
})

export const respostaQuestionamentoSchema = z.object({
  texto: z.string().min(3, 'Escreva a resposta.'),
})

// Usado por "Abrir processo" (pages/Disciplina.tsx, v2.5.6) - `motivo_codigo` vem do catálogo
// `motivo_processo_disciplinar` (Art. 16, §1º), nunca texto livre.
export const processoDisciplinarCriarSchema = z.object({
  id_associado: z.coerce.number().int({ message: 'Selecione um associado.' }),
  motivo_codigo: z.string().min(1, 'Selecione o motivo.'),
  descricao: z.string().min(10, 'Descreva os fatos que motivam o processo.'),
})

export const defesaApresentarSchema = z.object({
  texto: z.string().min(5, 'Apresente a defesa.'),
})

// `pena_proposta` vazio = propõe arquivar, sem pena (o próprio backend trata assim - ver
// app/schemas/disciplina.py::ManifestacaoCriar). `''` é convertido pra `undefined` no submit.
export const manifestacaoCriarSchema = z.object({
  pena_proposta: z.string().optional(),
  justificativa: z.string().optional(),
})

export const decisaoExecutarSchema = z.object({
  texto_decisao: z.string().min(10, 'Fundamente a decisão.'),
  suspensao_dias: z.coerce.number().int().optional(),
})

export const homologarSchema = z.object({
  aprovado: z.enum(['sim', 'nao']),
  justificativa: z.string().min(5, 'Justifique a homologação (ou recusa).'),
})

// Usado por "Abrir processo de dissolução" (pages/Dissolucao.tsx, v2.5.6, Art. 31).
export const processoDissolucaoCriarSchema = z.object({
  motivo: z
    .string()
    .min(
      10,
      'Descreva o motivo (Art. 31: impossibilidade de manutenção dos objetivos, desvirtuamento de finalidade, ou carência de recursos).',
    ),
})

export const deliberarDissolucaoSchema = z.object({
  id_deliberacao: z.coerce.number().int({
    message: 'Informe o nº da deliberação de dissolução já concluída.',
  }),
})

export const liquidacaoConcluirSchema = z.object({
  observacao: z.string().min(10, 'Descreva como o passivo foi liquidado.'),
})

export const destinarPatrimonioSchema = z.object({
  entidade_nome: z.string().min(3, 'Informe o nome da entidade destinatária.'),
  entidade_cnpj: z.string().optional(),
  justificativa: z
    .string()
    .min(
      10,
      'Justifique por que a entidade atende aos critérios do Art. 31, Parágrafo Único.',
    ),
  confirma_sede_parauapebas: z.boolean(),
  confirma_anos_minimos: z.boolean(),
  confirma_credenciada: z.boolean(),
})

export const baixaCadastralSchema = z.object({
  observacao: z.string().min(5, 'Descreva a baixa cadastral realizada.'),
})

export const cancelarDissolucaoSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo do cancelamento.'),
})

export const deliberacaoRevogarSchema = z.object({
  motivo: z.string().min(5, 'Descreva o motivo da revogação.'),
})

export const justificativaDecidirSchema = z.object({
  motivo_decisao: z.string().optional(),
})

// Usado por "Agendar evento" (pages/Calendario.tsx, v2.5.7) - `categoria` vem do catálogo
// `categoria_evento_calendario`.
export const eventoCalendarioCriarSchema = z.object({
  titulo: z.string().min(3, 'Informe o título do evento.'),
  descricao: z.string().optional(),
  categoria: z.string().min(1, 'Selecione a categoria.'),
  data_inicio: z.string().min(1, 'Informe a data de início.'),
  data_fim: z.string().optional(),
})

// Usado por "Nova opção" (pages/Configuracoes.tsx, v2.5.8) - `codigo` nunca muda depois de
// criado (o backend recusa até tentativa via payload, mas nem expõe o campo na edição).
export const opcaoCatalogoCriarSchema = z.object({
  codigo: z
    .string()
    .min(1, 'Informe o código.')
    .regex(/^[A-Z0-9_]+$/, 'Use só letras maiúsculas, números e underscore.'),
  rotulo: z.string().min(1, 'Informe o rótulo.'),
})

export const opcaoCatalogoEditarSchema = z.object({
  rotulo: z.string().min(1, 'Informe o rótulo.'),
})

// Usado por "Plano de Contas" (pages/PlanoContas.tsx, v2.5.8) - `tipo` é o RÓTULO do catálogo
// `tipo_conta_contabil` ("Ativo", "Despesa"...), nunca o código técnico (ver lib/api.ts).
export const contaContabilCriarSchema = z.object({
  codigo_contabil: z.string().min(1, 'Informe o código contábil.'),
  descricao_conta: z.string().min(1, 'Informe a descrição.'),
  tipo: z.string().min(1, 'Selecione o tipo.'),
  // v3.1 - conta hierárquica: quando preenchida, esta conta vira filha (analítica) da conta de
  // código informado, que passa a ser sintética. Vazio = conta sem pai (raiz ou solta).
  codigo_contabil_pai: z.string().optional(),
})

// Usado por "Centros de Custo" (pages/CentrosCusto.tsx, v3.1) - "quanto custou o projeto X".
export const centroDeCustoCriarSchema = z.object({
  codigo: z.string().min(1, 'Informe o código.'),
  nome: z.string().min(1, 'Informe o nome.'),
})

// Usado por "Contas Financeiras" (pages/ContasFinanceiras.tsx, v3.1) - especialização de
// PlanoDeContas tipo Ativo (Caixa/Banco); o backend recusa conta que não seja Ativo.
export const contaFinanceiraCriarSchema = z.object({
  id_conta: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil.' })
    .positive({ message: 'Selecione a conta contábil.' }),
  tipo_conta_financeira: z.string().min(1, 'Selecione o tipo.'),
  banco: z.string().optional(),
  agencia: z.string().optional(),
  numero_conta: z.string().optional(),
})

// Usado por "Nova transferência" (pages/RazaoContabil.tsx, v3.1) - entre duas Contas
// Financeiras; o backend recusa origem igual a destino.
export const transferenciaCriarSchema = z.object({
  id_conta_financeira_origem: z.coerce
    .number()
    .int({ message: 'Selecione a conta de origem.' })
    .positive({ message: 'Selecione a conta de origem.' }),
  id_conta_financeira_destino: z.coerce
    .number()
    .int({ message: 'Selecione a conta de destino.' })
    .positive({ message: 'Selecione a conta de destino.' }),
  valor: z.coerce.number().positive('Informe um valor maior que zero.'),
  historico: z.string().min(3, 'Informe o histórico da transferência.'),
})

// Usado por "Fornecedores" (pages/Fornecedores.tsx, v2.5.8) - o backend normaliza o CNPJ pra
// só-dígitos e exige exatamente 14; aqui só barra o óbvio (campo vazio) antes do round-trip.
export const fornecedorCriarSchema = z.object({
  razao_social: z.string().min(1, 'Informe a razão social.'),
  cnpj: z.string().min(14, 'CNPJ deve ter 14 dígitos.'),
  categoria_servico: z.string().min(1, 'Informe a categoria de serviço.'),
  telefone: z.string().min(1, 'Informe o telefone.'),
})

// Usado por "Exercícios" (pages/Exercicios.tsx, v2.5.8) - o backend também recusa ano fora de
// 2000-2200 e exercício duplicado/já aberto (mensagem real vem do erro da mutation).
export const exercicioAbrirSchema = z.object({
  ano: z.coerce.number().min(2000, 'Ano inválido.').max(2200, 'Ano inválido.'),
})

// Usado por "Títulos" (pages/Titulos.tsx, v2.5.9) - `beneficiario_tipo` é só do formulário
// (nunca vai pro backend); a página decide, na hora de montar o body, se manda `id_associado`
// ou `id_fornecedor` (nunca os dois) com base nele. O backend valida a compatibilidade entre
// `tipo_titulo` e o `tipo` da conta contábil escolhida - a mensagem real de erro é mostrada.
export const tituloCriarSchema = z.object({
  tipo_titulo: z.enum(['A Pagar', 'A Receber'], {
    message: 'Selecione o tipo do título.',
  }),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil.' })
    .positive({ message: 'Selecione a conta contábil.' }),
  beneficiario_tipo: z.enum(['nenhum', 'associado', 'fornecedor']),
  id_associado: z.coerce.number().optional(),
  id_fornecedor: z.coerce.number().optional(),
  descricao: z.string().min(1, 'Informe a descrição.'),
  valor_original: z.coerce
    .number()
    .positive('Informe um valor maior que zero.'),
  data_vencimento: z.string().min(1, 'Informe a data de vencimento.'),
})

// Usado por "Baixar título" (pages/Titulos.tsx, v2.5.9) - o backend exige a conta de
// contrapartida do tipo "Ativo" (Caixa/Banco); a mensagem real de erro é mostrada se não for.
export const baixarTituloSchema = z.object({
  valor_pago: z.coerce.number().positive('Informe um valor maior que zero.'),
  forma_pagamento: z.string().min(1, 'Informe a forma de pagamento.'),
  id_conta_contabil_contrapartida: z.coerce
    .number()
    .int({ message: 'Selecione a conta de contrapartida.' })
    .positive({ message: 'Selecione a conta de contrapartida.' }),
  // v3.1 - opcionais: centro de custo, data de competência (quando ausente, o backend usa a
  // data de caixa) e comprovante (caminho já enviado por `enviarComprovante`, obrigatório
  // quando a conta do título exige - a mensagem real de erro do backend é mostrada).
  id_centro_custo: z.coerce.number().optional(),
  data_competencia: z.string().optional(),
  comprovante: z.string().optional(),
  // v3.2 - "pagamento a maior": só exigido quando o valor pago excede o saldo devedor (checado
  // no backend, não aqui - a mensagem real de erro é mostrada quando falta).
  id_conta_contabil_adiantamento: z.coerce.number().optional(),
})

// Usado por "Planos de Contribuição" (pages/PlanosContribuicao.tsx, v3.2) - mensalidade por
// categoria de associado. `valor_inicial` só é usado na criação; reajuste depois é
// `reajustePlanoContribuicaoSchema`.
export const planoContribuicaoCriarSchema = z.object({
  categoria: z.string().min(1, 'Informe a categoria.'),
  descricao: z.string().min(1, 'Informe a descrição.'),
  periodicidade: z.string().min(1, 'Selecione a periodicidade.'),
  dia_vencimento: z.coerce
    .number()
    .int()
    .min(1, 'Dia inválido.')
    .max(31, 'Dia inválido.'),
  cobranca_por_nucleo_familiar: z.boolean(),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil (Receita).' })
    .positive({ message: 'Selecione a conta contábil (Receita).' }),
  valor_inicial: z.coerce.number().positive('Informe um valor maior que zero.'),
})

// Usado por "Reajustar" (pages/PlanosContribuicao.tsx, v3.2) - o backend recusa vigência igual
// ou anterior à vigência atual (nunca reabre um período já fechado).
export const reajustePlanoContribuicaoSchema = z.object({
  valor: z.coerce.number().positive('Informe um valor maior que zero.'),
  data_vigencia_inicio: z
    .string()
    .min(1, 'Informe a data de início da vigência.'),
  motivo: z.string().min(3, 'Informe o motivo do reajuste.'),
})

// Usado por "Isenções" (pages/PlanosContribuicao.tsx, v3.2) - `id_plano` vazio = isenção vale
// para qualquer plano do associado.
export const isencaoContribuicaoCriarSchema = z.object({
  id_associado: z.coerce
    .number()
    .int({ message: 'Selecione o associado.' })
    .positive({ message: 'Selecione o associado.' }),
  id_plano: z.coerce.number().optional(),
  motivo: z.string().min(1, 'Selecione o motivo.'),
  percentual_desconto: z.coerce
    .number()
    .positive('Informe um percentual maior que zero.')
    .max(100, 'No máximo 100%.'),
  data_fim: z.string().optional(),
})

// Usado por "Gerar Cobranças" (pages/GerarCobrancas.tsx, v3.2) - sempre roda como prévia
// primeiro (confirmar=false); "Confirmar" é uma ação separada, nunca o mesmo clique.
export const gerarCobrancasSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Use o formato AAAA-MM.'),
})

// Usado por "Campanha de Desconto por Pagamento Antecipado" (pages/PlanosContribuicao.tsx,
// v3.2.3) - `meses_gatilho` fica como texto ("1,7") no formulário, convertido pra número[] só na
// hora de chamar a API (ver `criarCampanhaDescontoAntecipado`), igual o resto deste projeto faz
// coerção fora do schema quando o formato de tela é mais simples que o da API.
export const campanhaDescontoAntecipadoCriarSchema = z.object({
  percentual_desconto: z.coerce
    .number()
    .positive('Informe um percentual maior que zero.')
    .max(100, 'No máximo 100%.'),
  quantidade_meses: z.coerce
    .number()
    .int()
    .min(2, 'Mínimo 2 meses.')
    .max(12, 'Máximo 12 meses.'),
  meses_gatilho: z.string().min(1, 'Informe os meses-gatilho (ex.: 1,7).'),
  id_conta_contabil_receita_diferida: z.coerce
    .number()
    .int({ message: 'Selecione a conta de receita diferida (Passivo).' })
    .positive({ message: 'Selecione a conta de receita diferida (Passivo).' }),
  motivo: z.string().optional(),
})

// Usado por "Gerar cobrança em bloco" (pages/GerarCobrancas.tsx, v3.2.3) - só oferecido quando
// há campanha vigente e ativa cujo mês-gatilho bate com a competência escolhida.
export const gerarCobrancaBlocoSchema = z.object({
  id_associado: z.coerce
    .number()
    .int({ message: 'Selecione o associado.' })
    .positive({ message: 'Selecione o associado.' }),
  id_plano_contribuicao: z.coerce
    .number()
    .int({ message: 'Selecione o plano.' })
    .positive({ message: 'Selecione o plano.' }),
  competencia_inicio: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use o formato AAAA-MM.'),
})

// Usado por "Negociação de Dívida" (pages/NegociacaoDivida.tsx, v3.2.2) - a seleção de títulos
// vencidos é feita por checkbox em estado local do componente (lista de ids), fora deste schema.
export const negociacaoDividaCriarSchema = z.object({
  quantidade_parcelas: z.coerce
    .number()
    .int()
    .min(1, 'Mínimo 1 parcela.')
    .max(60, 'Máximo 60 parcelas.'),
  termo: z
    .string()
    .min(10, 'Descreva os termos da negociação (mínimo 10 caracteres).'),
})

// Usado por "Razão Contábil" (pages/RazaoContabil.tsx, v2.5.10) - o backend também recusa
// motivo com menos de 5 caracteres e lançamento já estornado (mensagem real é mostrada).
export const estornoCriarSchema = z.object({
  motivo: z.string().min(5, 'Informe o motivo (mínimo 5 caracteres).'),
})

// v0.2.9 — presente só durante o modo "ver como" (impersonação de papel).
export const impersonandoSchema = z.object({
  id_nivel: z.number(),
  nome_nivel: z.string(),
  nivel_real: z.string(),
})

// Resposta de GET /auth/me — usado pelo shell inteiro para montar menu e checar permissão
// (App.tsx, Shell.tsx). Um campo faltando aqui derruba o roteamento inteiro, por isso é
// validado antes de qualquer componente confiar no formato.
export const meResponseSchema = z.object({
  id_usuario: z.number(),
  id_associado: z.number().nullish(),
  nome_completo: z.string().nullish(),
  email: z.string().nullish(),
  nivel: z.string().nullish(),
  mfa_ativado: z.boolean(),
  mfa_obrigatorio: z.boolean(),
  mfa_pendente: z.boolean(),
  permissoes: z.array(z.string()),
  impersonando: impersonandoSchema.nullish(),
})

// v3.3 - dados bancários de fornecedor (segundo aprovador obrigatório, nunca quem solicitou).
export const dadosBancariosFornecedorCriarSchema = z.object({
  banco: z.string().min(1, 'Informe o banco.'),
  agencia: z.string().min(1, 'Informe a agência.'),
  conta: z.string().min(1, 'Informe a conta.'),
  tipo_conta: z.string().min(1, 'Informe o tipo de conta.'),
  titular: z.string().min(1, 'Informe o titular.'),
})

// v3.3 - alçada de aprovação: cargos_autorizados fica como texto ("TESOUREIRO,PRESIDENTE") no
// formulário, convertido pra string[] só na hora de chamar a API.
export const alcadaAprovacaoCriarSchema = z.object({
  valor_minimo: z.coerce.number().min(0, 'Valor mínimo não pode ser negativo.'),
  valor_maximo: z.string().optional(),
  cargos_autorizados: z
    .string()
    .min(1, 'Informe ao menos um cargo (códigos separados por vírgula).'),
  exige_dupla_assinatura: z.boolean(),
})

export const delegacaoAprovacaoCriarSchema = z.object({
  id_associado_delegante: z.coerce
    .number()
    .int({ message: 'Selecione quem delega.' })
    .positive({ message: 'Selecione quem delega.' }),
  id_associado_delegado: z.coerce
    .number()
    .int({ message: 'Selecione o delegado.' })
    .positive({ message: 'Selecione o delegado.' }),
  data_fim: z.string().min(1, 'Informe até quando vale a delegação.'),
  motivo: z.string().min(5, 'Informe o motivo da delegação.'),
})

// v3.3 - solicitação de compra: fluxo solicitação → cotação → aprovação → pagamento.
export const solicitacaoCompraCriarSchema = z.object({
  descricao: z.string().min(3, 'Informe a descrição da compra.'),
  justificativa: z.string().optional(),
  id_fornecedor: z.coerce.number().optional(),
  valor_estimado: z.coerce
    .number()
    .positive('Valor estimado deve ser maior que zero.'),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil (Despesa).' })
    .positive({ message: 'Selecione a conta contábil (Despesa).' }),
})

export const cotacaoCompraCriarSchema = z.object({
  id_fornecedor: z.coerce
    .number()
    .int({ message: 'Selecione o fornecedor.' })
    .positive({ message: 'Selecione o fornecedor.' }),
  valor: z.coerce.number().positive('Valor deve ser maior que zero.'),
  anexo: z.string().optional(),
})

export const reprovarSolicitacaoSchema = z.object({
  motivo: z.string().min(3, 'Informe o motivo.'),
})

// v3.3 - reembolso de despesa de voluntário/dirigente (comprovante obrigatório).
export const reembolsoDespesaCriarSchema = z.object({
  id_associado: z.coerce
    .number()
    .int({ message: 'Selecione o associado.' })
    .positive({ message: 'Selecione o associado.' }),
  descricao: z.string().min(3, 'Informe a descrição da despesa.'),
  valor: z.coerce.number().positive('Valor deve ser maior que zero.'),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil (Despesa).' })
    .positive({ message: 'Selecione a conta contábil (Despesa).' }),
  comprovante: z.string().min(1, 'Anexe o comprovante da despesa.'),
})

// v3.3 - contas a pagar recorrentes (aluguel, energia, contador).
export const contaAPagarRecorrenteCriarSchema = z.object({
  descricao: z.string().min(3, 'Informe a descrição.'),
  valor: z.coerce.number().positive('Valor deve ser maior que zero.'),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil (Despesa).' })
    .positive({ message: 'Selecione a conta contábil (Despesa).' }),
  id_fornecedor: z.coerce.number().optional(),
  dia_vencimento: z.coerce
    .number()
    .int()
    .min(1, 'Dia inválido.')
    .max(31, 'Dia inválido.'),
})

export const gerarContasAPagarSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Use o formato AAAA-MM.'),
})

// v3.4 - campanha de arrecadação (meta, prazo, progresso) - publicação no site institucional
// fica pra FASE 5, ainda não existe.
export const campanhaArrecadacaoCriarSchema = z.object({
  titulo: z.string().min(3, 'Informe o título da campanha.'),
  descricao: z.string().optional(),
  meta_valor: z.coerce.number().positive('Meta deve ser maior que zero.'),
  prazo: z.string().optional(),
  id_centro_custo: z.coerce.number().optional(),
})

// v3.4 - doação: `anonima` esconde nome/documento; destinação específica (id_centro_custo_destinacao)
// só pode ser gasta ali (ver Centros de Custo › destinação restrita).
export const doacaoCriarSchema = z.object({
  anonima: z.boolean(),
  nome_doador: z.string().optional(),
  documento_doador: z.string().optional(),
  tipo_doacao: z.enum(['Monetaria', 'Bens'], {
    message: 'Selecione o tipo de doação.',
  }),
  recorrente: z.boolean(),
  valor: z.coerce.number().positive('Valor deve ser maior que zero.'),
  descricao_bem: z.string().optional(),
  id_campanha: z.coerce.number().optional(),
  id_centro_custo_destinacao: z.coerce.number().optional(),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil (Receita).' })
    .positive({ message: 'Selecione a conta contábil (Receita).' }),
  id_conta_contabil_caixa: z.coerce.number().optional(),
})

// v3.4 - remanejamento formal e auditado de saldo restrito entre destinações.
export const remanejamentoDestinacaoCriarSchema = z.object({
  id_centro_custo_origem: z.coerce
    .number()
    .int({ message: 'Selecione o centro de custo de origem.' })
    .positive({ message: 'Selecione o centro de custo de origem.' }),
  id_centro_custo_destino: z.coerce
    .number()
    .int({ message: 'Selecione o centro de custo de destino.' })
    .positive({ message: 'Selecione o centro de custo de destino.' }),
  valor: z.coerce.number().positive('Valor deve ser maior que zero.'),
  motivo: z.string().min(5, 'Informe o motivo do remanejamento.'),
})

// v3.5 - orçamento anual: sempre vinculado a uma deliberação de assembleia já concluída (nunca
// orçamento "de gaveta").
export const orcamentoCriarSchema = z.object({
  ano: z.coerce
    .number()
    .int()
    .min(2000, 'Ano inválido.')
    .max(2200, 'Ano inválido.'),
  id_conta_contabil: z.coerce
    .number()
    .int({ message: 'Selecione a conta contábil.' })
    .positive({ message: 'Selecione a conta contábil.' }),
  id_centro_custo: z.coerce.number().optional(),
  valor_previsto: z.coerce
    .number()
    .positive('Valor previsto deve ser maior que zero.'),
  id_deliberacao: z.coerce
    .number()
    .int({ message: 'Selecione a deliberação que aprovou este orçamento.' })
    .positive({
      message: 'Selecione a deliberação que aprovou este orçamento.',
    }),
})

// v3.5 - reserva de contingência: uma Conta Financeira já existente, marcada como reserva, com a
// regra de uso registrada por escrito.
export const reservaContingenciaCriarSchema = z.object({
  id_conta_financeira: z.coerce
    .number()
    .int({ message: 'Selecione a conta financeira.' })
    .positive({ message: 'Selecione a conta financeira.' }),
  regra_uso: z
    .string()
    .min(10, 'Descreva a regra de uso da reserva (mínimo 10 caracteres).'),
  valor_minimo: z.coerce.number().optional(),
  id_deliberacao: z.coerce.number().optional(),
})

// v3.7 - fechamento mensal: divergência aberta entre saldo do sistema e saldo do extrato
// bancário bloqueia o fechamento (checado pelo backend, nunca só aqui).
export const fecharMesSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Use o formato AAAA-MM.'),
  id_conta_financeira: z.coerce
    .number()
    .int({ message: 'Selecione a conta financeira.' })
    .positive({ message: 'Selecione a conta financeira.' }),
  saldo_extrato_bancario: z.coerce.number(),
})

// v4.1 - Projeto como entidade única e configurável.
export const projetoCriarSchema = z.object({
  nome_projeto: z.string().min(3, 'Informe o nome do projeto.'),
  tipo_foco: z.string().min(1, 'Informe o foco do projeto.'),
  necessita_alvara_bombeiros: z.boolean(),
  data_inicio: z.string().min(1, 'Informe a data de início.'),
  data_fim_prevista: z.string().min(1, 'Informe a data de fim prevista.'),
  descricao: z.string().optional(),
  tipo_projeto: z.string().optional(),
  id_associado_responsavel: z.coerce.number().optional(),
  publico_alvo: z.string().optional(),
  id_centro_custo: z.coerce.number().optional(),
  visibilidade: z.enum(['Pública', 'Interna']),
})

export const itemCronogramaCriarSchema = z.object({
  tipo: z.enum(['Marco', 'Tarefa']),
  titulo: z.string().min(3, 'Informe o título.'),
  prazo: z.string().min(1, 'Informe o prazo.'),
  id_associado_responsavel: z.coerce.number().optional(),
})

export const equipeProjetoCriarSchema = z.object({
  id_associado: z.coerce
    .number()
    .int({ message: 'Selecione o associado.' })
    .positive({ message: 'Selecione o associado.' }),
  papel: z.string().min(1, 'Selecione o papel.'),
})
