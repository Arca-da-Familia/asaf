"""v7.2e (FASE 7) - a solicitação do titular feita de dentro do painel (app/services/pedido_pelo_painel.py):
  1. a pessoa logada vê o aviso, os direitos e os pedidos dela, e faz um pedido: com o segundo passo ligado, a identidade nasce validada, ligado ao cadastro dela,
     com a origem "painel"; a Auditoria guarda; o mesmo pedido mandado de novo devolve o mesmo protocolo;
  2. a confirmação simples sai na hora e a resposta aparece no painel;
  3. sem ler o aviso, com o aviso desatualizado ou sem cadastro ligado à conta: recusado;
  4. o relatório liberado pelo encarregado é baixado pelo próprio painel (só os pedidos dela);
  5. o pedido feito pelo painel entrega o CADASTRO (a identidade é forte), ao contrário do feito só com o código do e-mail."""
import json
import uuid
from datetime import datetime, timedelta

from app import textos_de_privacidade
from app.models.atendimento import IDENTIDADE_PAINEL, RESPONDIDO, Atendimento
from app.models.core import AuditLog, NivelAcesso, Usuario
from app.models.pessoas import Pessoa
from app.security import hash_senha
from tests.test_atendimento import _cpf_valido
from tests.test_conselho_fiscal import _criar_associado, _headers
from tests.test_doacao_online import emails  # noqa: F401  (a fixture `emails`)

URL = "/api/meus-pedidos-do-titular"


def _associada(db, *, segundo_passo=True):
    associado, usuario = _criar_associado(db, f"Associada Do Painel {uuid.uuid4().hex[:6]}")
    pessoa = db.get(Pessoa, associado.id_pessoa)
    pessoa.cpf, pessoa.email_contato = _cpf_valido(), f"painel.{uuid.uuid4().hex[:8]}@example.com"
    usuario.mfa_ativado = segundo_passo
    db.commit()
    return pessoa, usuario


def _pedir(client, headers, subtipo="ACESSO", **sobrescritas):
    corpo = {"subtipo": subtipo, "mensagem": "Quero saber o que a associação guarda sobre mim.", "aviso_lido": True,
             "versao_do_aviso": textos_de_privacidade.versao_atual("ATENDIMENTO_TITULAR"), **sobrescritas}
    return client.post(URL, json=corpo, headers=headers)


def test_a_pessoa_faz_o_pedido_pelo_painel_com_a_identidade_validada(client, db):
    pessoa, usuario = _associada(db)
    cab = _headers(usuario)
    inicio = client.get(URL, headers=cab)
    assert inicio.status_code == 200, inicio.text
    corpo = inicio.json()
    assert corpo["aviso"]["versao"] == textos_de_privacidade.versao_atual("ATENDIMENTO_TITULAR") and corpo["aviso"]["texto"]
    assert {d["codigo"] for d in corpo["direitos"]} >= {"ACESSO", "ELIMINACAO", "PORTABILIDADE"} and corpo["pedidos"] == []

    r = _pedir(client, cab)
    assert r.status_code == 200, r.text
    protocolo = r.json()["protocolo"]
    a = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    assert a.identidade_validacao == IDENTIDADE_PAINEL and a.identidade_validada_em is not None
    assert a.id_pessoa == pessoa.id_pessoa and a.origem == "painel" and a.cpf == pessoa.cpf and a.email_contato == pessoa.email_contato
    entrada = db.query(AuditLog).filter(AuditLog.acao == "ATENDIMENTO_PELO_PAINEL", AuditLog.id_registro_afetado == a.id_atendimento).one()
    assert entrada.id_usuario == usuario.id_usuario and json.loads(entrada.dados_depois)["identidade"] == IDENTIDADE_PAINEL
    assert [p["protocolo"] for p in client.get(URL, headers=cab).json()["pedidos"]] == [protocolo]
    de_novo = _pedir(client, cab)
    assert de_novo.json()["protocolo"] == protocolo and de_novo.json()["ja_existia"] is True, "duplo clique: o mesmo protocolo"


def test_a_confirmacao_simples_sai_na_hora_e_aparece_no_painel(client, db):
    _, usuario = _associada(db)
    cab = _headers(usuario)
    r = _pedir(client, cab, subtipo="CONFIRMACAO", mensagem="Vocês tratam dados meus?")
    assert r.status_code == 200 and r.json()["situacao"] == RESPONDIDO
    [pedido] = client.get(URL, headers=cab).json()["pedidos"]
    assert pedido["situacao"] == RESPONDIDO and pedido["resposta"].startswith("Sim.") and pedido["resultado"]


def test_as_recusas(client, db):
    _, usuario = _associada(db)
    cab = _headers(usuario)
    sem_ler = _pedir(client, cab, aviso_lido=False)
    assert sem_ler.status_code == 400 and "aviso" in sem_ler.json()["detail"]
    velho = _pedir(client, cab, versao_do_aviso="0")
    assert velho.status_code == 422 and "atualizado" in velho.json()["detail"]
    assert _pedir(client, cab, subtipo="QUALQUER").status_code == 422
    assert _pedir(client, cab, mensagem="curta").status_code == 422

    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    tecnica = Usuario(email=f"tecnica.{uuid.uuid4().hex[:6]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(tecnica)
    db.commit()
    r = client.get(URL, headers=_headers(tecnica))
    assert r.status_code == 400 and "não está ligada a um cadastro" in r.json()["detail"]
    assert client.get(URL).status_code == 401


def test_o_relatorio_liberado_e_baixado_pelo_proprio_painel(client, db, auth_headers):
    _, usuario = _associada(db)
    cab = _headers(usuario)
    protocolo = _pedir(client, cab).json()["protocolo"]
    a = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    previa = client.get("/api/privacidade/titulares/relatorio", params={"id_atendimento": a.id_atendimento}, headers=auth_headers).json()
    assert previa["pessoa"] is not None, "pelo painel a identidade é forte: o relatório traz o cadastro"
    liberou = client.post(f"/api/privacidade/titulares/entregas/{a.id_atendimento}", json={"impressao": previa["impressao"]}, headers=auth_headers)
    assert liberou.status_code == 200, liberou.text
    [pedido] = client.get(URL, headers=cab).json()["pedidos"]
    assert pedido["relatorio_disponivel_ate"]
    pdf = client.get(f"{URL}/{protocolo}/relatorio", params={"formato": "pdf"}, headers=cab)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    baixou = db.query(AuditLog).filter(AuditLog.acao == "DOWNLOAD_RELATORIO_DO_TITULAR", AuditLog.id_registro_afetado == a.id_atendimento).one()
    assert baixou.id_usuario == usuario.id_usuario
    _, outra = _associada(db)
    assert client.get(f"{URL}/{protocolo}/relatorio", headers=_headers(outra)).status_code == 404, "o pedido é de outra pessoa"
    assert client.get(f"{URL}/{protocolo}/relatorio", params={"formato": "csv"}, headers=cab).status_code == 400



# ------------------------------------------------------------------------------------------------ 6. a revisão da v7.2e
def test_sem_o_segundo_passo_ou_com_a_senha_provisoria_a_equipe_confere_a_identidade(client, db):
    _, sem = _associada(db, segundo_passo=False)
    r = _pedir(client, _headers(sem), subtipo="CONFIRMACAO", mensagem="Vocês tratam dados meus?")
    assert r.status_code == 200 and r.json()["identidade_validada"] is False and r.json()["situacao"] == "Novo", "sem resposta na hora"
    a = db.query(Atendimento).filter(Atendimento.protocolo == r.json()["protocolo"]).one()
    assert a.identidade_validacao is None and a.identidade_validada_em is None and a.origem == "painel"
    _, provisoria = _associada(db)
    provisoria.senha_provisoria = True
    db.commit()
    r = _pedir(client, _headers(provisoria))
    assert r.json()["identidade_validada"] is False


def test_o_pedido_do_painel_nao_aparece_na_minha_conta_e_o_do_site_nao_aparece_no_painel(client, db):
    from app.services import conta_de_visitante

    pessoa, usuario = _associada(db)
    protocolo = _pedir(client, _headers(usuario)).json()["protocolo"]
    assert protocolo not in [p["protocolo"] for p in conta_de_visitante.meus_pedidos_do_titular(db, pessoa.email_contato)]
    assert conta_de_visitante.pedido_do_titular_do_email(db, pessoa.email_contato, protocolo) is None
    do_site = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="TITULAR_LGPD", subtipo="ACESSO", mensagem="Pedido feito pelo site por alguém.",
                          nome_completo="Outra Pessoa", email_contato=pessoa.email_contato, id_pessoa=pessoa.id_pessoa, status="Novo", prazo_dias=15,
                          prazo_em=datetime.utcnow() + timedelta(days=15), identidade_validacao="CODIGO_NO_EMAIL", identidade_validada_em=datetime.utcnow())
    db.add(do_site)
    db.commit()
    assert [p["protocolo"] for p in client.get(URL, headers=_headers(usuario)).json()["pedidos"]] == [protocolo], "só os feitos pelo painel"


def test_sem_e_mail_no_cadastro_o_pedido_usa_o_de_entrada_e_e_respondido_no_painel(client, db, auth_headers):
    pessoa, usuario = _associada(db)
    pessoa.email_contato = None
    db.commit()
    protocolo = _pedir(client, _headers(usuario)).json()["protocolo"]
    a = db.query(Atendimento).filter(Atendimento.protocolo == protocolo).one()
    assert a.email_contato == usuario.email
    a.email_contato = None
    db.commit()
    r = client.post(f"/api/atendimentos/{a.id_atendimento}/responder", json={"resposta": "Guardamos o seu nome e o seu CPF.", "resultado": "ATENDIDO"},
                    headers=auth_headers)
    assert r.status_code == 200, r.text
    [pedido] = client.get(URL, headers=_headers(usuario)).json()["pedidos"]
    assert pedido["resposta"] == "Guardamos o seu nome e o seu CPF."


def test_o_e_mail_do_pedido_do_painel_manda_ler_no_painel(client, db, emails):
    _, usuario = _associada(db)
    emails.clear()
    _pedir(client, _headers(usuario))
    [(_, _, corpo)] = emails
    assert "Meu perfil > Meus dados pessoais" in corpo and "Minha conta" not in corpo


def test_o_limite_de_pedidos_por_dia(client, db):
    _, usuario = _associada(db)
    cab = _headers(usuario)
    for i in range(5):
        assert _pedir(client, cab, mensagem=f"Pedido número {i} sobre os meus dados.").status_code == 200
    r = _pedir(client, cab, mensagem="Mais um pedido sobre os meus dados.")
    assert r.status_code == 429 and "vários pedidos hoje" in r.json()["detail"]
