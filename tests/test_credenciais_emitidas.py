"""v9.5j - as credenciais emitidas (rodada 6): a lista com filtros, a folha de impressão (2ª aba) e o registro da impressão, que recusa credencial com
dado faltando sem justificativa. O banco de testes é um só: cada teste usa nomes próprios (busca) e confere contagens pela diferença."""
import uuid

from app.models.core import AuditLog
from app.models.credencial import Credencial
from app.services import credencial as credenciais
from tests.test_catalogos_permissao import _criar_usuario_com_permissao, _headers
from tests.test_credencial import _associado


def _marca():
    return f"Emitida {uuid.uuid4().hex[:8]}"


def _com_nome(db, associado, pessoa, nome):
    pessoa.nome_completo = nome
    db.commit()
    return associado


def _lista(client, auth_headers, **params):
    r = client.get("/api/credenciais", params={"pagina": 1, "por_pagina": 50, **params}, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json(), int(r.headers["X-Total-Count"])


def test_lista_com_filtros_busca_e_o_que_falta(client, auth_headers, db):
    marca = _marca()
    sem_credencial = _com_nome(db, *_associado(db, foto=True)[:2], f"{marca} Ana")
    impressa = _com_nome(db, *_associado(db, foto=True)[:2], f"{marca} Bruno")
    de_novo = _com_nome(db, *_associado(db)[:2], f"{marca} Carla")  # sem foto
    _com_nome(db, *_associado(db, "Desligado", foto=True)[:2], f"{marca} Desligado")
    from datetime import datetime

    credenciais.atual(db, impressa).impressa_em = datetime.utcnow()
    credenciais.atual(db, de_novo)  # a primeira, que ela perdeu
    credenciais.emitir_outra(db, de_novo, None)
    db.commit()

    todas, total = _lista(client, auth_headers, busca=marca)
    assert total == 3 and [x["nome_completo"] for x in todas] == [f"{marca} Ana", f"{marca} Bruno", f"{marca} Carla"], "desligado fica fora"
    por_nome = {x["nome_completo"]: x for x in todas}
    assert por_nome[f"{marca} Ana"]["credencial"] is None and por_nome[f"{marca} Ana"]["faltando"] == []
    assert por_nome[f"{marca} Bruno"]["credencial"]["impressa_em"]
    assert por_nome[f"{marca} Carla"]["emitida_de_novo"] is True and por_nome[f"{marca} Carla"]["faltando"] == ["foto"]
    assert por_nome[f"{marca} Ana"]["situacao"] == "Ativo - Em Dia"
    assert "codigo" not in str(todas) and "/credencial/" not in str(todas), "a lista não espalha o código das credenciais"

    assert [x["nome_completo"] for x in _lista(client, auth_headers, busca=marca, filtro="falta_imprimir")[0]] == [f"{marca} Ana", f"{marca} Carla"]
    assert [x["nome_completo"] for x in _lista(client, auth_headers, busca=marca, filtro="impressas")[0]] == [f"{marca} Bruno"]
    assert [x["nome_completo"] for x in _lista(client, auth_headers, busca=marca, filtro="emitidas_de_novo")[0]] == [f"{marca} Carla"]
    # pela matrícula
    assert _lista(client, auth_headers, busca=str(impressa.numero_matricula))[0][0]["id_associado"] == impressa.id_associado
    assert client.get("/api/credenciais", params={"filtro": "outro"}, headers=auth_headers).status_code == 422


def test_resumo_conta_cada_filtro(client, auth_headers, db):
    from datetime import datetime

    antes = client.get("/api/credenciais/resumo", headers=auth_headers).json()
    associado, _, _ = _associado(db)
    credenciais.atual(db, associado).impressa_em = datetime.utcnow()
    db.commit()
    depois = client.get("/api/credenciais/resumo", headers=auth_headers).json()
    assert depois["todas"] - antes["todas"] == 1
    assert depois["impressas"] - antes["impressas"] == 1
    assert depois["falta_imprimir"] == antes["falta_imprimir"]
    assert set(depois) == {"todas", "falta_imprimir", "impressas", "emitidas_de_novo"}


def test_folha_de_impressao_cria_a_credencial_e_diz_o_que_falta(client, auth_headers, db):
    completo, pessoa, _ = _associado(db, foto=True)
    sem_foto, _, _ = _associado(db)
    r = client.get("/api/credenciais/para-imprimir", params={"ids": f"{completo.id_associado},{sem_foto.id_associado}"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    folha = r.json()
    assert [c["id_associado"] for c in folha] == [completo.id_associado, sem_foto.id_associado], "na ordem pedida"
    assert folha[0]["faltando"] == [] and folha[0]["nome_completo"] == pessoa.nome_completo and folha[0]["foto"]
    assert folha[1]["faltando"] == ["foto"] and folha[1]["foto"] is None
    assert folha[0]["pagina"] == f"/credencial/{credenciais.valendo(db, completo.id_associado).codigo}"
    assert pessoa.cpf not in r.text

    desligado, _, _ = _associado(db, "Desligado")
    assert client.get("/api/credenciais/para-imprimir", params={"ids": str(desligado.id_associado)}, headers=auth_headers).status_code == 409
    assert client.get("/api/credenciais/para-imprimir", params={"ids": "999999999"}, headers=auth_headers).status_code == 404
    assert client.get("/api/credenciais/para-imprimir", params={"ids": "a,b"}, headers=auth_headers).status_code == 422
    muitos = ",".join(str(i) for i in range(1, 62))
    assert client.get("/api/credenciais/para-imprimir", params={"ids": muitos}, headers=auth_headers).status_code == 422


def test_dado_faltando_so_se_imprime_com_justificativa_que_fica_na_auditoria(client, auth_headers, db):
    completo, _, _ = _associado(db, foto=True)
    sem_foto, pessoa_sem_foto, _ = _associado(db)
    corpo = {"ids": [completo.id_associado, sem_foto.id_associado]}
    r = client.post("/api/credenciais/registrar-impressao", json=corpo, headers=auth_headers)
    assert r.status_code == 409 and pessoa_sem_foto.nome_completo in r.json()["detail"] and "falta foto" in r.json()["detail"]
    db.expire_all()
    assert credenciais.valendo(db, completo.id_associado) is None or credenciais.valendo(db, completo.id_associado).impressa_em is None, "nada registrado"

    curta = {**corpo, "justificativas": {str(sem_foto.id_associado): "sem foto"}}
    assert client.post("/api/credenciais/registrar-impressao", json=curta, headers=auth_headers).status_code == 409

    justificada = {**corpo, "justificativas": {str(sem_foto.id_associado): "A pessoa traz a foto impressa e colamos no cartão."}}
    r = client.post("/api/credenciais/registrar-impressao", json=justificada, headers=auth_headers)
    assert r.status_code == 200, r.text
    db.expire_all()
    for associado in (completo, sem_foto):
        assert credenciais.valendo(db, associado.id_associado).impressa_em is not None
    registro = (
        db.query(AuditLog)
        .filter(AuditLog.acao == "CREDENCIAL_IMPRESSA", AuditLog.id_registro_afetado == sem_foto.id_associado)
        .order_by(AuditLog.id_log.desc()).first()
    )
    assert registro is not None and "colamos no cartão" in str(registro.dados_depois)
    assert db.query(AuditLog).filter(AuditLog.acao == "CREDENCIAL_IMPRESSA", AuditLog.id_registro_afetado == completo.id_associado).count() == 1


def test_imprimir_de_novo_mantem_a_mesma_credencial(client, auth_headers, db):
    associado, _, _ = _associado(db, foto=True)
    for _ in range(2):
        assert client.post("/api/credenciais/registrar-impressao", json={"ids": [associado.id_associado]}, headers=auth_headers).status_code == 200
    assert db.query(Credencial).filter(Credencial.id_associado == associado.id_associado).count() == 1


def test_exige_a_permissao_de_associados(client, db):
    associado, _, _ = _associado(db, foto=True)
    so_financeiro = _headers(_criar_usuario_com_permissao(db, "financeiro"))
    assert client.get("/api/credenciais", headers=so_financeiro).status_code == 403
    assert client.get("/api/credenciais/resumo", headers=so_financeiro).status_code == 403
    assert client.get("/api/credenciais/para-imprimir", params={"ids": str(associado.id_associado)}, headers=so_financeiro).status_code == 403
    assert client.post("/api/credenciais/registrar-impressao", json={"ids": [associado.id_associado]}, headers=so_financeiro).status_code == 403
    assert client.get("/api/credenciais").status_code == 401
