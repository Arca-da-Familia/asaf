import { useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Secao } from '@/components/layout/Secao'
import { Button } from '@/components/ui/button'
import { classeCampo } from '@/lib/campos'
import { isoParaDataBr } from '@/lib/datas'
import {
  classificarLancamento,
  corrigirLancamento,
  desfazerClassificacao,
  moeda,
  type Executar,
  type LancamentoClassificado,
  type LancamentoPendente,
  type Opcoes,
  type ParceriaDetalhe,
} from '@/lib/parcerias'

const dia = (iso: string | null) =>
  iso ? isoParaDataBr(iso.slice(0, 10)) : '—'

// O DINHEIRO vem do livro-caixa (centro de custo exclusivo da parceria). Aqui cada movimento é CLASSIFICADO por uma
// pessoa, que escreve o texto que o público vai ler. O histórico do livro-caixa é interno e nunca vai ao site;
// pagamento de equipe sai só com a função e o valor, nunca com o nome.
export function SecaoLancamentos({
  d,
  opcoes,
  executar,
}: {
  d: ParceriaDetalhe
  opcoes: Opcoes | undefined
  executar: Executar
}) {
  return (
    <>
      <Secao
        titulo="Movimentos do livro-caixa a classificar"
        descricao={`Tudo que entra ou sai no centro de custo ${d.codigo_centro_custo ?? ''} aparece aqui. Enquanto houver movimento sem classificação, a publicação fica travada.`}
      >
        {d.lancamentos_sem_classificacao.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum movimento esperando classificação. Para um recebimento ou
            pagamento aparecer aqui, lance-o no livro-caixa marcando o centro de
            custo <strong>{d.codigo_centro_custo}</strong>.
          </p>
        ) : (
          <ul className="space-y-3">
            {d.lancamentos_sem_classificacao.map((p) => (
              <li
                key={p.id_lancamento}
                className="rounded-md border border-amber-300 bg-amber-50/50 p-3 text-sm"
              >
                <ClassificarMovimento
                  d={d}
                  pendente={p}
                  opcoes={opcoes}
                  executar={executar}
                />
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Movimentos classificados (os que aparecem no site)"
        descricao="Valor e data vêm do livro-caixa. Se um movimento for estornado no livro-caixa, ele sai do site sozinho."
      >
        {d.lancamentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum movimento classificado ainda.
          </p>
        ) : (
          <ul className="space-y-3">
            {d.lancamentos.map((l) => (
              <li
                key={l.id_vinculo}
                className="rounded-md border border-border p-3 text-sm"
              >
                <MovimentoClassificado d={d} l={l} executar={executar} />
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </>
  )
}

function ClassificarMovimento({
  d,
  pendente,
  opcoes,
  executar,
}: {
  d: ParceriaDetalhe
  pendente: LancamentoPendente
  opcoes: Opcoes | undefined
  executar: Executar
}) {
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState('OUTRO')
  const [funcao, setFuncao] = useState('')
  const [idParcela, setIdParcela] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const pagamento = pendente.natureza === 'PAGAMENTO'

  async function classificar() {
    setErro(null)
    if (descricao.trim().length < 3) {
      return setErro('Escreva o texto público (pelo menos 3 letras).')
    }
    if (pagamento && categoria === 'EQUIPE' && !funcao.trim()) {
      return setErro(
        'Pagamento de equipe: informe a função (o nome não vai ao site).',
      )
    }
    await executar(() =>
      classificarLancamento(d.id_parceria, {
        id_lancamento: pendente.id_lancamento,
        natureza: pendente.natureza,
        descricao_publica: descricao.trim(),
        ...(pagamento ? { categoria } : {}),
        ...(pagamento && categoria === 'EQUIPE'
          ? { funcao: funcao.trim() }
          : {}),
        ...(!pagamento && idParcela ? { id_parcela: Number(idParcela) } : {}),
      }),
    )
  }

  return (
    <div className="space-y-3">
      <p>
        <strong>
          {pendente.natureza_rotulo} de {moeda(pendente.valor)}
        </strong>{' '}
        em {dia(pendente.data)} — lançamento nº {pendente.numero}
        <span className="block text-xs text-muted-foreground">
          Histórico interno (não vai ao site): {pendente.historico ?? '—'}
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          rotulo="Texto público"
          dica="Ex.: Repasse da 1ª parcela; Compra de instrumentos musicais. Sem nome de pessoa, CPF ou telefone."
          className="sm:col-span-2"
        >
          <input
            className={classeCampo}
            value={descricao}
            maxLength={200}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </Campo>
        {pagamento && (
          <Campo rotulo="Tipo de pagamento">
            <select
              className={classeCampo}
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {opcoes?.categorias_de_pagamento.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {pagamento && categoria === 'EQUIPE' && (
          <Campo rotulo="Função (aparece no lugar do nome)">
            <input
              className={classeCampo}
              value={funcao}
              maxLength={80}
              placeholder="Ex.: Oficineiro de música"
              onChange={(e) => setFuncao(e.target.value)}
            />
          </Campo>
        )}
        {!pagamento && d.parcelas.length > 0 && (
          <Campo rotulo="Parcela a que se refere (opcional)">
            <select
              className={classeCampo}
              value={idParcela}
              onChange={(e) => setIdParcela(e.target.value)}
            >
              <option value="">Não ligar a uma parcela</option>
              {d.parcelas.map((p) => (
                <option key={p.id_parcela} value={p.id_parcela}>
                  {p.numero}ª parcela ({moeda(p.valor_previsto)})
                </option>
              ))}
            </select>
          </Campo>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => void classificar()}
      >
        Classificar para o site
      </Button>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  )
}

function MovimentoClassificado({
  d,
  l,
  executar,
}: {
  d: ParceriaDetalhe
  l: LancamentoClassificado
  executar: Executar
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(l.descricao_publica)
  const [funcao, setFuncao] = useState(l.funcao ?? '')

  return (
    <div className="space-y-2">
      <p>
        <strong>
          {l.natureza_rotulo} de {moeda(l.valor)}
        </strong>{' '}
        em {dia(l.data)}
        {l.parcela_numero ? ` (${l.parcela_numero}ª parcela)` : ''}
        {l.estornado && (
          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-900">
            Estornado: fora do site
          </span>
        )}
      </p>
      <p>
        No site: “{l.descricao_publica}”
        {l.funcao ? ` — função: ${l.funcao}` : ''}
        {l.fornecedor
          ? ` — ${l.fornecedor.razao_social} (CNPJ ${l.fornecedor.cnpj})`
          : ''}
      </p>
      {d.pode_editar && !editando && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditando(true)}
          >
            Corrigir o texto
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void executar(() =>
                desfazerClassificacao(d.id_parceria, l.id_vinculo),
              )
            }
          >
            Tirar do site
          </Button>
        </div>
      )}
      {d.pode_editar && editando && (
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Texto público" className="min-w-64 flex-1">
            <input
              className={classeCampo}
              value={texto}
              maxLength={200}
              onChange={(e) => setTexto(e.target.value)}
            />
          </Campo>
          {l.categoria === 'EQUIPE' && (
            <Campo rotulo="Função" className="w-56">
              <input
                className={classeCampo}
                value={funcao}
                maxLength={80}
                onChange={(e) => setFuncao(e.target.value)}
              />
            </Campo>
          )}
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              const ok = await executar(() =>
                corrigirLancamento(d.id_parceria, l.id_vinculo, {
                  descricao_publica: texto.trim(),
                  ...(l.categoria === 'EQUIPE'
                    ? { funcao: funcao.trim() }
                    : {}),
                }),
              )
              if (ok) setEditando(false)
            }}
          >
            Salvar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditando(false)}
          >
            Cancelar
          </Button>
        </div>
      )}
    </div>
  )
}
