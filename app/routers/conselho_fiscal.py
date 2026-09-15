"""v2.6 (FASE 2) - Conselho Fiscal com poder real: leitura irrestrita do financeiro (auditada a
cada consulta), parecer sobre prestação de contas e fila de questionamentos sobre lançamento.

Leitura financeira aqui usa a mesma permissão `financeiro` já existente (Conselho
Fiscal/Diretoria/Presidente a têm por padrão, v0.1.5) - "irrestrita" é sobre o dado (nada
escondido do conselho), não sobre inventar uma trava nova. Emitir parecer e abrir questionamento,
esses sim são exclusivos de quem tem nível com `is_conselho_fiscal=True` (segregação de função:
quem fiscaliza não é quem lança)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.conselho_fiscal import RESPONDIDO, ParecerPrestacaoContas, QuestionamentoLancamento, RespostaQuestionamento
from app.models.financeiro import TituloFinanceiro, TransacaoCaixa
from app.schemas.conselho_fiscal import ParecerCriar, QuestionamentoCriar, RespostaCriar
from app.security import exigir_permissao, get_current_user
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


@router.get("/api/conselho-fiscal/financeiro/caixa", summary="Leitura irrestrita do livro-caixa (auditada)")
def listar_caixa(db: Session = Depends(get_db), usuario=Depends(_permissao_financeiro)):
    transacoes = db.query(TransacaoCaixa).order_by(TransacaoCaixa.data_registro_servidor.desc()).all()
    registrar_auditoria(db, usuario, "livro_caixa_auditoria", "CONSULTA_CONSELHO_FISCAL", dados_depois={"qtd_resultados": len(transacoes)})
    return [
        {
            "id_transacao": t.id_transacao, "id_titulo": t.id_titulo, "tipo_movimento": t.tipo_movimento,
            "valor_efetivado": t.valor_efetivado, "data_registro_servidor": t.data_registro_servidor,
            "forma_pagamento": t.forma_pagamento, "status_auditoria": t.status_auditoria,
        }
        for t in transacoes
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
