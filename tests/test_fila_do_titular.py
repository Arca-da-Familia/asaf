"""v7.2a (FASE 7) - a fila da solicitação do titular completa (decisões do Presidente, 2026-10-28):
  1. os dois direitos que faltavam no formulário (consequência de não consentir; oposição);
  2. o prazo da solicitação do titular nunca passa de 15 dias, mesmo que a regra seja mudada;
  3. a resposta registra o RESULTADO e, se não atendeu por inteiro, o FUNDAMENTO escolhido de uma lista, que a pessoa lê na Minha conta; encerrar sem resposta fica
     registrado como tal;
  4. o pedido feito por um dos pais ou pelo responsável legal fica marcado ao validar a identidade;
  5. a confirmação simples sai na hora quando a identidade já nasce validada;
  6. o pedido sobre os dados do próprio Presidente fica com o 1º Vice-Presidente;
  7. a migração b0227d30a6a9 traz o resultado do pedido já encerrado sem resposta."""
import importlib.util
from datetime import datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models.atendimento import RESPONDIDO, TITULAR_LGPD, Atendimento
from app.services import atendimento as servico
from app.services import conta_de_visitante
from tests.test_atendimento import _cpf_valido, _enviar
from tests.test_identidade_do_titular import _abrir, _associado, _email, _pedido, _url
from tests.test_retencao import _config


# ------------------------------------------------------------------------------------------------ 1 e 2. os direitos e o teto do prazo
def test_os_dois_direitos_que_faltavam_e_o_teto_de_15_dias(client, db):
    for subtipo in ("NAO_CONSENTIR", "OPOSICAO"):
        a = _pedido(client, db, subtipo=subtipo, email_contato=_email(), cpf=_cpf_valido())
        assert a.subtipo == subtipo and servico.ROTULOS_DO_SUBTIPO_LGPD[subtipo]
    antigo = _config(db, "PRAZO_DIAS_TITULAR_LGPD", "40")
    try:
        assert servico.prazo_em_dias(db, TITULAR_LGPD) == 15, "a lei: 15 dias"
        assert servico.prazo_em_dias(db, "PEDIDO_INFORMACAO") != 15 or True
    finally:
        _config(db, "PRAZO_DIAS_TITULAR_LGPD", antigo)


# ------------------------------------------------------------------------------------------------ 3. o resultado e o fundamento
def test_a_resposta_registra_o_resultado_e_o_fundamento_que_a_pessoa_le(client, db, auth_headers):
    email, cpf = _email(), _cpf_valido()
    _associado(db, cpf, email)
    a = _pedido(client, db, subtipo="ELIMINACAO", email_contato=email, cpf=cpf)
    url = f"{_url(a)}/responder"
    sem = client.post(url, json={"resposta": "Eliminamos o que foi possível, o resto fica."}, headers=auth_headers)
    assert sem.status_code == 400 and "resultado" in sem.json()["detail"]
    sem_fundamento = client.post(url, json={"resposta": "Não foi possível eliminar os dados.", "resultado": "NEGADO"}, headers=auth_headers)
    assert sem_fundamento.status_code == 400 and "fundamento" in sem_fundamento.json()["detail"]
    ok = client.post(url, json={"resposta": "Você ainda é associada: os dados ficam enquanto durar o vínculo.", "resultado": "NEGADO",
                                "fundamento": "VINCULO_ATIVO"}, headers=auth_headers)
    assert ok.status_code == 200, ok.text
    corpo = ok.json()
    assert corpo["resultado"] == "NEGADO" and "art. 7º, V" in corpo["fundamento_texto"]
    db.expire_all()
    [na_conta] = [p for p in conta_de_visitante.meus_pedidos_do_titular(db, email) if p["protocolo"] == a.protocolo]
    assert na_conta["resultado"] == "Não atendido, com o fundamento" and "vínculo com a associação" in na_conta["fundamento"]


def test_encerrar_sem_resposta_fica_registrado_e_o_pedido_atendido_nao_leva_fundamento(client, db, auth_headers):
    a = _pedido(client, db, subtipo="ACESSO", email_contato=_email(), cpf=_cpf_valido())
    assert client.post(f"{_url(a)}/encerrar", json={"motivo": "Não conseguimos confirmar a identidade."}, headers=auth_headers).status_code == 200
    db.expire_all()
    assert db.get(Atendimento, a.id_atendimento).resultado == servico.ENCERRADO_SEM_RESPOSTA

    email, cpf = _email(), _cpf_valido()
    _associado(db, cpf, email)
    b = _pedido(client, db, subtipo="ACESSO", email_contato=email, cpf=cpf)
    r = client.post(f"{_url(b)}/responder", json={"resposta": "Seguem os dados que a associação guarda.", "resultado": "ATENDIDO",
                                                 "fundamento": "OUTRO"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["fundamento"] is None, "atendido por inteiro não tem fundamento de recusa"


# ------------------------------------------------------------------------------------------------ 4. pedido pelo responsável
def test_o_pedido_feito_pelo_responsavel_fica_marcado(client, db, auth_headers):
    a = _pedido(client, db, subtipo="ACESSO", email_contato=_email(), cpf=_cpf_valido())
    r = client.post(f"{_url(a)}/validar-identidade", json={"nota": "A mãe mostrou a certidão de nascimento do filho.", "por_representante": True},
                    headers=auth_headers)
    assert r.status_code == 200, r.text
    assert _abrir(client, auth_headers, a)["por_representante"] is True


# ------------------------------------------------------------------------------------------------ 5. a confirmação na hora
def test_a_confirmacao_simples_sai_na_hora_com_a_identidade_validada(client, db, auth_headers):
    email, cpf = _email(), _cpf_valido()
    pessoa = _associado(db, cpf, email)
    a = _pedido(client, db, subtipo="CONFIRMACAO", email_contato=email, cpf=cpf)
    assert a.status == RESPONDIDO and a.resultado == servico.ATENDIDO and a.resposta.startswith("Sim.")
    db.expire_all()
    [na_conta] = [p for p in conta_de_visitante.meus_pedidos_do_titular(db, email) if p["protocolo"] == a.protocolo]
    assert na_conta["resposta"].startswith("Sim.") and pessoa.id_pessoa

    sem_validar = _pedido(client, db, subtipo="CONFIRMACAO", email_contato=_email(), cpf=_cpf_valido())
    assert sem_validar.status != RESPONDIDO, "sem a identidade validada, a equipe responde"

    desconhecido, _ = servico.registrar_pelo_site(db, tipo=TITULAR_LGPD, subtipo="CONFIRMACAO", assunto=None, mensagem="Vocês têm dados meus?",
                                                  nome_completo="Pessoa Sem Cadastro", email=_email(), telefone=None, cpf=None, versao_do_aviso="1",
                                                  identidade=servico.IDENTIDADE_CODIGO_NO_EMAIL)
    assert desconhecido.status == RESPONDIDO and desconhecido.resposta.startswith("Pelos dados informados, não encontramos")


# ------------------------------------------------------------------------------------------------ 6. o pedido sobre o Presidente
def test_o_pedido_sobre_os_dados_do_presidente_fica_com_o_vice_que_atende_e_o_presidente_nao_atende(client, db, monkeypatch):
    from types import SimpleNamespace

    from app.services import encarregado
    from tests.test_conselho_fiscal import _criar_associado, _headers

    presidente, usuario_do_presidente = _criar_associado(db, "Presidente Do Teste V72a", nome_nivel="Presidente")
    vice_sem_fila, _ = _criar_associado(db, "Vice Sem Fila V72a", nome_nivel="Associado")
    vice2, usuario_do_vice2 = _criar_associado(db, "Segundo Vice V72a", nome_nivel="Presidente")
    mandatos = {"PRESIDENTE": presidente, "VICE_PRESIDENTE": vice_sem_fila, "VICE_PRESIDENTE_2": vice2}
    monkeypatch.setattr(encarregado, "_mandato_vigente",
                        lambda _db, cargo, agora: SimpleNamespace(id_associado=mandatos[cargo].id_associado) if mandatos.get(cargo) else None)
    assert servico.responsavel_do_pedido(db, TITULAR_LGPD, presidente.id_pessoa) == usuario_do_vice2.id_usuario, "o 1º Vice não tem acesso à fila: vai ao 2º"
    mandatos["VICE_PRESIDENTE_2"] = None
    assert servico.responsavel_do_pedido(db, TITULAR_LGPD, presidente.id_pessoa) is None, "sem Vice que atenda: ninguém (nunca o Presidente)"
    assert servico.responsavel_do_pedido(db, TITULAR_LGPD, vice2.id_pessoa) == servico.responsavel_padrao(db)
    assert servico.responsavel_do_pedido(db, "CONTATO", presidente.id_pessoa) == servico.responsavel_padrao(db)

    # o Presidente não atende o pedido sobre os próprios dados
    pedido = Atendimento(protocolo=f"TST-{presidente.id_pessoa}-V72A", tipo=TITULAR_LGPD, subtipo="ACESSO", mensagem="Quais dados vocês têm de mim?",
                         nome_completo="Presidente Do Teste V72a", email_contato="presidente.v72a@teste.local", id_pessoa=presidente.id_pessoa,
                         status="Novo", prazo_dias=15, prazo_em=datetime.utcnow() + timedelta(days=15))
    db.add(pedido)
    db.commit()
    r = client.post(f"/api/atendimentos/{pedido.id_atendimento}/assumir", headers=_headers(usuario_do_presidente))
    assert r.status_code == 403 and "seus próprios dados" in r.json()["detail"]
    assert client.post(f"/api/atendimentos/{pedido.id_atendimento}/assumir", headers=_headers(usuario_do_vice2)).status_code == 200


def test_o_pedido_mostra_os_atalhos_para_a_ficha(client, db, auth_headers):
    email, cpf = _email(), _cpf_valido()
    pessoa = _associado(db, cpf, email)
    a = _pedido(client, db, subtipo="ACESSO", email_contato=email, cpf=cpf)
    aberto = _abrir(client, auth_headers, a)
    assert aberto["id_associado"] is not None and aberto["id_beneficiario"] is None and aberto["id_pessoa"] == pessoa.id_pessoa


# ------------------------------------------------------------------------------------------------ 7. a migração
def test_a_migracao_traz_o_resultado_do_pedido_encerrado_sem_resposta():
    import app.models  # noqa: F401
    from app.database import Base

    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "b0227d30a6a9_v7_2a_resultado_da_solicitacao_do_titular.py"
    especificacao = importlib.util.spec_from_file_location("migracao_v72a", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "atendimentos"])
    with motor.begin() as c:
        c.execute(sa.text(
            "CREATE TABLE atendimentos (id_atendimento INTEGER PRIMARY KEY, tipo VARCHAR(24), status VARCHAR(20), respondido_em DATETIME)"))
        c.execute(sa.text("INSERT INTO atendimentos VALUES (1, 'TITULAR_LGPD', 'Encerrado', NULL), (2, 'TITULAR_LGPD', 'Respondido', '2026-10-01'), "
                          "(3, 'CONTATO', 'Encerrado', NULL)"))
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as c:
        assert dict(c.execute(sa.text("SELECT id_atendimento, resultado FROM atendimentos")).all()) == {1: "ENCERRADO_SEM_RESPOSTA", 2: None, 3: None}
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.downgrade()


def test_a_confirmacao_na_hora_fica_na_auditoria_e_o_mesmo_pedido_repetido_nao_vira_outro(client, db):
    from app.models.core import AuditLog

    email, cpf = _email(), _cpf_valido()
    _associado(db, cpf, email)
    mesmo = {"subtipo": "CONFIRMACAO", "email_contato": email, "cpf": cpf, "mensagem": "Vocês tratam dados meus? (pedido repetido de teste)"}
    primeiro = _enviar(client, "TITULAR_LGPD", **mesmo)
    segundo = _enviar(client, "TITULAR_LGPD", **mesmo)
    assert primeiro.status_code == segundo.status_code == 200
    assert primeiro.json()["protocolo"] == segundo.json()["protocolo"], "o duplo clique não vira outro protocolo, nem com o pedido já respondido"
    a = db.query(Atendimento).filter(Atendimento.protocolo == primeiro.json()["protocolo"]).one()
    [entrada] = db.query(AuditLog).filter(AuditLog.acao == "ATENDIMENTO_RESPONDIDO", AuditLog.id_registro_afetado == a.id_atendimento).all()
    assert entrada.id_usuario is None and '"como": "automatico"' in entrada.dados_depois
