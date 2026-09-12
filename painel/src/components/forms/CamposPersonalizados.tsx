import { useQuery } from '@tanstack/react-query'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

import {
  listarOpcoesCatalogo,
  type DefinicaoCampoPersonalizado,
} from '@/lib/api'
import { nomeCampoForm } from '@/lib/campos-personalizados'

type CamposPersonalizadosFieldsProps<T extends FieldValues> = {
  definicoes: DefinicaoCampoPersonalizado[]
  form: UseFormReturn<T>
}

// v0.3.3 — um módulo (Associados, Projetos/Eventos...) renderiza os campos personalizados que a
// diretoria cadastrou só adicionando `<CamposPersonalizadosFields definicoes={...} form={form} />`
// dentro do FormShell — nenhum código novo por campo. Ver lib/campos-personalizados.ts para o
// schema Zod correspondente (`construirSchemaCamposPersonalizados`, combinado ao schema fixo do
// módulo via `.merge()`).
export function CamposPersonalizadosFields<T extends FieldValues>({
  definicoes,
  form,
}: CamposPersonalizadosFieldsProps<T>) {
  if (definicoes.length === 0) return null

  return (
    <div className="space-y-4 border-t border-border pt-4">
      {definicoes.map((definicao) => (
        <CampoPersonalizado
          key={definicao.id_definicao}
          definicao={definicao}
          form={form}
        />
      ))}
    </div>
  )
}

function CampoPersonalizado<T extends FieldValues>({
  definicao,
  form,
}: {
  definicao: DefinicaoCampoPersonalizado
  form: UseFormReturn<T>
}) {
  const nome = nomeCampoForm(definicao.id_definicao)
  // `as never`: o nome do campo (`campo_<id>`) só existe em tempo de execução — é montado a
  // partir da definição vinda da API, não dá pra tipar estaticamente contra T sem acoplar todo
  // formulário do sistema a um union gigante de ids de campo personalizado.
  const registro = form.register(nome as never)
  const erro = (
    form.formState.errors as Record<string, { message?: string } | undefined>
  )[nome]

  return (
    <div>
      <label htmlFor={nome} className="text-sm font-medium">
        {definicao.rotulo}
        {definicao.obrigatorio && <span className="text-destructive"> *</span>}
      </label>
      <div className="mt-1">
        <EntradaPorTipo id={nome} definicao={definicao} registro={registro} />
      </div>
      {erro?.message && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {erro.message}
        </p>
      )}
    </div>
  )
}

function EntradaPorTipo({
  definicao,
  registro,
  id,
}: {
  definicao: DefinicaoCampoPersonalizado
  registro: ReturnType<UseFormReturn<FieldValues>['register']>
  id: string
}) {
  const classeBase =
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

  switch (definicao.tipo) {
    case 'numero':
      return (
        <input
          id={id}
          {...registro}
          inputMode="decimal"
          className={classeBase}
        />
      )
    case 'data':
      return <input id={id} {...registro} type="date" className={classeBase} />
    case 'booleano':
      return (
        <select id={id} {...registro} className={classeBase}>
          <option value="">—</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      )
    case 'selecao':
      return (
        <SelecaoDeCatalogo id={id} definicao={definicao} registro={registro} />
      )
    case 'arquivo':
      // v0.3.3 é só a metadado/valor (referência) do campo - o upload de verdade reaproveita o
      // FileUpload da v0.2.4 quando um módulo real precisar disso; aqui aceita a referência já
      // enviada (ex.: um caminho retornado por outro upload).
      return (
        <input
          id={id}
          {...registro}
          className={classeBase}
          placeholder="Referência do arquivo"
        />
      )
    default:
      return <input id={id} {...registro} className={classeBase} />
  }
}

function SelecaoDeCatalogo({
  definicao,
  registro,
  id,
}: {
  definicao: DefinicaoCampoPersonalizado
  registro: ReturnType<UseFormReturn<FieldValues>['register']>
  id: string
}) {
  const { data: opcoes, isLoading } = useQuery({
    queryKey: ['catalogo-opcoes', definicao.catalogo_chave],
    queryFn: () => listarOpcoesCatalogo(definicao.catalogo_chave!),
    enabled: !!definicao.catalogo_chave,
  })

  return (
    <select
      id={id}
      {...registro}
      disabled={isLoading}
      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed"
    >
      <option value="">{isLoading ? 'Carregando…' : 'Selecione…'}</option>
      {(opcoes ?? []).map((o) => (
        <option key={o.id_opcao} value={o.codigo}>
          {o.rotulo}
        </option>
      ))}
    </select>
  )
}
