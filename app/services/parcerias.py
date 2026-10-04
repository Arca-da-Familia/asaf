"""v5.4a (FASE 5) - regras do módulo Parcerias e emendas. As rotas (app/routers/parcerias.py) só traduzem HTTP e
auditam; a API pública (app/routers/publico.py) só chama `serializar_publico`.

Invariantes que os testes (tests/test_parcerias.py) travam:
  - o DINHEIRO vem do razão contábil, pelo centro de custo EXCLUSIVO da parceria: nunca é digitado de novo;
  - soma das parcelas <= valor da parceria; recebido <= valor; pago <= recebido. Violação = erro com o nome do
    registro; no que o razão decide (recebido/pago), a violação TRAVA a aprovação da publicação;
  - lançamento do razão sem classificação TRAVA a aprovação (o site só mostra o que uma pessoa classificou), e depois
    de publicado o site diz só "N lançamentos em classificação" (nunca o detalhe);
  - nenhum texto público tem dado pessoal (CPF, RG, e-mail, celular): o mesmo verificador dos documentos confere
    cada campo de texto que vai ao site;
  - pagamento de EQUIPE vai ao site só com FUNÇÃO e valor, nunca nome; pagamento a FORNECEDOR exige fornecedor
    cadastrado (razão social e CNPJ);
  - quem criou ou enviou para revisão NÃO aprova: a aprovação é de outra pessoa (permissão `aprovar_publicacao`);
  - "Concluída" só com prestação de contas FINAL apresentada; resultado do relatório só depois de apresentado."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.financeiro import CentroDeCusto, Fornecedor, LancamentoContabil, PartidaContabil, PlanoDeContas, TituloFinanceiro
from app.models.parcerias import (
    APROVADO, CATEGORIA_EQUIPE, CATEGORIA_FORNECEDOR, CATEGORIAS_DE_PAGAMENTO, CONCLUIDA, EM_ANALISE, EM_EXECUCAO,
    EM_PRESTACAO, EM_REVISAO, ESFERAS, ETAPA_PREVISTA, NATUREZAS, PAGAMENTO, PRAZO_DE_ANALISE_PADRAO_EM_DIAS, PROPOSTA,
    RASCUNHO, RECEBIMENTO, RELATORIO_FINAL, RESULTADOS, RETIRADO, SITUACOES, SITUACOES_DE_ETAPA, TERMO_ASSINADO,
    TIPOS, TIPOS_DE_RELATORIO, EtapaParceria, LancamentoDaParceria, ParcelaParceria, Parceria, RelatorioParceria,
)
from app.models.documentos import APROVADO as DOCUMENTO_APROVADO, DocumentoInstitucional
from app.services.contabilidade import CREDITO, DEBITO
from app.services.documentos_verificacao import procurar_dado_pessoal

MOTIVO_MINIMO = 10
CENTAVO = Decimal("0.01")
SITUACOES_QUE_EXIGEM_TERMO = (TERMO_ASSINADO, EM_EXECUCAO, EM_PRESTACAO, CONCLUIDA)


# ------------------------------------------------------------------------------------------------ utilitários
def _dinheiro(valor, campo: str) -> Decimal:
    try:
        v = Decimal(str(valor)).quantize(CENTAVO, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail=f"{campo}: valor inválido.")
    if v <= 0:
        raise HTTPException(status_code=400, detail=f"{campo}: o valor precisa ser maior que zero.")
    return v


def _data(valor, campo: str) -> date | None:
    if valor in (None, ""):
        return None
    if isinstance(valor, date) and not isinstance(valor, datetime):
        return valor
    try:
        return date.fromisoformat(str(valor)[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{campo}: data inválida (use AAAA-MM-DD).")


def _texto(valor, campo: str, *, minimo: int = 0, maximo: int = 200, obrigatorio: bool = False) -> str | None:
    texto = (valor or "").strip()
    if not texto:
        if obrigatorio:
            raise HTTPException(status_code=400, detail=f"{campo}: preenchimento obrigatório.")
        return None
    if len(texto) < minimo or len(texto) > maximo:
        raise HTTPException(status_code=400, detail=f"{campo}: use de {minimo} a {maximo} caracteres.")
    return texto


def _tocar(parceria: Parceria) -> None:
    """Qualquer mudança em parceria ou nas partes dela atualiza a data que o site mostra como 'última atualização'."""
    parceria.atualizado_em = datetime.utcnow()


def exigir_texto_sem_dado_pessoal(campos: dict[str, str | None]) -> None:
    """Todo texto que vai ao site passa pelo verificador dos documentos: CPF, RG, e-mail e celular de pessoa."""
    for nome, texto in campos.items():
        if not texto:
            continue
        bloqueios, _ = procurar_dado_pessoal(texto)
        if bloqueios:
            achado = bloqueios[0]
            raise HTTPException(
                status_code=422,
                detail=f"O campo '{nome}' vai ao site e parece conter dado pessoal ({achado.mensagem.split(' na versão')[0]}"
                       f"{': ' + achado.amostra if achado.amostra else ''}). Tire esse dado do texto.",
            )


def buscar(db: Session, id_parceria: int) -> Parceria:
    parceria = db.query(Parceria).filter(Parceria.id_parceria == id_parceria).first()
    if not parceria:
        raise HTTPException(status_code=404, detail="Parceria não encontrada.")
    return parceria


def _parcela(db: Session, parceria: Parceria, id_parcela: int) -> ParcelaParceria:
    p = db.query(ParcelaParceria).filter(ParcelaParceria.id_parcela == id_parcela, ParcelaParceria.id_parceria == parceria.id_parceria).first()
    if not p:
        raise HTTPException(status_code=404, detail="Parcela não encontrada nesta parceria.")
    return p


# ------------------------------------------------------------------------------------------------ cadastro
_CAMPOS_TEXTO_PUBLICOS = ("titulo", "objeto", "orgao_concedente", "proponente", "numero_emenda", "numero_termo", "identificador_unico")


def _validar_parceria(dados: dict, atual: Parceria | None) -> dict:
    limpo: dict = {}
    if "tipo" in dados:
        if dados["tipo"] not in TIPOS:
            raise HTTPException(status_code=400, detail=f"Tipo inválido. Use um destes: {', '.join(TIPOS)}.")
        limpo["tipo"] = dados["tipo"]
    if "ano" in dados:
        try:
            ano = int(dados["ano"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Ano inválido.")
        if not 2000 <= ano <= 2100:
            raise HTTPException(status_code=400, detail="Ano inválido (entre 2000 e 2100).")
        limpo["ano"] = ano
    if "titulo" in dados:
        limpo["titulo"] = _texto(dados["titulo"], "Título", minimo=3, maximo=200, obrigatorio=True)
    if "objeto" in dados:
        limpo["objeto"] = _texto(dados["objeto"], "Objeto", minimo=10, maximo=4000, obrigatorio=True)
    if "esfera" in dados:
        if dados["esfera"] and dados["esfera"] not in ESFERAS:
            raise HTTPException(status_code=400, detail=f"Esfera inválida. Use: {', '.join(ESFERAS)}.")
        limpo["esfera"] = dados["esfera"] or None
    for campo, maximo in (("orgao_concedente", 200), ("numero_emenda", 40), ("identificador_unico", 60), ("proponente", 200), ("numero_termo", 60)):
        if campo in dados:
            limpo[campo] = _texto(dados[campo], campo.replace("_", " ").capitalize(), maximo=maximo)
    if "valor_total" in dados:
        limpo["valor_total"] = _dinheiro(dados["valor_total"], "Valor total")
    for campo in ("data_assinatura", "vigencia_inicio", "vigencia_fim"):
        if campo in dados:
            limpo[campo] = _data(dados[campo], campo.replace("_", " ").capitalize())
    if "situacao" in dados:
        if dados["situacao"] not in SITUACOES:
            raise HTTPException(status_code=400, detail=f"Situação inválida. Use uma destas: {', '.join(SITUACOES)}.")
        limpo["situacao"] = dados["situacao"]

    inicio = limpo.get("vigencia_inicio", atual.vigencia_inicio if atual else None)
    fim = limpo.get("vigencia_fim", atual.vigencia_fim if atual else None)
    if inicio and fim and fim < inicio:
        raise HTTPException(status_code=400, detail="A vigência termina antes de começar.")
    return limpo


def _exigir_identificador_livre(db: Session, identificador: str | None, atual: Parceria | None) -> None:
    if not identificador:
        return
    outro = db.query(Parceria).filter(Parceria.identificador_unico == identificador).first()
    if outro and (atual is None or outro.id_parceria != atual.id_parceria):
        raise HTTPException(status_code=409, detail=f"O identificador único '{identificador}' já está na parceria nº {outro.id_parceria} ({outro.titulo}).")


def total_das_parcelas(db: Session, parceria: Parceria) -> Decimal:
    return sum((p.valor_previsto for p in db.query(ParcelaParceria).filter(ParcelaParceria.id_parceria == parceria.id_parceria)), Decimal("0"))


def criar_parceria(db: Session, usuario, dados: dict) -> Parceria:
    obrigatorios = ("tipo", "ano", "titulo", "objeto", "valor_total")
    faltando = [c for c in obrigatorios if dados.get(c) in (None, "")]
    if faltando:
        raise HTTPException(status_code=400, detail=f"Preencha: {', '.join(faltando)}.")
    campos = _validar_parceria(dados, None)
    if campos.get("situacao") in SITUACOES_QUE_EXIGEM_TERMO and not campos.get("numero_termo"):
        raise HTTPException(status_code=400, detail="Informe o número do termo para uma parceria com termo assinado.")
    _exigir_identificador_livre(db, campos.get("identificador_unico"), None)
    exigir_texto_sem_dado_pessoal({c: campos.get(c) for c in _CAMPOS_TEXTO_PUBLICOS})

    parceria = Parceria(**campos, id_usuario_criacao=usuario.id_usuario, situacao_publicacao=RASCUNHO)
    parceria.situacao = campos.get("situacao", PROPOSTA)
    db.add(parceria)
    db.flush()  # precisa do id para o código do centro de custo
    centro = CentroDeCusto(codigo=f"PARC-{parceria.id_parceria:04d}", nome=f"Parceria: {parceria.titulo}"[:120], ativo=True, saldo_restrito=False)
    db.add(centro)
    db.flush()
    parceria.id_centro_custo = centro.id_centro_custo
    db.commit()
    return parceria


def editar_parceria(db: Session, usuario, parceria: Parceria, dados: dict) -> Parceria:
    campos = _validar_parceria(dados, parceria)
    novo_valor = campos.get("valor_total")
    if novo_valor is not None:
        soma = total_das_parcelas(db, parceria)
        if novo_valor < soma:
            raise HTTPException(
                status_code=409,
                detail=f"O valor total (R$ {novo_valor}) não pode ficar abaixo da soma das parcelas já cadastradas (R$ {soma}).",
            )
        recebido = resumo_financeiro(db, parceria)["recebido"]
        if novo_valor < recebido:
            raise HTTPException(status_code=409, detail=f"O valor total (R$ {novo_valor}) não pode ficar abaixo do que já foi recebido (R$ {recebido}).")
    if "identificador_unico" in campos:
        _exigir_identificador_livre(db, campos["identificador_unico"], parceria)
    exigir_texto_sem_dado_pessoal({c: campos[c] for c in _CAMPOS_TEXTO_PUBLICOS if c in campos})

    situacao_nova = campos.get("situacao")
    if situacao_nova and situacao_nova != parceria.situacao:
        numero_termo = campos.get("numero_termo", parceria.numero_termo)
        if situacao_nova in SITUACOES_QUE_EXIGEM_TERMO and not numero_termo:
            raise HTTPException(status_code=409, detail=f"Informe o número do termo antes de mudar a situação para '{situacao_nova}'.")
        if situacao_nova == CONCLUIDA and not _tem_prestacao_final_apresentada(db, parceria):
            raise HTTPException(
                status_code=409,
                detail="Só dá para marcar como Concluída depois de apresentar a prestação de contas FINAL (cadastre o relatório final com a data de apresentação).",
            )
    for campo, valor in campos.items():
        setattr(parceria, campo, valor)
    _tocar(parceria)
    db.commit()
    return parceria


# ------------------------------------------------------------------------------------------------ parcelas
def criar_parcela(db: Session, parceria: Parceria, dados: dict) -> ParcelaParceria:
    valor = _dinheiro(dados.get("valor_previsto"), "Valor previsto da parcela")
    soma = total_das_parcelas(db, parceria)
    if soma + valor > parceria.valor_total:
        raise HTTPException(
            status_code=409,
            detail=f"A soma das parcelas (R$ {soma} + R$ {valor}) passaria do valor total da parceria (R$ {parceria.valor_total}).",
        )
    numero = dados.get("numero")
    if numero in (None, ""):
        ultimo = db.query(ParcelaParceria).filter(ParcelaParceria.id_parceria == parceria.id_parceria).count()
        numero = ultimo + 1
    numero = int(numero)
    if db.query(ParcelaParceria).filter(ParcelaParceria.id_parceria == parceria.id_parceria, ParcelaParceria.numero == numero).first():
        raise HTTPException(status_code=409, detail=f"A parcela {numero} já existe nesta parceria.")
    parcela = ParcelaParceria(
        id_parceria=parceria.id_parceria, numero=numero, valor_previsto=valor,
        data_prevista=_data(dados.get("data_prevista"), "Data prevista"), observacao=_texto(dados.get("observacao"), "Observação", maximo=200),
    )
    exigir_texto_sem_dado_pessoal({"observação da parcela": parcela.observacao})
    db.add(parcela)
    _tocar(parceria)
    db.commit()
    return parcela


def editar_parcela(db: Session, parceria: Parceria, id_parcela: int, dados: dict) -> ParcelaParceria:
    parcela = _parcela(db, parceria, id_parcela)
    if "valor_previsto" in dados:
        valor = _dinheiro(dados["valor_previsto"], "Valor previsto da parcela")
        soma_das_outras = total_das_parcelas(db, parceria) - parcela.valor_previsto
        if soma_das_outras + valor > parceria.valor_total:
            raise HTTPException(
                status_code=409,
                detail=f"A soma das parcelas (R$ {soma_das_outras + valor}) passaria do valor total da parceria (R$ {parceria.valor_total}).",
            )
        parcela.valor_previsto = valor
    if "data_prevista" in dados:
        parcela.data_prevista = _data(dados["data_prevista"], "Data prevista")
    if "observacao" in dados:
        parcela.observacao = _texto(dados["observacao"], "Observação", maximo=200)
        exigir_texto_sem_dado_pessoal({"observação da parcela": parcela.observacao})
    _tocar(parceria)
    db.commit()
    return parcela


def excluir_parcela(db: Session, parceria: Parceria, id_parcela: int) -> ParcelaParceria:
    parcela = _parcela(db, parceria, id_parcela)
    if db.query(LancamentoDaParceria).filter(LancamentoDaParceria.id_parcela == parcela.id_parcela).first():
        raise HTTPException(status_code=409, detail="Esta parcela tem recebimento ligado a ela: desfaça a ligação antes de apagar.")
    db.delete(parcela)
    _tocar(parceria)
    db.commit()
    return parcela


# ------------------------------------------------------------------------------------------------ etapas
def _validar_etapa(dados: dict, parcial: bool) -> dict:
    limpo: dict = {}
    if not parcial or "titulo" in dados:
        limpo["titulo"] = _texto(dados.get("titulo"), "Título da etapa", minimo=3, maximo=200, obrigatorio=True)
    for campo, rotulo, maximo in (("descricao", "Descrição da etapa", 4000), ("local", "Local", 200)):
        if campo in dados:
            limpo[campo] = _texto(dados[campo], rotulo, maximo=maximo)
    for campo, rotulo in (("data_prevista", "Data prevista"), ("data_realizacao", "Data de realização")):
        if campo in dados:
            limpo[campo] = _data(dados[campo], rotulo)
    if "publico_atendido" in dados:
        valor = dados["publico_atendido"]
        if valor in (None, ""):
            limpo["publico_atendido"] = None
        else:
            try:
                valor = int(valor)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Público atendido: informe um número inteiro.")
            if valor < 0:
                raise HTTPException(status_code=400, detail="Público atendido: não pode ser negativo.")
            limpo["publico_atendido"] = valor
    if "situacao" in dados:
        if dados["situacao"] not in SITUACOES_DE_ETAPA:
            raise HTTPException(status_code=400, detail=f"Situação da etapa inválida. Use: {', '.join(SITUACOES_DE_ETAPA)}.")
        limpo["situacao"] = dados["situacao"]
    return limpo


def _conferir_etapa(etapa: EtapaParceria) -> None:
    if etapa.situacao == "Realizada" and not etapa.data_realizacao:
        raise HTTPException(status_code=409, detail=f"Etapa '{etapa.titulo}': informe a data de realização para marcá-la como Realizada.")
    exigir_texto_sem_dado_pessoal({"título da etapa": etapa.titulo, "descrição da etapa": etapa.descricao, "local da etapa": etapa.local})


def criar_etapa(db: Session, parceria: Parceria, dados: dict) -> EtapaParceria:
    etapa = EtapaParceria(id_parceria=parceria.id_parceria, **{"situacao": ETAPA_PREVISTA, **_validar_etapa(dados, parcial=False)})
    _conferir_etapa(etapa)
    db.add(etapa)
    _tocar(parceria)
    db.commit()
    return etapa


def _etapa(db: Session, parceria: Parceria, id_etapa: int) -> EtapaParceria:
    e = db.query(EtapaParceria).filter(EtapaParceria.id_etapa == id_etapa, EtapaParceria.id_parceria == parceria.id_parceria).first()
    if not e:
        raise HTTPException(status_code=404, detail="Etapa não encontrada nesta parceria.")
    return e


def editar_etapa(db: Session, parceria: Parceria, id_etapa: int, dados: dict) -> EtapaParceria:
    etapa = _etapa(db, parceria, id_etapa)
    for campo, valor in _validar_etapa(dados, parcial=True).items():
        setattr(etapa, campo, valor)
    _conferir_etapa(etapa)
    _tocar(parceria)
    db.commit()
    return etapa


def excluir_etapa(db: Session, parceria: Parceria, id_etapa: int) -> EtapaParceria:
    etapa = _etapa(db, parceria, id_etapa)
    db.delete(etapa)
    _tocar(parceria)
    db.commit()
    return etapa


# ------------------------------------------------------------------------------------------------ relatórios
def _tem_prestacao_final_apresentada(db: Session, parceria: Parceria) -> bool:
    return db.query(RelatorioParceria).filter(
        RelatorioParceria.id_parceria == parceria.id_parceria, RelatorioParceria.tipo == RELATORIO_FINAL,
        RelatorioParceria.data_apresentacao.isnot(None),
    ).first() is not None


def _validar_relatorio(dados: dict, parcial: bool) -> dict:
    limpo: dict = {}
    if not parcial or "tipo" in dados:
        if dados.get("tipo") not in TIPOS_DE_RELATORIO:
            raise HTTPException(status_code=400, detail=f"Tipo de relatório inválido. Use: {', '.join(TIPOS_DE_RELATORIO)}.")
        limpo["tipo"] = dados["tipo"]
    for campo, rotulo in (("periodo_inicio", "Início do período"), ("periodo_fim", "Fim do período"), ("data_prevista", "Data prevista"),
                          ("data_apresentacao", "Data de apresentação"), ("data_resultado", "Data do resultado")):
        if campo in dados:
            limpo[campo] = _data(dados[campo], rotulo)
    if "prazo_analise_dias" in dados:
        try:
            dias = int(dados["prazo_analise_dias"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Prazo de análise: informe um número de dias.")
        if not 1 <= dias <= 730:
            raise HTTPException(status_code=400, detail="Prazo de análise: entre 1 e 730 dias.")
        limpo["prazo_analise_dias"] = dias
    if "resultado" in dados:
        if dados["resultado"] not in RESULTADOS:
            raise HTTPException(status_code=400, detail=f"Resultado inválido. Use: {', '.join(RESULTADOS)}.")
        limpo["resultado"] = dados["resultado"]
    if "observacao" in dados:
        limpo["observacao"] = _texto(dados["observacao"], "Observação", maximo=4000)
    return limpo


def _conferir_relatorio(r: RelatorioParceria) -> None:
    nome = TIPOS_DE_RELATORIO[r.tipo]
    if r.periodo_inicio and r.periodo_fim and r.periodo_fim < r.periodo_inicio:
        raise HTTPException(status_code=400, detail=f"{nome}: o período termina antes de começar.")
    if r.resultado != EM_ANALISE:
        if not r.data_apresentacao:
            raise HTTPException(status_code=409, detail=f"{nome}: só pode ter resultado ('{r.resultado}') depois de apresentado (informe a data de apresentação).")
        if not r.data_resultado:
            raise HTTPException(status_code=409, detail=f"{nome}: informe a data do resultado ('{r.resultado}').")
        if r.data_resultado < r.data_apresentacao:
            raise HTTPException(status_code=400, detail=f"{nome}: a data do resultado é anterior à apresentação.")


def criar_relatorio(db: Session, parceria: Parceria, dados: dict) -> RelatorioParceria:
    padrao = {"resultado": EM_ANALISE, "prazo_analise_dias": PRAZO_DE_ANALISE_PADRAO_EM_DIAS}
    r = RelatorioParceria(id_parceria=parceria.id_parceria, **{**padrao, **_validar_relatorio(dados, parcial=False)})
    _conferir_relatorio(r)
    db.add(r)
    _tocar(parceria)
    db.commit()
    return r


def _relatorio(db: Session, parceria: Parceria, id_relatorio: int) -> RelatorioParceria:
    r = db.query(RelatorioParceria).filter(RelatorioParceria.id_relatorio == id_relatorio, RelatorioParceria.id_parceria == parceria.id_parceria).first()
    if not r:
        raise HTTPException(status_code=404, detail="Relatório não encontrado nesta parceria.")
    return r


def editar_relatorio(db: Session, parceria: Parceria, id_relatorio: int, dados: dict) -> RelatorioParceria:
    r = _relatorio(db, parceria, id_relatorio)
    for campo, valor in _validar_relatorio(dados, parcial=True).items():
        setattr(r, campo, valor)
    _conferir_relatorio(r)
    _tocar(parceria)
    db.commit()
    return r


def excluir_relatorio(db: Session, parceria: Parceria, id_relatorio: int) -> RelatorioParceria:
    r = _relatorio(db, parceria, id_relatorio)
    if r.data_apresentacao:
        raise HTTPException(status_code=409, detail="Relatório já apresentado não se apaga (a prestação de contas fica no histórico).")
    db.delete(r)
    _tocar(parceria)
    db.commit()
    return r


def data_limite_de_analise(r: RelatorioParceria) -> date | None:
    return r.data_apresentacao + timedelta(days=r.prazo_analise_dias) if r.data_apresentacao else None


# ------------------------------------------------------------------------------------------------ razão (dinheiro)
def _lancamentos_do_centro(db: Session, parceria: Parceria) -> dict[int, dict]:
    """Por lançamento do razão que tem partida no centro de custo da parceria: receita líquida, despesa líquida,
    data de caixa, histórico e se foi estornado / é o estorno de outro."""
    if parceria.id_centro_custo is None:
        return {}
    linhas = (
        db.query(LancamentoContabil, PartidaContabil, PlanoDeContas)
        .join(PartidaContabil, PartidaContabil.id_lancamento == LancamentoContabil.id_lancamento)
        .join(PlanoDeContas, PlanoDeContas.id_conta == PartidaContabil.id_conta)
        .filter(PartidaContabil.id_centro_custo == parceria.id_centro_custo, PlanoDeContas.tipo.in_(("Receita", "Despesa")))
        .order_by(LancamentoContabil.data_lancamento, LancamentoContabil.id_lancamento)
        .all()
    )
    por_lancamento: dict[int, dict] = {}
    for lancamento, partida, conta in linhas:
        item = por_lancamento.setdefault(lancamento.id_lancamento, {
            "id_lancamento": lancamento.id_lancamento, "data": lancamento.data_lancamento, "historico": lancamento.historico,
            "id_titulo": lancamento.id_titulo, "estornado": bool(lancamento.estornado),
            "id_lancamento_estorno": lancamento.id_lancamento_estorno,
            "receita": Decimal("0"), "despesa": Decimal("0"), "numero": lancamento.numero_sequencial,
        })
        sinal_receita = 1 if partida.tipo_partida == CREDITO else -1
        sinal_despesa = 1 if partida.tipo_partida == DEBITO else -1
        if conta.tipo == "Receita":
            item["receita"] += sinal_receita * partida.valor
        else:
            item["despesa"] += sinal_despesa * partida.valor
    ids_de_estorno = {i["id_lancamento_estorno"] for i in por_lancamento.values() if i["id_lancamento_estorno"]}
    for item in por_lancamento.values():
        item["e_estorno"] = item["id_lancamento"] in ids_de_estorno
    return por_lancamento


def resumo_financeiro(db: Session, parceria: Parceria) -> dict:
    itens = _lancamentos_do_centro(db, parceria).values()
    recebido = sum((i["receita"] for i in itens), Decimal("0"))
    pago = sum((i["despesa"] for i in itens), Decimal("0"))
    return {"valor_total": parceria.valor_total, "recebido": recebido, "pago": pago, "saldo": recebido - pago}


def lancamentos_nao_classificados(db: Session, parceria: Parceria) -> list[dict]:
    """Movimentos reais do centro de custo que ninguém classificou para o site (estornos e estornados não contam)."""
    ligados = {v.id_lancamento for v in db.query(LancamentoDaParceria).filter(LancamentoDaParceria.id_parceria == parceria.id_parceria)}
    pendentes = []
    for item in _lancamentos_do_centro(db, parceria).values():
        if item["id_lancamento"] in ligados or item["estornado"] or item["e_estorno"]:
            continue
        if item["receita"] > 0:
            pendentes.append({**item, "natureza": RECEBIMENTO, "valor": item["receita"]})
        elif item["despesa"] > 0:
            pendentes.append({**item, "natureza": PAGAMENTO, "valor": item["despesa"]})
    return pendentes


def _fornecedor_do_lancamento(db: Session, id_titulo: int | None) -> Fornecedor | None:
    if not id_titulo:
        return None
    titulo = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == id_titulo).first()
    if not titulo or not titulo.id_fornecedor:
        return None
    return db.query(Fornecedor).filter(Fornecedor.id_fornecedor == titulo.id_fornecedor).first()


def vincular_lancamento(db: Session, usuario, parceria: Parceria, dados: dict) -> LancamentoDaParceria:
    """Classifica um lançamento do razão para o site: escolhe a natureza, o texto público e (pagamento) a categoria."""
    try:
        id_lancamento = int(dados.get("id_lancamento"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Informe o lançamento do livro-caixa.")
    natureza = dados.get("natureza")
    if natureza not in NATUREZAS:
        raise HTTPException(status_code=400, detail=f"Natureza inválida. Use: {', '.join(NATUREZAS)}.")
    if db.query(LancamentoDaParceria).filter(LancamentoDaParceria.id_lancamento == id_lancamento).first():
        raise HTTPException(status_code=409, detail=f"O lançamento nº {id_lancamento} já está ligado a uma parceria.")
    item = _lancamentos_do_centro(db, parceria).get(id_lancamento)
    if item is None:
        raise HTTPException(
            status_code=409,
            detail=f"O lançamento nº {id_lancamento} não tem partida de receita ou despesa no centro de custo desta parceria "
                   "(lance o movimento no livro-caixa marcando o centro de custo da parceria).",
        )
    if item["estornado"] or item["e_estorno"]:
        raise HTTPException(status_code=409, detail=f"O lançamento nº {id_lancamento} foi estornado (ou é um estorno) e não vai ao site.")
    if natureza == RECEBIMENTO and item["receita"] <= 0:
        raise HTTPException(status_code=409, detail=f"O lançamento nº {id_lancamento} não é um recebimento (não tem receita neste centro de custo).")
    if natureza == PAGAMENTO and item["despesa"] <= 0:
        raise HTTPException(status_code=409, detail=f"O lançamento nº {id_lancamento} não é um pagamento (não tem despesa neste centro de custo).")

    descricao = _texto(dados.get("descricao_publica"), "Descrição pública", minimo=3, maximo=200, obrigatorio=True)
    categoria = dados.get("categoria")
    funcao = _texto(dados.get("funcao"), "Função", maximo=80)
    id_parcela = dados.get("id_parcela")
    if natureza == PAGAMENTO:
        if categoria not in CATEGORIAS_DE_PAGAMENTO:
            raise HTTPException(status_code=400, detail=f"Categoria do pagamento inválida. Use: {', '.join(CATEGORIAS_DE_PAGAMENTO)}.")
        if categoria == CATEGORIA_EQUIPE and not funcao:
            raise HTTPException(status_code=400, detail="Pagamento de equipe: informe a função (o nome da pessoa não vai ao site).")
        if categoria == CATEGORIA_FORNECEDOR and _fornecedor_do_lancamento(db, item["id_titulo"]) is None:
            raise HTTPException(
                status_code=409,
                detail="Pagamento a fornecedor precisa de fornecedor cadastrado (razão social e CNPJ) no título pago. "
                       "Cadastre o fornecedor ou classifique como Equipe, Tarifa ou Outro.",
            )
        id_parcela = None
    else:
        categoria = None
        funcao = None
        if id_parcela not in (None, ""):
            id_parcela = _parcela(db, parceria, int(id_parcela)).id_parcela
        else:
            id_parcela = None
    exigir_texto_sem_dado_pessoal({"descrição pública": descricao, "função": funcao})

    vinculo = LancamentoDaParceria(
        id_parceria=parceria.id_parceria, id_lancamento=id_lancamento, natureza=natureza, id_parcela=id_parcela,
        categoria=categoria, descricao_publica=descricao, funcao=funcao if categoria == CATEGORIA_EQUIPE else None,
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(vinculo)
    _tocar(parceria)
    db.commit()
    return vinculo


def _vinculo(db: Session, parceria: Parceria, id_vinculo: int) -> LancamentoDaParceria:
    v = db.query(LancamentoDaParceria).filter(LancamentoDaParceria.id_vinculo == id_vinculo, LancamentoDaParceria.id_parceria == parceria.id_parceria).first()
    if not v:
        raise HTTPException(status_code=404, detail="Lançamento ligado não encontrado nesta parceria.")
    return v


def editar_vinculo(db: Session, parceria: Parceria, id_vinculo: int, dados: dict) -> LancamentoDaParceria:
    v = _vinculo(db, parceria, id_vinculo)
    if "descricao_publica" in dados:
        v.descricao_publica = _texto(dados["descricao_publica"], "Descrição pública", minimo=3, maximo=200, obrigatorio=True)
    if "funcao" in dados and v.categoria == CATEGORIA_EQUIPE:
        v.funcao = _texto(dados["funcao"], "Função", maximo=80, obrigatorio=True)
    exigir_texto_sem_dado_pessoal({"descrição pública": v.descricao_publica, "função": v.funcao})
    _tocar(parceria)
    db.commit()
    return v


def desvincular(db: Session, parceria: Parceria, id_vinculo: int) -> LancamentoDaParceria:
    v = _vinculo(db, parceria, id_vinculo)
    db.delete(v)
    _tocar(parceria)
    db.commit()
    return v


def lancamentos_ligados(db: Session, parceria: Parceria) -> list[dict]:
    """Os lançamentos classificados, já com valor e data lidos do razão (e fornecedor, quando é o caso)."""
    razao = _lancamentos_do_centro(db, parceria)
    parcelas = {p.id_parcela: p for p in db.query(ParcelaParceria).filter(ParcelaParceria.id_parceria == parceria.id_parceria)}
    saida = []
    for v in db.query(LancamentoDaParceria).filter(LancamentoDaParceria.id_parceria == parceria.id_parceria).order_by(LancamentoDaParceria.id_vinculo):
        item = razao.get(v.id_lancamento)
        valor = (item["receita"] if v.natureza == RECEBIMENTO else item["despesa"]) if item else Decimal("0")
        fornecedor = _fornecedor_do_lancamento(db, item["id_titulo"]) if item and v.categoria == CATEGORIA_FORNECEDOR else None
        saida.append({
            "id_vinculo": v.id_vinculo, "id_lancamento": v.id_lancamento, "natureza": v.natureza,
            "natureza_rotulo": NATUREZAS[v.natureza], "categoria": v.categoria,
            "categoria_rotulo": CATEGORIAS_DE_PAGAMENTO.get(v.categoria) if v.categoria else None,
            "descricao_publica": v.descricao_publica, "funcao": v.funcao,
            "id_parcela": v.id_parcela, "parcela_numero": parcelas[v.id_parcela].numero if v.id_parcela in parcelas else None,
            "data": item["data"] if item else None, "valor": valor, "historico": item["historico"] if item else None,
            "estornado": bool(item and (item["estornado"] or item["e_estorno"])) or item is None,
            "fornecedor": {"razao_social": fornecedor.razao_social, "cnpj": fornecedor.cnpj} if fornecedor else None,
        })
    return saida


# ------------------------------------------------------------------------------------------------ consistência
def consistencia(db: Session, parceria: Parceria) -> dict:
    """{'bloqueios': [...], 'avisos': [...]}. Bloqueio impede aprovar a publicação; aviso só informa a equipe."""
    bloqueios: list[dict] = []
    avisos: list[dict] = []

    def achar(lista, codigo, mensagem):
        lista.append({"codigo": codigo, "mensagem": mensagem})

    nome = f"Parceria nº {parceria.id_parceria} ({parceria.titulo})"
    soma = total_das_parcelas(db, parceria)
    resumo = resumo_financeiro(db, parceria)
    if soma > parceria.valor_total:
        achar(bloqueios, "PARCELAS_ACIMA_DO_VALOR", f"{nome}: a soma das parcelas (R$ {soma}) passa do valor total (R$ {parceria.valor_total}).")
    elif 0 < soma < parceria.valor_total:
        achar(avisos, "PARCELAS_ABAIXO_DO_VALOR", f"{nome}: as parcelas cadastradas somam R$ {soma} de R$ {parceria.valor_total}.")
    if resumo["recebido"] > parceria.valor_total:
        achar(bloqueios, "RECEBIDO_ACIMA_DO_VALOR", f"{nome}: o recebido no livro-caixa (R$ {resumo['recebido']}) passa do valor total (R$ {parceria.valor_total}).")
    if resumo["pago"] > resumo["recebido"]:
        achar(bloqueios, "PAGO_ACIMA_DO_RECEBIDO", f"{nome}: os pagamentos (R$ {resumo['pago']}) passam do que foi recebido (R$ {resumo['recebido']}).")
    pendentes = lancamentos_nao_classificados(db, parceria)
    if pendentes:
        achar(bloqueios, "LANCAMENTOS_SEM_CLASSIFICACAO",
              f"{nome}: {len(pendentes)} lançamento(s) do livro-caixa neste centro de custo ainda não foram classificados para o site "
              f"(nº {', '.join(str(p['id_lancamento']) for p in pendentes[:10])}{'…' if len(pendentes) > 10 else ''}).")
    hoje = date.today()
    if parceria.vigencia_fim and parceria.vigencia_fim < hoje and parceria.situacao in (TERMO_ASSINADO, EM_EXECUCAO):
        achar(avisos, "VIGENCIA_VENCIDA", f"{nome}: a vigência terminou em {parceria.vigencia_fim:%d/%m/%Y} e a situação ainda é '{parceria.situacao}'.")
    for r in db.query(RelatorioParceria).filter(RelatorioParceria.id_parceria == parceria.id_parceria):
        rotulo = TIPOS_DE_RELATORIO[r.tipo]
        if not r.data_apresentacao and r.data_prevista and r.data_prevista < hoje:
            achar(avisos, "RELATORIO_ATRASADO", f"{rotulo} previsto para {r.data_prevista:%d/%m/%Y} ainda não foi apresentado.")
        limite = data_limite_de_analise(r)
        if limite and r.resultado == EM_ANALISE and limite < hoje:
            achar(avisos, "ANALISE_ATRASADA", f"{rotulo}: o prazo de análise ({r.prazo_analise_dias} dias) terminou em {limite:%d/%m/%Y} sem resultado.")
    return {"bloqueios": bloqueios, "avisos": avisos}


# ------------------------------------------------------------------------------------------------ publicação
def _exigir_publicacao(parceria: Parceria, esperada: str, acao: str) -> None:
    if parceria.situacao_publicacao != esperada:
        raise HTTPException(status_code=409, detail=f"Não dá para {acao}: a publicação está '{parceria.situacao_publicacao}' (precisa estar '{esperada}').")


def _exigir_publicavel(db: Session, parceria: Parceria) -> None:
    exigir_texto_sem_dado_pessoal({c: getattr(parceria, c) for c in _CAMPOS_TEXTO_PUBLICOS})
    for v in db.query(LancamentoDaParceria).filter(LancamentoDaParceria.id_parceria == parceria.id_parceria):
        exigir_texto_sem_dado_pessoal({f"descrição pública do lançamento {v.id_lancamento}": v.descricao_publica, "função": v.funcao})
    for e in db.query(EtapaParceria).filter(EtapaParceria.id_parceria == parceria.id_parceria):
        exigir_texto_sem_dado_pessoal({"título da etapa": e.titulo, "descrição da etapa": e.descricao, "local da etapa": e.local})
    achados = consistencia(db, parceria)["bloqueios"]
    if achados:
        raise HTTPException(status_code=409, detail={"mensagem": "A parceria tem pendências que impedem a publicação.", "bloqueios": achados})


def enviar_para_revisao(db: Session, usuario, parceria: Parceria) -> None:
    _exigir_publicacao(parceria, RASCUNHO, "enviar para revisão")
    _exigir_publicavel(db, parceria)
    parceria.situacao_publicacao = EM_REVISAO
    parceria.id_usuario_envio_revisao, parceria.enviado_revisao_em = usuario.id_usuario, datetime.utcnow()
    parceria.motivo_recusa = None
    db.commit()


def aprovar(db: Session, usuario, parceria: Parceria) -> None:
    _exigir_publicacao(parceria, EM_REVISAO, "aprovar a publicação")
    if usuario.id_usuario in (parceria.id_usuario_envio_revisao, parceria.id_usuario_criacao):
        raise HTTPException(
            status_code=403,
            detail="Quem criou ou enviou a parceria para revisão não pode aprová-la: a aprovação é de outra pessoa (Presidente ou Secretário).",
        )
    _exigir_publicavel(db, parceria)
    agora = datetime.utcnow()
    parceria.situacao_publicacao, parceria.id_usuario_aprovacao, parceria.aprovado_em = APROVADO, usuario.id_usuario, agora
    parceria.motivo_recusa = parceria.id_usuario_recusa = parceria.recusado_em = None
    _tocar(parceria)
    db.commit()


def recusar(db: Session, usuario, parceria: Parceria, motivo: str) -> None:
    _exigir_publicacao(parceria, EM_REVISAO, "recusar")
    motivo = (motivo or "").strip()
    if len(motivo) < MOTIVO_MINIMO:
        raise HTTPException(status_code=400, detail=f"Explique o motivo da recusa (pelo menos {MOTIVO_MINIMO} caracteres).")
    parceria.situacao_publicacao = RASCUNHO
    parceria.motivo_recusa, parceria.id_usuario_recusa, parceria.recusado_em = motivo, usuario.id_usuario, datetime.utcnow()
    db.commit()


def retirar(db: Session, usuario, parceria: Parceria, motivo: str) -> None:
    _exigir_publicacao(parceria, APROVADO, "retirar do site")
    motivo = (motivo or "").strip()
    if len(motivo) < MOTIVO_MINIMO:
        raise HTTPException(status_code=400, detail=f"Explique o motivo da retirada (pelo menos {MOTIVO_MINIMO} caracteres).")
    parceria.situacao_publicacao = RETIRADO
    parceria.motivo_retirada, parceria.id_usuario_retirada, parceria.retirado_em = motivo, usuario.id_usuario, datetime.utcnow()
    _tocar(parceria)
    db.commit()


def voltar_a_rascunho(db: Session, parceria: Parceria) -> None:
    """Parceria retirada pode ser corrigida e enviada de novo (o histórico fica na trilha)."""
    _exigir_publicacao(parceria, RETIRADO, "reabrir para correção")
    parceria.situacao_publicacao = RASCUNHO
    db.commit()


# ------------------------------------------------------------------------------------------------ API pública
def _iso(valor) -> str | None:
    return valor.isoformat() if valor else None


def parcerias_publicas(db: Session) -> list[Parceria]:
    return (
        db.query(Parceria).filter(Parceria.situacao_publicacao == APROVADO)
        .order_by(Parceria.ano.desc(), Parceria.id_parceria.desc()).all()
    )


def serializar_publico(db: Session, p: Parceria, *, detalhe: bool = False) -> dict:
    """Campos EXPLÍCITOS (nada interno): nunca usuário, centro de custo, histórico do razão, motivos ou observações."""
    resumo = resumo_financeiro(db, p)
    pendentes = lancamentos_nao_classificados(db, p)
    dados = {
        "id_parceria": p.id_parceria, "tipo_codigo": p.tipo, "tipo": TIPOS.get(p.tipo, p.tipo), "ano": p.ano, "titulo": p.titulo,
        "objeto": p.objeto, "esfera": p.esfera, "orgao_concedente": p.orgao_concedente, "numero_emenda": p.numero_emenda,
        "identificador_unico": p.identificador_unico, "proponente": p.proponente, "numero_termo": p.numero_termo,
        "situacao": p.situacao, "valor_total": resumo["valor_total"], "recebido": resumo["recebido"], "pago": resumo["pago"],
        "data_assinatura": _iso(p.data_assinatura), "vigencia_inicio": _iso(p.vigencia_inicio), "vigencia_fim": _iso(p.vigencia_fim),
        "lancamentos_em_classificacao": len(pendentes),
        "ultima_atualizacao": _iso(p.atualizado_em),
    }
    if not detalhe:
        return dados

    parcelas = db.query(ParcelaParceria).filter(ParcelaParceria.id_parceria == p.id_parceria).order_by(ParcelaParceria.numero).all()
    ligados = [v for v in lancamentos_ligados(db, p) if not v["estornado"]]
    recebido_por_parcela: dict[int, Decimal] = {}
    for v in ligados:
        if v["natureza"] == RECEBIMENTO and v["id_parcela"]:
            recebido_por_parcela[v["id_parcela"]] = recebido_por_parcela.get(v["id_parcela"], Decimal("0")) + v["valor"]
    dados["parcelas"] = [
        {"numero": x.numero, "valor_previsto": x.valor_previsto, "data_prevista": _iso(x.data_prevista),
         "valor_recebido": recebido_por_parcela.get(x.id_parcela, Decimal("0"))}
        for x in parcelas
    ]
    dados["recebimentos"] = [
        {"data": _iso(v["data"]), "valor": v["valor"], "descricao": v["descricao_publica"], "parcela": v["parcela_numero"]}
        for v in ligados if v["natureza"] == RECEBIMENTO
    ]
    dados["pagamentos"] = [
        {
            "data": _iso(v["data"]), "valor": v["valor"], "descricao": v["descricao_publica"], "categoria": v["categoria"],
            # equipe: só a função; fornecedor: razão social e CNPJ; os demais: só a descrição
            "funcao": v["funcao"] if v["categoria"] == CATEGORIA_EQUIPE else None,
            "fornecedor": v["fornecedor"] if v["categoria"] == CATEGORIA_FORNECEDOR else None,
        }
        for v in ligados if v["natureza"] == PAGAMENTO
    ]
    dados["etapas"] = [
        {"titulo": e.titulo, "descricao": e.descricao, "data_prevista": _iso(e.data_prevista), "data_realizacao": _iso(e.data_realizacao),
         "local": e.local, "publico_atendido": e.publico_atendido, "situacao": e.situacao}
        for e in db.query(EtapaParceria).filter(EtapaParceria.id_parceria == p.id_parceria).order_by(EtapaParceria.data_prevista, EtapaParceria.id_etapa)
    ]
    dados["relatorios"] = [
        {"tipo_codigo": r.tipo, "tipo": TIPOS_DE_RELATORIO[r.tipo], "periodo_inicio": _iso(r.periodo_inicio), "periodo_fim": _iso(r.periodo_fim),
         "data_prevista": _iso(r.data_prevista), "data_apresentacao": _iso(r.data_apresentacao),
         "prazo_analise_dias": r.prazo_analise_dias, "data_limite_analise": _iso(data_limite_de_analise(r)),
         "resultado": r.resultado, "data_resultado": _iso(r.data_resultado)}
        for r in db.query(RelatorioParceria).filter(RelatorioParceria.id_parceria == p.id_parceria).order_by(RelatorioParceria.id_relatorio)
    ]
    documentos = (
        db.query(DocumentoInstitucional)
        .filter(DocumentoInstitucional.vinculo_tipo == "parceria", DocumentoInstitucional.vinculo_id == p.id_parceria,
                DocumentoInstitucional.situacao == DOCUMENTO_APROVADO, DocumentoInstitucional.publicar_no_site.is_(True),
                DocumentoInstitucional.publico_nome.isnot(None))
        .order_by(DocumentoInstitucional.id_documento).all()
    )
    dados["documentos"] = [
        {"id_documento": d.id_documento, "titulo": d.titulo, "tipo": d.tipo, "data_documento": _iso(d.data_documento),
         "arquivo": f"/api/publico/transparencia/documentos/{d.id_documento}/arquivo"}
        for d in documentos
    ]
    return dados
