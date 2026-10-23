"""v1.4 (FASE 1) - anonimização de dado pessoal de associado desligado, construída AGORA (não
adiada pra FASE 7) por decisão explícita do usuário: dado sensível (CPF, e-mail, telefone,
nascimento, estado civil, profissão, naturalidade, foto) de quem saiu não pode ficar retido
indefinidamente sem justificativa - só o que sustenta o financeiro (nome, matrícula) e o dado
financeiro em si (nunca apagado, nunca tocado aqui) permanecem. Quando a FASE 7 existir, o
programa de privacidade completo (inventário, base legal, outros tipos de dado) se apoia no que
já está pronto aqui, em vez de reconstruir do zero.

**v5.7b**: a anonimização passou a rodar SOZINHA, pela rotina de retenção (`app/services/retencao.py`,
agendada), além do `POST /api/associados/anonimizar-vencidos` manual. Para isso ficou segura de repetir
(quem já foi anonimizado não é anonimizado de novo, nem grava a Auditoria de novo), respeita o piso do
prazo que a rotina passa (`dias`), apaga também o ARQUIVO da foto e o endereço (a Tabela de temporalidade
manda apagar contato e endereço) e, na rotina, não toca em quem ainda tem outro papel ativo (voluntário,
beneficiário...): o dado dessa pessoa ainda serve a esse outro papel."""
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.config_cache import obter_configuracao
from app.models.associados import Associado, Endereco
from app.models.pessoas import Papel
from app.models.situacao import MudancaSituacao
from app.services import armazenamento
from app.services.linha_do_tempo import publicar_evento_linha_do_tempo

LOG = logging.getLogger("asaf.anonimizacao")
# o prazo da configuração tem piso e teto, também nos botões manuais do painel: um "0" gravado por engano não pode anonimizar quem acabou de sair
PRAZO_PADRAO_EM_DIAS = 1825
PISO_EM_DIAS = 30
TETO_EM_DIAS = 36500

CAMPOS_ANONIMIZAVEIS = [
    "cpf", "email_contato", "telefone_whatsapp", "data_nascimento",
    "estado_civil", "profissao", "naturalidade", "foto",
    # v7.0b - achado da classificação (app/classificacao_de_dados.py): as habilidades cadastradas ("Primeiros socorros", "Motorista/CNH") ficavam
    "habilidades",
]
# O que é PESSOAL na pessoa e fica de propósito depois da anonimização (o teste compara com a classificação: coluna pessoal nova tem de entrar numa das listas)
MANTIDOS_NA_ANONIMIZACAO = {
    "nome_completo": "sustenta o livro de associados e o dado financeiro (com o número de matrícula)",
    "data_ultima_confirmacao": "data técnica de quando a pessoa confirmou o cadastro; sem o contato, não identifica ninguém",
    "contato_suspeito": "marca técnica sobre o contato, que é apagado",
}


def data_elegivel_para_anonimizacao(db: Session, associado: Associado, dias: Optional[int] = None) -> Optional[datetime]:
    """Retorna a data em que o associado FICA (ou ficou) elegível, ou None se não se aplica. `dias` (a rotina de retenção, já com o piso aplicado) vale no lugar da configuração."""
    if associado.status_arrolamento != "Desligado" or not associado.data_desligamento:
        return None
    return associado.data_desligamento + timedelta(days=dias if dias is not None else _prazo_da_configuracao(db))


def _prazo_da_configuracao(db: Session) -> int:
    valor = obter_configuracao(db, "PRAZO_RETENCAO_DESLIGADO_DIAS", str(PRAZO_PADRAO_EM_DIAS))
    try:
        dias = int(float(str(valor).strip()))
    except (TypeError, ValueError, OverflowError):
        return PRAZO_PADRAO_EM_DIAS
    return min(dias, TETO_EM_DIAS) if dias >= PISO_EM_DIAS else PRAZO_PADRAO_EM_DIAS


def _tem_outro_papel_ativo(db: Session, id_pessoa: int) -> bool:
    return db.query(Papel.id_papel).filter(Papel.id_pessoa == id_pessoa, Papel.tipo_papel != "associado", Papel.ativo.is_(True)).first() is not None


def anonimizar_associado(
    db: Session, associado: Associado, usuario=None, ip_origem: Optional[str] = None, *,
    dias: Optional[int] = None, agora: Optional[datetime] = None, respeitar_outros_papeis: bool = False,
) -> bool:
    """Zera os campos pessoais sensíveis em `Pessoa` (e apaga o arquivo da foto e o endereço) - nome_completo e numero_matricula (em
    Associado) NUNCA são tocados aqui, nem nenhum dado financeiro (que fica noutra tabela, ligada só por id_associado). Retorna False
    sem fazer nada se ainda não chegou o prazo, se já está tudo anonimizado ou (com `respeitar_outros_papeis`) se a pessoa ainda tem
    outro papel ativo."""
    data_elegivel = data_elegivel_para_anonimizacao(db, associado, dias)
    if data_elegivel is None or (agora or datetime.utcnow()) < data_elegivel:
        return False

    pessoa = associado.pessoa
    if pessoa is None:
        return False
    if respeitar_outros_papeis and _tem_outro_papel_ativo(db, pessoa.id_pessoa):
        return False
    enderecos = db.query(Endereco).filter(Endereco.id_associado == associado.id_associado)
    # v7.0b: o motivo e o documento de referência das mudanças de situação (licença por saúde, atestado, desligamento) são apagados também; fica o tipo e a
    # data (o livro de associados)
    motivos = db.query(MudancaSituacao).filter(
        MudancaSituacao.id_associado == associado.id_associado, or_(MudancaSituacao.motivo.isnot(None), MudancaSituacao.documento_referencia.isnot(None)),
    )
    if all(getattr(pessoa, campo) is None for campo in CAMPOS_ANONIMIZAVEIS) and enderecos.first() is None and motivos.first() is None:
        # já anonimizado (a rotina agendada passa por aqui toda vez; sem isto ela "anonimizaria" a mesma pessoa de novo e gravaria na Auditoria de novo, para sempre)
        return False

    # o ARQUIVO da foto primeiro, e sem "melhor esforço": só a referência não basta (o arquivo abre sem login para quem tiver o endereço). Se o armazenamento falhar, nada foi mexido e
    # a pessoa fica para a próxima rodada (a rotina conta a falha e fica vermelha; arquivo que já não existe não é falha)
    alvo_da_foto = armazenamento.separar_url(pessoa.foto)
    if alvo_da_foto is not None:
        try:
            armazenamento.obter().remover(*alvo_da_foto)
        except Exception:  # noqa: BLE001
            LOG.exception("não foi possível apagar o arquivo da foto do associado %s", associado.id_associado)
            raise HTTPException(status_code=502, detail="Não consegui apagar o arquivo da foto agora: nada foi alterado, tente de novo em instantes.")
    for campo in CAMPOS_ANONIMIZAVEIS:
        setattr(pessoa, campo, None)
    enderecos.delete(synchronize_session=False)
    motivos.update({MudancaSituacao.motivo: None, MudancaSituacao.documento_referencia: None}, synchronize_session=False)
    # v6.2b: a escolha de e-mails (descadastro) é dado da pessoa e, sem o e-mail, não serve para mais nada
    from app.models.preferencias_de_comunicacao import PreferenciaDeComunicacao

    db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == pessoa.id_pessoa).delete(synchronize_session=False)
    db.commit()

    # Nunca gravar os VALORES apagados no log - o AuditLog não pode virar um segundo lugar onde
    # o mesmo dado sensível que está sendo apagado continua vivo para sempre.
    registrar_auditoria(
        db, usuario, "pessoas", "ANONIMIZADO", id_registro_afetado=pessoa.id_pessoa,
        dados_depois={"campos_apagados": CAMPOS_ANONIMIZAVEIS + ["endereco", "motivo_e_documento_das_mudancas_de_situacao"], "id_associado": associado.id_associado},
        ip_origem=ip_origem,
    )
    # Nunca listar OS VALORES apagados aqui também - mesmo cuidado do AuditLog acima.
    publicar_evento_linha_do_tempo(
        db, pessoa.id_pessoa, "situacao", "ANONIMIZADO", "Dado pessoal anonimizado (prazo de retenção vencido)",
    )
    return True


def anonimizar_vencidos_com_falhas(
    db: Session, usuario=None, ip_origem: Optional[str] = None, *,
    dias: Optional[int] = None, agora: Optional[datetime] = None, respeitar_outros_papeis: bool = False,
) -> tuple[int, int]:
    """Varre todo associado Desligado e anonimiza quem já passou do prazo. Devolve (anonimizados, falhas): a falha de uma pessoa (o armazenamento não apagou a foto) não impede as outras, e quem chama
    SABE que houve falha (a rotina de retenção fica vermelha)."""
    candidatos = db.query(Associado).filter(Associado.status_arrolamento == "Desligado").all()
    total = falhas = 0
    for associado in candidatos:
        try:
            if anonimizar_associado(
                db, associado, usuario=usuario, ip_origem=ip_origem, dias=dias, agora=agora, respeitar_outros_papeis=respeitar_outros_papeis,
            ):
                total += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            falhas += 1
    return total, falhas


def anonimizar_vencidos(
    db: Session, usuario=None, ip_origem: Optional[str] = None, *,
    dias: Optional[int] = None, agora: Optional[datetime] = None, respeitar_outros_papeis: bool = False,
) -> int:
    """O mesmo para o `POST /api/associados/anonimizar-vencidos` (só a contagem). Se alguma pessoa falhou, o botão avisa em vez de dizer que deu certo."""
    total, falhas = anonimizar_vencidos_com_falhas(
        db, usuario=usuario, ip_origem=ip_origem, dias=dias, agora=agora, respeitar_outros_papeis=respeitar_outros_papeis,
    )
    if falhas:
        raise HTTPException(status_code=502, detail=f"{total} associado(s) anonimizado(s), mas {falhas} não puderam ser concluídos (o armazenamento não apagou a foto): tente de novo em instantes.")
    return total
