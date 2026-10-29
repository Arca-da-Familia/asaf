"""v5.5a (FASE 5) - a fila única de atendimento: o que acontece com cada pedido que chega pelo site (ver app/models/atendimento.py).

Regras: cada pedido ganha protocolo e prazo (os dias vêm de Configurações > Regras do sistema, por tipo); o mesmo pedido mandado duas vezes (duplo clique) não
vira dois protocolos; o remetente é ligado ao cadastro quando o CPF (ou o e-mail) já é de alguém que o sistema conhece, sem nunca dizer isso a quem está de fora;
quem tem a permissão `atendimento` é avisado no sino; responder exige texto e registra quem respondeu e quando, e tenta mandar a resposta por e-mail."""
import hashlib
import math
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app import textos_de_privacidade
from app.config_cache import obter_configuracao
from app.models.associados import Associado
from app.models.atendimento import (
    CONTATO, ENCERRADO, EM_ATENDIMENTO, IDENTIDADE_AUTOMATICA_CADASTRO, IDENTIDADE_CODIGO_NO_EMAIL, IDENTIDADE_MANUAL, NOVO, PEDIDO_INFORMACAO, RESPONDIDO, TITULAR_LGPD,
    VOLUNTARIO, Atendimento,
)
from app.models.core import NivelAcesso, Usuario
from app.models.motores import Inscricao
from app.models.notificacoes_painel import NotificacaoPainel
from app.models.pessoas import Pessoa
from app.services.voluntariado import pessoa_e_menor_de_idade
from app.services import notificacoes
from app.services.notificacoes_painel import notificar, usuarios_com_permissao
from app.services.site_publico import url_base_do_site

# o texto do aviso de privacidade dos formulários de atendimento tem versão: o site manda a versão que mostrou e o servidor recusa se o texto mudou
VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO = textos_de_privacidade.versao_atual("ATENDIMENTO")  # 2 (2026-10-16): o aviso do voluntariado diz que a oferta aceita vira cadastro de voluntário (nome, CPF se informado, contato, data de nascimento)

PERMISSAO_DA_FILA = "atendimento"
LIMITE_DA_MENSAGEM = 4000
TAMANHO_MINIMO_DA_RESPOSTA = 10
TAMANHO_MINIMO_DO_MOTIVO = 5
TAMANHO_MINIMO_DA_NOTA_DE_IDENTIDADE = 10
LIMITE_DA_NOTA_DE_IDENTIDADE = 500
DIAS_DE_AVISO_ANTES_DO_PRAZO = 3
JANELA_DO_DUPLO_CLIQUE = timedelta(hours=24)

ROTULOS_DO_TIPO = {
    CONTATO: "Contato",
    PEDIDO_INFORMACAO: "Pedido de informação sobre recursos públicos",
    TITULAR_LGPD: "Solicitação de titular de dados (LGPD)",
    VOLUNTARIO: "Voluntariado",
}

# os direitos do titular, art. 18 da LGPD (o texto que a pessoa vê no formulário e que o painel mostra)
ROTULOS_DO_SUBTIPO_LGPD = {
    "CONFIRMACAO": "Confirmar se a associação trata dados meus",
    "ACESSO": "Acessar os dados que a associação tem sobre mim",
    "CORRECAO": "Corrigir dados incompletos, inexatos ou desatualizados",
    # v7.2a: o rótulo cobre o art. 18, IV e VI (a ASAF não oferece "bloqueio": decisão do Presidente, 2026-10-28)
    "ELIMINACAO": "Anonimizar ou eliminar dados meus (desnecessários, tratados sem base legal ou que dei com o meu consentimento)",
    "PORTABILIDADE": "Receber meus dados para levar a outra entidade (portabilidade)",
    "COMPARTILHAMENTO": "Saber com quem a associação compartilhou meus dados",
    "REVOGACAO": "Retirar um consentimento que dei",
    # v7.2a - os dois direitos que faltavam no formulário (art. 18, VIII, e art. 18, § 2º)
    "NAO_CONSENTIR": "Saber o que acontece se eu não der (ou retirar) o consentimento",
    "OPOSICAO": "Me opor a um uso dos meus dados que não depende do meu consentimento",
    "OUTRO": "Outro pedido sobre os meus dados pessoais",
}

# como a identidade de quem pede dado pessoal foi validada (v5.7f): o que o painel mostra
ROTULOS_DA_IDENTIDADE = {
    IDENTIDADE_AUTOMATICA_CADASTRO: "Automática: o e-mail digitado é o do cadastro de associado daquele CPF",
    IDENTIDADE_CODIGO_NO_EMAIL: "Automática: o pedido foi aberto dentro da área Minha conta, com o e-mail confirmado por código",
    IDENTIDADE_MANUAL: "Conferida pela equipe",
}

# dias de prazo por tipo, usados se a regra não existir no banco (as regras ficam em Configurações > Regras do sistema e a diretoria muda)
CHAVES_DO_PRAZO = {
    CONTATO: "PRAZO_DIAS_ATENDIMENTO_CONTATO",
    PEDIDO_INFORMACAO: "PRAZO_DIAS_PEDIDO_INFORMACAO",
    TITULAR_LGPD: "PRAZO_DIAS_TITULAR_LGPD",
    VOLUNTARIO: "PRAZO_DIAS_ATENDIMENTO_VOLUNTARIO",
}
PRAZO_PADRAO_EM_DIAS = {CONTATO: 10, PEDIDO_INFORMACAO: 20, TITULAR_LGPD: 15, VOLUNTARIO: 10}
# v7.2a - decisão do Presidente (2026-10-28): a solicitação do titular nunca tem prazo maior que 15 dias (LGPD, art. 19, II), mesmo que a regra seja mudada
TETO_DO_PRAZO_DO_TITULAR = 15

# v7.2a - o resultado de cada solicitação do titular e o fundamento de quando ela não é atendida por inteiro (decisão do Presidente, 2026-10-28: o que a lei manda guardar)
ATENDIDO, ATENDIDO_EM_PARTE, NEGADO, ENCERRADO_SEM_RESPOSTA = "ATENDIDO", "ATENDIDO_EM_PARTE", "NEGADO", "ENCERRADO_SEM_RESPOSTA"
ROTULOS_DO_RESULTADO = {
    ATENDIDO: "Atendido", ATENDIDO_EM_PARTE: "Atendido em parte", NEGADO: "Não atendido, com o fundamento",
    ENCERRADO_SEM_RESPOSTA: "Encerrado sem resposta",
}
RESULTADOS_DA_RESPOSTA = (ATENDIDO, ATENDIDO_EM_PARTE, NEGADO)
FUNDAMENTOS = {
    "ESCRITURACAO_FINANCEIRA": "O dado faz parte da escrituração financeira e dos recibos da associação, que a lei obriga a guardar (LGPD, art. 16, I).",
    "ATAS_E_VOTACOES": "O dado está em ata ou em votação de assembleia, que são registros permanentes da associação, previstos no Estatuto.",
    "LIVRO_DE_ASSOCIADOS": "O nome e a matrícula ficam no livro de associados, registro permanente da associação, previsto no Estatuto.",
    "PROVA_DE_CONSENTIMENTO": "A prova do consentimento fica guardada pelo prazo dela, para a associação poder mostrar que o consentimento existiu (LGPD, art. 8º, § 2º).",
    "VINCULO_ATIVO": "Enquanto a pessoa é associada, os dados são necessários ao vínculo com a associação (LGPD, art. 7º, V); depois do desligamento, deixam de ser "
                     "necessários e podem ser anonimizados (o nome e a matrícula ficam no livro de associados).",
    "IDENTIDADE_NAO_CONFIRMADA": "Não foi possível confirmar que quem pede é o titular dos dados (ou o responsável por ele).",
    "OUTRO": "Outro motivo, explicado na resposta.",
}


def exigir_aviso_de_privacidade(aceito: bool, versao: Optional[str]) -> None:
    if not aceito:
        raise HTTPException(status_code=400, detail="Para enviar o pedido é preciso ler e aceitar o aviso de privacidade.")
    if versao != VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO:
        raise HTTPException(status_code=422, detail="O aviso de privacidade foi atualizado: recarregue a página, leia e aceite a versão atual.")


def prazo_em_dias(db: Session, tipo: str) -> int:
    padrao = PRAZO_PADRAO_EM_DIAS[tipo]
    valor = obter_configuracao(db, CHAVES_DO_PRAZO[tipo], str(padrao))
    try:
        dias = int(float(str(valor).strip()))
    except (TypeError, ValueError, OverflowError):
        return padrao
    dias = dias if dias >= 1 else padrao
    return min(dias, TETO_DO_PRAZO_DO_TITULAR) if tipo == TITULAR_LGPD else dias


def prazos_publicos(db: Session) -> dict[str, int]:
    return {tipo: prazo_em_dias(db, tipo) for tipo in (CONTATO, PEDIDO_INFORMACAO, TITULAR_LGPD, VOLUNTARIO)}


def _so_digitos(texto: Optional[str]) -> str:
    return re.sub(r"\D", "", texto or "")


def chave_do_remetente(cpf: Optional[str], email: Optional[str], telefone: Optional[str]) -> Optional[str]:
    if cpf:
        return f"cpf:{_so_digitos(cpf)}"
    if email:
        return f"email:{email.strip().lower()}"
    digitos = _so_digitos(telefone)
    return f"tel:{digitos}" if digitos else None


def _impressao(tipo: str, subtipo: Optional[str], chave: Optional[str], assunto: Optional[str], mensagem: str) -> str:
    normalizado = "|".join(re.sub(r"\s+", " ", (parte or "")).strip().lower() for parte in (tipo, subtipo, chave, assunto, mensagem))
    return hashlib.sha256(normalizado.encode("utf-8")).hexdigest()


def _pessoa_do_remetente(db: Session, cpf: Optional[str], email: Optional[str]) -> Optional[int]:
    """A pessoa do cadastro (a mesma deduplicação dos demais formulários): pelo CPF; sem CPF, pelo e-mail, mas só se for UMA pessoa (e-mail repetido não adivinha). O pedido de
    VOLUNTARIADO nunca passa o e-mail aqui (ver `registrar_pelo_site`): ligado à pessoa, o painel pula o cadastro e vai direto ao termo de adesão DAQUELA pessoa."""
    if cpf:
        pessoa = db.query(Pessoa).filter(Pessoa.cpf == _so_digitos(cpf)).first()
        return pessoa.id_pessoa if pessoa else None
    if email:
        achadas = db.query(Pessoa.id_pessoa).filter(func.lower(Pessoa.email_contato) == email.strip().lower()).limit(2).all()
        return achadas[0][0] if len(achadas) == 1 else None
    return None


def identidade_valida_pelo_cadastro(db: Session, cpf: Optional[str], email: Optional[str]) -> bool:
    """A validação AUTOMÁTICA da identidade (v5.7f): o e-mail digitado no pedido é o do cadastro de ASSOCIADO daquele CPF. Só vale para quem é associado: o e-mail de quem é só participante de
    evento pode ter sido preenchido por outra pessoa que digitou o CPF dele numa inscrição (a deduplicação por CPF completa o contato que estava vazio), e o e-mail do cadastro de associado foi
    escrito pela secretaria ou conferido na filiação. Nunca prova sozinha que quem pede é o titular: a resposta ainda só é entregue na área Minha conta, depois do código enviado a esse e-mail."""
    if not cpf or not email:
        return False
    pessoa = db.query(Pessoa).filter(Pessoa.cpf == _so_digitos(cpf)).first()
    if pessoa is None or not pessoa.email_contato:
        return False
    if pessoa.email_contato.strip().lower() != email.strip().lower():
        return False
    # defesa em profundidade: se uma inscrição pública DESTA pessoa digitou exatamente este e-mail, não dá para saber se ele veio dela ou de quem digitou o CPF dela: a equipe confere à mão
    if db.query(Inscricao.id_inscricao).filter(Inscricao.id_pessoa == pessoa.id_pessoa, func.lower(Inscricao.email_da_inscricao) == email.strip().lower()).first() is not None:
        return False
    return db.query(Associado.id_associado).filter(Associado.id_pessoa == pessoa.id_pessoa).first() is not None


def usuarios_que_atendem(db: Session) -> list[int]:
    """Quem tem a permissão da fila (pelo nível de acesso)."""
    return usuarios_com_permissao(db, PERMISSAO_DA_FILA)


def responsavel_padrao(db: Session) -> Optional[int]:
    """O Presidente (decisão de 2026-10-09: a associação não tem segunda pessoa para o papel); sem usuário com esse nível, ninguém, e a fila inteira o vê."""
    usuario = (
        db.query(Usuario.id_usuario)
        .join(NivelAcesso, NivelAcesso.id_nivel == Usuario.id_nivel)
        .filter(NivelAcesso.nome_nivel == "Presidente", Usuario.ativo.is_(True))
        .order_by(Usuario.id_usuario)
        .first()
    )
    return usuario[0] if usuario else None


def responsavel_do_pedido(db: Session, tipo: str, id_pessoa: Optional[int]) -> Optional[int]:
    """v7.2a - decisão do Presidente (2026-10-28): a solicitação do titular sobre os dados do PRÓPRIO Presidente fica com o 1º Vice-Presidente (o 2º, na falta dele),
    por conflito de interesse - o substituto do encarregado pelo Estatuto (art. 21, parágrafo único). Os demais pedidos ficam com o Presidente."""
    padrao = responsavel_padrao(db)
    if tipo != TITULAR_LGPD or id_pessoa is None:
        return padrao
    from app.services import encarregado

    agora = datetime.utcnow()
    mandato = encarregado._mandato_vigente(db, encarregado.CARGO_ENCARREGADO, agora)
    do_presidente = db.get(Associado, mandato.id_associado) if mandato else None
    if do_presidente is None or do_presidente.id_pessoa != id_pessoa:
        return padrao
    # o 1º Vice-Presidente e, na falta dele (sem mandato, sem usuário ativo ou sem acesso à fila), o 2º; sem nenhum, ninguém: a fila inteira vê, e o Presidente não
    # atende (ver `_exigir_que_nao_seja_sobre_si`)
    que_atendem = set(usuarios_que_atendem(db))
    for cargo, _rotulo in encarregado.CARGOS_SUBSTITUTOS:
        vice = encarregado._mandato_vigente(db, cargo, agora)
        associado = db.get(Associado, vice.id_associado) if vice else None
        if associado is not None and associado.id_usuario in que_atendem:
            return associado.id_usuario
    return None


def _exigir_que_nao_seja_sobre_si(db: Session, a: Atendimento, usuario: Usuario) -> None:
    """v7.2a - ninguém atende a solicitação do titular sobre os PRÓPRIOS dados (conflito de interesse; decisão do Presidente, 2026-10-28, para o caso dele)."""
    if a.tipo != TITULAR_LGPD or a.id_pessoa is None:
        return
    proprio = db.query(Associado.id_associado).filter(Associado.id_usuario == usuario.id_usuario, Associado.id_pessoa == a.id_pessoa).first()
    if proprio is not None:
        raise HTTPException(status_code=403, detail="Este pedido é sobre os seus próprios dados: quem atende é outra pessoa da equipe (conflito de interesse).")


def registrar_pelo_site(
    db: Session, *, tipo: str, subtipo: Optional[str], assunto: Optional[str], mensagem: str, nome_completo: str, email: Optional[str],
    telefone: Optional[str], cpf: Optional[str], versao_do_aviso: str, data_nascimento: Optional[date] = None, agora: Optional[datetime] = None,
    identidade: Optional[str] = None,
) -> tuple[Atendimento, bool]:
    """Grava o pedido, dá o protocolo, calcula o prazo e avisa quem atende. Devolve (atendimento, novo): o mesmo pedido ainda aberto, mandado de novo em 24 horas
    (duplo clique, ou a pessoa que não viu a confirmação), devolve o mesmo protocolo e `novo=False`, sem avisar ninguém de novo. Na solicitação do titular, `identidade` diz que a identidade
    já vem validada (o pedido aberto dentro da área Minha conta); sem ela, o pedido nasce validado só se o e-mail for o do cadastro de associado daquele CPF. Faz commit."""
    agora = agora or datetime.utcnow()
    chave = chave_do_remetente(cpf, email, telefone)
    impressao = _impressao(tipo, subtipo, chave, assunto, mensagem)
    repetido = (
        db.query(Atendimento)
        .filter(
            Atendimento.impressao_do_pedido == impressao,
            Atendimento.status.in_([NOVO, EM_ATENDIMENTO, RESPONDIDO] if tipo == TITULAR_LGPD else [NOVO, EM_ATENDIMENTO]),
            Atendimento.criado_em >= agora - JANELA_DO_DUPLO_CLIQUE,
        )
        .order_by(Atendimento.id_atendimento)
        .first()
    )
    if repetido is not None:
        return repetido, False

    dias = prazo_em_dias(db, tipo)
    atendimento = Atendimento(
        protocolo=f"TMP-{uuid.uuid4().hex[:20]}", tipo=tipo, subtipo=subtipo, assunto=assunto, mensagem=mensagem,
        nome_completo=nome_completo, email_contato=email, telefone_whatsapp=telefone, cpf=_so_digitos(cpf) or None,
        data_nascimento=datetime.combine(data_nascimento, datetime.min.time()) if data_nascimento else None, id_pessoa=_pessoa_do_remetente(db, cpf, None if tipo == VOLUNTARIO else email), chave_remetente=chave, impressao_do_pedido=impressao, origem="site",
        consentimento_lgpd_em=agora, consentimento_lgpd_versao=versao_do_aviso, status=NOVO, prazo_dias=dias, prazo_em=agora + timedelta(days=dias),
        criado_em=agora,
    )
    atendimento.id_responsavel = responsavel_do_pedido(db, tipo, atendimento.id_pessoa)
    if tipo == TITULAR_LGPD:
        como = identidade or (IDENTIDADE_AUTOMATICA_CADASTRO if identidade_valida_pelo_cadastro(db, cpf, email) else None)
        if como:
            atendimento.identidade_validacao = como
            atendimento.identidade_validada_em = agora
    db.add(atendimento)
    db.flush()
    atendimento.protocolo = f"ASAF-{agora.year}-{atendimento.id_atendimento:05d}"
    if tipo == TITULAR_LGPD and subtipo == "CONFIRMACAO" and atendimento.identidade_validada_em is not None:
        _confirmar_na_hora(db, atendimento, agora)
    notificar(
        db, usuarios_que_atendem(db), tipo="atendimento_novo", titulo=f"Novo atendimento {atendimento.protocolo}",
        texto=(f"{ROTULOS_DO_TIPO[tipo]} de {nome_completo}: confirmação respondida na hora pelo sistema." if atendimento.status == RESPONDIDO
               else f"{ROTULOS_DO_TIPO[tipo]} de {nome_completo}. Prazo: {dias} dias."),
        link="/atendimentos",
    )
    db.commit()
    db.refresh(atendimento)
    return atendimento, True


# ------------------------------------------------------------------------------------------------ o que a fila mostra
def situacao_do_prazo(a: Atendimento, agora: Optional[datetime] = None) -> str:
    """`cumprido` / `cumprido_com_atraso` (já respondido), `encerrado`, e para os abertos `vencido`, `vence_logo` (a 3 dias ou menos) ou `no_prazo`."""
    agora = agora or datetime.utcnow()
    if a.respondido_em is not None:
        return "cumprido" if a.respondido_em <= a.prazo_em else "cumprido_com_atraso"
    if a.status == ENCERRADO:
        return "encerrado"
    if agora > a.prazo_em:
        return "vencido"
    if a.prazo_em - agora <= timedelta(days=DIAS_DE_AVISO_ANTES_DO_PRAZO):
        return "vence_logo"
    return "no_prazo"


def _idade(nascimento: Optional[datetime], agora: datetime) -> Optional[int]:
    if nascimento is None:
        return None
    n = nascimento.date()
    return agora.year - n.year - ((agora.month, agora.day) < (n.month, n.day))


def _cpf_mascarado(cpf: Optional[str]) -> Optional[str]:
    return f"***.***.***-{cpf[-2:]}" if cpf and len(cpf) == 11 else None


ASSUNTO_DO_PEDIDO_DO_VISITANTE = "Eliminação de dados pela área do visitante"  # app/services/conta_de_visitante.py


def ponto_do_aviso(a: Atendimento) -> str:
    """v7.1a - qual aviso de privacidade a pessoa leu (app/textos_de_privacidade.py): o do formulário do tipo, ou o da conta de visitante, de onde o pedido de eliminação
    feito em Minha conta nasce (a versão gravada é a do aviso de lá)."""
    # o pedido aberto em Minha conta antes da v5.7f (16 a 19/10/2026) não tinha a identidade marcada: o assunto é o que ele sempre teve
    if a.tipo == TITULAR_LGPD and (a.identidade_validacao == IDENTIDADE_CODIGO_NO_EMAIL or a.assunto == ASSUNTO_DO_PEDIDO_DO_VISITANTE):
        return "VISITANTE"
    return {TITULAR_LGPD: "ATENDIMENTO_TITULAR", VOLUNTARIO: "ATENDIMENTO_VOLUNTARIADO"}.get(a.tipo, "ATENDIMENTO")


def serializar(a: Atendimento, agora: Optional[datetime] = None, *, completo: bool = False, db: Optional[Session] = None) -> dict:
    agora = agora or datetime.utcnow()
    dados = {
        "id_atendimento": a.id_atendimento, "protocolo": a.protocolo, "tipo": a.tipo, "tipo_rotulo": ROTULOS_DO_TIPO.get(a.tipo, a.tipo),
        "subtipo": a.subtipo, "subtipo_rotulo": ROTULOS_DO_SUBTIPO_LGPD.get(a.subtipo or ""), "assunto": a.assunto, "mensagem": a.mensagem,
        "nome_completo": a.nome_completo, "email_contato": a.email_contato, "telefone_whatsapp": a.telefone_whatsapp,
        "cpf_mascarado": _cpf_mascarado(a.cpf), "id_pessoa": a.id_pessoa, "status": a.status, "prazo_dias": a.prazo_dias, "prazo_em": a.prazo_em,
        "situacao_do_prazo": situacao_do_prazo(a, agora), "dias_restantes": math.ceil((a.prazo_em - agora).total_seconds() / 86400),
        "id_responsavel": a.id_responsavel, "assumido_em": a.assumido_em, "resposta": a.resposta, "respondido_em": a.respondido_em,
        "resposta_enviada_por_email": a.resposta_enviada_por_email, "motivo_encerramento": a.motivo_encerramento, "encerrado_em": a.encerrado_em,
        "criado_em": a.criado_em, "consentimento_lgpd_versao": a.consentimento_lgpd_versao, "ponto_do_aviso": ponto_do_aviso(a),
        "data_nascimento": a.data_nascimento.date().isoformat() if a.data_nascimento else None,
        "idade": _idade(a.data_nascimento, agora), "menor_de_idade": pessoa_e_menor_de_idade(a.data_nascimento.date(), agora.date()) if a.data_nascimento else None,
        # v5.7f: a solicitação do titular só pode ser respondida com a identidade validada
        "exige_identidade_validada": a.tipo == TITULAR_LGPD, "identidade_validada": a.identidade_validada_em is not None, "identidade_validacao": a.identidade_validacao,
        "identidade_validacao_rotulo": ROTULOS_DA_IDENTIDADE.get(a.identidade_validacao or ""), "identidade_validada_em": a.identidade_validada_em,
        "identidade_nota": a.identidade_nota, "id_usuario_validacao": a.id_usuario_validacao,
        # v7.2a
        "resultado": a.resultado, "resultado_rotulo": ROTULOS_DO_RESULTADO.get(a.resultado or ""), "fundamento": a.fundamento,
        "fundamento_texto": FUNDAMENTOS.get(a.fundamento or ""), "por_representante": bool(a.por_representante),
    }
    if completo:
        # o CPF inteiro só na abertura do pedido (a solicitação de titular precisa dele para conferir quem pede)
        dados["cpf"] = a.cpf
        if db is not None and a.id_pessoa is not None:
            # v7.2a: os atalhos do pedido para a ficha do associado e para o beneficiário (o prontuário e o consentimento ficam lá)
            from app.models.beneficiarios import Beneficiario

            associado = db.query(Associado.id_associado).filter(Associado.id_pessoa == a.id_pessoa).first()
            beneficiario = db.query(Beneficiario.id_beneficiario).filter(Beneficiario.id_pessoa == a.id_pessoa).first()
            dados["id_associado"] = associado[0] if associado else None
            dados["id_beneficiario"] = beneficiario[0] if beneficiario else None
            # o nome do CADASTRO (o do formulário foi digitado pela pessoa): é por ele que os atalhos buscam
            pessoa = db.get(Pessoa, a.id_pessoa)
            dados["nome_no_cadastro"] = pessoa.nome_completo if pessoa else None
        if db is not None and a.tipo == TITULAR_LGPD:
            # v7.2c: o relatório liberado para a pessoa baixar pela Minha conta (até quando vale)
            from app.services import entrega_ao_titular

            entrega = entrega_ao_titular.vigente(db, a)
            dados["relatorio_liberado_ate"] = entrega.valido_ate if entrega else None
        if db is not None and a.id_usuario_validacao is not None:
            quem = db.query(Usuario.email).filter(Usuario.id_usuario == a.id_usuario_validacao).first()
            dados["identidade_validada_por"] = quem[0] if quem else None
    return dados


def _abertos():
    return Atendimento.status.in_([NOVO, EM_ATENDIMENTO])


def filtrar(db: Session, *, tipo: Optional[str] = None, situacao: Optional[str] = None, vencidos: bool = False, busca: Optional[str] = None, agora: Optional[datetime] = None):
    """`situacao` aceita uma situação ou `abertos` (Novo + Em atendimento); `vencidos` = abertos com o prazo no passado."""
    agora = agora or datetime.utcnow()
    consulta = db.query(Atendimento)
    if tipo:
        consulta = consulta.filter(Atendimento.tipo == tipo)
    if situacao == "abertos":
        consulta = consulta.filter(_abertos())
    elif situacao:
        consulta = consulta.filter(Atendimento.status == situacao)
    if vencidos:
        consulta = consulta.filter(_abertos(), Atendimento.prazo_em < agora)
    texto = (busca or "").strip()
    if texto:
        condicoes = [
            Atendimento.protocolo.ilike(f"%{texto}%"), Atendimento.nome_completo.ilike(f"%{texto}%"), Atendimento.email_contato.ilike(f"%{texto}%"),
            Atendimento.assunto.ilike(f"%{texto}%"), Atendimento.mensagem.ilike(f"%{texto}%"),
        ]
        # só um texto com cara de número (CPF ou telefone, com ou sem pontuação) vira busca pelos dígitos
        if re.fullmatch(r"[\d\s.\-/()+]+", texto):
            digitos = _so_digitos(texto)
            if digitos:
                condicoes += [Atendimento.cpf.contains(digitos), Atendimento.telefone_whatsapp.contains(digitos)]
        consulta = consulta.filter(or_(*condicoes))
    return consulta


def ordenar_para_a_tela(consulta):
    """Os abertos primeiro, o prazo mais perto do fim em cima; depois os respondidos e encerrados, o mais novo em cima."""
    encerrado = case((Atendimento.status.in_([RESPONDIDO, ENCERRADO]), 1), else_=0)
    return consulta.order_by(encerrado, case((encerrado == 0, Atendimento.prazo_em), else_=None), Atendimento.criado_em.desc(), Atendimento.id_atendimento.desc())


def resumo(db: Session, agora: Optional[datetime] = None) -> dict:
    agora = agora or datetime.utcnow()
    abertos = db.query(Atendimento).filter(_abertos())
    por_tipo = dict(db.query(Atendimento.tipo, func.count()).filter(_abertos()).group_by(Atendimento.tipo).all())
    return {
        "novos": db.query(Atendimento).filter(Atendimento.status == NOVO).count(),
        "em_atendimento": db.query(Atendimento).filter(Atendimento.status == EM_ATENDIMENTO).count(),
        "abertos": abertos.count(),
        "vencidos": abertos.filter(Atendimento.prazo_em < agora).count(),
        "vencem_em_3_dias": abertos.filter(Atendimento.prazo_em >= agora, Atendimento.prazo_em <= agora + timedelta(days=DIAS_DE_AVISO_ANTES_DO_PRAZO)).count(),
        "por_tipo": {tipo: por_tipo.get(tipo, 0) for tipo in ROTULOS_DO_TIPO},
    }


def outros_do_remetente(db: Session, a: Atendimento) -> list[dict]:
    if not a.chave_remetente:
        return []
    outros = (
        db.query(Atendimento).filter(Atendimento.chave_remetente == a.chave_remetente, Atendimento.id_atendimento != a.id_atendimento)
        .order_by(Atendimento.criado_em.desc()).limit(20).all()
    )
    return [{"id_atendimento": o.id_atendimento, "protocolo": o.protocolo, "tipo_rotulo": ROTULOS_DO_TIPO.get(o.tipo, o.tipo), "status": o.status, "criado_em": o.criado_em} for o in outros]


# ------------------------------------------------------------------------------------------------ o que quem atende faz
def assumir(db: Session, a: Atendimento, usuario: Usuario, agora: Optional[datetime] = None) -> Atendimento:
    if a.status in (RESPONDIDO, ENCERRADO):
        raise HTTPException(status_code=400, detail=f"Este atendimento já está {a.status.lower()}.")
    _exigir_que_nao_seja_sobre_si(db, a, usuario)
    a.id_responsavel = usuario.id_usuario
    a.assumido_em = agora or datetime.utcnow()
    a.status = EM_ATENDIMENTO
    db.commit()
    db.refresh(a)
    return a


def _texto_do_aviso_de_resposta_do_titular(db: Session, a: Atendimento) -> str:
    """Solicitação do titular: o e-mail NÃO leva a resposta (ela pode ter dado pessoal e o e-mail pode ter sido digitado por outra pessoa): só avisa que ela existe e onde ler."""
    return (
        f"Olá, {a.nome_completo.split()[0]}.\n\n"
        f"A Associação Arca da Família (ASAF) respondeu ao seu pedido sobre dados pessoais, protocolo {a.protocolo}.\n\n"
        "Por segurança, a resposta não vai neste e-mail. Para lê-la, entre na área Minha conta do site com este mesmo e-mail (você recebe um código de 6 números):\n"
        f"{url_base_do_site(db)}/minha-conta/\n\n"
        "Se não foi você quem fez o pedido, ignore esta mensagem: ninguém de fora da associação lê a resposta sem o código enviado a este e-mail.\n\nASAF - Associação Arca da Família\n"
    )


def _texto_do_aviso_de_encerramento_do_titular(db: Session, a: Atendimento) -> str:
    """Solicitação do titular encerrada (por exemplo, a identidade não pôde ser conferida): o e-mail só avisa; o motivo é lido na área Minha conta, como a resposta."""
    return (
        f"Olá, {a.nome_completo.split()[0]}.\n\n"
        f"A Associação Arca da Família (ASAF) encerrou o seu pedido sobre dados pessoais, protocolo {a.protocolo}.\n\n"
        "O motivo não vai neste e-mail. Para lê-lo, entre na área Minha conta do site com este mesmo e-mail (você recebe um código de 6 números):\n"
        f"{url_base_do_site(db)}/minha-conta/\n\n"
        "Se não foi você quem fez o pedido, ignore esta mensagem: ninguém de fora da associação lê nada sem o código enviado a este e-mail.\n\nASAF - Associação Arca da Família\n"
    )


def _texto_do_email_de_resposta(a: Atendimento, resposta: str) -> str:
    return (
        f"Olá, {a.nome_completo.split()[0]}.\n\n"
        f"Esta é a resposta da Associação Arca da Família (ASAF) ao seu pedido, protocolo {a.protocolo}:\n\n{resposta}\n\n"
        "Se ainda tiver dúvida, responda a este e-mail citando o protocolo.\n\nASAF - Associação Arca da Família\n"
    )


def _confirmar_na_hora(db: Session, a: Atendimento, agora: datetime) -> None:
    """v7.2a - decisão do Presidente (2026-10-28): a confirmação simples de que a ASAF trata dados da pessoa (LGPD, art. 19, I) sai NA HORA, quando a identidade já
    nasce validada (o e-mail do cadastro de associado, ou o pedido aberto na Minha conta). Quais são os dados vem pelo pedido de acesso. Sem commit."""
    from app.models.intencoes_de_doacao import IntencaoDeDoacao
    from app.services.conta_de_visitante import _inscricoes_do_email

    # o próprio pedido não conta: só o cadastro DESTA pessoa (pelo CPF, ou pelo e-mail quando ele é de uma pessoa só) e o que foi feito pelo site com este e-mail
    email = (a.email_contato or "").strip().lower()
    tem = a.id_pessoa is not None or bool(email) and (
        bool(_inscricoes_do_email(db, email, so_uma=True))
        or db.query(IntencaoDeDoacao.id_intencao).filter(func.lower(IntencaoDeDoacao.email_doador) == email).first() is not None
    )
    a.resposta = (
        "Sim. A ASAF trata dados pessoais seus (por exemplo, do cadastro, de inscrições em eventos ou de doações). Esta é a confirmação simplificada; para saber "
        "quais são os dados, de onde vieram, para que servem e com quem são compartilhados, faça uma solicitação de acesso." if tem else
        "Pelos dados informados, não encontramos dados pessoais seus no sistema da ASAF. Se você acredita que a associação tem dados seus de outra "
        "forma (por exemplo, em papel), faça uma solicitação de acesso e a equipe confere."
    )
    a.respondido_em = agora
    a.status = RESPONDIDO
    a.resultado = ATENDIDO
    # o aviso vai no e-mail de recebimento, depois de gravado (um e-mail só, como em qualquer pedido: quem está de fora não distingue pelo tempo nem pelo número de
    # e-mails se a pessoa tem cadastro)
    a.resposta_enviada_por_email = None


def responder(db: Session, a: Atendimento, usuario: Usuario, resposta: str, agora: Optional[datetime] = None, *, resultado: Optional[str] = None,
              fundamento: Optional[str] = None) -> Atendimento:
    if a.status in (RESPONDIDO, ENCERRADO):
        raise HTTPException(status_code=400, detail=f"Este atendimento já está {a.status.lower()}.")
    texto = (resposta or "").strip()
    if len(texto) < TAMANHO_MINIMO_DA_RESPOSTA:
        raise HTTPException(status_code=400, detail=f"Escreva a resposta (pelo menos {TAMANHO_MINIMO_DA_RESPOSTA} letras).")
    _exigir_que_nao_seja_sobre_si(db, a, usuario)
    if a.tipo == TITULAR_LGPD:
        # v5.7f: dado pessoal só vai para quem provou ser o titular, e só pela área Minha conta (que exige o e-mail do pedido e o código enviado a ele)
        if a.identidade_validada_em is None:
            raise HTTPException(status_code=400, detail="Antes de responder, valide a identidade de quem fez o pedido. Se não for possível validar, encerre o pedido com o motivo.")
        if not a.email_contato:
            raise HTTPException(
                status_code=400,
                detail="Este pedido não tem e-mail, e a resposta com dado pessoal só é entregue pela área Minha conta, que pede o e-mail. Encerre o pedido com o motivo e peça que a pessoa refaça o pedido com e-mail.",
            )
        # v7.2a: o resultado de cada pedido fica registrado e, se não foi atendido por inteiro, o fundamento (a pessoa o lê na Minha conta)
        if resultado not in RESULTADOS_DA_RESPOSTA:
            raise HTTPException(status_code=400, detail="Diga o resultado do pedido: atendido, atendido em parte ou não atendido.")
        if resultado != ATENDIDO and fundamento not in FUNDAMENTOS:
            raise HTTPException(status_code=400, detail="Escolha o fundamento de não atender o pedido por inteiro.")
        a.resultado = resultado
        a.fundamento = fundamento if resultado != ATENDIDO else None
    a.resposta = texto
    a.respondido_em = agora or datetime.utcnow()
    a.id_usuario_resposta = usuario.id_usuario
    if a.id_responsavel is None:
        a.id_responsavel = usuario.id_usuario
    a.status = RESPONDIDO
    a.resposta_enviada_por_email = None
    if a.email_contato:
        try:
            if a.tipo == TITULAR_LGPD:
                notificacoes.enviar_email(
                    a.email_contato, assunto=f"Há uma resposta ao seu pedido - protocolo {a.protocolo}", corpo_texto=_texto_do_aviso_de_resposta_do_titular(db, a),
                )
            else:
                notificacoes.enviar_email(a.email_contato, assunto=f"Resposta ao seu pedido - protocolo {a.protocolo}", corpo_texto=_texto_do_email_de_resposta(a, texto))
            a.resposta_enviada_por_email = True
        except Exception:
            # a resposta já está registrada; o e-mail é conveniência (SMTP fora do ar ou não configurado): a tela avisa que a pessoa precisa ser avisada por outro meio
            a.resposta_enviada_por_email = False
    db.commit()
    db.refresh(a)
    return a


def validar_identidade(db: Session, a: Atendimento, usuario: Usuario, nota: str, agora: Optional[datetime] = None, *, por_representante: bool = False) -> Atendimento:
    """A equipe confere, por outro meio (documento, telefone do cadastro, presença), que quem pediu é o titular dos dados e registra o que conferiu. Só na solicitação do titular, só enquanto
    o pedido está aberto, uma vez. Faz commit."""
    if a.tipo != TITULAR_LGPD:
        raise HTTPException(status_code=400, detail="Só a solicitação do titular de dados pede validação de identidade.")
    if a.status in (RESPONDIDO, ENCERRADO):
        raise HTTPException(status_code=400, detail=f"Este atendimento já está {a.status.lower()}.")
    if a.identidade_validada_em is not None:
        raise HTTPException(status_code=400, detail="A identidade deste pedido já está validada.")
    _exigir_que_nao_seja_sobre_si(db, a, usuario)
    texto = " ".join((nota or "").split())
    if len(texto) < TAMANHO_MINIMO_DA_NOTA_DE_IDENTIDADE:
        raise HTTPException(status_code=400, detail=f"Escreva o que você conferiu para validar a identidade (pelo menos {TAMANHO_MINIMO_DA_NOTA_DE_IDENTIDADE} letras).")
    if len(texto) > LIMITE_DA_NOTA_DE_IDENTIDADE:
        raise HTTPException(status_code=400, detail=f"O que você conferiu está comprido demais (até {LIMITE_DA_NOTA_DE_IDENTIDADE} letras).")
    a.identidade_validacao = IDENTIDADE_MANUAL
    a.identidade_validada_em = agora or datetime.utcnow()
    a.id_usuario_validacao = usuario.id_usuario
    a.identidade_nota = texto
    # v7.2a: pai, mãe ou responsável legal pedindo pelo titular menor de idade (decisão de 2026-10-28: a equipe confere o documento do vínculo e registra que conferiu)
    a.por_representante = bool(por_representante)
    db.commit()
    db.refresh(a)
    return a


def cadastrar_voluntario(db: Session, a: Atendimento, usuario: Usuario) -> Pessoa:
    """O pedido de voluntariado vira uma pessoa no cadastro (sem precisar ser associada): é o passo antes do termo de adesão e da escala. Se o CPF já é de alguém do cadastro, liga a
    essa pessoa em vez de criar outra. Faz commit."""
    if a.tipo != VOLUNTARIO:
        raise HTTPException(status_code=400, detail="Só um pedido de voluntariado vira cadastro de voluntário.")
    if a.id_pessoa is not None:
        raise HTTPException(status_code=400, detail="Esta pessoa já está no cadastro.")
    pessoa = db.query(Pessoa).filter(Pessoa.cpf == a.cpf).first() if a.cpf else None
    if pessoa is not None and pessoa.data_nascimento is None and a.data_nascimento is not None:
        # a pessoa já estava no cadastro sem a data de nascimento: quem atende confirmou o pedido, e sem a data o termo de adesão a trataria como menor de idade
        pessoa.data_nascimento = a.data_nascimento
    if pessoa is None:
        pessoa = Pessoa(
            nome_completo=a.nome_completo, cpf=a.cpf, email_contato=a.email_contato, telefone_whatsapp=a.telefone_whatsapp, data_nascimento=a.data_nascimento,
        )
        db.add(pessoa)
        db.flush()
    a.id_pessoa = pessoa.id_pessoa
    db.commit()
    db.refresh(a)
    return pessoa


def _texto_do_email_de_recebimento(a: Atendimento) -> str:
    if a.tipo == TITULAR_LGPD and a.status == RESPONDIDO:
        # v7.2a: a confirmação simples respondida na hora (o mesmo e-mail único de recebimento, com o aviso de que a resposta já está pronta)
        return (
            f"Olá, {a.nome_completo.split()[0]}.\n\n"
            f"A Associação Arca da Família (ASAF) recebeu o seu pedido ({ROTULOS_DO_TIPO.get(a.tipo, a.tipo)}).\n\n"
            f"Protocolo: {a.protocolo}\n\n"
            "A resposta já está pronta. Ela não vai por e-mail: você a lê na área Minha conta do site, entrando com este e-mail e o código de 6 números que o site "
            "envia.\n\nGuarde este número: é com ele que falamos do seu pedido.\n\nASAF - Associação Arca da Família\n"
        )
    if a.tipo == TITULAR_LGPD:
        return (
            f"Olá, {a.nome_completo.split()[0]}.\n\n"
            f"A Associação Arca da Família (ASAF) recebeu o seu pedido ({ROTULOS_DO_TIPO.get(a.tipo, a.tipo)}).\n\n"
            f"Protocolo: {a.protocolo}\n"
            f"Prazo de resposta: {a.prazo_dias} dias (até {a.prazo_em.strftime('%d/%m/%Y')}).\n\n"
            "Antes de responder, a associação confere que quem pede é o titular dos dados. A resposta não vai por e-mail: quando ela estiver pronta, avisamos por aqui e você a lê na área "
            "Minha conta do site, entrando com este e-mail e o código de 6 números que o site envia.\n\n"
            "Guarde este número: é com ele que falamos do seu pedido.\n\nASAF - Associação Arca da Família\n"
        )
    return (
        f"Olá, {a.nome_completo.split()[0]}.\n\n"
        f"A Associação Arca da Família (ASAF) recebeu o seu pedido ({ROTULOS_DO_TIPO.get(a.tipo, a.tipo)}).\n\n"
        f"Protocolo: {a.protocolo}\n"
        f"Prazo de resposta: {a.prazo_dias} dias (até {a.prazo_em.strftime('%d/%m/%Y')}).\n\n"
        "Guarde este número: é com ele que falamos do seu pedido.\n\nASAF - Associação Arca da Família\n"
    )


def confirmar_recebimento_por_email(a: Atendimento) -> bool:
    """O e-mail que confirma o recebimento (protocolo e prazo), só quando a pessoa informou e-mail. Melhor esforço: nunca derruba o pedido, que já está gravado (SMTP fora do ar
    ou não configurado). Devolve se saiu."""
    if not a.email_contato:
        return False
    try:
        notificacoes.enviar_email(a.email_contato, assunto=f"Recebemos o seu pedido - protocolo {a.protocolo}", corpo_texto=_texto_do_email_de_recebimento(a))
        return True
    except Exception:
        return False


def encerrar(db: Session, a: Atendimento, usuario: Usuario, motivo: str, agora: Optional[datetime] = None) -> Atendimento:
    if a.status == ENCERRADO:
        raise HTTPException(status_code=400, detail="Este atendimento já está encerrado.")
    _exigir_que_nao_seja_sobre_si(db, a, usuario)
    texto = (motivo or "").strip()
    if len(texto) < TAMANHO_MINIMO_DO_MOTIVO:
        raise HTTPException(status_code=400, detail="Diga por que está encerrando (pelo menos 5 letras).")
    a.status = ENCERRADO
    a.motivo_encerramento = texto[:300]
    if a.tipo == TITULAR_LGPD and a.respondido_em is None:
        a.resultado = ENCERRADO_SEM_RESPOSTA
    a.encerrado_em = agora or datetime.utcnow()
    a.id_usuario_encerramento = usuario.id_usuario
    db.commit()
    db.refresh(a)
    if a.tipo == TITULAR_LGPD and a.respondido_em is None:
        # v5.7f: o pedido acabou sem resposta (por exemplo, sem a identidade validada): o motivo é escrito PARA a pessoa, que o lê na Minha conta, e o aviso por e-mail é tentativa que fica registrada
        # (`resposta_enviada_por_email`: a equipe vê se a pessoa não foi avisada). Quem já foi respondido não recebe aviso de encerramento: a resposta continua na Minha conta.
        a.motivo_visivel_ao_titular = True
        a.resposta_enviada_por_email = None
        if a.email_contato:
            try:
                notificacoes.enviar_email(
                    a.email_contato, assunto=f"Seu pedido foi encerrado - protocolo {a.protocolo}", corpo_texto=_texto_do_aviso_de_encerramento_do_titular(db, a),
                )
                a.resposta_enviada_por_email = True
            except Exception:
                a.resposta_enviada_por_email = False
        db.commit()
        db.refresh(a)
    return a


def avisar_prazos(db: Session, agora: Optional[datetime] = None) -> int:
    """O prazo acompanhado de verdade (rotina do sistema, a cada 15 minutos): para cada pedido ABERTO vencido ou que vence em até 3 dias, avisa no sino quem atende,
    no máximo uma vez por dia por pedido e por pessoa (a rotina roda várias vezes ao dia). Devolve quantos avisos criou. Faz commit."""
    agora = agora or datetime.utcnow()
    inicio_do_dia = datetime(agora.year, agora.month, agora.day)
    pedidos = db.query(Atendimento).filter(_abertos(), Atendimento.prazo_em <= agora + timedelta(days=DIAS_DE_AVISO_ANTES_DO_PRAZO)).order_by(Atendimento.prazo_em).all()
    destinatarios = usuarios_que_atendem(db)
    criados = 0
    for a in pedidos:
        if situacao_do_prazo(a, agora) == "vencido":
            situacao = f"vencido há {max(1, (agora - a.prazo_em).days)} dia(s)" if (agora - a.prazo_em).days >= 1 else "venceu hoje"
        else:
            dias = max(0, math.ceil((a.prazo_em - agora).total_seconds() / 86400))
            situacao = "vence hoje" if dias == 0 else f"vence em {dias} dia(s)"
        for id_usuario in destinatarios:
            ja_avisado = (
                db.query(NotificacaoPainel.id_notificacao)
                .filter(
                    NotificacaoPainel.id_usuario == id_usuario, NotificacaoPainel.tipo == "atendimento_prazo",
                    NotificacaoPainel.titulo.like(f"%{a.protocolo}%"), NotificacaoPainel.criado_em >= inicio_do_dia,
                )
                .first()
            )
            if ja_avisado:
                continue
            criados += notificar(
                db, [id_usuario], tipo="atendimento_prazo", titulo=f"Prazo do atendimento {a.protocolo}: {situacao}",
                texto=f"{ROTULOS_DO_TIPO.get(a.tipo, a.tipo)} de {a.nome_completo}. Responda ou encerre.", link="/atendimentos",
            )
    db.commit()
    return criados
