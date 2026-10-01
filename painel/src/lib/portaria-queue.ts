// v4.8 (FASE 4) - fila de escrita offline da tela da portaria (painel/src/pages/PortariaGate.tsx).
// O plano da v4.8 trata "sobreviver à internet cair no salão" como requisito de verdade, não
// enfeite: todo check-in/check-out passa por AQUI (nunca um fetch direto, nem quando está online -
// ver PortariaGate.tsx), grava primeiro no IndexedDB (confirmação otimista imediata na tela) e só
// depois tenta enviar pro servidor. Biblioteca escolhida: `idb` (Jake Archibald) - wrapper fino em
// cima de IndexedDB, MIT/ISC, ~28M downloads/semana, mantido (release em 2025), zero custo/limite
// por usuário (exigência congelada em DECISOES_CONGELADAS.md §4.3).
//
// Este módulo é standalone de propósito (mesma razão de `api-portaria.ts`): só importa dele e de
// APIs de navegador/React.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { useCallback, useEffect, useState } from 'react'

import {
  ErroPortaria,
  registrarCheckin,
  registrarCheckout,
  STATUS_FALHA_DE_REDE,
  type AcaoPortariaPayload,
  type MetodoCheckinPortaria,
} from './api-portaria'

export type TipoAcaoPortaria = 'checkin' | 'checkout'
export type StatusItemFilaPortaria =
  'pendente' | 'enviando' | 'sincronizado' | 'erro'

export type PayloadAcaoPortaria = {
  metodo: MetodoCheckinPortaria
  codigo?: string
  token_carteirinha?: string
  id_sessao?: number
}

export type ItemFilaPortaria = {
  chave_idempotencia: string
  tipo: TipoAcaoPortaria
  portariaToken: string
  payload: PayloadAcaoPortaria
  criado_em: string
  status: StatusItemFilaPortaria
  tentativas: number
  ultimo_erro?: string
}

interface FilaPortariaDBSchema extends DBSchema {
  fila: {
    key: string
    value: ItemFilaPortaria
    indexes: { criado_em: string }
  }
}

const NOME_BANCO = 'asaf-portaria-fila'
const VERSAO_BANCO = 1
const LOJA = 'fila'

let dbPromise: Promise<IDBPDatabase<FilaPortariaDBSchema>> | null = null

function getDb(): Promise<IDBPDatabase<FilaPortariaDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<FilaPortariaDBSchema>(NOME_BANCO, VERSAO_BANCO, {
      upgrade(db) {
        const loja = db.createObjectStore(LOJA, {
          keyPath: 'chave_idempotencia',
        })
        loja.createIndex('criado_em', 'criado_em')
      },
    })
  }
  return dbPromise
}

// ---------------------------------------------------------------------------
// Pub/sub simples - o bastante pra UI re-ler a fila depois de cada mutação, sem puxar
// TanStack Query (nem faria sentido: esta tela é deliberadamente standalone) nem inventar um
// mecanismo de reatividade em tempo real que ninguém pediu.
// ---------------------------------------------------------------------------
type Ouvinte = () => void
const ouvintes = new Set<Ouvinte>()

function notificarOuvintes(): void {
  for (const fn of ouvintes) fn()
}

export function ouvirFilaPortaria(fn: Ouvinte): () => void {
  ouvintes.add(fn)
  return () => {
    ouvintes.delete(fn)
  }
}

export async function listarFilaPortaria(): Promise<ItemFilaPortaria[]> {
  const db = await getDb()
  return db.getAllFromIndex(LOJA, 'criado_em')
}

// Gera a chave de idempotência UMA vez, aqui, no momento em que a ação nasce - nunca é
// regenerada num reenvio (nem por `sincronizar`, nem por um F5 no meio de uma sincronização: o
// item já teria sido salvo no IndexedDB com a chave definitiva antes de qualquer tentativa de
// envio).
export async function enfileirarAcaoPortaria(
  tipo: TipoAcaoPortaria,
  portariaToken: string,
  payload: PayloadAcaoPortaria,
): Promise<ItemFilaPortaria> {
  const item: ItemFilaPortaria = {
    chave_idempotencia: crypto.randomUUID(),
    tipo,
    portariaToken,
    payload,
    criado_em: new Date().toISOString(),
    status: 'pendente',
    tentativas: 0,
  }
  const db = await getDb()
  await db.put(LOJA, item)
  notificarOuvintes()
  // Dispara uma tentativa de sincronização imediatamente (melhor esforço, nunca aguardado por
  // quem enfileira) - se estiver online, a confirmação "sincronizado" chega em instantes; se
  // estiver offline, a tentativa falha em rede e o item permanece pendente pro próximo ciclo
  // (evento `online` ou o intervalo periódico, ambos amarrados em `useFilaPortaria`).
  void sincronizarFilaPortaria()
  return item
}

function montarPayloadEnvio(item: ItemFilaPortaria): AcaoPortariaPayload {
  return {
    chave_idempotencia: item.chave_idempotencia,
    metodo: item.payload.metodo,
    codigo: item.payload.codigo,
    token_carteirinha: item.payload.token_carteirinha,
    id_sessao: item.payload.id_sessao,
  }
}

async function enviarItem(item: ItemFilaPortaria): Promise<void> {
  const db = await getDb()
  item.status = 'enviando'
  await db.put(LOJA, item)
  notificarOuvintes()

  try {
    if (item.tipo === 'checkin') {
      await registrarCheckin(item.portariaToken, montarPayloadEnvio(item))
    } else {
      await registrarCheckout(item.portariaToken, montarPayloadEnvio(item))
    }
    item.status = 'sincronizado'
    item.ultimo_erro = undefined
  } catch (erro) {
    item.tentativas += 1
    if (erro instanceof ErroPortaria && erro.status !== STATUS_FALHA_DE_REDE) {
      // Resposta HTTP completa (2xx nunca cai aqui, já tratado acima - então isto é 4xx/5xx de
      // verdade): o servidor processou e recusou. Uma recusa "definitiva" (400/404 - cancelada,
      // sem check-in aberto pra dar check-out etc.) nunca muda só de tentar de novo sem nada
      // mudar no mundo real - por isso fica em `erro` (nunca em `pendente`), com a mensagem do
      // servidor guardada pra mostrar na tela. TERMINAL pro varredor automático (`sincronizar` -
      // ver abaixo, só varre `pendente`): sem isso, um item recusado seria reenviado pro servidor
      // a cada ~18s pra sempre (intervalo periódico), martelando o mesmo pedido fadado a falhar
      // enquanto a tela ficar aberta (o normal numa portaria, por horas). Quem opera pode corrigir
      // a causa (ex.: organizador tira a pessoa da lista de espera) e tentar de novo a mão - ver
      // `reenviarItemComErro`, usado pelo botão "Tentar novamente" em PortariaGate.tsx.
      item.status = 'erro'
      item.ultimo_erro = erro.detail
    } else {
      // `fetch` lançou (sem resposta nenhuma do servidor) - falha de rede, não recusa. Continua
      // pendente pro próximo ciclo; a chave de idempotência garante que reenviar depois nunca
      // conta a mesma presença duas vezes.
      item.status = 'pendente'
      item.ultimo_erro = erro instanceof Error ? erro.message : 'Falha de rede.'
    }
  }
  await db.put(LOJA, item)
  notificarOuvintes()
}

let sincronizando = false

// Varre só `pendente` (nunca `erro` - ver o comentário em `enviarItem`: uma recusa definitiva do
// servidor é terminal pro varredor automático, só volta a ser enviada por ação explícita de quem
// opera, via `reenviarItemComErro`), em ordem de criação, enviando um de cada vez (nunca em
// paralelo: um check-out enfileirado depois do seu check-in nunca pode chegar ao servidor antes
// dele - ver app/services/checkin.py, que resolve o check-out pela pessoa+contexto em aberto, não
// por um id que só existiria depois do check-in já ter sincronizado).
export async function sincronizarFilaPortaria(): Promise<void> {
  if (sincronizando) return
  sincronizando = true
  try {
    const todos = await listarFilaPortaria()
    const pendentes = todos.filter((i) => i.status === 'pendente')
    for (const item of pendentes) {
      await enviarItem(item)
    }
  } finally {
    sincronizando = false
  }
}

// Reenvio explícito de UM item recusado (`erro`) - ação da pessoa operando a portaria, nunca
// automática (ver `sincronizarFilaPortaria`, que ignora `erro` de propósito). Útil quando a causa
// da recusa foi corrigida por fora (ex.: organizador reabriu a vaga da pessoa) e a mesma ação
// passa a valer sem precisar reenfileirar do zero - reenviar com a MESMA `chave_idempotencia`
// (nunca gera uma nova) continua garantindo que, se o primeiro envio na real tiver sido aplicado
// no servidor apesar do erro reportado ao cliente (ex.: timeout depois de processar), o reenvio
// não conta a presença duas vezes. Não usa o mutex `sincronizando` (esse é só pro varredor em
// lote) - concorrer com uma sincronização automática em voo é seguro porque cada uma mexe em
// itens diferentes (a automática nunca toca `erro`).
export async function reenviarItemComErro(
  chaveIdempotencia: string,
): Promise<void> {
  const db = await getDb()
  const item = await db.get(LOJA, chaveIdempotencia)
  if (!item || item.status !== 'erro') return
  await enviarItem(item)
}

// ~15-20s: backstop periódico. Os eventos `online`/`offline` do navegador são pouco confiáveis
// em rede móvel (alguns aparelhos/operadoras não disparam `online` numa reconexão de verdade) -
// por isso esta tela nunca depende só do evento, sempre tenta sincronizar de novo em intervalo
// fixo enquanto estiver montada.
const INTERVALO_SINCRONIZACAO_MS = 18_000

// Hook único que a tela da portaria usa pra tudo relacionado à fila: itens atuais, quantos ainda
// não sincronizaram, se há uma sincronização em voo agora, e o estado de conectividade do
// navegador. Cuida sozinho de assinar `online`/`offline` e do intervalo periódico enquanto
// estiver montado, e desliga tudo no unmount.
export function useFilaPortaria() {
  const [itens, setItens] = useState<ItemFilaPortaria[]>([])
  // Começa `true`: ao montar, o efeito abaixo já dispara uma sincronização (a regra
  // react-hooks/set-state-in-effect reprova acender o indicador com setState síncrono no efeito).
  const [sincronizandoUi, setSincronizandoUi] = useState(true)
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  const atualizar = useCallback(() => {
    void listarFilaPortaria().then(setItens)
  }, [])

  const sincronizarAgora = useCallback(async () => {
    setSincronizandoUi(true)
    try {
      await sincronizarFilaPortaria()
    } finally {
      setSincronizandoUi(false)
    }
  }, [])

  useEffect(() => {
    atualizar()
    const cancelarOuvinte = ouvirFilaPortaria(atualizar)

    function aoFicarOnline() {
      setOnline(true)
      void sincronizarAgora()
    }
    function aoFicarOffline() {
      setOnline(false)
    }
    window.addEventListener('online', aoFicarOnline)
    window.addEventListener('offline', aoFicarOffline)

    const intervalo = window.setInterval(() => {
      void sincronizarAgora()
    }, INTERVALO_SINCRONIZACAO_MS)

    // Tenta uma vez já ao montar (ex.: itens deixados pendentes de uma sessão anterior da aba).
    // O indicador de "sincronizando" já nasce ligado (ver useState acima); aqui só apaga no fim.
    void sincronizarFilaPortaria().finally(() => setSincronizandoUi(false))

    return () => {
      cancelarOuvinte()
      window.removeEventListener('online', aoFicarOnline)
      window.removeEventListener('offline', aoFicarOffline)
      window.clearInterval(intervalo)
    }
  }, [atualizar, sincronizarAgora])

  const pendentes = itens.filter((i) => i.status !== 'sincronizado').length

  return {
    itens,
    pendentes,
    sincronizando: sincronizandoUi,
    online,
    sincronizarAgora,
  }
}

export async function enfileirarCheckin(
  portariaToken: string,
  payload: PayloadAcaoPortaria,
): Promise<ItemFilaPortaria> {
  return enfileirarAcaoPortaria('checkin', portariaToken, payload)
}

export async function enfileirarCheckout(
  portariaToken: string,
  payload: PayloadAcaoPortaria,
): Promise<ItemFilaPortaria> {
  return enfileirarAcaoPortaria('checkout', portariaToken, payload)
}
