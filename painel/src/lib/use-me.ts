import { useQuery } from '@tanstack/react-query'

import { me, type Me } from './api'

export function useMe() {
  return useQuery<Me>({ queryKey: ['me'], queryFn: me })
}
