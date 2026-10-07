import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  editarCampoDaInstituicao,
  listarCamposDaInstituicao,
  type CampoDaInstituicao,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'

const CAMPOS_LONGOS = new Set([
  'ENDERECO',
  'DESCRICAO_INSTITUCIONAL',
  'DADOS_BANCARIOS',
  'TEXTO_PADRAO_DOCUMENTO',
])

function CampoDaInstituicaoLinha({ campo }: { campo: CampoDaInstituicao }) {
  const queryClient = useQueryClient()
  const [valor, setValor] = useState(campo.valor)
  const [aviso, setAviso] = useState<string | null>(null)

  const salvar = useMutation({
    mutationFn: (corpo: { valor?: string; publico?: boolean }) =>
      editarCampoDaInstituicao(campo.chave, corpo),
    onSuccess: (_resposta, corpo) => {
      setAviso(
        corpo.valor !== undefined
          ? 'Salvo.'
          : corpo.publico
            ? 'Agora aparece no site.'
            : 'Agora é só interno.',
      )
      queryClient.invalidateQueries({ queryKey: ['instituicao'] })
    },
    onError: () => setAviso(null),
  })

  const id = `campo-${campo.chave}`
  const longo = CAMPOS_LONGOS.has(campo.chave)
  const mudou = valor !== campo.valor
  const classe =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {campo.rotulo}
        </label>
        {campo.pode_ser_publico ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={campo.publico}
              disabled={salvar.isPending}
              onChange={(e) => salvar.mutate({ publico: e.target.checked })}
            />
            Aparece no site
          </label>
        ) : (
          <span className="text-xs text-muted-foreground">Só interno</span>
        )}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{campo.ajuda}</p>
      <div className="flex flex-wrap items-start gap-2">
        {longo ? (
          <textarea
            id={id}
            rows={3}
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setAviso(null)
            }}
            className={`${classe} flex-1`}
          />
        ) : (
          <input
            id={id}
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setAviso(null)
            }}
            className={`${classe} h-9 flex-1`}
          />
        )}
        <Button
          size="sm"
          disabled={!mudou || salvar.isPending}
          onClick={() => salvar.mutate({ valor })}
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
      {salvar.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {(salvar.error as Error).message}
        </p>
      )}
      {aviso && !salvar.isError && (
        <p role="status" className="mt-1 text-xs text-green-600">
          {aviso}
        </p>
      )}
      {campo.atualizado_em && (
        <p className="mt-1 text-xs text-muted-foreground">
          Última alteração em{' '}
          {formatarData(campo.atualizado_em, { comHora: true })}
        </p>
      )}
    </div>
  )
}

// Instituição: os dados da própria associação num lugar só (nome, CNPJ, endereço, contatos, redes, Pix...). Cada campo diz se aparece no site ou se
// fica só interno; a marca se liga e desliga aqui mesmo. O que é interno de verdade (e-mail remetente do sistema, rodapé de documento) não tem a opção.
export function InstituicaoPage() {
  const { data: campos, isLoading } = useQuery({
    queryKey: ['instituicao'],
    queryFn: listarCamposDaInstituicao,
  })

  const grupos = [...new Set((campos ?? []).map((c) => c.grupo))]

  return (
    <>
      <PageHeader
        titulo="Instituição"
        descricao="Os dados da associação. Marque o que aparece no site; o resto fica só interno."
        trilha={[{ rotulo: 'Início', href: '/' }, { rotulo: 'Instituição' }]}
      />
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      <div className="v3-space-y-6">
        {grupos.map((grupo) => (
          <section
            key={grupo}
            aria-label={grupo}
            className="rounded-xl border border-border bg-card p-6"
          >
            <h2 className="mb-3 font-semibold">{grupo}</h2>
            <div className="v3-space-y-3">
              {(campos ?? [])
                .filter((c) => c.grupo === grupo)
                .map((c) => (
                  <CampoDaInstituicaoLinha key={c.chave} campo={c} />
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
