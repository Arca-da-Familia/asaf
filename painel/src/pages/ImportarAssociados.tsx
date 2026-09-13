import { useState } from 'react'

import {
  desfazerLote,
  importarLote,
  verificarDuplicidade,
  type LinhaImportacao,
  type ResultadoImportacao,
} from '@/lib/api'
import { validarCpf } from '@/lib/cpf'
import {
  CAMPOS_SISTEMA,
  aplicarMapeamento,
  parseArquivoCsv,
  sugerirMapeamento,
  type ChaveCampoSistema,
  type MapeamentoColunas,
  type PlanilhaParseada,
} from '@/lib/importacao'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'

type LinhaRevisada = Record<ChaveCampoSistema, string> & {
  erro: string | null
  duplicidade: 'cpf_exato' | 'nome_e_nascimento' | null
  nomeEncontrado: string | null
  resolucao: 'nova' | 'ignorar'
}

const PASSOS = [
  'Enviar arquivo',
  'Mapear colunas',
  'Revisar',
  'Confirmar',
] as const

export function ImportarAssociadosPage() {
  const [passo, setPasso] = useState(0)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  const [planilha, setPlanilha] = useState<PlanilhaParseada | null>(null)
  const [mapeamento, setMapeamento] = useState<MapeamentoColunas>({})
  const [linhasRevisadas, setLinhasRevisadas] = useState<LinhaRevisada[]>([])
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null)
  const [desfeito, setDesfeito] = useState(false)

  async function aoSelecionarArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return
    setErroGeral(null)
    try {
      const parseada = await parseArquivoCsv(arquivo)
      if (parseada.linhas.length === 0) {
        setErroGeral('Arquivo vazio ou sem linhas reconhecidas.')
        return
      }
      setPlanilha(parseada)
      setMapeamento(sugerirMapeamento(parseada.cabecalhos))
      setPasso(1)
    } catch {
      setErroGeral(
        'Não foi possível ler o arquivo. Confirme que é um CSV válido.',
      )
    }
  }

  async function confirmarMapeamentoEValidar() {
    if (!planilha) return
    const faltando = CAMPOS_SISTEMA.filter(
      (c) => c.obrigatorio && !mapeamento[c.chave],
    )
    if (faltando.length > 0) {
      setErroGeral(
        `Mapeie os campos obrigatórios: ${faltando.map((c) => c.rotulo).join(', ')}.`,
      )
      return
    }
    setErroGeral(null)
    setCarregando(true)
    try {
      const linhasMapeadas = aplicarMapeamento(planilha.linhas, mapeamento)
      const comValidacaoLocal = linhasMapeadas.map((linha) => {
        if (!linha.nome_completo || linha.nome_completo.length < 3)
          return { linha, erro: 'Nome incompleto.' }
        if (!validarCpf(linha.cpf)) return { linha, erro: 'CPF inválido.' }
        return { linha, erro: null as string | null }
      })

      const linhasParaChecar = comValidacaoLocal
        .map((r, i) => ({ ...r.linha, indice: i, erro: r.erro }))
        .filter((r) => r.erro === null)
      const { resultados } = linhasParaChecar.length
        ? await verificarDuplicidade(
            linhasParaChecar.map((l) => ({
              nome_completo: l.nome_completo,
              cpf: l.cpf,
              data_nascimento: l.data_nascimento || undefined,
            })),
          )
        : { resultados: [] }
      const duplicidadePorIndiceOriginal = new Map(
        linhasParaChecar.map((l, ordem) => [l.indice, resultados[ordem]]),
      )

      const revisadas: LinhaRevisada[] = comValidacaoLocal.map((r, i) => {
        const dup = duplicidadePorIndiceOriginal.get(i)
        return {
          ...r.linha,
          erro: r.erro,
          duplicidade: dup?.tipo ?? null,
          nomeEncontrado: dup?.nome_encontrado ?? null,
          resolucao: dup?.tipo ? 'ignorar' : 'nova',
        }
      })
      setLinhasRevisadas(revisadas)
      setPasso(2)
    } finally {
      setCarregando(false)
    }
  }

  function alterarResolucao(indice: number, resolucao: 'nova' | 'ignorar') {
    setLinhasRevisadas((atual) =>
      atual.map((l, i) => (i === indice ? { ...l, resolucao } : l)),
    )
  }

  async function confirmarImportacao() {
    setCarregando(true)
    setErroGeral(null)
    try {
      const linhas: LinhaImportacao[] = linhasRevisadas
        .filter((l) => !l.erro)
        .map((l) => ({
          nome_completo: l.nome_completo,
          cpf: l.cpf,
          email_contato: l.email_contato || undefined,
          telefone_whatsapp: l.telefone_whatsapp || undefined,
          data_nascimento: l.data_nascimento || undefined,
          categoria: l.categoria || 'Efetivo',
          resolucao: l.resolucao,
        }))
      const resposta = await importarLote(linhas)
      setResultado(resposta)
      setPasso(3)
    } catch {
      setErroGeral('Falha ao importar o lote. Nada foi gravado.')
    } finally {
      setCarregando(false)
    }
  }

  async function desfazerImportacao() {
    if (!resultado) return
    setCarregando(true)
    try {
      await desfazerLote(resultado.id_lote)
      setDesfeito(true)
    } catch {
      setErroGeral(
        'Não foi possível desfazer o lote — veja o motivo na tela e tente novamente.',
      )
    } finally {
      setCarregando(false)
    }
  }

  const linhasValidas = linhasRevisadas.filter((l) => !l.erro)
  const aSeremCriadas = linhasValidas.filter(
    (l) => l.resolucao === 'nova',
  ).length
  const aSeremIgnoradas = linhasRevisadas.length - aSeremCriadas

  return (
    <>
      <PageHeader
        titulo="Importar associados"
        descricao="Assistente de importação em massa a partir de planilha CSV — o arquivo é lido no seu navegador, nunca enviado bruto ao servidor."
        trilha={[
          { rotulo: 'Início', href: '/' },
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Importar' },
        ]}
      />

      <div className="mb-6 flex gap-2 text-sm">
        {PASSOS.map((nome, i) => (
          <div
            key={nome}
            className={`flex-1 rounded-md border px-3 py-2 text-center ${
              i === passo
                ? 'border-primary bg-primary/10 font-semibold'
                : 'border-border text-muted-foreground'
            }`}
          >
            {i + 1}. {nome}
          </div>
        ))}
      </div>

      {erroGeral && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erroGeral}
        </p>
      )}

      {passo === 0 && (
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            Selecione um arquivo CSV com a primeira linha contendo os nomes das
            colunas. Exportado do Excel/Google Sheets em "Salvar como &gt; CSV".
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={aoSelecionarArquivo}
          />
        </section>
      )}

      {passo === 1 && planilha && (
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            {planilha.linhas.length} linha(s) encontrada(s). Confirme qual
            coluna do arquivo corresponde a cada campo do sistema.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {CAMPOS_SISTEMA.map((campo) => (
              <div key={campo.chave}>
                <label
                  htmlFor={`map_${campo.chave}`}
                  className="text-sm font-medium"
                >
                  {campo.rotulo}{' '}
                  {campo.obrigatorio && (
                    <span className="text-destructive">*</span>
                  )}
                </label>
                <select
                  id={`map_${campo.chave}`}
                  value={mapeamento[campo.chave] ?? ''}
                  onChange={(e) =>
                    setMapeamento((m) => ({
                      ...m,
                      [campo.chave]: e.target.value || undefined,
                    }))
                  }
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">— não mapeado —</option>
                  {planilha.cabecalhos.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <Button
            className="mt-6"
            onClick={confirmarMapeamentoEValidar}
            disabled={carregando}
          >
            {carregando ? 'Validando…' : 'Continuar'}
          </Button>
        </section>
      )}

      {passo === 2 && (
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            {linhasValidas.length} de {linhasRevisadas.length} linha(s) passaram
            na validação básica. Linhas com possível duplicidade precisam de uma
            decisão antes de continuar.
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="p-2 text-left">Nome</th>
                  <th className="p-2 text-left">CPF</th>
                  <th className="p-2 text-left">Situação</th>
                  <th className="p-2 text-left">Ação</th>
                </tr>
              </thead>
              <tbody>
                {linhasRevisadas.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="p-2">{l.nome_completo}</td>
                    <td className="p-2 font-mono">{l.cpf}</td>
                    <td className="p-2">
                      {l.erro ? (
                        <span className="text-destructive">{l.erro}</span>
                      ) : l.duplicidade === 'cpf_exato' ? (
                        <span className="text-amber-600">
                          CPF já cadastrado ({l.nomeEncontrado})
                        </span>
                      ) : l.duplicidade === 'nome_e_nascimento' ? (
                        <span className="text-amber-600">
                          Possível duplicata: {l.nomeEncontrado}
                        </span>
                      ) : (
                        <span className="text-emerald-600">OK</span>
                      )}
                    </td>
                    <td className="p-2">
                      {!l.erro && l.duplicidade && (
                        <select
                          value={l.resolucao}
                          onChange={(e) =>
                            alterarResolucao(
                              i,
                              e.target.value as 'nova' | 'ignorar',
                            )
                          }
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="ignorar">Ignorar esta linha</option>
                          <option value="nova">Criar mesmo assim</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" onClick={() => setPasso(1)}>
              Voltar
            </Button>
            <Button onClick={() => setPasso(3)}>Continuar</Button>
          </div>
        </section>
      )}

      {passo === 3 && !resultado && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Confirmar importação</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            <strong>{aSeremCriadas}</strong> associado(s) serão criados.{' '}
            <strong>{aSeremIgnoradas}</strong> linha(s) serão ignoradas (erro de
            validação ou duplicidade não resolvida para criação).
          </p>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" onClick={() => setPasso(2)}>
              Voltar
            </Button>
            <Button onClick={confirmarImportacao} disabled={carregando}>
              {carregando ? 'Importando…' : 'Confirmar importação'}
            </Button>
          </div>
        </section>
      )}

      {passo === 3 && resultado && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-semibold">Importação concluída</h2>
          <p className="mt-2 text-sm">
            {resultado.criados} criado(s), {resultado.ignorados} ignorado(s),{' '}
            {resultado.erros.length} erro(s).
          </p>
          {resultado.erros.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-destructive">
              {resultado.erros.map((e) => (
                <li key={e.indice}>
                  Linha {e.indice + 1}: {e.motivo}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Lote nº {resultado.id_lote}
          </p>
          {desfeito ? (
            <p className="mt-2 text-sm text-emerald-600">
              Lote desfeito — os associados criados por ele foram removidos.
            </p>
          ) : (
            resultado.criados > 0 && (
              <Button
                variant="destructive"
                className="mt-4"
                onClick={desfazerImportacao}
                disabled={carregando}
              >
                {carregando ? 'Desfazendo…' : 'Desfazer esta importação'}
              </Button>
            )
          )}
        </section>
      )}
    </>
  )
}
