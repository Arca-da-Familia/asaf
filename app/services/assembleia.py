"""v2.2 (FASE 2) - convocação e habilitação de assembleia. Nada aqui é hardcoded: prazo mínimo,
intervalo entre convocações e fração de petição vêm de `RegraEstatutaria`/`ConfiguracaoInstitucional`
(v2.0), nunca constante no código - reforma de estatuto muda o número, não o deploy."""
import re
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.governanca import Assembleia, AdesaoPeticao, HabilitadoAssembleia, PeticaoConvocacao
from app.services.categoria_associado import ATIVO_EM_DIA, EM_EXPERIENCIA, calcular_categoria
from app.services.estatuto import obter_regra_vigente

DESLIGADO = "Desligado"


def _parse_fracao(valor: str) -> float:
    """Só entende "a/b" (ex.: "1/5", "2/3") - suficiente para os parâmetros que este módulo
    realmente consome (FRACAO_MINIMA_PETICAO_CONVOCACAO). Valores compostos como "1/2+1" (usados
    em quórum de instalação, v2.3/v2.4) não passam por aqui."""
    m = re.match(r"^\s*(\d+)\s*/\s*(\d+)\s*$", valor)
    if not m:
        raise ValueError(f"Fração estatutária '{valor}' não reconhecida.")
    return int(m.group(1)) / int(m.group(2))


def validar_prazo_convocacao(db: Session, data_hora_convocacao: datetime) -> Optional[str]:
    """Devolve mensagem de erro se a convocação não respeita o prazo mínimo de antecedência
    (Art. 8º, `PRAZO_CONVOCACAO_DIAS`, v0.3.4/v2.0), ou None se está dentro da regra."""
    prazo_dias = int(obter_configuracao(db, "PRAZO_CONVOCACAO_DIAS", "15") or "15")
    minimo = datetime.utcnow() + timedelta(days=prazo_dias)
    if data_hora_convocacao < minimo:
        return (
            f"Convocação viola o prazo mínimo de antecedência (Art. 8º): são exigidos "
            f"{prazo_dias} dias, e a data informada é antes de {minimo:%d/%m/%Y %H:%M}."
        )
    return None


def horarios_convocacao(db: Session, assembleia: Assembleia) -> dict:
    """1ª/2ª/3ª chamada (Art. 6º) - sempre calculado na leitura a partir de
    `data_hora_convocacao` + `INTERVALO_ENTRE_CONVOCACOES_MINUTOS`, nunca gravado."""
    intervalo = int(obter_regra_vigente(db, "INTERVALO_ENTRE_CONVOCACOES_MINUTOS", "30") or "30")
    primeira = assembleia.data_hora_convocacao
    return {
        "primeira_convocacao": primeira,
        "segunda_convocacao": primeira + timedelta(minutes=intervalo),
        "terceira_convocacao": primeira + timedelta(minutes=intervalo * 2),
    }


def calcular_lista_habilitados(db: Session, assembleia: Assembleia) -> list[HabilitadoAssembleia]:
    """Congela, no momento da convocação, quem está habilitado a votar - critério é só o que o
    estatuto real tem: em dia com as obrigações (Art. 13, caput) e em pleno gozo dos direitos
    associativos (Art. 4º). "Categoria com direito a voto" e "tempo mínimo de filiação" não
    entram - sem base no texto (ver PLANO_PROJETO.md v2.2). "Licenciado" NUNCA é habilitado
    (decisão da ASAF: pedir licença é abrir mão dos direitos associativos enquanto durar,
    independente de estar em dia com a mensalidade) - `calcular_categoria` já reflete isso
    (Licenciado tem prioridade sobre o cálculo financeiro). Nunca recalculada depois do fato:
    se já existir lista congelada para esta assembleia, ela é preservada e devolvida como está."""
    existentes = db.query(HabilitadoAssembleia).filter(HabilitadoAssembleia.id_assembleia == assembleia.id_assembleia).all()
    if existentes:
        return existentes

    associados = db.query(Associado).filter(Associado.status_arrolamento != DESLIGADO).all()
    linhas = []
    for associado in associados:
        categoria_real = calcular_categoria(db, associado.id_associado)
        habilitado = categoria_real in (ATIVO_EM_DIA, EM_EXPERIENCIA)
        motivo = None if habilitado else f"Situação '{categoria_real}' não está em dia/pleno gozo dos direitos (Art. 13/4º)."
        linha = HabilitadoAssembleia(
            id_assembleia=assembleia.id_assembleia, id_associado=associado.id_associado,
            habilitado=habilitado, motivo_inabilitacao=motivo, status_arrolamento_no_momento=categoria_real,
        )
        db.add(linha)
        linhas.append(linha)
    db.commit()
    return linhas


def gerar_edital(db: Session, assembleia: Assembleia, qtd_habilitados: int) -> str:
    """Monta o texto do edital a partir dos campos exigidos pelo Art. 9º - nunca editor de texto
    livre, o corpo é montado do registro."""
    nome_instituicao = obter_configuracao(db, "NOME_INSTITUICAO", "ASAF - Associação Arca da Família")
    endereco = obter_configuracao(db, "ENDERECO", "") or ""
    local = assembleia.local_fisico or endereco or "(local a definir)"
    if assembleia.link_remoto:
        local = f"{local} | Acesso remoto: {assembleia.link_remoto}"
    horarios = horarios_convocacao(db, assembleia)
    return (
        f"{nome_instituicao}\n"
        f"EDITAL DE CONVOCAÇÃO PARA ASSEMBLEIA GERAL {assembleia.tipo.upper()}\n\n"
        f"1ª convocação: {horarios['primeira_convocacao']:%d/%m/%Y às %H:%M} (quórum: 2/3 dos associados aptos)\n"
        f"2ª convocação: {horarios['segunda_convocacao']:%d/%m/%Y às %H:%M} (quórum: 1/2 + 1 dos associados aptos)\n"
        f"3ª convocação: {horarios['terceira_convocacao']:%d/%m/%Y às %H:%M} (quórum: 1/4 dos associados aptos)\n\n"
        f"Local: {local}\n"
        f"Associados aptos para efeito de quórum: {qtd_habilitados}\n\n"
        f"Ordem do dia:\n{assembleia.pauta}\n"
    )


def fracao_adesao_peticao(db: Session, peticao: PeticaoConvocacao) -> tuple[int, int, float]:
    """(adesões, base de associados ativos, fração atual) - "associados ativos" (Art. 8º) é
    entendido aqui como todo associado que ainda integra o quadro social (não Desligado); a
    exigência de estar "em dia" (Art. 13) é sobre o DIREITO DE VOTAR NA ASSEMBLEIA, não sobre o
    direito de subscrever uma petição de convocação, que o estatuto não restringe da mesma forma."""
    total_ativos = db.query(Associado).filter(Associado.status_arrolamento != DESLIGADO).count()
    adesoes = db.query(AdesaoPeticao).filter(AdesaoPeticao.id_peticao == peticao.id_peticao).count()
    fracao = (adesoes / total_ativos) if total_ativos else 0.0
    return adesoes, total_ativos, fracao


def peticao_atingiu_quorum(db: Session, peticao: PeticaoConvocacao) -> bool:
    minimo = _parse_fracao(obter_regra_vigente(db, "FRACAO_MINIMA_PETICAO_CONVOCACAO", "1/5") or "1/5")
    _, _, fracao = fracao_adesao_peticao(db, peticao)
    return fracao >= minimo


def pode_converter_sem_presidente(db: Session, peticao: PeticaoConvocacao) -> bool:
    """Art. 10, Parágrafo Único: passado `PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS` (v2.0, hoje
    30) desde que o quórum de petição foi atingido sem o Presidente convocar, os próprios
    associados podem fazê-la."""
    if peticao.data_quorum_atingido is None:
        return False
    prazo_dias = int(obter_regra_vigente(db, "PRAZO_ATENDIMENTO_PEDIDO_CONVOCACAO_DIAS", "30") or "30")
    return datetime.utcnow() >= peticao.data_quorum_atingido + timedelta(days=prazo_dias)
