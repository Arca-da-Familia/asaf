import { useState, type FormEvent } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import { classeAreaDeTexto, classeCampo } from '@/lib/campos'
import { lerValorEmReais, type Opcoes, type Parceria } from '@/lib/parcerias'

type Entrada = {
  tipo: string
  ano: string
  titulo: string
  objeto: string
  esfera: string
  orgao_concedente: string
  numero_emenda: string
  identificador_unico: string
  proponente: string
  numero_termo: string
  valor_total: string
  data_assinatura: string
  vigencia_inicio: string
  vigencia_fim: string
  situacao: string
}

function inicialDe(p?: Parceria): Entrada {
  return {
    tipo: p?.tipo ?? 'EMENDA',
    ano: String(p?.ano ?? new Date().getFullYear()),
    titulo: p?.titulo ?? '',
    objeto: p?.objeto ?? '',
    esfera: p?.esfera ?? 'Municipal',
    orgao_concedente: p?.orgao_concedente ?? '',
    numero_emenda: p?.numero_emenda ?? '',
    identificador_unico: p?.identificador_unico ?? '',
    proponente: p?.proponente ?? '',
    numero_termo: p?.numero_termo ?? '',
    valor_total: p
      ? p.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      : '',
    data_assinatura: p?.data_assinatura ?? '',
    vigencia_inicio: p?.vigencia_inicio ?? '',
    vigencia_fim: p?.vigencia_fim ?? '',
    situacao: p?.situacao ?? 'Proposta',
  }
}

// v5.4a - cadastro e edição da parceria/emenda. Tudo que está aqui (exceto a situação) pode ir ao site depois que o
// Presidente ou o Secretário aprovar: por isso o servidor recusa CPF, RG, e-mail pessoal e celular nestes textos.
export function FormularioDaParceria({
  inicial,
  opcoes,
  rotuloDoBotao,
  enviando,
  onSalvar,
  onCancelar,
}: {
  inicial?: Parceria
  opcoes: Opcoes | undefined
  rotuloDoBotao: string
  enviando: boolean
  onSalvar: (dados: Record<string, unknown>) => Promise<void> | void
  onCancelar?: () => void
}) {
  const [v, setV] = useState<Entrada>(() => inicialDe(inicial))
  const [erro, setErro] = useState<string | null>(null)

  function campo<K extends keyof Entrada>(chave: K, valor: Entrada[K]) {
    setV((atual) => ({ ...atual, [chave]: valor }))
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)
    const valor = lerValorEmReais(v.valor_total)
    if (v.titulo.trim().length < 3) {
      return setErro('Dê um título à parceria (pelo menos 3 letras).')
    }
    if (v.objeto.trim().length < 10) {
      return setErro(
        'Descreva o objeto (o que será feito), com pelo menos 10 letras.',
      )
    }
    if (!valor) {
      return setErro('Informe o valor total em reais, por exemplo 50.000,00.')
    }
    const ano = Number(v.ano)
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
      return setErro('Informe o ano (entre 2000 e 2100).')
    }
    const vazioVira = (t: string) => (t.trim() === '' ? null : t.trim())
    void onSalvar({
      tipo: v.tipo,
      ano,
      titulo: v.titulo.trim(),
      objeto: v.objeto.trim(),
      esfera: vazioVira(v.esfera),
      orgao_concedente: vazioVira(v.orgao_concedente),
      numero_emenda: vazioVira(v.numero_emenda),
      identificador_unico: vazioVira(v.identificador_unico),
      proponente: vazioVira(v.proponente),
      numero_termo: vazioVira(v.numero_termo),
      valor_total: valor,
      data_assinatura: vazioVira(v.data_assinatura),
      vigencia_inicio: vazioVira(v.vigencia_inicio),
      vigencia_fim: vazioVira(v.vigencia_fim),
      ...(inicial ? { situacao: v.situacao } : {}),
    })
  }

  return (
    <form onSubmit={enviar} className="max-w-3xl space-y-5" noValidate>
      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Tipo">
          <select
            className={classeCampo}
            value={v.tipo}
            onChange={(e) => campo('tipo', e.target.value)}
          >
            {opcoes?.tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Ano">
          <input
            type="number"
            className={classeCampo}
            value={v.ano}
            onChange={(e) => campo('ano', e.target.value)}
          />
        </Campo>
        <Campo rotulo="Esfera">
          <select
            className={classeCampo}
            value={v.esfera}
            onChange={(e) => campo('esfera', e.target.value)}
          >
            <option value="">Não informada</option>
            {opcoes?.esferas.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <Campo
        rotulo="Título"
        dica="Aparece no site. Ex.: Emenda 123/2026 — Oficinas de música"
      >
        <input
          className={classeCampo}
          value={v.titulo}
          maxLength={200}
          onChange={(e) => campo('titulo', e.target.value)}
        />
      </Campo>

      <Campo
        rotulo="Objeto (o que será feito)"
        dica="Aparece no site. Não escreva CPF, RG, telefone ou e-mail de pessoas."
      >
        <textarea
          className={classeAreaDeTexto}
          value={v.objeto}
          onChange={(e) => campo('objeto', e.target.value)}
        />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Órgão concedente (secretaria que repassa)">
          <input
            className={classeCampo}
            value={v.orgao_concedente}
            onChange={(e) => campo('orgao_concedente', e.target.value)}
          />
        </Campo>
        <Campo rotulo="Proponente (vereador ou parlamentar autor)">
          <input
            className={classeCampo}
            value={v.proponente}
            onChange={(e) => campo('proponente', e.target.value)}
          />
        </Campo>
        <Campo rotulo="Número da emenda">
          <input
            className={classeCampo}
            value={v.numero_emenda}
            onChange={(e) => campo('numero_emenda', e.target.value)}
          />
        </Campo>
        <Campo
          rotulo="Identificador único da emenda"
          dica="O código que o órgão deu à emenda. Não pode repetir."
        >
          <input
            className={classeCampo}
            value={v.identificador_unico}
            onChange={(e) => campo('identificador_unico', e.target.value)}
          />
        </Campo>
        <Campo rotulo="Número do termo (fomento / colaboração)">
          <input
            className={classeCampo}
            value={v.numero_termo}
            onChange={(e) => campo('numero_termo', e.target.value)}
          />
        </Campo>
        <Campo
          rotulo="Valor total (R$)"
          dica="O quanto a parceria vale. O que já entrou e saiu vem do livro-caixa."
        >
          <input
            inputMode="decimal"
            className={classeCampo}
            value={v.valor_total}
            placeholder="50.000,00"
            onChange={(e) => campo('valor_total', e.target.value)}
          />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Data da assinatura">
          <input
            type="date"
            className={classeCampo}
            value={v.data_assinatura}
            onChange={(e) => campo('data_assinatura', e.target.value)}
          />
        </Campo>
        <Campo rotulo="Vigência: início">
          <input
            type="date"
            className={classeCampo}
            value={v.vigencia_inicio}
            onChange={(e) => campo('vigencia_inicio', e.target.value)}
          />
        </Campo>
        <Campo rotulo="Vigência: fim">
          <input
            type="date"
            className={classeCampo}
            value={v.vigencia_fim}
            onChange={(e) => campo('vigencia_fim', e.target.value)}
          />
        </Campo>
      </div>

      {inicial && (
        <Campo
          rotulo="Situação da parceria"
          dica="Termo assinado, em execução, em prestação de contas e concluída exigem o número do termo; concluída exige a prestação de contas final apresentada."
        >
          <select
            className={classeCampo}
            value={v.situacao}
            onChange={(e) => campo('situacao', e.target.value)}
          >
            {opcoes?.situacoes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Campo>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={enviando}>
          {enviando ? 'Salvando…' : rotuloDoBotao}
        </Button>
        {onCancelar && (
          <Button type="button" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  )
}
