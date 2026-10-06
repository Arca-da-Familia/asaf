import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  cadastrarFuncionario,
  listarFuncionarios,
  marcarContatoSuspeito,
  obterTermoVigente,
  redefinirSegundoPasso,
  registrarTermoDeVoluntario,
} from '@/lib/api'
import { formatarData } from '@/lib/datas'
import { useMe } from '@/lib/use-me'

const campoClasse =
  'mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

type Formulario = null | 'termo' | 'funcionario' | 'email'

// v1.6 e v1.8 no servidor, tela só na v5.4c (achado AO VIVO na homologação, 2026-10-05): o termo de adesão de voluntário (Lei 9.608), o
// cadastro de funcionário, o aviso de e-mail devolvido e o reset do segundo passo eram rotas testadas que nenhuma tela chamava.
export function VinculosDaPessoa({
  idPessoa,
  idUsuario,
  nome,
}: {
  idPessoa: number
  idUsuario: number | null
  nome: string
}) {
  const queryClient = useQueryClient()
  const { data: eu } = useMe()
  const [formulario, setFormulario] = useState<Formulario>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoReset, setConfirmandoReset] = useState(false)

  // campos dos formulários
  const [atividade, setAtividade] = useState('')
  const [carga, setCarga] = useState('')
  const [local, setLocal] = useState('')
  const [inicio, setInicio] = useState(hoje())
  const [fim, setFim] = useState('')
  const [documento, setDocumento] = useState('')
  const [autorizacao, setAutorizacao] = useState('')
  const [cargo, setCargo] = useState('')
  const [admissao, setAdmissao] = useState(hoje())
  const [motivo, setMotivo] = useState('')

  const { data: termo, isLoading: carregandoTermo } = useQuery({
    queryKey: ['termo-voluntario', idPessoa],
    queryFn: () => obterTermoVigente(idPessoa),
  })
  const { data: funcionarios, isLoading: carregandoFuncionarios } = useQuery({
    queryKey: ['funcionarios'],
    queryFn: listarFuncionarios,
  })
  const funcionario = funcionarios?.find((f) => f.id_pessoa === idPessoa)
  const podeRedefinirAcesso = !!eu?.permissoes.includes('gerenciar_acesso')

  function concluir(mensagem: string, invalidar: unknown[]) {
    setErro(null)
    setAviso(mensagem)
    setFormulario(null)
    queryClient.invalidateQueries({ queryKey: invalidar })
  }
  function falhar(e: unknown) {
    setAviso(null)
    setErro(e instanceof Error ? e.message : 'Não foi possível concluir.')
    setConfirmandoReset(false)
  }

  const registrarTermo = useMutation({
    mutationFn: () =>
      registrarTermoDeVoluntario(idPessoa, {
        atividade,
        carga_horaria_semanal: Number(carga.replace(',', '.')),
        local: local || undefined,
        data_inicio: inicio,
        data_fim_vigencia: fim,
        documento_referencia: documento || undefined,
        autorizacao_responsavel_referencia: autorizacao || undefined,
      }),
    onSuccess: (r) =>
      concluir(`${r.mensagem} Versão ${r.versao}.`, [
        'termo-voluntario',
        idPessoa,
      ]),
    onError: falhar,
  })
  const novoFuncionario = useMutation({
    mutationFn: () =>
      cadastrarFuncionario(idPessoa, { cargo, data_admissao: admissao }),
    onSuccess: (r) => concluir(r.mensagem, ['funcionarios']),
    onError: falhar,
  })
  const emailSuspeito = useMutation({
    mutationFn: () => marcarContatoSuspeito(idPessoa, motivo),
    onSuccess: (r) => concluir(r.mensagem, ['fila-revisao']),
    onError: falhar,
  })
  const reset = useMutation({
    mutationFn: () => redefinirSegundoPasso(idUsuario!),
    onSuccess: (r) => {
      setConfirmandoReset(false)
      concluir(r.mensagem, ['associado'])
    },
    onError: falhar,
  })

  function validar(campos: Record<string, string>): boolean {
    const faltando = Object.entries(campos).filter(([, v]) => !v.trim())
    if (faltando.length) {
      setAviso(null)
      setErro(`Preencha: ${faltando.map(([k]) => k).join(', ')}.`)
      return false
    }
    return true
  }

  return (
    <div className="v3-space-y-6">
      {aviso && (
        <p
          role="status"
          className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm"
        >
          {aviso}
        </p>
      )}
      {erro && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {erro}
        </p>
      )}

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Voluntário</h2>
            {carregandoTermo ? (
              <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
            ) : termo?.vigente ? (
              <p className="mt-1 text-sm" data-testid="termo-vigente">
                Termo de adesão vigente: <strong>{termo.atividade}</strong>,{' '}
                {termo.carga_horaria_semanal} h por semana, até{' '}
                {formatarData(termo.data_fim_vigencia.slice(0, 10))} (versão{' '}
                {termo.versao}).
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Sem termo de adesão vigente: sem ele, a pessoa não pode
                registrar horas de voluntariado.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setFormulario(formulario === 'termo' ? null : 'termo')
            }
          >
            {termo?.vigente
              ? 'Renovar termo de adesão'
              : 'Registrar termo de adesão'}
          </Button>
        </div>
        {formulario === 'termo' && (
          <form
            className="mt-4 grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (
                validar({
                  Atividade: atividade,
                  'Carga horária': carga,
                  Início: inicio,
                  Fim: fim,
                })
              )
                registrarTermo.mutate()
            }}
          >
            <div>
              <label htmlFor="termo-atividade" className="text-sm font-medium">
                Atividade *
              </label>
              <input
                id="termo-atividade"
                value={atividade}
                onChange={(e) => setAtividade(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div>
              <label htmlFor="termo-carga" className="text-sm font-medium">
                Carga horária semanal *
              </label>
              <input
                id="termo-carga"
                inputMode="decimal"
                value={carga}
                onChange={(e) => setCarga(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div>
              <label htmlFor="termo-inicio" className="text-sm font-medium">
                Início da vigência *
              </label>
              <input
                id="termo-inicio"
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div>
              <label htmlFor="termo-fim" className="text-sm font-medium">
                Fim da vigência *
              </label>
              <input
                id="termo-fim"
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div>
              <label htmlFor="termo-local" className="text-sm font-medium">
                Local
              </label>
              <input
                id="termo-local"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div>
              <label htmlFor="termo-documento" className="text-sm font-medium">
                Documento de referência
              </label>
              <input
                id="termo-documento"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="termo-autorizacao"
                className="text-sm font-medium"
              >
                Autorização do responsável (referência)
              </label>
              <input
                id="termo-autorizacao"
                value={autorizacao}
                onChange={(e) => setAutorizacao(e.target.value)}
                placeholder="Ex.: documento anexado, número do protocolo"
                className={campoClasse}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Obrigatória se a pessoa for menor de idade ou se a data de
                nascimento ainda não estiver no cadastro (sem ela não dá para
                provar a maioridade).
              </p>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={registrarTermo.isPending}>
                Confirmar termo de adesão
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Funcionário</h2>
            {carregandoFuncionarios ? (
              <p className="mt-1 text-sm text-muted-foreground">Carregando…</p>
            ) : funcionario ? (
              <p className="mt-1 text-sm" data-testid="funcionario-cadastrado">
                Cadastrado(a) como <strong>{funcionario.cargo}</strong>,
                admitido(a) em{' '}
                {formatarData(funcionario.data_admissao.slice(0, 10))}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                Não é funcionário(a). O cadastro aqui é mínimo (sem folha, ponto
                nem eSocial).
              </p>
            )}
          </div>
          {!funcionario && !carregandoFuncionarios && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFormulario(
                  formulario === 'funcionario' ? null : 'funcionario',
                )
              }
            >
              Cadastrar como funcionário(a)
            </Button>
          )}
        </div>
        {formulario === 'funcionario' && (
          <form
            className="mt-4 grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (validar({ Cargo: cargo, Admissão: admissao }))
                novoFuncionario.mutate()
            }}
          >
            <div>
              <label htmlFor="func-cargo" className="text-sm font-medium">
                Cargo *
              </label>
              <input
                id="func-cargo"
                value={cargo}
                onChange={(e) => setCargo(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div>
              <label htmlFor="func-admissao" className="text-sm font-medium">
                Data de admissão *
              </label>
              <input
                id="func-admissao"
                type="date"
                value={admissao}
                onChange={(e) => setAdmissao(e.target.value)}
                className={campoClasse}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={novoFuncionario.isPending}>
                Confirmar cadastro de funcionário(a)
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-semibold">Contato e acesso</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setFormulario(formulario === 'email' ? null : 'email')
            }
          >
            Marcar e-mail como suspeito (devolveu)
          </Button>
          {podeRedefinirAcesso && idUsuario !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmandoReset(true)}
            >
              Redefinir o segundo passo (MFA)
            </Button>
          )}
        </div>
        {idUsuario === null && (
          <p className="mt-2 text-sm text-muted-foreground">
            Esta pessoa ainda não tem acesso ao painel.
          </p>
        )}
        {formulario === 'email' && (
          <form
            className="mt-4 rounded-lg border border-border p-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (validar({ Motivo: motivo })) emailSuspeito.mutate()
            }}
          >
            <label htmlFor="email-motivo" className="text-sm font-medium">
              O que aconteceu? *
            </label>
            <input
              id="email-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: a mensagem voltou como endereço inexistente"
              className={campoClasse}
            />
            <Button
              type="submit"
              className="mt-3"
              disabled={emailSuspeito.isPending}
            >
              Confirmar e-mail suspeito
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Vai para a fila de revisão da Qualidade da base.
            </p>
          </form>
        )}
      </section>

      <ConfirmDialog
        aberto={confirmandoReset}
        onAbertoChange={setConfirmandoReset}
        titulo={`Redefinir o segundo passo de ${nome}?`}
        descricao="Remove o autenticador atual desta pessoa e os códigos de recuperação dela. No próximo acesso ela terá de configurar tudo de novo. Use quando ela perder o celular. Fica registrado na Auditoria."
        rotuloConfirmar="Redefinir segundo passo"
        carregando={reset.isPending}
        onConfirmar={() => reset.mutate()}
      />
    </div>
  )
}
