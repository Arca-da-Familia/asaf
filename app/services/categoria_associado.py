"""v1.1/v1.2 - categoria (`status_arrolamento`) deixa de ser editável à mão pelo admin (removida
de `AssociadoAdminUpdate`): é calculada a partir de dado real e materializada em
`Associado.status_arrolamento` a cada evento relevante (novo título, pagamento) -
`calcular_categoria` é a fonte da verdade (pode ser chamada isolada, sem gravar nada);
`recalcular_categoria_associado` materializa o resultado só quando muda, sempre auditado.

Só sabe transicionar entre os estados sustentados por dado real hoje (`Licenciado`, enquanto
`Associado.data_fim_licenca` não passou - v1.4; `Em Experiência`, enquanto
`Associado.data_fim_experiencia` não passou - v1.2; `Ativo - Em Dia` / `Ativo - Inadimplente`,
derivados de `TituloFinanceiro` + `DIAS_TOLERANCIA_INADIMPLENCIA` - v1.1). NUNCA sobrescreve
`Suspenso (Estatuto)` ou `Desligado` - o primeiro não tem fluxo de saída automático definido
ainda; o segundo é definitivo até uma READMISSÃO explícita (nunca "expira" sozinho - ver
`app/routers/situacao.py`). Isso é intencional, não uma lacuna esquecida: categoria calculada
sem o dado que a sustenta seria só fingir precisão que não existe.

v6.2d: a transição de "Em Experiência" ao fim do prazo também é recalculada pela rotina periódica
(a cada 15 minutos, `scripts/avisar_fim_de_experiencia.py`), não só no próximo evento financeiro.
Venha de onde vier (a rotina ou um lançamento/baixa de título), a saída de "Em Experiência" com o
prazo vencido avisa no sino quem cuida de Associados NO MESMO commit da situação nova: o aviso
nunca se perde entre um e outro. `calcular_categoria` (a fonte da verdade) sempre reflete o estado
correto na hora que é chamada; entre duas rodadas só o campo MATERIALIZADO pode ficar
desatualizado - por isso o endpoint `/categoria-calculada` existe."""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.financeiro import TituloFinanceiro

LICENCIADO = "Licenciado"
EM_EXPERIENCIA = "Em Experiência"
ATIVO_EM_DIA = "Ativo - Em Dia"
ATIVO_INADIMPLENTE = "Ativo - Inadimplente"
_ESTADOS_CALCULAVEIS = {LICENCIADO, EM_EXPERIENCIA, ATIVO_EM_DIA, ATIVO_INADIMPLENTE, None, ""}


def calcular_categoria(db: Session, id_associado: int) -> str:
    """Fonte da verdade - recalcula do zero a partir do financeiro, licença e período de
    experiência, sem tocar no banco."""
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if associado and associado.data_fim_licenca and datetime.utcnow() < associado.data_fim_licenca:
        return LICENCIADO
    if associado and associado.data_fim_experiencia and datetime.utcnow() < associado.data_fim_experiencia:
        return EM_EXPERIENCIA

    tolerancia_dias = int(obter_configuracao(db, "DIAS_TOLERANCIA_INADIMPLENCIA", "30") or "30")
    limite = datetime.utcnow() - timedelta(days=tolerancia_dias)
    existe_titulo_vencido = (
        db.query(TituloFinanceiro)
        .filter(
            TituloFinanceiro.id_associado == id_associado,
            # v3.2.2 - "Renegociado" (ver NegociacaoDivida) é um título superado por parcelas
            # novas, nunca mais cobrável por si - contar ele aqui de novo penalizaria duas vezes
            # quem já regularizou via negociação (as parcelas novas, se vencerem, é que contam).
            TituloFinanceiro.status.notin_(["Pago", "Renegociado", "Cancelado"]),
            TituloFinanceiro.data_vencimento < limite,
        )
        .first()
        is not None
    )
    return ATIVO_INADIMPLENTE if existe_titulo_vencido else ATIVO_EM_DIA


def calcular_categorias(db: Session, associados: list[Associado]) -> dict[int, str]:
    """v6.1 - a MESMA regra de `calcular_categoria`, para muitos associados de uma vez (o grupo de um aviso do mural): uma consulta só para os títulos vencidos, em vez
    de duas por pessoa. Quem mudar a regra acima muda esta junto (o teste de comunicação confere as duas com licença, experiência e título vencido)."""
    agora = datetime.utcnow()
    tolerancia_dias = int(obter_configuracao(db, "DIAS_TOLERANCIA_INADIMPLENCIA", "30") or "30")
    limite = agora - timedelta(days=tolerancia_dias)
    ids = [a.id_associado for a in associados]
    devedores: set[int] = set()
    for inicio in range(0, len(ids), 500):  # o IN do banco tem limite de parâmetros
        devedores |= {
            i for (i,) in db.query(TituloFinanceiro.id_associado).filter(
                TituloFinanceiro.id_associado.in_(ids[inicio:inicio + 500]),
                TituloFinanceiro.status.notin_(["Pago", "Renegociado", "Cancelado"]),
                TituloFinanceiro.data_vencimento < limite,
            ).distinct().all()
        }
    resultado: dict[int, str] = {}
    for a in associados:
        if a.data_fim_licenca and agora < a.data_fim_licenca:
            resultado[a.id_associado] = LICENCIADO
        elif a.data_fim_experiencia and agora < a.data_fim_experiencia:
            resultado[a.id_associado] = EM_EXPERIENCIA
        else:
            resultado[a.id_associado] = ATIVO_INADIMPLENTE if a.id_associado in devedores else ATIVO_EM_DIA
    return resultado


def recalcular_categoria_associado(
    db: Session, id_associado: int, usuario=None, ip_origem: Optional[str] = None
) -> Optional[str]:
    """Materializa o cálculo em `status_arrolamento`, só se o estado atual for um dos que esta
    função sabe calcular - nunca mexe em Suspenso/Desligado. Grava AuditLog só quando o valor
    realmente muda (evita ruído de log a cada evento financeiro sem mudança de categoria)."""
    associado = db.query(Associado).filter(Associado.id_associado == id_associado).first()
    if associado is None:
        return None
    if associado.status_arrolamento not in _ESTADOS_CALCULAVEIS:
        return associado.status_arrolamento

    novo = calcular_categoria(db, id_associado)
    if novo != associado.status_arrolamento:
        antes = associado.status_arrolamento
        associado.status_arrolamento = novo
        if antes == EM_EXPERIENCIA and associado.data_fim_experiencia and associado.data_fim_experiencia <= datetime.utcnow():
            from app.services.automaticos_de_associado import avisar_no_sino_o_fim_da_experiencia  # import local: aquele módulo importa este

            avisar_no_sino_o_fim_da_experiencia(db, associado, novo)
        db.commit()
        registrar_auditoria(
            db, usuario, "associados", "CATEGORIA_RECALCULADA", id_registro_afetado=id_associado,
            dados_antes={"status_arrolamento": antes}, dados_depois={"status_arrolamento": novo},
            ip_origem=ip_origem,
        )
    return novo
