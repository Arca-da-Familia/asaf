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
