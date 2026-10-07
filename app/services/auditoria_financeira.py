"""v5.4h - Auditoria financeira do Conselho Fiscal: o Conselho aprova, reprova ou ressalva cada título do mês.

Regras (decisões do Presidente em 2026-10-07):
  - cada conselheiro decide por conta própria; a decisão VIGENTE dele é a mais recente naquele título (o histórico fica inteiro);
  - o título fica **Aprovado** (e travado) quando a MAIORIA dos membros do Conselho aprovou (3 membros -> 2; o número de vagas é o do Art. 24);
  - reprovar ou ressalvar exige explicação e abre um questionamento (a fila que a tesouraria já responde); enquanto esse questionamento
    estiver aberto o título fica **Suspenso**, e responder o reabre para a decisão do conselheiro;
  - título aprovado não é estornado nem renegociado; só um conselheiro, com motivo, pode **reabri-lo** (a decisão "Reaberto" zera as
    decisões anteriores, que continuam no histórico);
  - o conselheiro não audita título em que ele mesmo é parte."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.conselho_fiscal import (
    ABERTO, APROVADO, COM_RESSALVA, DECISOES_AUDITORIA, REABERTO, REPROVADO, AuditoriaDeTitulo, QuestionamentoLancamento,
)
from app.models.financeiro import TituloFinanceiro
from app.services.mandatos import ORGAO_CONSELHO_FISCAL, vagas_do_cargo

PENDENTE = "Pendente"
SUSPENSO = "Suspenso"
SITUACOES = (PENDENTE, SUSPENSO, APROVADO)
TAMANHO_MINIMO_DA_EXPLICACAO = 10
MAXIMO_POR_LOTE = 500


def quorum(db: Session) -> int:
    """Maioria dos membros do Conselho Fiscal (o número de vagas vem do Art. 24, `VAGAS_CONSELHO_FISCAL`)."""
    return vagas_do_cargo(db, ORGAO_CONSELHO_FISCAL, ORGAO_CONSELHO_FISCAL) // 2 + 1


def registros_por_titulo(db: Session, ids_titulos: list[int]) -> dict[int, list[AuditoriaDeTitulo]]:
    """Todas as linhas da auditoria de cada título, da mais antiga para a mais nova."""
    mapa: dict[int, list[AuditoriaDeTitulo]] = {i: [] for i in ids_titulos}
    if not ids_titulos:
        return mapa
    linhas = (
        db.query(AuditoriaDeTitulo).filter(AuditoriaDeTitulo.id_titulo.in_(ids_titulos)).order_by(AuditoriaDeTitulo.id_auditoria).all()
    )
    for linha in linhas:
        mapa[linha.id_titulo].append(linha)
    return mapa


def decisoes_vigentes(registros: list[AuditoriaDeTitulo]) -> dict[int, AuditoriaDeTitulo]:
    """A decisão mais recente de cada conselheiro; uma reabertura zera as anteriores (elas continuam no histórico)."""
    vigentes: dict[int, AuditoriaDeTitulo] = {}
    for r in registros:
        if r.decisao == REABERTO:
            vigentes = {}
        else:
            vigentes[r.id_associado_conselheiro] = r
    return vigentes


def _questionamentos_abertos(db: Session, linhas: list[AuditoriaDeTitulo]) -> set[int]:
    ids = {l.id_questionamento for l in linhas if l.id_questionamento}
    if not ids:
        return set()
    return {
        q.id_questionamento
        for q in db.query(QuestionamentoLancamento).filter(QuestionamentoLancamento.id_questionamento.in_(ids), QuestionamentoLancamento.status == ABERTO).all()
    }


def situacoes_dos_titulos(db: Session, ids_titulos: list[int]) -> dict[int, dict]:
    """Para cada título: situação (Pendente, Suspenso ou Aprovado), quantas aprovações, as decisões vigentes e o histórico."""
    necessario = quorum(db)
    registros = registros_por_titulo(db, ids_titulos)
    todas = [l for lista in registros.values() for l in lista]
    abertos = _questionamentos_abertos(db, todas)
    resultado = {}
    for id_titulo, lista in registros.items():
        vigentes = decisoes_vigentes(lista)
        aprovacoes = sum(1 for d in vigentes.values() if d.decisao == APROVADO)
        suspensa = any(d.decisao != APROVADO and d.id_questionamento in abertos for d in vigentes.values())
        situacao = SUSPENSO if suspensa else (APROVADO if aprovacoes >= necessario else PENDENTE)
        resultado[id_titulo] = {
            "situacao": situacao, "aprovacoes": aprovacoes, "quorum": necessario, "vigentes": vigentes, "historico": lista,
            "questionamentos_abertos": abertos,
        }
    return resultado


def situacao_do_titulo(db: Session, id_titulo: int) -> str:
    return situacoes_dos_titulos(db, [id_titulo])[id_titulo]["situacao"]


def exigir_titulo_destravado(db: Session, id_titulo: Optional[int], acao: str) -> None:
    """Título aprovado pelo Conselho Fiscal não sofre `acao` (estornar, renegociar) sem o Conselho reabrir a auditoria dele."""
    if id_titulo and situacao_do_titulo(db, id_titulo) == APROVADO:
        raise HTTPException(
            status_code=409,
            detail=f"Este título já foi aprovado pelo Conselho Fiscal e está travado: não dá para {acao}. Um conselheiro precisa reabrir a auditoria dele antes.",
        )


def _explicacao(decisao: str, observacao: Optional[str]) -> Optional[str]:
    texto = (observacao or "").strip()
    if decisao in (REPROVADO, COM_RESSALVA, REABERTO) and len(texto) < TAMANHO_MINIMO_DA_EXPLICACAO:
        verbo = {REPROVADO: "Reprovar", COM_RESSALVA: "Ressalvar", REABERTO: "Reabrir"}[decisao]
        raise HTTPException(status_code=422, detail=f"{verbo} exige a explicação (pelo menos {TAMANHO_MINIMO_DA_EXPLICACAO} letras): é ela que a tesouraria vai ler.")
    return texto or None


def registrar_decisao(
    db: Session, *, titulo: TituloFinanceiro, conselheiro: Associado, id_usuario: int, decisao: str, observacao: Optional[str],
) -> AuditoriaDeTitulo:
    """Grava a decisão de um conselheiro sobre um título. Levanta HTTPException quando a regra recusa (a quem chama cabe tratar)."""
    if decisao not in DECISOES_AUDITORIA | {REABERTO}:
        raise HTTPException(status_code=422, detail="A decisão deve ser Aprovado, Reprovado, Com ressalva ou Reaberto.")
    if titulo.id_associado is not None and titulo.id_associado == conselheiro.id_associado:
        raise HTTPException(status_code=403, detail="O conselheiro não audita um título em que ele mesmo é parte.")
    texto = _explicacao(decisao, observacao)
    estado = situacoes_dos_titulos(db, [titulo.id_titulo])[titulo.id_titulo]
    if decisao == REABERTO:
        if estado["situacao"] != APROVADO:
            raise HTTPException(status_code=409, detail="Só se reabre um título que já foi aprovado.")
    else:
        if estado["situacao"] == APROVADO:
            raise HTTPException(status_code=409, detail="Este título já foi aprovado pelo Conselho Fiscal e está travado.")
        minha = estado["vigentes"].get(conselheiro.id_associado)
        if minha is not None and minha.decisao == decisao == APROVADO:
            raise HTTPException(status_code=409, detail="Você já aprovou este título.")
    id_questionamento = None
    if decisao in (REPROVADO, COM_RESSALVA):
        pergunta = QuestionamentoLancamento(
            id_titulo=titulo.id_titulo, id_associado_questionador=conselheiro.id_associado,
            pergunta=f"[{decisao} na auditoria financeira] {texto}", id_usuario_criacao=id_usuario,
        )
        db.add(pergunta)
        db.flush()
        id_questionamento = pergunta.id_questionamento
    linha = AuditoriaDeTitulo(
        id_titulo=titulo.id_titulo, id_associado_conselheiro=conselheiro.id_associado, decisao=decisao, observacao=texto,
        id_questionamento=id_questionamento, id_usuario_criacao=id_usuario,
    )
    db.add(linha)
    db.commit()
    db.refresh(linha)
    return linha
