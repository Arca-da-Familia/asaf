"""v7.0a (FASE 7) - o módulo Privacidade do painel: o encarregado pelo tratamento de dados, o substituto e o ato de designação (ver app/services/encarregado.py).
Ver e baixar exigem `privacidade` (a Presidência e os cargos de Presidente e Vice-Presidentes); gerar e registrar a cópia assinada exigem `privacidade_gerir` (só a
Presidência e o cargo de Presidente). Gerar, registrar a assinatura e baixar a cópia assinada vão para a Auditoria."""
import unicodedata
from typing import Annotated, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import textos_de_privacidade
from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import Usuario
from app.security import exigir_permissao, get_current_user, usuario_tem_permissao
from app.services import encarregado as servico
from app.services import inventario as servico_inventario
from app.services import consentimentos as servico_consentimentos
from app.services import relatorio_de_impacto as servico_ripd

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
    bases_legais: Optional[list[str]] = Field(default=None, max_length=20)
    medidas: Optional[str] = Field(default=None, max_length=3000)
    observacoes: Optional[str] = Field(default=None, max_length=2000)
    base_legal_conferida: Optional[bool] = None
    versao_base: Optional[int] = None  # a versão que a tela mostrava: se outra pessoa salvou depois, 409


@router.get("/api/privacidade/inventario", summary="O inventário de dados: cada atividade de tratamento com as seções do modelo da ANPD e o que falta")
def inventario(db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    return _com_quem_ve(db, usuario, servico_inventario.listar(db))


@router.put("/api/privacidade/inventario/{codigo}", summary="Ajustar a finalidade, a base legal, as medidas e as observações de uma atividade (versão nova)")
def ajustar_atividade(codigo: str, dados: AtividadeAjustar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    campos = dados.model_dump(exclude={"versao_base"})
    antes, depois, numero = servico_inventario.atualizar(db, usuario, codigo, campos, versao_base=dados.versao_base)
    mudou = sorted(k for k in depois if depois[k] != antes.get(k))
    registrar_auditoria(
        db, usuario, "versoes_de_atividade_de_tratamento", "ATIVIDADE_AJUSTADA", ip_origem=_ip(request),
        dados_antes={k: antes[k] for k in mudou}, dados_depois={"atividade": codigo, "versao": numero, **{k: depois[k] for k in mudou}},
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


# ------------------------------------------------------------------------------------------------ v7.0d - o relatório de impacto (RIPD) antes do alto risco
class RelatorioSalvar(BaseModel):
    secoes: dict[str, Annotated[str, Field(max_length=8000)]] = Field(default_factory=dict)
    # o marcador do rascunho que a tela carregou (None se não havia): se outra pessoa salvou ou aprovou no meio, 409
    marcador_base: Optional[str] = None


class RelatorioSuspender(BaseModel):
    motivo: str = Field(min_length=1, max_length=500)


@router.get("/api/privacidade/relatorios-de-impacto", summary="Os tratamentos de alto risco: o relatório de impacto aprovado, o rascunho, a proposta do sistema e o histórico")
def relatorios_de_impacto(db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    return _com_quem_ve(db, usuario, servico_ripd.listar(db))


@router.put("/api/privacidade/relatorios-de-impacto/{codigo}", summary="Salvar o rascunho do relatório de impacto (o aprovado continua valendo até este ser aprovado)")
def salvar_relatorio(codigo: str, dados: RelatorioSalvar, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    r = servico_ripd.salvar_rascunho(db, usuario, codigo, dados.secoes, marcador_base=dados.marcador_base)
    registrar_auditoria(db, usuario, "relatorios_de_impacto", "RIPD_RASCUNHO_SALVO", id_registro_afetado=r.id_relatorio, ip_origem=_ip(request),
                        dados_depois={"tratamento": codigo, "versao": r.versao})
    return _com_quem_ve(db, usuario, servico_ripd.listar(db))


@router.post("/api/privacidade/relatorios-de-impacto/{codigo}/aprovar", summary="Aprovar o relatório de impacto (todas as seções, inclusive o parecer do encarregado): o tratamento passa a poder rodar")
def aprovar_relatorio(codigo: str, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    r, anterior = servico_ripd.aprovar(db, usuario, codigo)
    registrar_auditoria(db, usuario, "relatorios_de_impacto", "RIPD_APROVADO", id_registro_afetado=r.id_relatorio, ip_origem=_ip(request),
                        dados_depois={"tratamento": codigo, "versao": r.versao, "substituiu_a_versao": anterior.versao if anterior else None})
    return _com_quem_ve(db, usuario, servico_ripd.listar(db))


@router.post("/api/privacidade/relatorios-de-impacto/{codigo}/suspender", summary="Suspender os novos registros do tratamento de alto risco até aprovar de novo, com o motivo (a leitura continua)")
def suspender_relatorio(codigo: str, dados: RelatorioSuspender, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode_gerir)):
    r = servico_ripd.suspender(db, usuario, codigo, dados.motivo)
    registrar_auditoria(db, usuario, "relatorios_de_impacto", "RIPD_SUSPENSO", id_registro_afetado=r.id_relatorio, ip_origem=_ip(request),
                        dados_depois={"tratamento": codigo, "versao": r.versao, "motivo": r.motivo_suspensao})
    return _com_quem_ve(db, usuario, servico_ripd.listar(db))


@router.get("/api/privacidade/relatorios-de-impacto/{codigo}/pdf", summary="O relatório de impacto em PDF (para apresentar à ANPD quando pedido, LGPD art. 38)")
def relatorio_pdf(codigo: str, request: Request, db: Session = Depends(get_db), usuario: Usuario = Depends(_pode)):
    conteudo = servico_ripd.pdf(db, codigo)
    registrar_auditoria(db, usuario, "relatorios_de_impacto", "RIPD_EXPORTADO", ip_origem=_ip(request), dados_depois={"tratamento": codigo})
    return _arquivo(conteudo, f"Relatório de impacto - {servico_ripd.buscar(codigo).nome}.pdf", "application/pdf", baixar=False)


@router.get("/api/relatorios-de-impacto/{codigo}/liberado", summary="O tratamento de alto risco pode rodar? (para a tela do prontuário avisar; não traz dado)")
def relatorio_liberado(codigo: str, db: Session = Depends(get_db), _usuario: Usuario = Depends(get_current_user)):
    t = servico_ripd.buscar(codigo)
    return {"codigo": t.codigo, "nome": t.nome, "liberado": servico_ripd.aprovado(db, codigo) is not None}


# ------------------------------------------------------------------------------------------------ v7.1a: os textos de privacidade com versão
@router.get("/api/privacidade/textos-de-privacidade", summary="Os avisos de privacidade de cada formulário, com a base legal e todas as versões (o texto exato de cada uma)")
def listar_textos_de_privacidade(db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode)):
    return textos_de_privacidade.listar(db)


@router.get("/api/textos-de-privacidade/{ponto}/{versao}", summary="O texto exato de uma versão de um aviso de privacidade (qualquer pessoa logada: o texto é o que o site mostrou)")
def ler_texto_de_privacidade(ponto: str, versao: str, db: Session = Depends(get_db), _usuario: Usuario = Depends(get_current_user)):
    texto = textos_de_privacidade.ler(db, ponto, versao)
    if texto is None:
        raise HTTPException(status_code=404, detail="Versão de aviso não encontrada.")
    return texto


# ------------------------------------------------------------------------------------------------ v7.1b: os consentimentos (a prova) e os termos
@router.get("/api/privacidade/consentimentos", summary="Os consentimentos registrados (vigentes e encerrados: a prova fica), com o termo, quem, como e quando")
def listar_consentimentos(situacao: Optional[str] = None, origem: Optional[str] = None, busca: Optional[str] = None, pagina: int = 1,
                          db: Session = Depends(get_db), _usuario: Usuario = Depends(_pode)):
    return {**servico_consentimentos.listar(db, situacao=situacao, origem=origem, busca=busca, pagina=pagina),
            "origens": servico_consentimentos.ROTULO_DA_ORIGEM}


@router.get("/api/consentimentos/termo-da-tela/{origem}", summary="O termo de consentimento em vigor para a tela de envio (a versão volta no envio)")
def termo_da_tela(origem: str, _usuario: Usuario = Depends(get_current_user)):
    if origem not in servico_consentimentos.TERMO_DA_ORIGEM:
        raise HTTPException(status_code=404, detail="Termo não encontrado.")
    return servico_consentimentos.termo_para_a_tela(origem)


@router.get("/api/consentimentos/termos/{termo}/pdf", summary="O termo de autorização de uso de imagem em vigor, em PDF, para imprimir e assinar")
def pdf_do_termo(termo: str, _usuario: Usuario = Depends(get_current_user)):
    return Response(content=servico_consentimentos.pdf_do_termo(termo), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="termo-{termo.lower()}.pdf"'})
