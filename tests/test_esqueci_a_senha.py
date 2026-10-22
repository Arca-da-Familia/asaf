"""Esqueci a minha senha (pedido do Presidente em 21/10): o código por e-mail troca a senha do painel sem depender da secretaria. As mesmas regras do código da conta de visitante
(v5.6b): resposta igual exista ou não a conta, limites por IP e por CPF, 6 dígitos, 10 minutos, 5 tentativas, uso único; e as regras de senha: todas as sessões caem, o bloqueio por senha
errada sai, a senha deixa de ser provisória, o MFA continua exigido. Nenhum e-mail de verdade sai daqui."""
import json
from datetime import datetime, timedelta

import pytest

from app.models.core import AuditLog, TokenAcesso, Usuario
from app.models.nova_senha import CodigoDeNovaSenha
from app.services import conta_de_visitante, notificacoes
from app.services import esqueci_a_senha as servico
from tests.test_atendimento import _ip
from tests.test_conceder_acesso import _criar_ficha

SENHA_PROVISORIA = "Provisoria1"


def _conta(client, auth_headers, db, *, email=None):
    """Um associado com acesso ao painel (senha provisória); devolve (cpf, id_usuario, e-mail de login)."""
    id_associado, cpf = _criar_ficha(client)
    email = email or f"{cpf}@esqueci.example.com"
    r = client.post(f"/api/associados/{id_associado}/conceder-acesso", json={"email": email, "senha_provisoria": SENHA_PROVISORIA}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return cpf, r.json()["id_usuario"], email


@pytest.fixture
def enviados(monkeypatch):
    lista = []
    monkeypatch.setattr(servico, "enviar_codigo", lambda email, codigo: lista.append((email, codigo)) or True)
    return lista


def _pedir(client, cpf, ip=None):
    return client.post("/auth/senha/esqueci", json={"cpf": cpf}, headers={"X-Forwarded-For": ip or _ip()})


def _trocar(client, cpf, codigo, senha_nova, ip=None):
    return client.post("/auth/senha/trocar-com-codigo", json={"cpf": cpf, "codigo": codigo, "senha_nova": senha_nova}, headers={"X-Forwarded-For": ip or _ip()})


def test_a_resposta_e_a_mesma_com_conta_sem_conta_e_cpf_que_nao_existe(client, auth_headers, db, enviados):
    cpf, _id, email = _conta(client, auth_headers, db)
    _sem_acesso, cpf_sem_acesso = _criar_ficha(client)
    respostas = [_pedir(client, c) for c in (cpf, cpf_sem_acesso, "00000000000", "abc")]
    assert {r.status_code for r in respostas} == {200}
    assert len({json.dumps(r.json(), sort_keys=True) for r in respostas}) == 1  # nada diferencia quem tem conta
    assert "codigo_de_teste" not in respostas[0].json()
    assert [e for e, _c in enviados] == [email]  # só quem tem acesso recebe, no e-mail de login


def test_o_codigo_troca_a_senha_e_as_sessoes_abertas_caem(client, auth_headers, db, enviados):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    assert client.post("/auth/login", json={"cpf": cpf, "senha": SENHA_PROVISORIA}).status_code == 200
    db.expire_all()
    assert db.query(TokenAcesso).filter(TokenAcesso.id_usuario == id_usuario).count() >= 1
    _pedir(client, cpf)
    codigo = enviados[-1][1]
    errado = "000000" if codigo != "000000" else "111111"
    r = _trocar(client, cpf, errado, "MinhaSenhaNova9")
    assert r.status_code == 400 and r.json()["detail"] == servico.MENSAGEM_DO_CODIGO_INVALIDO

    r = _trocar(client, cpf, codigo, "MinhaSenhaNova9")
    assert r.status_code == 200, r.text
    assert client.post("/auth/login", json={"cpf": cpf, "senha": SENHA_PROVISORIA}).status_code == 401
    novo = client.post("/auth/login", json={"cpf": cpf, "senha": "MinhaSenhaNova9"})
    assert novo.status_code == 200 and novo.json()["senha_provisoria"] is False
    db.expire_all()
    # as sessões de antes da troca foram encerradas (sobra só a do login com a senha nova)
    assert db.query(TokenAcesso).filter(TokenAcesso.id_usuario == id_usuario).count() == 1
    # uso único
    assert _trocar(client, cpf, codigo, "OutraSenhaNova9").status_code == 400
    linha = db.query(AuditLog).filter(AuditLog.acao == "SENHA_TROCADA_PELO_CODIGO", AuditLog.id_registro_afetado == id_usuario).one()
    assert "@" not in (linha.dados_depois or "") and linha.ip_origem


def test_cinco_tentativas_e_depois_nem_o_codigo_certo_serve(client, auth_headers, db, enviados):
    cpf, _id, _email = _conta(client, auth_headers, db)
    _pedir(client, cpf)
    codigo = enviados[-1][1]
    errado = "000000" if codigo != "000000" else "111111"
    for _ in range(servico.TENTATIVAS_POR_CODIGO):
        assert _trocar(client, cpf, errado, "MinhaSenhaNova9").status_code == 400
    assert _trocar(client, cpf, codigo, "MinhaSenhaNova9").status_code == 400


def test_codigo_vencido_ou_substituido_nao_serve(client, auth_headers, db, enviados):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    _pedir(client, cpf)
    primeiro = enviados[-1][1]
    _pedir(client, cpf)
    segundo = enviados[-1][1]
    if primeiro != segundo:
        assert _trocar(client, cpf, primeiro, "MinhaSenhaNova9").status_code == 400  # pedir de novo invalida o anterior
    db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.id_usuario == id_usuario, CodigoDeNovaSenha.usado_em.is_(None)).update(
        {"expira_em": datetime.utcnow() - timedelta(minutes=1)}, synchronize_session=False,
    )
    db.commit()
    assert _trocar(client, cpf, segundo, "MinhaSenhaNova9").status_code == 400


def test_senha_fraca_ou_igual_a_atual_e_recusada_sem_gastar_o_codigo(client, auth_headers, db, enviados):
    cpf, _id, _email = _conta(client, auth_headers, db)
    _pedir(client, cpf)
    codigo = enviados[-1][1]
    fraca = _trocar(client, cpf, codigo, "curta")
    assert fraca.status_code == 400 and "8 caracteres" in fraca.json()["detail"]
    igual = _trocar(client, cpf, codigo, SENHA_PROVISORIA)
    assert igual.status_code == 400 and igual.json()["detail"] == "A senha nova precisa ser diferente da atual."
    assert _trocar(client, cpf, codigo, "MinhaSenhaNova9").status_code == 200


def test_tira_o_bloqueio_por_senha_errada_e_o_mfa_continua_exigido(client, auth_headers, db, enviados):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    usuario = db.get(Usuario, id_usuario)
    usuario.bloqueado_ate = datetime.utcnow() + timedelta(minutes=30)
    usuario.tentativas_falhas = 5
    usuario.mfa_ativado = True
    db.commit()
    _pedir(client, cpf)
    assert _trocar(client, cpf, enviados[-1][1], "MinhaSenhaNova9").status_code == 200
    login = client.post("/auth/login", json={"cpf": cpf, "senha": "MinhaSenhaNova9"})
    assert login.status_code == 200, login.text
    assert login.json()["requer_mfa"] is True  # o código troca a senha; não entra no painel sem o segundo passo


def test_o_limite_por_cpf_vale_igual_com_ou_sem_conta(client, auth_headers, db, enviados):
    cpf, _id, _email = _conta(client, auth_headers, db)
    _sem, cpf_sem_acesso = _criar_ficha(client)
    for alvo in (cpf, cpf_sem_acesso):
        for _ in range(servico.PEDIDOS_POR_CPF_NA_HORA):
            assert _pedir(client, alvo).status_code == 200
        assert _pedir(client, alvo).status_code == 429


def test_o_codigo_so_aparece_na_resposta_na_homologacao_sem_servidor_de_email_e_so_para_conta_sem_permissao(client, auth_headers, db, monkeypatch):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    monkeypatch.setenv("VISITANTE_CODIGO_NA_RESPOSTA", "1")
    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: False)
    assert conta_de_visitante.codigo_de_teste_na_resposta()
    codigo = _pedir(client, cpf).json()["codigo_de_teste"]
    assert _trocar(client, cpf, codigo, "MinhaSenhaNova9").status_code == 200

    # a conta do Presidente de teste (todas as permissões): o CPF dela é público no repositório, então o código NUNCA volta na resposta
    from app.models.associados import Associado

    admin = db.query(Associado).join(Usuario, Usuario.id_usuario == Associado.id_usuario).filter(Usuario.email.like("%@teste.local")).first()
    assert admin is not None
    resposta = _pedir(client, admin.cpf)
    assert resposta.status_code == 200 and "codigo_de_teste" not in resposta.json()

    # uma conta do cofre (o e-mail de um papel de teste) sem mandato, isto é, sem permissão: o código também não volta (o CPF dela é público)
    cpf_cofre, _id_cofre, _e = _conta(client, auth_headers, db, email="conselheiro_2@homologacao.example.com")
    resposta = _pedir(client, cpf_cofre)
    assert resposta.status_code == 200 and "codigo_de_teste" not in resposta.json()

    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: True)  # com servidor de e-mail (a produção), nunca
    monkeypatch.setattr(servico, "enviar_codigo", lambda email, codigo: True)
    assert "codigo_de_teste" not in _pedir(client, cpf).json()


def test_conta_inativa_nao_recebe_codigo(client, auth_headers, db, enviados):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    db.get(Usuario, id_usuario).ativo = False
    db.commit()
    assert _pedir(client, cpf).status_code == 200
    assert enviados == []


def test_a_limpeza_apaga_os_codigos_com_mais_de_um_dia(client, auth_headers, db, enviados):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    _pedir(client, cpf)
    db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.id_usuario == id_usuario).update(
        {"criado_em": datetime.utcnow() - timedelta(days=2)}, synchronize_session=False,
    )
    db.commit()
    assert servico.limpar_vencidos(db) >= 1
    assert db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.id_usuario == id_usuario).count() == 0


def test_pedir_codigos_novos_nao_da_palpites_novos_o_teto_de_24h_trava_e_vai_para_a_auditoria(client, auth_headers, db, enviados):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    for _ in range(2):  # dois códigos, 5 palpites errados em cada: 10 tentativas no dia
        gerado = servico.gerar_codigo(db, cpf=cpf)
        assert gerado is not None
        errado = "000000" if gerado[0] != "000000" else "111111"
        codigo = db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.id_usuario == id_usuario, CodigoDeNovaSenha.usado_em.is_(None)).one()
        for _ in range(servico.TENTATIVAS_POR_CODIGO):
            _trocar(client, cpf, errado, "MinhaSenhaNova9")
        db.expire_all()
        assert codigo.tentativas == servico.TENTATIVAS_POR_CODIGO
    # passou do teto: nenhum código novo sai, e a Auditoria registra uma vez
    assert servico.gerar_codigo(db, cpf=cpf) is None
    assert servico.gerar_codigo(db, cpf=cpf) is None
    assert db.query(AuditLog).filter(AuditLog.acao == "NOVA_SENHA_TRAVADA_NO_DIA", AuditLog.id_registro_afetado == id_usuario).count() == 1
    # e um código que já existisse também não serve mais hoje, nem o certo
    db.query(CodigoDeNovaSenha).filter(CodigoDeNovaSenha.id_usuario == id_usuario).update({"criado_em": datetime.utcnow() - timedelta(hours=25)}, synchronize_session=False)
    db.commit()
    gerado = servico.gerar_codigo(db, cpf=cpf)  # o dia andou: volta a gerar
    assert gerado is not None
    assert _trocar(client, cpf, gerado[0], "MinhaSenhaNova9").status_code == 200


def test_teto_de_codigos_por_conta_e_do_sistema_no_dia(client, auth_headers, db, enviados, monkeypatch):
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    for _ in range(servico.CODIGOS_POR_CONTA_NO_DIA):
        assert servico.gerar_codigo(db, cpf=cpf) is not None
    assert servico.gerar_codigo(db, cpf=cpf) is None
    outro, _id2, _e2 = _conta(client, auth_headers, db)
    monkeypatch.setattr(servico, "CODIGOS_NO_SISTEMA_NO_DIA", 1)  # o sistema todo já gerou mais que isso nas últimas 24 h
    assert servico.gerar_codigo(db, cpf=outro) is None


def test_senha_com_mais_de_72_bytes_e_recusada_com_mensagem(client, auth_headers, db, enviados):
    cpf, _id, _email = _conta(client, auth_headers, db)
    _pedir(client, cpf)
    r = _trocar(client, cpf, enviados[-1][1], "ã" * 40)
    assert r.status_code == 400 and "longa demais" in r.json()["detail"]


def test_o_aviso_de_senha_trocada_sai_depois_da_resposta_so_com_servidor_de_email(client, auth_headers, db, enviados, monkeypatch):
    cpf, _id, email = _conta(client, auth_headers, db)
    avisos = []
    monkeypatch.setattr(servico, "avisar_a_troca", lambda e: avisos.append(e))
    _pedir(client, cpf)
    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: True)
    assert _trocar(client, cpf, enviados[-1][1], "MinhaSenhaNova9").status_code == 200
    assert avisos == [email]
    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: False)
    _pedir(client, cpf)
    assert _trocar(client, cpf, enviados[-1][1], "OutraSenhaNova9").status_code == 200
    assert avisos == [email]


def test_o_limite_vale_igual_com_cpf_com_mascara_e_o_429_e_igual_com_ou_sem_conta(client, auth_headers, db, enviados):
    cpf, _id, _email = _conta(client, auth_headers, db)
    _sem, cpf_sem_acesso = _criar_ficha(client)
    mascarado = f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"
    for alvo in (cpf, mascarado, cpf):
        assert _pedir(client, alvo).status_code == 200
    com_conta = _pedir(client, mascarado)
    for _ in range(servico.PEDIDOS_POR_CPF_NA_HORA):
        _pedir(client, cpf_sem_acesso)
    sem_conta = _pedir(client, cpf_sem_acesso)
    assert com_conta.status_code == sem_conta.status_code == 429
    assert com_conta.json() == sem_conta.json()


def test_o_limite_por_ip_da_troca(client, auth_headers, db, enviados):
    cpf, _id, _email = _conta(client, auth_headers, db)
    ip = _ip()
    for _ in range(servico.TROCAS_POR_IP_EM_15_MINUTOS):
        assert _trocar(client, cpf, "123456", "MinhaSenhaNova9", ip=ip).status_code == 400
    assert _trocar(client, cpf, "123456", "MinhaSenhaNova9", ip=ip).status_code == 429


def test_o_teto_de_tentativas_do_dia_vale_tambem_na_troca(client, auth_headers, db, enviados):
    """Um código gerado quando a conta já tinha 9 tentativas no dia dá só mais UMA: na décima, nem o código certo troca a senha."""
    cpf, id_usuario, _email = _conta(client, auth_headers, db)
    for erros in (5, 4):
        gerado = servico.gerar_codigo(db, cpf=cpf)
        assert gerado is not None
        errado = "000000" if gerado[0] != "000000" else "111111"
        for _ in range(erros):
            assert _trocar(client, cpf, errado, "MinhaSenhaNova9").status_code == 400
    gerado = servico.gerar_codigo(db, cpf=cpf)  # 9 tentativas no dia: ainda gera
    assert gerado is not None
    errado = "000000" if gerado[0] != "000000" else "111111"
    assert _trocar(client, cpf, errado, "MinhaSenhaNova9").status_code == 400  # a décima
    assert _trocar(client, cpf, gerado[0], "MinhaSenhaNova9").status_code == 400  # passou do teto: nem o certo
