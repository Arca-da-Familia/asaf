import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  listarDefinicoesCampo,
  type DefinicaoCampoPersonalizado,
  type EntidadeCampoPersonalizado,
} from './api'

// v0.3.3 — campos personalizados sem deploy: a diretoria acrescenta um campo extra num módulo
// (associado/projeto-evento/beneficiário) sem precisar de programador, e ele é renderizado
// automaticamente pelo FormShell da v0.2.4. O nome do campo no formulário é sempre
// `campo_<id_definicao>` — estável mesmo que o rótulo mude depois.
export function nomeCampoForm(idDefinicao: number): `campo_${number}` {
  return `campo_${idDefinicao}`
}

export function useDefinicoesCampo(entidade: EntidadeCampoPersonalizado) {
  return useQuery({
    queryKey: ['campos-personalizados', entidade],
    queryFn: () => listarDefinicoesCampo(entidade),
  })
}

// Cada campo é validado como string (é como o backend guarda e valida) — o tipo real
// (número/data/booleano) já foi checado no backend na escrita; aqui só garante formato e
// obrigatoriedade no cliente, pra dar feedback antes de gastar uma chamada de rede.
function schemaPorTipo(definicao: DefinicaoCampoPersonalizado): z.ZodTypeAny {
  let schema: z.ZodTypeAny
  switch (definicao.tipo) {
    case 'numero':
      schema = z.string().refine((v) => v === '' || !Number.isNaN(Number(v)), {
        message: `${definicao.rotulo} precisa ser um número.`,
      })
      break
    case 'data':
      schema = z
        .string()
        .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), {
          message: `${definicao.rotulo} precisa ser uma data válida.`,
        })
      break
    case 'booleano':
      schema = z.string()
      break
    default:
      schema = z.string()
  }
  if (definicao.obrigatorio) {
    schema = schema.refine((v) => v !== '' && v !== undefined, {
      message: `${definicao.rotulo} é obrigatório.`,
    })
  }
  return schema.optional().default('')
}

// Combine com o schema fixo do módulo via `.merge()` (ex.: `schemaAssociado.merge(schemaCampos)`).
export function construirSchemaCamposPersonalizados(
  definicoes: DefinicaoCampoPersonalizado[],
) {
  const forma: Record<string, z.ZodTypeAny> = {}
  for (const d of definicoes) {
    forma[nomeCampoForm(d.id_definicao)] = schemaPorTipo(d)
  }
  return z.object(forma)
}

// Valores vêm da API como { [id_definicao]: valor | null } — vira { campo_<id>: valor } pra
// usar direto em `defaultValues` do FormShell.
export function valoresParaDefaultValues(
  definicoes: DefinicaoCampoPersonalizado[],
  valores: Record<number, string | null>,
): Record<string, string> {
  const resultado: Record<string, string> = {}
  for (const d of definicoes) {
    resultado[nomeCampoForm(d.id_definicao)] = valores[d.id_definicao] ?? ''
  }
  return resultado
}

// Caminho inverso, pra montar o corpo de PUT .../valores a partir dos valores do formulário.
export function formValuesParaValoresCampo(
  definicoes: DefinicaoCampoPersonalizado[],
  valoresFormulario: Record<string, unknown>,
): { id_definicao: number; valor: string | null }[] {
  return definicoes.map((d) => {
    const valor = valoresFormulario[nomeCampoForm(d.id_definicao)]
    return { id_definicao: d.id_definicao, valor: valor ? String(valor) : null }
  })
}
