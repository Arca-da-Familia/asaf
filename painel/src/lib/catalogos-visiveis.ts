import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { listarCatalogos, type Catalogo } from '@/lib/api'
import { useMe } from '@/lib/use-me'

// v9.3 - os catálogos de Configurações que a pessoa vê, agrupados pelo módulo dono. Usado pela barra lateral (Shell: dentro de Configurações a barra troca
// para a lista dos catálogos, como o menu de qualquer módulo) e pela página (que mostra só o catálogo escolhido). Regra desde a v2.5.8: cada catálogo só
// aparece para quem tem a permissão do módulo dono, ou `gerenciar_acesso`; os de sistema (sem dono), só para `gerenciar_acesso`. O servidor revalida.
export const ROTULO_GRUPO: Record<string, string> = {
  associados: 'Associados',
  governanca: 'Governança',
  financeiro: 'Financeiro',
  projetos: 'Projetos',
  auditoria: 'Auditoria',
  comunicar: 'Comunicação', // v6.1 - o catálogo `categoria_aviso` (categoria do aviso do mural)
}
export const GRUPO_SISTEMA = '__sistema__'

export function rotuloDoGrupo(chaveGrupo: string): string {
  return chaveGrupo === GRUPO_SISTEMA
    ? 'Sistema'
    : (ROTULO_GRUPO[chaveGrupo] ?? chaveGrupo)
}

export const ROTA_CONFIGURACOES = '/configuracoes'

export function rotaDoCatalogo(chave: string): string {
  return `${ROTA_CONFIGURACOES}/${encodeURIComponent(chave)}`
}

export function useCatalogosVisiveis(ativo = true): {
  grupos: Map<string, Catalogo[]>
  todos: Catalogo[]
  carregado: boolean
} {
  const { data: me } = useMe()
  const { data: catalogos } = useQuery({
    queryKey: ['catalogos'],
    queryFn: listarCatalogos,
    enabled: ativo,
  })
  return useMemo(() => {
    const permissoes = me?.permissoes ?? []
    const temGerenciarAcesso = permissoes.includes('gerenciar_acesso')
    const grupos = new Map<string, Catalogo[]>()
    for (const c of catalogos ?? []) {
      const chaveGrupo = c.permissao_gerenciamento ?? GRUPO_SISTEMA
      const podeVer =
        chaveGrupo === GRUPO_SISTEMA
          ? temGerenciarAcesso
          : temGerenciarAcesso || permissoes.includes(chaveGrupo)
      if (!podeVer) continue
      if (!grupos.has(chaveGrupo)) grupos.set(chaveGrupo, [])
      grupos.get(chaveGrupo)!.push(c)
    }
    return {
      grupos,
      todos: Array.from(grupos.values()).flat(),
      carregado: catalogos !== undefined && me !== undefined,
    }
  }, [catalogos, me])
}
