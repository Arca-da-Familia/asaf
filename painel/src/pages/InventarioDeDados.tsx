import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  ajustarAtividade,
  baixarInventario,
  historicoDaAtividade,
  obterInventario,
  type AjusteDeAtividade,
  type AtividadeDeTratamento,
  type Inventario,
} from '@/lib/privacidade'

const CHAVE = ['privacidade', 'inventario']

function Secao({
  titulo,
  children,
}: {
  titulo: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {titulo}
      </p>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Selo({
  children,
  classe,
}: {
  children: React.ReactNode
  classe: string
}) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${classe}`}>
      {children}
    </span>
  )
}

function Ajustar({
  atividade,
  inventario,
  aoFechar,
}: {
  atividade: AtividadeDeTratamento
  inventario: Inventario
  aoFechar: () => void
}) {
  const queryClient = useQueryClient()
  // a versão que estava na tela quando o formulário abriu: se a lista for relida enquanto se edita, o servidor ainda percebe que outra pessoa salvou (409)
  const [versaoBase] = useState(atividade.versao)
  const [dados, setDados] = useState<Required<AjusteDeAtividade>>({
    finalidade: atividade.finalidade,
    bases_legais: atividade.bases_legais,
    medidas: atividade.medidas,
    observacoes: atividade.observacoes,
    base_legal_conferida: atividade.base_legal_conferida,
  })
  const salvar = useMutation({
    mutationFn: () => ajustarAtividade(atividade.codigo, dados, versaoBase),
    onSuccess: (novo) => {
      queryClient.setQueryData(CHAVE, novo)
      void queryClient.invalidateQueries({
        queryKey: [...CHAVE, 'historico', atividade.codigo],
      })
      aoFechar()
    },
  })
  const alternar = (lista: string[], codigo: string) =>
    lista.includes(codigo)
      ? lista.filter((c) => c !== codigo)
      : [...lista, codigo]
  const id = (campo: string) => `${atividade.codigo}-${campo}`
  const classe =
    'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <form
      aria-label={`Ajustar ${atividade.nome}`}
      className="mt-4 v3-space-y-3 rounded-md border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault()
        salvar.mutate()
      }}
    >
      <div>
        <label htmlFor={id('finalidade')} className="text-sm font-medium">
          Finalidade
        </label>
        <textarea
          id={id('finalidade')}
          rows={3}
          className={classe}
          value={dados.finalidade}
          onChange={(e) => setDados({ ...dados, finalidade: e.target.value })}
        />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Base legal</legend>
        {inventario.bases_legais.map((b) => (
          <label key={b.codigo} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={dados.bases_legais.includes(b.codigo)}
              onChange={() =>
                // base legal nova não nasce conferida: o encarregado marca de novo
                setDados({
                  ...dados,
                  bases_legais: alternar(dados.bases_legais, b.codigo),
                  base_legal_conferida: false,
                })
              }
            />
            {b.texto}
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor={id('medidas')} className="text-sm font-medium">
          Medidas de segurança
        </label>
        <textarea
          id={id('medidas')}
          rows={3}
          className={classe}
          value={dados.medidas}
          onChange={(e) => setDados({ ...dados, medidas: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={id('observacoes')} className="text-sm font-medium">
          Observações
        </label>
        <textarea
          id={id('observacoes')}
          rows={2}
          className={classe}
          value={dados.observacoes}
          onChange={(e) => setDados({ ...dados, observacoes: e.target.value })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={dados.base_legal_conferida}
          onChange={(e) =>
            setDados({ ...dados, base_legal_conferida: e.target.checked })
          }
        />
        O encarregado conferiu a base legal desta atividade
      </label>
      {salvar.isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(salvar.error, 'Não foi possível salvar.')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar (versão nova)'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={aoFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function Historico({ codigo }: { codigo: string }) {
  const { data, isLoading } = useQuery({
    queryKey: [...CHAVE, 'historico', codigo],
    queryFn: () => historicoDaAtividade(codigo),
  })
  if (isLoading)
    return <p className="text-sm text-muted-foreground">Carregando…</p>
  return (
    <ol className="mt-2 list-decimal pl-5 text-sm" aria-label="Versões">
      {(data ?? []).map((v) => (
        <li key={v.versao}>
          Versão {v.versao}
          {v.alterado_em
            ? ` — ${formatarData(v.alterado_em, { comHora: true })}, por ${v.por ?? '—'}`
            : ' — proposta do sistema'}
          {v.campos.base_legal_conferida ? ' (base legal conferida)' : ''}
        </li>
      ))}
    </ol>
  )
}

function Cartao({
  atividade,
  inventario,
}: {
  atividade: AtividadeDeTratamento
  inventario: Inventario
}) {
  const [ajustando, setAjustando] = useState(false)
  const [vendoHistorico, setVendoHistorico] = useState(false)
  return (
    <section
      aria-label={atividade.nome}
      data-atividade={atividade.codigo}
      className="rounded-xl border border-border bg-card p-6"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{atividade.nome}</h2>
        {atividade.dados_sensiveis.length > 0 && (
          <Selo classe="bg-red-100 text-red-900">Dado sensível</Selo>
        )}
        {atividade.pode_ter_crianca && (
          <Selo classe="bg-amber-100 text-amber-900">
            Pode ter criança ou adolescente
          </Selo>
        )}
        {atividade.base_legal_conferida ? (
          <Selo classe="bg-green-100 text-green-900">Base legal conferida</Selo>
        ) : (
          <Selo classe="bg-muted text-muted-foreground">
            Base legal: proposta do sistema
          </Selo>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Secao titulo="Finalidade">{atividade.finalidade}</Secao>
        <Secao titulo="Titulares">{atividade.titulares.join('; ')}</Secao>
        <Secao titulo="Base legal">
          <ul className="list-disc pl-5">
            {atividade.bases_legais_texto.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Secao>
        <Secao titulo="Com quem se compartilha">
          <ul className="list-disc pl-5">
            {atividade.operadores_detalhe.map((o) => (
              <li key={o.codigo}>
                <strong>{o.nome}</strong>: {o.o_que_faz}. Onde: {o.onde}.
              </li>
            ))}
          </ul>
        </Secao>
        <Secao titulo="Onde fica guardado">
          <ul className="list-disc pl-5">
            {atividade.armazenamento.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Secao>
        <Secao titulo="Período de armazenamento">
          {atividade.sem_rotina_de_guarda ? (
            <span data-sem-rotina>
              Sem rotina automática de eliminação ainda.
            </span>
          ) : (
            <ul className="list-disc pl-5">
              {atividade.prazos_de_guarda.map((p) => (
                <li key={p.regra}>
                  {p.rotulo}: {p.dias} dias
                </li>
              ))}
              {atividade.prazos_fixos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </Secao>
        {atividade.requisito_crianca && (
          <Secao titulo="Criança e adolescente">
            {atividade.requisito_crianca}
          </Secao>
        )}
        {atividade.tabelas_externas.length > 0 && (
          <Secao titulo="Dados fora deste sistema">
            {atividade.tabelas_externas.join('; ')}
          </Secao>
        )}
        <Secao titulo="Medidas de segurança">{atividade.medidas}</Secao>
        {atividade.observacoes && (
          <Secao titulo="Observações">{atividade.observacoes}</Secao>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Dados pessoais ({atividade.dados_pessoais.length}) e tabelas (
          {atividade.tabelas.length})
        </summary>
        {atividade.dados_sensiveis.length > 0 && (
          <p className="mt-2 text-sm">
            <strong>Sensíveis:</strong> {atividade.dados_sensiveis.join(', ')}
          </p>
        )}
        {atividade.texto_livre_que_pode_ter_sensivel.length > 0 && (
          <p className="mt-2 text-sm">
            <strong>Texto livre que pode ter dado sensível:</strong>{' '}
            {atividade.texto_livre_que_pode_ter_sensivel.join(', ')}
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {atividade.dados_pessoais.join(', ') ||
            atividade.tabelas_externas.join('; ') ||
            'só quem registrou'}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Tabelas: {atividade.tabelas.join(', ')}
        </p>
      </details>
      <p className="mt-3 text-xs text-muted-foreground">
        {atividade.versao === 0 || !atividade.alterado_em
          ? `Versão ${atividade.versao}${atividade.versao === 0 ? ' (proposta do sistema)' : ''}.`
          : `Versão ${atividade.versao}, de ${formatarData(atividade.alterado_em, { comHora: true })}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {inventario.pode_gerir && !ajustando && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAjustando(true)}
          >
            Ajustar
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVendoHistorico(!vendoHistorico)}
        >
          {vendoHistorico ? 'Fechar o histórico' : 'Ver o histórico'}
        </Button>
      </div>
      {vendoHistorico && <Historico codigo={atividade.codigo} />}
      {ajustando && (
        <Ajustar
          atividade={atividade}
          inventario={inventario}
          aoFechar={() => setAjustando(false)}
        />
      )}
    </section>
  )
}

// v7.0c - o inventário de dados (registro das operações de tratamento, LGPD art. 37): cada atividade com as seções do modelo da ANPD; o que é fato do sistema
// (tabelas, dados, prazo) vem do código, o que é decisão (finalidade, base legal, operadores, medidas) o encarregado ajusta, com histórico.
export function InventarioDeDadosPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: CHAVE,
    queryFn: obterInventario,
  })
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null)
  const baixar = (formato: 'planilha' | 'pdf') => () => {
    setErroDoArquivo(null)
    baixarInventario(formato).catch((e) =>
      setErroDoArquivo(mensagemDoErro(e, 'Não foi possível gerar o arquivo.')),
    )
  }

  return (
    <>
      <PageHeader
        titulo="Inventário de dados"
        descricao="O registro das operações de tratamento (LGPD, art. 37): o que a associação guarda de cada pessoa, para quê, com que base legal, com quem compartilha, onde e por quanto tempo."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Privacidade' },
          { rotulo: 'Inventário de dados' },
        ]}
      />
      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {mensagemDoErro(error, 'Não foi possível carregar.')}
        </p>
      )}
      {data && (
        <div className="v3-space-y-6">
          {(data.tabelas_sem_atividade.length > 0 ||
            data.base_legal_a_conferir.length > 0) && (
            <section
              aria-label="O que falta"
              data-testid="pendencias-do-inventario"
              className="rounded-xl border border-amber-600/30 bg-amber-600/10 p-4 text-sm"
            >
              <h2 className="mb-2 font-semibold">O que falta</h2>
              <ul className="list-disc pl-5">
                {data.tabelas_sem_atividade.length > 0 && (
                  <li>
                    Dados pessoais fora do inventário:{' '}
                    {data.tabelas_sem_atividade.join(', ')}.
                  </li>
                )}
                {data.base_legal_a_conferir.length > 0 && (
                  <li>
                    {data.base_legal_a_conferir.length} de{' '}
                    {data.atividades.length} atividades com a base legal ainda
                    como proposta do sistema (o encarregado confere e marca).
                  </li>
                )}
              </ul>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={baixar('planilha')}>
              Baixar a planilha
            </Button>
            <Button size="sm" variant="outline" onClick={baixar('pdf')}>
              Abrir em PDF
            </Button>
          </div>
          {erroDoArquivo && (
            <p role="alert" className="text-sm text-destructive">
              {erroDoArquivo}
            </p>
          )}
          {data.atividades.map((a) => (
            <Cartao key={a.codigo} atividade={a} inventario={data} />
          ))}
        </div>
      )}
    </>
  )
}
