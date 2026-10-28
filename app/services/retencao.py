"""v5.7b (FASE 5) - a ROTINA DE RETENÇÃO (LGPD, arts. 15 e 16): dado pessoal não fica guardado para sempre "por cautela". A "Tabela de temporalidade v1" do PLANO_PROJETO.md (proposta de 2026-10-15,
a partir da ideia do Presidente: 5 anos, depois até 10, depois só o financeiro) vira prazos em configuração (Configurações > Regras do sistema) e esta rotina, que o agendamento roda junto das outras
tarefas periódicas (`scripts/aplicar_retencao_de_dados.py`), aplica o que JÁ venceu.

O que ela faz e o que NUNCA faz:
  - cada regra tem o prazo em dias numa configuração; um valor menor que o PISO (30 dias) é ignorado e vale o padrão: um número digitado errado nunca vira "apague tudo agora";
  - só mexe no que passou do prazo, contado da data certa de cada dado (encerramento do pedido, decisão da proposta, vencimento do pedido de doação, data da doação...);
  - o dado financeiro (valor, data, destino da doação, escrituração) NUNCA é tocado: só a PESSOA some do registro (anonimiza), como a tabela manda;
  - a Auditoria desta rotina guarda só as CONTAGENS por regra (nunca o que foi apagado), e só quando algo foi aplicado (a anonimização de cada associado desligado grava, como sempre gravou, uma entrada por
    pessoa, com o id e a lista dos campos, nunca os valores);
  - uma regra que falha não derruba as outras (cada uma tem a sua transação) e o roteiro do sistema fica VERMELHO se alguma falhou;
  - é idempotente: rodar de novo no mesmo dia não faz nada.
Além das regras da tabela, a rotina varre o RESÍDUO TÉCNICO da conta de visitante (v5.6b): código de acesso e sessão já vencem em minutos; o que sobra deles (e o contador de pedidos por e-mail) é
apagado depois de 1 dia, sem configuração, porque não é prazo de guarda de dado pessoal e sim limpeza. Vai no resultado como `limpeza_tecnica`, fora de `aplicadas` e da tabela.
v7.1d: as regras que faltavam (inscrições e presenças, quem só se inscreveu em evento, voluntário, certificado e Auditoria) estão em `app/services/retencao_participacao.py`:
anonimizam a PESSOA e mantêm as contagens. A Política de Privacidade só promete o prazo das regras que existem aqui."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Callable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.models.atendimento import ENCERRADO, RESPONDIDO, Atendimento
from app.models.doacoes import Doacao
from app.models.financeiro import TituloFinanceiro
from app.models.filiacao import APROVADA, PropostaDeSocio, PropostaFiliacao
from app.models.intencoes_de_doacao import CONFIRMADA, IntencaoDeDoacao
from app.models.notificacoes_painel import NotificacaoPainel
from app.models.protecao_publica import TentativaAcessoPublico
from app.services import retencao_participacao
from app.services.anonimizacao import anonimizar_vencidos_com_falhas

LOG = logging.getLogger("asaf.retencao")

PISO_EM_DIAS = 30
TETO_EM_DIAS = 36500  # 100 anos: acima disso a conta de data estoura (e um número assim é erro de digitação)
MARCADOR_DE_TEXTO = "(texto apagado pelo prazo de guarda)"
NOME_APAGADO = "Pessoa removida (prazo de guarda)"
DOADOR_ANONIMIZADO = "Doador anonimizado (prazo de guarda)"


@dataclass(frozen=True)
class Regra:
    codigo: str
    rotulo: str
    chave_de_config: str
    padrao_em_dias: int
    # devolve quantos afetou, ou (quantos afetou, quantas falhas) quando uma falha de uma pessoa não pode impedir as outras (a regra inteira conta como falha e o roteiro fica vermelho)
    aplicar: Callable[[Session, datetime, int], int | tuple[int, int]]
    # v7.1d: o piso da regra (a Auditoria não desce de 5 anos: o "quem fez" ainda serve a regras como "quem escreveu a apresentação do relatório anual não a aprova")
    piso_em_dias: int = 30


def dias_da_regra(db: Session, regra: Regra) -> int:
    """O prazo da regra: a configuração, ou o padrão se ela estiver ausente, ilegível ou abaixo do piso."""
    valor = obter_configuracao(db, regra.chave_de_config, str(regra.padrao_em_dias))
    try:
        dias = int(float(str(valor).strip()))
    except (TypeError, ValueError, OverflowError):
        return regra.padrao_em_dias
    return min(dias, TETO_EM_DIAS) if dias >= max(PISO_EM_DIAS, regra.piso_em_dias) else regra.padrao_em_dias


# ------------------------------------------------------------------------------------------------ as regras (uma por linha da tabela)
def _registro_tecnico_de_acesso(db: Session, agora: datetime, dias: int) -> int:
    """IP das tentativas ao formulário público (o limite por hora): 6 meses e apaga."""
    n = db.query(TentativaAcessoPublico).filter(TentativaAcessoPublico.criado_em < agora - timedelta(days=dias)).delete(synchronize_session=False)
    db.commit()
    return n


def _avisos_do_sino(db: Session, agora: datetime, dias: int) -> int:
    """Os avisos do sino trazem o nome de quem pediu (atendimento, doação): 1 ano e apaga."""
    n = db.query(NotificacaoPainel).filter(NotificacaoPainel.criado_em < agora - timedelta(days=dias)).delete(synchronize_session=False)
    db.commit()
    return n


def _pedidos_de_atendimento(db: Session, agora: datetime, dias: int) -> int:
    """Pedido da fila (contato, informação, titular): 5 anos depois de respondido/encerrado, apaga mensagem, resposta e contato; ficam protocolo, tipo, datas e situação."""
    fim = func.coalesce(Atendimento.encerrado_em, Atendimento.respondido_em)
    candidatos = (
        db.query(Atendimento)
        .filter(Atendimento.status.in_([RESPONDIDO, ENCERRADO]), fim < agora - timedelta(days=dias), Atendimento.mensagem != MARCADOR_DE_TEXTO)
        .all()
    )
    for a in candidatos:
        a.nome_completo = NOME_APAGADO
        a.email_contato = a.telefone_whatsapp = a.cpf = a.data_nascimento = a.id_pessoa = a.chave_remetente = a.impressao_do_pedido = None
        a.assunto = a.motivo_encerramento = a.identidade_nota = None
        a.mensagem = MARCADOR_DE_TEXTO
        if a.resposta is not None:
            a.resposta = MARCADOR_DE_TEXTO
    db.commit()
    return len(candidatos)


def _propostas_de_filiacao_nao_aprovadas(db: Session, agora: datetime, dias: int) -> int:
    """Proposta de filiação que não virou associado (recusada, ou parada sem decisão): 2 anos depois da última mudança (no pedido OU no voto de um sócio: a proposta que ainda recebe voto não está parada),
    apaga a proposta e os votos dos sócios sobre ela."""
    limite = agora - timedelta(days=dias)
    com_voto_recente = select(PropostaDeSocio.id_proposta).where(PropostaDeSocio.atualizado_em >= limite)
    candidatas = (
        db.query(PropostaFiliacao.id_proposta)
        .filter(
            PropostaFiliacao.status != APROVADA, PropostaFiliacao.id_associado_efetivado.is_(None), PropostaFiliacao.atualizado_em < limite,
            PropostaFiliacao.id_proposta.not_in(com_voto_recente),
        )
        .all()
    )
    ids = [i for (i,) in candidatas]
    if not ids:
        return 0
    db.query(PropostaDeSocio).filter(PropostaDeSocio.id_proposta.in_(ids)).delete(synchronize_session=False)
    db.query(PropostaFiliacao).filter(PropostaFiliacao.id_proposta.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return len(ids)


def _intencoes_de_doacao_sem_confirmacao(db: Session, agora: datetime, dias: int) -> int:
    """Pedido de doação pelo site que ninguém confirmou (nome, e-mail, CPF): 2 anos depois do prazo do pedido, apaga. O que foi confirmado segue a regra do doador identificado."""
    n = (
        db.query(IntencaoDeDoacao)
        .filter(IntencaoDeDoacao.status != CONFIRMADA, IntencaoDeDoacao.id_doacao.is_(None), IntencaoDeDoacao.expira_em < agora - timedelta(days=dias))
        .delete(synchronize_session=False)
    )
    db.commit()
    return n


def _doador_identificado(db: Session, agora: datetime, dias: int) -> int:
    """Doador identificado: 10 anos depois da doação, anonimiza o doador (nome, documento e a ligação com o cadastro de associado, e a cópia no pedido do site); ficam valor, data e destino."""
    candidatas = db.query(Doacao).filter(Doacao.anonima.is_(False), Doacao.data_doacao < agora - timedelta(days=dias)).all()
    for d in candidatas:
        d.anonima = True
        d.nome_doador = d.documento_doador = d.id_associado = None
        if d.id_titulo is not None:  # o título financeiro também guarda a ligação com o cadastro (o valor, a data e a conta ficam)
            db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == d.id_titulo).update({"id_associado": None}, synchronize_session=False)
        for pedido in db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.id_doacao == d.id_doacao).all():
            pedido.nome_doador = DOADOR_ANONIMIZADO
            pedido.email_doador = f"anonimizado-{pedido.id_intencao}@exemplo.invalid"
            pedido.documento_doador = pedido.impressao_do_pedido = pedido.observacao = None
    db.commit()
    return len(candidatas)


def _associado_desligado(db: Session, agora: datetime, dias: int) -> tuple[int, int]:
    """Associado desligado: CPF, contato, demais dados sensíveis, o arquivo da foto e o endereço saem depois do prazo (a lógica é a da v1.4, com o piso desta rotina); nome e matrícula (o livro de associados) ficam. Quem ainda
    tem outro papel ativo (voluntário, beneficiário...) não é tocado: o dado dessa pessoa ainda serve a esse papel."""
    return anonimizar_vencidos_com_falhas(db, dias=dias, agora=agora, respeitar_outros_papeis=True)


def _consentimentos_encerrados(db: Session, agora: datetime, dias: int) -> int:
    """v7.1b - a prova de um consentimento que acabou (revogado, foto apagada, fim do mandato): 5 anos depois de encerrado, apaga. O vigente nunca é tocado."""
    from app.models.privacidade import Consentimento

    n = db.query(Consentimento).filter(Consentimento.encerrado_em.isnot(None), Consentimento.encerrado_em < agora - timedelta(days=dias)).delete(
        synchronize_session=False)
    db.commit()
    return n


def _leitura_de_avisos(db: Session, agora: datetime, dias: int) -> int:
    """v6.1 - a prova de leitura de um aviso do mural (quem recebeu, leu e confirmou): o prazo da lei (5 anos) depois de o aviso sair do mural; o aviso e os totais ficam."""
    from app.services.comunicacao import apagar_leituras_vencidas

    return apagar_leituras_vencidas(db, agora, dias)


REGRAS: tuple[Regra, ...] = (
    Regra("acessos", "Registro técnico de acesso (IP das tentativas)", "PRAZO_RETENCAO_ACESSOS_DIAS", 183, _registro_tecnico_de_acesso),
    Regra("avisos_do_sino", "Avisos do sino do painel", "PRAZO_RETENCAO_AVISOS_DO_SINO_DIAS", 365, _avisos_do_sino),
    Regra("atendimentos", "Pedidos da fila de atendimento", "PRAZO_RETENCAO_ATENDIMENTOS_DIAS", 1825, _pedidos_de_atendimento),
    Regra("propostas_de_filiacao", "Proposta de filiação não aprovada", "PRAZO_RETENCAO_PROPOSTAS_DIAS", 730, _propostas_de_filiacao_nao_aprovadas),
    Regra("intencoes_de_doacao", "Pedido de doação pelo site sem confirmação", "PRAZO_RETENCAO_PEDIDOS_DE_DOACAO_DIAS", 730, _intencoes_de_doacao_sem_confirmacao),
    Regra("doador_identificado", "Doador identificado e recibo", "PRAZO_RETENCAO_DOADOR_DIAS", 3650, _doador_identificado),
    Regra("associado_desligado", "Associado desligado", "PRAZO_RETENCAO_DESLIGADO_DIAS", 1825, _associado_desligado),
    Regra("leitura_de_avisos", "Quem recebeu, leu e confirmou um aviso do mural", "PRAZO_RETENCAO_LEITURA_DE_AVISOS_DIAS", 1825, _leitura_de_avisos),
    Regra("consentimentos_encerrados", "Prova de consentimento encerrado (revogado ou acabado)", "PRAZO_RETENCAO_CONSENTIMENTOS_DIAS", 1825, _consentimentos_encerrados),
    # v7.1d - anonimizam a pessoa e mantêm as contagens (a ordem importa: o voluntário e o participante encerram o papel antes de o associado desligado ser conferido de novo
    # na próxima rodada; cada regra só anonimiza quem não tem outro vínculo)
    Regra("inscricoes_e_presencas", "Inscrições e presenças em evento", "PRAZO_RETENCAO_INSCRICOES_DIAS", 1825, retencao_participacao.inscricoes_e_presencas),
    Regra("voluntarios_encerrados", "Voluntário (termo de adesão, horas e trocas de turno)", "PRAZO_RETENCAO_VOLUNTARIO_DIAS", 1825,
          retencao_participacao.voluntarios_encerrados),
    Regra("participantes_externos", "Quem só se inscreveu em evento (participante externo)", "PRAZO_RETENCAO_PARTICIPANTE_DIAS", 1825,
          retencao_participacao.participantes_externos),
    Regra("certificados", "Certificado e crachá de evento", "PRAZO_RETENCAO_CERTIFICADOS_DIAS", 3650, retencao_participacao.certificados),
    Regra("auditoria", "Auditoria do sistema (quem fez, IP e valores)", "PRAZO_RETENCAO_AUDITORIA_DIAS", 3650, retencao_participacao.auditoria, piso_em_dias=1825),
)


def aplicar_todas(db: Session, agora: Optional[datetime] = None) -> dict:
    """Aplica cada regra com o prazo da configuração. Devolve `{"aplicadas": {codigo: quantos}, "falhas": [codigo...]}`. Uma regra que falha volta a transação dela e as outras seguem. Se alguma coisa foi
    aplicada, a Auditoria guarda SÓ as contagens (nunca o que foi apagado)."""
    agora = agora or datetime.utcnow()
    aplicadas: dict[str, int] = {}
    falhas: list[str] = []
    for regra in REGRAS:
        try:
            resultado = regra.aplicar(db, agora, dias_da_regra(db, regra))
            afetados, parciais = resultado if isinstance(resultado, tuple) else (resultado, 0)
            aplicadas[regra.codigo] = afetados
            if parciais:
                LOG.error("a regra de retenção %s deixou %s item(ns) para a próxima rodada", regra.codigo, parciais)
                falhas.append(regra.codigo)
        except Exception:  # noqa: BLE001 - cada regra é independente; quem roda precisa SABER que uma falhou (o roteiro sai com código 1)
            db.rollback()
            LOG.exception("a regra de retenção %s falhou", regra.codigo)
            falhas.append(regra.codigo)
    if any(aplicadas.values()):
        registrar_auditoria(db, None, "retencao", "RETENCAO_APLICADA", dados_depois={"aplicadas": {k: v for k, v in aplicadas.items() if v}})
    limpeza_tecnica: dict[str, int] = {}
    try:
        from app.services import conta_de_visitante

        limpeza_tecnica["conta_de_visitante"] = conta_de_visitante.limpar_vencidos(db, agora)
    except Exception:  # noqa: BLE001 - mesma regra: quem roda precisa saber que a limpeza falhou
        db.rollback()
        LOG.exception("a limpeza técnica da conta de visitante falhou")
        falhas.append("conta_de_visitante")
    try:
        from app.services import esqueci_a_senha

        limpeza_tecnica["esqueci_a_senha"] = esqueci_a_senha.limpar_vencidos(db, agora)
    except Exception:  # noqa: BLE001 - mesma regra
        db.rollback()
        LOG.exception("a limpeza técnica dos códigos de troca de senha falhou")
        falhas.append("esqueci_a_senha")
    return {"aplicadas": aplicadas, "falhas": falhas, "limpeza_tecnica": limpeza_tecnica}
