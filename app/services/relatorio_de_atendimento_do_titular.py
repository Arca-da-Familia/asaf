"""v7.2f (FASE 7) - o RELATÓRIO DE ATENDIMENTO das solicitações do titular de dados (LGPD, art. 18; a prestação de contas do art. 6º, X): quantas chegaram, de
que direito, por que canal, com que resultado e fundamento, se a resposta saiu no prazo e em quanto tempo, quantos relatórios foram entregues e quantas
eliminações feitas. Decisão 12 do Presidente (2026-10-28): uma tela para a Diretoria (Privacidade > Relatório de atendimento) e o resumo no relatório anual.

Só contagens, sem nome, protocolo ou texto de ninguém. Na tela da Diretoria, o número exato; no relatório anual (público), a mesma regra dos outros números
dele - contagem abaixo de 5 vira "menos de 5" (relatorio_anual.MINIMO_PUBLICAVEL) - e mais: as partes (atendidos, em parte, não atendidos; no prazo, fora do
prazo) só saem quando nenhuma delas, nem o que sobra do total, fica entre 1 e 4 (senão daria para descobrir a parte protegida por subtração); o tempo médio só
com 5 respostas ou mais. Os relatórios entregues e as eliminações contam PEDIDOS (liberar de novo, ou terminar uma eliminação que parou, não conta duas vezes;
a eliminação que parou e não foi terminada não conta). A situação de cada pedido é a da data em que o relatório é montado."""
from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.atendimento import EM_ATENDIMENTO, IDENTIDADE_CODIGO_NO_EMAIL, NOVO, TITULAR_LGPD, Atendimento
from app.models.core import AuditLog
from app.services import atendimento as atendimentos

CANAIS = {"site": "Formulário do site", "minha_conta": "Minha conta do site", "painel": "Painel (Meu perfil)"}
RESULTADOS = {**atendimentos.ROTULOS_DO_RESULTADO, "EM_ANDAMENTO": "Ainda em andamento", "SEM_RESULTADO": "Respondido antes de o resultado ser registrado"}


def _canal(a: Atendimento) -> str:
    # só o que a rotina de guarda não apaga (o assunto some em 5 anos: o número de um ano passado não pode mudar sozinho)
    if a.origem == "painel":
        return "painel"
    if a.identidade_validacao == IDENTIDADE_CODIGO_NO_EMAIL:
        return "minha_conta"
    return "site"


def _resultado(a: Atendimento) -> str:
    if a.status in (NOVO, EM_ATENDIMENTO) and a.respondido_em is None:
        return "EM_ANDAMENTO"
    if a.resultado:
        return a.resultado
    # antes da v7.2a o resultado não era registrado
    return "SEM_RESULTADO" if a.respondido_em is not None else atendimentos.ENCERRADO_SEM_RESPOSTA


def _pedidos_com(db: Session, ids: list[int], acao: str) -> set[int]:
    return {i for (i,) in db.query(AuditLog.id_registro_afetado).filter(
        AuditLog.tabela_afetada == "atendimentos", AuditLog.id_registro_afetado.in_(ids), AuditLog.acao == acao)} if ids else set()


def _eliminacoes_feitas(db: Session, ids: list[int]) -> set[int]:
    """Os pedidos em que a eliminação terminou: o último registro dela não é o de que parou no meio."""
    if not ids:
        return set()
    ultimo: dict[int, str] = {}
    for id_pedido, acao in db.query(AuditLog.id_registro_afetado, AuditLog.acao).filter(
            AuditLog.tabela_afetada == "atendimentos", AuditLog.id_registro_afetado.in_(ids),
            AuditLog.acao.in_(("ELIMINACAO_A_PEDIDO", "ELIMINACAO_A_PEDIDO_INCOMPLETA"))).order_by(AuditLog.id_log):
        ultimo[id_pedido] = acao
    return {i for i, acao in ultimo.items() if acao == "ELIMINACAO_A_PEDIDO"}


def resumo(db: Session, inicio: datetime, fim: datetime, agora: Optional[datetime] = None) -> dict:
    """As solicitações do titular FEITAS entre `inicio` (incluído) e `fim` (excluído), em UTC, como o banco guarda."""
    agora = agora or datetime.utcnow()
    pedidos = db.query(Atendimento).filter(Atendimento.tipo == TITULAR_LGPD, Atendimento.criado_em >= inicio, Atendimento.criado_em < fim).all()
    respondidos = [a for a in pedidos if a.respondido_em is not None]
    dias = [(a.respondido_em - a.criado_em).total_seconds() / 86400 for a in respondidos if a.criado_em]
    direitos = Counter(a.subtipo or "OUTRO" for a in pedidos)
    resultados = Counter(_resultado(a) for a in pedidos)
    fundamentos = Counter(a.fundamento for a in pedidos if a.fundamento)
    canais = Counter(_canal(a) for a in pedidos)
    ids = [a.id_atendimento for a in pedidos]
    return {
        "total": len(pedidos),
        "por_direito": [{"codigo": c, "rotulo": atendimentos.ROTULOS_DO_SUBTIPO_LGPD.get(c, c), "total": direitos[c]}
                        for c in atendimentos.ROTULOS_DO_SUBTIPO_LGPD if direitos[c]],
        "por_resultado": [{"codigo": c, "rotulo": r, "total": resultados[c]} for c, r in RESULTADOS.items() if resultados[c]],
        "por_fundamento": [{"codigo": c, "texto": atendimentos.FUNDAMENTOS.get(c, c), "total": fundamentos[c]} for c in atendimentos.FUNDAMENTOS if fundamentos[c]],
        "por_canal": [{"codigo": c, "rotulo": r, "total": canais[c]} for c, r in CANAIS.items() if canais[c]],
        "respondidos": len(respondidos),
        "respondidos_no_prazo": sum(1 for a in respondidos if a.respondido_em <= a.prazo_em),
        "respondidos_fora_do_prazo": sum(1 for a in respondidos if a.respondido_em > a.prazo_em),
        "em_andamento_vencidos": sum(1 for a in pedidos if a.respondido_em is None and a.status in (NOVO, EM_ATENDIMENTO) and a.prazo_em < agora),
        "tempo_medio_de_resposta_dias": round(sum(dias) / len(dias), 1) if dias else None,
        "relatorios_entregues": len(_pedidos_com(db, ids, "RELATORIO_DO_TITULAR_LIBERADO")),
        "eliminacoes_feitas": len(_eliminacoes_feitas(db, ids)),
    }


def para_o_relatorio_anual(dados: dict) -> dict:
    """O resumo publicado no relatório anual: só os totais (sem o detalhe por direito e canal, que com poucos pedidos apontaria pessoas), protegidos."""
    from app.services.relatorio_anual import MINIMO_PUBLICAVEL, _protegido

    def total(codigo: str) -> int:
        return next((r["total"] for r in dados["por_resultado"] if r["codigo"] == codigo), 0)

    def seguro(*numeros: int) -> bool:
        return all(n == 0 or n >= MINIMO_PUBLICAVEL for n in numeros)

    resultado = (total("ATENDIDO"), total("ATENDIDO_EM_PARTE"), total("NEGADO"))
    resto = dados["total"] - sum(resultado)  # em andamento, encerrados sem resposta, respondidos antes do resultado
    prazo = (dados["respondidos_no_prazo"], dados["respondidos_fora_do_prazo"])
    mostra_resultado = seguro(*resultado, resto) and seguro(dados["total"])
    mostra_prazo = seguro(*prazo) and seguro(dados["total"])
    return {
        "total": _protegido(dados["total"]),
        "atendidos": resultado[0] if mostra_resultado else None,
        "atendidos_em_parte": resultado[1] if mostra_resultado else None,
        "nao_atendidos": resultado[2] if mostra_resultado else None,
        "respondidos_no_prazo": prazo[0] if mostra_prazo else None,
        "respondidos_fora_do_prazo": prazo[1] if mostra_prazo else None,
        "tempo_medio_de_resposta_dias": dados["tempo_medio_de_resposta_dias"] if dados["respondidos"] >= MINIMO_PUBLICAVEL else None,
    }
