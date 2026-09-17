"""v3.2.1 (adaptado, 2026-09-17) - lembrete automático de mensalidade por e-mail com Pix pronto,
substitui Pix Automático (exige PSP pago, sem orçamento). `notificacoes.enviar_email` é sempre
monkeypatchado nestes testes - nenhum e-mail de verdade sai daqui, nenhuma rede é usada."""
from datetime import datetime, timedelta

from tests.test_contribuicoes import _criar_conta
from tests.test_situacao import _criar_associado


def _configurar_pix(db):
    from app.models.core import ConfiguracaoInstitucional

    for chave, valor in [("CHAVE_PIX", "12345678000199"), ("NOME_BENEFICIARIO_PIX", "ASAF Teste"), ("CIDADE_BENEFICIARIO_PIX", "Sao Paulo")]:
        config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
        config.valor_configuracao = valor
    db.commit()


def _criar_titulo_a_receber(client, auth_headers, conta_receita, id_associado, valor, data_vencimento):
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Receber", "id_conta_contabil": conta_receita, "id_associado": id_associado,
        "descricao": "Mensalidade teste lembrete", "valor_original": valor,
        "data_vencimento": data_vencimento.strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_titulo"]


def test_lembrete_no_vencimento_e_antes_do_vencimento(client, auth_headers, db, monkeypatch):
    from app.services import lembretes

    _configurar_pix(db)
    conta_receita = _criar_conta(client, auth_headers, "3.2.9900", "Receita Lembrete Teste", tipo="Receita")
    associado = _criar_associado(client)

    # data fixa e bem no futuro (nunca `datetime.utcnow()`) - o banco de teste é compartilhado
    # pela sessão inteira (sem rollback por teste, ver tests/conftest.py), e `enviar_lembretes_do_dia`
    # varre TODO título pendente do sistema que vença numa data - "hoje" de verdade colidiria com
    # título de outro teste que usa `utcnow() + timedelta(dias)` como vencimento padrão.
    hoje = datetime(2094, 1, 10)
    titulo_hoje = _criar_titulo_a_receber(client, auth_headers, conta_receita, associado["id_associado"], 50, hoje)
    titulo_futuro = _criar_titulo_a_receber(client, auth_headers, conta_receita, associado["id_associado"], 60, hoje + timedelta(days=5))

    enviados = []
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda destinatario, assunto, corpo_texto: enviados.append((destinatario, assunto, corpo_texto)))

    resultado = lembretes.enviar_lembretes_do_dia(db, hoje=hoje)

    from app.models.associados import Associado as AssociadoModel

    email_esperado = db.query(AssociadoModel).filter(AssociadoModel.id_associado == associado["id_associado"]).first().email_contato

    tipos_por_titulo = {r["id_titulo"]: r["tipo_lembrete"] for r in resultado}
    assert tipos_por_titulo[titulo_hoje] == "NO_VENCIMENTO"
    assert tipos_por_titulo[titulo_futuro] == "ANTES_VENCIMENTO"
    assert len(enviados) == 2
    assert all(e[0] == email_esperado for e in enviados)
    assert all("br.gov.bcb.pix" in corpo for (_, _, corpo) in enviados)


def test_lembrete_nunca_duplicado_mesmo_rodando_duas_vezes(client, auth_headers, db, monkeypatch):
    from app.services import lembretes

    _configurar_pix(db)
    conta_receita = _criar_conta(client, auth_headers, "3.2.9901", "Receita Lembrete Teste 2", tipo="Receita")
    associado = _criar_associado(client)
    hoje = datetime(2094, 2, 10)
    _criar_titulo_a_receber(client, auth_headers, conta_receita, associado["id_associado"], 50, hoje)

    chamadas = []
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda destinatario, assunto, corpo_texto: chamadas.append(destinatario))

    primeira = lembretes.enviar_lembretes_do_dia(db, hoje=hoje)
    segunda = lembretes.enviar_lembretes_do_dia(db, hoje=hoje)

    assert len(primeira) == 1
    assert segunda == []  # já enviado - trava por UniqueConstraint(id_titulo, tipo_lembrete)
    assert len(chamadas) == 1


def test_lembrete_pula_titulo_sem_associado_ou_sem_email(client, auth_headers, db, monkeypatch):
    from app.services import lembretes

    _configurar_pix(db)
    conta_receita = _criar_conta(client, auth_headers, "3.2.9902", "Receita Lembrete Teste 3", tipo="Receita")
    conta_despesa = _criar_conta(client, auth_headers, "4.1.9902", "Despesa Lembrete Teste", tipo="Despesa")
    hoje = datetime(2094, 3, 10)

    # título A Pagar / sem associado (ex.: fornecedor) - nunca gera lembrete.
    r = client.post("/titulos/", json={
        "tipo_titulo": "A Pagar", "id_conta_contabil": conta_despesa,
        "descricao": "Despesa sem associado", "valor_original": 40,
        "data_vencimento": hoje.strftime("%Y-%m-%dT%H:%M:%S"),
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    # associado sem e-mail cadastrado (a criação exige EmailStr válido - limpa direto no banco
    # pra simular quem nunca preencheu contato, sem passar pela validação de cadastro).
    from app.models.associados import Associado as AssociadoModel

    associado_sem_email = _criar_associado(client)
    id_titulo_sem_email = _criar_titulo_a_receber(client, auth_headers, conta_receita, associado_sem_email["id_associado"], 50, hoje)
    registro = db.query(AssociadoModel).filter(AssociadoModel.id_associado == associado_sem_email["id_associado"]).first()
    registro.pessoa.email_contato = None
    db.commit()

    enviados = []
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda destinatario, assunto, corpo_texto: enviados.append(destinatario))

    resultado = lembretes.enviar_lembretes_do_dia(db, hoje=hoje)
    assert resultado == []
    assert enviados == []


def test_dias_lembrete_e_configuravel(client, auth_headers, db, monkeypatch):
    from app.models.core import ConfiguracaoInstitucional
    from app.services import lembretes

    _configurar_pix(db)
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "DIAS_LEMBRETE_MENSALIDADE").first()
    config.valor_configuracao = "10"
    db.commit()

    conta_receita = _criar_conta(client, auth_headers, "3.2.9903", "Receita Lembrete Teste 4", tipo="Receita")
    associado = _criar_associado(client)
    hoje = datetime(2094, 4, 10)
    titulo_10_dias = _criar_titulo_a_receber(client, auth_headers, conta_receita, associado["id_associado"], 50, hoje + timedelta(days=10))
    titulo_5_dias = _criar_titulo_a_receber(client, auth_headers, conta_receita, associado["id_associado"], 50, hoje + timedelta(days=5))

    enviados = []
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda destinatario, assunto, corpo_texto: enviados.append(destinatario))

    resultado = lembretes.enviar_lembretes_do_dia(db, hoje=hoje)
    ids_notificados = {r["id_titulo"] for r in resultado}
    assert titulo_10_dias in ids_notificados  # 10 dias = configuração atual
    assert titulo_5_dias not in ids_notificados  # 5 dias não é mais o gatilho


def test_enviar_email_falha_sem_smtp_configurado(monkeypatch):
    from app.services import notificacoes

    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("SMTP_USUARIO", raising=False)
    monkeypatch.delenv("SMTP_SENHA", raising=False)
    assert notificacoes.smtp_configurado() is False

    import pytest
    with pytest.raises(RuntimeError):
        notificacoes.enviar_email("teste@example.com", "assunto", "corpo")
