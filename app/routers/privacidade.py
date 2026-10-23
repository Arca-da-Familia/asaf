"""v7.0a (FASE 7) - o módulo Privacidade do painel: o encarregado pelo tratamento de dados, o substituto e o ato de designação (ver app/services/encarregado.py).
Ver e baixar exigem `privacidade` (a Presidência e os cargos de Presidente e Vice-Presidentes); gerar e registrar a cópia assinada exigem `privacidade_gerir` (só a
Presidência e o cargo de Presidente). Gerar, registrar a assinatura e baixar a cópia assinada vão para a Auditoria."""
import unicodedata
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import Usuario
from app.security import exigir_permissao, usuario_tem_permissao
from app.services import encarregado as servico
from app.services import inventario as servico_inventario

router = APIRouter()
_pode = exigir_permissao(servico.PERMISSAO)
_pode_gerir = exigir_permissao(servico.PERMISSAO_GERIR)
TABELA = "atos_do_encarregado"
_TIPOS = {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _arquivo(conteudo: bytes, nome: str, tipo: str, baixar: bool) -> Response:
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode("ascii").replace('"', "'") or "arquivo"
    modo = "attachment" if baixar else "inline"
    return Response(
        content=conteudo, media_type=tipo,
        headers={
            "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
            "Content-Disposition": f"{modo}; filename=\"{sem_acento}\"; filename*=UTF-8''{quote(nome, safe='')}",
        },
    )


@router.get("/api/privacidade/encarregado", summary="Quem é o encarregado e o substituto hoje (pelos mandatos), o ato vigente, o que aguarda assinatura, o histórico e os avisos")
def situacao(db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    return _com_quem_ve(db, usuario, servico.situacao(db))


def _com_quem_ve(db: Session, usuario: Usuario, dados: dict) -> dict:
    # a tela só mostra gerar e registrar a quem pode (o servidor recusa do mesmo jeito)
    return {**dados, "pode_gerir": usuario_tem_permissao(db, usuario, servico.PERMISSAO_GERIR)}


@router.post("/api/privacidade/encarregado/atos", summary="Gerar o ato de designação com os nomes dos mandatos de hoje (descarta o que ainda não foi assinado)")
def gerar(request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    ato, descartado = servico.gerar(db, usuario)
    registrar_auditoria(
        db, usuario, TABELA, "ATO_GERADO", id_registro_afetado=ato.id_ato, ip_origem=_ip(request),
        dados_depois={"numero": ato.numero, "encarregado": ato.nome_encarregado, "substituto": ato.nome_substituto, "descartou_o_ato": descartado.numero if descartado else None},
    )
    return _com_quem_ve(db, usuario, servico.situacao(db))


@router.get("/api/privacidade/encarregado/atos/{id_ato}/pdf", summary="O ato em PDF, para imprimir e assinar (o texto guardado no dia em que foi gerado)")
def baixar_pdf(id_ato: int, db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode)):
    ato = servico.buscar(db, id_ato)
    return _arquivo(servico.pdf(ato), f"Ato nº {ato.numero} - encarregado de dados.pdf", "application/pdf", baixar=False)


@router.post("/api/privacidade/encarregado/atos/{id_ato}/assinado", summary="Anexar a cópia assinada (PDF, JPG ou PNG): o ato passa a valer e o anterior fica como substituído")
async def registrar_assinatura(id_ato: int, request: Request, arquivo: UploadFile = File(...), db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    conteudo = await arquivo.read()
    ato, anterior = await run_in_threadpool(servico.registrar_assinatura, db, usuario, id_ato, arquivo.filename, conteudo)
    registrar_auditoria(
        db, usuario, TABELA, "ATO_ASSINADO", id_registro_afetado=ato.id_ato, ip_origem=_ip(request),
        dados_depois={"numero": ato.numero, "sha256": ato.assinado_sha256, "substituiu_o_ato": anterior.numero if anterior else None},
    )
    return _com_quem_ve(db, usuario, servico.situacao(db))


@router.get("/api/privacidade/encarregado/atos/{id_ato}/assinado", summary="Baixar a cópia assinada do ato (vai para a Auditoria)")
async def baixar_assinado(id_ato: int, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    ato = servico.buscar(db, id_ato)
    conteudo = await run_in_threadpool(servico.ler_copia_assinada, ato)
    registrar_auditoria(db, usuario, TABELA, "ATO_ASSINADO_BAIXADO", id_registro_afetado=ato.id_ato, ip_origem=_ip(request), dados_depois={"numero": ato.numero})
    extensao = ato.assinado_arquivo.rsplit(".", 1)[-1].lower()
    return _arquivo(conteudo, ato.assinado_nome_arquivo or f"ato-{ato.numero}.{extensao}", _TIPOS.get(extensao, "application/octet-stream"), baixar=True)


# ------------------------------------------------------------------------------------------------ v7.0c - o inventário de dados (registro das operações de tratamento)
class AtividadeAjustar(BaseModel):
    finalidade: Optional[str] = Field(default=None, max_length=2000)
    bases_legais: Optional[list[str]] = Field(default=None, max_length=12)
    operadores: Optional[list[str]] = Field(default=None, max_length=10)
    medidas: Optional[str] = Field(default=None, max_length=3000)
    observacoes: Optional[str] = Field(default=None, max_length=2000)
    base_legal_conferida: Optional[bool] = None


@router.get("/api/privacidade/inventario", summary="O inventário de dados: cada atividade de tratamento com as seções do modelo da ANPD e o que falta")
def inventario(db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    return _com_quem_ve(db, usuario, servico_inventario.listar(db))


@router.put("/api/privacidade/inventario/{codigo}", summary="Ajustar a finalidade, a base legal, os operadores, as medidas e as observações de uma atividade (versão nova)")
def ajustar_atividade(codigo: str, dados: AtividadeAjustar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    antes, depois = servico_inventario.atualizar(db, usuario, codigo, dados.model_dump())
    mudou = sorted(k for k in depois if depois[k] != antes.get(k))
    registrar_auditoria(
        db, usuario, "versoes_de_atividade_de_tratamento", "ATIVIDADE_AJUSTADA", ip_origem=_ip(request),
        dados_antes={k: antes[k] for k in mudou}, dados_depois={"atividade": codigo, **{k: depois[k] for k in mudou}},
    )
    return _com_quem_ve(db, usuario, servico_inventario.listar(db))


@router.get("/api/privacidade/inventario/{codigo}/historico", summary="As versões de uma atividade de tratamento: o que mudou, quando e por quem")
def historico_da_atividade(codigo: str, db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode)):
    return servico_inventario.historico(db, codigo)


@router.get("/api/privacidade/inventario-planilha", summary="O inventário em planilha (CSV com ponto e vírgula, abre no Excel), para apresentar à ANPD quando pedido")
def inventario_planilha(request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    registrar_auditoria(db, usuario, "versoes_de_atividade_de_tratamento", "INVENTARIO_EXPORTADO", ip_origem=_ip(request), dados_depois={"formato": "planilha"})
    return _arquivo(servico_inventario.planilha(db), "Inventário de dados pessoais.csv", "text/csv; charset=utf-8", baixar=True)


@router.get("/api/privacidade/inventario-pdf", summary="O inventário em PDF, para apresentar à ANPD quando pedido")
def inventario_pdf(request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    registrar_auditoria(db, usuario, "versoes_de_atividade_de_tratamento", "INVENTARIO_EXPORTADO", ip_origem=_ip(request), dados_depois={"formato": "pdf"})
    return _arquivo(servico_inventario.pdf(db), "Inventário de dados pessoais.pdf", "application/pdf", baixar=False)
