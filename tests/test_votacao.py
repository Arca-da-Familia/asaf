"""v2.4 (FASE 2) - motor de votação: quórum checado na abertura, voto aberto x secreto (o
secreto de verdade desacoplado - ver app/models/votacao.py), apuração com hash de integridade,
empate e impugnação."""
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.pessoas import Pessoa
from app.models.votacao import ComprovanteVotoSecreto, RegistroVotoSecreto, Votacao
from app.security import criar_access_token, hash_senha
from app.services.votacao import _hash_resultado

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


def _criar_assembleia_com_item_em_andamento(client, auth_headers) -> tuple[int, int]:
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Extraordinária", "pauta": "Pauta de votação", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    id_item = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta", headers=auth_headers, json={"titulo": "Item de votação"}).json()["id_item"]
    return id_assembleia, id_item


def _credenciar_todos_habilitados(client, auth_headers, id_assembleia):
    """Credencia todo mundo habilitado (base cumulativa entre testes) - garante quórum atingido
    em qualquer convocação, sem depender de contar quantos associados já existem no banco."""
    habilitados = client.get(f"/api/assembleias/{id_assembleia}/habilitados?apenas_habilitados=true", headers=auth_headers).json()
    for h in habilitados:
        client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "id_associado": h["id_associado"]})


def test_abrir_votacao_sem_quorum_falha(client, auth_headers):
    _id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    r = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Aprovar contas", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"]},
    )
    assert r.status_code == 400
    assert "Quórum" in r.json()["detail"]


def test_votacao_aberta_fluxo_completo_e_apuracao(client, auth_headers, db):
    votantes = [_criar_associado_com_login(db, f"Votante Aberta {i}") for i in range(3)]
    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)

    r = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Aprovar contas", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"]},
    )
    assert r.status_code == 200, r.text
    id_votacao = r.json()["id_votacao"]

    (assoc1, u1), (assoc2, u2), (assoc3, u3) = votantes
    for associado, usuario, opcao in [(assoc1, u1, "Sim"), (assoc2, u2, "Sim"), (assoc3, u3, "Não")]:
        rv = client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(usuario), json={"opcao": opcao})
        assert rv.status_code == 200, rv.text

    # não pode votar de novo
    r_dup = client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(u1), json={"opcao": "Não"})
    assert r_dup.status_code == 400

    r_enc = client.post(f"/api/votacoes/{id_votacao}/encerrar", headers=auth_headers)
    assert r_enc.status_code == 200, r_enc.text
    corpo = r_enc.json()
    assert corpo["status"] == "Encerrada"
    assert corpo["vencedor"] == "Sim"
    assert corpo["aprovado"] is True
    assert corpo["resultado_contagem"] == {"Sim": 2, "Não": 1}
    assert corpo["resultado_hash"]


def test_associado_nao_habilitado_nao_pode_votar(client, auth_headers, db):
    from app.models.financeiro import TituloFinanceiro

    inadimplente, usuario = _criar_associado_com_login(db, "Votante Inadimplente")
    db.add(TituloFinanceiro(
        id_associado=inadimplente.id_associado, tipo_titulo="Mensalidade", descricao="teste",
        valor_original=50, saldo_devedor=50, status="Pendente", data_vencimento=datetime.utcnow() - timedelta(days=60),
    ))
    db.commit()

    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)
    id_votacao = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Votacao teste", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"]},
    ).json()["id_votacao"]

    r = client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(usuario), json={"opcao": "Sim"})
    assert r.status_code == 403


def test_votacao_secreta_desacoplada_de_verdade(client, auth_headers, db):
    votantes = [_criar_associado_com_login(db, f"Votante Secreta {i}") for i in range(2)]
    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)

    id_votacao = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Eleição diretoria", "tipo": "Secreta", "escrutinio": "Maioria simples", "opcoes": ["Chapa A", "Chapa B"]},
    ).json()["id_votacao"]

    (assoc1, u1), (assoc2, u2) = votantes
    client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(u1), json={"opcao": "Chapa A"})
    client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(u2), json={"opcao": "Chapa B"})

    comprovantes = db.query(ComprovanteVotoSecreto).filter(ComprovanteVotoSecreto.id_votacao == id_votacao).all()
    registros = db.query(RegistroVotoSecreto).filter(RegistroVotoSecreto.id_votacao == id_votacao).all()
    assert {c.id_associado for c in comprovantes} == {assoc1.id_associado, assoc2.id_associado}
    assert len(registros) == 2
    # nem uma consulta SQL direta reconstrói pessoa↔voto: a tabela do voto em si não tem coluna
    # nenhuma que aponte pra associado - é estrutural, não convenção de código.
    assert not hasattr(RegistroVotoSecreto, "id_associado")
    assert {r.opcao for r in registros} == {"Chapa A", "Chapa B"}

    r_enc = client.post(f"/api/votacoes/{id_votacao}/encerrar", headers=auth_headers)
    assert r_enc.status_code == 200
    # resultado exposto pela API é só a contagem agregada - nunca quem votou o quê.
    assert set(r_enc.json()["resultado_contagem"].keys()) == {"Chapa A", "Chapa B"}


def test_hash_do_resultado_muda_se_um_voto_for_alterado_depois(client, auth_headers, db):
    (assoc1, u1), = [_criar_associado_com_login(db, "Votante Hash")]
    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)
    id_votacao = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Votacao teste", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"]},
    ).json()["id_votacao"]
    client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(u1), json={"opcao": "Sim"})
    resultado = client.post(f"/api/votacoes/{id_votacao}/encerrar", headers=auth_headers).json()
    hash_original = resultado["resultado_hash"]

    votacao = db.query(Votacao).filter(Votacao.id_votacao == id_votacao).first()
    from app.models.votacao import VotoAberto
    voto = db.query(VotoAberto).filter(VotoAberto.id_votacao == id_votacao).first()
    voto.opcao = "Não"
    db.commit()
    novo_hash = _hash_resultado(db, votacao)
    assert novo_hash != hash_original


def test_escrutinio_qualificado_exige_fracao_configurada(client, auth_headers, db):
    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    r = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Reforma do estatuto", "tipo": "Aberta/Nominal", "escrutinio": "Qualificada", "opcoes": ["Sim", "Não"]},
    )
    assert r.status_code == 422  # falta fracao_qualificada


def test_empate_registrado_e_resolvido_manualmente(client, auth_headers, db):
    votantes = [_criar_associado_com_login(db, f"Votante Empate {i}") for i in range(2)]
    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)
    id_votacao = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Eleição empatada", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Candidato A", "Candidato B"]},
    ).json()["id_votacao"]

    (assoc1, u1), (assoc2, u2) = votantes
    client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(u1), json={"opcao": "Candidato A"})
    client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(u2), json={"opcao": "Candidato B"})

    resultado = client.post(f"/api/votacoes/{id_votacao}/encerrar", headers=auth_headers).json()
    assert resultado["empate"] is True
    assert resultado["aprovado"] is None

    r_resolve = client.post(
        f"/api/votacoes/{id_votacao}/resolver-empate", headers=auth_headers,
        json={"vencedor": "Candidato A", "justificativa": "Voto de minerva do Presidente, conforme decisão registrada em ata."},
    )
    assert r_resolve.status_code == 200
    assert r_resolve.json()["vencedor"] == "Candidato A"
    assert r_resolve.json()["aprovado"] is True
    assert r_resolve.json()["empate"] is False


def test_impugnacao_ciclo_completo(client, auth_headers, db):
    votante, usuario = _criar_associado_com_login(db, "Votante Impugnador")
    id_assembleia, id_item = _criar_assembleia_com_item_em_andamento(client, auth_headers)
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)
    id_votacao = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Votacao teste", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"]},
    ).json()["id_votacao"]

    r = client.post(f"/api/votacoes/{id_votacao}/impugnacoes", headers=_headers(usuario), json={"motivo": "Cédula distribuída fora do prazo regimental."})
    assert r.status_code == 200, r.text
    id_impugnacao = r.json()["id_impugnacao"]

    listadas = client.get(f"/api/votacoes/{id_votacao}/impugnacoes", headers=auth_headers).json()
    assert any(i["id_impugnacao"] == id_impugnacao and not i["resolvida"] for i in listadas)

    r_resolver = client.post(f"/api/votacoes/impugnacoes/{id_impugnacao}/resolver", headers=auth_headers, json={"resolucao": "Improcedente - cédula distribuída dentro do prazo."})
    assert r_resolver.status_code == 200

    listadas_depois = client.get(f"/api/votacoes/{id_votacao}/impugnacoes", headers=auth_headers).json()
    assert next(i for i in listadas_depois if i["id_impugnacao"] == id_impugnacao)["resolvida"] is True
