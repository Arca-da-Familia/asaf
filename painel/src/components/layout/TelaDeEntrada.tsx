import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

import { AvisoDeAmbiente } from '@/components/layout/AvisoDeAmbiente'

/** O campo das telas de entrada: alto (bom para o dedo), borda visível (3:1 com o fundo) e letra de 16 px (o celular não dá zoom ao tocar). */
export const CAMPO_DA_ENTRADA =
  'mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-input bg-card px-3.5 text-base text-foreground placeholder:text-muted-foreground'
export const ROTULO_DA_ENTRADA = 'text-sm font-bold'

// v9.5a - a moldura das telas de entrada no sistema (entrar, código de segurança, esqueci a senha, troca obrigatória da senha e ligar o código), no desenho que
// o Presidente aprovou no artefato de escolha (rodada 3, 13/11/2026): no notebook, a "metade verde" à esquerda com a logo e o nome da associação e o formulário
// à direita; no celular, o topo verde com a logo e um cartão branco que sobe por cima dele. Cada tela tem o seu próprio <h1>; o nome da associação aqui é texto.
export function TelaDeEntrada({
  children,
  passos,
}: {
  children: ReactNode
  /** os passos da tela (ex.: CPF e senha → código), mostrados acima do formulário */
  passos?: ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col bg-card">
      <AvisoDeAmbiente />
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* notebook: a metade verde */}
        <section
          aria-label="Associação Arca da Família"
          className="hidden bg-barra px-16 py-16 text-barra-foreground lg:flex lg:w-[44%] lg:max-w-[560px] lg:flex-col lg:justify-center"
        >
          <span className="flex w-fit items-center justify-center rounded-3xl bg-white p-3.5">
            <img
              src="/asaf-logo-640.webp"
              alt="Logo da ASAF"
              width={150}
              height={124}
              className="h-[124px] w-[150px] object-contain"
            />
          </span>
          <p className="mt-5 font-titulo text-[32px] leading-tight font-extrabold">
            Associação
            <br />
            Arca da Família
          </p>
          <p className="mt-4 max-w-sm text-base text-barra-suave">
            Painel da associação: associados, dinheiro, atas, eventos e avisos
            num lugar só.
          </p>
        </section>

        {/* celular: o topo verde */}
        <section
          aria-label="Associação Arca da Família"
          className="flex flex-col gap-3 bg-barra px-5 pt-7 pb-12 text-barra-foreground lg:hidden"
        >
          <span className="flex w-fit items-center justify-center rounded-2xl bg-white p-2.5">
            <img
              src="/asaf-logo-160.webp"
              alt="Logo da ASAF"
              width={64}
              height={53}
              className="h-[53px] w-16 object-contain"
            />
          </span>
          <p className="font-titulo text-[22px] font-extrabold">
            Bem-vindo ao painel
          </p>
          <p className="-mt-2 text-sm text-barra-suave">
            Associação Arca da Família
          </p>
        </section>

        {/* o formulário: à direita no notebook, num cartão que sobe por cima do verde no celular */}
        <div className="-mt-7 flex flex-1 flex-col items-center rounded-t-[26px] bg-card px-5 pt-7 pb-6 lg:mt-0 lg:justify-center lg:rounded-none lg:px-8 lg:py-10">
          <div className="flex w-full max-w-[420px] flex-col gap-5">
            {passos}
            {children}
          </div>
          <p className="mt-8 text-center text-[13px] text-muted-foreground">
            Só entra quem recebeu acesso da ASAF ·{' '}
            <a
              href="https://asaf.org.br/privacidade/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-azul-texto underline-offset-4 hover:underline"
            >
              Política de privacidade
              <span className="sr-only"> (abre em uma nova aba)</span>
            </a>
          </p>
        </div>
      </div>
    </main>
  )
}

/** Os passos de uma tela de entrada (ex.: "CPF e senha" já feito, "Código" agora). `atual` começa em 0. */
export function PassosDaEntrada({
  nomes,
  atual,
}: {
  nomes: string[]
  atual: number
}) {
  return (
    <ol aria-label="Passos" className="flex items-center gap-2">
      {nomes.map((nome, i) => (
        <li
          key={nome}
          aria-current={i === atual ? 'step' : undefined}
          className={`flex items-center gap-2 ${i < nomes.length - 1 ? 'flex-1' : ''}`}
        >
          <span
            className={`flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-extrabold ${
              i < atual
                ? 'bg-verde-tinta text-verde-texto'
                : i === atual
                  ? 'bg-primary text-primary-foreground'
                  : 'border-[1.5px] border-input text-muted-foreground'
            }`}
          >
            {i < atual ? (
              <>
                <Check
                  className="size-3.5"
                  strokeWidth={3}
                  aria-hidden="true"
                />
                <span className="sr-only">feito</span>
              </>
            ) : (
              i + 1
            )}
          </span>
          <span
            className={`text-[13.5px] whitespace-nowrap ${
              i === atual
                ? 'font-extrabold'
                : i < atual
                  ? 'font-semibold'
                  : 'font-semibold text-muted-foreground'
            }`}
          >
            {nome}
          </span>
          {i < nomes.length - 1 && (
            <span
              aria-hidden="true"
              className={`h-0.5 min-w-4 flex-1 ${i < atual ? 'bg-verde-texto' : 'bg-border'}`}
            />
          )}
        </li>
      ))}
    </ol>
  )
}
