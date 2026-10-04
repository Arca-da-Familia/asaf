import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

import type { Evento, FotoDoEvento, Projeto } from '@/lib/api'
import type { Documento } from '@/lib/documentos'

// Dados e utilitários dos testes do Despertai e do contexto do evento (v5.5): projeto, evento, relatório e foto de teste.

export function projeto(sobrescrever: Partial<Projeto> = {}): Projeto {
  return {
    id_projeto: 3,
    nome_projeto: 'Despertai',
    descricao: 'Encontros com as comunidades de Parauapebas.',
    tipo_projeto: 'SOCIAL',
    tipo_foco: 'Social',
    status: 'PLANEJAMENTO',
    id_associado_responsavel: null,
    publico_alvo: 'Jovens e famílias',
    data_inicio: '2026-10-01T00:00:00',
    data_fim_prevista: '2026-12-31T00:00:00',
    id_centro_custo: null,
    visibilidade: 'Pública',
    necessita_alvara_bombeiros: false,
    status_liberacao: 'Não Aplicável',
    destaque_no_site: true,
    ...sobrescrever,
  }
}

export function evento(sobrescrever: Partial<Evento> = {}): Evento {
  return {
    id_evento: 12,
    titulo: 'Despertai 2026',
    descricao: null,
    categoria: 'PALESTRA',
    data_hora_inicio: '2026-11-10T22:00:00',
    data_hora_fim: null,
    id_espaco: null,
    endereco_avulso: null,
    id_associado_responsavel: null,
    vagas: null,
    vagas_ocupadas: 0,
    vagas_livres: null,
    gratuito: true,
    visibilidade: 'Pública',
    id_edicao_anterior: null,
    id_projeto: 3,
    ...sobrescrever,
  }
}

export function relatorio(sobrescrever: Partial<Documento> = {}): Documento {
  return {
    id_documento: 5,
    tipo: 'RELATORIO_EVENTO',
    tipo_rotulo: 'Relatório de evento ou de projeto',
    titulo: 'Relatório do Despertai 2026',
    descricao: null,
    data_documento: null,
    ano: 2026,
    validade: null,
    classificacao: 'Interna',
    publicar_no_site: true,
    vinculo_tipo: 'evento',
    vinculo_id: 12,
    grupo_versao: 'g5',
    versao: 1,
    vigente: true,
    tem_original: false,
    original_nome_arquivo: null,
    original_tamanho: null,
    original_sha256: null,
    tem_versao_publica: false,
    publico_formato: null,
    publico_tamanho: null,
    publico_paginas: null,
    publico_sha256: null,
    verificacao: null,
    verificacao_em: null,
    situacao: 'Aprovado',
    enviado_revisao_em: null,
    aprovado_em: null,
    motivo_recusa: null,
    recusado_em: null,
    motivo_retirada: null,
    retirado_em: null,
    criado_em: '2026-10-01T10:00:00',
    atualizado_em: '2026-10-01T10:00:00',
    pode_baixar_original: false,
    pode_editar: false,
    pode_aprovar: false,
    pode_retirar: false,
    ...sobrescrever,
  }
}

export function foto(sobrescrever: Partial<FotoDoEvento> = {}): FotoDoEvento {
  return {
    id_foto: 9,
    id_evento: 12,
    alt: 'Crianças tocando tambores na quadra da escola',
    largura: 800,
    altura: 600,
    tamanho: 1000,
    autorizacao_imagem: true,
    id_documento_autorizacao: null,
    criado_em: '2026-11-10T22:00:00',
    ...sobrescrever,
  }
}

export function renderizar(elemento: React.ReactElement, caminho = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[caminho]}>{elemento}</MemoryRouter>
    </QueryClientProvider>,
  )
}

// O que não é simulado num teste de tela inteira (cronograma, equipe, cobrança... do detalhe) responde "não encontrado":
// a tela mostra o estado vazio, sem tentar falar com a rede de verdade.
export function simularRedeSemResposta() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'indisponível no teste' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )
}
