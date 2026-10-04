"""v5.4a (FASE 5) - Parcerias e emendas (painel). Permissões (app/database.py::seed_niveis_e_permissoes):
  - `parcerias`          cadastrar e editar a parceria, parcelas, etapas, relatórios, classificar lançamentos do
                         livro-caixa para o site e enviar para revisão (Presidente, Tesoureiros e a Diretoria; há também
                         o nível exclusivo "Parcerias e emendas - gestão");
  - `aprovar_publicacao` aprovar, recusar e retirar do site - de OUTRA pessoa, nunca de quem criou ou enviou.
Ler: qualquer uma das duas (ou `auditoria`). O site só enxerga o que foi APROVADO, por
`/api/publico/transparencia/parcerias` (app/routers/publico.py). O dinheiro é lido do livro-caixa, nunca digitado."""
import json
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.database import get_db
from app.models.core import AuditLog, Usuario
from app.models.financeiro import CentroDeCusto
from app.models.parcerias import (
    APROVADO, CATEGORIAS_DE_PAGAMENTO, EM_REVISAO, ESFERAS, NATUREZAS, PAGAMENTO, RASCUNHO, RECEBIMENTO, RESULTADOS, RETIRADO,
    SITUACOES, SITUACOES_DE_ETAPA, SITUACOES_DE_PUBLICACAO, TIPOS, TIPOS_DE_RELATORIO, EtapaParceria, ParcelaParceria, Parceria,
    RelatorioParceria,
)
from app.security import exigir_permissao, get_current_user, usuario_tem_permissao
from app.services import parcerias as servico
from app.services import parcerias_fotos as servico_de_fotos

router = APIRouter()

_exigir_gestao = exigir_permissao("parcerias")
_exigir_aprovador = exigir_permissao("aprovar_publicacao")
PERMISSOES_DE_LEITURA = ("parcerias", "aprovar_publicacao", "auditoria")
TABELA = "parcerias"


def _exigir_leitura(usuario: Usuario = Depends(get_current_user), db: Session = Depends(get_db)) -> Usuario:
    if not any(usuario_tem_permissao(db, usuario, p) for p in PERMISSOES_DE_LEITURA):
        raise HTTPException(status_code=403, detail="Sem permissão para ver as parcerias e emendas.")
    return usuario


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


def _auditar(db: Session, usuario: Usuario, request: Request, parceria: Parceria, acao: str, depois=None, antes=None) -> None:
    registrar_auditoria(db, usuario, TABELA, acao, id_registro_afetado=parceria.id_parceria, ip_origem=_ip(request), dados_depois=depois, dados_antes=antes)


# ----------------------------------------------------------------------------------------------- serialização
def _serializar(db: Session, usuario: Usuario, p: Parceria) -> dict:
    resumo = servico.resumo_financeiro(db, p)
    centro = db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == p.id_centro_custo).first() if p.id_centro_custo else None
    gestor = usuario_tem_permissao(db, usuario, "parcerias")
    aprovador = usuario_tem_permissao(db, usuario, "aprovar_publicacao")
    return {
        "id_parceria": p.id_parceria, "tipo": p.tipo, "tipo_rotulo": TIPOS.get(p.tipo, p.tipo), "ano": p.ano, "titulo": p.titulo,
        "objeto": p.objeto, "esfera": p.esfera, "orgao_concedente": p.orgao_concedente, "numero_emenda": p.numero_emenda,
        "identificador_unico": p.identificador_unico, "proponente": p.proponente, "numero_termo": p.numero_termo,
        "valor_total": p.valor_total, "data_assinatura": p.data_assinatura, "vigencia_inicio": p.vigencia_inicio,
        "vigencia_fim": p.vigencia_fim, "situacao": p.situacao,
        "id_centro_custo": p.id_centro_custo, "codigo_centro_custo": centro.codigo if centro else None,
        "recebido": resumo["recebido"], "pago": resumo["pago"], "saldo": resumo["saldo"],
        "situacao_publicacao": p.situacao_publicacao, "enviado_revisao_em": p.enviado_revisao_em, "aprovado_em": p.aprovado_em,
        "motivo_recusa": p.motivo_recusa, "recusado_em": p.recusado_em, "motivo_retirada": p.motivo_retirada,
        "retirado_em": p.retirado_em, "criado_em": p.criado_em, "atualizado_em": p.atualizado_em,
        # o que ESTE usuário pode fazer agora (o painel mostra só o botão certo; o servidor confere de novo)
        "pode_editar": gestor,
        "pode_enviar_revisao": gestor and p.situacao_publicacao == RASCUNHO,
        "pode_aprovar": (
            p.situacao_publicacao == EM_REVISAO and aprovador
            and usuario.id_usuario not in (p.id_usuario_envio_revisao, p.id_usuario_criacao)
        ),
        "pode_retirar": p.situacao_publicacao == APROVADO and aprovador,
        "pode_reabrir": gestor and p.situacao_publicacao == RETIRADO,
    }


def _detalhar(db: Session, usuario: Usuario, p: Parceria) -> dict:
    parcelas = db.query(ParcelaParceria).filter(ParcelaParceria.id_parceria == p.id_parceria).order_by(ParcelaParceria.numero).all()
    ligados = servico.lancamentos_ligados(db, p)
    recebido_por_parcela: dict[int, Decimal] = {}
    for v in ligados:
        if v["natureza"] == RECEBIMENTO and v["id_parcela"] and not v["estornado"]:
            recebido_por_parcela[v["id_parcela"]] = recebido_por_parcela.get(v["id_parcela"], Decimal("0")) + v["valor"]
    relatorios = db.query(RelatorioParceria).filter(RelatorioParceria.id_parceria == p.id_parceria).order_by(RelatorioParceria.id_relatorio).all()
    pendentes = servico.lancamentos_nao_classificados(db, p)
    return {
        **_serializar(db, usuario, p),
        "total_das_parcelas": servico.total_das_parcelas(db, p),
        "parcelas": [
            {"id_parcela": x.id_parcela, "numero": x.numero, "valor_previsto": x.valor_previsto, "data_prevista": x.data_prevista,
             "observacao": x.observacao, "valor_recebido": recebido_por_parcela.get(x.id_parcela, Decimal("0"))}
            for x in parcelas
        ],
        "etapas": [
            {"id_etapa": e.id_etapa, "titulo": e.titulo, "descricao": e.descricao, "data_prevista": e.data_prevista,
             "data_realizacao": e.data_realizacao, "local": e.local, "publico_atendido": e.publico_atendido, "situacao": e.situacao,
             "fotos": [servico_de_fotos.para_o_painel(f) for f in servico_de_fotos.fotos_da_etapa(db, e.id_etapa)]}
            for e in db.query(EtapaParceria).filter(EtapaParceria.id_parceria == p.id_parceria).order_by(EtapaParceria.data_prevista, EtapaParceria.id_etapa)
        ],
        "relatorios": [
            {"id_relatorio": r.id_relatorio, "tipo": r.tipo, "tipo_rotulo": TIPOS_DE_RELATORIO[r.tipo], "periodo_inicio": r.periodo_inicio,
             "periodo_fim": r.periodo_fim, "data_prevista": r.data_prevista, "data_apresentacao": r.data_apresentacao,
             "prazo_analise_dias": r.prazo_analise_dias, "data_limite_analise": servico.data_limite_de_analise(r),
             "resultado": r.resultado, "data_resultado": r.data_resultado, "observacao": r.observacao}
            for r in relatorios
        ],
        "lancamentos": ligados,
        "lancamentos_sem_classificacao": [
            {"id_lancamento": x["id_lancamento"], "numero": x["numero"], "data": x["data"], "historico": x["historico"],
             "natureza": x["natureza"], "natureza_rotulo": NATUREZAS[x["natureza"]], "valor": x["valor"]}
            for x in pendentes
        ],
        "consistencia": servico.consistencia(db, p),
    }


# ----------------------------------------------------------------------------------------------- entradas
class ParceriaDados(BaseModel):
    tipo: Optional[str] = None
    ano: Optional[int] = None
    titulo: Optional[str] = None
    objeto: Optional[str] = None
    esfera: Optional[str] = None
    orgao_concedente: Optional[str] = None
    numero_emenda: Optional[str] = None
    identificador_unico: Optional[str] = None
    proponente: Optional[str] = None
    numero_termo: Optional[str] = None
    valor_total: Optional[Decimal] = None
    data_assinatura: Optional[date] = None
    vigencia_inicio: Optional[date] = None
    vigencia_fim: Optional[date] = None
    situacao: Optional[str] = None


class ParcelaDados(BaseModel):
    numero: Optional[int] = None
    valor_previsto: Optional[Decimal] = None
    data_prevista: Optional[date] = None
    observacao: Optional[str] = None


class EtapaDados(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    data_prevista: Optional[date] = None
    data_realizacao: Optional[date] = None
    local: Optional[str] = None
    publico_atendido: Optional[int] = None
    situacao: Optional[str] = None


class RelatorioDados(BaseModel):
    tipo: Optional[str] = None
    periodo_inicio: Optional[date] = None
    periodo_fim: Optional[date] = None
    data_prevista: Optional[date] = None
    data_apresentacao: Optional[date] = None
    prazo_analise_dias: Optional[int] = None
    resultado: Optional[str] = None
    data_resultado: Optional[date] = None
    observacao: Optional[str] = None


class LancamentoDados(BaseModel):
    id_lancamento: Optional[int] = None
    natureza: Optional[str] = None
    categoria: Optional[str] = None
    descricao_publica: Optional[str] = None
    funcao: Optional[str] = None
    id_parcela: Optional[int] = None


class Motivo(BaseModel):
    motivo: str = Field(..., min_length=1, max_length=2000)


# ----------------------------------------------------------------------------------------------- parcerias
@router.get("/api/parcerias/opcoes", summary="Tipos, situações e categorias (para os formulários do painel)")
def opcoes(_usuario=Depends(_exigir_leitura)):
    return {
        "tipos": [{"codigo": c, "rotulo": r} for c, r in TIPOS.items()],
        "esferas": list(ESFERAS), "situacoes": list(SITUACOES), "situacoes_de_publicacao": list(SITUACOES_DE_PUBLICACAO),
        "tipos_de_relatorio": [{"codigo": c, "rotulo": r} for c, r in TIPOS_DE_RELATORIO.items()],
        "resultados": list(RESULTADOS), "situacoes_de_etapa": list(SITUACOES_DE_ETAPA),
        "categorias_de_pagamento": [{"codigo": c, "rotulo": r} for c, r in CATEGORIAS_DE_PAGAMENTO.items()],
    }


@router.get("/api/parcerias", summary="Listar parcerias e emendas")
def listar(
    ano: Optional[int] = None, tipo: Optional[str] = None, situacao: Optional[str] = None,
    situacao_publicacao: Optional[str] = None, busca: Optional[str] = None,
    db: Session = Depends(get_db), usuario=Depends(_exigir_leitura),
):
    consulta = db.query(Parceria)
    if ano:
        consulta = consulta.filter(Parceria.ano == ano)
    if tipo:
        consulta = consulta.filter(Parceria.tipo == tipo)
    if situacao:
        consulta = consulta.filter(Parceria.situacao == situacao)
    if situacao_publicacao:
        consulta = consulta.filter(Parceria.situacao_publicacao == situacao_publicacao)
    if busca and busca.strip():
        termo = f"%{busca.strip()}%"
        consulta = consulta.filter(or_(
            Parceria.titulo.ilike(termo), Parceria.objeto.ilike(termo), Parceria.numero_emenda.ilike(termo),
            Parceria.proponente.ilike(termo), Parceria.numero_termo.ilike(termo),
        ))
    return [_serializar(db, usuario, p) for p in consulta.order_by(Parceria.ano.desc(), Parceria.id_parceria.desc()).all()]


@router.post("/api/parcerias", summary="Cadastrar parceria ou emenda (cria o centro de custo exclusivo)", status_code=201)
def criar(dados: ParceriaDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.criar_parceria(db, usuario, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "CRIADO", depois={"titulo": parceria.titulo, "tipo": parceria.tipo, "valor_total": parceria.valor_total})
    return _detalhar(db, usuario, parceria)


@router.get("/api/parcerias/{id_parceria}", summary="Detalhe da parceria: parcelas, etapas, relatórios, dinheiro do livro-caixa e pendências")
def obter(id_parceria: int, db: Session = Depends(get_db), usuario=Depends(_exigir_leitura)):
    return _detalhar(db, usuario, servico.buscar(db, id_parceria))


@router.patch("/api/parcerias/{id_parceria}", summary="Editar a parceria")
def editar(id_parceria: int, dados: ParceriaDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    campos = dados.model_dump(exclude_unset=True)
    antes = {c: getattr(parceria, c) for c in campos}
    servico.editar_parceria(db, usuario, parceria, campos)
    _auditar(db, usuario, request, parceria, "EDITADO", antes=antes, depois={c: getattr(parceria, c) for c in campos})
    return _detalhar(db, usuario, parceria)


# ----------------------------------------------------------------------------------------------- parcelas
@router.post("/api/parcerias/{id_parceria}/parcelas", summary="Cadastrar parcela prevista", status_code=201)
def criar_parcela(id_parceria: int, dados: ParcelaDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    parcela = servico.criar_parcela(db, parceria, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "PARCELA_CRIADA", depois={"numero": parcela.numero, "valor": parcela.valor_previsto})
    return _detalhar(db, usuario, parceria)


@router.patch("/api/parcerias/{id_parceria}/parcelas/{id_parcela}", summary="Editar parcela")
def editar_parcela(id_parceria: int, id_parcela: int, dados: ParcelaDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    parcela = servico.editar_parcela(db, parceria, id_parcela, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "PARCELA_EDITADA", depois={"numero": parcela.numero, "valor": parcela.valor_previsto})
    return _detalhar(db, usuario, parceria)


@router.delete("/api/parcerias/{id_parceria}/parcelas/{id_parcela}", summary="Apagar parcela (só sem recebimento ligado)")
def excluir_parcela(id_parceria: int, id_parcela: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    parcela = servico.excluir_parcela(db, parceria, id_parcela)
    _auditar(db, usuario, request, parceria, "PARCELA_APAGADA", depois={"numero": parcela.numero, "valor": parcela.valor_previsto})
    return _detalhar(db, usuario, parceria)


# ----------------------------------------------------------------------------------------------- etapas
@router.post("/api/parcerias/{id_parceria}/etapas", summary="Cadastrar etapa de execução", status_code=201)
def criar_etapa(id_parceria: int, dados: EtapaDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    etapa = servico.criar_etapa(db, parceria, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "ETAPA_CRIADA", depois={"titulo": etapa.titulo})
    return _detalhar(db, usuario, parceria)


@router.patch("/api/parcerias/{id_parceria}/etapas/{id_etapa}", summary="Editar etapa")
def editar_etapa(id_parceria: int, id_etapa: int, dados: EtapaDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    etapa = servico.editar_etapa(db, parceria, id_etapa, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "ETAPA_EDITADA", depois={"titulo": etapa.titulo, "situacao": etapa.situacao})
    return _detalhar(db, usuario, parceria)


@router.delete("/api/parcerias/{id_parceria}/etapas/{id_etapa}", summary="Apagar etapa")
def excluir_etapa(id_parceria: int, id_etapa: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    etapa = servico.excluir_etapa(db, parceria, id_etapa)
    _auditar(db, usuario, request, parceria, "ETAPA_APAGADA", depois={"titulo": etapa.titulo})
    return _detalhar(db, usuario, parceria)


@router.post("/api/parcerias/{id_parceria}/etapas/{id_etapa}/fotos", summary="Enviar foto de uma etapa (exige a autorização de imagem)", status_code=201)
async def enviar_foto_da_etapa(
    id_parceria: int, id_etapa: int, request: Request, arquivo: UploadFile = File(...), alt: str = Form(""),
    autorizacao_imagem: bool = Form(False), id_documento_autorizacao: Optional[int] = Form(None),
    db: Session = Depends(get_db), usuario=Depends(_exigir_gestao),
):
    parceria = servico.buscar(db, id_parceria)
    conteudo = await arquivo.read()
    foto = await run_in_threadpool(
        servico_de_fotos.adicionar_foto, db, usuario, parceria, id_etapa, conteudo, alt=alt, autorizacao_imagem=autorizacao_imagem,
        id_documento_autorizacao=id_documento_autorizacao,
    )
    _auditar(db, usuario, request, parceria, "FOTO_ENVIADA", depois={"id_foto": foto.id_foto, "id_etapa": id_etapa, "id_documento": id_documento_autorizacao})
    return _detalhar(db, usuario, parceria)


@router.get("/api/parcerias/{id_parceria}/fotos/{id_foto}/arquivo", summary="Ver a foto (autenticado; antes de a parceria ir ao site)")
async def ver_foto_da_etapa(id_parceria: int, id_foto: int, db: Session = Depends(get_db), _usuario=Depends(_exigir_leitura)):
    parceria = servico.buscar(db, id_parceria)
    foto = servico_de_fotos.buscar_foto(db, parceria, id_foto)
    conteudo = await run_in_threadpool(servico_de_fotos.ler_arquivo, foto)
    return Response(content=conteudo, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/api/parcerias/{id_parceria}/fotos/{id_foto}", summary="Apagar a foto (a autorização foi retirada): some do site e do armazenamento")
def apagar_foto_da_etapa(id_parceria: int, id_foto: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    foto = servico_de_fotos.apagar_foto(db, parceria, id_foto)
    _auditar(db, usuario, request, parceria, "FOTO_APAGADA", depois={"id_foto": foto.id_foto, "id_etapa": foto.id_etapa})
    return _detalhar(db, usuario, parceria)


# ----------------------------------------------------------------------------------------------- relatórios
@router.post("/api/parcerias/{id_parceria}/relatorios", summary="Cadastrar relatório / prestação de contas", status_code=201)
def criar_relatorio(id_parceria: int, dados: RelatorioDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    r = servico.criar_relatorio(db, parceria, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "RELATORIO_CRIADO", depois={"tipo": r.tipo, "resultado": r.resultado})
    return _detalhar(db, usuario, parceria)


@router.patch("/api/parcerias/{id_parceria}/relatorios/{id_relatorio}", summary="Editar relatório (apresentação e resultado)")
def editar_relatorio(id_parceria: int, id_relatorio: int, dados: RelatorioDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    r = servico.editar_relatorio(db, parceria, id_relatorio, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "RELATORIO_EDITADO", depois={"tipo": r.tipo, "resultado": r.resultado})
    return _detalhar(db, usuario, parceria)


@router.delete("/api/parcerias/{id_parceria}/relatorios/{id_relatorio}", summary="Apagar relatório (só se ainda não foi apresentado)")
def excluir_relatorio(id_parceria: int, id_relatorio: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    r = servico.excluir_relatorio(db, parceria, id_relatorio)
    _auditar(db, usuario, request, parceria, "RELATORIO_APAGADO", depois={"tipo": r.tipo})
    return _detalhar(db, usuario, parceria)


# ----------------------------------------------------------------------------------------------- livro-caixa
@router.post("/api/parcerias/{id_parceria}/lancamentos", summary="Classificar um lançamento do livro-caixa para o site", status_code=201)
def vincular_lancamento(id_parceria: int, dados: LancamentoDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    v = servico.vincular_lancamento(db, usuario, parceria, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "LANCAMENTO_CLASSIFICADO", depois={"id_lancamento": v.id_lancamento, "natureza": v.natureza, "categoria": v.categoria})
    return _detalhar(db, usuario, parceria)


@router.patch("/api/parcerias/{id_parceria}/lancamentos/{id_vinculo}", summary="Corrigir o texto público de um lançamento classificado")
def editar_vinculo(id_parceria: int, id_vinculo: int, dados: LancamentoDados, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    v = servico.editar_vinculo(db, parceria, id_vinculo, dados.model_dump(exclude_unset=True))
    _auditar(db, usuario, request, parceria, "LANCAMENTO_EDITADO", depois={"id_lancamento": v.id_lancamento})
    return _detalhar(db, usuario, parceria)


@router.delete("/api/parcerias/{id_parceria}/lancamentos/{id_vinculo}", summary="Tirar um lançamento do site (desfaz a classificação)")
def desvincular(id_parceria: int, id_vinculo: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    v = servico.desvincular(db, parceria, id_vinculo)
    _auditar(db, usuario, request, parceria, "LANCAMENTO_DESVINCULADO", depois={"id_lancamento": v.id_lancamento})
    return _detalhar(db, usuario, parceria)


# ----------------------------------------------------------------------------------------------- publicação
@router.post("/api/parcerias/{id_parceria}/enviar-revisao", summary="Enviar a parceria para a aprovação de publicação")
def enviar_revisao(id_parceria: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    servico.enviar_para_revisao(db, usuario, parceria)
    _auditar(db, usuario, request, parceria, "ENVIADO_REVISAO")
    return _detalhar(db, usuario, parceria)


@router.post("/api/parcerias/{id_parceria}/aprovar", summary="Aprovar a publicação no site (outra pessoa, nunca quem enviou)")
def aprovar(id_parceria: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_aprovador)):
    parceria = servico.buscar(db, id_parceria)
    servico.aprovar(db, usuario, parceria)
    _auditar(db, usuario, request, parceria, "APROVADO", depois={"enviado_por": parceria.id_usuario_envio_revisao})
    return _detalhar(db, usuario, parceria)


@router.post("/api/parcerias/{id_parceria}/recusar", summary="Recusar a publicação (volta a rascunho, com o motivo)")
def recusar(id_parceria: int, dados: Motivo, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_aprovador)):
    parceria = servico.buscar(db, id_parceria)
    servico.recusar(db, usuario, parceria, dados.motivo)
    _auditar(db, usuario, request, parceria, "RECUSADO", depois={"motivo": dados.motivo.strip()})
    return _detalhar(db, usuario, parceria)


@router.post("/api/parcerias/{id_parceria}/retirar", summary="Retirar do site (o histórico fica)")
def retirar(id_parceria: int, dados: Motivo, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_aprovador)):
    parceria = servico.buscar(db, id_parceria)
    servico.retirar(db, usuario, parceria, dados.motivo)
    _auditar(db, usuario, request, parceria, "RETIRADO", depois={"motivo": dados.motivo.strip()})
    return _detalhar(db, usuario, parceria)


@router.post("/api/parcerias/{id_parceria}/reabrir", summary="Reabrir uma parceria retirada para correção")
def reabrir(id_parceria: int, request: Request, db: Session = Depends(get_db), usuario=Depends(_exigir_gestao)):
    parceria = servico.buscar(db, id_parceria)
    servico.voltar_a_rascunho(db, parceria)
    _auditar(db, usuario, request, parceria, "REABERTO")
    return _detalhar(db, usuario, parceria)


ROTULOS_DA_TRILHA = {
    "CRIADO": "Cadastrada", "EDITADO": "Cadastro alterado", "PARCELA_CRIADA": "Parcela cadastrada", "PARCELA_EDITADA": "Parcela alterada",
    "PARCELA_APAGADA": "Parcela apagada", "ETAPA_CRIADA": "Etapa cadastrada", "ETAPA_EDITADA": "Etapa alterada", "ETAPA_APAGADA": "Etapa apagada",
    "FOTO_ENVIADA": "Foto de etapa enviada (com autorização de imagem)", "FOTO_APAGADA": "Foto de etapa apagada",
    "RELATORIO_CRIADO": "Relatório cadastrado", "RELATORIO_EDITADO": "Relatório alterado", "RELATORIO_APAGADO": "Relatório apagado",
    "LANCAMENTO_CLASSIFICADO": "Lançamento do livro-caixa classificado para o site", "LANCAMENTO_EDITADO": "Texto público de lançamento alterado",
    "LANCAMENTO_DESVINCULADO": "Lançamento tirado do site", "ENVIADO_REVISAO": "Enviada para revisão", "APROVADO": "Aprovada para o site",
    "RECUSADO": "Publicação recusada", "RETIRADO": "Retirada do site", "REABERTO": "Reaberta para correção",
}
_DETALHES_VISIVEIS = ("motivo", "titulo", "tipo", "numero", "valor", "valor_total", "natureza", "categoria", "id_lancamento", "situacao", "resultado", "enviado_por")


@router.get("/api/parcerias/{id_parceria}/historico", summary="Trilha da parceria: quem fez o quê e quando")
def historico(id_parceria: int, db: Session = Depends(get_db), _usuario=Depends(_exigir_leitura)):
    servico.buscar(db, id_parceria)
    entradas = (
        db.query(AuditLog).filter(AuditLog.tabela_afetada == TABELA, AuditLog.id_registro_afetado == id_parceria)
        .order_by(AuditLog.timestamp, AuditLog.id_log).all()
    )
    emails = {u.id_usuario: u.email for u in db.query(Usuario).filter(Usuario.id_usuario.in_({e.id_usuario for e in entradas if e.id_usuario})).all()}
    trilha = []
    for e in entradas:
        try:
            dados = json.loads(e.dados_depois) if e.dados_depois else {}
        except ValueError:
            dados = {}
        trilha.append({
            "acao": e.acao, "rotulo": ROTULOS_DA_TRILHA.get(e.acao, e.acao), "quando": e.timestamp,
            "quem": emails.get(e.id_usuario), "detalhes": {k: v for k, v in dados.items() if k in _DETALHES_VISIVEIS},
        })
    return trilha
