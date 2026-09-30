"""v4.9 (FASE 4) - cobrança de inscrição de evento: compõe faixa de preço vigente (por categoria/
data) → cupom → isenção justificada, nessa ordem, e gera o título "A Receber" que
`vincular_cobranca` (v4.0, nunca chamado automaticamente até esta versão) liga à inscrição.
Evento sem `valor_base` continua gratuito, comportamento preservado - nenhum caminho de
inscrição cobra nada a mais do que antes desta versão."""
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.eventos import Evento
from app.models.financeiro import TituloFinanceiro
from app.models.motores import Inscricao
from app.services import cupons as servico_cupons
from app.services import inscricao as servico_inscricao
from app.services import isencoes_taxa
from app.services import precos_evento
from app.services import vagas as servico_vagas

CONTEXTO_EVENTO = "Evento"


def calcular_valor_inscricao(
    db: Session, *, evento: Evento, id_pessoa: int, categoria_preco: Optional[str] = None,
    codigo_cupom: Optional[str] = None,
) -> dict:
    if evento.valor_base is None:
        return {"valor_final": Decimal("0"), "categoria": None, "cupom": None, "percentual_isencao": Decimal("0")}

    categoria = categoria_preco or servico_vagas.categoria_da_pessoa(db, id_pessoa=id_pessoa)
    valor = precos_evento.valor_vigente_evento(db, id_evento=evento.id_evento, categoria=categoria)
    if valor is None:
        valor = evento.valor_base

    cupom = None
    if codigo_cupom:
        valor, cupom = servico_cupons.validar_e_aplicar_cupom(
            db, contexto_tipo=CONTEXTO_EVENTO, id_contexto=evento.id_evento, codigo=codigo_cupom, valor_base=valor,
        )

    percentual = isencoes_taxa.percentual_isento(db, contexto_tipo=CONTEXTO_EVENTO, id_contexto=evento.id_evento, id_pessoa=id_pessoa)
    valor_final = (valor * (Decimal("100") - percentual) / Decimal("100")).quantize(Decimal("0.01"))
    return {"valor_final": max(Decimal("0"), valor_final), "categoria": categoria, "cupom": cupom, "percentual_isencao": percentual}


def gerar_titulo_inscricao(
    db: Session, *, evento: Evento, inscricao: Inscricao, id_pessoa: int, valor: Decimal, id_usuario: Optional[int] = None,
) -> Optional[TituloFinanceiro]:
    """`valor` zerado (evento gratuito, ou isenção/cupom que zerou o preço) nunca gera título -
    cobrar R$ 0,00 é só ruído no financeiro."""
    if valor <= 0:
        return None
    if not evento.id_conta_contabil_receita:
        raise HTTPException(status_code=400, detail="Este evento cobra inscrição mas não tem conta contábil de receita configurada.")

    associado = db.query(Associado).filter(Associado.id_pessoa == id_pessoa).first()
    from app.models.pessoas import Pessoa

    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    titulo = TituloFinanceiro(
        tipo_titulo="A Receber", id_conta_contabil=evento.id_conta_contabil_receita,
        id_associado=associado.id_associado if associado else None,
        descricao=f"Inscrição de {pessoa.nome_completo if pessoa else 'participante'} em '{evento.titulo}'",
        valor_original=valor, saldo_devedor=valor, data_vencimento=evento.data_hora_inicio, status="Pendente",
    )
    db.add(titulo)
    db.flush()
    servico_inscricao.vincular_cobranca(db, id_inscricao=inscricao.id_inscricao, id_titulo=titulo.id_titulo)
    db.commit()
    db.refresh(titulo)
    return titulo
