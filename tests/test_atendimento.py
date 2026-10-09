"""v5.5a - a fila única de atendimento: o formulário público do site (contato, pedido de informação, solicitação de titular de dados da LGPD) e a fila do painel.

As promessas que estes testes travam:
  1. cada pedido ganha protocolo e prazo (os dias vêm das regras do sistema, por tipo) e quem está de fora só recebe isso de volta, igual para pedido novo e repetido;
  2. o mesmo pedido mandado duas vezes (duplo clique) é UM protocolo e UM aviso; armadilha de robô, aviso de privacidade com versão e limite por IP valem;
  3. a solicitação de titular exige o CPF e o direito pedido; o remetente é ligado ao cadastro sem que isso apareça para quem está de fora;
  4. só quem tem a permissão da fila a vê (401 sem login, 403 sem a permissão); quem atende é avisado no sino;
  5. responder e encerrar exigem texto, registram quem fez e quando, e ficam na Auditoria; o prazo é acompanhado (vencido, vence logo, cumprido)."""
import uuid
from datetime import datetime, timedelta

import pytest

from app.models.atendimento import Atendimento
from app.models.core import AuditLog
from app.services import atendimento as servico
from tests.apoio_auth import cabecalho_admin
from tests.test_documentos_institucionais import _usuario
from tests.test_pessoas import _cpf_unico


def _cpf_valido() -> str:
    """Um CPF com os dígitos verificadores certos (o formulário público confere)."""
    base = [int(c) for c in str(uuid.uuid4().int)[:9]]
    for _ in range(2):
        soma = sum(d * p for d, p in zip(base, range(len(base) + 1, 1, -1)))
        base.append((soma * 10 % 11) % 10)
    return "".join(str(d) for d in base)


def _ip() -> str:
    return f"203.0.113.{uuid.uuid4().int % 250 + 1}"


def _corpo(tipo="CONTATO", **sobrescritas) -> dict:
    corpo = {
        "tipo": tipo, "assunto": f"Assunto {uuid.uuid4().hex[:8]}", "mensagem": f"Mensagem de teste {uuid.uuid4().hex[:12]} para a associação.",
        "nome_completo": "Pessoa de Fora", "email_contato": f"fora.{uuid.uuid4().hex[:10]}@example.com",
        "consentimento_lgpd": True, "versao_texto_consentimento": servico.VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO,
    }
    if tipo == "TITULAR_LGPD":
        corpo.pop("assunto")
        corpo.update(subtipo="ACESSO", cpf=_cpf_valido())
    corpo.update(sobrescritas)
    return corpo


def _enviar(client, tipo="CONTATO", ip=None, **sobrescritas):
    return client.post("/api/publico/atendimentos", json=_corpo(tipo, **sobrescritas), headers={"X-Forwarded-For": ip or _ip()})


def _fila(client, headers, **params):
    r = client.get("/api/atendimentos/", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------------------------------ o formulário público
def test_pedido_de_contato_recebe_protocolo_e_prazo_e_nada_mais(client, db):
    r = _enviar(client)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert set(corpo) == {"mensagem", "protocolo", "prazo_dias", "prazo_em"}
    assert corpo["protocolo"] == f"ASAF-{datetime.utcnow().year}-{int(corpo['protocolo'].rsplit('-', 1)[1]):05d}"
    assert corpo["prazo_dias"] == 10
    gravado = db.query(Atendimento).filter(Atendimento.protocolo == corpo["protocolo"]).one()
    assert gravado.status == "Novo" and gravado.tipo == "CONTATO" and gravado.origem == "site"
    assert gravado.consentimento_lgpd_versao == servico.VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO and gravado.consentimento_lgpd_em is not None
    assert gravado.prazo_em - gravado.criado_em == timedelta(days=10)


def test_cada_tipo_tem_o_seu_prazo_e_a_rota_dos_prazos_e_publica(client):
    prazos = client.get("/api/publico/atendimentos/prazos")
    assert prazos.status_code == 200
    assert prazos.json() == {"CONTATO": 10, "PEDIDO_INFORMACAO": 20, "TITULAR_LGPD": 15, "VOLUNTARIO": 10}
    assert _enviar(client, "PEDIDO_INFORMACAO").json()["prazo_dias"] == 20
    assert _enviar(client, "TITULAR_LGPD").json()["prazo_dias"] == 15


def test_a_diretoria_muda_o_prazo_nas_regras_do_sistema_e_o_pedido_novo_usa_o_novo_valor(client, auth_headers):
    try:
        r = client.put("/api/configuracoes/PRAZO_DIAS_PEDIDO_INFORMACAO", json={"valor": "7"}, headers=auth_headers)
        assert r.status_code == 200, r.text
        assert client.get("/api/publico/atendimentos/prazos").json()["PEDIDO_INFORMACAO"] == 7
        assert _enviar(client, "PEDIDO_INFORMACAO").json()["prazo_dias"] == 7
    finally:
        client.put("/api/configuracoes/PRAZO_DIAS_PEDIDO_INFORMACAO", json={"valor": "20"}, headers=auth_headers)
    assert client.get("/api/publico/atendimentos/prazos").json()["PEDIDO_INFORMACAO"] == 20


def test_prazo_com_valor_estragado_cai_no_padrao_e_nunca_em_zero(db):
    from app.models.core import ConfiguracaoInstitucional
    from app.config_cache import invalidar_cache_configuracao

    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "PRAZO_DIAS_ATENDIMENTO_CONTATO").one()
    original = config.valor_configuracao
    try:
        for ruim in ("", "abc", "0", "-3"):
            config.valor_configuracao = ruim
            db.commit()
            invalidar_cache_configuracao("PRAZO_DIAS_ATENDIMENTO_CONTATO")
            assert servico.prazo_em_dias(db, "CONTATO") == 10, ruim
    finally:
        config.valor_configuracao = original
        db.commit()
        invalidar_cache_configuracao("PRAZO_DIAS_ATENDIMENTO_CONTATO")


def test_sem_aceitar_o_aviso_de_privacidade_ou_com_versao_velha_o_pedido_e_recusado(client):
    sem = _enviar(client, consentimento_lgpd=False)
    assert sem.status_code == 400 and "aviso de privacidade" in sem.json()["detail"]
    velha = _enviar(client, versao_texto_consentimento="0")
    assert velha.status_code == 422 and "atualizado" in velha.json()["detail"]


def test_armadilha_de_robo_finge_sucesso_e_nao_grava(client, db):
    antes = db.query(Atendimento).count()
    r = _enviar(client, pagina_web="http://spam.example")
    assert r.status_code == 200 and r.json()["protocolo"] is None
    assert db.query(Atendimento).count() == antes


@pytest.mark.parametrize(
    "alteracao, trecho",
    [
        ({"email_contato": None, "telefone_whatsapp": None}, "e-mail ou um telefone"),
        ({"email_contato": "sem-arroba"}, "e-mail não parece certo"),
        ({"telefone_whatsapp": "123"}, "Telefone inválido"),
        ({"mensagem": "curta"}, "pelo menos 10"),
        ({"nome_completo": "Zé"}, "Informe o seu nome"),
        ({"assunto": None}, "Informe o assunto"),
        ({"tipo": "MALUCO"}, "tipo"),
    ],
)
def test_contato_recusa_o_que_esta_errado_em_portugues(client, alteracao, trecho):
    r = _enviar(client, **alteracao)
    assert r.status_code == 422, r.text
    assert trecho.lower() in r.text.lower(), r.text


@pytest.mark.parametrize(
    "alteracao, trecho",
    [
        ({"cpf": None}, "Informe o seu CPF"),
        ({"cpf": "11111111111"}, "CPF inválido"),
        ({"subtipo": None}, "o que você quer pedir"),
        ({"subtipo": "INVENTADO"}, "o que você quer pedir"),
    ],
)
def test_solicitacao_de_titular_exige_o_cpf_valido_e_o_direito_pedido(client, alteracao, trecho):
    r = _enviar(client, "TITULAR_LGPD", **alteracao)
    assert r.status_code == 422, r.text
    assert trecho.lower() in r.text.lower(), r.text


def test_o_mesmo_pedido_mandado_duas_vezes_e_um_protocolo_so_e_um_aviso_so(client, db, auth_headers):
    corpo = _corpo()
    ip = _ip()
    a = client.post("/api/publico/atendimentos", json=corpo, headers={"X-Forwarded-For": ip})
    b = client.post("/api/publico/atendimentos", json=corpo, headers={"X-Forwarded-For": ip})
    assert a.status_code == b.status_code == 200
    assert a.json()["protocolo"] == b.json()["protocolo"]
    assert db.query(Atendimento).filter(Atendimento.protocolo == a.json()["protocolo"]).count() == 1
    id_atendimento = db.query(Atendimento).filter(Atendimento.protocolo == a.json()["protocolo"]).one().id_atendimento
    assert db.query(AuditLog).filter(AuditLog.acao == "ATENDIMENTO_PUBLICO", AuditLog.id_registro_afetado == id_atendimento).count() == 1
    # outra pessoa mandando a mesma frase NÃO é o mesmo pedido
    c = _enviar(client, mensagem=corpo["mensagem"], assunto=corpo["assunto"])
    assert c.json()["protocolo"] != a.json()["protocolo"]


def test_depois_de_respondido_o_mesmo_texto_vira_um_pedido_novo(client, auth_headers):
    corpo = _corpo()
    primeiro = client.post("/api/publico/atendimentos", json=corpo, headers={"X-Forwarded-For": _ip()}).json()
    achado = [a for a in _fila(client, auth_headers, busca=primeiro["protocolo"])["itens"]][0]
    assert client.post(f"/api/atendimentos/{achado['id_atendimento']}/responder", json={"resposta": "Respondido, obrigado pela mensagem."}, headers=auth_headers).status_code == 200
    segundo = client.post("/api/publico/atendimentos", json=corpo, headers={"X-Forwarded-For": _ip()}).json()
    assert segundo["protocolo"] != primeiro["protocolo"]


def test_o_limite_por_ip_barra_o_excesso_e_nao_afeta_outro_ip(client):
    ip = _ip()
    for _ in range(10):
        assert _enviar(client, ip=ip).status_code == 200
    barrado = _enviar(client, ip=ip)
    assert barrado.status_code == 429 and "Muitas tentativas" in barrado.json()["detail"]
    assert _enviar(client, ip=_ip()).status_code == 200


def test_o_remetente_e_ligado_ao_cadastro_pelo_cpf_sem_aparecer_para_quem_esta_de_fora(client, db, auth_headers):
    from app.models.pessoas import Pessoa

    cpf = _cpf_valido()
    pessoa = Pessoa(nome_completo="Sócio Cadastrado", cpf=cpf)
    db.add(pessoa)
    db.commit()
    db.refresh(pessoa)
    r = _enviar(client, "TITULAR_LGPD", cpf=cpf)
    assert r.status_code == 200 and "id_pessoa" not in r.text and "cadastr" not in r.text.lower()
    abrir = client.get(f"/api/atendimentos/{db.query(Atendimento).filter(Atendimento.protocolo == r.json()['protocolo']).one().id_atendimento}", headers=auth_headers).json()
    assert abrir["id_pessoa"] == pessoa.id_pessoa and abrir["cpf"] == cpf
    # quem não está no cadastro fica sem ligação
    sem = _enviar(client, "TITULAR_LGPD").json()["protocolo"]
    assert db.query(Atendimento).filter(Atendimento.protocolo == sem).one().id_pessoa is None


def test_e_mail_repetido_em_duas_pessoas_nao_adivinha_quem_e(client, db):
    from app.models.pessoas import Pessoa

    email = f"repetido.{uuid.uuid4().hex[:8]}@example.com"
    for nome in ("Primeira Pessoa", "Segunda Pessoa"):
        db.add(Pessoa(nome_completo=nome, email_contato=email))
    db.commit()
    protocolo = _enviar(client, email_contato=email).json()["protocolo"]
    assert db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one().id_pessoa is None


# ------------------------------------------------------------------------------------------ a fila no painel
def test_a_fila_pede_login_e_a_permissao_propria(client, db):
    ids = [client.get(rota) for rota in ("/api/atendimentos/", "/api/atendimentos/resumo", "/api/atendimentos/1")]
    assert [r.status_code for r in ids] == [401, 401, 401]
    for rota, metodo in (("/api/atendimentos/1/assumir", "post"), ("/api/atendimentos/1/responder", "post"), ("/api/atendimentos/1/encerrar", "post")):
        assert getattr(client, metodo)(rota, json={"resposta": "x" * 20, "motivo": "x" * 10}).status_code == 401
    sem_permissao = _usuario(db, "associados", "financeiro")
    assert client.get("/api/atendimentos/", headers=sem_permissao).status_code == 403
    assert client.get("/api/atendimentos/resumo", headers=sem_permissao).status_code == 403
    com_permissao = _usuario(db, "atendimento")
    assert client.get("/api/atendimentos/", headers=com_permissao).status_code == 200


def test_a_permissao_da_fila_vem_com_o_presidente_e_a_diretoria(db):
    from app.models.core import NivelAcesso, PermissaoSistema, perfil_permissao

    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "atendimento").one()
    niveis = {
        n.nome_nivel
        for n in db.query(NivelAcesso).join(perfil_permissao, perfil_permissao.c.id_nivel == NivelAcesso.id_nivel).filter(perfil_permissao.c.id_permissao == permissao.id_permissao)
    }
    assert {"Presidente", "Diretoria"} <= niveis
    assert "Conselho Fiscal" not in niveis and "Associado" not in niveis


def test_quem_atende_e_avisado_no_sino_e_quem_nao_atende_nao(client, db, auth_headers):
    protocolo = _enviar(client).json()["protocolo"]
    avisos = client.get("/api/minhas-notificacoes/", headers=auth_headers).json()["avisos"]
    assert any(a["tipo"] == "atendimento_novo" and protocolo in a["titulo"] and a["link"] == "/atendimentos" for a in avisos)
    sem_permissao = _usuario(db, "associados")
    assert all(protocolo not in a["titulo"] for a in client.get("/api/minhas-notificacoes/", headers=sem_permissao).json()["avisos"])


def test_a_fila_lista_filtra_busca_e_mostra_o_prazo(client, db, auth_headers):
    marca = uuid.uuid4().hex[:10]
    contato = _enviar(client, assunto=f"Zeta {marca}").json()["protocolo"]
    pedido = _enviar(client, "PEDIDO_INFORMACAO", assunto=f"Zeta {marca}").json()["protocolo"]
    titular = _enviar(client, "TITULAR_LGPD", mensagem=f"Quero ver os meus dados {marca}").json()["protocolo"]

    todos = _fila(client, auth_headers, busca=marca)
    assert todos["total"] == 3 and {i["protocolo"] for i in todos["itens"]} == {contato, pedido, titular}
    só_pedidos = _fila(client, auth_headers, busca=marca, tipo="PEDIDO_INFORMACAO")
    assert [i["protocolo"] for i in só_pedidos["itens"]] == [pedido]
    item = só_pedidos["itens"][0]
    assert item["tipo_rotulo"] == "Pedido de informação sobre recursos públicos" and item["prazo_dias"] == 20
    assert item["situacao_do_prazo"] == "no_prazo" and item["dias_restantes"] in (19, 20) and item["cpf_mascarado"] is None
    # o CPF aparece mascarado na lista
    cpf_titular = db.query(Atendimento).filter(Atendimento.protocolo == titular).one().cpf
    lista_titular = _fila(client, auth_headers, busca=marca, tipo="TITULAR_LGPD")["itens"][0]
    assert lista_titular["cpf_mascarado"] == f"***.***.***-{cpf_titular[-2:]}" and "cpf" not in lista_titular
    assert lista_titular["subtipo_rotulo"] == servico.ROTULOS_DO_SUBTIPO_LGPD["ACESSO"]
    # paginação
    pagina1 = _fila(client, auth_headers, busca=marca, por_pagina=2, pagina=1)
    pagina2 = _fila(client, auth_headers, busca=marca, por_pagina=2, pagina=2)
    assert pagina1["total"] == 3 and len(pagina1["itens"]) == 2 and len(pagina2["itens"]) == 1
    assert client.get("/api/atendimentos/", params={"tipo": "NADA"}, headers=auth_headers).status_code == 400
    assert client.get("/api/atendimentos/", params={"situacao": "Inventada"}, headers=auth_headers).status_code == 400
    assert client.get("/api/atendimentos/999999", headers=auth_headers).status_code == 404


def test_busca_com_letras_e_numeros_nao_vira_busca_por_digitos_no_cpf(client, db, auth_headers):
    cpf = _cpf_valido()
    protocolo = _enviar(client, "TITULAR_LGPD", cpf=cpf).json()["protocolo"]
    assert _fila(client, auth_headers, busca=f"zzqx {cpf[3:8]}")["total"] == 0
    assert protocolo in [i["protocolo"] for i in _fila(client, auth_headers, busca=cpf)["itens"]]
    formatado = f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"
    assert protocolo in [i["protocolo"] for i in _fila(client, auth_headers, busca=formatado)["itens"]]


def test_os_outros_pedidos_da_mesma_pessoa_aparecem_juntos(client, db, auth_headers):
    cpf = _cpf_valido()
    a = _enviar(client, "TITULAR_LGPD", cpf=cpf).json()["protocolo"]
    b = _enviar(client, "TITULAR_LGPD", cpf=cpf, subtipo="CORRECAO").json()["protocolo"]
    id_a = db.query(Atendimento).filter(Atendimento.protocolo == a).one().id_atendimento
    abrir = client.get(f"/api/atendimentos/{id_a}", headers=auth_headers).json()
    assert [o["protocolo"] for o in abrir["outros_do_remetente"]] == [b]


def test_assumir_responder_e_encerrar_registram_quem_fez_e_ficam_na_auditoria(client, db, auth_headers):
    protocolo = _enviar(client, email_contato=f"quem.pediu.{uuid.uuid4().hex[:6]}@example.com").json()["protocolo"]
    atendimento = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    id_atendimento = atendimento.id_atendimento
    url = f"/api/atendimentos/{id_atendimento}"

    assumido = client.post(f"{url}/assumir", headers=auth_headers)
    assert assumido.status_code == 200 and assumido.json()["status"] == "Em atendimento" and assumido.json()["assumido_em"]

    curta = client.post(f"{url}/responder", json={"resposta": "ok"}, headers=auth_headers)
    assert curta.status_code == 400 and "pelo menos 10" in curta.json()["detail"]
    respondido = client.post(f"{url}/responder", json={"resposta": "Obrigado pelo contato: já resolvemos o seu caso."}, headers=auth_headers)
    assert respondido.status_code == 200, respondido.text
    corpo = respondido.json()
    assert corpo["status"] == "Respondido" and corpo["situacao_do_prazo"] == "cumprido" and corpo["respondido_em"]
    # o e-mail não está configurado no teste: a resposta fica registrada e a tela é avisada de que a pessoa precisa ser avisada por outro meio
    assert corpo["resposta_enviada_por_email"] is False
    # nada de responder nem assumir de novo
    assert client.post(f"{url}/responder", json={"resposta": "Outra resposta qualquer aqui."}, headers=auth_headers).status_code == 400
    assert client.post(f"{url}/assumir", headers=auth_headers).status_code == 400

    sem_motivo = client.post(f"{url}/encerrar", json={"motivo": "ok"}, headers=auth_headers)
    assert sem_motivo.status_code == 400
    encerrado = client.post(f"{url}/encerrar", json={"motivo": "Assunto resolvido por telefone."}, headers=auth_headers)
    assert encerrado.status_code == 200 and encerrado.json()["status"] == "Encerrado" and encerrado.json()["motivo_encerramento"]
    assert client.post(f"{url}/encerrar", json={"motivo": "Assunto resolvido por telefone."}, headers=auth_headers).status_code == 400

    acoes = [a.acao for a in db.query(AuditLog).filter(AuditLog.tabela_afetada == "atendimentos", AuditLog.id_registro_afetado == id_atendimento).order_by(AuditLog.id_log)]
    assert acoes == ["ATENDIMENTO_PUBLICO", "ATENDIMENTO_ASSUMIDO", "ATENDIMENTO_RESPONDIDO", "ATENDIMENTO_ENCERRADO"]


def test_responder_sem_e_mail_nao_diz_que_falhou_o_envio(client, db, auth_headers):
    protocolo = _enviar(client, email_contato=None, telefone_whatsapp="91988887777").json()["protocolo"]
    id_atendimento = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one().id_atendimento
    r = client.post(f"/api/atendimentos/{id_atendimento}/responder", json={"resposta": "Ligamos para você e combinamos tudo."}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["resposta_enviada_por_email"] is None


def test_a_resposta_sai_por_e_mail_quando_o_envio_funciona(client, db, auth_headers, monkeypatch):
    enviados = []
    monkeypatch.setattr(servico.notificacoes, "enviar_email", lambda destino, assunto, corpo_texto: enviados.append((destino, assunto, corpo_texto)))
    email = f"recebe.{uuid.uuid4().hex[:6]}@example.com"
    protocolo = _enviar(client, email_contato=email).json()["protocolo"]
    id_atendimento = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one().id_atendimento
    r = client.post(f"/api/atendimentos/{id_atendimento}/responder", json={"resposta": "Segue a nossa resposta completa ao seu pedido."}, headers=auth_headers)
    assert r.json()["resposta_enviada_por_email"] is True
    # o primeiro e-mail é a confirmação do recebimento; o segundo, a resposta
    assert [e[1].split(" - ")[0] for e in enviados] == ["Recebemos o seu pedido", "Resposta ao seu pedido"]
    resposta = enviados[1]
    assert resposta[0] == email and protocolo in resposta[1] and "Segue a nossa resposta completa" in resposta[2]


def test_o_prazo_e_acompanhado_vencido_vence_logo_e_cumprido_com_atraso(client, db, auth_headers):
    def novo():
        protocolo = _enviar(client).json()["protocolo"]
        return db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()

    agora = datetime.utcnow()
    no_prazo, vence_logo, vencido, atrasado = novo(), novo(), novo(), novo()
    vence_logo.prazo_em = agora + timedelta(days=2)
    vencido.prazo_em = agora - timedelta(days=1)
    atrasado.prazo_em = agora - timedelta(days=2)
    db.commit()
    assert [servico.situacao_do_prazo(a, agora) for a in (no_prazo, vence_logo, vencido)] == ["no_prazo", "vence_logo", "vencido"]

    resumo_antes = client.get("/api/atendimentos/resumo", headers=auth_headers).json()
    vencidos = _fila(client, auth_headers, vencidos="true")
    assert vencido.protocolo in [i["protocolo"] for i in vencidos["itens"]] and no_prazo.protocolo not in [i["protocolo"] for i in vencidos["itens"]]
    assert resumo_antes["vencidos"] >= 2 and resumo_antes["vencem_em_3_dias"] >= 1 and resumo_antes["abertos"] >= 4
    assert set(resumo_antes["por_tipo"]) == {"CONTATO", "PEDIDO_INFORMACAO", "TITULAR_LGPD", "VOLUNTARIO"}

    # respondido depois do prazo = cumprido com atraso (fica registrado que atrasou)
    r = client.post(f"/api/atendimentos/{atrasado.id_atendimento}/responder", json={"resposta": "Desculpe a demora, aqui está a resposta."}, headers=auth_headers)
    assert r.json()["situacao_do_prazo"] == "cumprido_com_atraso"
    resumo_depois = client.get("/api/atendimentos/resumo", headers=auth_headers).json()
    assert resumo_depois["vencidos"] == resumo_antes["vencidos"] - 1


def test_a_lista_traz_os_abertos_primeiro_e_o_prazo_mais_perto_em_cima(client, db, auth_headers):
    marca = uuid.uuid4().hex[:10]
    protocolos = {nome: _enviar(client, assunto=f"Ordem {marca} {nome}").json()["protocolo"] for nome in ("longe", "perto", "respondido")}
    por_protocolo = {nome: db.query(Atendimento).filter(Atendimento.protocolo == p).one() for nome, p in protocolos.items()}
    agora = datetime.utcnow()
    por_protocolo["perto"].prazo_em = agora + timedelta(days=1)
    por_protocolo["longe"].prazo_em = agora + timedelta(days=9)
    por_protocolo["respondido"].prazo_em = agora + timedelta(hours=1)
    db.commit()
    assert client.post(f"/api/atendimentos/{por_protocolo['respondido'].id_atendimento}/responder", json={"resposta": "Resposta dada ao pedido de teste."}, headers=auth_headers).status_code == 200
    ordem = [i["protocolo"] for i in _fila(client, auth_headers, busca=marca)["itens"]]
    assert ordem == [protocolos["perto"], protocolos["longe"], protocolos["respondido"]]
    abertos = _fila(client, auth_headers, busca=marca, situacao="abertos")
    assert abertos["total"] == 2


def test_o_pedido_gravado_tem_o_remetente_agrupado_por_cpf_depois_e_mail_depois_telefone(db):
    assert servico.chave_do_remetente("123.456.789-09", "a@b.com", "9199") == "cpf:12345678909"
    assert servico.chave_do_remetente(None, " A@B.com ", "9199") == "email:a@b.com"
    assert servico.chave_do_remetente(None, None, "(91) 98888-7777") == "tel:91988887777"
    assert servico.chave_do_remetente(None, None, None) is None


def test_a_rotina_avisa_no_sino_os_pedidos_vencidos_ou_perto_de_vencer_uma_vez_por_dia(client, db, auth_headers):
    from app.models.notificacoes_painel import NotificacaoPainel

    protocolo_vencido = _enviar(client).json()["protocolo"]
    protocolo_perto = _enviar(client).json()["protocolo"]
    protocolo_longe = _enviar(client).json()["protocolo"]
    protocolo_respondido = _enviar(client).json()["protocolo"]
    agora = datetime.utcnow()
    pedidos = {p: db.query(Atendimento).filter(Atendimento.protocolo == p).one() for p in (protocolo_vencido, protocolo_perto, protocolo_longe, protocolo_respondido)}
    pedidos[protocolo_vencido].prazo_em = agora - timedelta(days=2)
    pedidos[protocolo_perto].prazo_em = agora + timedelta(days=1)
    pedidos[protocolo_respondido].prazo_em = agora - timedelta(days=5)
    db.commit()
    assert client.post(f"/api/atendimentos/{pedidos[protocolo_respondido].id_atendimento}/responder", json={"resposta": "Já respondido, obrigado pelo contato."}, headers=auth_headers).status_code == 200

    servico.avisar_prazos(db, agora)
    avisos = [a for a in client.get("/api/minhas-notificacoes/", headers=auth_headers).json()["avisos"] if a["tipo"] == "atendimento_prazo"]
    titulos = " | ".join(a["titulo"] for a in avisos)
    assert protocolo_vencido in titulos and "vencido há 2 dia(s)" in titulos
    assert protocolo_perto in titulos and "vence em 1 dia(s)" in titulos
    assert protocolo_longe not in titulos and protocolo_respondido not in titulos

    # a rotina roda a cada 15 minutos: no mesmo dia não repete o aviso
    assert servico.avisar_prazos(db, agora + timedelta(hours=3)) == 0
    # no dia seguinte avisa de novo (enquanto o pedido seguir aberto)
    assert servico.avisar_prazos(db, agora + timedelta(days=1)) >= 2
    db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "atendimento_prazo").delete()
    db.commit()


# ------------------------------------------------------------------------------------------ v5.5b: voluntariado e e-mail de confirmação
def _corpo_voluntario(**sobrescritas) -> dict:
    corpo = {
        "tipo": "VOLUNTARIO", "mensagem": f"Gostaria de ajudar aos sábados de manhã. {uuid.uuid4().hex[:10]}", "nome_completo": "Pessoa Voluntária",
        "telefone_whatsapp": "(91) 98888-6666", "data_nascimento": "1990-05-10",
        "consentimento_lgpd": True, "versao_texto_consentimento": servico.VERSAO_AVISO_DE_PRIVACIDADE_ATENDIMENTO,
    }
    corpo.update(sobrescritas)
    return corpo


def _enviar_voluntario(client, **sobrescritas):
    return client.post("/api/publico/atendimentos", json=_corpo_voluntario(**sobrescritas), headers={"X-Forwarded-For": _ip()})


def test_o_pedido_de_voluntariado_exige_a_data_de_nascimento_e_fixa_o_assunto(client, db):
    ok = _enviar_voluntario(client)
    assert ok.status_code == 200, ok.text
    assert ok.json()["prazo_dias"] == 10
    gravado = db.query(Atendimento).filter(Atendimento.protocolo == ok.json()["protocolo"]).one()
    assert gravado.tipo == "VOLUNTARIO" and gravado.assunto == "Quero ser voluntário" and gravado.subtipo is None
    assert gravado.data_nascimento is not None and gravado.data_nascimento.year == 1990
    sem = _enviar_voluntario(client, data_nascimento=None)
    assert sem.status_code == 422 and "data de nascimento" in sem.text.lower()
    futuro = _enviar_voluntario(client, data_nascimento=str(datetime.utcnow().date() + timedelta(days=3)))
    assert futuro.status_code == 422 and "no futuro" in futuro.text
    antiga = _enviar_voluntario(client, data_nascimento="1850-01-01")
    assert antiga.status_code == 422 and "Confira a data de nascimento" in antiga.text
    # nos outros tipos a data de nascimento é descartada (não vira dado guardado à toa)
    contato = _enviar(client, data_nascimento="1990-05-10")
    assert db.query(Atendimento).filter(Atendimento.protocolo == contato.json()["protocolo"]).one().data_nascimento is None


def test_a_fila_mostra_a_idade_e_se_e_menor_no_pedido_de_voluntariado(client, db, auth_headers):
    hoje = datetime.utcnow().date()
    menor = _enviar_voluntario(client, data_nascimento=str(hoje.replace(year=hoje.year - 16) - timedelta(days=30))).json()["protocolo"]
    adulta = _enviar_voluntario(client).json()["protocolo"]
    por_protocolo = {i["protocolo"]: i for i in _fila(client, auth_headers, tipo="VOLUNTARIO", por_pagina=100)["itens"]}
    assert por_protocolo[menor]["idade"] == 16 and por_protocolo[menor]["menor_de_idade"] is True
    assert por_protocolo[adulta]["idade"] >= 30 and por_protocolo[adulta]["menor_de_idade"] is False
    assert por_protocolo[adulta]["tipo_rotulo"] == "Voluntariado"
    # fora do voluntariado não há idade
    contato = _fila(client, auth_headers, busca=_enviar(client).json()["protocolo"])["itens"][0]
    assert contato["idade"] is None and contato["menor_de_idade"] is None


def test_cadastrar_o_voluntario_cria_a_pessoa_sem_ser_associado_e_liga_ao_pedido(client, db, auth_headers):
    from app.models.associados import Associado
    from app.models.pessoas import Pessoa

    cpf = _cpf_valido()
    protocolo = _enviar_voluntario(client, cpf=cpf, email_contato=f"vol.{uuid.uuid4().hex[:8]}@example.com").json()["protocolo"]
    id_atendimento = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one().id_atendimento
    r = client.post(f"/api/atendimentos/{id_atendimento}/cadastrar-voluntario", headers=auth_headers)
    assert r.status_code == 200, r.text
    id_pessoa = r.json()["id_pessoa"]
    assert id_pessoa is not None
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).one()
    assert pessoa.cpf == cpf and pessoa.nome_completo == "Pessoa Voluntária" and pessoa.data_nascimento.year == 1990
    assert db.query(Associado).filter(Associado.id_pessoa == id_pessoa).count() == 0
    # de novo: recusa em português; a Auditoria guardou uma vez só
    outra = client.post(f"/api/atendimentos/{id_atendimento}/cadastrar-voluntario", headers=auth_headers)
    assert outra.status_code == 400 and "já está no cadastro" in outra.json()["detail"]
    assert db.query(AuditLog).filter(AuditLog.acao == "ATENDIMENTO_VOLUNTARIO_CADASTRADO", AuditLog.id_registro_afetado == id_atendimento).count() == 1


def test_so_o_pedido_de_voluntariado_vira_cadastro_de_voluntario_e_so_quem_atende_faz(client, db, auth_headers):
    contato = db.query(Atendimento).filter(Atendimento.protocolo == _enviar(client).json()["protocolo"]).one()
    r = client.post(f"/api/atendimentos/{contato.id_atendimento}/cadastrar-voluntario", headers=auth_headers)
    assert r.status_code == 400 and "voluntariado" in r.json()["detail"]
    assert client.post("/api/atendimentos/1/cadastrar-voluntario").status_code == 401
    assert client.post("/api/atendimentos/1/cadastrar-voluntario", headers=_usuario(db, "associados")).status_code == 403


def test_cadastrar_o_voluntario_liga_a_pessoa_que_ja_tem_o_mesmo_cpf_em_vez_de_criar_outra(client, db, auth_headers):
    from app.models.pessoas import Pessoa

    cpf = _cpf_valido()
    protocolo = _enviar_voluntario(client, cpf=cpf).json()["protocolo"]
    # a pessoa entra no cadastro DEPOIS do pedido (por outro caminho): o pedido ainda não está ligado
    pessoa = Pessoa(nome_completo="Já Cadastrada", cpf=cpf)
    db.add(pessoa)
    db.commit()
    atendimento = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    assert atendimento.id_pessoa is None
    r = client.post(f"/api/atendimentos/{atendimento.id_atendimento}/cadastrar-voluntario", headers=auth_headers)
    assert r.status_code == 200 and r.json()["id_pessoa"] == pessoa.id_pessoa
    assert db.query(Pessoa).filter(Pessoa.cpf == cpf).count() == 1


def test_o_e_mail_de_confirmacao_sai_com_o_protocolo_e_o_prazo_so_para_pedido_novo_com_e_mail(client, db, monkeypatch):
    enviados = []
    monkeypatch.setattr(servico.notificacoes, "enviar_email", lambda destino, assunto, corpo_texto: enviados.append((destino, assunto, corpo_texto)))
    email = f"confirma.{uuid.uuid4().hex[:8]}@example.com"
    corpo = _corpo(email_contato=email)
    ip = _ip()
    a = client.post("/api/publico/atendimentos", json=corpo, headers={"X-Forwarded-For": ip}).json()
    # o mesmo pedido de novo (duplo clique): o mesmo protocolo e NENHUM e-mail a mais
    b = client.post("/api/publico/atendimentos", json=corpo, headers={"X-Forwarded-For": ip}).json()
    assert a["protocolo"] == b["protocolo"] and len(enviados) == 1
    destino, assunto, texto = enviados[0]
    assert destino == email and assunto == f"Recebemos o seu pedido - protocolo {a['protocolo']}"
    assert f"Protocolo: {a['protocolo']}" in texto and "Prazo de resposta: 10 dias (até " in texto
    # sem e-mail (só telefone): nada é enviado
    antes = len(enviados)
    _enviar(client, email_contato=None, telefone_whatsapp="91988887777")
    assert len(enviados) == antes


def test_e_mail_de_confirmacao_que_falha_nao_derruba_o_pedido(client, db, monkeypatch):
    def quebra(destino, assunto, corpo_texto):
        raise RuntimeError("SMTP fora do ar")

    monkeypatch.setattr(servico.notificacoes, "enviar_email", quebra)
    r = _enviar(client, email_contato=f"falha.{uuid.uuid4().hex[:8]}@example.com")
    assert r.status_code == 200 and r.json()["protocolo"]
    assert db.query(Atendimento).filter(Atendimento.protocolo == r.json()["protocolo"]).count() == 1
