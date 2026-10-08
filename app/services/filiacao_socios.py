"""v5.4h - Filiação proposta por sócios (Estatuto Art. 12, par. único VI: "devendo ser proposto por 03 (três) sócios"). Decisões do Presidente (2026-10-07):
qualquer sócio ativo e apto propõe; o pedido passa pela análise da Diretoria Executiva; os sócios são avisados no painel para propor ou recusar; não há
prazo (sem resposta, o pedido fica pendente).

"Sócio apto" = associado com acesso ao painel, ativo e sem inadimplência: em dia ou ainda em experiência. Licenciado, inadimplente, suspenso ou desligado
não propõe. O candidato nunca aparece com CPF, e-mail ou telefone para os sócios (só nome e idade): isso é da Diretoria, na conferência."""
from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.core import Usuario
from app.models.filiacao import APROVADA, EM_CONFERENCIA, PENDENTE, PROPOE, PROPONENTES_EXIGIDOS, RECUSA, RECUSADA, PropostaDeSocio, PropostaFiliacao
from app.services import notificacoes_painel
from app.services.categoria_associado import ATIVO_EM_DIA, EM_EXPERIENCIA

STATUS_APTOS = (ATIVO_EM_DIA, EM_EXPERIENCIA)
STATUS_ABERTOS = (PENDENTE, EM_CONFERENCIA)
TAMANHO_MINIMO_DO_MOTIVO = 5
LINK_DA_TELA_DOS_SOCIOS = "/filiacao/para-propor"


def associado_do_usuario(db: Session, usuario: Usuario) -> Optional[Associado]:
    return db.query(Associado).filter(Associado.id_usuario == usuario.id_usuario).first()


def exigir_socio_apto(db: Session, usuario: Usuario) -> Associado:
    associado = associado_do_usuario(db, usuario)
    if associado is None or associado.status_arrolamento not in STATUS_APTOS:
        raise HTTPException(status_code=403, detail="Só sócio ativo e em dia propõe um candidato.")
    return associado


def usuarios_dos_socios_aptos(db: Session) -> list[int]:
    linhas = db.query(Associado.id_usuario).filter(Associado.id_usuario.isnot(None), Associado.status_arrolamento.in_(STATUS_APTOS)).all()
    return [i for (i,) in linhas]


def avisar_socios_da_nova_proposta(db: Session, proposta: PropostaFiliacao) -> int:
    """Um aviso no sino de cada sócio apto. Não faz commit (quem cria o pedido fecha a transação)."""
    return notificacoes_painel.notificar(
        db, usuarios_dos_socios_aptos(db), tipo="filiacao_proposta", titulo="Novo pedido de filiação",
        texto=f"{proposta.nome_completo} quer se associar. O Estatuto pede 3 sócios propondo: você propõe este candidato?",
        link=LINK_DA_TELA_DOS_SOCIOS,
    )


def decisoes_dos_pedidos(db: Session, ids_propostas: list[int]) -> dict[int, list[dict]]:
    """Para a Diretoria: quem propôs ou recusou cada pedido, com o motivo, em ordem."""
    mapa: dict[int, list[dict]] = {i: [] for i in ids_propostas}
    if not ids_propostas:
        return mapa
    linhas = (
        db.query(PropostaDeSocio, Associado).join(Associado, Associado.id_associado == PropostaDeSocio.id_associado)
        .filter(PropostaDeSocio.id_proposta.in_(ids_propostas)).order_by(PropostaDeSocio.criado_em, PropostaDeSocio.id_proposta_socio).all()
    )
    for decisao, associado in linhas:
        mapa[decisao.id_proposta].append({
            "id_associado": associado.id_associado, "socio": associado.nome_completo, "decisao": decisao.decisao,
            "observacao": decisao.observacao, "em": decisao.atualizado_em or decisao.criado_em,
        })
    return mapa


def total_que_propoem(db: Session, id_proposta: int) -> int:
    return db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta == id_proposta, PropostaDeSocio.decisao == PROPOE).count()


def exigir_proponentes_suficientes(db: Session, proposta: PropostaFiliacao) -> None:
    propoem = total_que_propoem(db, proposta.id_proposta)
    if propoem < PROPONENTES_EXIGIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"O Estatuto (Art. 12) pede o pedido proposto por {PROPONENTES_EXIGIDOS} sócios: até agora {propoem} propuseram. Faltam {PROPONENTES_EXIGIDOS - propoem}.",
        )


def _idade(nascimento: Optional[datetime]) -> Optional[int]:
    if nascimento is None:
        return None
    hoje = date.today()
    nasc = nascimento.date()
    return hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))


def pedidos_abertos_para(db: Session, associado: Associado) -> list[dict]:
    """O que o sócio vê: os pedidos abertos (sem CPF, e-mail nem telefone), quantos já propuseram e o que ele mesmo decidiu."""
    propostas = db.query(PropostaFiliacao).filter(PropostaFiliacao.status.in_(STATUS_ABERTOS)).order_by(PropostaFiliacao.criado_em.desc()).all()
    meu_cpf = associado.cpf
    propostas = [p for p in propostas if p.cpf != meu_cpf]
    ids = [p.id_proposta for p in propostas]
    todas = db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta.in_(ids)).all() if ids else []
    por_pedido: dict[int, list[PropostaDeSocio]] = {i: [] for i in ids}
    for d in todas:
        por_pedido[d.id_proposta].append(d)
    resultado = []
    for p in propostas:
        decisoes = por_pedido[p.id_proposta]
        propoem = sum(1 for d in decisoes if d.decisao == PROPOE)
        minha = next((d for d in decisoes if d.id_associado == associado.id_associado), None)
        resultado.append({
            "id_proposta": p.id_proposta, "nome_completo": p.nome_completo, "idade": _idade(p.data_nascimento), "criado_em": p.criado_em,
            "total_propoem": propoem, "exigidos": PROPONENTES_EXIGIDOS, "faltam": max(0, PROPONENTES_EXIGIDOS - propoem),
            "minha_decisao": minha.decisao if minha else None, "meu_motivo": minha.observacao if minha else None,
        })
    return resultado


def registrar_decisao_do_socio(
    db: Session, *, proposta: PropostaFiliacao, associado: Associado, decisao: str, observacao: Optional[str], usuario: Usuario,
) -> PropostaDeSocio:
    if decisao not in (PROPOE, RECUSA):
        raise HTTPException(status_code=422, detail=f"A decisão deve ser '{PROPOE}' ou '{RECUSA}'.")
    if proposta.status not in STATUS_ABERTOS:
        raise HTTPException(status_code=409, detail=f"Este pedido já está '{proposta.status}': não recebe mais propostas.")
    if proposta.cpf == associado.cpf:
        raise HTTPException(status_code=403, detail="Ninguém propõe a própria filiação.")
    motivo = (observacao or "").strip()
    if decisao == RECUSA and len(motivo) < TAMANHO_MINIMO_DO_MOTIVO:
        raise HTTPException(status_code=422, detail=f"Recusar exige o motivo (pelo menos {TAMANHO_MINIMO_DO_MOTIVO} letras): a Diretoria lê o que você escrever.")
    existente = db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta == proposta.id_proposta, PropostaDeSocio.id_associado == associado.id_associado).first()
    if existente is None:
        existente = PropostaDeSocio(id_proposta=proposta.id_proposta, id_associado=associado.id_associado, id_usuario_criacao=usuario.id_usuario, decisao=decisao)
        db.add(existente)
    existente.decisao = decisao
    existente.observacao = motivo or None
    db.commit()
    db.refresh(existente)
    return existente
