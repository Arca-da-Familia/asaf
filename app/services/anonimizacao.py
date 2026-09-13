"""v1.4 (FASE 1) - anonimização de dado pessoal de associado desligado, construída AGORA (não
adiada pra FASE 7) por decisão explícita do usuário: dado sensível (CPF, e-mail, telefone,
nascimento, estado civil, profissão, naturalidade, foto) de quem saiu não pode ficar retido
indefinidamente sem justificativa - só o que sustenta o financeiro (nome, matrícula) e o dado
financeiro em si (nunca apagado, nunca tocado aqui) permanecem. Quando a FASE 7 existir, o
programa de privacidade completo (inventário, base legal, outros tipos de dado) se apoia no que
já está pronto aqui, em vez de reconstruir do zero.

**Limitação aceita (mesma classe da v1.1a/v1.2)**: sem scheduler neste projeto, a anonimização
não roda sozinha no instante exato em que o prazo vence - precisa de uma chamada explícita
(`POST /api/associados/anonimizar-vencidos`, pensado para ser rodado periodicamente por um
administrador até existir automação de verdade)."""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.models.associados import Associado

CAMPOS_ANONIMIZAVEIS = [
    "cpf", "email_contato", "telefone_whatsapp", "data_nascimento",
    "estado_civil", "profissao", "naturalidade", "foto",
]


def data_elegivel_para_anonimizacao(db: Session, associado: Associado) -> Optional[datetime]:
    """Retorna a data em que o associado FICA (ou ficou) elegível, ou None se não se aplica."""
    if associado.status_arrolamento != "Desligado" or not associado.data_desligamento:
        return None
    prazo_dias = int(obter_configuracao(db, "PRAZO_RETENCAO_DESLIGADO_DIAS", "1825") or "1825")
    return associado.data_desligamento + timedelta(days=prazo_dias)


def anonimizar_associado(db: Session, associado: Associado, usuario=None, ip_origem: Optional[str] = None) -> bool:
    """Zera os campos pessoais sensíveis em `Pessoa` - nome_completo e numero_matricula (em
    Associado) NUNCA são tocados aqui, nem nenhum dado financeiro (que fica noutra tabela,
    ligada só por id_associado). Retorna False sem fazer nada se ainda não chegou o prazo."""
    data_elegivel = data_elegivel_para_anonimizacao(db, associado)
    if data_elegivel is None or datetime.utcnow() < data_elegivel:
        return False

    pessoa = associado.pessoa
    if pessoa is None:
        return False

    for campo in CAMPOS_ANONIMIZAVEIS:
        setattr(pessoa, campo, None)
    db.commit()

    # Nunca gravar os VALORES apagados no log - o AuditLog não pode virar um segundo lugar onde
    # o mesmo dado sensível que está sendo apagado continua vivo para sempre.
    registrar_auditoria(
        db, usuario, "pessoas", "ANONIMIZADO", id_registro_afetado=pessoa.id_pessoa,
        dados_depois={"campos_apagados": CAMPOS_ANONIMIZAVEIS, "id_associado": associado.id_associado},
        ip_origem=ip_origem,
    )
    return True


def anonimizar_vencidos(db: Session, usuario=None, ip_origem: Optional[str] = None) -> int:
    """Varre todo associado Desligado e anonimiza quem já passou do prazo. Pensado para ser
    chamado periodicamente por um administrador (sem scheduler ainda - ver docstring do módulo)."""
    candidatos = db.query(Associado).filter(Associado.status_arrolamento == "Desligado").all()
    total = 0
    for associado in candidatos:
        if anonimizar_associado(db, associado, usuario=usuario, ip_origem=ip_origem):
            total += 1
    return total
