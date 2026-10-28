"""v7.1d (FASE 7) - os prazos de guarda que faltavam na rotina (`app/services/retencao.py`), da "Tabela de temporalidade v1" (HISTORICO.md, v5.6): inscrições e presenças,
quem só se inscreveu em evento, voluntário, certificado e Auditoria. A regra é a mesma da rotina: só mexe no que JÁ venceu, é idempotente e o dado financeiro nunca é tocado.

O que NÃO muda, de propósito (as contagens): nenhuma linha de inscrição, presença, hora de voluntariado, certificado ou Auditoria é apagada; o que sai é a PESSOA (o nome, o
contato, o texto livre, a ligação). Assim o número de inscritos e de presentes de cada evento, as horas do relatório anual, quantos certificados um evento emitiu e o histórico do
que aconteceu e quando continuam iguais.
  - inscrições e presenças (5 anos depois do evento): saem as respostas do formulário, o e-mail usado na inscrição, o código do QR, o código do link de cancelamento e o
    comentário da pesquisa de satisfação; ficam a inscrição, a situação (presente, ausente...) e a presença;
  - quem só se inscreveu em evento (5 anos depois do último evento): o papel "participante externo" acaba e, se a pessoa não tem outro vínculo com a ASAF (não é associada, não
    é beneficiária, não tem outro papel ativo), o nome, o CPF e o contato são apagados;
  - voluntário (5 anos depois do fim do último termo de adesão): saem a referência do termo e da autorização do responsável e o texto livre das horas e das trocas de turno; o
    papel "voluntário" acaba (antes ele ficava ativo para sempre e travava a anonimização do associado desligado que tinha sido voluntário); a mesma anonimização da pessoa;
  - certificado e crachá de evento (10 anos depois da emissão): o arquivo é apagado do armazenamento (a pasta é pública) e o nome sai do registro e da ligação com a pessoa; a
    verificação pública continua dizendo que o documento é válido, sem o nome;
  - Auditoria (10 anos depois da ação): saem quem fez, o endereço IP e os valores registrados; ficam a ação, a tabela, o número do registro e a data. A trava do banco contra
    APAGAR entradas da Auditoria continua (por isso é anonimizar, e não apagar)."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auditoria import registrar_auditoria
from app.models.associados import Associado
from app.models.beneficiarios import Beneficiario
from app.models.core import AuditLog
from app.models.eventos import Evento, SessaoEvento
from app.models.motores import DocumentoEmitido, Inscricao
from app.models.pessoas import Papel, Pessoa
from app.models.projetos import AlocacaoVoluntario, TrocaTurnoVoluntario
from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario
from app.services import armazenamento

LOG = logging.getLogger("asaf.retencao")

PARTICIPANTE_EXTERNO = "participante_externo"
VOLUNTARIO = "voluntario"
CONTEXTO_EVENTO = "Evento"
CONTEXTO_SESSAO = "SessaoEvento"
MARCADOR_DE_TEXTO = "(texto apagado pelo prazo de guarda)"
NOME_APAGADO = "Pessoa removida (prazo de guarda)"
MODELOS_DE_EVENTO = ("CERTIFICADO_EVENTO", "CRACHA_EVENTO")
# o que é da PESSOA (a mesma lista da anonimização do associado, mais o nome: quem não é associado não está no livro de associados)
CAMPOS_DA_PESSOA = ("cpf", "email_contato", "telefone_whatsapp", "data_nascimento", "estado_civil", "profissao", "naturalidade", "foto", "habilidades")


# ------------------------------------------------------------------------------------------------ o fim de cada participação
def _fim_dos_eventos(db: Session) -> dict[tuple[str, int], datetime]:
    """(contexto, id) -> quando acabou. O evento acaba no MAIOR entre o fim dele (ou o início, se não tem fim) e o de cada sessão dele (um programa longo não
    vence pela data da abertura); a sessão, pelo fim dela."""
    fins: dict[tuple[str, int], datetime] = {}
    for id_evento, inicio, fim in db.query(Evento.id_evento, Evento.data_hora_inicio, Evento.data_hora_fim):
        if fim or inicio:
            fins[(CONTEXTO_EVENTO, id_evento)] = fim or inicio
    for id_sessao, id_evento, inicio, fim in db.query(SessaoEvento.id_sessao, SessaoEvento.id_evento, SessaoEvento.data_hora_inicio,
                                                      SessaoEvento.data_hora_fim):
        quando = fim or inicio
        if quando:
            fins[(CONTEXTO_SESSAO, id_sessao)] = quando
            chave = (CONTEXTO_EVENTO, id_evento)
            fins[chave] = max(fins.get(chave, quando), quando)
    return fins


def _ultima_participacao(db: Session, fins: dict) -> dict[int, datetime]:
    """id_pessoa -> o fim do último evento em que se inscreveu. Inscrição em evento sem data conta como "nunca vence"."""
    ultima: dict[int, datetime] = {}
    for id_pessoa, contexto, id_contexto in db.query(Inscricao.id_pessoa, Inscricao.contexto_tipo, Inscricao.id_contexto):
        fim = fins.get((contexto, id_contexto), datetime.max)
        if fim > ultima.get(id_pessoa, datetime.min):
            ultima[id_pessoa] = fim
    return ultima


# ------------------------------------------------------------------------------------------------ a pessoa sem outro vínculo
def _tem_outro_vinculo(db: Session, id_pessoa: int, ultima: dict[int, datetime], limite: datetime) -> bool:
    """O dado da pessoa ainda serve a alguma coisa: é associada (o livro de associados guarda o nome), beneficiária (o atendimento social tem regra própria),
    funcionária, familiar ou dependente de alguém do cadastro (o núcleo familiar mostra o nome), tem papel ativo, ou se inscreveu num evento que ainda não venceu
    (recente, futuro ou sem data: a inscrição feita pelo CPF reaproveita o cadastro e não ganha o papel de participante)."""
    from app.models.associados import DependenteFamiliar
    from app.models.voluntariado import Funcionario

    if ultima.get(id_pessoa, datetime.min) >= limite:
        return True
    consultas = (
        db.query(Associado.id_associado).filter(Associado.id_pessoa == id_pessoa),
        db.query(Beneficiario.id_beneficiario).filter(Beneficiario.id_pessoa == id_pessoa),
        db.query(Funcionario.id_funcionario).filter(Funcionario.id_pessoa == id_pessoa),
        db.query(DependenteFamiliar.id_pessoa_titular).filter(or_(DependenteFamiliar.id_pessoa_titular == id_pessoa,
                                                                  DependenteFamiliar.id_pessoa_vinculada == id_pessoa)),
        db.query(Papel.id_papel).filter(Papel.id_pessoa == id_pessoa, Papel.ativo.is_(True)),
    )
    return any(q.first() is not None for q in consultas)


def anonimizar_pessoa_sem_vinculo(db: Session, pessoa: Pessoa, motivo: str, *, ultima: dict[int, datetime], limite: datetime) -> bool:
    """Apaga o nome, o CPF e o contato de quem não tem outro vínculo com a ASAF (`_tem_outro_vinculo`). A Auditoria da anonimização grava (e confirma) tudo o que a
    regra mudou antes. Devolve se mexeu. Se a foto (raro) não puder ser apagada do armazenamento, levanta: a pessoa fica para a próxima rodada."""
    if pessoa.nome_completo == NOME_APAGADO and all(getattr(pessoa, c) is None for c in CAMPOS_DA_PESSOA):
        return False
    if _tem_outro_vinculo(db, pessoa.id_pessoa, ultima, limite):
        return False
    alvo = armazenamento.separar_url(pessoa.foto)
    if alvo is not None:
        armazenamento.obter().remover(*alvo)
    pessoa.nome_completo = NOME_APAGADO
    for campo in CAMPOS_DA_PESSOA:
        setattr(pessoa, campo, None)
    from app.models.preferencias_de_comunicacao import PreferenciaDeComunicacao

    db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == pessoa.id_pessoa).delete(synchronize_session=False)
    # nunca os VALORES apagados: só o que saiu e por quê
    registrar_auditoria(db, None, "pessoas", "ANONIMIZADO", id_registro_afetado=pessoa.id_pessoa,
                        dados_depois={"campos_apagados": ["nome_completo", *CAMPOS_DA_PESSOA], "motivo": motivo})
    return True


def _encerrar_papel(db: Session, id_pessoa: int, tipo: str) -> int:
    return db.query(Papel).filter(Papel.id_pessoa == id_pessoa, Papel.tipo_papel == tipo, Papel.ativo.is_(True)).update(
        {Papel.ativo: False}, synchronize_session=False)


# ------------------------------------------------------------------------------------------------ as regras
def inscricoes_e_presencas(db: Session, agora: datetime, dias: int) -> int:
    """5 anos depois do evento (ou da sessão): saem as respostas, o e-mail da inscrição, o código do QR, o do cancelamento e o comentário da pesquisa (de TODO
    inscrito do evento, também de quem foi inscrito pelo painel). A linha fica (as contagens)."""
    from app.models.pesquisa_satisfacao import RespostaPesquisaSatisfacao

    limite = agora - timedelta(days=dias)
    vencidos = {chave for chave, fim in _fim_dos_eventos(db).items() if fim < limite}
    if not vencidos:
        return 0
    com_dado = or_(Inscricao.respostas_formulario.isnot(None), Inscricao.email_da_inscricao.isnot(None), Inscricao.codigo_checkin.isnot(None),
                   Inscricao.token_cancelamento.isnot(None), Inscricao.identificador_grupo.isnot(None))
    candidatas = [i for i in db.query(Inscricao).filter(com_dado, Inscricao.contexto_tipo.in_([CONTEXTO_EVENTO, CONTEXTO_SESSAO]))
                  if (i.contexto_tipo, i.id_contexto) in vencidos]
    for i in candidatas:
        i.respostas_formulario = i.email_da_inscricao = i.codigo_checkin = i.token_cancelamento = i.identificador_grupo = None
    eventos_vencidos = [id_contexto for (contexto, id_contexto) in vencidos if contexto == CONTEXTO_EVENTO]
    comentarios = 0
    if eventos_vencidos:
        comentarios = db.query(RespostaPesquisaSatisfacao).filter(
            RespostaPesquisaSatisfacao.id_evento.in_(eventos_vencidos), RespostaPesquisaSatisfacao.comentario.isnot(None),
        ).update({RespostaPesquisaSatisfacao.comentario: None}, synchronize_session=False)
    db.commit()
    return len(candidatas) + comentarios


def participantes_externos(db: Session, agora: datetime, dias: int) -> tuple[int, int]:
    """5 anos depois do último evento: o papel "participante externo" acaba e quem não tem outro vínculo é anonimizado. Vale também para quem se inscreveu sem
    ganhar o papel (a inscrição pelo CPF reaproveita o cadastro que já existia)."""
    limite = agora - timedelta(days=dias)
    ultima = _ultima_participacao(db, _fim_dos_eventos(db))
    # o prazo conta também de quando o papel nasceu: quem ganhou o papel e não tem inscrição (a inscrição foi apagada) não é anonimizado na hora
    criado = dict(db.query(Papel.id_pessoa, func.max(Papel.criado_em)).filter(Papel.tipo_papel == PARTICIPANTE_EXTERNO, Papel.ativo.is_(True))
                  .group_by(Papel.id_pessoa))
    candidatos = set(criado) | {id_pessoa for id_pessoa, fim in ultima.items() if fim < limite}
    afetadas = falhas = 0
    for id_pessoa in sorted(candidatos):
        if max(ultima.get(id_pessoa, datetime.min), criado.get(id_pessoa) or datetime.min) >= limite:
            continue  # ainda dentro do prazo (ou inscrito num evento sem data)
        try:
            mudou = bool(_encerrar_papel(db, id_pessoa, PARTICIPANTE_EXTERNO))
            pessoa = db.get(Pessoa, id_pessoa)
            if pessoa is not None:
                mudou |= anonimizar_pessoa_sem_vinculo(db, pessoa, "participante externo: 5 anos depois do último evento", ultima=ultima, limite=limite)
            db.commit()
            afetadas += int(mudou)
        except Exception:  # noqa: BLE001 - uma pessoa não impede as outras; a rotina fica vermelha
            db.rollback()
            LOG.exception("participante externo %s ficou para a próxima rodada", id_pessoa)
            falhas += 1
    return afetadas, falhas


def voluntarios_encerrados(db: Session, agora: datetime, dias: int) -> tuple[int, int]:
    """5 anos depois do fim do ÚLTIMO termo de adesão da pessoa: saem as referências e o texto livre, o papel acaba e quem não tem outro vínculo é anonimizado. As horas e as datas ficam."""
    limite = agora - timedelta(days=dias)
    ultima = _ultima_participacao(db, _fim_dos_eventos(db))
    fim_por_pessoa = dict(db.query(TermoAdesaoVoluntario.id_pessoa, func.max(TermoAdesaoVoluntario.data_fim_vigencia)).group_by(TermoAdesaoVoluntario.id_pessoa))
    afetadas = falhas = 0
    for id_pessoa, fim in fim_por_pessoa.items():
        if fim is None or fim >= limite:
            continue
        try:
            mudou = False
            termos = db.query(TermoAdesaoVoluntario).filter(TermoAdesaoVoluntario.id_pessoa == id_pessoa).all()
            for t in termos:
                if t.documento_referencia is not None or t.autorizacao_responsavel_referencia is not None or t.ativo:
                    t.documento_referencia = t.autorizacao_responsavel_referencia = None
                    t.ativo = False
                    mudou = True
            ids_termo = [t.id_termo for t in termos]
            mudou |= bool(db.query(RegistroHorasVoluntariado).filter(
                RegistroHorasVoluntariado.id_termo.in_(ids_termo), RegistroHorasVoluntariado.descricao_atividade.isnot(None),
                RegistroHorasVoluntariado.descricao_atividade != MARCADOR_DE_TEXTO,
            ).update({RegistroHorasVoluntariado.descricao_atividade: MARCADOR_DE_TEXTO}, synchronize_session=False))
            alocacoes = [a for (a,) in db.query(AlocacaoVoluntario.id_alocacao).filter(AlocacaoVoluntario.id_pessoa == id_pessoa)]
            if alocacoes:
                mudou |= bool(db.query(TrocaTurnoVoluntario).filter(
                    TrocaTurnoVoluntario.id_alocacao.in_(alocacoes), TrocaTurnoVoluntario.motivo.isnot(None), TrocaTurnoVoluntario.motivo != MARCADOR_DE_TEXTO,
                ).update({TrocaTurnoVoluntario.motivo: MARCADOR_DE_TEXTO}, synchronize_session=False))
            mudou |= bool(_encerrar_papel(db, id_pessoa, VOLUNTARIO))
            pessoa = db.get(Pessoa, id_pessoa)
            if pessoa is not None:
                mudou |= anonimizar_pessoa_sem_vinculo(db, pessoa, "voluntário: 5 anos depois do fim do último termo de adesão", ultima=ultima, limite=limite)
            db.commit()
            afetadas += int(mudou)
        except Exception:  # noqa: BLE001
            db.rollback()
            LOG.exception("voluntário %s ficou para a próxima rodada", id_pessoa)
            falhas += 1
    return afetadas, falhas


def certificados(db: Session, agora: datetime, dias: int) -> tuple[int, int]:
    """10 anos depois da emissão: o arquivo do certificado (ou do crachá) de evento sai do armazenamento e o nome sai do registro; o número e o código continuam válidos.
    Só o certificado e o crachá (outro documento emitido no contexto de um evento pela rota genérica não é desta regra)."""
    from app.models.motores import TemplateDocumento

    limite = agora - timedelta(days=dias)
    candidatos = db.query(DocumentoEmitido).join(TemplateDocumento, TemplateDocumento.id_template == DocumentoEmitido.id_template).filter(
        TemplateDocumento.codigo.in_(MODELOS_DE_EVENTO),
        DocumentoEmitido.contexto_tipo == CONTEXTO_EVENTO, DocumentoEmitido.emitida_em < limite,
        or_(DocumentoEmitido.caminho_arquivo != "", DocumentoEmitido.id_pessoa.isnot(None)),
    ).all()
    afetados = falhas = 0
    for d in candidatos:
        try:
            alvo = armazenamento.separar_url(d.caminho_arquivo)
            if alvo is not None:
                armazenamento.obter().remover(*alvo)  # sem o arquivo apagado, nada muda: fica para a próxima rodada
            try:
                variaveis = json.loads(d.variaveis_usadas or "{}")
            except ValueError:
                variaveis = {}
            variaveis["nome_completo"] = None
            d.variaveis_usadas = json.dumps(variaveis, ensure_ascii=False)
            d.caminho_arquivo = ""
            d.id_pessoa = None
            db.commit()
            afetados += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            LOG.exception("o certificado %s ficou para a próxima rodada", d.id_documento)
            falhas += 1
    return afetados, falhas


def auditoria(db: Session, agora: datetime, dias: int) -> int:
    """10 anos depois da ação: saem quem fez, o IP e os valores; ficam a ação, a tabela, o registro e a data (a trava contra apagar continua)."""
    n = db.query(AuditLog).filter(
        AuditLog.timestamp < agora - timedelta(days=dias),
        or_(AuditLog.id_usuario.isnot(None), AuditLog.ip_origem.isnot(None), AuditLog.dados_antes.isnot(None), AuditLog.dados_depois.isnot(None)),
    ).update({AuditLog.id_usuario: None, AuditLog.ip_origem: None, AuditLog.dados_antes: None, AuditLog.dados_depois: None}, synchronize_session=False)
    db.commit()
    return n
