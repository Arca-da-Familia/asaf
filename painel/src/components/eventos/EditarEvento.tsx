import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import {
  editarEvento,
  listarEspacos,
  listarOpcoesCatalogo,
  listarProjetos,
  type DadosDaEdicaoDoEvento,
  type Evento,
} from '@/lib/api'
import { classeAreaDeTexto, classeCampo } from '@/lib/campos'
import { paraDataHoraLocalInput, paraUtcIso } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'

// v5.5 - Editar evento. O formulário já vem com o que está cadastrado e só envia o que a pessoa MUDOU (o servidor só
// altera o que chega). Evento Público vai ao site: o texto passa pela conferência de dado pessoal e, se for recusado, o
// motivo (em português) aparece aqui em cima.
export function EditarEvento({
  evento,
  onFechar,
}: {
  evento: Evento
  onFechar: () => void
}) {
  const queryClient = useQueryClient()
  const { data: categorias } = useQuery({
    queryKey: ['opcoes-catalogo', 'tipo_evento'],
    queryFn: () => listarOpcoesCatalogo('tipo_evento'),
  })
  const { data: espacos } = useQuery({
    queryKey: ['espacos'],
    queryFn: listarEspacos,
  })
  const { data: projetos } = useQuery({
    queryKey: ['projetos'],
    queryFn: listarProjetos,
  })

  const [titulo, setTitulo] = useState(evento.titulo)
  const [descricao, setDescricao] = useState(evento.descricao ?? '')
  const [categoria, setCategoria] = useState(evento.categoria)
  const [inicio, setInicio] = useState(
    paraDataHoraLocalInput(evento.data_hora_inicio),
  )
  const [fim, setFim] = useState(
    evento.data_hora_fim ? paraDataHoraLocalInput(evento.data_hora_fim) : '',
  )
  const [idEspaco, setIdEspaco] = useState(
    evento.id_espaco != null ? String(evento.id_espaco) : '',
  )
  const [endereco, setEndereco] = useState(evento.endereco_avulso ?? '')
  const [vagas, setVagas] = useState(
    evento.vagas != null ? String(evento.vagas) : '',
  )
  const [visibilidade, setVisibilidade] = useState<'Pública' | 'Interna'>(
    evento.visibilidade === 'Pública' ? 'Pública' : 'Interna',
  )
  const [idProjeto, setIdProjeto] = useState(
    evento.id_projeto != null ? String(evento.id_projeto) : '',
  )
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const salvar = useMutation({
    mutationFn: (dados: DadosDaEdicaoDoEvento) =>
      editarEvento(evento.id_evento, dados),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      onFechar()
    },
    onError: (e) =>
      setErro(
        mensagemDoErro(e, 'Não foi possível salvar o evento. Tente de novo.'),
      ),
  })

  function enviar(evento_: FormEvent) {
    evento_.preventDefault()
    setErro(null)
    setAviso(null)

    if (titulo.trim().length < 3) {
      return setErro('Dê um título ao evento (pelo menos 3 letras).')
    }
    if (!categoria) return setErro('Escolha a categoria do evento.')
    if (!inicio) return setErro('Informe quando o evento começa.')
    if (fim && fim <= inicio) {
      return setErro('O fim do evento precisa ser depois do início.')
    }
    if (vagas.trim() !== '' && !/^[1-9]\d*$/.test(vagas.trim())) {
      return setErro(
        'As vagas precisam ser um número inteiro maior que zero (ou deixe em branco para não limitar).',
      )
    }

    // Só o que mudou. Campo de texto esvaziado vira `null` (some do cadastro).
    const dados: DadosDaEdicaoDoEvento = {}
    if (titulo.trim() !== evento.titulo) dados.titulo = titulo.trim()
    if ((descricao.trim() || null) !== (evento.descricao || null)) {
      dados.descricao = descricao.trim() || null
    }
    if (categoria !== evento.categoria) dados.categoria = categoria
    if (inicio !== paraDataHoraLocalInput(evento.data_hora_inicio)) {
      dados.data_hora_inicio = paraUtcIso(inicio)
    }
    const fimAtual = evento.data_hora_fim
      ? paraDataHoraLocalInput(evento.data_hora_fim)
      : ''
    if (fim !== fimAtual) dados.data_hora_fim = fim ? paraUtcIso(fim) : null
    if (
      idEspaco !== (evento.id_espaco != null ? String(evento.id_espaco) : '')
    ) {
      dados.id_espaco = idEspaco ? Number(idEspaco) : null
    }
    if ((endereco.trim() || null) !== (evento.endereco_avulso || null)) {
      dados.endereco_avulso = endereco.trim() || null
    }
    if (vagas.trim() !== (evento.vagas != null ? String(evento.vagas) : '')) {
      dados.vagas = vagas.trim() ? Number(vagas.trim()) : null
    }
    if (visibilidade !== evento.visibilidade) dados.visibilidade = visibilidade
    if (
      idProjeto !== (evento.id_projeto != null ? String(evento.id_projeto) : '')
    ) {
      dados.id_projeto = idProjeto ? Number(idProjeto) : null
    }

    if (Object.keys(dados).length === 0) {
      return setAviso('Nada foi alterado.')
    }
    salvar.mutate(dados)
  }

  const categoriaConhecida = (categorias ?? []).some(
    (c) => c.codigo === categoria,
  )
  const projetoConhecido = (projetos ?? []).some(
    (p) => String(p.id_projeto) === idProjeto,
  )

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Editar evento"
      className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
    >
      <h3 className="text-sm font-semibold sm:col-span-2">Editar evento</h3>
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

      <Campo rotulo="Título do evento" className="sm:col-span-2">
        <input
          className={classeCampo}
          value={titulo}
          maxLength={200}
          onChange={(e) => setTitulo(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Categoria">
        <select
          className={classeCampo}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          {!categoriaConhecida && (
            <option value={categoria}>{categoria}</option>
          )}
          {(categorias ?? []).map((o) => (
            <option key={o.codigo} value={o.codigo}>
              {o.rotulo}
            </option>
          ))}
        </select>
      </Campo>
      <Campo
        rotulo="Quem pode ver o evento"
        dica="Público: aparece no site da associação. Interno: só aparece aqui no painel."
      >
        <select
          className={classeCampo}
          value={visibilidade}
          onChange={(e) =>
            setVisibilidade(
              e.target.value === 'Pública' ? 'Pública' : 'Interna',
            )
          }
        >
          <option value="Interna">Interno</option>
          <option value="Pública">Público (site institucional)</option>
        </select>
      </Campo>
      <Campo rotulo="Início">
        <input
          type="datetime-local"
          className={classeCampo}
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Fim (opcional)">
        <input
          type="datetime-local"
          className={classeCampo}
          value={fim}
          onChange={(e) => setFim(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Espaço da associação (opcional)">
        <select
          className={classeCampo}
          value={idEspaco}
          onChange={(e) => setIdEspaco(e.target.value)}
        >
          <option value="">Sem espaço próprio</option>
          {(espacos ?? []).map((e) => (
            <option key={e.id_espaco} value={e.id_espaco}>
              {e.nome}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Ou endereço avulso (opcional)">
        <input
          className={classeCampo}
          value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
        />
      </Campo>
      <Campo rotulo="Vagas (opcional)" dica="Deixe em branco para não limitar.">
        <input
          type="number"
          min={1}
          className={classeCampo}
          value={vagas}
          onChange={(e) => setVagas(e.target.value)}
        />
      </Campo>
      <Campo
        rotulo="Projeto deste evento"
        dica="Escolha o projeto de que este evento faz parte (ex.: uma edição do Despertai)."
      >
        <select
          className={classeCampo}
          value={idProjeto}
          onChange={(e) => setIdProjeto(e.target.value)}
        >
          <option value="">Sem projeto</option>
          {idProjeto && !projetoConhecido && (
            <option value={idProjeto}>Projeto nº {idProjeto}</option>
          )}
          {(projetos ?? []).map((p) => (
            <option key={p.id_projeto} value={p.id_projeto}>
              {p.nome_projeto} (nº {p.id_projeto})
            </option>
          ))}
        </select>
      </Campo>
      <Campo
        rotulo="Descrição (opcional)"
        className="sm:col-span-2"
        dica={
          visibilidade === 'Pública'
            ? 'Evento Público: o título, a descrição e o local vão ao site e passam por conferência de dado pessoal. Não escreva telefone, e-mail nem documento de pessoas.'
            : undefined
        }
      >
        <textarea
          className={classeAreaDeTexto}
          rows={3}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />
      </Campo>

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
