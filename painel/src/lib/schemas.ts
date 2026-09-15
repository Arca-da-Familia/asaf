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

export const justificativaDecidirSchema = z.object({
  motivo_decisao: z.string().optional(),
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
