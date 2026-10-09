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

from app.config_cache import obter_configuracao
from app.models.atendimento import (
    CONTATO, ENCERRADO, EM_ATENDIMENTO, NOVO, PEDIDO_INFORMACAO, RESPONDIDO, TITULAR_LGPD, VOLUNTARIO, Atendimento,
)
from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.models.notificacoes_painel import NotificacaoPainel
from app.models.pessoas import Pessoa
from app.services.voluntariado import pessoa_e_menor_de_idade
from app.services import notificacoes
from app.services.notificacoes_painel import notificar

# o texto do aviso de privacidade dos formulários de atendimento tem versão: o site manda a versão que mostrou e o servidor recusa se o texto mudou
VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO = "1"

PERMISSAO_DA_FILA = "atendimento"
LIMITE_DA_MENSAGEM = 4000
TAMANHO_MINIMO_DA_RESPOSTA = 10
TAMANHO_MINIMO_DO_MOTIVO = 5
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
    "ELIMINACAO": "Anonimizar, bloquear ou eliminar dados desnecessários ou tratados sem base legal",
    "PORTABILIDADE": "Receber meus dados para levar a outra entidade (portabilidade)",
    "COMPARTILHAMENTO": "Saber com quem a associação compartilhou meus dados",
    "REVOGACAO": "Retirar um consentimento que dei",
    "OUTRO": "Outro pedido sobre os meus dados pessoais",
}

# dias de prazo por tipo, usados se a regra não existir no banco (as regras ficam em Configurações > Regras do sistema e a diretoria muda)
CHAVES_DO_PRAZO = {
    CONTATO: "PRAZO_DIAS_ATENDIMENTO_CONTATO",
    PEDIDO_INFORMACAO: "PRAZO_DIAS_PEDIDO_INFORMACAO",
    TITULAR_LGPD: "PRAZO_DIAS_TITULAR_LGPD",
    VOLUNTARIO: "PRAZO_DIAS_ATENDIMENTO_VOLUNTARIO",
}
PRAZO_PADRAO_EM_DIAS = {CONTATO: 10, PEDIDO_INFORMACAO: 20, TITULAR_LGPD: 15, VOLUNTARIO: 10}


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
    return dias if dias >= 1 else padrao


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
    """A pessoa do cadastro (a mesma deduplicação dos demais formulários): pelo CPF; sem CPF, pelo e-mail, mas só se for UMA pessoa (e-mail repetido não adivinha)."""
    if cpf:
        pessoa = db.query(Pessoa).filter(Pessoa.cpf == _so_digitos(cpf)).first()
        return pessoa.id_pessoa if pessoa else None
    if email:
        achadas = db.query(Pessoa.id_pessoa).filter(func.lower(Pessoa.email_contato) == email.strip().lower()).limit(2).all()
        return achadas[0][0] if len(achadas) == 1 else None
    return None


def usuarios_que_atendem(db: Session) -> list[int]:
    """Quem tem a permissão da fila (pelo nível de acesso)."""
    linhas = (
        db.query(Usuario.id_usuario)
        .join(NivelAcesso, NivelAcesso.id_nivel == Usuario.id_nivel)
        .join(perfil_permissao, perfil_permissao.c.id_nivel == NivelAcesso.id_nivel)
        .join(PermissaoSistema, PermissaoSistema.id_permissao == perfil_permissao.c.id_permissao)
        .filter(PermissaoSistema.codigo_permissao == PERMISSAO_DA_FILA, Usuario.ativo.is_(True))
        .all()
    )
    return sorted({linha[0] for linha in linhas})


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


def registrar_pelo_site(
    db: Session, *, tipo: str, subtipo: Optional[str], assunto: Optional[str], mensagem: str, nome_completo: str, email: Optional[str],
    telefone: Optional[str], cpf: Optional[str], versao_do_aviso: str, data_nascimento: Optional[date] = None, agora: Optional[datetime] = None,
) -> tuple[Atendimento, bool]:
    """Grava o pedido, dá o protocolo, calcula o prazo e avisa quem atende. Devolve (atendimento, novo): o mesmo pedido ainda aberto, mandado de novo em 24 horas
    (duplo clique, ou a pessoa que não viu a confirmação), devolve o mesmo protocolo e `novo=False`, sem avisar ninguém de novo. Faz commit."""
    agora = agora or datetime.utcnow()
    chave = chave_do_remetente(cpf, email, telefone)
    impressao = _impressao(tipo, subtipo, chave, assunto, mensagem)
    repetido = (
        db.query(Atendimento)
        .filter(
            Atendimento.impressao_do_pedido == impressao, Atendimento.status.in_([NOVO, EM_ATENDIMENTO]),
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
        data_nascimento=datetime.combine(data_nascimento, datetime.min.time()) if data_nascimento else None, id_pessoa=_pessoa_do_remetente(db, cpf, email), chave_remetente=chave, impressao_do_pedido=impressao, origem="site",
        consentimento_lgpd_em=agora, consentimento_lgpd_versao=versao_do_aviso, status=NOVO, prazo_dias=dias, prazo_em=agora + timedelta(days=dias),
        id_responsavel=responsavel_padrao(db), criado_em=agora,
    )
    db.add(atendimento)
    db.flush()
    atendimento.protocolo = f"ASAF-{agora.year}-{atendimento.id_atendimento:05d}"
    notificar(
        db, usuarios_que_atendem(db), tipo="atendimento_novo", titulo=f"Novo atendimento {atendimento.protocolo}",
        texto=f"{ROTULOS_DO_TIPO[tipo]} de {nome_completo}. Prazo: {dias} dias.", link="/atendimentos",
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


def serializar(a: Atendimento, agora: Optional[datetime] = None, *, completo: bool = False) -> dict:
    agora = agora or datetime.utcnow()
    dados = {
        "id_atendimento": a.id_atendimento, "protocolo": a.protocolo, "tipo": a.tipo, "tipo_rotulo": ROTULOS_DO_TIPO.get(a.tipo, a.tipo),
        "subtipo": a.subtipo, "subtipo_rotulo": ROTULOS_DO_SUBTIPO_LGPD.get(a.subtipo or ""), "assunto": a.assunto, "mensagem": a.mensagem,
        "nome_completo": a.nome_completo, "email_contato": a.email_contato, "telefone_whatsapp": a.telefone_whatsapp,
        "cpf_mascarado": _cpf_mascarado(a.cpf), "id_pessoa": a.id_pessoa, "status": a.status, "prazo_dias": a.prazo_dias, "prazo_em": a.prazo_em,
        "situacao_do_prazo": situacao_do_prazo(a, agora), "dias_restantes": math.ceil((a.prazo_em - agora).total_seconds() / 86400),
        "id_responsavel": a.id_responsavel, "assumido_em": a.assumido_em, "resposta": a.resposta, "respondido_em": a.respondido_em,
        "resposta_enviada_por_email": a.resposta_enviada_por_email, "motivo_encerramento": a.motivo_encerramento, "encerrado_em": a.encerrado_em,
        "criado_em": a.criado_em, "consentimento_lgpd_versao": a.consentimento_lgpd_versao,
        "data_nascimento": a.data_nascimento.date().isoformat() if a.data_nascimento else None,
        "idade": _idade(a.data_nascimento, agora), "menor_de_idade": pessoa_e_menor_de_idade(a.data_nascimento.date(), agora.date()) if a.data_nascimento else None,
    }
    if completo:
        # o CPF inteiro só na abertura do pedido (a solicitação de titular precisa dele para conferir quem pede)
        dados["cpf"] = a.cpf
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
    a.id_responsavel = usuario.id_usuario
    a.assumido_em = agora or datetime.utcnow()
    a.status = EM_ATENDIMENTO
    db.commit()
    db.refresh(a)
    return a


def _texto_do_email_de_resposta(a: Atendimento, resposta: str) -> str:
    return (
        f"Olá, {a.nome_completo.split()[0]}.\n\n"
        f"Esta é a resposta da Associação Arca da Família (ASAF) ao seu pedido, protocolo {a.protocolo}:\n\n{resposta}\n\n"
        "Se ainda tiver dúvida, responda a este e-mail citando o protocolo.\n\nASAF - Associação Arca da Família\n"
    )


def responder(db: Session, a: Atendimento, usuario: Usuario, resposta: str, agora: Optional[datetime] = None) -> Atendimento:
    if a.status in (RESPONDIDO, ENCERRADO):
        raise HTTPException(status_code=400, detail=f"Este atendimento já está {a.status.lower()}.")
    texto = (resposta or "").strip()
    if len(texto) < TAMANHO_MINIMO_DA_RESPOSTA:
        raise HTTPException(status_code=400, detail=f"Escreva a resposta (pelo menos {TAMANHO_MINIMO_DA_RESPOSTA} letras).")
    a.resposta = texto
    a.respondido_em = agora or datetime.utcnow()
    a.id_usuario_resposta = usuario.id_usuario
    if a.id_responsavel is None:
        a.id_responsavel = usuario.id_usuario
    a.status = RESPONDIDO
    a.resposta_enviada_por_email = None
    if a.email_contato:
        try:
            notificacoes.enviar_email(a.email_contato, assunto=f"Resposta ao seu pedido - protocolo {a.protocolo}", corpo_texto=_texto_do_email_de_resposta(a, texto))
            a.resposta_enviada_por_email = True
        except Exception:
            # a resposta já está registrada; o e-mail é conveniência (SMTP fora do ar ou não configurado): a tela avisa que a pessoa precisa ser avisada por outro meio
            a.resposta_enviada_por_email = False
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
    texto = (motivo or "").strip()
    if len(texto) < TAMANHO_MINIMO_DO_MOTIVO:
        raise HTTPException(status_code=400, detail="Diga por que está encerrando (pelo menos 5 letras).")
    a.status = ENCERRADO
    a.motivo_encerramento = texto[:300]
    a.encerrado_em = agora or datetime.utcnow()
    a.id_usuario_encerramento = usuario.id_usuario
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
