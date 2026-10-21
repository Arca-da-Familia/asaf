import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Campo } from '@/components/forms/Campo'
import { Button } from '@/components/ui/button'
import {
  alterarStatusDoEvento,
  type DadosDaMudancaDeStatusDoEvento,
  type Evento,
  type ResultadoDaMudancaDeStatusDoEvento,
} from '@/lib/api'
import { classeAreaDeTexto, classeCampo } from '@/lib/campos'
import {
  comoUtc,
  formatarData,
  paraDataHoraLocalInput,
  paraInstante,
  paraUtcIso,
} from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'

// v5.5d - Situação do evento: Programado, Adiado, Cancelado ou Realizado, sempre com o texto (a cor só reforça). Aqui a
// secretaria vê a situação (e o motivo) e a muda: adiar, cancelar, remarcar, reativar, marcar como realizado. O SERVIDOR
// é quem decide as regras; este formulário só impede o erro óbvio antes de enviar (mesmas regras e mesmas palavras) e
// mostra o que o servidor recusar. Quem está inscrito é avisado por e-mail (um aviso por endereço); a inscrição em si
// NÃO é cancelada pelo sistema.

// `retomar` = o evento adiado volta para a data original (sem remarcar); `reativar` = o cancelado volta a ser programado.
type Acao =
  'adiar' | 'cancelar' | 'remarcar' | 'realizado' | 'reativar' | 'retomar'

const TAMANHO_MINIMO_DO_MOTIVO = 5

// Fundo claro com texto escuro da mesma família (contraste bem acima de 4,5:1), como os selos de documento.
const CLASSE_DO_STATUS: Record<string, string> = {
  Programado: 'bg-green-100 text-green-900',
  Adiado: 'bg-amber-100 text-amber-900',
  Cancelado: 'bg-red-100 text-red-900',
  Realizado: 'bg-blue-100 text-blue-900',
}

export function SeloDoStatusDoEvento({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CLASSE_DO_STATUS[status] ?? 'bg-muted text-muted-foreground'}`}
    >
      {status}
    </span>
  )
}

const TITULO_DO_FORMULARIO: Record<Acao, string> = {
  adiar: 'Adiar o evento',
  cancelar: 'Cancelar o evento',
  remarcar: 'Remarcar o evento',
  realizado: 'Marcar o evento como realizado',
  reativar: 'Reativar o evento',
  retomar: 'Voltar para a data original',
}

// Os botões de cada situação (o que a regra do servidor permite a partir dela). Realizado não tem nenhum. Um evento
// adiado só pode "voltar para a data original" enquanto essa data ainda não passou (`dataOriginalNoFuturo`).
function botoesDaSituacao(
  status: string,
  dataOriginalNoFuturo: boolean,
): { acao: Acao; rotulo: string }[] {
  if (status === 'Programado') {
    return [
      { acao: 'adiar', rotulo: 'Adiar' },
      { acao: 'cancelar', rotulo: 'Cancelar evento' },
      { acao: 'remarcar', rotulo: 'Remarcar' },
      { acao: 'realizado', rotulo: 'Marcar como realizado' },
    ]
  }
  if (status === 'Adiado') {
    return [
      ...(dataOriginalNoFuturo
        ? [{ acao: 'retomar' as const, rotulo: 'Voltar para a data original' }]
        : []),
      { acao: 'remarcar', rotulo: 'Remarcar (definir nova data)' },
      { acao: 'cancelar', rotulo: 'Cancelar evento' },
    ]
  }
  if (status === 'Cancelado') {
    return [{ acao: 'reativar', rotulo: 'Reativar o evento' }]
  }
  return []
}

export function StatusDoEvento({
  evento,
  podeAlterar,
}: {
  evento: Evento
  podeAlterar: boolean
}) {
  const queryClient = useQueryClient()
  const idDica = useId()
  const [acao, setAcao] = useState<Acao | null>(null)
  const [motivo, setMotivo] = useState('')
  const [inicio, setInicio] = useState('')
  const [fim, setFim] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] =
    useState<ResultadoDaMudancaDeStatusDoEvento | null>(null)
  const confirmacaoRef = useRef<HTMLParagraphElement>(null)

  // "Já começou?" decide o botão "Marcar como realizado" e se reativar pede data nova; reavaliado a cada 30 s para a
  // tela aberta antes do início destravar sozinha.
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(relogio)
  }, [])
  const comecou = paraInstante(evento.data_hora_inicio).getTime() <= agora

  useEffect(() => {
    if (confirmando) confirmacaoRef.current?.focus()
  }, [confirmando])

  const mudar = useMutation({
    mutationFn: (dados: DadosDaMudancaDeStatusDoEvento) =>
      alterarStatusDoEvento(evento.id_evento, dados),
    onSuccess: (resposta) => {
      queryClient.invalidateQueries({ queryKey: ['eventos'] })
      // remarcar leva a programação junto
      queryClient.invalidateQueries({
        queryKey: ['sessoes-evento', evento.id_evento],
      })
      setResultado(resposta)
      setAcao(null)
      setConfirmando(false)
      setErro(null)
    },
    onError: (e) => {
      // volta ao primeiro passo: o motivo pode ser o que o servidor recusou (ex.: telefone no texto)
      setConfirmando(false)
      setErro(
        mensagemDoErro(
          e,
          'Não foi possível mudar a situação do evento. Tente de novo.',
        ),
      )
    },
  })

  function abrir(nova: Acao) {
    setResultado(null)
    setErro(null)
    setConfirmando(false)
    if (acao === nova) {
      setAcao(null)
      return
    }
    setAcao(nova)
    setMotivo('')
    setInicio('')
    setFim('')
  }

  function voltar() {
    setErro(null)
    if (confirmando) setConfirmando(false)
    else setAcao(null)
  }

  const publico = evento.visibilidade === 'Pública'
  const pedeMotivoObrigatorio = acao === 'adiar' || acao === 'cancelar'
  // retomar (adiado) e reativar (cancelado) sem data passada voltam na mesma data e não levam motivo; remarcar e
  // reativar-com-data-nova levam motivo opcional
  const pedeData = acao === 'remarcar' || (acao === 'reativar' && comecou)

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (!acao || mudar.isPending) return
    setErro(null)

    if (pedeMotivoObrigatorio) {
      if (motivo.trim().length < TAMANHO_MINIMO_DO_MOTIVO) {
        return setErro(
          `Diga o motivo do ${acao === 'cancelar' ? 'cancelamento' : 'adiamento'}: pelo menos ${TAMANHO_MINIMO_DO_MOTIVO} letras.`,
        )
      }
      if (acao === 'cancelar' && !confirmando) {
        // cancelar tem dois passos: primeiro o motivo, depois a confirmação
        return setConfirmando(true)
      }
      return mudar.mutate({
        status: acao === 'cancelar' ? 'Cancelado' : 'Adiado',
        motivo: motivo.trim(),
      })
    }

    if (acao === 'realizado') return mudar.mutate({ status: 'Realizado' })

    if (!pedeData) return mudar.mutate({ status: 'Programado' })

    if (!inicio) return setErro('Informe a nova data de início do evento.')
    if (new Date(inicio).getTime() <= Date.now()) {
      return setErro('A nova data precisa estar no futuro.')
    }
    // Só um evento que JÁ está Programado recusa a mesma data (não há o que remarcar). Adiado e cancelado podem escolher a
    // data de antes: o servidor trata como a retomada na mesma data.
    const mesmaDataDeAntes =
      inicio === paraDataHoraLocalInput(evento.data_hora_inicio)
    if (evento.status === 'Programado' && mesmaDataDeAntes) {
      return setErro('A nova data é igual à atual: não há o que remarcar.')
    }
    if (fim && fim <= inicio) {
      return setErro('O fim do evento precisa ser depois do início.')
    }
    const dados: DadosDaMudancaDeStatusDoEvento = {
      status: 'Programado',
      // O campo só tem minutos; para "a mesma data" vai o começo EXATO de antes (com os segundos), senão o servidor
      // veria uma diferença de segundos e trataria como remarcação.
      nova_data_hora_inicio: mesmaDataDeAntes
        ? comoUtc(evento.data_hora_inicio)
        : paraUtcIso(inicio),
    }
    if (fim) dados.nova_data_hora_fim = paraUtcIso(fim)
    if (motivo.trim()) dados.motivo = motivo.trim()
    return mudar.mutate(dados)
  }

  const botoes = podeAlterar ? botoesDaSituacao(evento.status, !comecou) : []
  const avisos = resultado?.avisos ?? null
  const dicaDoMotivo = publico
    ? 'Em evento público, este motivo aparece na página do evento no site.'
    : undefined

  let explicacao: string | null = null
  if (acao === 'adiar') {
    explicacao =
      'Quem está inscrito será avisado por e-mail e as inscrições novas ficam fechadas até a nova data ser definida.'
  } else if (acao === 'remarcar') {
    explicacao =
      'Quem está inscrito será avisado por e-mail e a programação (sessões) acompanha a nova data.'
  } else if (acao === 'realizado') {
    explicacao =
      'Marcar este evento como realizado? Depois disso ele não volta atrás e ninguém é avisado por e-mail.'
  } else if (acao === 'reativar' || acao === 'retomar') {
    explicacao =
      acao === 'reativar' && comecou
        ? 'A data deste evento já passou: informe a nova data. Quem está inscrito será avisado por e-mail.'
        : `O evento volta a ser programado para ${formatarData(evento.data_hora_inicio, { comHora: true })}. Quem está inscrito será avisado por e-mail.`
  }

  return (
    <section
      aria-label="Situação do evento"
      className="space-y-3 rounded-md border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Situação do evento:</span>
        <SeloDoStatusDoEvento status={evento.status} />
      </div>
      {evento.motivo_status && (
        <p className="text-sm text-muted-foreground">
          Motivo: {evento.motivo_status}
        </p>
      )}
      {evento.status === 'Programado' && evento.data_hora_inicio_anterior && (
        <p className="text-sm text-muted-foreground">
          Remarcado: a data anterior era{' '}
          {formatarData(evento.data_hora_inicio_anterior, { comHora: true })}
        </p>
      )}

      {podeAlterar && evento.status === 'Realizado' && (
        <p className="text-sm text-muted-foreground">
          Um evento realizado não volta atrás.
        </p>
      )}

      {botoes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {botoes.map((b) => {
            const aindaNaoComecou = b.acao === 'realizado' && !comecou
            return (
              <Button
                key={b.acao}
                type="button"
                variant="outline"
                size="sm"
                aria-expanded={acao === b.acao}
                disabled={aindaNaoComecou || mudar.isPending}
                aria-describedby={aindaNaoComecou ? idDica : undefined}
                onClick={() => abrir(b.acao)}
              >
                {b.rotulo}
              </Button>
            )
          })}
        </div>
      )}
      {botoes.some((b) => b.acao === 'realizado') && !comecou && (
        <p id={idDica} className="text-xs text-muted-foreground">
          “Marcar como realizado” só depois do início do evento.
        </p>
      )}
      {podeAlterar && evento.status === 'Adiado' && comecou && (
        <p className="text-xs text-muted-foreground">
          A data original já passou: defina uma nova data.
        </p>
      )}

      {acao && (
        <form
          onSubmit={enviar}
          noValidate
          aria-label={TITULO_DO_FORMULARIO[acao]}
          className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2"
        >
          <h4 className="text-sm font-semibold sm:col-span-2">
            {TITULO_DO_FORMULARIO[acao]}
          </h4>
          {erro && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
            >
              {erro}
            </p>
          )}
          {explicacao && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {explicacao}
            </p>
          )}

          {(pedeMotivoObrigatorio || pedeData) && (
            <Campo
              rotulo={
                acao === 'cancelar'
                  ? 'Motivo do cancelamento'
                  : acao === 'adiar'
                    ? 'Motivo do adiamento'
                    : 'Motivo (opcional)'
              }
              className="sm:col-span-2"
              dica={dicaDoMotivo}
            >
              <textarea
                className={classeAreaDeTexto}
                rows={3}
                value={motivo}
                readOnly={confirmando}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Campo>
          )}

          {pedeData && (
            <>
              <Campo rotulo="Nova data de início">
                <input
                  type="datetime-local"
                  className={classeCampo}
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
              </Campo>
              <Campo
                rotulo="Novo fim (opcional)"
                dica={
                  evento.data_hora_fim
                    ? 'Em branco: o evento mantém a mesma duração.'
                    : undefined
                }
              >
                <input
                  type="datetime-local"
                  className={classeCampo}
                  value={fim}
                  onChange={(e) => setFim(e.target.value)}
                />
              </Campo>
            </>
          )}

          {confirmando && (
            <p
              ref={confirmacaoRef}
              tabIndex={-1}
              className="text-sm font-medium sm:col-span-2"
            >
              Cancelar o evento? Quem está inscrito será avisado por e-mail.
            </p>
          )}

          <div className="flex gap-2 sm:col-span-2">
            {acao === 'cancelar' && confirmando ? (
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={mudar.isPending}
              >
                {mudar.isPending ? 'Cancelando…' : 'Sim, cancelar o evento'}
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={mudar.isPending}>
                {mudar.isPending
                  ? 'Enviando…'
                  : acao === 'adiar'
                    ? 'Confirmar adiamento'
                    : acao === 'cancelar'
                      ? 'Continuar'
                      : acao === 'realizado'
                        ? 'Sim, marcar como realizado'
                        : acao === 'reativar'
                          ? 'Confirmar reativação'
                          : acao === 'retomar'
                            ? 'Confirmar volta à data original'
                            : 'Confirmar nova data'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={mudar.isPending}
              onClick={voltar}
            >
              Voltar
            </Button>
          </div>
        </form>
      )}

      {resultado && (
        <div
          role="status"
          className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm"
        >
          <p className="font-medium">{resultado.mensagem}</p>
          {avisos && avisos.inscricoes_a_avisar > 0 && (
            <>
              <p>
                Aviso por e-mail: {avisos.avisos_enviados} de {avisos.enderecos}{' '}
                endereço(s) avisado(s).
              </p>
              {avisos.avisos_enviados < avisos.enderecos && (
                <p>
                  Alguns e-mails não saíram: avise essas pessoas por outro meio.
                </p>
              )}
            </>
          )}
          {avisos && (avisos.enderecos_que_desligaram ?? 0) > 0 && (
            <p>
              {avisos.enderecos_que_desligaram} endereço(s) não recebem: quem
              usa o endereço desligou os avisos de evento por e-mail.
            </p>
          )}
          {avisos && avisos.inscritos_sem_email > 0 && (
            <p>
              {avisos.inscritos_sem_email} inscrição(ões) sem e-mail cadastrado.
            </p>
          )}
          {resultado.sessoes_deslocadas > 0 && (
            <p>
              A programação ({resultado.sessoes_deslocadas} sessão(ões))
              acompanhou a nova data.
            </p>
          )}
          {resultado.inscricoes_com_cobranca > 0 && (
            <p>
              Há {resultado.inscricoes_com_cobranca} inscrição(ões) paga(s)
              neste evento. Quem desistir pelo link do e-mail recebe o valor
              inteiro de volta; para os demais, confira o Financeiro.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setResultado(null)}
          >
            Fechar
          </Button>
        </div>
      )}
    </section>
  )
}
