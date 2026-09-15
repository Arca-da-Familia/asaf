"""v2.3 (FASE 2) - condução da sessão: credenciamento (QR/manual), quórum em tempo real,
itens de pauta e ocorrências. Tudo exige a sessão 'Em andamento'."""
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.financeiro import TituloFinanceiro
from app.models.pessoas import Pessoa

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_associado(db, nome, inadimplente=False) -> Associado:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"{nome.lower().replace(' ', '.')}@teste.local", senha_hash="x", id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    if inadimplente:
        db.add(TituloFinanceiro(
            id_associado=associado.id_associado, tipo_titulo="Mensalidade", descricao="teste",
            valor_original=50, saldo_devedor=50, status="Pendente", data_vencimento=datetime.utcnow() - timedelta(days=60),
        ))
        db.commit()
    return associado


def _criar_assembleia_em_andamento(client, auth_headers, pauta="Pauta de teste") -> int:
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": pauta, "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    r2 = client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "Em andamento"
    return id_assembleia


def test_abrir_sessao_fora_do_status_convocada_falha(client, auth_headers):
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "x teste", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    r2 = client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    assert r2.status_code == 400  # ainda 'Rascunho', não 'Convocada'


def test_credenciar_fora_da_sessao_em_andamento_falha(client, auth_headers, db):
    associado = _criar_associado(db, "Fulano Fora Sessao")
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "x teste", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)  # convocada, mas sessão não aberta
    r2 = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "id_associado": associado.id_associado})
    assert r2.status_code == 400


def test_credenciamento_manual_e_quorum_em_tempo_real(client, auth_headers, db):
    habilitados = [_criar_associado(db, f"Habilitado Sessao {i}") for i in range(3)]
    inadimplente = _criar_associado(db, "Inadimplente Sessao", inadimplente=True)
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)

    for a in habilitados[:2]:
        r = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "id_associado": a.id_associado})
        assert r.status_code == 200, r.text
    r_inad = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Remoto", "id_associado": inadimplente.id_associado})
    assert r_inad.status_code == 200, r_inad.text  # inadimplente pode comparecer, só não conta pro quórum

    quorum = client.get(f"/api/assembleias/{id_assembleia}/quorum", headers=auth_headers).json()
    assert quorum["total_habilitados"] >= 3  # base cumulativa entre testes - não afirma o total exato
    assert quorum["credenciados_habilitados"] == 2  # o inadimplente não entra na conta

    credenciamentos = client.get(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers).json()
    assert len(credenciamentos) == 3


def test_credenciar_duas_vezes_o_mesmo_associado_falha(client, auth_headers, db):
    associado = _criar_associado(db, "Fulano Duplo Credenciamento")
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    corpo = {"modalidade": "Presencial", "id_associado": associado.id_associado}
    client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json=corpo)
    r2 = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json=corpo)
    assert r2.status_code == 400


def test_credenciar_por_qr_carteirinha(client, auth_headers, db):
    associado = _criar_associado(db, "Fulano QR Assembleia")
    token = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()["token"]
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)

    r = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "token_carteirinha": token})
    assert r.status_code == 200, r.text
    assert r.json()["id_associado"] == associado.id_associado


def test_registrar_saida_credenciamento(client, auth_headers, db):
    associado = _criar_associado(db, "Fulano Saida Sessao")
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    r = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "id_associado": associado.id_associado})
    id_credenciamento = r.json()["id_credenciamento"]

    r2 = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos/{id_credenciamento}/saida", headers=auth_headers)
    assert r2.status_code == 200

    quorum = client.get(f"/api/assembleias/{id_assembleia}/quorum", headers=auth_headers).json()
    assert quorum["credenciados_habilitados"] == 0  # saída não conta mais pro quórum

    r3 = client.post(f"/api/assembleias/{id_assembleia}/credenciamentos/{id_credenciamento}/saida", headers=auth_headers)
    assert r3.status_code == 400  # já registrada


def test_item_de_pauta_ciclo_de_status(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    r = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta", headers=auth_headers, json={"titulo": "Aprovação de contas"})
    assert r.status_code == 200, r.text
    id_item = r.json()["id_item"]
    assert r.json()["status"] == "Aguardando"

    r_disc = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/abrir-discussao", headers=auth_headers)
    assert r_disc.json()["status"] == "Em discussão"

    r_vot = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/abrir-votacao", headers=auth_headers)
    assert r_vot.status_code == 200
    assert r_vot.json()["status"] == "Em votação"
    assert r_vot.json()["aberto_em"] is not None

    r_enc = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/encerrar", headers=auth_headers)
    assert r_enc.json()["status"] == "Encerrado"
    assert r_enc.json()["encerrado_em"] is not None

    r_enc_de_novo = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta/{id_item}/encerrar", headers=auth_headers)
    assert r_enc_de_novo.status_code == 400

    itens = client.get(f"/api/assembleias/{id_assembleia}/itens-pauta", headers=auth_headers).json()
    assert len(itens) == 1


def test_ocorrencia_vinculada_a_item_de_pauta(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_item = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta", headers=auth_headers, json={"titulo": "Item com ocorrência"}).json()["id_item"]

    r = client.post(f"/api/assembleias/{id_assembleia}/ocorrencias", headers=auth_headers, json={"descricao": "Associado protestou contra o encaminhamento.", "id_item_pauta": id_item})
    assert r.status_code == 200, r.text

    ocorrencias = client.get(f"/api/assembleias/{id_assembleia}/ocorrencias", headers=auth_headers).json()
    assert len(ocorrencias) == 1
    assert ocorrencias[0]["id_item_pauta"] == id_item


def test_encerrar_sessao_muda_status_para_realizada(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    r = client.post(f"/api/assembleias/{id_assembleia}/encerrar-sessao", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "Realizada"

    # sessão encerrada não aceita mais credenciamento.
    r2 = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta", headers=auth_headers, json={"titulo": "Item tardio"})
    assert r2.status_code == 400
