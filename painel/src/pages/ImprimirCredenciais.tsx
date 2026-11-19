import { useMutation, useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { CartaoDesenhado } from '@/components/credencial/CartaoDesenhado'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  obterFolhaDeImpressao,
  obterModeloEmUso,
  registrarImpressao,
  urlArquivo,
  type CartaoParaImprimir,
} from '@/lib/api'
import type { Desenho } from '@/lib/credencial-desenho'

// v9.5j - a SEGUNDA ABA da impressão das credenciais (o Presidente, rodada 6: "vai abrir uma outra aba e nesta outra aba vai aparecer... para o pessoal
// confirmar ou não a impressão... imprime ou salva o PDF"; "não permite imprimir se estiver faltando algum dado, a não ser que justifique"). Folha A4
// com 10 cartões deitados no tamanho de cartão de banco (85,6 × 54 mm), com linha para cortar. O cartão não leva a situação (ela muda; quem lê o QR
// vê a de agora) nem CPF, endereço ou telefone. "Imprimir" registra a impressão (e a justificativa, na Auditoria) e abre a impressão do navegador.
// v9.5k: o cartão segue o desenho do modelo em uso (o criador de credencial).

const POR_FOLHA = 10
const MINIMO_DA_JUSTIFICATIVA = 10

function mesEAno(iso: string | null): string | null {
  if (!iso) return null
  const [ano, mes] = iso.split('-')
  return mes && ano ? `${mes}/${ano}` : null
}

function Cartao({ c, desenho }: { c: CartaoParaImprimir; desenho: Desenho }) {
  const nome = c.nome_completo ?? 'associado'
  return (
    <div className="relative h-[54mm] w-[85.6mm]">
      <CartaoDesenhado
        desenho={desenho}
        rotulo={`Credencial de ${nome}`}
        dados={{
          nome: c.nome_completo ?? 'Sem nome',
          matricula: c.matricula,
          categoria: c.categoria,
          desde: mesEAno(c.associado_desde),
          foto: c.foto ? urlArquivo(c.foto) : null,
          qr: `${window.location.origin}${c.pagina}`,
        }}
      />
      {/* a linha de corte, por cima da borda do cartão */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 border border-dashed border-neutral-400"
      />
    </div>
  )
}

export function ImprimirCredenciaisPage() {
  const [parametros] = useSearchParams()
  const ids = (parametros.get('ids') ?? '')
    .split(',')
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0)
  const [justificativas, setJustificativas] = useState<Record<number, string>>(
    {},
  )
  const [aviso, setAviso] = useState('')
  const { data, isLoading, error } = useQuery({
    queryKey: ['folha-de-impressao', ids.join(',')],
    queryFn: () => obterFolhaDeImpressao(ids),
    enabled: ids.length > 0,
    retry: false,
  })
  // v9.5k: o desenho do cartão é o do modelo em uso (o criador de credencial); sem nenhum, o servidor manda o pronto "Faixa no alto"
  const modelo = useQuery({
    queryKey: ['modelo-de-credencial-em-uso'],
    queryFn: obterModeloEmUso,
    enabled: ids.length > 0,
    retry: false,
  })
  const falha = error ?? modelo.error
  const cartoes = data ?? []
  const comFalta = cartoes.filter((c) => c.faltando.length > 0)
  const faltaJustificar = comFalta.filter(
    (c) =>
      (justificativas[c.id_associado] ?? '').trim().length <
      MINIMO_DA_JUSTIFICATIVA,
  )
  const registrar = useMutation({
    mutationFn: () =>
      registrarImpressao(
        ids,
        Object.fromEntries(
          comFalta.map((c) => [
            c.id_associado,
            justificativas[c.id_associado] ?? '',
          ]),
        ),
      ),
    onSuccess: (r) => {
      setAviso(
        `${r.mensagem} Se a impressora falhar, imprima de novo: a credencial é a mesma.`,
      )
      window.print()
    },
    onError: (erro) =>
      setAviso(
        erro instanceof ApiError
          ? erro.detail
          : 'Não foi possível registrar a impressão agora.',
      ),
  })
  const folhas: CartaoParaImprimir[][] = []
  for (let i = 0; i < cartoes.length; i += POR_FOLHA)
    folhas.push(cartoes.slice(i, i + POR_FOLHA))

  return (
    <div className="min-h-dvh bg-muted/40 print:bg-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 print:hidden">
        <div>
          <h1 className="font-titulo text-2xl font-extrabold">
            Imprimir credenciais
          </h1>
          <p className="text-sm text-muted-foreground">
            {cartoes.length} {cartoes.length === 1 ? 'cartão' : 'cartões'} em{' '}
            {folhas.length} {folhas.length === 1 ? 'folha' : 'folhas'} A4,{' '}
            {POR_FOLHA} por folha, no tamanho de cartão de banco (85,6 × 54 mm).
            Corte pelas linhas tracejadas. Na janela da impressora, deixe a
            escala em 100% (tamanho real); para guardar em PDF, escolha
            &quot;Salvar como PDF&quot;.
          </p>
        </div>
        {ids.length === 0 ? (
          <p className="rounded-xl bg-card p-4 text-sm">
            Nenhuma credencial escolhida. Volte à lista e marque quem imprimir.
          </p>
        ) : isLoading || modelo.isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Montando a folha…
          </p>
        ) : falha ? (
          <p role="alert" className="rounded-xl bg-perigo-tinta p-4 text-sm">
            {falha instanceof ApiError
              ? falha.detail
              : 'Não foi possível montar a folha agora.'}
          </p>
        ) : (
          <>
            {comFalta.length > 0 && (
              <section
                aria-labelledby="titulo-falta"
                className="rounded-2xl border border-border bg-card p-4"
              >
                <h2
                  id="titulo-falta"
                  className="font-titulo text-lg font-extrabold"
                >
                  Falta dado em {comFalta.length}{' '}
                  {comFalta.length === 1 ? 'cartão' : 'cartões'}
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  O cartão sai assim só com uma justificativa (pelo menos{' '}
                  {MINIMO_DA_JUSTIFICATIVA} letras), que fica na Auditoria. Ou
                  corrija o cadastro e abra a folha de novo.
                </p>
                <ul className="flex flex-col gap-3">
                  {comFalta.map((c) => (
                    <li key={c.id_associado} className="flex flex-col gap-1">
                      <label
                        htmlFor={`justificativa-${c.id_associado}`}
                        className="text-sm font-semibold"
                      >
                        {c.nome_completo ?? 'Sem nome'}: falta{' '}
                        {c.faltando.join(' e ')}. Por que imprimir assim?
                      </label>
                      <textarea
                        id={`justificativa-${c.id_associado}`}
                        rows={2}
                        value={justificativas[c.id_associado] ?? ''}
                        onChange={(e) =>
                          setJustificativas({
                            ...justificativas,
                            [c.id_associado]: e.target.value,
                          })
                        }
                        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="min-h-11"
                disabled={
                  faltaJustificar.length > 0 ||
                  registrar.isPending ||
                  cartoes.length === 0
                }
                onClick={() => registrar.mutate()}
              >
                <Printer aria-hidden="true" />
                Imprimir
              </Button>
              {faltaJustificar.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  Falta justificar {faltaJustificar.length}{' '}
                  {faltaJustificar.length === 1 ? 'cartão' : 'cartões'}.
                </span>
              )}
            </div>
            <p role="status" className="text-sm font-semibold empty:hidden">
              {aviso}
            </p>
          </>
        )}
      </div>

      {/* as folhas: na tela, como ficam no papel; na impressão, só elas */}
      <div className="flex flex-col items-center gap-6 pb-10 print:gap-0 print:pb-0">
        {folhas.map((folha, i) => (
          <section
            key={i}
            aria-label={`Folha ${i + 1} de ${folhas.length}`}
            className="folha-de-credenciais grid min-h-[297mm] w-[210mm] grid-cols-[repeat(2,85.6mm)] content-start justify-center gap-x-[6mm] gap-y-[2mm] bg-white px-[10mm] py-[8mm] shadow-card print:min-h-0 print:break-after-page print:shadow-none"
          >
            {modelo.data &&
              folha.map((c) => (
                <Cartao
                  key={c.id_associado}
                  c={c}
                  desenho={modelo.data.desenho}
                />
              ))}
          </section>
        ))}
      </div>
    </div>
  )
}
