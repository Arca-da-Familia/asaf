"""v3.2.1/v3.2.2 (adaptado, 2026-09-17) - régua de cobrança por e-mail, com o Pix já pronto
(copia e cola) - substitui Pix Automático (Resolução BCB 402/506, exige convênio com um banco/PSP
parceiro pago, sem orçamento hoje - achado confirmado com o usuário). Multicanal fica pra FASE
11/v11.3 (só e-mail por enquanto). Cada tipo de lembrete só sai uma vez por título
(`LembreteMensalidadeEnviado`, trava por UniqueConstraint(id_titulo, tipo_lembrete)):
- alguns dias antes do vencimento (`DIAS_LEMBRETE_MENSALIDADE`, configurável);
- no próprio dia do vencimento;
- escalonado depois do vencimento (`DIAS_ATRASO_LEMBRETE`, lista configurável de dias de
  atraso - v3.2.2), tom mais urgente, mencionando a possibilidade de negociar/parcelar.
Nunca debita nada sozinho - só entrega o Pix pronto na caixa de entrada, decisão de pagar
continua 100% humana."""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.associados import Associado
from app.models.core import ConfiguracaoInstitucional
from app.models.financeiro import LembreteMensalidadeEnviado, TituloFinanceiro
from app.services import notificacoes, pix

_DIAS_LEMBRETE_PADRAO = 5
_DIAS_ATRASO_PADRAO = [7, 15, 30]


def _dias_lembrete_configurado(db: Session) -> int:
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "DIAS_LEMBRETE_MENSALIDADE").first()
    try:
        return int(config.valor_configuracao) if config and config.valor_configuracao else _DIAS_LEMBRETE_PADRAO
    except ValueError:
        return _DIAS_LEMBRETE_PADRAO


def _dias_atraso_configurado(db: Session) -> list[int]:
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "DIAS_ATRASO_LEMBRETE").first()
    if not config or not config.valor_configuracao:
        return _DIAS_ATRASO_PADRAO
    try:
        return sorted({int(d.strip()) for d in config.valor_configuracao.split(",") if d.strip()})
    except ValueError:
        return _DIAS_ATRASO_PADRAO


def _corpo_lembrete(titulo: TituloFinanceiro, payload_pix: str, tipo_lembrete: str) -> str:
    if tipo_lembrete == "NO_VENCIMENTO":
        quando = "vence hoje"
    elif tipo_lembrete.startswith("ATRASO_"):
        dias = tipo_lembrete.split("_")[1]
        quando = f"está em atraso há {dias} dia(s) (venceu em {titulo.data_vencimento.strftime('%d/%m/%Y')})"
    else:
        quando = f"vence em {titulo.data_vencimento.strftime('%d/%m/%Y')}"

    aviso_atraso = (
        "\nSe precisar, procure a tesouraria para negociar o pagamento em parcelas - "
        "regularizar reabilita automaticamente seus direitos associativos.\n"
        if tipo_lembrete.startswith("ATRASO_") else ""
    )
    return (
        f"Olá,\n\nSua mensalidade \"{titulo.descricao}\" {quando}, no valor de "
        f"R$ {titulo.saldo_devedor:.2f}.\n\n"
        f"Pix copia e cola (abra o app do seu banco, Pix > Pix Copia e Cola):\n{payload_pix}\n"
        f"{aviso_atraso}\n"
        f"Este é um lembrete automático - nenhum valor foi debitado, o pagamento continua "
        f"sendo feito por você, quando quiser.\n"
    )


def enviar_lembretes_do_dia(db: Session, hoje: Optional[datetime] = None) -> list[dict]:
    hoje_data = (hoje or datetime.utcnow()).date()
    dias_antes = _dias_lembrete_configurado(db)

    tipos_e_datas = [
        ("ANTES_VENCIMENTO", hoje_data + timedelta(days=dias_antes)),
        ("NO_VENCIMENTO", hoje_data),
    ]
    for dias_atraso in _dias_atraso_configurado(db):
        tipos_e_datas.append((f"ATRASO_{dias_atraso}", hoje_data - timedelta(days=dias_atraso)))

    resultado: list[dict] = []
    for tipo_lembrete, data_alvo in tipos_e_datas:
        titulos = (
            db.query(TituloFinanceiro)
            .filter(
                TituloFinanceiro.tipo_titulo == "A Receber",
                TituloFinanceiro.status == "Pendente",
                TituloFinanceiro.id_associado.isnot(None),
                func.date(TituloFinanceiro.data_vencimento) == data_alvo,
            )
            .all()
        )
        for titulo in titulos:
            ja_enviado = (
                db.query(LembreteMensalidadeEnviado)
                .filter(LembreteMensalidadeEnviado.id_titulo == titulo.id_titulo, LembreteMensalidadeEnviado.tipo_lembrete == tipo_lembrete)
                .first()
            )
            if ja_enviado:
                continue

            associado = db.query(Associado).filter(Associado.id_associado == titulo.id_associado).first()
            email = associado.email_contato if associado else None
            if not email:
                continue

            payload_pix = pix.payload_pix_do_titulo(db, titulo)
            notificacoes.enviar_email(
                email,
                assunto=f"Lembrete de mensalidade - {titulo.descricao}",
                corpo_texto=_corpo_lembrete(titulo, payload_pix, tipo_lembrete),
            )
            db.add(LembreteMensalidadeEnviado(id_titulo=titulo.id_titulo, tipo_lembrete=tipo_lembrete))
            db.commit()
            resultado.append({"id_titulo": titulo.id_titulo, "tipo_lembrete": tipo_lembrete, "email": email})

    return resultado
