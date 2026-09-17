"""v2.1 (FASE 2) - Diretoria, Conselho Fiscal e mandatos: quem ocupa qual cargo, vacância e
declaração de conflito de interesse. Permissão `governanca` (Presidente/Diretoria) para tudo que
escreve; leitura liberada a qualquer usuário autenticado."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.core import Catalogo, OpcaoCatalogo
from app.models.mandatos import DeclaracaoConflitoInteresse, Mandato
from app.schemas.mandatos import DeclaracaoConflitoInteresseCriar, MandatoCriar, MandatoEncerrar
from app.security import exigir_permissao, get_current_user
from app.services.estatuto import obter_regra_vigente
from app.services.mandatos import mandatos_vencendo, mandatos_vigentes_do_associado

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _validar_codigo_catalogo(db: Session, chave_catalogo: str, codigo: str) -> None:
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave_catalogo).first()
    opcao = (
        db.query(OpcaoCatalogo).filter(
            OpcaoCatalogo.id_catalogo == catalogo.id_catalogo if catalogo else -1,
            OpcaoCatalogo.codigo == codigo, OpcaoCatalogo.ativo.is_(True),
        ).first()
        if catalogo else None
    )
    if not opcao:
        raise HTTPException(status_code=400, detail=f"Código '{codigo}' não existe (ou está inativo) no catálogo '{chave_catalogo}'.")


def _serializar_mandato(m: Mandato) -> dict:
    return {
        "id_mandato": m.id_mandato, "id_associado": m.id_associado, "orgao_codigo": m.orgao_codigo,
        "cargo_codigo": m.cargo_codigo, "data_inicio": m.data_inicio, "data_fim_previsto": m.data_fim_previsto,
        "data_fim_efetivo": m.data_fim_efetivo, "motivo_encerramento": m.motivo_encerramento,
        "ato_origem": m.ato_origem, "vigente": m.vigente(),
    }


@router.post("/api/mandatos/", summary="Criar mandato (posse em cargo/órgão)")
def criar_mandato(dados: MandatoCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    if not db.query(Associado).filter(Associado.id_associado == dados.id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    _validar_codigo_catalogo(db, "orgao_direcao", dados.orgao_codigo)
    _validar_codigo_catalogo(db, "titulo_cargo", dados.cargo_codigo)

    data_inicio = datetime.combine(dados.data_inicio, datetime.min.time())
    if dados.data_fim_previsto:
        data_fim_previsto = datetime.combine(dados.data_fim_previsto, datetime.min.time())
    else:
        anos = int(obter_regra_vigente(db, "DURACAO_MANDATO_ANOS", "4") or "4")
        data_fim_previsto = datetime(data_inicio.year + anos, data_inicio.month, data_inicio.day)
    if data_fim_previsto <= data_inicio:
        raise HTTPException(status_code=400, detail="Data de fim previsto deve ser depois do início.")

    mandato = Mandato(
        id_associado=dados.id_associado, orgao_codigo=dados.orgao_codigo, cargo_codigo=dados.cargo_codigo,
        data_inicio=data_inicio, data_fim_previsto=data_fim_previsto, ato_origem=dados.ato_origem,
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(mandato)
    db.commit()
    db.refresh(mandato)

    # v2.1 - "toda concessão/revogação vai para AuditLog": a concessão automática de permissão
    # pelo cargo (ver app.security.usuario_tem_permissao) é computada na leitura, sem evento
    # discreto no vencimento natural - o que É auditável e registrado aqui é a decisão humana que
    # criou o mandato (e, portanto, concedeu a permissão do cargo a partir de agora).
    registrar_auditoria(
        db, usuario, "mandatos", "CREATE", id_registro_afetado=mandato.id_mandato,
        dados_depois={"id_associado": mandato.id_associado, "cargo_codigo": mandato.cargo_codigo, "orgao_codigo": mandato.orgao_codigo},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar_mandato(mandato)


@router.get("/api/mandatos/", summary="Listar mandatos")
def listar_mandatos(
    id_associado: Optional[int] = None, orgao_codigo: Optional[str] = None, apenas_vigentes: bool = False,
    db: Session = Depends(get_db), _usuario=Depends(get_current_user),
):
    consulta = db.query(Mandato)
    if id_associado is not None:
        consulta = consulta.filter(Mandato.id_associado == id_associado)
    if orgao_codigo:
        consulta = consulta.filter(Mandato.orgao_codigo == orgao_codigo.upper())
    mandatos = consulta.order_by(Mandato.data_inicio.desc()).all()
    if apenas_vigentes:
        mandatos = [m for m in mandatos if m.vigente()]
    return [_serializar_mandato(m) for m in mandatos]


@router.get("/api/mandatos/vencendo", summary="Mandatos vigentes vencendo dentro de N dias (alerta)")
def alerta_mandatos_vencendo(dias: int = Query(90, ge=1, le=365), db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    return [
        {**_serializar_mandato(item["mandato"]), "dias_restantes": item["dias_restantes"]}
        for item in mandatos_vencendo(db, dias)
    ]


@router.post("/api/mandatos/{id_mandato}/encerrar", summary="Encerrar mandato antecipadamente (vacância)")
def encerrar_mandato(id_mandato: int, dados: MandatoEncerrar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    mandato = db.query(Mandato).filter(Mandato.id_mandato == id_mandato).first()
    if not mandato:
        raise HTTPException(status_code=404, detail="Mandato não encontrado.")
    if not mandato.vigente():
        raise HTTPException(status_code=400, detail="Mandato já não está vigente.")

    mandato.data_fim_efetivo = datetime.utcnow()
    mandato.motivo_encerramento = dados.motivo
    if dados.referencia_ato:
        mandato.ato_origem = dados.referencia_ato
    db.commit()

    registrar_auditoria(
        db, usuario, "mandatos", "ENCERRADO", id_registro_afetado=mandato.id_mandato,
        dados_depois={"motivo": dados.motivo, "referencia_ato": dados.referencia_ato},
        ip_origem=request.client.host if request.client else None,
    )

    # Art. 26 do estatuto: sem substituto imediato no órgão/cargo, a Assembleia Geral precisa ser
    # convocada extraordinariamente para a recomposição - convocação em si é FASE 2.2 (Assembleia
    # ainda não construída), então aqui só se registra a pendência, nunca convocação automática.
    outros_vigentes = [
        m for m in db.query(Mandato).filter(
            Mandato.orgao_codigo == mandato.orgao_codigo, Mandato.cargo_codigo == mandato.cargo_codigo,
            Mandato.id_mandato != mandato.id_mandato,
        ).all()
        if m.vigente()
    ]
    vaga_aberta = not outros_vigentes
    if vaga_aberta:
        registrar_auditoria(
            db, usuario, "mandatos", "VACANCIA_SEM_SUBSTITUTO", id_registro_afetado=mandato.id_mandato,
            dados_depois={"orgao_codigo": mandato.orgao_codigo, "cargo_codigo": mandato.cargo_codigo},
            ip_origem=request.client.host if request.client else None,
        )

    resposta = _serializar_mandato(mandato)
    resposta["vaga_aberta"] = vaga_aberta
    if vaga_aberta:
        resposta["pendencia"] = "Art. 26 do estatuto exige Assembleia Geral Extraordinária para recomposição do órgão - convocação automática ainda não implementada (v2.2)."
    return resposta


@router.post("/api/mandatos/conflitos-interesse", summary="Declarar conflito de interesse")
def declarar_conflito_interesse(dados: DeclaracaoConflitoInteresseCriar, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    if not db.query(Associado).filter(Associado.id_associado == dados.id_associado).first():
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    declaracao = DeclaracaoConflitoInteresse(
        id_associado=dados.id_associado, descricao=dados.descricao, id_fornecedor=dados.id_fornecedor,
        id_usuario_criacao=usuario.id_usuario,
    )
    db.add(declaracao)
    db.commit()
    db.refresh(declaracao)
    registrar_auditoria(
        db, usuario, "declaracoes_conflito_interesse", "CREATE", id_registro_afetado=declaracao.id_declaracao,
        dados_depois={"id_associado": declaracao.id_associado, "descricao": declaracao.descricao, "id_fornecedor": declaracao.id_fornecedor},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Conflito de interesse declarado.", "id_declaracao": declaracao.id_declaracao}


@router.get("/api/mandatos/conflitos-interesse", summary="Listar declarações de conflito de interesse")
def listar_conflitos_interesse(id_associado: Optional[int] = None, apenas_ativas: bool = True, db: Session = Depends(get_db), _usuario=Depends(_permissao_governanca)):
    consulta = db.query(DeclaracaoConflitoInteresse)
    if id_associado is not None:
        consulta = consulta.filter(DeclaracaoConflitoInteresse.id_associado == id_associado)
    if apenas_ativas:
        consulta = consulta.filter(DeclaracaoConflitoInteresse.ativa.is_(True))
    declaracoes = consulta.order_by(DeclaracaoConflitoInteresse.criado_em.desc()).all()
    return [
        {
            "id_declaracao": d.id_declaracao, "id_associado": d.id_associado, "descricao": d.descricao,
            "ativa": d.ativa, "id_fornecedor": d.id_fornecedor, "criado_em": d.criado_em,
        }
        for d in declaracoes
    ]


@router.put("/api/mandatos/conflitos-interesse/{id_declaracao}/encerrar", summary="Encerrar declaração de conflito de interesse")
def encerrar_conflito_interesse(id_declaracao: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_governanca)):
    declaracao = db.query(DeclaracaoConflitoInteresse).filter(DeclaracaoConflitoInteresse.id_declaracao == id_declaracao).first()
    if not declaracao:
        raise HTTPException(status_code=404, detail="Declaração não encontrada.")
    declaracao.ativa = False
    db.commit()
    registrar_auditoria(
        db, usuario, "declaracoes_conflito_interesse", "ENCERRADA", id_registro_afetado=id_declaracao,
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Declaração encerrada."}
