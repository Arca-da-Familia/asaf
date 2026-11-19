"""v9.5k - o criador de credencial (rodada 6): os modelos prontos, guardar, alterar, usar para todos e apagar, e as regras que todo desenho cumpre (nome e
QR sempre, QR quadrado de pelo menos 18 mm e sem nada em cima, tudo dentro do cartão, letra de 5 a 24 pontos, contraste de 4,5 : 1 com o que fica
atrás). O banco de testes é um só: cada teste começa sem modelo em uso quando precisa disso."""
import copy

import pytest

from app.models.core import AuditLog
from app.models.modelo_credencial import ModeloCredencial
from app.services import modelo_credencial as modelos
from tests.test_catalogos_permissao import _criar_usuario_com_permissao, _headers
from tests.test_credencial import _associado


def _pronto(chave="faixa-no-alto"):
    return copy.deepcopy(modelos.PRONTOS[chave]["desenho"])


def _parte(desenho, id_):
    return next(p for p in desenho["partes"] if p["id"] == id_)


def _nenhum_em_uso(db):
    db.query(ModeloCredencial).update({ModeloCredencial.em_uso: False})
    db.commit()


def _guardar(client, auth_headers, nome="Modelo de teste", desenho=None):
    r = client.post("/api/credenciais/modelos", json={"nome": nome, "desenho": desenho or _pronto()}, headers=auth_headers)
    assert r.status_code == 201, r.text
    return r.json()


def test_os_prontos_cumprem_as_regras_e_sem_modelo_em_uso_vale_a_faixa_no_alto(client, auth_headers, db):
    for chave, pronto in modelos.PRONTOS.items():
        assert modelos.problemas(modelos.Desenho.model_validate(pronto["desenho"])) == [], chave
    _nenhum_em_uso(db)
    r = client.get("/api/credenciais/modelo-em-uso", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["pronto"] == "faixa-no-alto" and r.json()["id_modelo"] is None
    lista = client.get("/api/credenciais/modelos", headers=auth_headers).json()
    assert [p["chave"] for p in lista["prontos"]] == ["faixa-no-alto", "faixa-do-lado", "foto-no-centro"]
    assert lista["em_uso"]["nome"] == "Faixa no alto"


def test_guardar_alterar_usar_para_todos_e_apagar_fica_na_auditoria(client, auth_headers, db):
    _nenhum_em_uso(db)
    m = _guardar(client, auth_headers, "  Faixa   azul  ", _pronto("faixa-do-lado"))
    assert m["nome"] == "Faixa azul" and m["em_uso"] is False
    desenho = m["desenho"]
    _parte(desenho, "faixa")["cor"] = "#0a5a84"
    r = client.put(f"/api/credenciais/modelos/{m['id_modelo']}", json={"nome": "Faixa azul 2027", "desenho": desenho}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert _parte(r.json()["desenho"], "faixa")["cor"] == "#0a5a84"
    assert client.get(f"/api/credenciais/modelos/{m['id_modelo']}", headers=auth_headers).json()["nome"] == "Faixa azul 2027"

    r = client.post(f"/api/credenciais/modelos/{m['id_modelo']}/usar", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert "QR de cada uma continua o mesmo" in r.json()["mensagem"]
    em_uso = client.get("/api/credenciais/modelo-em-uso", headers=auth_headers).json()
    assert em_uso["id_modelo"] == m["id_modelo"] and _parte(em_uso["desenho"], "faixa")["cor"] == "#0a5a84"

    # o em uso não se altera nem se apaga
    assert client.put(f"/api/credenciais/modelos/{m['id_modelo']}", json={"nome": "x", "desenho": desenho}, headers=auth_headers).status_code == 409
    assert client.delete(f"/api/credenciais/modelos/{m['id_modelo']}", headers=auth_headers).status_code == 409

    # usar outro: o anterior fica guardado (não está mais em uso) e pode ser apagado
    outro = _guardar(client, auth_headers, "Foto no centro verde", _pronto("foto-no-centro"))
    assert client.post(f"/api/credenciais/modelos/{outro['id_modelo']}/usar", headers=auth_headers).status_code == 200
    assert db.query(ModeloCredencial).filter(ModeloCredencial.em_uso.is_(True)).count() == 1
    guardados = {g["id_modelo"]: g for g in client.get("/api/credenciais/modelos", headers=auth_headers).json()["guardados"]}
    assert guardados[m["id_modelo"]]["em_uso"] is False and guardados[outro["id_modelo"]]["em_uso"] is True
    assert client.delete(f"/api/credenciais/modelos/{m['id_modelo']}", headers=auth_headers).status_code == 200
    assert client.get(f"/api/credenciais/modelos/{m['id_modelo']}", headers=auth_headers).status_code == 404

    acoes = [a.acao for a in db.query(AuditLog).filter(AuditLog.acao.like("MODELO_CREDENCIAL_%"), AuditLog.id_registro_afetado == m["id_modelo"]).all()]
    for acao in ("MODELO_CREDENCIAL_GUARDADO", "MODELO_CREDENCIAL_ALTERADO", "MODELO_CREDENCIAL_EM_USO", "MODELO_CREDENCIAL_APAGADO"):
        assert acao in acoes
    _nenhum_em_uso(db)


def test_minha_credencial_traz_o_desenho_em_uso(client, db):
    _nenhum_em_uso(db)
    _, _, usuario = _associado(db, foto=True, com_login=True)
    r = client.get("/api/minha-credencial", headers=_headers(usuario))
    assert r.status_code == 200, r.text
    assert r.json()["desenho"] == modelos.PRONTOS["faixa-no-alto"]["desenho"]
    assert "situacao" not in {p["tipo"] for p in r.json()["desenho"]["partes"]}, "a situação não é parte do cartão"


@pytest.mark.parametrize(
    "estragar, motivo",
    [
        (lambda d: d["partes"].remove(_parte(d, "qr")), "todo cartão tem o nome e o QR"),
        (lambda d: d["partes"].remove(_parte(d, "nome")), "todo cartão tem o nome e o QR"),
        (lambda d: _parte(d, "qr").update(largura=15, altura=15), "pequeno demais para o celular ler"),
        (lambda d: _parte(d, "qr").update(largura=22, altura=20), "tem de ser quadrado"),
        (lambda d: _parte(d, "nome").update(x=60), "está em cima do QR"),
        (lambda d: _parte(d, "qr").update(x=70), "passa da borda do cartão"),
        (lambda d: _parte(d, "nome").update(cor="#f5f5f5"), "contraste"),
        # o texto branco que sai da faixa verde e encosta no fundo branco
        (lambda d: _parte(d, "subtitulo").update(y=8), "contraste"),
        (lambda d: _parte(d, "nome").update(tamanho=3), "a letra vai de 5,0 a 24,0 pontos"),
        (lambda d: _parte(d, "confira").update(texto=""), "Texto vazio"),
        (lambda d: _parte(d, "confira").update(texto="linha\nquebrada"), "quebra de linha"),
        (lambda d: _parte(d, "confira").update(texto="x" * 61), "mais de 60 letras"),
        (lambda d: d["partes"].append({**_parte(d, "foto"), "id": "foto2"}), "aparece mais de uma vez"),
        (lambda d: _parte(d, "matricula").update(largura=1), "pequeno demais (o mínimo é 2,0 mm"),
    ],
)
def test_o_servidor_recusa_o_desenho_que_nao_cumpre_as_regras(client, auth_headers, estragar, motivo):
    desenho = _pronto()
    estragar(desenho)
    r = client.post("/api/credenciais/modelos", json={"nome": "Estragado", "desenho": desenho}, headers=auth_headers)
    assert r.status_code == 422, r.text
    assert motivo in r.json()["detail"]


def test_formato_errado_e_parte_desconhecida_sao_recusados(client, auth_headers):
    desenho = _pronto()
    desenho["partes"].append({"id": "cpf", "tipo": "cpf", "x": 1, "y": 1, "largura": 5, "altura": 5})
    r = client.post("/api/credenciais/modelos", json={"nome": "Com CPF", "desenho": desenho}, headers=auth_headers)
    assert r.status_code == 422 and "Desenho inválido" in r.json()["detail"]
    r = client.post("/api/credenciais/modelos", json={"nome": "   ", "desenho": _pronto()}, headers=auth_headers)
    assert r.status_code == 422


def test_limite_de_modelos_guardados(client, auth_headers, db, monkeypatch):
    monkeypatch.setattr(modelos, "MAXIMO_DE_MODELOS_GUARDADOS", db.query(ModeloCredencial).count())
    r = client.post("/api/credenciais/modelos", json={"nome": "Um a mais", "desenho": _pronto()}, headers=auth_headers)
    assert r.status_code == 409 and "apague algum" in r.json()["detail"]


def test_contraste_segue_a_regra_do_painel():
    assert round(modelos.contraste("#ffffff", "#000000"), 1) == 21.0
    assert modelos.contraste("#ffffff", "#14532d") >= 4.5
    assert modelos.contraste("#e3c435", "#ffffff") < 4.5


def test_exige_a_permissao_de_associados(client, db, auth_headers):
    m = _guardar(client, auth_headers, "Para a permissão")
    so_financeiro = _headers(_criar_usuario_com_permissao(db, "financeiro"))
    assert client.get("/api/credenciais/modelos", headers=so_financeiro).status_code == 403
    assert client.get("/api/credenciais/modelo-em-uso", headers=so_financeiro).status_code == 403
    assert client.get(f"/api/credenciais/modelos/{m['id_modelo']}", headers=so_financeiro).status_code == 403
    assert client.post("/api/credenciais/modelos", json={"nome": "x", "desenho": _pronto()}, headers=so_financeiro).status_code == 403
    assert client.put(f"/api/credenciais/modelos/{m['id_modelo']}", json={"nome": "x", "desenho": _pronto()}, headers=so_financeiro).status_code == 403
    assert client.post(f"/api/credenciais/modelos/{m['id_modelo']}/usar", headers=so_financeiro).status_code == 403
    assert client.delete(f"/api/credenciais/modelos/{m['id_modelo']}", headers=so_financeiro).status_code == 403
    assert client.get("/api/credenciais/modelos").status_code == 401
    assert client.delete(f"/api/credenciais/modelos/{m['id_modelo']}", headers=auth_headers).status_code == 200
