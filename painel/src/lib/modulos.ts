import type { LucideIcon } from 'lucide-react'
import {
  FolderKanban,
  Landmark,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'

export type Modulo = {
  rota: string
  rotulo: string
  permissao: string
  icone: LucideIcon
}

// Manifesto único dos módulos do painel (v0.2.3). O shell monta o menu filtrando esta lista
// pelas permissões devolvidas por /auth/me — NUNCA há `if (nivel === 'Presidente')` no código.
// Cada módulo de negócio das FASES 1-20 se registra aqui; o shell não precisa saber mais nada.
export const modulos: Modulo[] = [
  {
    rota: '/associados',
    rotulo: 'Associados',
    permissao: 'associados',
    icone: Users,
  },
  {
    rota: '/financeiro',
    rotulo: 'Financeiro',
    permissao: 'financeiro',
    icone: Wallet,
  },
  {
    rota: '/governanca',
    rotulo: 'Governança',
    permissao: 'governanca',
    icone: Landmark,
  },
  {
    rota: '/projetos',
    rotulo: 'Projetos',
    permissao: 'projetos',
    icone: FolderKanban,
  },
  {
    rota: '/acesso',
    rotulo: 'Níveis e permissões',
    permissao: 'gerenciar_acesso',
    icone: ShieldCheck,
  },
  {
    rota: '/auditoria',
    rotulo: 'Auditoria',
    permissao: 'auditoria',
    icone: ScrollText,
  },
]
