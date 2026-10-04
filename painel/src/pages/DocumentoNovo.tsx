import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import {
  EXPLICACAO_DA_CLASSIFICACAO,
  criarDocumento,
  listarTiposDeDocumento,
  type Classificacao,
  type DadosDoDocumento,
} from '@/lib/documentos'

const classeCampo =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

// v5.4a - Novo documento. Três perguntas que decidem tudo: que documento é, QUEM PODE LER (classificação) e se vai
// ao site. O arquivo original é opcional aqui (pode ser enviado depois, na tela do documento).
export function DocumentoNovoPage() {
  const navegar = useNavigate()
  const queryClient = useQueryClient()
  const { data: tipos } = useQuery({
    queryKey: ['documentos-tipos'],
    queryFn: listarTiposDeDocumento,
  })

  const [dados, setDados] = useState<DadosDoDocumento>({
    tipo: 'ATA',
    titulo: '',
    classificacao: 'Restrita',
    publicar_no_site: true,
  })
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const criar = useMutation({
    mutationFn: () => criarDocumento(dados, arquivo),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['documentos'] })
      navegar(`/documentos/${doc.id_documento}`)
    },
    onError: (e) =>
      setErro(e instanceof ApiError ? e.detail : 'Não foi possível cadastrar.'),
  })

  function enviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)
    if (dados.titulo.trim().length < 3) {
      setErro('Dê um título ao documento (pelo menos 3 letras).')
      return
    }
    criar.mutate()
  }

  function campo<K extends keyof DadosDoDocumento>(
    chave: K,
    valor: DadosDoDocumento[K],
  ) {
    setDados((d) => ({ ...d, [chave]: valor }))
  }

  return (
    <>
      <PageHeader
        titulo="Novo documento"
        trilha={[
          { rotulo: 'Documentos', href: '/documentos' },
          { rotulo: 'Novo' },
        ]}
      />
      <form onSubmit={enviar} className="max-w-2xl space-y-5" noValidate>
        {erro && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {erro}
          </p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Tipo de documento</span>
          <select
            className={classeCampo}
            value={dados.tipo}
            onChange={(e) => campo('tipo', e.target.value)}
          >
            {tipos?.tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Título</span>
          <input
            className={classeCampo}
            value={dados.titulo}
            maxLength={200}
            placeholder="Ex.: Ata de eleição da diretoria 2026-2028"
            onChange={(e) => campo('titulo', e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Descrição <span className="font-normal">(opcional)</span>
          </span>
          <textarea
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={dados.descricao ?? ''}
            onChange={(e) => campo('descricao', e.target.value)}
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">
            Quem pode ler o ORIGINAL?
          </legend>
          {(tipos?.classificacoes ?? ['Pública', 'Interna', 'Restrita']).map(
            (c) => (
              <label key={c} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="classificacao"
                  className="mt-1"
                  checked={dados.classificacao === c}
                  onChange={() => campo('classificacao', c as Classificacao)}
                />
                <span>
                  <strong>{c}</strong> —{' '}
                  {EXPLICACAO_DA_CLASSIFICACAO[c as Classificacao]}
                </span>
              </label>
            ),
          )}
        </fieldset>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={dados.publicar_no_site}
            onChange={(e) => campo('publicar_no_site', e.target.checked)}
          />
          <span>
            <strong>Publicar no site de transparência.</strong> Exige uma versão
            pública conferida e a aprovação de outra pessoa.
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Data do documento <span className="font-normal">(opcional)</span>
            </span>
            <input
              type="date"
              className={classeCampo}
              value={dados.data_documento ?? ''}
              onChange={(e) => campo('data_documento', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Validade <span className="font-normal">(certidões)</span>
            </span>
            <input
              type="date"
              className={classeCampo}
              value={dados.validade ?? ''}
              onChange={(e) => campo('validade', e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">
              Ano <span className="font-normal">(opcional)</span>
            </span>
            <input
              type="number"
              className={classeCampo}
              value={dados.ano ?? ''}
              onChange={(e) => campo('ano', e.target.value)}
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            Arquivo original{' '}
            <span className="font-normal">(PDF, JPG ou PNG, até 25 MB)</span>
          </span>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          />
          <span className="mt-1 block text-muted-foreground">
            Fica em área privada: ninguém de fora enxerga, e cada download é
            registrado.
          </span>
        </label>

        <div className="flex gap-2">
          <Button type="submit" disabled={criar.isPending}>
            {criar.isPending ? 'Cadastrando…' : 'Cadastrar documento'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navegar('/documentos')}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </>
  )
}
