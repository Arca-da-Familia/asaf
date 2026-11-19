import { useMutation, useQuery } from '@tanstack/react-query'
import { Printer, UserRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  ApiError,
  obterFolhaDeImpressao,
  registrarImpressao,
  urlArquivo,
  type CartaoParaImprimir,
} from '@/lib/api'

// v9.5j - a SEGUNDA ABA da impressão das credenciais (o Presidente, rodada 6: "vai abrir uma outra aba e nesta outra aba vai aparecer... para o pessoal
// confirmar ou não a impressão... imprime ou salva o PDF"; "não permite imprimir se estiver faltando algum dado, a não ser que justifique"). Folha A4
// com 10 cartões deitados no tamanho de cartão de banco (85,6 × 54 mm), com linha para cortar. O cartão não leva a situação (ela muda; quem lê o QR
// vê a de agora) nem CPF, endereço ou telefone. "Imprimir" registra a impressão (e a justificativa, na Auditoria) e abre a impressão do navegador.

const POR_FOLHA = 10
const MINIMO_DA_JUSTIFICATIVA = 10

function mesEAno(iso: string | null): string | null {
  if (!iso) return null
  const [ano, mes] = iso.split('-')
  return mes && ano ? `${mes}/${ano}` : null
}

function Cartao({ c }: { c: CartaoParaImprimir }) {
  const desde = mesEAno(c.associado_desde)
  return (
    <div
      className="flex h-[54mm] w-[85.6mm] flex-col overflow-hidden border border-dashed border-neutral-400 bg-white text-[#0b1611] [print-color-adjust:exact]"
      aria-label={`Credencial de ${c.nome_completo ?? 'associado'}`}
    >
      <div className="flex h-[10mm] shrink-0 items-center gap-[2mm] bg-[#14532d] px-[3mm] text-white">
        <span className="flex h-[7mm] w-[8mm] items-center justify-center rounded-[1.2mm] bg-white">
          <img
            src="/asaf-logo-160.webp"
            alt=""
            className="h-[6mm] w-[6mm] object-contain"
          />
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-[9pt] font-extrabold">ASAF</span>
          <span className="text-[6.5pt]">Credencial de associado</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center gap-[2.5mm] px-[3mm] py-[2mm]">
        {c.foto ? (
          <img
            src={urlArquivo(c.foto)}
            alt=""
            className="h-[26mm] w-[20mm] shrink-0 rounded-[1.5mm] object-cover"
          />
        ) : (
          <span className="flex h-[26mm] w-[20mm] shrink-0 items-center justify-center rounded-[1.5mm] bg-neutral-100">
            <UserRound
              className="h-[10mm] w-[10mm] text-neutral-400"
              aria-hidden="true"
            />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[0.8mm] leading-tight">
          <span className="text-[9pt] font-extrabold break-words">
            {c.nome_completo ?? 'Sem nome'}
          </span>
          <span className="text-[7.5pt]">
            {c.matricula ? `Matrícula nº ${c.matricula}` : 'Sem matrícula'}
          </span>
          {c.categoria && <span className="text-[7.5pt]">{c.categoria}</span>}
          {desde && (
            <span className="text-[6.5pt] text-neutral-600">
              Associado desde {desde}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-[0.8mm]">
          <QRCodeSVG
            value={`${window.location.origin}${c.pagina}`}
            size={84}
            level="M"
            style={{ width: '22mm', height: '22mm' }}
            aria-hidden="true"
          />
          <span className="text-[5.5pt] text-neutral-600">
            Confira a situação
          </span>
        </div>
      </div>
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
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground" role="status">
            Montando a folha…
          </p>
        ) : error ? (
          <p role="alert" className="rounded-xl bg-perigo-tinta p-4 text-sm">
            {error instanceof ApiError
              ? error.detail
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
            className="folha-de-credenciais grid w-[210mm] grid-cols-[repeat(2,85.6mm)] content-start justify-center gap-x-[6mm] gap-y-[2mm] bg-white px-[10mm] py-[8mm] shadow-card print:break-after-page print:shadow-none"
          >
            {folha.map((c) => (
              <Cartao key={c.id_associado} c={c} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
