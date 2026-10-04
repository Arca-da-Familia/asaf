import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import {
  editarProjeto,
  listarOpcoesCatalogo,
  type DadosDaEdicaoDoProjeto,
  type Projeto,
} from '@/lib/api'
import { classeAreaDeTexto, classeCampo } from '@/lib/campos'
import { diaDoProjeto } from '@/lib/contexto'
import { mensagemDoErro } from '@/lib/erro-da-api'

// v5.5 - Editar projeto. Já vem com o que está cadastrado e só envia o que a pessoa MUDOU. Projeto Público vai ao site
// (nome, descrição e público-alvo) e passa pela conferência de dado pessoal; se o servidor recusar, o motivo (em
// português) aparece aqui em cima. O destaque na página inicial só existe para projeto Público.
export function EditarProjeto({
  projeto,
  onFechar,
}: {
  projeto: Projeto
  onFechar: () => void
}) {
  const queryClient = useQueryClient()
  const { data: tiposProjeto } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_projeto'],
    queryFn: () => listarOpcoesCatalogo('tipo_projeto'),
  })

  const [nome, setNome] = useState(projeto.nome_projeto)
  const [tipo, setTipo] = useState(projeto.tipo_projeto ?? '')
  const [descricao, setDescricao] = useState(projeto.descricao ?? '')
  const [publicoAlvo, setPublicoAlvo] = useState(projeto.publico_alvo ?? '')
  const [inicio, setInicio] = useState(diaDoProjeto(projeto.data_inicio))
  const [fim, setFim] = useState(diaDoProjeto(projeto.data_fim_prevista))
  const [visibilidade, setVisibilidade] = useState<'Pública' | 'Interna'>(
    projeto.visibilidade === 'Pública' ? 'Pública' : 'Interna',
  )
  const [destaque, setDestaque] = useState(projeto.destaque_no_site)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const publico = visibilidade === 'Pública'

  const salvar = useMutation({
    mutationFn: (dados: DadosDaEdicaoDoProjeto) =>
      editarProjeto(projeto.id_projeto, dados),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projetos'] })
      onFechar()
    },
    onError: (e) =>
      setErro(
        mensagemDoErro(e, 'Não foi possível salvar o projeto. Tente de novo.'),
      ),
  })

  function mudarVisibilidade(nova: 'Pública' | 'Interna') {
    setVisibilidade(nova)
    // Projeto Interno nunca fica em destaque: o servidor recusaria a combinação.
    if (nova !== 'Pública') setDestaque(false)
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault()
    setErro(null)
    setAviso(null)

    if (nome.trim().length < 3) {
      return setErro('Dê um nome ao projeto (pelo menos 3 letras).')
    }
    if (!inicio) return setErro('Informe a data de início.')
    if (!fim) return setErro('Informe a data de fim prevista.')
    if (fim < inicio) {
      return setErro('A data de fim precisa ser depois da data de início.')
    }

    // Só o que mudou. Campo de texto esvaziado vira `null` (some do cadastro).
    const dados: DadosDaEdicaoDoProjeto = {}
    if (nome.trim() !== projeto.nome_projeto) dados.nome_projeto = nome.trim()
    if ((tipo || null) !== (projeto.tipo_projeto || null)) {
      dados.tipo_projeto = tipo || null
    }
    if ((descricao.trim() || null) !== (projeto.descricao || null)) {
      dados.descricao = descricao.trim() || null
    }
    if ((publicoAlvo.trim() || null) !== (projeto.publico_alvo || null)) {
      dados.publico_alvo = publicoAlvo.trim() || null
    }
    if (inicio !== diaDoProjeto(projeto.data_inicio)) dados.data_inicio = inicio
    if (fim !== diaDoProjeto(projeto.data_fim_prevista)) {
      dados.data_fim_prevista = fim
    }
    if (visibilidade !== projeto.visibilidade) dados.visibilidade = visibilidade
    if (destaque !== projeto.destaque_no_site) dados.destaque_no_site = destaque

    if (Object.keys(dados).length === 0) {
      return setAviso('Nada foi alterado.')
    }
    salvar.mutate(dados)
  }

  const tipoConhecido = (tiposProjeto ?? []).some((o) => o.codigo === tipo)

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Editar projeto"
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <h3 className="text-sm font-semibold sm:col-span-2">Editar projeto</h3>
      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
        >
          {erro}
        </p>
      )}
      {aviso && (
        <p
          role="status"
          className="text-sm text-muted-foreground sm:col-span-2"
        >
          {aviso}
        </p>
      )}

      <Campo rotulo="Nome do projeto" className="sm:col-span-2">
        <input
          className={classeCampo}
          value={nome}
          maxLength={200}
          onChange={(e) => setNome(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Tipo de projeto (opcional)">
        <select
          className={classeCampo}
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          <option value="">Sem tipo</option>
          {tipo && !tipoConhecido && <option value={tipo}>{tipo}</option>}
          {(tiposProjeto ?? []).map((o) => (
            <option key={o.codigo} value={o.codigo}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo
        rotulo="Quem pode ver o projeto"
        dica="Público: aparece no site da associação. Interno: só aparece aqui no painel."
      >
        <select
          className={classeCampo}
          value={visibilidade}
          onChange={(e) =>
            mudarVisibilidade(
              e.target.value === 'Pública' ? 'Pública' : 'Interna',
            )
          }
        >
          <option value="Interna">Interno</option>
          <option value="Pública">Público (site institucional)</option>
        </select>
      </Campo>
      <Campo rotulo="Data de início">
        <input
          type="date"
          className={classeCampo}
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Data de fim prevista">
        <input
          type="date"
          className={classeCampo}
          value={fim}
          onChange={(e) => setFim(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Público-alvo (opcional)" className="sm:col-span-2">
        <input
          className={classeCampo}
          value={publicoAlvo}
          onChange={(e) => setPublicoAlvo(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Descrição (opcional)" className="sm:col-span-2">
        <textarea
          className={classeAreaDeTexto}
          rows={3}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </Campo>

      <div className="space-y-1 sm:col-span-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={destaque}
            disabled={!publico}
            onChange={(e) => setDestaque(e.target.checked)}
          />
          <span>
            <strong>Mostrar em destaque na página inicial do site.</strong>{' '}
            {publico
              ? 'Use para o projeto principal da associação.'
              : 'Só projeto Público pode ficar em destaque: mude a visibilidade para Público.'}
          </span>
        </label>
        {publico && (
          <p className="text-xs text-muted-foreground">
            Projeto Público: o nome, a descrição e o público-alvo vão ao site e
            passam por conferência de dado pessoal. Não escreva telefone, e-mail
            nem documento de pessoas.
          </p>
        )}
      </div>

      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
