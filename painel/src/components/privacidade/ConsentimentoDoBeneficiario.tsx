import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'

import { Campo } from '@/components/forms/Campo'
import { TermoDeImagem } from '@/components/privacidade/TermoDeImagem'
import { Button } from '@/components/ui/button'
import type { Beneficiario } from '@/lib/api'
import { classeCampo } from '@/lib/campos'
import {
  menorDeIdade,
  registrarConsentimentoDoBeneficiario,
  revogarConsentimentoDoBeneficiario,
} from '@/lib/consentimentos'
import { formatarData } from '@/lib/datas'
import { mensagemDoErro } from '@/lib/erro-da-api'
import {
  escolhasEmBranco,
  faltaNoTermo,
  useTermoDaTela,
} from '@/lib/termo-de-imagem'

const VINCULOS = [
  { codigo: 'mae', rotulo: 'Mãe' },
  { codigo: 'pai', rotulo: 'Pai' },
  {
    codigo: 'responsavel_legal',
    rotulo: 'Responsável legal (guarda ou tutela)',
  },
]

// v7.1c - o consentimento do atendimento social de UM beneficiário: o termo vigente (quem consentiu, o responsável e o vínculo, a versão, a data), registrar o
// termo assinado (substitui o vigente) e revogar. Sem o consentimento vigente o prontuário e o encaminhamento não gravam.
export function ConsentimentoDoBeneficiario({
  beneficiario,
}: {
  beneficiario: Beneficiario
}) {
  const queryClient = useQueryClient()
  const semNascimento = !beneficiario.data_nascimento
  const [registrando, setRegistrando] = useState(false)
  const [dadoPor, setDadoPor] = useState<'' | 'titular' | 'responsavel'>('')
  const [nomeResponsavel, setNomeResponsavel] = useState('')
  const [vinculo, setVinculo] = useState('')
  const [escolhas, setEscolhas] = useState(escolhasEmBranco)
  const [documento, setDocumento] = useState('')
  const [revogando, setRevogando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const { data: termo, isError: termoFalhou } = useTermoDaTela(
    'beneficiario',
    registrando,
  )
  const idVinculo = useId()
  const nome = beneficiario.nome_completo ?? `pessoa ${beneficiario.id_pessoa}`
  const c = beneficiario.consentimento
  const soMarcaAntiga = c?.meio === 'declaracao_antiga'
  // a idade que vale é a da DATA DA ASSINATURA (o servidor confere de novo)
  const menor = menorDeIdade(
    beneficiario.data_nascimento,
    escolhas.assinadoEm
      ? new Date(`${escolhas.assinadoEm}T12:00:00`)
      : undefined,
  )
  const vinculos = menor
    ? VINCULOS
    : VINCULOS.filter((v) => v.codigo === 'responsavel_legal')

  // a tela Beneficiários, o prontuário no detalhe do projeto e Privacidade > Consentimentos leem o consentimento
  const atualizar = () => {
    for (const queryKey of [
      ['beneficiarios'],
      ['beneficiarios-projeto'],
      ['privacidade', 'consentimentos'],
    ])
      void queryClient.invalidateQueries({ queryKey })
  }
  const registrar = useMutation({
    mutationFn: () =>
      registrarConsentimentoDoBeneficiario(beneficiario.id_beneficiario, {
        dado_por: dadoPor,
        nome_responsavel: dadoPor === 'responsavel' ? nomeResponsavel : null,
        vinculo: dadoPor === 'responsavel' ? vinculo : null,
        meio: escolhas.meio,
        id_documento: documento ? Number(documento) : null,
        assinado_em: escolhas.assinadoEm,
        versao_do_termo: termo?.versao ?? '',
      }),
    onSuccess: () => {
      atualizar()
      setRegistrando(false)
      setAviso(
        'Consentimento registrado: o prontuário deste beneficiário pode gravar.',
      )
    },
    onError: (e) => setErro(mensagemDoErro(e, 'Não foi possível registrar.')),
  })
  const revogar = useMutation({
    mutationFn: () =>
      revogarConsentimentoDoBeneficiario(beneficiario.id_beneficiario, motivo),
    onSuccess: () => {
      atualizar()
      setRevogando(false)
      setMotivo('')
      setAviso(
        'Consentimento revogado: nada novo grava no prontuário. O que já existe continua guardado; a eliminação dele se pede pela solicitação do titular de dados.',
      )
    },
    onError: (e) => setErro(mensagemDoErro(e, 'Não foi possível revogar.')),
  })

  function tentarRegistrar() {
    setErro(null)
    setAviso(null)
    if (!dadoPor) return setErro('Diga quem consentiu.')
    if (dadoPor === 'titular' && menor)
      return setErro(
        'Na data da assinatura a pessoa tinha menos de 18 anos: quem consente é um dos pais ou o responsável legal.',
      )
    if (dadoPor === 'responsavel') {
      if (nomeResponsavel.trim().length < 3)
        return setErro('Informe o nome de quem consentiu pela pessoa atendida.')
      if (!vinculo)
        return setErro('Informe o vínculo (mãe, pai ou responsável legal).')
    }
    const falta = faltaNoTermo(termo, escolhas, documento, false, termoFalhou)
    if (falta) return setErro(falta)
    registrar.mutate()
  }

  return (
    <section
      aria-label={`Consentimento do atendimento social de ${nome}`}
      className="mb-4 v3-space-y-2 rounded-md border border-border p-3 text-sm"
    >
      <h3 className="font-semibold">Consentimento do atendimento social</h3>
      {c && soMarcaAntiga ? (
        <div role="alert" data-so-marca-antiga className="text-destructive">
          <p>
            Só a marca antiga do cadastro (de antes do termo), declarada em{' '}
            {formatarData(c.dado_em.slice(0, 10))}: o prontuário e o
            encaminhamento não gravam até o termo assinado ser registrado.
          </p>
          {beneficiario.observacao_consentimento && (
            <p className="text-xs text-muted-foreground">
              Anotação da marca antiga: {beneficiario.observacao_consentimento}
            </p>
          )}
        </div>
      ) : c ? (
        <p data-consentimento-vigente>
          Vigente · termo versão {c.versao}
          {c.versao !== c.versao_atual_do_termo &&
            ' (anterior ao termo de hoje: registre o termo novo quando puder)'}{' '}
          ·{' '}
          {c.dado_por === 'responsavel'
            ? `dado por ${c.nome_responsavel ?? '—'} (${c.vinculo_rotulo ?? 'responsável'})`
            : 'dado pela própria pessoa'}{' '}
          · {c.meio_rotulo} · assinado em {formatarData(c.dado_em.slice(0, 10))}
        </p>
      ) : (
        <p role="alert" className="text-destructive" data-sem-consentimento>
          Sem consentimento registrado: o prontuário e o encaminhamento deste
          beneficiário não gravam.
        </p>
      )}
      {semNascimento ? (
        <p className="text-xs text-destructive" data-sem-nascimento>
          Falta a data de nascimento no cadastro (Editar): é ela que diz se quem
          consente é a própria pessoa ou um dos pais ou o responsável.
        </p>
      ) : (
        menor && (
          <p className="text-xs text-muted-foreground">
            Tinha menos de 18 anos na data da assinatura: quem consente é um dos
            pais ou o responsável legal (o adolescente assina junto).
          </p>
        )
      )}
      <div className="flex flex-wrap gap-2">
        {!registrando && !semNascimento && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setRegistrando(true)
              setErro(null)
              setAviso(null)
            }}
          >
            {c && !soMarcaAntiga
              ? 'Registrar um termo novo'
              : 'Registrar o termo assinado'}
          </Button>
        )}
        {c && !revogando && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setRevogando(true)}
          >
            Revogar o consentimento
          </Button>
        )}
      </div>
      {revogando && (
        <div className="v3-space-y-2 rounded-md border border-destructive/40 p-2">
          <Campo rotulo="Motivo da revogação (opcional)">
            <input
              className={classeCampo}
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={revogar.isPending}
              onClick={() => {
                setErro(null)
                revogar.mutate()
              }}
            >
              Confirmar a revogação
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRevogando(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {registrando && (
        <div className="v3-space-y-2 rounded-md border border-border p-2">
          <fieldset className="v3-space-y-1">
            <legend className="font-medium">Quem consentiu</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`dado-por-${beneficiario.id_beneficiario}`}
                disabled={menor}
                checked={dadoPor === 'titular' && !menor}
                onChange={() => setDadoPor('titular')}
              />
              A própria pessoa atendida
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`dado-por-${beneficiario.id_beneficiario}`}
                checked={dadoPor === 'responsavel'}
                onChange={() => setDadoPor('responsavel')}
              />
              Um dos pais ou o responsável legal
            </label>
          </fieldset>
          {dadoPor === 'responsavel' && (
            <>
              <Campo rotulo="Nome de quem consentiu">
                <input
                  className={classeCampo}
                  maxLength={200}
                  value={nomeResponsavel}
                  onChange={(e) => setNomeResponsavel(e.target.value)}
                />
              </Campo>
              <div>
                <label htmlFor={idVinculo} className="mb-1 block font-medium">
                  Vínculo com a pessoa atendida
                </label>
                <select
                  id={idVinculo}
                  className={classeCampo}
                  value={vinculo}
                  onChange={(e) => setVinculo(e.target.value)}
                >
                  <option value="">Escolha…</option>
                  {vinculos.map((v) => (
                    <option key={v.codigo} value={v.codigo}>
                      {v.rotulo}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <TermoDeImagem
            origem="beneficiario"
            escolhas={escolhas}
            aoMudar={setEscolhas}
            pedeQuem={false}
          />
          <Campo
            rotulo="Nº do documento do termo digitalizado"
            dica="Obrigatório se o termo foi digitalizado na biblioteca de Documentos."
          >
            <input
              className={classeCampo}
              inputMode="numeric"
              value={documento}
              onChange={(e) => setDocumento(e.target.value.replace(/\D/g, ''))}
            />
          </Campo>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={registrar.isPending}
              onClick={tentarRegistrar}
            >
              Registrar o consentimento
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRegistrando(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-destructive">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="text-muted-foreground">
          {aviso}
        </p>
      )}
    </section>
  )
}
