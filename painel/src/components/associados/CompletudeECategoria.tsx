import { useQuery } from '@tanstack/react-query'

import { obterCategoriaCalculada, obterCompletude } from '@/lib/api'

const ROTULO_DO_CAMPO: Record<string, string> = {
  nome_completo: 'nome',
  cpf: 'CPF',
  email_contato: 'e-mail',
  telefone_whatsapp: 'telefone',
  data_nascimento: 'data de nascimento',
  estado_civil: 'estado civil',
  profissao: 'profissão',
  naturalidade: 'naturalidade',
  foto: 'foto',
  endereco: 'endereço',
}

// v1.1 no servidor, tela só na v5.4c (achado AO VIVO na homologação, 2026-10-05): o percentual de preenchimento do cadastro existia como
// rota testada e nenhuma tela o mostrava — quem cuida do cadastro não tinha como saber o que falta preencher.
export function CompletudeDoCadastro({ idAssociado }: { idAssociado: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['completude', idAssociado],
    queryFn: () => obterCompletude(idAssociado),
  })
  if (isLoading || !data) return null
  return (
    <section
      className="rounded-xl border border-border bg-card p-6"
      aria-label="Completude do cadastro"
    >
      <h2 className="font-semibold">Completude do cadastro</h2>
      <p className="mt-1 text-sm">
        <strong data-testid="completude-percentual">{data.percentual}%</strong>{' '}
        preenchido
      </p>
      <div
        role="progressbar"
        aria-label="Cadastro preenchido"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={data.percentual}
        className="mt-2 h-2 w-full overflow-hidden rounded bg-muted"
      >
        <div
          className="h-full bg-primary"
          style={{ width: `${data.percentual}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {data.campos_faltando.length === 0
          ? 'Nada falta: o cadastro está completo.'
          : `Falta: ${data.campos_faltando.map((c) => ROTULO_DO_CAMPO[c] ?? c).join(', ')}.`}
      </p>
    </section>
  )
}

// O cálculo (a partir do financeiro) é a fonte da verdade; a situação guardada é só um cache atualizado por evento. A tela mostra as duas
// lado a lado e avisa quando divergem.
export function SituacaoGuardadaECalculada({
  idAssociado,
}: {
  idAssociado: number
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['categoria-calculada', idAssociado],
    queryFn: () => obterCategoriaCalculada(idAssociado),
  })
  if (isLoading || !data) return null
  return (
    <section
      className="rounded-xl border border-border bg-card p-6"
      aria-label="Situação guardada e calculada"
    >
      <h2 className="font-semibold">Situação guardada × calculada agora</h2>
      <p className="mt-1 text-sm">
        Guardada:{' '}
        <strong>{data.status_arrolamento_materializado ?? '—'}</strong>
        {' · '}
        Calculada agora: <strong>{data.categoria_calculada_agora}</strong>
      </p>
      {data.desatualizado ? (
        <p
          role="status"
          className="mt-2 rounded-md border border-amber-600/40 bg-amber-100 px-3 py-2 text-sm text-amber-950"
        >
          A situação guardada está desatualizada em relação ao financeiro; ela
          se acerta no próximo evento financeiro desta pessoa.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          As duas batem: a situação guardada está em dia com o financeiro.
        </p>
      )}
    </section>
  )
}
