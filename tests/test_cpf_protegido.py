"""v7.3a - o CPF escondido em toda lista e ficha (`***.***.***-NN`, um formato só) e o completo só por "Mostrar o CPF", registrado na Auditoria.

Decisão do Presidente (2026-10-29): veem o completo o Presidente, os Secretários e os Tesoureiros (`ver_cpf_completo`) e quem atende a solicitação de titular
aberta (só o CPF daquele pedido); os Vice-Presidentes e o Conselho Fiscal veem sempre escondido; a busca por CPF continua no servidor."""
import json
import uuid

import pytest

from app.models.atendimento import EM_ATENDIMENTO, ENCERRADO, Atendimento
from app.models.core import AuditLog
from app.services import cpf_protegido
from tests.test_atendimento import _enviar
from tests.test_compras import _criar_usuario_com_mandato
from tests.test_pessoas import _cpf_unico
from tests.apoio_auth import cabecalho_admin

_PAYLOAD = {"data_nascimento": "1990-01-01", "estado_civil": "SOLTEIRO", "categoria": "ATIVO", "telefone_whatsapp": "11987654321",
            "cep": "01310100", "logradouro": "Av. Paulista", "numero": "1000", "bairro": "Bela Vista", "cidade": "São Paulo", "uf": "SP"}


@pytest.mark.parametrize("valor, esperado", [
    ("52998224725", "***.***.***-25"), ("529.982.247-25", "***.***.***-25"), ("12.345.678/0001-95", "12.345.678/0001-95"), ("", None), (None, None),
])
def test_um_formato_so(valor, esperado):
    assert cpf_protegido.mascarar(valor) == esperado


def _associado(client) -> tuple[int, str]:
    from tests.test_compras import _PAYLOAD_BASE

    cpf = _cpf_unico()
    marca = uuid.uuid4().hex[:10]  # o nome e o e-mail não levam o CPF (o teste procura o CPF na resposta)
    r = client.post("/associados-master/", json={**_PAYLOAD_BASE, "nome_completo": f"Pessoa Cpf {marca}", "cpf": cpf, "email_contato": f"{marca}@cpf.example.com"},
                    headers=cabecalho_admin(client))
    assert r.status_code == 200, r.text
    return r.json()["id_associado"], cpf


def _sem_o_cpf(resposta, cpf: str) -> None:
    texto = json.dumps(resposta.json(), ensure_ascii=False)
    assert cpf not in texto and f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}" not in texto


def test_lista_ficha_e_seletor_nunca_trazem_o_cpf_inteiro_e_a_busca_continua(client, auth_headers):
    id_associado, cpf = _associado(client)
    lista = client.get("/api/associados/", params={"busca": cpf}, headers=auth_headers)
    assert lista.status_code == 200
    itens = lista.json()["itens"] if isinstance(lista.json(), dict) else lista.json()
    achado = next(a for a in itens if a["id_associado"] == id_associado)  # a busca pelo CPF inteiro acha (no servidor)
    assert achado["cpf_mascarado"] == f"***.***.***-{cpf[-2:]}"
    _sem_o_cpf(lista, cpf)
    ficha = client.get(f"/api/associados/{id_associado}", headers=auth_headers)
    assert ficha.json()["cpf_mascarado"] == f"***.***.***-{cpf[-2:]}"
    _sem_o_cpf(ficha, cpf)
    _sem_o_cpf(client.get("/api/associados/busca-simples", headers=auth_headers), cpf)


def test_o_presidente_mostra_o_cpf_e_a_auditoria_guarda_quem_viu_sem_o_numero(client, db, auth_headers):
    id_associado, cpf = _associado(client)
    r = client.post("/api/cpf/revelar", json={"origem": "associado", "id": id_associado}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"cpf": f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}"}
    registro = db.query(AuditLog).filter(AuditLog.acao == "CPF_REVELADO", AuditLog.id_registro_afetado == id_associado,
                                         AuditLog.tabela_afetada == "associados").one()
    assert cpf not in (registro.dados_depois or "") and "associado" in registro.dados_depois


def test_secretario_mostra_e_vice_presidente_e_conselho_fiscal_nao(client, db, auth_headers):
    id_associado, _ = _associado(client)
    _, secretario = _criar_usuario_com_mandato(client, auth_headers, "SECRETARIO")
    assert client.post("/api/cpf/revelar", json={"origem": "associado", "id": id_associado}, headers=secretario).status_code == 200
    _, vice = _criar_usuario_com_mandato(client, auth_headers, "VICE_PRESIDENTE")
    assert client.get(f"/api/associados/{id_associado}", headers=vice).status_code == 200  # ele vê a ficha, com o CPF escondido
    negado = client.post("/api/cpf/revelar", json={"origem": "associado", "id": id_associado}, headers=vice)
    assert negado.status_code == 403 and "Presidente, os Secretários e os Tesoureiros" in negado.json()["detail"]
    _, conselheiro = _criar_usuario_com_mandato(client, auth_headers, "CONSELHO_FISCAL", orgao_codigo="CONSELHO_FISCAL")
    assert client.post("/api/cpf/revelar", json={"origem": "associado", "id": id_associado}, headers=conselheiro).status_code == 403
    assert db.query(AuditLog).filter(AuditLog.acao == "CPF_REVELADO", AuditLog.id_registro_afetado == id_associado).count() == 1


def test_o_tesoureiro_mostra_o_cpf_do_doador_mas_nao_o_do_associado(client, auth_headers):
    from app.database import SessaoLocal
    from app.models.doacoes import Doacao
    from tests.test_doacoes import _criar_conta

    conta = _criar_conta(client, auth_headers, "Receita")
    _, tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    cpf = _cpf_unico()
    with SessaoLocal() as s:
        d = Doacao(anonima=False, nome_doador="Doador Cpf", documento_doador=cpf, tipo_doacao="Monetaria", valor=10,
                   id_conta_contabil=conta)
        s.add(d)
        s.commit()
        id_doacao = d.id_doacao
    lista = client.get("/api/doacoes/", headers=tesoureiro)
    _sem_o_cpf(lista, cpf)
    assert client.post("/api/cpf/revelar", json={"origem": "doacao", "id": id_doacao}, headers=tesoureiro).json()["cpf"].endswith(cpf[-2:])
    id_associado, _ = _associado(client)
    assert client.post("/api/cpf/revelar", json={"origem": "associado", "id": id_associado}, headers=tesoureiro).status_code == 403


def test_quem_atende_o_pedido_de_titular_aberto_ve_o_cpf_daquele_pedido_e_so_enquanto_aberto(client, db, auth_headers):
    """O 1º Vice-Presidente atende o pedido sobre os dados do Presidente (decisão de 2026-10-28): vê aquele CPF, nenhum outro."""
    cpf = _cpf_unico()
    r = _enviar(client, "TITULAR_LGPD", cpf=cpf)
    assert r.status_code == 200, r.text
    pedido = db.query(Atendimento).filter(Atendimento.protocolo == r.json()["protocolo"]).one()
    _, vice = _criar_usuario_com_mandato(client, auth_headers, "VICE_PRESIDENTE")
    id_vice = client.get("/auth/me", headers=vice).json()["id_usuario"]
    corpo = {"origem": "atendimento", "id": pedido.id_atendimento}
    assert client.post("/api/cpf/revelar", json=corpo, headers=vice).status_code == 403  # ainda não é o responsável

    pedido.id_responsavel, pedido.status = id_vice, EM_ATENDIMENTO
    db.commit()
    assert client.post("/api/cpf/revelar", json=corpo, headers=vice).json()["cpf"].endswith(cpf[-2:])
    outro_id, _ = _associado(client)
    assert client.post("/api/cpf/revelar", json={"origem": "associado", "id": outro_id}, headers=vice).status_code == 403

    pedido.status = ENCERRADO
    db.commit()
    assert client.post("/api/cpf/revelar", json=corpo, headers=vice).status_code == 403


def test_a_exportacao_leva_o_cpf_completo_so_com_a_permissao(client, db, auth_headers):
    from app.models.core import NivelAcesso, PermissaoSistema, Usuario, perfil_permissao

    r = client.get("/api/associados/exportar", params={"colunas": "nome_completo,cpf"}, headers=auth_headers)
    assert r.status_code == 200 and any(len(l["cpf"] or "") == 11 for l in r.json()["linhas"])
    # um nível só com a exportação (sem `ver_cpf_completo`): o CPF sai escondido
    _, headers = _criar_usuario_com_mandato(client, auth_headers, "VICE_PRESIDENTE_2")
    id_usuario = client.get("/auth/me", headers=headers).json()["id_usuario"]
    nivel = NivelAcesso(nome_nivel="Só exportar (teste v7.3a)", descricao="teste", is_conselho_fiscal=False)
    db.add(nivel)
    db.flush()
    id_exportar = db.query(PermissaoSistema.id_permissao).filter(PermissaoSistema.codigo_permissao == "exportar_dados_pessoais").scalar()
    db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=id_exportar))
    usuario = db.get(Usuario, id_usuario)
    usuario.id_nivel = nivel.id_nivel
    db.commit()
    r = client.get("/api/associados/exportar", params={"colunas": "nome_completo,cpf"}, headers=headers)
    assert r.status_code == 200, r.text
    assert all(l["cpf"] is None or l["cpf"].startswith("***.***.***-") for l in r.json()["linhas"])
    ultimo = db.query(AuditLog).filter(AuditLog.acao == "EXPORT").order_by(AuditLog.id_log.desc()).first()
    assert '"cpf_completo": false' in ultimo.dados_depois


def test_origem_desconhecida_e_registro_sem_cpf(client, auth_headers):
    assert client.post("/api/cpf/revelar", json={"origem": "fornecedor", "id": 1}, headers=auth_headers).status_code == 422
    assert client.post("/api/cpf/revelar", json={"origem": "associado", "id": 999_999}, headers=auth_headers).status_code == 404


# ------------------------------------------------------------------------------------------------ a migração a73c9f1e5b20
def test_a_migracao_da_a_permissao_a_presidencia_e_aos_cinco_cargos_e_nada_mais():
    import importlib.util
    from pathlib import Path

    import sqlalchemy as sa
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from tests.test_encarregado import _banco_existente, _do_cargo, _do_nivel, _rodar

    caminho = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "a73c9f1e5b20_v7_3a_ver_cpf_completo.py"
    especificacao = importlib.util.spec_from_file_location("migracao_cpf", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    motor = _banco_existente()  # Presidente (gerenciar_acesso), Diretoria (associados); cargos PRESIDENTE, VICE_PRESIDENTE(_2), SECRETARIO
    with motor.begin() as c:
        id_catalogo = c.execute(sa.text("SELECT id_catalogo FROM catalogos")).scalar()
        for codigo, permissoes in (("TESOUREIRO", ["financeiro"]), ("VICE_TESOUREIRO", ["financeiro"]), ("VICE_SECRETARIO", ["associados"]),
                                   ("CONSELHO_FISCAL", ["financeiro_auditar"])):
            c.execute(sa.insert(sa.table("opcoes_catalogo", sa.column("id_catalogo"), sa.column("codigo"), sa.column("rotulo"), sa.column("metadados", sa.JSON))),
                      {"id_catalogo": id_catalogo, "codigo": codigo, "rotulo": codigo, "metadados": {"permissoes": permissoes}})
    _rodar(motor, migracao.upgrade)
    _rodar(motor, migracao.upgrade)  # de novo: não duplica
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso", "ver_cpf_completo"} and _do_nivel(motor, "Diretoria") == {"associados"}
    for cargo in ("PRESIDENTE", "SECRETARIO", "VICE_SECRETARIO", "TESOUREIRO", "VICE_TESOUREIRO"):
        assert "ver_cpf_completo" in _do_cargo(motor, cargo), cargo
    for cargo in ("VICE_PRESIDENTE", "VICE_PRESIDENTE_2", "CONSELHO_FISCAL"):
        assert "ver_cpf_completo" not in _do_cargo(motor, cargo), cargo
    assert _do_cargo(motor, "TESOUREIRO") == {"financeiro", "ver_cpf_completo"}
    _rodar(motor, migracao.downgrade)
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso"} and _do_cargo(motor, "TESOUREIRO") == {"financeiro"}

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert diretorio.get_heads() == ["a73c9f1e5b20"] and diretorio.get_revision("a73c9f1e5b20").down_revision == "12f16313d972"
