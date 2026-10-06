import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  anonimizarVencidos,
  escanearDuplicidade,
  higienizarContatos,
  ignorarItemDaFila,
  listarFilaDeRevisao,
  mesclarPessoas,
  type SinalDeRevisao,
} from '@/lib/api'

const ROTULO_DO_SINAL: Record<string, string> = {
  duplicidade_nome_nascimento: 'Possível cadastro duplicado',
  contato_telefone_invalido: 'Telefone com formato inválido',
  contato_email_suspeito: 'E-mail suspeito (devolveu)',
}

const campoClasse =
  'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

// v1.8 no servidor, tela só na v5.4c (achado AO VIVO na homologação, 2026-10-05): o detector de duplicidade, a fila de revisão, a
// mesclagem, a higienização de telefone e a anonimização em lote eram rotas testadas que nenhuma tela chamava — a base nunca poderia ser
// limpa por quem cuida dela. Nada aqui acontece sozinho: o sistema só aponta, quem decide é uma pessoa.
export function QualidadeDaBasePage() {
  const queryClient = useQueryClient()
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoAnonimizar, setConfirmandoAnonimizar] = useState(false)

  const { data: fila, isLoading } = useQuery({
    queryKey: ['fila-revisao'],
    queryFn: listarFilaDeRevisao,
  })

  function depois(mensagem: string) {
    setErro(null)
    setAviso(mensagem)
    queryClient.invalidateQueries({ queryKey: ['fila-revisao'] })
    queryClient.invalidateQueries({ queryKey: ['associados'] })
  }
  function falhou(e: unknown) {
    setAviso(null)
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
  }

  const duplicidade = useMutation({
    mutationFn: escanearDuplicidade,
    onSuccess: (r) => depois(r.mensagem),
    onError: falhou,
  })
  const telefones = useMutation({
    mutationFn: higienizarContatos,
    onSuccess: (r) => depois(r.mensagem),
    onError: falhou,
  })
  const anonimizar = useMutation({
    mutationFn: anonimizarVencidos,
    onSuccess: (r) => {
      setConfirmandoAnonimizar(false)
      depois(r.mensagem)
    },
    onError: (e) => {
      setConfirmandoAnonimizar(false)
      falhou(e)
    },
  })

  return (
    <>
      <PageHeader
        titulo="Qualidade da base"
        descricao="O sistema aponta o que parece errado no cadastro; quem decide é uma pessoa. Nada é mesclado nem apagado sozinho."
        trilha={[
          { rotulo: 'Associados', href: '/associados' },
          { rotulo: 'Qualidade da base' },
        ]}
      />

      {aviso && (
        <p
          role="status"
          className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Procurar problemas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada busca coloca na fila abaixo o que encontrar; quem já estava na
          fila não é repetido.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={duplicidade.isPending}
            onClick={() => duplicidade.mutate()}
          >
            Procurar cadastros duplicados
          </Button>
          <Button
            variant="outline"
            disabled={telefones.isPending}
            onClick={() => telefones.mutate()}
          >
            Procurar telefones inválidos
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfirmandoAnonimizar(true)}
          >
            Anonimizar desligados com prazo vencido
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 font-semibold">Fila de revisão</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !fila?.length ? (
          <EmptyState
            icone={ShieldCheck}
            titulo="Nada na fila de revisão"
            descricao="Use os botões acima para procurar problemas no cadastro."
          />
        ) : (
          <ul className="v3-space-y-4">
            {fila.map((item) => (
              <ItemDaFila
                key={item.id_fila}
                item={item}
                aoConcluir={depois}
                aoFalhar={falhou}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        aberto={confirmandoAnonimizar}
        onAbertoChange={setConfirmandoAnonimizar}
        titulo="Anonimizar os desligados com prazo vencido?"
        descricao="Apaga de forma definitiva o CPF, o contato e o endereço de todo associado desligado cujo prazo de retenção já terminou (LGPD). Quem ainda está dentro do prazo não é tocado."
        rotuloConfirmar="Anonimizar agora"
        carregando={anonimizar.isPending}
        onConfirmar={() => anonimizar.mutate()}
      />
    </>
  )
}

// Dois cadastros duplicados costumam ter o MESMO nome: o que os distingue é ser associado (e a matrícula) ou só uma pessoa.
function quem(
  nome: string | null,
  eAssociado: boolean,
  matricula: number | null,
): string {
  return `${nome ?? '—'} (${eAssociado ? `associado, matrícula ${matricula ?? '—'}` : 'pessoa sem cadastro de associado'})`
}

function ItemDaFila({
  item,
  aoConcluir,
  aoFalhar,
}: {
  item: SinalDeRevisao
  aoConcluir: (mensagem: string) => void
  aoFalhar: (e: unknown) => void
}) {
  const [mesclando, setMesclando] = useState(false)
  const [manter, setManter] = useState<'a' | 'b'>('a')
  const [nomeDeConfirmacao, setNomeDeConfirmacao] = useState('')
  const ehDuplicidade = item.id_pessoa_b !== null

  const a = quem(item.nome_pessoa_a, item.e_associado_a, item.matricula_a)
  const b = quem(item.nome_pessoa_b, item.e_associado_b, item.matricula_b)
  const nomeMantido = manter === 'a' ? a : b
  const nomeAbsorvido = manter === 'a' ? b : a

  const ignorar = useMutation({
    mutationFn: () => ignorarItemDaFila(item.id_fila),
    onSuccess: (r) => aoConcluir(r.mensagem),
    onError: aoFalhar,
  })
  const mesclar = useMutation({
    mutationFn: () =>
      mesclarPessoas(manter === 'a' ? item.id_pessoa_a : item.id_pessoa_b!, {
        id_pessoa_absorvida:
          manter === 'a' ? item.id_pessoa_b! : item.id_pessoa_a,
        nome_confirmacao: nomeDeConfirmacao,
      }),
    onSuccess: (r) => aoConcluir(r.mensagem),
    onError: aoFalhar,
  })

  return (
    <li
      className="rounded-lg border border-border p-4"
      aria-label={`${ROTULO_DO_SINAL[item.tipo_sinal] ?? item.tipo_sinal}: ${item.nome_pessoa_a ?? ''}`}
    >
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {ROTULO_DO_SINAL[item.tipo_sinal] ?? item.tipo_sinal}
      </p>
      <p className="mt-1 text-sm font-medium">
        {a}
        {ehDuplicidade && <span className="font-normal"> e </span>}
        {ehDuplicidade && b}
      </p>
      {item.detalhe && (
        <p className="text-xs text-muted-foreground">{item.detalhe}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {ehDuplicidade && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMesclando((v) => !v)}
          >
            Mesclar os dois cadastros
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={ignorar.isPending}
          onClick={() => ignorar.mutate()}
        >
          {ehDuplicidade
            ? 'Não é duplicado — ignorar'
            : 'Já resolvido — ignorar'}
        </Button>
      </div>

      {mesclando && ehDuplicidade && (
        <div className="mt-4 rounded-lg border border-destructive/30 p-4">
          <fieldset>
            <legend className="text-sm font-medium">
              Qual cadastro fica? O outro é absorvido (o histórico dele passa
              para o que fica).
            </legend>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`manter-${item.id_fila}`}
                checked={manter === 'a'}
                onChange={() => setManter('a')}
              />
              Manter {a}
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`manter-${item.id_fila}`}
                checked={manter === 'b'}
                onChange={() => setManter('b')}
              />
              Manter {b}
            </label>
          </fieldset>
          <p className="mt-3 text-sm">
            <strong>Irreversível.</strong> {nomeAbsorvido} deixa de existir e
            tudo dela passa para {nomeMantido}.
          </p>
          <label
            htmlFor={`confirmacao-${item.id_fila}`}
            className="mt-3 block text-sm font-medium"
          >
            Digite o nome de quem será absorvido para confirmar
          </label>
          <input
            id={`confirmacao-${item.id_fila}`}
            value={nomeDeConfirmacao}
            onChange={(e) => setNomeDeConfirmacao(e.target.value)}
            className={campoClasse}
          />
          <Button
            variant="destructive"
            className="mt-3"
            disabled={mesclar.isPending || !nomeDeConfirmacao.trim()}
            onClick={() => mesclar.mutate()}
          >
            Mesclar (irreversível)
          </Button>
        </div>
      )}
    </li>
  )
}
