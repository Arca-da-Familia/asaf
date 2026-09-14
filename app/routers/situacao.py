"""v1.4 (FASE 1) - mudança de situação: licença, desligamento, readmissão. Efeitos reais do
desligamento: papel "associado" desativado (invalida a carteirinha digital automaticamente -
reaproveita a checagem já feita em app/routers/associados.py:verificar_carteirinha), acesso ao
sistema revogado (Usuario.ativo=False), cobranças futuras pendentes canceladas. Anonimização de
dado pessoal sensível pós-desligamento vive em app/services/anonimizacao.py."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.associados import Associado
from app.models.core import Catalogo, OpcaoCatalogo, Usuario
from app.models.financeiro import TituloFinanceiro
from app.models.pessoas import Papel
from app.models.situacao import DESLIGAMENTO, LICENCA, READMISSAO, MudancaSituacao
from app.schemas.situacao import DesligamentoCriar, LicencaCriar, ReadmissaoCriar
from app.security import exigir_permissao
from app.services.anonimizacao import anonimizar_associado, anonimizar_vencidos, data_elegivel_para_anonimizacao
from app.services.categoria_associado import ATIVO_EM_DIA, LICENCIADO
from app.services.ficha_360 import montar_ficha_360
from app.services.linha_do_tempo import publicar_evento_linha_do_tempo

router = APIRouter()
_permissao_associados = exigir_permissao("associados")


def _buscar_associado_ou_404(db: Session, id_associado: int) -> Associado:
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if not associado:
        raise HTTPException(status_code=404, detail="Associado não encontrado.")
    return associado


def _validar_motivo_em_catalogo(db: Session, chave_catalogo: str, motivo: str, rotulo_erro: str) -> None:
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave_catalogo).first()
    valido = (
        catalogo
        and db.query(OpcaoCatalogo)
        .filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo, OpcaoCatalogo.codigo == motivo, OpcaoCatalogo.ativo == True)
        .first()
    )
    if not valido:
        raise HTTPException(status_code=422, detail=f"{rotulo_erro} inválido: '{motivo}'.")


@router.post("/api/associados/{id_associado}/licenca", summary="Registrar licença temporária")
def registrar_licenca(
    id_associado: int, dados: LicencaCriar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_associados),
):
    associado = _buscar_associado_ou_404(db, id_associado)
    _validar_motivo_em_catalogo(db, "motivo_licenca", dados.motivo, "Motivo de licença")
    data_inicio = datetime.combine(dados.data_inicio, datetime.min.time())
    data_fim = datetime.combine(dados.data_fim_prevista, datetime.min.time())

    db.add(MudancaSituacao(
        id_associado=id_associado, tipo=LICENCA, motivo=dados.motivo,
        data_efetiva=data_inicio, data_fim_prevista=data_fim,
        documento_referencia=dados.documento_referencia, id_usuario_registrou=usuario.id_usuario,
    ))
    associado.status_arrolamento = LICENCIADO
    associado.data_fim_licenca = data_fim
    db.commit()

    registrar_auditoria(
        db, usuario, "associados", "LICENCA_REGISTRADA", id_registro_afetado=id_associado,
        dados_depois={"motivo": dados.motivo, "data_fim_prevista": dados.data_fim_prevista.isoformat()},
        ip_origem=request.client.host if request.client else None,
    )
    publicar_evento_linha_do_tempo(
        db, id_associado, "situacao", "LICENCA_REGISTRADA", "Licença registrada",
        descricao=f"Motivo: {dados.motivo}. Retorno previsto em {dados.data_fim_prevista.isoformat()}.",
        data_evento=data_inicio,
    )
    return {"mensagem": "Licença registrada.", "status_arrolamento": associado.status_arrolamento}


@router.post("/api/associados/{id_associado}/desligar", summary="Registrar desligamento")
def desligar_associado(
    id_associado: int, dados: DesligamentoCriar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_associados),
):
    associado = _buscar_associado_ou_404(db, id_associado)
    if associado.status_arrolamento == "Desligado":
        raise HTTPException(status_code=400, detail="Associado já está desligado.")
    _validar_motivo_em_catalogo(db, "motivo_desligamento", dados.motivo, "Motivo de desligamento")
    data_efetiva = datetime.combine(dados.data_efetiva, datetime.min.time())

    db.add(MudancaSituacao(
        id_associado=id_associado, tipo=DESLIGAMENTO, motivo=dados.motivo, data_efetiva=data_efetiva,
        documento_referencia=dados.documento_referencia, id_usuario_registrou=usuario.id_usuario,
    ))
    associado.status_arrolamento = "Desligado"
    associado.data_desligamento = data_efetiva
    associado.data_fim_licenca = None

    # Efeitos automáticos: papel inativo (invalida a carteirinha - ver verificar_carteirinha),
    # acesso ao sistema revogado, cobranças futuras (ainda não vencidas) canceladas. Dado
    # financeiro em si nunca é apagado - só marcado, mesma regra congelada da FASE 3.
    db.query(Papel).filter(Papel.id_pessoa == associado.id_pessoa, Papel.tipo_papel == "associado").update({"ativo": False})
    if associado.id_usuario:
        db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).update({"ativo": False})
    canceladas = (
        db.query(TituloFinanceiro)
        .filter(
            TituloFinanceiro.id_associado == id_associado,
            TituloFinanceiro.status == "Pendente",
            TituloFinanceiro.data_vencimento > data_efetiva,
        )
        .update({"status": "Cancelado"}, synchronize_session=False)
    )
    db.commit()

    registrar_auditoria(
        db, usuario, "associados", "DESLIGADO", id_registro_afetado=id_associado,
        dados_depois={"motivo": dados.motivo, "data_efetiva": dados.data_efetiva.isoformat(), "titulos_cancelados": canceladas},
        ip_origem=request.client.host if request.client else None,
    )
    publicar_evento_linha_do_tempo(
        db, id_associado, "situacao", "DESLIGAMENTO", "Desligamento registrado",
        descricao=f"Motivo: {dados.motivo}.", data_evento=data_efetiva,
    )
    return {"mensagem": "Desligamento registrado.", "titulos_cancelados": canceladas}


@router.post("/api/associados/{id_associado}/readmitir", summary="Readmitir associado desligado")
def readmitir_associado(
    id_associado: int, dados: ReadmissaoCriar, request: Request,
    db: Session = Depends(get_db), usuario=Depends(_permissao_associados),
):
    """Reaproveita a mesma Pessoa/Associado - nunca cria cadastro novo. Se o dado pessoal já foi
    anonimizado (prazo de retenção vencido), aceita valores novos pra repopular (o titular
    voltou, a finalidade de tratar o dado de novo existe de novo)."""
    associado = _buscar_associado_ou_404(db, id_associado)
    if associado.status_arrolamento != "Desligado":
        raise HTTPException(status_code=400, detail=f"Associado não está desligado (está '{associado.status_arrolamento}').")

    if dados.cpf:
        associado.cpf = dados.cpf
    if dados.email_contato:
        associado.email_contato = dados.email_contato
    if dados.telefone_whatsapp:
        associado.telefone_whatsapp = dados.telefone_whatsapp

    associado.status_arrolamento = ATIVO_EM_DIA
    associado.data_desligamento = None
    papel = db.query(Papel).filter(Papel.id_pessoa == associado.id_pessoa, Papel.tipo_papel == "associado").first()
    if papel:
        papel.ativo = True
    else:
        db.add(Papel(id_pessoa=associado.id_pessoa, tipo_papel="associado"))
    if associado.id_usuario:
        db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).update({"ativo": True})

    db.add(MudancaSituacao(
        id_associado=id_associado, tipo=READMISSAO, data_efetiva=datetime.utcnow(),
        id_usuario_registrou=usuario.id_usuario,
    ))
    db.commit()

    registrar_auditoria(
        db, usuario, "associados", "READMITIDO", id_registro_afetado=id_associado,
        ip_origem=request.client.host if request.client else None,
    )
    publicar_evento_linha_do_tempo(db, id_associado, "situacao", "READMISSAO", "Readmitido como associado")
    return {"mensagem": "Associado readmitido.", "status_arrolamento": associado.status_arrolamento}


@router.get("/api/associados/{id_associado}/historico-situacao", summary="Histórico de mudanças de situação")
def historico_situacao(id_associado: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_associados)):
    _buscar_associado_ou_404(db, id_associado)
    eventos = (
        db.query(MudancaSituacao)
        .filter(MudancaSituacao.id_associado == id_associado)
        .order_by(MudancaSituacao.data_efetiva.desc())
        .all()
    )
    return [
        {
            "id_mudanca": e.id_mudanca, "tipo": e.tipo, "motivo": e.motivo,
            "data_efetiva": e.data_efetiva, "data_fim_prevista": e.data_fim_prevista,
            "documento_referencia": e.documento_referencia,
        }
        for e in eventos
    ]


@router.post("/api/associados/{id_associado}/anonimizar", summary="Anonimizar dado pessoal (se o prazo de retenção já passou)")
def anonimizar_um(id_associado: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_associados)):
    associado = _buscar_associado_ou_404(db, id_associado)
    data_elegivel = data_elegivel_para_anonimizacao(db, associado)
    if data_elegivel is None:
        raise HTTPException(status_code=400, detail="Associado não está desligado - não há dado a anonimizar.")
    if datetime.utcnow() < data_elegivel:
        raise HTTPException(status_code=400, detail=f"Ainda não elegível - prazo de retenção vai até {data_elegivel.date().isoformat()}.")

    anonimizar_associado(db, associado, usuario=usuario, ip_origem=request.client.host if request.client else None)
    return {"mensagem": "Dado pessoal anonimizado."}


@router.post("/api/associados/anonimizar-vencidos", summary="Anonimizar em lote todo desligado que já passou do prazo de retenção")
def anonimizar_lote_vencidos(request: Request, db: Session = Depends(get_db), usuario=Depends(_permissao_associados)):
    total = anonimizar_vencidos(db, usuario=usuario, ip_origem=request.client.host if request.client else None)
    return {"mensagem": f"{total} associado(s) anonimizado(s).", "total": total}


@router.get(
    "/api/associados/{id_associado}/ficha-360",
    summary="Ficha 360º do associado (v1.5): dados, financeiro resumido, cargos, linha do tempo",
)
def ficha_360(id_associado: int, db: Session = Depends(get_db), _usuario=Depends(_permissao_associados)):
    associado = _buscar_associado_ou_404(db, id_associado)
    return montar_ficha_360(db, associado)
