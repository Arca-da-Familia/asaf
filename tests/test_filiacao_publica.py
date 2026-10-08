"""v5.4h - o formulário público de filiação do site (`POST /api/filiacao/propor`): idade do Estatuto (Art. 12), aviso de privacidade com versão,
armadilha para robô, limite por IP e a mesma resposta para "já é sócio" e "já tem pedido" (ninguém de fora descobre se um CPF é de associado)."""
from datetime import date, timedelta

from app.models.core import AuditLog
from app.models.filiacao import PropostaFiliacao
from app.services.filiacao_publica import RECUSA_DE_DUPLICIDADE, VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO
from tests.apoio_auth import cabecalho_admin
from tests.apoio_filiacao import corpo_do_pedido, propor_pedido, tres_socios_propoem
from tests.test_pessoas import _cpf_unico


def _nascimento(anos: int, dias_a_mais: int = 0) -> str:
    """Quem faz `anos` anos hoje; com `dias_a_mais` positivo, quem ainda faltam esses dias para completar."""
    hoje = date.today()
    dia = 28 if (hoje.month == 2 and hoje.day == 29) else hoje.day
    return str(date(hoje.year - anos, hoje.month, dia) + timedelta(days=dias_a_mais))


def _pedido(client, **sobrescritas):
    sobrescritas.setdefault("cpf", _cpf_unico())
    sobrescritas.setdefault("nome_completo", f"Candidato Público {sobrescritas['cpf'][-6:]}")
    return propor_pedido(client, **sobrescritas)


def test_pedido_completo_e_gravado_com_a_ciencia_do_aviso_e_a_data_de_nascimento(client, db):
    resposta = _pedido(client, email_contato="candidato.publico@example.com", telefone_whatsapp="91988887777")
    assert resposta.status_code == 200, resposta.text
    proposta = db.get(PropostaFiliacao, resposta.json()["id_proposta"])
    assert proposta.consentimento_lgpd_versao == VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO
    assert proposta.consentimento_lgpd_em is not None
    assert proposta.autorizacao_responsavel_declarada is False
    assert proposta.data_nascimento is not None


def test_sem_aceitar_o_aviso_de_privacidade_o_pedido_e_recusado(client):
    resposta = _pedido(client, consentimento_lgpd=False)
    assert resposta.status_code == 400
    assert "aviso de privacidade" in resposta.json()["detail"]


def test_versao_antiga_do_aviso_pede_para_recarregar_a_pagina(client):
    resposta = _pedido(client, versao_texto_consentimento="0")
    assert resposta.status_code == 422
    assert "recarregue a página" in resposta.json()["detail"]
    assert _pedido(client, versao_texto_consentimento=None).status_code == 422


def test_data_de_nascimento_e_obrigatoria(client):
    corpo = corpo_do_pedido(cpf=_cpf_unico(), nome_completo="Sem Nascimento Teste")
    del corpo["data_nascimento"]
    resposta = client.post("/api/filiacao/propor", json=corpo, headers={"X-Forwarded-For": "198.51.100.9"})
    assert resposta.status_code == 422


def test_sem_e_mail_nem_telefone_o_pedido_e_recusado_e_com_um_dos_dois_passa(client):
    corpo = corpo_do_pedido(cpf=_cpf_unico(), nome_completo="Sem Contato Teste")
    del corpo["email_contato"]
    sem = client.post("/api/filiacao/propor", json=corpo, headers={"X-Forwarded-For": "198.51.100.11"})
    assert sem.status_code == 422 and "e-mail ou um telefone" in sem.text
    com = client.post("/api/filiacao/propor", json={**corpo, "email_contato": "so.email@example.com"}, headers={"X-Forwarded-For": "198.51.100.12"})
    assert com.status_code == 200, com.text


def test_menor_de_16_anos_nao_pode_se_filiar_nem_com_autorizacao(client):
    resposta = _pedido(client, data_nascimento=_nascimento(16, dias_a_mais=1), autorizacao_responsavel=True)
    assert resposta.status_code == 400
    assert "a partir dos 16 anos" in resposta.json()["detail"]


def test_de_16_a_17_anos_so_com_a_declaracao_da_autorizacao_dos_responsaveis(client, db):
    sem = _pedido(client, data_nascimento=_nascimento(16))
    assert sem.status_code == 400 and "autorização expressa dos pais ou responsáveis" in sem.json()["detail"]
    # falta um dia para fazer 18: ainda é menor
    quase_maior = _pedido(client, data_nascimento=_nascimento(18, dias_a_mais=1))
    assert quase_maior.status_code == 400
    com = _pedido(client, data_nascimento=_nascimento(17), autorizacao_responsavel=True)
    assert com.status_code == 200, com.text
    assert db.get(PropostaFiliacao, com.json()["id_proposta"]).autorizacao_responsavel_declarada is True


def test_maior_de_idade_entra_sem_precisar_de_autorizacao(client):
    assert _pedido(client, data_nascimento=_nascimento(18)).status_code == 200


def test_ja_ser_socio_e_ja_ter_pedido_recebem_exatamente_a_mesma_resposta(client, db):
    # quem de fora manda um CPF não descobre se ele é de associado ou só de um pedido em andamento
    cpf_pedido = _cpf_unico()
    assert _pedido(client, cpf=cpf_pedido).status_code == 200
    repetido = _pedido(client, cpf=cpf_pedido)

    cpf_socio = _cpf_unico()
    auth = cabecalho_admin(client)
    proposta = _pedido(client, cpf=cpf_socio, nome_completo="Futuro Associado Teste").json()
    client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/conferir", headers=auth)
    tres_socios_propoem(db, proposta["id_proposta"])
    aprovada = client.post(f"/api/filiacao/propostas/{proposta['id_proposta']}/aprovar", headers=auth, json={"categoria": "Efetivo"})
    assert aprovada.status_code == 200, aprovada.text
    ja_socio = _pedido(client, cpf=cpf_socio)

    assert repetido.status_code == ja_socio.status_code == 400
    assert repetido.json() == ja_socio.json() == {"detail": RECUSA_DE_DUPLICIDADE}


def test_robo_que_preenche_o_campo_escondido_recebe_sucesso_e_nada_e_gravado(client, db):
    cpf = _cpf_unico()
    resposta = _pedido(client, cpf=cpf, pagina_web="http://spam.example")
    assert resposta.status_code == 200
    assert resposta.json()["id_proposta"] is None
    db.expire_all()
    assert db.query(PropostaFiliacao).filter(PropostaFiliacao.cpf == cpf).count() == 0


def test_limite_de_pedidos_por_ip_e_por_hora_e_nao_afeta_outro_ip(client):
    ip = "203.0.113.77"
    for _ in range(10):
        assert _pedido(client, ip=ip).status_code == 200
    barrado = _pedido(client, ip=ip)
    assert barrado.status_code == 429
    assert "Muitas tentativas" in barrado.json()["detail"]
    assert _pedido(client, ip="203.0.113.78").status_code == 200


def test_o_pedido_publico_fica_na_auditoria_com_o_ip_e_sem_cpf(client, db):
    ip = "203.0.113.90"
    id_proposta = _pedido(client, ip=ip).json()["id_proposta"]
    db.expire_all()
    registro = (
        db.query(AuditLog)
        .filter(AuditLog.tabela_afetada == "propostas_filiacao", AuditLog.acao == "PROPOSTA_PUBLICA", AuditLog.id_registro_afetado == id_proposta)
        .one()
    )
    assert registro.ip_origem == ip
    assert registro.id_usuario is None
    assert registro.dados_depois is None


def test_a_diretoria_ve_a_idade_a_declaracao_dos_pais_e_o_aceite_do_aviso(client):
    auth = cabecalho_admin(client)
    cpf = _cpf_unico()
    id_proposta = _pedido(client, cpf=cpf, data_nascimento=_nascimento(17), autorizacao_responsavel=True).json()["id_proposta"]
    lista = client.get("/api/filiacao/propostas?status=Pendente", headers=auth).json()
    pedido = next(p for p in lista if p["id_proposta"] == id_proposta)
    assert pedido["idade"] == 17
    assert pedido["autorizacao_responsavel_declarada"] is True
    assert pedido["consentimento_lgpd_versao"] == VERSAO_AVISO_DE_PRIVACIDADE_FILIACAO
    assert pedido["consentimento_lgpd_em"] is not None


def test_e_mail_que_o_servidor_recusa_vem_com_a_mensagem_em_portugues(client):
    # "a..b@exemplo.com" passa na conferência simples do site e o servidor o recusa: a mensagem não pode vir em inglês
    resposta = _pedido(client, email_contato="a..b@exemplo.com")
    assert resposta.status_code == 422
    assert "Esse e-mail não parece certo" in resposta.text
    assert "valid email" not in resposta.text
    assert _pedido(client, email_contato="  Maria.Silva@Exemplo.COM ").status_code == 200
