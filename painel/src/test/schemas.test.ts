import { describe, expect, it } from 'vitest'

import type { DefinicaoCampoPersonalizado } from '@/lib/api'
import {
  construirSchemaCamposPersonalizados,
  nomeCampoForm,
} from '@/lib/campos-personalizados'
import {
  assembleiaCriarSchema,
  elegibilidadeConfigSchema,
  medicaoIndicadorCriarSchema,
  reservaEspacoCriarSchema,
  reservaRecorrenteCriarSchema,
} from '@/lib/schemas'

// Travam o comportamento dos schemas Zod de que o painel depende — mensagens que aparecem para
// o usuário, coerção de número e a regra dos campos personalizados — para que uma troca de
// versão do Zod (3 -> 4 mudou `.default()`, mensagens de erro e o tipo de entrada do coerce)
// não altere em silêncio o que o usuário vê.

function mensagens(resultado: {
  success: boolean
  error?: { issues: { message: string }[] }
}) {
  return resultado.success ? [] : resultado.error!.issues.map((i) => i.message)
}

const definicao = (
  sobrescrita: Partial<DefinicaoCampoPersonalizado>,
): DefinicaoCampoPersonalizado => ({
  id_definicao: 7,
  entidade: 'associado',
  rotulo: 'Tamanho da camiseta',
  tipo: 'texto',
  id_catalogo: null,
  catalogo_chave: null,
  obrigatorio: false,
  ordem: 1,
  ...sobrescrita,
})

describe('campos personalizados (schema montado em tempo de execução)', () => {
  const campo = nomeCampoForm(7)

  it('campo opcional ausente vira string vazia (default) e passa', () => {
    const schema = construirSchemaCamposPersonalizados([definicao({})])
    const r = schema.safeParse({})
    expect(r.success).toBe(true)
    expect(r.data).toEqual({ [campo]: '' })
  })

  it('campo obrigatório vazio é reprovado com a mensagem do rótulo', () => {
    const schema = construirSchemaCamposPersonalizados([
      definicao({ obrigatorio: true }),
    ])
    expect(mensagens(schema.safeParse({ [campo]: '' }))).toEqual([
      'Tamanho da camiseta é obrigatório.',
    ])
  })

  it('campo obrigatório AUSENTE (undefined) também é reprovado - o default não pula a validação', () => {
    const schema = construirSchemaCamposPersonalizados([
      definicao({ obrigatorio: true }),
    ])
    expect(mensagens(schema.safeParse({}))).toEqual([
      'Tamanho da camiseta é obrigatório.',
    ])
  })

  it('campo obrigatório preenchido passa', () => {
    const schema = construirSchemaCamposPersonalizados([
      definicao({ obrigatorio: true }),
    ])
    expect(schema.safeParse({ [campo]: 'M' }).success).toBe(true)
  })

  it('tipo número: aceita número e vazio, recusa texto', () => {
    const schema = construirSchemaCamposPersonalizados([
      definicao({ tipo: 'numero', rotulo: 'Idade' }),
    ])
    expect(schema.safeParse({ [campo]: '12' }).success).toBe(true)
    expect(schema.safeParse({ [campo]: '' }).success).toBe(true)
    expect(mensagens(schema.safeParse({ [campo]: 'abc' }))).toEqual([
      'Idade precisa ser um número.',
    ])
  })

  it('tipo data: só aceita AAAA-MM-DD', () => {
    const schema = construirSchemaCamposPersonalizados([
      definicao({ tipo: 'data', rotulo: 'Nascimento' }),
    ])
    expect(schema.safeParse({ [campo]: '2026-01-05' }).success).toBe(true)
    expect(mensagens(schema.safeParse({ [campo]: '05/01/2026' }))).toEqual([
      'Nascimento precisa ser uma data válida.',
    ])
  })
})

describe('schemas de formulário', () => {
  it('medição de indicador: valor não numérico recebe a mensagem em português', () => {
    const base = { periodo: '2026-01' }
    expect(
      mensagens(
        medicaoIndicadorCriarSchema.safeParse({ ...base, valor: 'abc' }),
      ),
    ).toEqual(['Informe um valor.'])
    expect(
      mensagens(
        medicaoIndicadorCriarSchema.safeParse({ ...base, valor: undefined }),
      ),
    ).toEqual(['Informe um valor.'])
    const ok = medicaoIndicadorCriarSchema.safeParse({ ...base, valor: '12.5' })
    expect(ok.success).toBe(true)
    expect(ok.data?.valor).toBe(12.5)
  })

  it('medição de indicador: período vazio é reprovado', () => {
    expect(
      mensagens(
        medicaoIndicadorCriarSchema.safeParse({ valor: 1, periodo: '' }),
      ),
    ).toEqual(['Informe o período desta medição.'])
  })

  it('elegibilidade: campos em branco (undefined) passam; percentual fora de 0-100 não', () => {
    expect(elegibilidadeConfigSchema.safeParse({}).success).toBe(true)
    expect(
      mensagens(
        elegibilidadeConfigSchema.safeParse({ percentual_minimo: 150 }),
      ),
    ).toEqual(['Informe um percentual entre 0 e 100.'])
    const r = elegibilidadeConfigSchema.safeParse({ percentual_minimo: '80' })
    expect(r.data?.percentual_minimo).toBe(80)
    expect(
      mensagens(
        elegibilidadeConfigSchema.safeParse({ carga_horaria_horas: 0 }),
      ),
    ).toEqual(['Informe uma carga horária maior que zero.'])
  })

  it('assembleia: campos obrigatórios e conversão da data local para UTC (ISO com Z)', () => {
    const vazio = assembleiaCriarSchema.safeParse({
      tipo: '',
      pauta: 'ab',
      data_hora_convocacao: '',
    })
    expect(mensagens(vazio).sort()).toEqual(
      [
        'Selecione o tipo.',
        'Informe a ordem do dia.',
        'Informe a data e hora da convocação.',
      ].sort(),
    )

    const ok = assembleiaCriarSchema.safeParse({
      tipo: 'Ordinária',
      pauta: 'Prestação de contas',
      data_hora_convocacao: '2026-10-08T19:00',
    })
    expect(ok.success).toBe(true)
    expect(ok.data?.data_hora_convocacao).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    )
  })

  it('reserva de espaço: solicitante 0 (nenhum selecionado) é reprovado', () => {
    const r = reservaEspacoCriarSchema.safeParse({
      id_associado_solicitante: '0',
      data_hora_inicio: '2026-10-08T19:00',
      data_hora_fim: '2026-10-08T21:00',
      finalidade: 'Reunião da diretoria',
    })
    expect(mensagens(r)).toEqual(['Selecione o solicitante.'])
  })

  it('reserva recorrente (schema estendido): exige 2+ semanas e mantém os campos da reserva simples', () => {
    const base = {
      id_associado_solicitante: '3',
      data_hora_inicio: '2026-10-08T19:00',
      data_hora_fim: '2026-10-08T21:00',
      finalidade: 'Reunião da diretoria',
    }
    expect(
      mensagens(
        reservaRecorrenteCriarSchema.safeParse({
          ...base,
          quantidade_semanas: '1',
        }),
      ),
    ).toEqual(['Informe pelo menos 2 semanas.'])
    const ok = reservaRecorrenteCriarSchema.safeParse({
      ...base,
      quantidade_semanas: '4',
    })
    expect(ok.success).toBe(true)
    expect(ok.data?.quantidade_semanas).toBe(4)
    expect(ok.data?.id_associado_solicitante).toBe(3)
  })
})
