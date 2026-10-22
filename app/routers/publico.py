"""v5.2 (FASE 5) - leitura PÚBLICA para o site institucional: Diretoria e Conselho, Projetos públicos
e editais de assembleia. Sem autenticação, só GET, nunca dado de gestão interna.

Regras (cada uma tem teste em tests/test_publico.py):
  - Lista EXPLÍCITA de campos por resposta. Nada de serializar o modelo inteiro: um campo novo no
    modelo nunca vira público por descuido.
  - Diretoria: só mandato VIGENTE; só nome do cargo, do órgão e do dirigente e as datas do mandato.
    Nunca CPF, e-mail, telefone, foto nem endereço.
  - Projeto: só `visibilidade == "Pública"`; projeto interno responde 404 (não revela que existe).
    Nunca responsável, centro de custo, orçamento nem situação de alvará.
  - Assembleia: só a que já foi CONVOCADA (tem edital); rascunho não aparece. O texto do edital traz o
    LINK de acesso remoto quando há (app/services/assembleia.py::gerar_edital) - esse trecho é
    REMOVIDO daqui: o link é para quem foi convocado, e publicá-lo daria a qualquer pessoa a sala da
    assembleia. A prova de integridade (SHA-256) é calculada sobre o texto efetivamente publicado.
  - Documentos (v5.4a): só os APROVADOS para o site (`situacao == Aprovado`), e do arquivo só a VERSÃO PÚBLICA -
    nunca o original, a classificação, o texto extraído nem quem enviou/aprovou. Retirado do site = 404 na hora
    (o arquivo é lido a cada pedido, não há link permanente para um arquivo solto).
Esta é a mesma fronteira das rotas de evento (app/routers/eventos.py): o site é leitura pública, o
painel é gestão."""
import hashlib
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.associados import Associado
from app.models.core import Catalogo, OpcaoCatalogo
from app.models.documentos import FORMATO_TEXTO
from app.models.governanca import Assembleia, RASCUNHO
from app.models.mandatos import FotoDaDiretoria, Mandato
from app.models.parcerias import FotoEtapaParceria
from app.models.projetos import ProjetoEvento
from app.services import armazenamento
from app.services import fotos_da_diretoria as servico_fotos_da_diretoria
from app.services import parcerias as servico_de_parcerias
from app.services import parcerias_fotos as servico_de_fotos
from app.services import publico_contexto
from app.services.assembleia import horarios_convocacao

router = APIRouter()

VISIBILIDADE_PUBLICA = "Pública"
# "Local: <local> | Acesso remoto: <link>" (gerar_edital) - o link vai até o fim da linha.
_RE_LINK_REMOTO = re.compile(r"\s*\|\s*Acesso remoto:[^\n]*")


def _catalogo(db: Session, chave: str) -> dict[str, tuple[str, int]]:
    """codigo -> (rótulo, ordem) das opções ATIVAS do catálogo; vazio se o catálogo não existe."""
    catalogo = db.query(Catalogo).filter(Catalogo.chave == chave).first()
    if not catalogo:
        return {}
    opcoes = db.query(OpcaoCatalogo).filter(OpcaoCatalogo.id_catalogo == catalogo.id_catalogo).all()
    return {o.codigo: (o.rotulo, o.ordem or 0) for o in opcoes}


def _data(valor: Optional[datetime]) -> Optional[str]:
    return valor.date().isoformat() if valor else None


# ==========================================
# DIRETORIA E CONSELHO (mandatos vigentes)
# ==========================================
def _foto_publica_da_diretoria(foto, nome: str, cargo: str) -> Optional[dict]:
    if foto is None:
        return None
    return {
        # o texto alternativo sai do nome e do cargo DE HOJE, não do que foi gravado no envio (quem muda de cargo, ou recebeu a foto antes do mandato, não fica com texto errado)
        "id_foto": foto.id_foto, "alt": servico_fotos_da_diretoria.texto_alternativo(nome, cargo), "sha256": foto.sha256, "largura": foto.largura, "altura": foto.altura,
        "arquivo": f"/api/publico/diretoria/fotos/{foto.id_foto}",
    }


@router.get("/api/publico/diretoria", summary="Diretoria e Conselho vigentes (leitura, sem autenticação, pro site institucional)")
def diretoria_publica(db: Session = Depends(get_db)):
    orgaos = _catalogo(db, "orgao_direcao")
    cargos = _catalogo(db, "titulo_cargo")
    vigentes = [m for m in db.query(Mandato).all() if m.vigente()]
    associados = {
        a.id_associado: a for a in db.query(Associado).filter(Associado.id_associado.in_({m.id_associado for m in vigentes})).all()
    } if vigentes else {}
    nomes = {i: a.nome_completo for i, a in associados.items()}
    # v5.7c: só quem AUTORIZOU a imagem tem foto aqui (a foto do cadastro de associado nunca sai por esta rota); quem não tem aparece sem foto
    fotos = {
        f.id_pessoa: f for f in db.query(FotoDaDiretoria).filter(
            FotoDaDiretoria.id_pessoa.in_({a.id_pessoa for a in associados.values()}), FotoDaDiretoria.autorizacao_imagem.is_(True),
        ).all()
    } if associados else {}

    linhas = []
    for m in vigentes:
        nome = nomes.get(m.id_associado)
        if not nome:
            continue  # mandato sem pessoa identificável não vai a público
        orgao_rotulo, orgao_ordem = orgaos.get(m.orgao_codigo, (m.orgao_codigo, 999))
        cargo_rotulo, cargo_ordem = cargos.get(m.cargo_codigo, (m.cargo_codigo, 999))
        linhas.append((
            (orgao_ordem, cargo_ordem, nome),
            {
                "orgao_codigo": m.orgao_codigo, "orgao": orgao_rotulo,
                "cargo_codigo": m.cargo_codigo, "cargo": cargo_rotulo,
                "nome": nome, "data_inicio": _data(m.data_inicio), "data_fim_previsto": _data(m.data_fim_previsto),
                "foto": _foto_publica_da_diretoria(fotos.get(associados[m.id_associado].id_pessoa), nome, cargo_rotulo),
            },
        ))
    return [dados for _, dados in sorted(linhas, key=lambda par: par[0])]


@router.get("/api/publico/diretoria/fotos/{id_foto}", summary="Foto de quem está na Diretoria ou no Conselho (a autorização de imagem existe e a pessoa tem mandato vigente)")
async def foto_publica_da_diretoria(id_foto: int, db: Session = Depends(get_db)):
    foto = servico_fotos_da_diretoria.foto_publica(db, id_foto)
    if foto is None:  # não existe, sem autorização ou sem mandato vigente: todos respondem igual
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    conteudo = await run_in_threadpool(servico_fotos_da_diretoria.ler_arquivo, foto)
    return Response(content=conteudo, media_type="image/jpeg", headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300"})


# ==========================================
# PROJETOS PÚBLICOS
# ==========================================
def _serializar_projeto_publico(p: ProjetoEvento, tipos: dict, status: dict) -> dict:
    return {
        "id_projeto": p.id_projeto, "nome": p.nome_projeto, "descricao": p.descricao,
        "tipo_codigo": p.tipo_projeto, "tipo": tipos.get(p.tipo_projeto or "", (p.tipo_projeto, 0))[0],
        "status_codigo": p.status, "status": status.get(p.status or "", (p.status, 0))[0],
        "publico_alvo": p.publico_alvo, "data_inicio": _data(p.data_inicio), "data_fim_prevista": _data(p.data_fim_prevista),
        # v5.5: o projeto principal da associação (o Despertai) aparece em destaque na página inicial
        "destaque": bool(p.destaque_no_site),
    }


@router.get("/api/publico/projetos", summary="Projetos públicos (leitura, sem autenticação, pro site institucional)")
def listar_projetos_publicos(db: Session = Depends(get_db)):
    tipos, status = _catalogo(db, "tipo_projeto"), _catalogo(db, "status_projeto")
    projetos = (
        db.query(ProjetoEvento).filter(ProjetoEvento.visibilidade == VISIBILIDADE_PUBLICA)
        .order_by(ProjetoEvento.criado_em.desc(), ProjetoEvento.id_projeto.desc()).all()
    )
    return [_serializar_projeto_publico(p, tipos, status) for p in projetos]


@router.get("/api/publico/projetos/{id_projeto}", summary="Detalhe de um projeto público (leitura, sem autenticação)")
def obter_projeto_publico(id_projeto: int, db: Session = Depends(get_db)):
    projeto = db.query(ProjetoEvento).filter(ProjetoEvento.id_projeto == id_projeto).first()
    if not projeto or projeto.visibilidade != VISIBILIDADE_PUBLICA:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    # v5.5: o contexto do projeto — as edições/eventos dele, os relatórios e documentos aprovados e as fotos dos eventos
    return {
        **_serializar_projeto_publico(projeto, _catalogo(db, "tipo_projeto"), _catalogo(db, "status_projeto")),
        **publico_contexto.contexto_do_projeto(db, projeto),
    }


# ==========================================
# ASSEMBLEIAS CONVOCADAS (edital público)
# ==========================================
def texto_publico_do_edital(texto: str) -> str:
    """Edital sem o link de acesso remoto (ver o topo do arquivo)."""
    return _RE_LINK_REMOTO.sub("", texto)


def _serializar_assembleia_publica(db: Session, a: Assembleia) -> dict:
    edital = texto_publico_do_edital(a.edital_texto or "")
    return {
        "id_assembleia": a.id_assembleia, "tipo": a.tipo, "status": a.status, "pauta": a.pauta,
        "local_fisico": a.local_fisico, "convocada_em": a.convocada_em,
        **horarios_convocacao(db, a),
        "edital_texto": edital,
        # Comprovante de integridade: quem guardar este hash prova depois que o edital publicado
        # não foi alterado (e o site mostra o mesmo hash junto do texto).
        "edital_sha256": hashlib.sha256(edital.encode("utf-8")).hexdigest(),
    }


def _assembleias_publicas(db: Session):
    return (
        db.query(Assembleia)
        .filter(Assembleia.status != RASCUNHO, Assembleia.edital_texto.isnot(None), Assembleia.convocada_em.isnot(None))
        .order_by(Assembleia.data_hora_convocacao.desc(), Assembleia.id_assembleia.desc())
    )


@router.get("/api/publico/assembleias", summary="Assembleias convocadas, com edital (leitura, sem autenticação, pro site institucional)")
def listar_assembleias_publicas(db: Session = Depends(get_db)):
    return [_serializar_assembleia_publica(db, a) for a in _assembleias_publicas(db).all()]


@router.get("/api/publico/assembleias/{id_assembleia}", summary="Edital de uma assembleia convocada (leitura, sem autenticação)")
def obter_assembleia_publica(id_assembleia: int, db: Session = Depends(get_db)):
    assembleia = _assembleias_publicas(db).filter(Assembleia.id_assembleia == id_assembleia).first()
    if not assembleia:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada.")
    return _serializar_assembleia_publica(db, assembleia)


# ==========================================
# DOCUMENTOS DA TRANSPARÊNCIA (v5.4a) - só o APROVADO, só a versão pública
# ==========================================
_documentos_publicos = publico_contexto.documentos_publicos
_serializar_documento_publico = publico_contexto.serializar_documento_publico


@router.get("/api/publico/transparencia/documentos", summary="Documentos aprovados para a transparência (leitura, sem autenticação, pro site)")
def listar_documentos_publicos(db: Session = Depends(get_db)):
    visiveis = publico_contexto.vinculos_visiveis(db)
    documentos = _documentos_publicos(db)
    responsaveis = publico_contexto.responsaveis_das_aprovacoes(db, documentos)
    return [_serializar_documento_publico(d, visiveis, responsaveis) for d in documentos]


@router.get("/api/publico/transparencia/documentos/{id_documento}", summary="Detalhe de um documento aprovado; no formato TEXTO traz o texto publicado")
def obter_documento_publico(id_documento: int, db: Session = Depends(get_db)):
    d = next((x for x in _documentos_publicos(db) if x.id_documento == id_documento), None)
    if d is None:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    return {
        **_serializar_documento_publico(d, publico_contexto.vinculos_visiveis(db), publico_contexto.responsaveis_das_aprovacoes(db, [d])),
        "texto": d.publico_texto if d.publico_formato == FORMATO_TEXTO else None,
    }


@router.get("/api/publico/transparencia/contas", summary="As contas de cada exercício aprovadas pela Assembleia e publicadas (v6.3b): os números gerados dos lançamentos")
def contas_publicas_por_exercicio(db: Session = Depends(get_db)):
    """Uma entrada por exercício: a versão VIGENTE do documento gerado das contas, já aprovado para o site (o mesmo documento aparece na lista de
    documentos, em texto). Os números vêm do JSON gravado na geração (não se recalcula aqui: o publicado é o que foi aprovado)."""
    import json

    gerados = [d for d in _documentos_publicos(db) if d.tipo == "BALANCO" and d.dados_publicos_json and d.vigente]
    responsaveis = publico_contexto.responsaveis_das_aprovacoes(db, gerados)
    por_ano: dict[int, dict] = {}
    for d in sorted(gerados, key=lambda x: x.versao):
        por_ano[d.ano] = {
            "ano": d.ano, "id_documento": d.id_documento, "titulo": d.titulo, "versao": d.versao,
            "aprovado_em": publico_contexto.dia_de_belem(d.aprovado_em), "aprovado_por": responsaveis.get(d.id_documento),
            "dados": json.loads(d.dados_publicos_json),
        }
    return [por_ano[a] for a in sorted(por_ano, reverse=True)]


@router.get("/api/publico/transparencia/relatorios-anuais", summary="O relatório anual de atividades de cada ano, publicado (v6.3c): os números do sistema e a apresentação")
def relatorios_anuais_publicados(db: Session = Depends(get_db)):
    """Uma entrada por ano: a versão VIGENTE do relatório gerado, já aprovada para o site (o mesmo documento aparece na lista de documentos, em texto).
    Os números e a apresentação vêm do JSON gravado na geração (o publicado é o que foi aprovado)."""
    import json

    gerados = [d for d in _documentos_publicos(db) if d.tipo == "RELATORIO_ANUAL" and d.dados_publicos_json and d.vigente]
    responsaveis = publico_contexto.responsaveis_das_aprovacoes(db, gerados)
    por_ano: dict[int, dict] = {}
    for d in sorted(gerados, key=lambda x: x.versao):
        por_ano[d.ano] = {
            "ano": d.ano, "id_documento": d.id_documento, "titulo": d.titulo, "versao": d.versao,
            "aprovado_em": publico_contexto.dia_de_belem(d.aprovado_em), "aprovado_por": responsaveis.get(d.id_documento),
            "dados": json.loads(d.dados_publicos_json),
        }
    return [por_ano[a] for a in sorted(por_ano, reverse=True)]


@router.get("/api/publico/transparencia/documentos/{id_documento}/arquivo", summary="PDF da versão pública de um documento aprovado")
async def arquivo_do_documento_publico(id_documento: int, db: Session = Depends(get_db)):
    d = next((x for x in _documentos_publicos(db) if x.id_documento == id_documento and x.publico_formato != FORMATO_TEXTO), None)
    if d is None:  # inexistente, em rascunho, em revisão, retirado ou de formato texto (não tem arquivo): todos respondem igual
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    conteudo = await run_in_threadpool(armazenamento.obter().ler, "documentos-publicos", d.publico_nome)
    if conteudo is None:
        raise HTTPException(status_code=404, detail="Documento não encontrado.")
    return Response(
        content=conteudo, media_type="application/pdf",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": 'inline; filename="documento.pdf"',
            "Cache-Control": "public, max-age=300",
        },
    )


# ==========================================
# PARCERIAS E EMENDAS DA TRANSPARÊNCIA (v5.4a) - só a APROVADA, campos explícitos
# ==========================================
@router.get("/api/publico/transparencia/parcerias", summary="Parcerias e emendas aprovadas para a transparência (leitura, sem autenticação, pro site)")
def listar_parcerias_publicas(db: Session = Depends(get_db)):
    return [servico_de_parcerias.serializar_publico(db, p) for p in servico_de_parcerias.parcerias_publicas(db)]


@router.get("/api/publico/transparencia/parcerias/{id_parceria}", summary="Detalhe público de uma parceria aprovada: parcelas, recebimentos, pagamentos, etapas, relatórios e documentos")
def obter_parceria_publica(id_parceria: int, db: Session = Depends(get_db)):
    p = next((x for x in servico_de_parcerias.parcerias_publicas(db) if x.id_parceria == id_parceria), None)
    if p is None:  # inexistente, rascunho, em revisão ou retirada: todas respondem igual
        raise HTTPException(status_code=404, detail="Parceria não encontrada.")
    return servico_de_parcerias.serializar_publico(db, p, detalhe=True)


@router.get("/api/publico/transparencia/parcerias/{id_parceria}/fotos/{id_foto}", summary="Foto de uma etapa de parceria APROVADA (a autorização de imagem já foi confirmada)")
async def foto_publica_da_etapa(id_parceria: int, id_foto: int, db: Session = Depends(get_db)):
    p = next((x for x in servico_de_parcerias.parcerias_publicas(db) if x.id_parceria == id_parceria), None)
    foto = (
        db.query(FotoEtapaParceria)
        .filter(FotoEtapaParceria.id_foto == id_foto, FotoEtapaParceria.id_parceria == id_parceria, FotoEtapaParceria.autorizacao_imagem.is_(True))
        .first() if p else None
    )
    if foto is None:  # parceria não aprovada, foto de outra parceria ou sem autorização: todos respondem igual
        raise HTTPException(status_code=404, detail="Foto não encontrada.")
    conteudo = await run_in_threadpool(servico_de_fotos.ler_arquivo, foto)
    return Response(
        content=conteudo, media_type="image/jpeg",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=300"},
    )
