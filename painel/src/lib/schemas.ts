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
  senha_provisoria: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres.'),
})

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
