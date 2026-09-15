"""v2.5.3b (FASE 2.5 - Painel, achado do usuário 2026-09-15) - autochamada por código da sessão,
justificativa de falta e "Minhas Assembleias". Presença/falta é sempre calculada (nunca gravada
em campo próprio) - ver app/services/chamada.py."""
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.pessoas import Pessoa
from app.security import criar_access_token, hash_senha

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_associado_com_login(db, nome) -> tuple[Associado, Usuario]:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"{nome.lower().replace(' ', '.')}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    db.refresh(usuario)
    return associado, usuario


def _headers(usuario: Usuario) -> dict:
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def _criar_assembleia_convocada(client, auth_headers) -> int:
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "Pauta de chamada", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    return id_assembleia


def _abrir_sessao(client, auth_headers, id_assembleia) -> int:
    r = client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    assert r.status_code == 200, r.text
    return id_assembleia


def test_codigo_chamada_so_existe_apos_abrir_sessao(client, auth_headers):
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)
    r_antes = client.get(f"/api/assembleias/{id_assembleia}/codigo-chamada", headers=auth_headers)
    assert r_antes.status_code == 400

    _abrir_sessao(client, auth_headers, id_assembleia)
    r_depois = client.get(f"/api/assembleias/{id_assembleia}/codigo-chamada", headers=auth_headers)
    assert r_depois.status_code == 200
    assert len(r_depois.json()["codigo_chamada"]) == 6


def test_codigo_chamada_exige_permissao_governanca(client, auth_headers, db):
    _outro, usuario_qualquer = _criar_associado_com_login(db, "Qualquer Chamada")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)
    _abrir_sessao(client, auth_headers, id_assembleia)

    r = client.get(f"/api/assembleias/{id_assembleia}/codigo-chamada", headers=_headers(usuario_qualquer))
    assert r.status_code == 403


def test_bater_presenca_com_codigo_correto(client, auth_headers, db):
    associado, usuario = _criar_associado_com_login(db, "Autochamada Feliz")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)
    _abrir_sessao(client, auth_headers, id_assembleia)
    codigo = client.get(f"/api/assembleias/{id_assembleia}/codigo-chamada", headers=auth_headers).json()["codigo_chamada"]

    r = client.post(
        f"/api/assembleias/{id_assembleia}/bater-presenca", headers=_headers(usuario),
        json={"codigo": codigo, "modalidade": "Presencial"},
    )
    assert r.status_code == 200, r.text

    credenciamentos = client.get(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers).json()
    assert any(c["id_associado"] == associado.id_associado for c in credenciamentos)

    # não pode bater de novo
    r_dup = client.post(
        f"/api/assembleias/{id_assembleia}/bater-presenca", headers=_headers(usuario),
        json={"codigo": codigo, "modalidade": "Presencial"},
    )
    assert r_dup.status_code == 400


def test_bater_presenca_com_codigo_errado_falha(client, auth_headers, db):
    _associado, usuario = _criar_associado_com_login(db, "Autochamada Errada")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)
    _abrir_sessao(client, auth_headers, id_assembleia)

    r = client.post(
        f"/api/assembleias/{id_assembleia}/bater-presenca", headers=_headers(usuario),
        json={"codigo": "000000", "modalidade": "Presencial"},
    )
    assert r.status_code == 400


def test_bater_presenca_fora_da_sessao_em_andamento_falha(client, auth_headers, db):
    _associado, usuario = _criar_associado_com_login(db, "Autochamada Cedo")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)  # convocada, sessão não aberta

    r = client.post(
        f"/api/assembleias/{id_assembleia}/bater-presenca", headers=_headers(usuario),
        json={"codigo": "000000", "modalidade": "Presencial"},
    )
    assert r.status_code == 400


def test_credenciamento_manual_so_apos_sessao_aberta_inclusive_realizada(client, auth_headers, db):
    associado, _usuario = _criar_associado_com_login(db, "Correcao Manual")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)

    r_cedo = client.post(
        f"/api/assembleias/{id_assembleia}/credenciamentos/manual", headers=auth_headers,
        json={"id_associado": associado.id_associado, "modalidade": "Presencial"},
    )
    assert r_cedo.status_code == 400  # ainda 'Convocada'

    _abrir_sessao(client, auth_headers, id_assembleia)
    client.post(f"/api/assembleias/{id_assembleia}/encerrar-sessao", headers=auth_headers)

    r_depois = client.post(
        f"/api/assembleias/{id_assembleia}/credenciamentos/manual", headers=auth_headers,
        json={"id_associado": associado.id_associado, "modalidade": "Presencial"},
    )
    assert r_depois.status_code == 200, r_depois.text  # 'Realizada' aceita correção manual


def test_justificativa_propria_nasce_pendente_e_aceite_muda_status_presenca(client, auth_headers, db):
    associado, usuario = _criar_associado_com_login(db, "Justificativa Propria")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)  # 'Convocada'

    r = client.post(
        f"/api/assembleias/{id_assembleia}/justificativas", headers=_headers(usuario),
        json={"motivo": "Viagem a trabalho já agendada antes da convocação."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Pendente"
    id_justificativa = r.json()["id_justificativa"]

    # duplicada falha
    r_dup = client.post(
        f"/api/assembleias/{id_assembleia}/justificativas", headers=_headers(usuario),
        json={"motivo": "Segunda tentativa."},
    )
    assert r_dup.status_code == 400

    # antes de decidir: status de presença ainda não é "Falta" (assembleia não terminou)
    minhas_antes = client.get("/api/minhas-assembleias", headers=_headers(usuario)).json()
    entrada_antes = next(m for m in minhas_antes if m["id_assembleia"] == id_assembleia)
    assert entrada_antes["status_presenca"] == "Pendente"

    r_decidir = client.post(f"/api/justificativas/{id_justificativa}/decidir", headers=auth_headers, json={"aceitar": True})
    assert r_decidir.status_code == 200
    assert r_decidir.json()["status"] == "Aceita"

    minhas_depois = client.get("/api/minhas-assembleias", headers=_headers(usuario)).json()
    entrada_depois = next(m for m in minhas_depois if m["id_assembleia"] == id_assembleia)
    assert entrada_depois["status_presenca"] == "Falta justificada"

    # decidir de novo falha (já decidida)
    r_decidir_de_novo = client.post(f"/api/justificativas/{id_justificativa}/decidir", headers=auth_headers, json={"aceitar": False})
    assert r_decidir_de_novo.status_code == 400


def test_justificativa_lancada_em_nome_de_outro_ja_nasce_aceita(client, auth_headers, db):
    associado, usuario = _criar_associado_com_login(db, "Justificativa Por Secretario")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)

    r = client.post(
        f"/api/assembleias/{id_assembleia}/justificativas", headers=auth_headers,
        json={"motivo": "App falhou no dia, secretário registrou depois.", "id_associado": associado.id_associado},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Aceita"

    # associado comum não pode lançar em nome de outro
    outro, usuario_outro = _criar_associado_com_login(db, "Nao Pode Lancar")
    r_negado = client.post(
        f"/api/assembleias/{id_assembleia}/justificativas", headers=_headers(usuario_outro),
        json={"motivo": "Tentando justificar por outro.", "id_associado": associado.id_associado},
    )
    assert r_negado.status_code == 403


def test_falta_sem_justificativa_so_aparece_apos_sessao_realizada(client, auth_headers, db):
    associado, usuario = _criar_associado_com_login(db, "Vai Faltar")
    id_assembleia = _criar_assembleia_convocada(client, auth_headers)
    _abrir_sessao(client, auth_headers, id_assembleia)

    minhas_em_andamento = client.get("/api/minhas-assembleias", headers=_headers(usuario)).json()
    entrada = next(m for m in minhas_em_andamento if m["id_assembleia"] == id_assembleia)
    assert entrada["status_presenca"] == "Pendente"  # sessão ainda rolando, não é falta ainda

    client.post(f"/api/assembleias/{id_assembleia}/encerrar-sessao", headers=auth_headers)

    minhas_depois = client.get("/api/minhas-assembleias", headers=_headers(usuario)).json()
    entrada_depois = next(m for m in minhas_depois if m["id_assembleia"] == id_assembleia)
    assert entrada_depois["status_presenca"] == "Falta"


def test_minhas_assembleias_nao_lista_assembleia_ainda_nao_convocada(client, auth_headers, db):
    _associado, usuario = _criar_associado_com_login(db, "Sem Habilitacao Ainda")
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "Rascunho puro", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]  # nunca convocada - sem HabilitadoAssembleia

    minhas = client.get("/api/minhas-assembleias", headers=_headers(usuario)).json()
    assert not any(m["id_assembleia"] == id_assembleia for m in minhas)
