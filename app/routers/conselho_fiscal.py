"""v2.6 (FASE 2) - Conselho Fiscal com poder real: leitura irrestrita do financeiro (auditada a
cada consulta), parecer sobre prestação de contas e fila de questionamentos sobre lançamento.

Leitura financeira aqui usa a mesma permissão `financeiro` já existente (Conselho
Fiscal/Diretoria/Presidente a têm por padrão, v0.1.5) - "irrestrita" é sobre o dado (nada
escondido do conselho), não sobre inventar uma trava nova. Emitir parecer e abrir questionamento,
esses sim são exclusivos de quem tem nível com `is_conselho_fiscal=True` (segregação de função:
quem fiscaliza não é quem lança)."""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.conselho_fiscal import RESPONDIDO, ParecerPrestacaoContas, QuestionamentoLancamento, RespostaQuestionamento
from app.models.financeiro import Fornecedor, LancamentoContabil, PlanoDeContas, TituloFinanceiro
from app.routers.financeiro import _consulta_de_titulos
from app.schemas.conselho_fiscal import AprovacaoEmLoteCriar, DecisaoDeTituloCriar, ParecerCriar, QuestionamentoCriar, RespostaCriar
from app.security import exigir_permissao, get_current_user
from app.services import auditoria_financeira, lancamento_tardio
from app.services.conselho_fiscal import usuario_e_conselho_fiscal

router = APIRouter()
_permissao_financeiro = exigir_permissao("financeiro")


def _exigir_conselho_fiscal(db: Session, usuario) -> Associado:
    if not usuario_e_conselho_fiscal(db, usuario):
        raise HTTPException(status_code=403, detail="Só um membro do Conselho Fiscal pode fazer isso.")
    associado = db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()
    if not associado:
        raise HTTPException(status_code=403, detail="Usuário do Conselho Fiscal não está vinculado a um associado.")
    return associado


# ==========================================
# LEITURA IRRESTRITA DO FINANCEIRO, AUDITADA
# ==========================================
@router.get("/api/conselho-fiscal/financeiro/titulos", summary="Leitura irrestrita de títulos financeiros (auditada)")
def listar_titulos(status: str = None, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    consulta = db.query(TituloFinanceiro)
    if status:
        consulta = consulta.filter(TituloFinanceiro.status == status)
    titulos = consulta.order_by(TituloFinanceiro.data_vencimento.desc()).all()
    registrar_auditoria(db, usuario, "titulos_financeiros", "CONSULTA_CONSELHO_FISCAL", dados_depois={"qtd_resultados": len(titulos), "filtro_status": status})
    return [
        {
            "id_titulo": t.id_titulo, "tipo_titulo": t.tipo_titulo, "id_associado": t.id_associado,
            "id_fornecedor": t.id_fornecedor, "descricao": t.descricao, "valor_original": t.valor_original,
            "saldo_devedor": t.saldo_devedor, "data_emissao": t.data_emissao, "data_vencimento": t.data_vencimento,
            "status": t.status,
        }
        for t in titulos
    ]


@router.get("/api/conselho-fiscal/financeiro/caixa", summary="Leitura irrestrita do razão contábil (auditada)")
def listar_caixa(db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    lancamentos = db.query(LancamentoContabil).order_by(LancamentoContabil.id_exercicio.desc(), LancamentoContabil.numero_sequencial.desc()).all()
    registrar_auditoria(db, usuario, "lancamentos_contabeis", "CONSULTA_CONSELHO_FISCAL", dados_depois={"qtd_resultados": len(lancamentos)})
    return [
        {
            "id_lancamento": l.id_lancamento, "numero_sequencial": l.numero_sequencial, "id_titulo": l.id_titulo,
            "historico": l.historico, "data_lancamento": l.data_lancamento, "forma_pagamento": l.forma_pagamento,
            "estornado": l.estornado,
            "partidas": [{"id_conta": p.id_conta, "tipo_partida": p.tipo_partida, "valor": p.valor} for p in l.partidas],
        }
        for l in lancamentos
    ]


# ==========================================
# PARECER SOBRE PRESTAÇÃO DE CONTAS
# ==========================================
@router.post("/api/conselho-fiscal/pareceres", summary="Emitir parecer sobre prestação de contas")
def emitir_parecer(dados: ParecerCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    conselheiro = _exigir_conselho_fiscal(db, usuario)
    parecer = ParecerPrestacaoContas(
        ano_exercicio=dados.ano_exercicio, tipo=dados.tipo, texto=dados.texto,
        id_associado_conselheiro=conselheiro.id_associado, id_usuario_criacao=usuario.id_usuario,
    )
    db.add(parecer)
    db.commit()
    db.refresh(parecer)
    registrar_auditoria(
        db, usuario, "pareceres_prestacao_contas", "CREATE", id_registro_afetado=parecer.id_parecer,
        dados_depois={"ano_exercicio": parecer.ano_exercicio, "tipo": parecer.tipo},
        ip_origem=request.client.host if request.client else None,
    )
    return {"id_parecer": parecer.id_parecer, "ano_exercicio": parecer.ano_exercicio, "tipo": parecer.tipo}


@router.get("/api/conselho-fiscal/pareceres", summary="Listar pareceres sobre prestação de contas")
def listar_pareceres(ano_exercicio: int = None, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    consulta = db.query(ParecerPrestacaoContas)
    if ano_exercicio is not None:
        consulta = consulta.filter(ParecerPrestacaoContas.ano_exercicio == ano_exercicio)
    pareceres = consulta.order_by(ParecerPrestacaoContas.criado_em.desc()).all()
    return [
        {
            "id_parecer": p.id_parecer, "ano_exercicio": p.ano_exercicio, "tipo": p.tipo, "texto": p.texto,
            "id_associado_conselheiro": p.id_associado_conselheiro, "criado_em": p.criado_em,
        }
        for p in pareceres
    ]


# ==========================================
# FILA DE QUESTIONAMENTOS
# ==========================================
@router.post("/api/financeiro/titulos/{id_titulo}/questionamentos", summary="Questionar um lançamento (Conselho Fiscal)")
def criar_questionamento(id_titulo: int, dados: QuestionamentoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    conselheiro = _exigir_conselho_fiscal(db, usuario)
    if not db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == id_titulo).first():
        raise HTTPException(status_code=404, detail="Título financeiro não encontrado.")
    questionamento = QuestionamentoLancamento(
        id_titulo=id_titulo, id_associado_questionador=conselheiro.id_associado, pergunta=dados.pergunta,
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(questionamento)
    db.commit()
    db.refresh(questionamento)
    registrar_auditoria(
        db, usuario, "questionamentos_lancamento", "CREATE", id_registro_afetado=questionamento.id_questionamento,
        dados_depois={"id_titulo": id_titulo}, ip_origem=request.client.host if request.client else None,
    )
    return {"id_questionamento": questionamento.id_questionamento, "status": questionamento.status}


@router.get("/api/financeiro/titulos/{id_titulo}/questionamentos", summary="Listar questionamentos de um título")
def listar_questionamentos(id_titulo: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    questionamentos = db.query(QuestionamentoLancamento).filter(QuestionamentoLancamento.id_titulo == id_titulo).order_by(QuestionamentoLancamento.criado_em).all()
    return [
        {
            "id_questionamento": q.id_questionamento, "pergunta": q.pergunta, "status": q.status,
            "id_associado_questionador": q.id_associado_questionador, "criado_em": q.criado_em,
        }
        for q in questionamentos
    ]


def _buscar_questionamento_ou_404(db: Session, id_questionamento: int) -> QuestionamentoLancamento:
    questionamento = db.query(QuestionamentoLancamento).filter(QuestionamentoLancamento.id_questionamento == id_questionamento).first()
    if not questionamento:
        raise HTTPException(status_code=404, detail="Questionamento não encontrado.")
    return questionamento


@router.post("/api/questionamentos/{id_questionamento}/respostas", summary="Responder um questionamento (tesouraria)")
def responder_questionamento(id_questionamento: int, dados: RespostaCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    questionamento = _buscar_questionamento_ou_404(db, id_questionamento)
    resposta = RespostaQuestionamento(id_questionamento=id_questionamento, texto=dados.texto, id_usuario_resposta=usuario.id_usuario)
    db.add(resposta)
    questionamento.status = RESPONDIDO
    db.commit()
    db.refresh(resposta)
    registrar_auditoria(
        db, usuario, "respostas_questionamento", "CREATE", id_registro_afetado=resposta.id_resposta,
        dados_depois={"id_questionamento": id_questionamento}, ip_origem=request.client.host if request.client else None,
    )
    return {"id_resposta": resposta.id_resposta, "status_questionamento": questionamento.status}


@router.get("/api/questionamentos/{id_questionamento}/respostas", summary="Listar respostas de um questionamento")
def listar_respostas(id_questionamento: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_financeiro)):
    respostas = db.query(RespostaQuestionamento).filter(RespostaQuestionamento.id_questionamento == id_questionamento).order_by(RespostaQuestionamento.criado_em).all()
    return [{"id_resposta": r.id_resposta, "texto": r.texto, "criado_em": r.criado_em} for r in respostas]


# ==========================================
# AUDITORIA FINANCEIRA (v5.4h): o Conselho Fiscal decide, título a título, o que está certo (regras em app/services/auditoria_financeira.py)
# ==========================================
_MES = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _associado_do_usuario(db: Session, usuario) -> Optional[Associado]:
    return db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()


def _nome_dos_associados(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return {a.id_associado: a.nome_completo for a in db.query(Associado).filter(Associado.id_associado.in_(ids)).all()}


@router.get("/api/conselho-fiscal/auditoria-financeira/", summary="Títulos do mês com a situação na auditoria do Conselho Fiscal")
def listar_auditoria_financeira(
    mes: Optional[str] = None, tipo_titulo: Optional[str] = None, id_conta_contabil: Optional[int] = None, situacao: Optional[str] = None,
    busca: Optional[str] = None, pagina: int = Query(1, ge=1), por_pagina: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro),
):
    if situacao and situacao not in auditoria_financeira.SITUACOES:
        raise HTTPException(status_code=422, detail=f"A situação deve ser uma de: {', '.join(auditoria_financeira.SITUACOES)}.")
    consulta = _consulta_de_titulos(
        db, status=None, tipo_titulo=tipo_titulo, mes=mes, data_de=None, data_ate=None, busca=busca, id_conta_contabil=id_conta_contabil,
    )
    titulos = consulta.order_by(TituloFinanceiro.data_vencimento, TituloFinanceiro.id_titulo).all()
    estados = auditoria_financeira.situacoes_dos_titulos(db, [t.id_titulo for t in titulos])
    resumo = {s: 0 for s in auditoria_financeira.SITUACOES}
    for e in estados.values():
        resumo[e["situacao"]] += 1
    resumo["total"] = len(titulos)
    resumo["com_discordancia"] = sum(1 for e in estados.values() if e["discordancias"])

    escolhidos = [t for t in titulos if not situacao or estados[t.id_titulo]["situacao"] == situacao]
    da_pagina = escolhidos[(pagina - 1) * por_pagina: pagina * por_pagina]

    conselheiro = _associado_do_usuario(db, usuario) if usuario_e_conselho_fiscal(db, usuario) else None
    contas = {c.id_conta: c for c in db.query(PlanoDeContas).all()}
    fornecedores = {f.id_fornecedor: f for f in db.query(Fornecedor).all()}
    ids_pessoas = {t.id_associado for t in da_pagina if t.id_associado}
    for t in da_pagina:
        ids_pessoas |= {l.id_associado_conselheiro for l in estados[t.id_titulo]["historico"]}
    nomes = _nome_dos_associados(db, ids_pessoas)
    # os documentos que o conselheiro abre para conferir: a nota fiscal do título e o comprovante de cada baixa que não foi estornada
    comprovantes: dict[int, list[str]] = {}
    ids_da_pagina = [t.id_titulo for t in da_pagina]
    if ids_da_pagina:
        for l in db.query(LancamentoContabil).filter(
            LancamentoContabil.id_titulo.in_(ids_da_pagina), LancamentoContabil.comprovante.isnot(None), LancamentoContabil.estornado.is_(False),
        ).order_by(LancamentoContabil.id_lancamento).all():
            comprovantes.setdefault(l.id_titulo, []).append(l.comprovante)

    pagamentos = lancamento_tardio.datas_de_pagamento(db, ids_da_pagina)
    limite_de_dias = lancamento_tardio.dias_para_lancamento_tardio(db)
    itens = []
    for t in da_pagina:
        e = estados[t.id_titulo]
        dias_ate_o_lancamento = lancamento_tardio.dias_ate_o_lancamento(t, pagamentos)
        vigentes_ids = {d.id_auditoria for d in e["vigentes"].values()}
        minha = e["vigentes"].get(conselheiro.id_associado) if conselheiro else None
        conta = contas.get(t.id_conta_contabil)
        if t.id_associado:
            beneficiario = nomes.get(t.id_associado)
        else:
            fornecedor = fornecedores.get(t.id_fornecedor)
            beneficiario = fornecedor.razao_social if fornecedor else None
        itens.append({
            "id_titulo": t.id_titulo, "tipo_titulo": t.tipo_titulo, "descricao": t.descricao,
            "conta_contabil": conta.descricao_conta if conta else "", "beneficiario": beneficiario or "-",
            "valor_original": t.valor_original, "saldo_devedor": t.saldo_devedor,
            "data_vencimento": t.data_vencimento.date().isoformat() if t.data_vencimento else None, "status": t.status,
            "nota_fiscal": t.nota_fiscal, "comprovantes": comprovantes.get(t.id_titulo, []),
            "dias_ate_o_lancamento": dias_ate_o_lancamento, "lancamento_tardio": (dias_ate_o_lancamento or 0) > limite_de_dias,
            "situacao": e["situacao"], "aprovacoes": e["aprovacoes"], "quorum": e["quorum"],
            "minha_decisao": minha.decisao if minha else None,
            "com_discordancia": bool(e["discordancias"]),
            "sou_parte": bool(conselheiro and t.id_associado and t.id_associado == conselheiro.id_associado),
            "decisoes": [
                {
                    "id_auditoria": l.id_auditoria, "conselheiro": nomes.get(l.id_associado_conselheiro, "-"), "decisao": l.decisao,
                    "observacao": l.observacao, "em": l.criado_em, "vigente": l.id_auditoria in vigentes_ids,
                    "id_questionamento": l.id_questionamento,
                    "questionamento": None if not l.id_questionamento else ("Aberto" if l.id_questionamento in e["questionamentos_abertos"] else RESPONDIDO),
                }
                for l in e["historico"]
            ],
        })
    return {
        "itens": itens, "total": len(escolhidos), "pagina": pagina, "por_pagina": por_pagina, "resumo": resumo,
        "quorum": auditoria_financeira.quorum(db), "pode_decidir": conselheiro is not None,
    }


@router.post("/api/conselho-fiscal/auditoria-financeira/titulos/{id_titulo}/decisao", summary="Aprovar, reprovar, ressalvar ou reabrir um título (Conselho Fiscal)")
def decidir_titulo(id_titulo: int, dados: DecisaoDeTituloCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    conselheiro = _exigir_conselho_fiscal(db, usuario)
    titulo = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == id_titulo).first()
    if not titulo:
        raise HTTPException(status_code=404, detail="Título financeiro não encontrado.")
    linha = auditoria_financeira.registrar_decisao(
        db, titulo=titulo, conselheiro=conselheiro, id_usuario=usuario.id_usuario, decisao=dados.decisao, observacao=dados.observacao,
    )
    registrar_auditoria(
        db, usuario, "auditorias_de_titulo", "AUDITORIA_FINANCEIRA_DECISAO", id_registro_afetado=linha.id_auditoria,
        dados_depois={"id_titulo": id_titulo, "decisao": linha.decisao, "observacao": linha.observacao, "id_questionamento": linha.id_questionamento},
        ip_origem=request.client.host if request.client else None,
    )
    estado = auditoria_financeira.situacoes_dos_titulos(db, [id_titulo])[id_titulo]
    return {
        "id_auditoria": linha.id_auditoria, "decisao": linha.decisao, "situacao": estado["situacao"], "aprovacoes": estado["aprovacoes"],
        "quorum": estado["quorum"], "id_questionamento": linha.id_questionamento,
    }


@router.post("/api/conselho-fiscal/auditoria-financeira/aprovar-em-lote", summary="Aprovar de uma vez os títulos pendentes de um mês (e categoria)")
def aprovar_em_lote(dados: AprovacaoEmLoteCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(get_current_user)):
    conselheiro = _exigir_conselho_fiscal(db, usuario)
    if not _MES.match(dados.mes or ""):
        raise HTTPException(status_code=422, detail="Informe o mês no formato AAAA-MM: aprovar em lote vale para um mês de cada vez.")
    titulos = _consulta_de_titulos(
        db, status=None, tipo_titulo=dados.tipo_titulo, mes=dados.mes, data_de=None, data_ate=None, busca=dados.busca, id_conta_contabil=dados.id_conta_contabil,
    ).order_by(TituloFinanceiro.data_vencimento, TituloFinanceiro.id_titulo).all()
    if len(titulos) > auditoria_financeira.MAXIMO_POR_LOTE:
        raise HTTPException(status_code=422, detail=f"São {len(titulos)} títulos; o lote aceita até {auditoria_financeira.MAXIMO_POR_LOTE}. Refine por categoria ou por tipo.")
    estados = auditoria_financeira.situacoes_dos_titulos(db, [t.id_titulo for t in titulos])
    aprovados: list[int] = []
    ignorados = {"ja_aprovados_por_voce": 0, "suspensos": 0, "ja_travados": 0, "seus": 0, "com_decisao_sua_diferente": 0}
    for t in titulos:
        e = estados[t.id_titulo]
        minha = e["vigentes"].get(conselheiro.id_associado)
        if e["situacao"] == auditoria_financeira.APROVADO:
            ignorados["ja_travados"] += 1
        elif e["situacao"] == auditoria_financeira.SUSPENSO:
            ignorados["suspensos"] += 1
        elif t.id_associado and t.id_associado == conselheiro.id_associado:
            ignorados["seus"] += 1
        elif minha is not None and minha.decisao == auditoria_financeira.APROVADO:
            ignorados["ja_aprovados_por_voce"] += 1
        elif minha is not None:
            ignorados["com_decisao_sua_diferente"] += 1  # reprovou ou ressalvou antes: reconsiderar é título a título, com a resposta da tesouraria à vista
        else:
            auditoria_financeira.registrar_decisao(
                db, titulo=t, conselheiro=conselheiro, id_usuario=usuario.id_usuario, decisao=auditoria_financeira.APROVADO, observacao=None,
            )
            aprovados.append(t.id_titulo)
    registrar_auditoria(
        db, usuario, "auditorias_de_titulo", "AUDITORIA_FINANCEIRA_LOTE",
        dados_depois={
            "mes": dados.mes, "tipo_titulo": dados.tipo_titulo, "id_conta_contabil": dados.id_conta_contabil, "busca": dados.busca,
            "ids_titulos": aprovados, "ignorados": ignorados,
        },
        ip_origem=request.client.host if request.client else None,
    )
    return {"aprovados": len(aprovados), "ignorados": ignorados}
