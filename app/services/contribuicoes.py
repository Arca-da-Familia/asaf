"""v3.2 (FASE 3) - mensalidades e cobrança recorrente: valor vigente de um `PlanoDeContribuicao`
(versionado por reajuste), geração de `TituloFinanceiro` em lote por competência (idempotente -
ver `TituloFinanceiro.uq_titulo_cobranca_por_competencia`), isenção/desconto e aplicação de
crédito de associado. Reaproveita o `TituloFinanceiro`/`baixar_titulo` que já existem desde a
v2.6/v3.0 - uma "Cobrança" é só um título "A Receber" que nasce em lote, nunca um conceito
paralelo com sua própria baixa/estorno/auditoria."""
import calendar
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado, DependenteFamiliar
from app.models.financeiro import (
    CampanhaDescontoAntecipado, CreditoAssociado, Exercicio, IsencaoContribuicao,
    PlanoDeContribuicao, ReconhecimentoReceitaDiferida, TituloFinanceiro, ValorPlanoContribuicao,
)
from app.services import contabilidade

# v3.2 - status de arrolamento (catálogo `status_arrolamento`, v0.1/v0.2) que ainda geram
# cobrança - "Desligado", "Licenciado" e "Suspenso (Estatuto)" não são cobrados enquanto durar a
# condição (ajustável aqui se a diretoria decidir diferente, mas nunca hardcoded dentro do loop
# de geração).
STATUS_ELEGIVEIS_PARA_COBRANCA = {"Ativo - Em Dia", "Ativo - Inadimplente", "Em Experiência"}


def _mes_ano(competencia: str) -> tuple[int, int]:
    try:
        ano_str, mes_str = competencia.split("-")
        ano, mes = int(ano_str), int(mes_str)
        if not (1 <= mes <= 12):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Competência inválida - use o formato AAAA-MM.")
    return ano, mes


def data_vencimento_da_competencia(competencia: str, dia_vencimento: int) -> datetime:
    ano, mes = _mes_ano(competencia)
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    return datetime(ano, mes, min(dia_vencimento, ultimo_dia))


def _somar_meses(competencia: str, quantidade: int) -> str:
    """v3.2.3 - "AAAA-MM" + N meses, sem depender de `datetime` (mês 13 não existe)."""
    ano, mes = _mes_ano(competencia)
    indice = (mes - 1) + quantidade
    return f"{ano + indice // 12:04d}-{indice % 12 + 1:02d}"


def _quantidade_meses_entre(competencia_inicio: str, competencia_fim: str) -> int:
    ano_i, mes_i = _mes_ano(competencia_inicio)
    ano_f, mes_f = _mes_ano(competencia_fim)
    return (ano_f - ano_i) * 12 + (mes_f - mes_i) + 1


def valor_vigente(db: Session, id_plano: int, data_referencia: datetime) -> Decimal:
    """Valor vigente na data de referência - nunca o valor atual, sempre o que vale NAQUELA
    competência (reajuste tem data de vigência, ver `ValorPlanoContribuicao`)."""
    linha = (
        db.query(ValorPlanoContribuicao)
        .filter(
            ValorPlanoContribuicao.id_plano == id_plano,
            ValorPlanoContribuicao.data_vigencia_inicio <= data_referencia,
        )
        .filter(
            (ValorPlanoContribuicao.data_vigencia_fim.is_(None))
            | (ValorPlanoContribuicao.data_vigencia_fim >= data_referencia)
        )
        .order_by(ValorPlanoContribuicao.data_vigencia_inicio.desc())
        .first()
    )
    if not linha:
        raise HTTPException(status_code=400, detail=f"Plano de contribuição #{id_plano} não tem valor vigente cadastrado para {data_referencia.date().isoformat()}.")
    return linha.valor


def _titular_do_nucleo(db: Session, associado: Associado) -> Optional[Associado]:
    """v3.2 - "cobrança por família": se este associado é um DEPENDENTE registrado de outra
    pessoa (`DependenteFamiliar.id_pessoa_vinculada`) e essa outra pessoa também é associado
    elegível, ele é o titular do núcleo - retorna esse titular (ou None se este associado não é
    dependente de ninguém, ou se o "titular" não é ele mesmo um associado cobrável)."""
    vinculo = (
        db.query(DependenteFamiliar)
        .filter(DependenteFamiliar.id_pessoa_vinculada == associado.pessoa.id_pessoa)
        .first()
    )
    if not vinculo:
        return None
    titular = db.query(Associado).filter(Associado.id_pessoa == vinculo.id_pessoa_titular).first()
    if not titular or titular.status_arrolamento not in STATUS_ELEGIVEIS_PARA_COBRANCA:
        return None
    return titular


def _percentual_isencao(db: Session, id_associado: int, id_plano: int, data_referencia: datetime) -> Decimal:
    isencoes = (
        db.query(IsencaoContribuicao)
        .filter(
            IsencaoContribuicao.id_associado == id_associado,
            IsencaoContribuicao.data_inicio <= data_referencia,
        )
        .filter(
            (IsencaoContribuicao.data_fim.is_(None)) | (IsencaoContribuicao.data_fim >= data_referencia)
        )
        .filter((IsencaoContribuicao.id_plano.is_(None)) | (IsencaoContribuicao.id_plano == id_plano))
        .all()
    )
    if not isencoes:
        return Decimal("0")
    return min(Decimal("100"), max(i.percentual_desconto for i in isencoes))


def campanha_vigente(db: Session, data_referencia: datetime) -> Optional[CampanhaDescontoAntecipado]:
    """v3.2.3 - campanha de desconto por pagamento antecipado vigente na data de referência,
    versionada como `ValorPlanoContribuicao` - nunca a "campanha atual", sempre a que valia
    NAQUELA data (mudar a regra depois não afeta bloco já gerado, ver
    `TituloFinanceiro.id_campanha_desconto_antecipado`, que trava a referência pra sempre)."""
    return (
        db.query(CampanhaDescontoAntecipado)
        .filter(
            CampanhaDescontoAntecipado.ativo.is_(True),
            CampanhaDescontoAntecipado.data_vigencia_inicio <= data_referencia,
        )
        .filter(
            (CampanhaDescontoAntecipado.data_vigencia_fim.is_(None))
            | (CampanhaDescontoAntecipado.data_vigencia_fim >= data_referencia)
        )
        .order_by(CampanhaDescontoAntecipado.data_vigencia_inicio.desc())
        .first()
    )


def _meses_gatilho(campanha: CampanhaDescontoAntecipado) -> set[int]:
    return {int(m) for m in campanha.meses_gatilho.split(",") if m.strip()}


def gerar_cobranca_bloco(
    db: Session, *, id_associado: int, id_plano_contribuicao: int, competencia_inicio: str, id_usuario: Optional[int] = None,
) -> TituloFinanceiro:
    """v3.2.3 - gera UM título cobrindo o bloco inteiro (semestre/ano) com o desconto da campanha
    vigente no mês-gatilho pedido - um PIX, um pagamento, um recibo (decisão do usuário: nunca um
    título por mês). `id_conta_contabil` do título aponta pra conta de Passivo de receita
    diferida da campanha, não pra Receita do plano - é assim que `baixar_titulo` (sem precisar de
    nenhuma mudança nele) credita a conta certa quando o associado pagar. Sempre uma ação
    explícita (nunca detecção automática de "associado pagou adiantado")."""
    plano = db.query(PlanoDeContribuicao).filter(PlanoDeContribuicao.id_plano == id_plano_contribuicao, PlanoDeContribuicao.ativo.is_(True)).first()
    if not plano:
        raise HTTPException(status_code=404, detail="Plano de contribuição não encontrado ou inativo.")
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    if associado.status_arrolamento not in STATUS_ELEGIVEIS_PARA_COBRANCA:
        raise HTTPException(status_code=400, detail=f"Associado com status '{associado.status_arrolamento}' não é elegível para cobrança.")

    data_referencia = data_vencimento_da_competencia(competencia_inicio, 1)
    campanha = campanha_vigente(db, data_referencia)
    if not campanha:
        raise HTTPException(status_code=400, detail="Nenhuma campanha de desconto por pagamento antecipado vigente nesta data.")
    mes_inicio = _mes_ano(competencia_inicio)[1]
    if mes_inicio not in _meses_gatilho(campanha):
        raise HTTPException(status_code=400, detail=f"'{competencia_inicio}' não é um mês-gatilho desta campanha (meses válidos: {sorted(_meses_gatilho(campanha))}).")

    competencia_fim = _somar_meses(competencia_inicio, campanha.quantidade_meses - 1)
    conflito = (
        db.query(TituloFinanceiro)
        .filter(
            TituloFinanceiro.id_associado == id_associado,
            TituloFinanceiro.id_plano_contribuicao == id_plano_contribuicao,
            TituloFinanceiro.competencia <= competencia_fim,
            (TituloFinanceiro.competencia_fim.is_(None) & (TituloFinanceiro.competencia >= competencia_inicio))
            | (TituloFinanceiro.competencia_fim.isnot(None) & (TituloFinanceiro.competencia_fim >= competencia_inicio)),
        )
        .first()
    )
    if conflito:
        raise HTTPException(status_code=400, detail=f"Já existe título (#{conflito.id_titulo}) cobrindo algum mês entre {competencia_inicio} e {competencia_fim} para este associado/plano.")

    valor_base = valor_vigente(db, plano.id_plano, data_referencia)
    percentual_isencao = _percentual_isencao(db, id_associado, plano.id_plano, data_referencia)
    valor_bruto_bloco = valor_base * campanha.quantidade_meses
    valor_final = (
        valor_bruto_bloco
        * (Decimal("100") - percentual_isencao) / Decimal("100")
        * (Decimal("100") - campanha.percentual_desconto) / Decimal("100")
    ).quantize(Decimal("0.01"))
    if valor_final <= 0:
        raise HTTPException(status_code=400, detail="Valor do bloco ficaria zero ou negativo (isenção + desconto somados excedem 100%).")

    titulo = TituloFinanceiro(
        tipo_titulo="A Receber", id_conta_contabil=campanha.id_conta_contabil_receita_diferida,
        id_associado=id_associado,
        descricao=f"{plano.descricao} — bloco de {campanha.quantidade_meses} meses ({competencia_inicio} a {competencia_fim}), desconto de {campanha.percentual_desconto}% por pagamento antecipado",
        valor_original=valor_final, saldo_devedor=valor_final,
        data_vencimento=data_vencimento_da_competencia(competencia_inicio, plano.dia_vencimento),
        status="Pendente", id_plano_contribuicao=plano.id_plano,
        competencia=competencia_inicio, competencia_fim=competencia_fim,
        id_campanha_desconto_antecipado=campanha.id_campanha,
    )
    db.add(titulo)
    db.commit()
    db.refresh(titulo)
    return titulo


def reconhecer_receita_diferida_do_mes(db: Session, *, competencia: str, id_usuario: Optional[int] = None) -> list[dict]:
    """v3.2.3 - pra cada título-bloco já PAGO (o dinheiro só existe na conta de receita diferida
    depois de baixado - baixa parcial não reconhece nada até o bloco inteiro estar quitado) cuja
    janela já começou, reclassifica a fatia de cada mês de Passivo (receita diferida) pra
    Receita real do plano - lançamento que NUNCA mexe em caixa (só reclassificação entre contas).
    Idempotente de verdade via `ReconhecimentoReceitaDiferida.uq_reconhecimento_por_competencia`:
    chamar de novo pra mesma competência não duplica nada. Chamado automaticamente dentro da
    rotina mensal de `gerar_cobrancas`, não é uma ação separada que alguém precisa lembrar de
    rodar.

    v9.6a - o título do semestre é cobrado em janeiro e julho e a pessoa pode pagar com atraso: os meses do bloco que já passaram e ainda não
    foram reconhecidos são reconhecidos no mês do pagamento, cada um com a sua própria data de competência (antes, os meses antes do
    pagamento ficavam todos no último mês, e um bloco pago depois de terminado nunca saía da receita a reconhecer). A soma nunca passa do valor
    do título: o último mês fica com o que sobrar."""
    filtro = (
        TituloFinanceiro.competencia_fim.isnot(None),
        TituloFinanceiro.status == "Pago",
        TituloFinanceiro.competencia <= competencia,
    )
    blocos = db.query(TituloFinanceiro).filter(*filtro).order_by(TituloFinanceiro.id_titulo).all()
    if not blocos:
        return []
    feitos: dict[int, dict[str, Decimal]] = {}
    for rec in (
        db.query(ReconhecimentoReceitaDiferida)
        .join(TituloFinanceiro, ReconhecimentoReceitaDiferida.id_titulo == TituloFinanceiro.id_titulo)
        .filter(*filtro)
        .all()
    ):
        feitos.setdefault(rec.id_titulo, {})[rec.competencia] = rec.valor

    pendentes: list[tuple[TituloFinanceiro, list[str]]] = []
    for titulo in blocos:
        ja = feitos.get(titulo.id_titulo, {})
        if sum(ja.values(), Decimal("0")) >= titulo.valor_original:
            continue  # já reconhecido por inteiro
        meses, mes = [], titulo.competencia
        while mes <= min(titulo.competencia_fim, competencia):
            if mes not in ja:
                meses.append(mes)
            mes = _somar_meses(mes, 1)
        if meses:
            pendentes.append((titulo, meses))
    if not pendentes:
        return []

    exercicio = contabilidade.exigir_exercicio_aberto(db)
    planos: dict[int, PlanoDeContribuicao] = {}
    resultado = []
    for titulo, meses in pendentes:
        plano = planos.get(titulo.id_plano_contribuicao)
        if plano is None:
            plano = db.query(PlanoDeContribuicao).filter(PlanoDeContribuicao.id_plano == titulo.id_plano_contribuicao).first()
            planos[titulo.id_plano_contribuicao] = plano
        total_meses = _quantidade_meses_entre(titulo.competencia, titulo.competencia_fim)
        soma = sum(feitos.get(titulo.id_titulo, {}).values(), Decimal("0"))
        for mes in meses:
            restante = titulo.valor_original - soma
            if restante <= 0:
                break
            if mes == titulo.competencia_fim:
                # último mês do bloco: absorve o arredondamento, pra soma bater exatamente com o total.
                valor_fatia = restante
            else:
                valor_fatia = min((titulo.valor_original / total_meses).quantize(Decimal("0.01")), restante)

            lancamento = contabilidade.criar_lancamento(
                db, exercicio=exercicio,
                historico=f"Reconhecimento de receita diferida — título-bloco #{titulo.id_titulo}, competência {mes}",
                tipo_origem="RECONHECIMENTO_RECEITA_DIFERIDA",
                partidas=[
                    (titulo.id_conta_contabil, contabilidade.DEBITO, valor_fatia),
                    (plano.id_conta_contabil, contabilidade.CREDITO, valor_fatia),
                ],
                id_titulo=titulo.id_titulo, id_usuario=id_usuario,
                data_competencia=data_vencimento_da_competencia(mes, 1),
            )
            db.add(ReconhecimentoReceitaDiferida(id_titulo=titulo.id_titulo, competencia=mes, valor=valor_fatia, id_lancamento=lancamento.id_lancamento))
            soma += valor_fatia
            resultado.append({"id_titulo": titulo.id_titulo, "competencia": mes, "valor": valor_fatia, "id_lancamento": lancamento.id_lancamento})
    db.commit()
    return resultado


# v9.6a - quantos meses cada periodicidade cobra de uma vez (rótulo do catálogo `periodicidade_contribuicao`, sem diferença de maiúscula). O
# período começa sempre em janeiro: semestral = janeiro a junho e julho a dezembro; anual = o ano todo (decisão do Presidente, 21/11/2026).
MESES_DA_PERIODICIDADE = {"mensal": 1, "bimestral": 2, "trimestral": 3, "semestral": 6, "anual": 12}
_NOME_DO_MES = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro")


def meses_da_periodicidade(periodicidade: Optional[str]) -> Optional[int]:
    """Quantos meses a periodicidade cobra de uma vez, ou None quando o sistema não sabe cobrá-la."""
    return MESES_DA_PERIODICIDADE.get((periodicidade or "").strip().lower())


def periodo_da_competencia(competencia: str, meses: int) -> tuple[str, str]:
    """O período (primeira e última competência) que contém a competência: para 6 meses, "2026-03" -> ("2026-01", "2026-06")."""
    ano, mes = _mes_ano(competencia)
    primeiro = ((mes - 1) // meses) * meses + 1
    inicio = f"{ano:04d}-{primeiro:02d}"
    return inicio, _somar_meses(inicio, meses - 1)


def quando_cobra(meses: int) -> str:
    """Em palavras, quando o plano é cobrado: "todo mês", "em janeiro e julho", "em janeiro"."""
    if meses <= 1:
        return "todo mês"
    nomes = [_NOME_DO_MES[m - 1] for m in range(1, 13, meses)]
    return "em " + (nomes[0] if len(nomes) == 1 else ", ".join(nomes[:-1]) + " e " + nomes[-1])


def _mes_ano_br(competencia: str) -> str:
    ano, mes = _mes_ano(competencia)
    return f"{mes:02d}/{ano}"


def _meses_cobertos(db: Session, id_associado: int, inicio: str, fim: str) -> set[str]:
    """As competências entre `inicio` e `fim` que já têm cobrança de contribuição deste associado (título do mês ou de um bloco/período que
    cubra o mês), em qualquer plano - nunca cobrar o mesmo mês duas vezes, nem quando a pessoa muda de mensal para semestral no meio do caminho."""
    cobertos: set[str] = set()
    titulos = (
        db.query(TituloFinanceiro)
        .filter(
            TituloFinanceiro.id_associado == id_associado,
            TituloFinanceiro.id_plano_contribuicao.isnot(None),
            TituloFinanceiro.competencia.isnot(None),
            TituloFinanceiro.competencia <= fim,
        )
        .all()
    )
    for t in titulos:
        ultimo = t.competencia_fim or t.competencia
        if ultimo < inicio:
            continue
        mes = max(t.competencia, inicio)
        while mes <= min(ultimo, fim):
            cobertos.add(mes)
            mes = _somar_meses(mes, 1)
    return cobertos


def gerar_cobrancas(db: Session, *, competencia: str, confirmar: bool, id_usuario: Optional[int] = None) -> dict:
    """Geração em lote de `TituloFinanceiro` (A Receber) por competência, sempre com prévia
    disponível (`confirmar=False` não grava nada) e sempre idempotente: rodar duas vezes na
    mesma competência nunca duplica cobrança - a `UniqueConstraint` do modelo é a trava real,
    a checagem aqui só evita fazer trabalho à toa.

    v9.6a (decisão do Presidente, 21/11/2026) - cada associado é cobrado SÓ pelo plano ativo da sua categoria com a periodicidade que ele
    escolheu (`Associado.periodicidade_contribuicao`; antes, todo plano ativo era cobrado todo mês - um plano semestral sairia todo mês):
    - mensal: um título por mês, como sempre;
    - semestral (e anual): um título do PERÍODO (janeiro-junho e julho-dezembro; o ano todo), com o valor próprio do plano, na conta de
      receita a reconhecer do plano (vira receita mês a mês, `reconhecer_receita_diferida_do_mes`). Quem fica de fora da cobrança de janeiro
      ou julho (entrou depois, estava licenciado, passou a semestral no meio) paga o resto do período: do mês em que é cobrado até o fim,
      proporcional (meses/6 do valor) - igual ao mensal, que também nunca cobra mês em que a pessoa não era cobrada.
    O que não dá para cobrar vira AVISO na resposta (nunca some em silêncio): categoria com dois planos ativos da mesma periodicidade,
    periodicidade que o sistema não sabe cobrar, plano não mensal sem a conta de receita a reconhecer, e quem escolheu uma forma de pagamento
    que a categoria dele não tem."""
    data_referencia = data_vencimento_da_competencia(competencia, 1)  # só pra achar o valor vigente do mês
    planos = db.query(PlanoDeContribuicao).filter(PlanoDeContribuicao.ativo.is_(True)).order_by(PlanoDeContribuicao.id_plano).all()

    avisos: list[str] = []
    por_chave: dict[tuple[str, str], list[PlanoDeContribuicao]] = {}
    for plano in planos:
        por_chave.setdefault((plano.categoria, (plano.periodicidade or "").strip().lower()), []).append(plano)
    plano_da_chave: dict[tuple[str, str], PlanoDeContribuicao] = {}
    chaves_com_problema: set[tuple[str, str]] = set()
    categorias_com_plano = {plano.categoria for plano in planos}
    for chave, lista in por_chave.items():
        categoria, _ = chave
        rotulo = lista[0].periodicidade
        if len(lista) > 1:
            chaves_com_problema.add(chave)
            avisos.append(
                f"A categoria {categoria} tem {len(lista)} planos {rotulo.lower()} ativos ({', '.join(p.descricao for p in lista)}): "
                f"ninguém dessa categoria que paga {rotulo.lower()} foi cobrado. Desative os que sobram em Planos de contribuição."
            )
            continue
        plano = lista[0]
        meses = meses_da_periodicidade(plano.periodicidade)
        if meses is None:
            chaves_com_problema.add(chave)
            avisos.append(f"O plano {plano.descricao} tem a periodicidade \"{plano.periodicidade}\", que o sistema não sabe cobrar: ninguém foi cobrado por ele.")
            continue
        if meses > 1 and not plano.id_conta_contabil_receita_diferida:
            chaves_com_problema.add(chave)
            avisos.append(
                f"O plano {plano.descricao} ({rotulo.lower()}) não tem a conta de receita a reconhecer: ninguém foi cobrado por ele. "
                "Informe a conta em Planos de contribuição."
            )
            continue
        plano_da_chave[chave] = plano

    # v9.6a - "já cobrado neste mês" é por associado, em qualquer plano de contribuição (quem trocou de mensal para semestral depois da cobrança
    # do mês não ganha um segundo título do mesmo mês).
    chaves_existentes = {
        t.id_associado
        for t in db.query(TituloFinanceiro).filter(
            TituloFinanceiro.competencia == competencia, TituloFinanceiro.id_plano_contribuicao.isnot(None),
        ).all()
    }
    # v3.2.3 - associado com um título-bloco (pagamento antecipado, ver `gerar_cobranca_bloco`, ou o título do semestre, v9.6a) cuja janela
    # cobre esta competência já está cobrado - a geração pula ele, pra nunca cobrar o mesmo mês duas vezes. v9.6a: vale para QUALQUER plano
    # (quem trocou de semestral para mensal no meio do semestre só volta a ser cobrado por mês depois que o semestre pago acaba).
    cobertos_por_bloco = {
        t.id_associado
        for t in db.query(TituloFinanceiro).filter(
            TituloFinanceiro.competencia_fim.isnot(None),
            TituloFinanceiro.competencia <= competencia,
            TituloFinanceiro.competencia_fim >= competencia,
        ).all()
    }

    detalhes: list[dict] = []
    valor_total = Decimal("0")
    total_gerados = total_ja_existentes = total_dependentes_pulados = total_isentos_totais = total_cobertos_por_bloco = 0
    sem_plano: dict[tuple[str, str], list[Associado]] = {}

    associados = (
        db.query(Associado)
        .filter(Associado.status_arrolamento.in_(STATUS_ELEGIVEIS_PARA_COBRANCA))
        .order_by(Associado.id_associado)
        .all()
    )
    for associado in associados:
        escolha = (associado.periodicidade_contribuicao or "Mensal").strip()
        chave = (associado.categoria, escolha.lower())
        plano = plano_da_chave.get(chave)
        if plano is None:
            # categoria sem plano nenhum (uma categoria que não contribui) segue sem cobrança e sem aviso, como sempre; o aviso é para quem
            # escolheu uma forma de pagamento que a categoria dele não tem
            if chave not in chaves_com_problema and associado.categoria in categorias_com_plano:
                sem_plano.setdefault((associado.categoria, escolha), []).append(associado)
            continue
        meses = meses_da_periodicidade(plano.periodicidade) or 1

        if associado.id_associado in chaves_existentes:
            total_ja_existentes += 1
            continue
        if associado.id_associado in cobertos_por_bloco:
            total_cobertos_por_bloco += 1
            continue
        if plano.cobranca_por_nucleo_familiar and _titular_do_nucleo(db, associado) is not None:
            total_dependentes_pulados += 1
            continue

        data_vencimento = data_vencimento_da_competencia(competencia, plano.dia_vencimento)
        valor_base = valor_vigente(db, plano.id_plano, data_referencia)
        competencia_inicio, competencia_fim = competencia, None
        meses_cobrados = 1
        if meses > 1:
            _, fim_periodo = periodo_da_competencia(competencia, meses)
            competencia_fim = fim_periodo
            # um mês mais adiante já cobrado (título lançado à mão, bloco de pagamento antecipado): o período para antes dele.
            cobertos = _meses_cobertos(db, associado.id_associado, competencia, fim_periodo)
            if cobertos:
                competencia_fim = _somar_meses(min(cobertos), -1)
            meses_cobrados = _quantidade_meses_entre(competencia_inicio, competencia_fim)
            valor_base = (valor_base * meses_cobrados / meses).quantize(Decimal("0.01"))

        percentual = _percentual_isencao(db, associado.id_associado, plano.id_plano, data_vencimento)
        valor_final = (valor_base * (Decimal("100") - percentual) / Decimal("100")).quantize(Decimal("0.01"))
        if valor_final <= 0:
            total_isentos_totais += 1
            continue

        if competencia_fim is None:
            descricao = f"{plano.descricao} — competência {competencia}"
            periodo = _mes_ano_br(competencia)
        else:
            periodo = f"{_mes_ano_br(competencia_inicio)} a {_mes_ano_br(competencia_fim)}"
            descricao = f"{plano.descricao} — {plano.periodicidade.lower()} de {periodo}"
            if meses_cobrados < meses:
                descricao += f" (proporcional: {meses_cobrados} de {meses} meses)"
        detalhes.append({
            "id_associado": associado.id_associado, "nome": associado.nome_completo,
            "id_plano": plano.id_plano, "descricao_plano": plano.descricao, "valor": valor_final,
            "periodicidade": plano.periodicidade, "periodo": periodo, "meses": meses_cobrados, "meses_do_periodo": meses,
        })
        valor_total += valor_final
        total_gerados += 1

        if confirmar:
            db.add(TituloFinanceiro(
                tipo_titulo="A Receber",
                id_conta_contabil=plano.id_conta_contabil if competencia_fim is None else plano.id_conta_contabil_receita_diferida,
                id_associado=associado.id_associado,
                descricao=descricao,
                valor_original=valor_final, saldo_devedor=valor_final,
                data_vencimento=data_vencimento, status="Pendente",
                id_plano_contribuicao=plano.id_plano, competencia=competencia_inicio, competencia_fim=competencia_fim,
            ))

    # o aviso não leva nome (a rotina do dia 1 o grava no log); quem são vai em `associados_sem_plano`, para a tela
    associados_sem_plano: list[dict] = []
    for (categoria, escolha), lista in sorted(sem_plano.items()):
        avisos.append(
            f"{len(lista)} associado(s) da categoria {categoria} pagam {escolha.lower()}, mas não há plano {escolha.lower()} ativo nessa "
            "categoria, então não foram cobrados. Cadastre o plano ou mude a forma de pagamento no cadastro de cada um."
        )
        associados_sem_plano.extend(
            {"id_associado": a.id_associado, "nome": a.nome_completo, "categoria": categoria, "periodicidade": escolha} for a in lista
        )

    reconhecimentos_receita_diferida: list[dict] = []
    if confirmar:
        db.commit()
        # v3.2.3 - mesma rotina mensal que já existe: reconhece a fatia deste mês de qualquer
        # título-bloco pago que cubra esta competência (regime de competência, nunca mexe em
        # caixa) - ninguém precisa lembrar de rodar isso separado.
        reconhecimentos_receita_diferida = reconhecer_receita_diferida_do_mes(db, competencia=competencia, id_usuario=id_usuario)

    return {
        "competencia": competencia, "confirmado": confirmar,
        "total_gerados": total_gerados, "total_ja_existentes": total_ja_existentes,
        "total_dependentes_pulados": total_dependentes_pulados, "total_isentos_totais": total_isentos_totais,
        "total_cobertos_por_bloco": total_cobertos_por_bloco,
        "valor_total": valor_total, "detalhes": detalhes, "avisos": avisos, "associados_sem_plano": associados_sem_plano,
        "reconhecimentos_receita_diferida": reconhecimentos_receita_diferida,
    }


def aplicar_credito(
    db: Session, *, credito: CreditoAssociado, titulo: TituloFinanceiro,
    id_conta_contabil_adiantamento: int, exercicio: Exercicio, id_usuario: Optional[int] = None,
) -> Decimal:
    """Consome um `CreditoAssociado` existente contra um título do MESMO associado, sem tocar em
    caixa (o dinheiro já entrou quando o crédito nasceu - ver `registrar_pagamento_a_maior`).
    Gera lançamento contábil de verdade (débito na conta de adiantamento - reduz o passivo -,
    crédito na conta do título) - crédito de associado nunca é só um número numa tabela solta,
    é razão contábil como qualquer outra movimentação. Retorna o valor efetivamente aplicado."""
    if credito.id_associado != titulo.id_associado:
        raise HTTPException(status_code=400, detail="Este crédito pertence a outro associado.")
    if credito.valor <= 0:
        raise HTTPException(status_code=400, detail="Este crédito já foi totalmente utilizado.")
    if titulo.status == "Pago":
        raise HTTPException(status_code=400, detail="Este título já está totalmente pago.")

    valor_aplicado = min(credito.valor, titulo.saldo_devedor)
    credito.valor -= valor_aplicado
    titulo.saldo_devedor -= valor_aplicado
    if titulo.saldo_devedor <= 0:
        titulo.status = "Pago"
        titulo.saldo_devedor = Decimal("0")

    contabilidade.criar_lancamento(
        db, exercicio=exercicio,
        historico=f"Aplicação de crédito #{credito.id_credito} no título #{titulo.id_titulo}",
        tipo_origem="APLICACAO_CREDITO",
        partidas=[
            (id_conta_contabil_adiantamento, contabilidade.DEBITO, valor_aplicado),
            (titulo.id_conta_contabil, contabilidade.CREDITO, valor_aplicado),
        ],
        id_titulo=titulo.id_titulo, id_usuario=id_usuario,
    )
    return valor_aplicado


def registrar_pagamento_a_maior(
    db: Session, *, titulo: TituloFinanceiro, excedente: Decimal, origem: str,
) -> CreditoAssociado:
    """"Pagamento a maior (crédito em conta do associado)" - o excedente de uma baixa nunca é
    perdido nem devolvido informalmente: vira um `CreditoAssociado` novo, consumível depois em
    qualquer título futuro do mesmo associado (`aplicar_credito`)."""
    if not titulo.id_associado:
        raise HTTPException(status_code=400, detail="Pagamento a maior só é aplicável a título de um associado (crédito precisa de um dono).")
    credito = CreditoAssociado(
        id_associado=titulo.id_associado, valor=excedente, valor_original=excedente,
        origem=origem, id_titulo_origem=titulo.id_titulo,
    )
    db.add(credito)
    db.flush()
    return credito
