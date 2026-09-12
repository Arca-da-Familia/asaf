import type { ColumnDef } from '@tanstack/react-table'
import { useState, type ReactNode } from 'react'
import { Controller } from 'react-hook-form'
import { z } from 'zod'

import { DataTable } from '@/components/data/DataTable'
import { Timeline } from '@/components/display/Timeline'
import { CamposPersonalizadosFields } from '@/components/forms/CamposPersonalizados'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { EmptyState } from '@/components/feedback/EmptyState'
import { SkeletonTabela } from '@/components/feedback/SkeletonLoader'
import { FormShell, ErroCampo } from '@/components/forms/FormShell'
import { CnpjInput } from '@/components/forms/inputs/CnpjInput'
import { CpfInput } from '@/components/forms/inputs/CpfInput'
import { DateInput } from '@/components/forms/inputs/DateInput'
import { FileUpload } from '@/components/forms/inputs/FileUpload'
import { MoneyInput } from '@/components/forms/inputs/MoneyInput'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  construirSchemaCamposPersonalizados,
  useDefinicoesCampo,
  valoresParaDefaultValues,
} from '@/lib/campos-personalizados'
import { validarCpf } from '@/lib/cpf'
import { validarCnpj } from '@/lib/cnpj'
import { cores } from '@/lib/tokens'

type Pessoa = { nome: string; email: string; status: string }
const pessoas: Pessoa[] = [
  { nome: 'Maria Silva', email: 'maria@exemplo.com', status: 'Ativo' },
  { nome: 'João Souza', email: 'joao@exemplo.com', status: 'Ativo' },
  { nome: 'Ana Lima', email: 'ana@exemplo.com', status: 'Inadimplente' },
  { nome: 'Pedro Costa', email: 'pedro@exemplo.com', status: 'Ativo' },
  { nome: 'Larissa Rocha', email: 'lari@exemplo.com', status: 'Suspenso' },
  { nome: 'Carlos Mendes', email: 'carlos@exemplo.com', status: 'Ativo' },
  { nome: 'Beatriz Alves', email: 'bia@exemplo.com', status: 'Ativo' },
  { nome: 'Rafael Nunes', email: 'rafa@exemplo.com', status: 'Ativo' },
  { nome: 'Juliana Prado', email: 'ju@exemplo.com', status: 'Inadimplente' },
  { nome: 'Marcos Vieira', email: 'marcos@exemplo.com', status: 'Ativo' },
  { nome: 'Fernanda Dias', email: 'fefe@exemplo.com', status: 'Ativo' },
  { nome: 'Gustavo Reis', email: 'guto@exemplo.com', status: 'Suspenso' },
]
const colunasPessoas: ColumnDef<Pessoa>[] = [
  { accessorKey: 'nome', header: 'Nome' },
  { accessorKey: 'email', header: 'E-mail' },
  { accessorKey: 'status', header: 'Status' },
]

const schemaForm = z.object({
  nome: z.string().min(3, 'Informe ao menos 3 caracteres.'),
  cpf: z.string().refine(validarCpf, { message: 'CPF inválido.' }),
  cnpj: z.string().refine(validarCnpj, { message: 'CNPJ inválido.' }),
  valor: z.number().nullable(),
  data: z.string(),
})
type FormValores = z.infer<typeof schemaForm>

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="mb-4 font-semibold">{titulo}</h2>
      {children}
    </section>
  )
}

// Demonstra o hook + componente de verdade contra a API (v0.3.3) — não é dado estático, é a
// prova viva de que "cadastrar um campo novo não pede código novo" é real, não só desenhado.
function CamposPersonalizadosDemo() {
  const { data: definicoes, isLoading } = useDefinicoesCampo('associado')
  const [enviado, setEnviado] = useState<string | null>(null)

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (!definicoes?.length) {
    return (
      <EmptyState
        titulo="Nenhum campo personalizado cadastrado"
        descricao="Cadastre um em POST /api/campos-personalizados/ pra ver renderizado aqui."
      />
    )
  }

  const schema = construirSchemaCamposPersonalizados(definicoes)
  return (
    <FormShell
      schema={schema}
      defaultValues={valoresParaDefaultValues(definicoes, {})}
      onSubmit={(v) => setEnviado(JSON.stringify(v, null, 2))}
    >
      {(form) => (
        <>
          <CamposPersonalizadosFields definicoes={definicoes} form={form} />
          <Button type="submit" className="mt-4">
            Validar (não grava nada)
          </Button>
          {enviado && (
            <pre className="mt-4 rounded-md bg-muted p-3 text-xs">
              {enviado}
            </pre>
          )}
        </>
      )}
    </FormShell>
  )
}

export function DevComponents() {
  const [dialogoAberto, setDialogoAberto] = useState(false)
  const [enviado, setEnviado] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        titulo="Catálogo de componentes"
        descricao="Documentação viva dos componentes-padrão (v0.2.4) — o código é a própria referência."
        trilha={[{ rotulo: 'Início', href: '/' }, { rotulo: 'Componentes' }]}
      />

      <div className="space-y-6">
        <Secao titulo="Tokens de cor (cores institucionais)">
          <div className="flex flex-wrap gap-3">
            {[
              ['Brand', cores.brand],
              ['Sucesso', cores.status.sucesso],
              ['Alerta', cores.status.alerta],
              ['Erro', cores.status.erro],
            ].map(([nome, cor]) => (
              <div key={nome as string} className="flex items-center gap-2">
                <span
                  className="h-8 w-8 rounded-md border border-border"
                  style={{ backgroundColor: cor as string }}
                />
                <span className="text-sm text-muted-foreground">{nome}</span>
              </div>
            ))}
          </div>
        </Secao>

        <Secao titulo="DataTable (ordenação, filtro, paginação e densidade)">
          <DataTable dados={pessoas} colunas={colunasPessoas} />
        </Secao>

        <Secao titulo="FormShell + inputs brasileiros (Zod + react-hook-form)">
          <FormShell<FormValores>
            schema={schemaForm}
            defaultValues={{
              nome: '',
              cpf: '',
              cnpj: '',
              valor: null,
              data: '',
            }}
            onSubmit={(v) => setEnviado(JSON.stringify(v, null, 2))}
          >
            {(form) => (
              <>
                <div>
                  <label htmlFor="nome" className="text-sm font-medium">
                    Nome
                  </label>
                  <input
                    id="nome"
                    {...form.register('nome')}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <ErroCampo mensagem={form.formState.errors.nome?.message} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="cpf" className="text-sm font-medium">
                      CPF
                    </label>
                    <Controller
                      control={form.control}
                      name="cpf"
                      render={({ field }) => (
                        <CpfInput
                          id="cpf"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                        />
                      )}
                    />
                    <ErroCampo mensagem={form.formState.errors.cpf?.message} />
                  </div>
                  <div>
                    <label htmlFor="cnpj" className="text-sm font-medium">
                      CNPJ
                    </label>
                    <Controller
                      control={form.control}
                      name="cnpj"
                      render={({ field }) => (
                        <CnpjInput
                          id="cnpj"
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                        />
                      )}
                    />
                    <ErroCampo mensagem={form.formState.errors.cnpj?.message} />
                  </div>
                  <div>
                    <label htmlFor="valor" className="text-sm font-medium">
                      Valor
                    </label>
                    <Controller
                      control={form.control}
                      name="valor"
                      render={({ field }) => (
                        <MoneyInput
                          id="valor"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                  <div>
                    <label htmlFor="data" className="text-sm font-medium">
                      Data
                    </label>
                    <Controller
                      control={form.control}
                      name="data"
                      render={({ field }) => (
                        <DateInput
                          id="data"
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </div>
                </div>
                <Button type="submit">Enviar</Button>
                {enviado && (
                  <pre className="rounded-md bg-muted p-3 text-xs">
                    {enviado}
                  </pre>
                )}
              </>
            )}
          </FormShell>
        </Secao>

        <Secao titulo="EmptyState, SkeletonLoader, ConfirmDialog e Timeline">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <EmptyState
                titulo="Sem resultados"
                descricao="Ajuste os filtros e tente novamente."
              />
              <div className="mt-4">
                <SkeletonTabela linhas={3} />
              </div>
            </div>
            <div className="space-y-6">
              <Button
                variant="destructive"
                onClick={() => setDialogoAberto(true)}
              >
                Abrir confirmação destrutiva
              </Button>
              <Timeline
                eventos={[
                  {
                    titulo: 'Cadastro criado',
                    data: '01/12/2026',
                    descricao: 'Por João Souza.',
                  },
                  {
                    titulo: 'Status alterado para Inadimplente',
                    data: '05/12/2026',
                  },
                  { titulo: 'MFA ativado', data: '08/12/2026' },
                ]}
              />
            </div>
          </div>
        </Secao>

        <Secao titulo="FileUpload (limite de tipo/tamanho e progresso)">
          <FileUpload
            tiposAceitos={['application/pdf', 'image/png', 'image/jpeg']}
            tamanhoMaximoMb={10}
            onArquivosSelecionados={() => {}}
          />
        </Secao>

        <Secao titulo="Campos personalizados sem deploy (v0.3.3)">
          <p className="mb-4 text-sm text-muted-foreground">
            Renderizado a partir do que estiver cadastrado agora em{' '}
            <code>GET /api/campos-personalizados/associado</code> — não é dado
            de exemplo fixo. Cadastre um campo novo pela API e ele aparece aqui
            sem nenhuma mudança de código.
          </p>
          <CamposPersonalizadosDemo />
        </Secao>
      </div>

      <ConfirmDialog
        aberto={dialogoAberto}
        onAbertoChange={setDialogoAberto}
        titulo="Excluir associado"
        descricao="Esta ação é irreversível. O registro será removido permanentemente."
        rotuloConfirmar="Excluir associado"
        onConfirmar={() => setDialogoAberto(false)}
      />
    </>
  )
}
