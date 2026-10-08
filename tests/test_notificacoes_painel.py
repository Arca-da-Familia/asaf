"""v5.4h - O sino do painel: cada pessoa vê e marca como lidos só os avisos dela; os não lidos vêm primeiro; ler não apaga."""
import uuid

from app.services import notificacoes_painel
from tests.test_conselho_fiscal import _criar_associado, _headers


def _usuario(db):
    return _criar_associado(db, f"Pessoa Do Sino {uuid.uuid4().hex[:6]}")[1]


def test_exige_login(client):
    assert client.get("/api/minhas-notificacoes/").status_code == 401
    assert client.post("/api/minhas-notificacoes/marcar-todas-lidas").status_code == 401
    assert client.post("/api/minhas-notificacoes/1/lida").status_code == 401


def test_cada_um_ve_so_os_seus_avisos_e_os_nao_lidos_vem_primeiro(client, db):
    ana, bia = _usuario(db), _usuario(db)
    notificacoes_painel.notificar(db, [ana.id_usuario], tipo="teste", titulo="Primeiro aviso", texto="texto 1", link="/a")
    db.commit()
    notificacoes_painel.notificar(db, [ana.id_usuario, bia.id_usuario, bia.id_usuario], tipo="teste", titulo="Segundo aviso")
    db.commit()

    da_ana = client.get("/api/minhas-notificacoes/", headers=_headers(ana)).json()
    assert da_ana["nao_lidas"] == 2 and [a["titulo"] for a in da_ana["avisos"]] == ["Segundo aviso", "Primeiro aviso"], "mais novo primeiro"
    da_bia = client.get("/api/minhas-notificacoes/", headers=_headers(bia)).json()
    assert [a["titulo"] for a in da_bia["avisos"]] == ["Segundo aviso"], "o mesmo usuário repetido na lista recebe um aviso só"

    # ler o mais novo manda ele para depois dos não lidos; não apaga
    primeiro_da_lista = da_ana["avisos"][0]["id_notificacao"]
    lido = client.post(f"/api/minhas-notificacoes/{primeiro_da_lista}/lida", headers=_headers(ana)).json()
    assert lido["lida"] is True
    depois = client.get("/api/minhas-notificacoes/", headers=_headers(ana)).json()
    assert depois["nao_lidas"] == 1 and [a["titulo"] for a in depois["avisos"]] == ["Primeiro aviso", "Segundo aviso"]
    assert [a["lida"] for a in depois["avisos"]] == [False, True]


def test_ninguem_mexe_no_aviso_dos_outros_e_marcar_todas_so_marca_as_proprias(client, db):
    ana, bia = _usuario(db), _usuario(db)
    notificacoes_painel.notificar(db, [ana.id_usuario, bia.id_usuario], tipo="teste", titulo="Aviso para as duas")
    db.commit()
    id_da_ana = client.get("/api/minhas-notificacoes/", headers=_headers(ana)).json()["avisos"][0]["id_notificacao"]
    assert client.post(f"/api/minhas-notificacoes/{id_da_ana}/lida", headers=_headers(bia)).status_code == 404, "o aviso da Ana não é da Bia"
    assert client.post("/api/minhas-notificacoes/marcar-todas-lidas", headers=_headers(ana)).json() == {"marcadas": 1}
    assert client.get("/api/minhas-notificacoes/", headers=_headers(ana)).json()["nao_lidas"] == 0
    assert client.get("/api/minhas-notificacoes/", headers=_headers(bia)).json()["nao_lidas"] == 1
    assert client.post("/api/minhas-notificacoes/marcar-todas-lidas", headers=_headers(ana)).json() == {"marcadas": 0}
