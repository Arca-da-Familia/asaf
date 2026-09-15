"""v2.0 (FASE 2) - API de `RegraEstatutaria`/`DocumentoEstatuto`: lê os parâmetros vigentes,
consulta o histórico completo de um parâmetro (inclusive "qual era a regra numa data passada") e
registra reforma de estatuto (nunca edita o valor de uma linha vigente, sempre fecha e abre nova
- ver `app.services.estatuto.reformar_regra`). Permissão `governanca` (Presidente/Diretoria) para
tudo que escreve; leitura é liberada a qualquer usuário autenticado - qualquer associado pode
conferir por que quórum se aplica a uma assembleia."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.estatuto import DocumentoEstatuto, RegraEstatutaria
from app.schemas.estatuto import DocumentoEstatutoCriar, RegraEstatutariaReformar
from app.security import exigir_permissao, get_current_user
from app.services.estatuto import reformar_regra

router = APIRouter()
_permissao_governanca = exigir_permissao("governanca")


def _serializar(regra: RegraEstatutaria) -> dict:
    return {
        "id_regra": regra.id_regra, "parametro": regra.parametro, "valor": regra.valor,
        "tipo": regra.tipo, "categoria": regra.categoria, "descricao": regra.descricao,
        "artigo_origem": regra.artigo_origem, "id_documento_estatuto": regra.id_documento_estatuto,
        "vigencia_inicio": regra.vigencia_inicio, "vigencia_fim": regra.vigencia_fim,
    }


@router.get("/api/estatuto/regras", summary="Listar regras estatutárias vigentes")
def listar_regras_vigentes(categoria: Optional[str] = None, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    consulta = db.query(RegraEstatutaria).filter(RegraEstatutaria.vigencia_fim.is_(None))
    if categoria:
        consulta = consulta.filter(RegraEstatutaria.categoria == categoria)
    regras = consulta.order_by(RegraEstatutaria.parametro).all()
    return [_serializar(r) for r in regras]


@router.get("/api/estatuto/regras/{parametro}/historico", summary="Histórico de vigências de um parâmetro estatutário")
def historico_regra(parametro: str, db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    regras = (
        db.query(RegraEstatutaria)
        .filter(RegraEstatutaria.parametro == parametro)
        .order_by(RegraEstatutaria.vigencia_inicio.desc())
        .all()
    )
    if not regras:
        raise HTTPException(status_code=404, detail="Parâmetro estatutário não encontrado.")
    return [_serializar(r) for r in regras]


@router.put("/api/estatuto/regras/{parametro}", summary="Reformar um parâmetro estatutário (fecha a vigência atual, abre nova)")
def reformar_regra_estatutaria(
    parametro: str, dados: RegraEstatutariaReformar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_governanca),
):
    if dados.id_documento_estatuto is not None:
        if not db.query(DocumentoEstatuto).filter(DocumentoEstatuto.id_documento_estatuto == dados.id_documento_estatuto).first():
            raise HTTPException(status_code=404, detail="Documento do estatuto informado não existe.")

    anterior = (
        db.query(RegraEstatutaria)
        .filter(RegraEstatutaria.parametro == parametro, RegraEstatutaria.vigencia_fim.is_(None))
        .first()
    )
    valor_anterior = anterior.valor if anterior else None

    nova = reformar_regra(
        db, parametro, dados.valor, id_usuario=usuario.id_usuario,
        artigo_origem=dados.artigo_origem, descricao=dados.descricao,
        id_documento_estatuto=dados.id_documento_estatuto,
    )
    db.commit()
    db.refresh(nova)

    registrar_auditoria(
        db, usuario, "regras_estatutarias", "REFORMA", id_registro_afetado=nova.id_regra,
        dados_antes={"parametro": parametro, "valor": valor_anterior},
        dados_depois={"parametro": parametro, "valor": nova.valor, "artigo_origem": nova.artigo_origem},
        ip_origem=request.client.host if request.client else None,
    )
    return _serializar(nova)


@router.get("/api/estatuto/documentos", summary="Listar documentos do estatuto")
def listar_documentos_estatuto(db: Session = Depends(get_db), _usuario=Depends(get_current_user)):
    documentos = db.query(DocumentoEstatuto).order_by(DocumentoEstatuto.criado_em.desc()).all()
    return [
        {
            "id_documento_estatuto": d.id_documento_estatuto, "versao": d.versao,
            "numero_registro_cartorio": d.numero_registro_cartorio, "comarca_registro": d.comarca_registro,
            "data_registro": d.data_registro, "caminho_arquivo": d.caminho_arquivo, "vigente": d.vigente,
        }
        for d in documentos
    ]


@router.post("/api/estatuto/documentos", summary="Registrar um novo documento de estatuto (reforma completa)")
def criar_documento_estatuto(
    dados: DocumentoEstatutoCriar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_governanca),
):
    # Um novo documento de estatuto vigente substitui o anterior - nunca dois "vigente=True" ao
    # mesmo tempo (mesma lógica de vigência única aplicada a RegraEstatutaria).
    db.query(DocumentoEstatuto).filter(DocumentoEstatuto.vigente.is_(True)).update({"vigente": False})

    documento = DocumentoEstatuto(
        versao=dados.versao, numero_registro_cartorio=dados.numero_registro_cartorio,
        comarca_registro=dados.comarca_registro,
        data_registro=datetime.combine(dados.data_registro, datetime.min.time()) if dados.data_registro else None,
        vigente=True,
    )
    db.add(documento)
    db.commit()
    db.refresh(documento)

    registrar_auditoria(
        db, usuario, "documentos_estatuto", "CREATE", id_registro_afetado=documento.id_documento_estatuto,
        dados_depois={"versao": documento.versao, "numero_registro_cartorio": documento.numero_registro_cartorio},
        ip_origem=request.client.host if request.client else None,
    )
    return {"mensagem": "Documento de estatuto registrado.", "id_documento_estatuto": documento.id_documento_estatuto}
