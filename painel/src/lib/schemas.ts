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
