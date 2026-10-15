"""v5.6a - doar pelo site com Pix estático (a ASAF não tem Pix dinâmico: o dinheiro cai direto na chave da associação e nada avisa o sistema).

As promessas que estes testes travam:
  1. sem a chave Pix cadastrada a doação pelo site não está disponível (e diz isso), com ela o código "copia e cola" é um BR Code válido (CRC), livre ou com valor;
  2. a página pública mostra só as campanhas em andamento, com meta e o que já foi RECEBIDO (nunca a intenção), sem vazar a destinação interna;
  3. quem se identifica ganha protocolo e código, o mesmo pedido mandado duas vezes é UM protocolo e UM aviso, e a intenção NÃO é dinheiro (não vira doação, saldo nem meta);
  4. robô, aviso de privacidade com versão, dados errados em português e limite por IP valem; a Auditoria guarda o fato sem o dado pessoal;
  5. só a confirmação da tesouraria, com o valor RECEBIDO, cria a doação (título pago, recibo numerado), uma vez só, e manda o recibo por e-mail (se o e-mail falhar, a doação fica);
  6. 'não localizado' e 'expirada' não apagam nada e ainda podem ser confirmadas; só quem tem `financeiro` mexe e tudo fica na Auditoria."""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

import pytest

from app.models.core import AuditLog, ConfiguracaoInstitucional
from app.models.doacoes import Doacao
from app.models.intencoes_de_doacao import CONFIRMADA, EXPIRADA, NAO_LOCALIZADA, PENDENTE, IntencaoDeDoacao
from app.services import doacao_online as servico
from app.services.pix import _crc16_ccitt_false, gerar_payload_pix
from tests.test_atendimento import _cpf_valido, _ip
from tests.test_doacoes import _criar_centro_custo, _criar_conta
from tests.test_documentos_institucionais import _usuario
from tests.test_publico import _dirigente

_PIX = {"CHAVE_PIX": "doacoes@asaf.example.com", "NOME_BENEFICIARIO_PIX": "ASAF Teste", "CIDADE_BENEFICIARIO_PIX": "Belem", "PUBLICO__CHAVE_PIX": "true"}


def _trocar_config(db, valores: dict) -> dict:
    antigos = {}
    for chave, valor in valores.items():
        config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == chave).first()
        assert config is not None, f"config '{chave}' deveria existir (seed)"
        antigos[chave] = config.valor_configuracao
        config.valor_configuracao = valor
    db.commit()
    return antigos


@pytest.fixture
def pix(db):
    antigos = _trocar_config(db, _PIX)
    yield _PIX
    _trocar_config(db, antigos)


@pytest.fixture
def sem_pix(db):
    antigos = _trocar_config(db, {"CHAVE_PIX": ""})
    yield
    _trocar_config(db, antigos)


@pytest.fixture
def emails(monkeypatch):
    enviados = []
    monkeypatch.setattr(servico.notificacoes, "enviar_email", lambda destino, assunto, corpo_texto: enviados.append((destino, assunto, corpo_texto)))
    return enviados


def _campos(payload: str) -> dict:
    """Os campos do primeiro nível do BR Code (id -> valor)."""
    campos, i = {}, 0
    while i < len(payload):
        tamanho = int(payload[i + 2:i + 4])
        campos[payload[i:i + 2]] = payload[i + 4:i + 4 + tamanho]
        i += 4 + tamanho
    return campos


def _crc_confere(payload: str) -> bool:
    return _crc16_ccitt_false(payload[:-4]) == payload[-4:]


def _corpo(**sobrescritas) -> dict:
    corpo = {
        "nome_completo": "Maria Doadora da Silva", "email": f"doadora.{uuid.uuid4().hex[:10]}@example.com", "valor": 50,
        "consentimento_lgpd": True, "versao_texto_consentimento": servico.VERSAO_AVISO_DE_PRIVACIDADE_DOACAO,
    }
    corpo.update(sobrescritas)
    return {k: v for k, v in corpo.items() if v is not None}


def _doar(client, ip=None, **sobrescritas):
    return client.post("/api/publico/doacoes/intencoes", json=_corpo(**sobrescritas), headers={"X-Forwarded-For": ip or _ip()})


def _campanha(client, auth_headers, meta=1000, prazo=None, id_centro_custo=None, ativa=True) -> int:
    corpo = {"titulo": f"Campanha {uuid.uuid4().hex[:6]}", "descricao": "Para ajudar", "meta_valor": meta}
    if prazo:
        corpo["prazo"] = prazo.strftime("%Y-%m-%dT%H:%M:%S")
    if id_centro_custo:
        corpo["id_centro_custo"] = id_centro_custo
    r = client.post("/api/campanhas-arrecadacao/", json=corpo, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_campanha = r.json()["id_campanha"]
    if not ativa:
        assert client.put(f"/api/campanhas-arrecadacao/{id_campanha}/ativa?ativa=false", headers=auth_headers).status_code == 200
    return id_campanha


def _contas(client, auth_headers) -> tuple[int, int]:
    return _criar_conta(client, auth_headers, "Receita"), _criar_conta(client, auth_headers, "Ativo")


def _confirmar(client, auth_headers, id_intencao, receita, caixa, valor=50, **extra):
    return client.post(
        f"/api/intencoes-doacao/{id_intencao}/confirmar", headers=auth_headers,
        json={"valor_recebido": valor, "id_conta_contabil": receita, "id_conta_contabil_caixa": caixa, **extra},
    )


def _id_da_intencao(db, protocolo) -> int:
    return db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.protocolo == protocolo).one().id_intencao


# ------------------------------------------------------------------------------------------------ 1. o Pix
def test_sem_a_chave_pix_a_doacao_pelo_site_nao_esta_disponivel_e_diz_isso(client, sem_pix):
    publico = client.get("/api/publico/doacao").json()
    assert publico["pix_disponivel"] is False and publico["chave_pix"] is None
    r = client.get("/api/publico/doacao/pix")
    assert r.status_code == 503 and "ainda não está disponível" in r.json()["detail"]
    r = _doar(client)
    assert r.status_code == 503 and "ainda não está disponível" in r.json()["detail"]


def test_chave_preenchida_mas_so_interna_nao_abre_a_doacao_pelo_site(client, db, pix, emails):
    """O Pix das cobranças já pode estar cadastrado há tempo: a página de doação só abre quando alguém marca a chave como "vai para o site" (ela vai dentro do código)."""
    antigos = _trocar_config(db, {"PUBLICO__CHAVE_PIX": "false"})
    intencoes_antes = db.query(IntencaoDeDoacao).count()
    try:
        assert client.get("/api/publico/doacao").json()["pix_disponivel"] is False
        assert client.get("/api/publico/doacao/pix").status_code == 503
        assert _doar(client).status_code == 503
        assert db.query(IntencaoDeDoacao).count() == intencoes_antes
    finally:
        _trocar_config(db, antigos)
    assert client.get("/api/publico/doacao").json()["pix_disponivel"] is True


def test_o_codigo_pix_livre_e_com_valor_e_um_br_code_valido(client, pix):
    publico = client.get("/api/publico/doacao").json()
    assert publico["pix_disponivel"] is True and publico["chave_pix"] == pix["CHAVE_PIX"] and publico["beneficiario"] == "ASAF Teste"
    assert publico["versao_aviso_de_privacidade"] == servico.VERSAO_AVISO_DE_PRIVACIDADE_DOACAO

    livre = client.get("/api/publico/doacao/pix").json()["copia_e_cola"]
    assert livre.startswith("000201") and "br.gov.bcb.pix" in livre and pix["CHAVE_PIX"] in livre and _crc_confere(livre)
    assert "54" not in _campos(livre), "sem valor, quem paga digita no app do banco"

    com_valor = client.get("/api/publico/doacao/pix?valor=25.5").json()["copia_e_cola"]
    assert _campos(com_valor)["54"] == "25.50" and _crc_confere(com_valor)
    assert _campos(com_valor)["59"] == "ASAF Teste" and _campos(com_valor)["60"] == "Belem"


@pytest.mark.parametrize("valor", ["0", "-5", "1000000.01", "abc"])
def test_valor_invalido_no_pix_anonimo_e_recusado(client, pix, valor):
    assert client.get(f"/api/publico/doacao/pix?valor={valor}").status_code in (400, 422)


def test_pix_estatico_sem_valor_nao_mexe_no_que_ja_existia():
    com = gerar_payload_pix(chave_pix="a@b.c", nome_beneficiario="ASAF", cidade_beneficiario="Belem", valor=Decimal("10"), txid="T1")
    sem = gerar_payload_pix(chave_pix="a@b.c", nome_beneficiario="ASAF", cidade_beneficiario="Belem", valor=None, txid="T1")
    assert _campos(com)["54"] == "10.00" and "54" not in _campos(sem)
    assert _crc_confere(com) and _crc_confere(sem)


def test_pix_para_campanha_so_de_campanha_em_andamento(client, auth_headers, pix):
    ativa = _campanha(client, auth_headers)
    encerrada = _campanha(client, auth_headers, ativa=False)
    assert client.get(f"/api/publico/doacao/pix?id_campanha={ativa}").status_code == 200
    r = client.get(f"/api/publico/doacao/pix?id_campanha={encerrada}")
    assert r.status_code == 400 and "não está recebendo doações" in r.json()["detail"]
    assert client.get("/api/publico/doacao/pix?id_campanha=99999999").status_code == 400


# ------------------------------------------------------------------------------------------------ 2. a página pública
def test_a_pagina_publica_mostra_so_campanhas_em_andamento_e_so_o_que_foi_recebido(client, auth_headers, db, pix, exercicio_financeiro_aberto, emails):
    centro = _criar_centro_custo(client, auth_headers)
    em_andamento = _campanha(client, auth_headers, meta=1000, id_centro_custo=centro, prazo=datetime.utcnow() + timedelta(days=30))
    no_ultimo_dia = _campanha(client, auth_headers, prazo=datetime.utcnow())
    vencida = _campanha(client, auth_headers, prazo=datetime.utcnow() - timedelta(days=3))
    encerrada = _campanha(client, auth_headers, ativa=False)
    receita, caixa = _contas(client, auth_headers)

    antes = {c["id_campanha"]: c for c in client.get("/api/publico/doacao").json()["campanhas"]}
    assert em_andamento in antes and no_ultimo_dia in antes
    assert vencida not in antes and encerrada not in antes
    assert antes[em_andamento]["valor_arrecadado"] == 0 and antes[em_andamento]["percentual"] == 0
    assert set(antes[em_andamento]) == {"id_campanha", "titulo", "descricao", "meta_valor", "valor_arrecadado", "percentual", "prazo"}, "a destinação interna não sai"

    # a intenção não conta; só a confirmação, com o valor recebido
    protocolo = _doar(client, id_campanha=em_andamento, valor=300).json()["protocolo"]
    meio = {c["id_campanha"]: c for c in client.get("/api/publico/doacao").json()["campanhas"]}
    assert meio[em_andamento]["valor_arrecadado"] == 0
    assert _confirmar(client, auth_headers, _id_da_intencao(db, protocolo), receita, caixa, valor=250).status_code == 200
    depois = {c["id_campanha"]: c for c in client.get("/api/publico/doacao").json()["campanhas"]}
    assert depois[em_andamento]["valor_arrecadado"] == 250 and depois[em_andamento]["percentual"] == 25


# ------------------------------------------------------------------------------------------------ 3. a intenção identificada
def test_quem_se_identifica_ganha_protocolo_e_codigo_e_a_intencao_nao_e_dinheiro(client, auth_headers, db, pix, emails):
    doacoes_antes = db.query(Doacao).count()
    r = _doar(client, valor=75.5, nome_completo="  Maria   Doadora  da Silva ")
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["protocolo"].startswith(f"DOA-{datetime.utcnow().year}-")
    assert _campos(corpo["copia_e_cola"])["54"] == "75.50" and _crc_confere(corpo["copia_e_cola"]) and corpo["chave_pix"] == pix["CHAVE_PIX"]

    intencao = db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.protocolo == corpo["protocolo"]).one()
    assert intencao.status == PENDENTE and intencao.nome_doador == "Maria Doadora da Silva" and intencao.valor_informado == Decimal("75.50")
    assert intencao.expira_em > datetime.utcnow() + timedelta(days=servico.DIAS_PARA_EXPIRAR_PADRAO - 1)
    assert db.query(Doacao).count() == doacoes_antes, "a intenção não é doação"

    assert len(emails) == 1 and emails[0][0] == intencao.email_doador
    assert corpo["protocolo"] in emails[0][1] and corpo["copia_e_cola"] in emails[0][2]
    assert "só é registrada depois que a tesouraria" in emails[0][2]


def test_o_valor_pode_ficar_em_branco_e_a_pessoa_digita_no_banco(client, db, pix, emails):
    r = _doar(client, valor=None)
    assert r.status_code == 200 and r.json()["valor"] is None
    assert "54" not in _campos(r.json()["copia_e_cola"]) and _crc_confere(r.json()["copia_e_cola"])


def test_o_mesmo_pedido_mandado_duas_vezes_e_um_protocolo_um_aviso_e_um_email(client, auth_headers, db, pix, emails):
    corpo = _corpo()
    primeiro = client.post("/api/publico/doacoes/intencoes", json=corpo, headers={"X-Forwarded-For": _ip()}).json()
    segundo = client.post("/api/publico/doacoes/intencoes", json=corpo, headers={"X-Forwarded-For": _ip()}).json()
    assert primeiro["protocolo"] == segundo["protocolo"] and primeiro["copia_e_cola"] == segundo["copia_e_cola"]
    assert db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.email_doador == corpo["email"]).count() == 1
    assert len(emails) == 1
    avisos = [a for a in client.get("/api/minhas-notificacoes/", headers=auth_headers).json()["avisos"] if primeiro["protocolo"] in a["titulo"]]
    assert len(avisos) == 1 and avisos[0]["link"] == "/doacoes"
    # valor diferente é OUTRO pedido
    outro = _doar(client, email=corpo["email"], valor=99).json()
    assert outro["protocolo"] != primeiro["protocolo"]


def test_so_a_campanha_em_andamento_recebe_intencao(client, auth_headers, pix, emails):
    encerrada = _campanha(client, auth_headers, ativa=False)
    r = _doar(client, id_campanha=encerrada)
    assert r.status_code == 400 and "não está recebendo doações" in r.json()["detail"]
    assert _doar(client, id_campanha=99999999).status_code == 400
    ativa = _campanha(client, auth_headers)
    assert _doar(client, id_campanha=ativa).json()["id_campanha"] == ativa


# ------------------------------------------------------------------------------------------------ 4. proteção e dados
def test_robo_aviso_de_privacidade_e_limite_por_ip(client, db, pix, emails):
    antes = db.query(IntencaoDeDoacao).count()
    r = _doar(client, pagina_web="http://spam.example")
    assert r.status_code == 200 and r.json()["protocolo"] is None, "o robô não percebe que foi pego"
    assert db.query(IntencaoDeDoacao).count() == antes and emails == []

    r = _doar(client, consentimento_lgpd=False)
    assert r.status_code == 400 and "aviso de privacidade" in r.json()["detail"]
    r = _doar(client, versao_texto_consentimento="0")
    assert r.status_code == 422 and "foi atualizado" in r.json()["detail"]
    r = client.post("/api/publico/doacoes/intencoes", json={k: v for k, v in _corpo().items() if k != "versao_texto_consentimento"}, headers={"X-Forwarded-For": _ip()})
    assert r.status_code == 422

    ip = _ip()
    assert all(_doar(client, ip=ip).status_code == 200 for _ in range(10))
    assert _doar(client, ip=ip).status_code == 429


@pytest.mark.parametrize("campo,valor,trecho", [
    ("nome_completo", "Jo", "nome completo"),
    ("email", "isto-nao-e-email", "e-mail"),
    ("cpf", "11111111111", "CPF"),
    ("valor", 0, "maior que zero"),
    ("valor", 2_000_000, "alto demais"),
])
def test_dado_errado_volta_em_portugues(client, pix, emails, campo, valor, trecho):
    r = _doar(client, **{campo: valor})
    assert r.status_code == 422, r.text
    assert trecho in str(r.json())


def test_a_auditoria_guarda_o_fato_sem_o_dado_pessoal(client, auth_headers, db, pix, emails):
    corpo = _corpo(nome_completo="Pessoa Sigilosa de Teste")
    protocolo = _doar(client, **corpo).json()["protocolo"]
    entrada = db.query(AuditLog).filter(AuditLog.acao == "INTENCAO_DOACAO_PUBLICA").order_by(AuditLog.id_log.desc()).first()
    assert entrada is not None and entrada.id_registro_afetado == _id_da_intencao(db, protocolo) and entrada.id_usuario is None
    assert "Sigilosa" not in str(entrada.dados_depois) and corpo["email"] not in str(entrada.dados_depois)


# ------------------------------------------------------------------------------------------------ 5. a confirmação
def test_confirmar_cria_a_doacao_com_o_valor_recebido_o_recibo_e_manda_por_email(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):
    receita, caixa = _contas(client, auth_headers)
    centro = _criar_centro_custo(client, auth_headers)
    campanha = _campanha(client, auth_headers, id_centro_custo=centro)
    cpf = _cpf_valido()
    protocolo = _doar(client, valor=100, id_campanha=campanha, cpf=cpf).json()["protocolo"]
    id_intencao = _id_da_intencao(db, protocolo)
    emails.clear()

    r = _confirmar(client, auth_headers, id_intencao, receita, caixa, valor=90)  # a pessoa pagou menos do que disse
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["numero_recibo"] is not None and corpo["status"] == CONFIRMADA and corpo["valor_recebido"] == 90 and corpo["recibo_enviado_por_email"] is True

    doacao = db.query(Doacao).filter(Doacao.id_doacao == corpo["id_doacao"]).one()
    assert doacao.valor == Decimal("90.00") and doacao.nome_doador == "Maria Doadora da Silva" and doacao.documento_doador == cpf
    assert doacao.anonima is False and doacao.tipo_doacao == "Monetaria" and doacao.id_campanha == campanha
    assert doacao.id_centro_custo_destinacao == centro, "sem destinação informada, vale a da campanha"
    assert doacao.id_titulo is not None
    titulo = next(t for t in client.get("/api/titulos/", headers=auth_headers).json() if t["id_titulo"] == doacao.id_titulo)
    assert titulo["status"] == "Pago" and titulo["valor_original"] == 90.0

    assert len(emails) == 1 and emails[0][0] == db.get(IntencaoDeDoacao, id_intencao).email_doador
    assert f"nº {doacao.numero_recibo}" in emails[0][1] and "RECIBO DE DOAÇÃO" in emails[0][2] and "Maria Doadora da Silva" in emails[0][2]

    entrada = db.query(AuditLog).filter(AuditLog.acao == "INTENCAO_DOACAO_CONFIRMADA", AuditLog.id_registro_afetado == id_intencao).one()
    assert entrada.id_usuario is not None and str(doacao.id_doacao) in entrada.dados_depois
    arrecadado = {c["id_campanha"]: c for c in client.get("/api/publico/doacao").json()["campanhas"]}[campanha]["valor_arrecadado"]
    assert arrecadado == 90


def test_confirmar_duas_vezes_nao_duplica_a_doacao(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):
    receita, caixa = _contas(client, auth_headers)
    id_intencao = _id_da_intencao(db, _doar(client).json()["protocolo"])
    doacoes_antes = db.query(Doacao).count()
    assert _confirmar(client, auth_headers, id_intencao, receita, caixa).status_code == 200
    r = _confirmar(client, auth_headers, id_intencao, receita, caixa)
    assert r.status_code == 400 and "já foi confirmada" in r.json()["detail"]
    assert db.query(Doacao).count() == doacoes_antes + 1
    assert client.post(f"/api/intencoes-doacao/{id_intencao}/nao-localizada", json={}, headers=auth_headers).status_code == 400, "confirmada não volta atrás"


def test_confirmacao_recusada_nao_deixa_doacao_solta_nem_baixa_a_intencao(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):
    receita, caixa = _contas(client, auth_headers)
    id_intencao = _id_da_intencao(db, _doar(client).json()["protocolo"])
    doacoes_antes = db.query(Doacao).count()
    r = _confirmar(client, auth_headers, id_intencao, caixa, caixa)  # uma conta de Ativo no lugar da Receita
    assert r.status_code == 400, r.text
    db.expire_all()
    assert db.query(Doacao).count() == doacoes_antes
    assert db.get(IntencaoDeDoacao, id_intencao).status == PENDENTE and db.get(IntencaoDeDoacao, id_intencao).id_doacao is None
    assert _confirmar(client, auth_headers, 99999999, receita, caixa).status_code == 404
    assert client.post(f"/api/intencoes-doacao/{id_intencao}/confirmar", json={"valor_recebido": 0, "id_conta_contabil": receita, "id_conta_contabil_caixa": caixa}, headers=auth_headers).status_code == 422
    assert _confirmar(client, auth_headers, id_intencao, receita, caixa).status_code == 200, "depois de corrigir, confirma"


def test_se_o_email_do_recibo_falhar_a_doacao_fica_e_a_tela_avisa(client, auth_headers, db, pix, monkeypatch, exercicio_financeiro_aberto):
    receita, caixa = _contas(client, auth_headers)
    id_intencao = _id_da_intencao(db, _doar(client).json()["protocolo"])

    def quebra(*_a, **_k):
        raise RuntimeError("SMTP fora do ar")

    monkeypatch.setattr(servico.notificacoes, "enviar_email", quebra)
    r = _confirmar(client, auth_headers, id_intencao, receita, caixa)
    assert r.status_code == 200 and r.json()["recibo_enviado_por_email"] is False and r.json()["numero_recibo"] is not None
    item = next(i for i in client.get("/api/intencoes-doacao/?situacao=CONFIRMADA", headers=auth_headers).json()["itens"] if i["id_intencao"] == id_intencao)
    assert item["recibo_enviado_por_email"] is False


def test_doador_que_ja_e_associado_fica_ligado_ao_cadastro_pelo_cpf(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):
    cpf = _cpf_valido()
    associado = _dirigente(db, f"Associado Doador {uuid.uuid4().hex[:6]}", cpf, f"assoc.{uuid.uuid4().hex[:6]}@example.com", "(94) 98888-1111")
    receita, caixa = _contas(client, auth_headers)
    id_intencao = _id_da_intencao(db, _doar(client, cpf=cpf).json()["protocolo"])
    r = _confirmar(client, auth_headers, id_intencao, receita, caixa)
    assert r.status_code == 200, r.text
    assert db.query(Doacao).filter(Doacao.id_doacao == r.json()["id_doacao"]).one().id_associado == associado.id_associado
    # sem CPF nunca adivinha
    sem_cpf = _id_da_intencao(db, _doar(client).json()["protocolo"])
    assert db.query(Doacao).filter(Doacao.id_doacao == _confirmar(client, auth_headers, sem_cpf, receita, caixa).json()["id_doacao"]).one().id_associado is None


# ------------------------------------------------------------------------------------------------ 6. não localizada, expirada, lista e permissões
def test_nao_localizada_nao_apaga_nada_e_ainda_pode_ser_confirmada(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):
    receita, caixa = _contas(client, auth_headers)
    id_intencao = _id_da_intencao(db, _doar(client).json()["protocolo"])
    r = client.post(f"/api/intencoes-doacao/{id_intencao}/nao-localizada", json={"observacao": "  Não achei no extrato de outubro  "}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["status"] == NAO_LOCALIZADA and r.json()["observacao"] == "Não achei no extrato de outubro"
    assert any(e.acao == "INTENCAO_DOACAO_NAO_LOCALIZADA" and e.id_registro_afetado == id_intencao for e in db.query(AuditLog).all())
    assert _confirmar(client, auth_headers, id_intencao, receita, caixa).status_code == 200, "o dinheiro chegou depois"
    db.expire_all()
    assert db.get(IntencaoDeDoacao, id_intencao).status == CONFIRMADA


def test_a_intencao_sem_confirmacao_expira_e_ainda_pode_ser_confirmada(client, auth_headers, db, pix, emails, exercicio_financeiro_aberto):
    receita, caixa = _contas(client, auth_headers)
    id_vencida = _id_da_intencao(db, _doar(client).json()["protocolo"])
    id_em_dia = _id_da_intencao(db, _doar(client).json()["protocolo"])
    db.query(IntencaoDeDoacao).filter(IntencaoDeDoacao.id_intencao == id_vencida).update({"expira_em": datetime.utcnow() - timedelta(hours=1)})
    db.commit()

    assert servico.expirar_vencidas(db) >= 1
    db.expire_all()
    assert db.get(IntencaoDeDoacao, id_vencida).status == EXPIRADA and db.get(IntencaoDeDoacao, id_em_dia).status == PENDENTE
    assert servico.expirar_vencidas(db) == 0, "rodar de novo não muda nada"

    a_conferir = {i["id_intencao"] for i in client.get("/api/intencoes-doacao/?situacao=a_conferir&por_pagina=100", headers=auth_headers).json()["itens"]}
    assert {id_vencida, id_em_dia} <= a_conferir
    assert _confirmar(client, auth_headers, id_vencida, receita, caixa).status_code == 200


def test_o_prazo_para_expirar_vem_das_regras_do_sistema(client, auth_headers, db, pix, emails):
    antigos = _trocar_config(db, {"CHAVE_PIX": _PIX["CHAVE_PIX"]})
    try:
        assert client.get("/api/publico/doacao").json()["dias_de_validade_do_pedido"] == servico.DIAS_PARA_EXPIRAR_PADRAO
    finally:
        _trocar_config(db, antigos)


def test_a_lista_filtra_busca_pagina_e_resume(client, auth_headers, db, pix, emails):
    cpf = _cpf_valido()
    nome = f"Doador Buscavel {uuid.uuid4().hex[:6]}"
    protocolo = _doar(client, nome_completo=nome, cpf=cpf).json()["protocolo"]
    for _ in range(2):
        _doar(client)

    por_protocolo = client.get(f"/api/intencoes-doacao/?busca={protocolo}", headers=auth_headers).json()
    assert por_protocolo["total"] == 1 and por_protocolo["itens"][0]["nome_doador"] == nome
    assert client.get(f"/api/intencoes-doacao/?busca={nome.split()[2]}", headers=auth_headers).json()["total"] == 1
    assert client.get(f"/api/intencoes-doacao/?busca={cpf[:3]}.{cpf[3:6]}", headers=auth_headers).json()["total"] >= 1
    pagina = client.get("/api/intencoes-doacao/?por_pagina=2&pagina=1", headers=auth_headers).json()
    assert len(pagina["itens"]) == 2 and pagina["total"] >= 3
    assert client.get("/api/intencoes-doacao/?situacao=inventada", headers=auth_headers).status_code == 400
    item = por_protocolo["itens"][0]
    assert item["status_rotulo"] == "Aguardando conferência" and item["pode_confirmar"] is True and item["campanha_titulo"] is None

    resumo = client.get("/api/intencoes-doacao/resumo", headers=auth_headers).json()
    assert set(resumo) == {"pendentes", "expiradas", "nao_localizadas", "confirmadas", "a_conferir"}
    assert resumo["a_conferir"] == resumo["pendentes"] + resumo["expiradas"] and resumo["pendentes"] >= 3


def test_so_quem_tem_a_permissao_financeiro_confere(client, auth_headers, db, pix, emails):
    id_intencao = _id_da_intencao(db, _doar(client).json()["protocolo"])
    rotas = [
        ("get", "/api/intencoes-doacao/", None), ("get", "/api/intencoes-doacao/resumo", None),
        ("post", f"/api/intencoes-doacao/{id_intencao}/confirmar", {"valor_recebido": 10, "id_conta_contabil": 1, "id_conta_contabil_caixa": 2}),
        ("post", f"/api/intencoes-doacao/{id_intencao}/nao-localizada", {}),
    ]
    sem_permissao = _usuario(db, "associados")
    for metodo, rota, corpo in rotas:
        assert getattr(client, metodo)(rota, **({"json": corpo} if corpo is not None else {})).status_code == 401, rota
        assert getattr(client, metodo)(rota, headers=sem_permissao, **({"json": corpo} if corpo is not None else {})).status_code == 403, rota
    assert client.get("/api/intencoes-doacao/", headers=_usuario(db, "financeiro")).status_code == 200
    db.expire_all()
    assert db.get(IntencaoDeDoacao, id_intencao).status == PENDENTE


def test_so_quem_tem_financeiro_e_avisado_no_sino(client, auth_headers, db, pix, emails):
    protocolo = _doar(client).json()["protocolo"]
    assert any(protocolo in a["titulo"] for a in client.get("/api/minhas-notificacoes/", headers=auth_headers).json()["avisos"])
    sem_permissao = _usuario(db, "associados")
    assert all(protocolo not in a["titulo"] for a in client.get("/api/minhas-notificacoes/", headers=sem_permissao).json()["avisos"])
