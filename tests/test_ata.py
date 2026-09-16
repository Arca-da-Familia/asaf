"""v2.5 (FASE 2) - ata gerada do registro, imutável após assinatura (correção só por
retificação), deliberações com efeito automático e certidão numerada."""
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
    return associado, usuario


def _headers(usuario: Usuario) -> dict:
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def _criar_assembleia_em_andamento(client, auth_headers, pauta="Pauta de ata") -> int:
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": pauta, "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    return id_assembleia


def _credenciar_todos_habilitados(client, auth_headers, id_assembleia):
    habilitados = client.get(f"/api/assembleias/{id_assembleia}/habilitados?apenas_habilitados=true", headers=auth_headers).json()
    for h in habilitados:
        client.post(f"/api/assembleias/{id_assembleia}/credenciamentos", headers=auth_headers, json={"modalidade": "Presencial", "id_associado": h["id_associado"]})


def _criar_ata(client, auth_headers, id_assembleia) -> int:
    return client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers).json()["id_ata"]


def test_gerar_ata_traz_pauta_presenca_e_votacao(client, auth_headers, db):
    votante, usuario = _criar_associado_com_login(db, "Votante Ata")
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers, pauta="Aprovação de contas anuais")
    _credenciar_todos_habilitados(client, auth_headers, id_assembleia)
    id_item = client.post(f"/api/assembleias/{id_assembleia}/itens-pauta", headers=auth_headers, json={"titulo": "Aprovar contas"}).json()["id_item"]
    id_votacao = client.post(
        f"/api/itens-pauta/{id_item}/votacoes", headers=auth_headers,
        json={"titulo": "Aprovar contas", "tipo": "Aberta/Nominal", "escrutinio": "Maioria simples", "opcoes": ["Sim", "Não"]},
    ).json()["id_votacao"]
    client.post(f"/api/votacoes/{id_votacao}/votar", headers=_headers(usuario), json={"opcao": "Sim"})
    client.post(f"/api/votacoes/{id_votacao}/encerrar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/ocorrencias", headers=auth_headers, json={"descricao": "Sessão transcorreu sem incidentes."})

    r = client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["status"] == "Rascunho"
    texto = corpo["corpo_texto"]
    assert "Aprovação de contas anuais" in texto
    assert votante.nome_completo in texto
    assert "vencedor: Sim" in texto
    assert "sem incidentes" in texto


def test_gerar_ata_duas_vezes_para_mesma_assembleia_falha(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    _criar_ata(client, auth_headers, id_assembleia)
    r2 = client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers)
    assert r2.status_code == 400


def test_assinar_ata_atribui_numero_sequencial_continuo(client, auth_headers):
    id_a1 = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata1 = _criar_ata(client, auth_headers, id_a1)
    r1 = client.post(f"/api/atas/{id_ata1}/assinar", headers=auth_headers)
    assert r1.status_code == 200
    numero1 = r1.json()["numero_sequencial"]
    assert r1.json()["status"] == "Assinada"

    id_a2 = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata2 = _criar_ata(client, auth_headers, id_a2)
    r2 = client.post(f"/api/atas/{id_ata2}/assinar", headers=auth_headers)
    assert r2.json()["numero_sequencial"] == numero1 + 1


def test_relato_secretaria_so_edita_enquanto_rascunho(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)

    r = client.put(f"/api/atas/{id_ata}/relato-secretaria", headers=auth_headers, json={"relato_secretaria": "Sessão conduzida sem incidentes relevantes."})
    assert r.status_code == 200, r.text
    assert r.json()["relato_secretaria"] == "Sessão conduzida sem incidentes relevantes."

    client.post(f"/api/atas/{id_ata}/assinar", headers=auth_headers)
    r2 = client.put(f"/api/atas/{id_ata}/relato-secretaria", headers=auth_headers, json={"relato_secretaria": "Tentativa depois de assinada."})
    assert r2.status_code == 400


def test_retificar_exige_ata_assinada_e_preserva_original(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)

    r_cedo = client.post(f"/api/atas/{id_ata}/retificar", headers=auth_headers, json={"motivo": "Erro de digitação no nome de um associado presente."})
    assert r_cedo.status_code == 400  # ainda em rascunho, não assinada

    client.post(f"/api/atas/{id_ata}/assinar", headers=auth_headers)
    r = client.post(f"/api/atas/{id_ata}/retificar", headers=auth_headers, json={"motivo": "Erro de digitação no nome de um associado presente."})
    assert r.status_code == 200, r.text
    retificacao = r.json()
    assert retificacao["id_ata_retificada"] == id_ata
    assert retificacao["status"] == "Rascunho"

    original = client.get(f"/api/atas/{id_ata}", headers=auth_headers).json()
    assert original["status"] == "Assinada"  # original nunca muda


def test_deliberacao_generica_ciclo_pendente_ate_concluida(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)

    r = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Genérica", "texto": "Contratar serviço de contabilidade externa."})
    assert r.status_code == 200, r.text
    id_deliberacao = r.json()["id_deliberacao"]
    assert r.json()["status_execucao"] == "Pendente"

    pendentes = client.get("/api/deliberacoes/pendentes", headers=auth_headers).json()
    assert any(d["id_deliberacao"] == id_deliberacao for d in pendentes)

    r_concluir = client.post(f"/api/deliberacoes/{id_deliberacao}/concluir", headers=auth_headers, json={"observacao": "Contrato assinado com a Contábil XYZ."})
    assert r_concluir.status_code == 200
    assert r_concluir.json()["status_execucao"] == "Concluída"

    pendentes_depois = client.get("/api/deliberacoes/pendentes", headers=auth_headers).json()
    assert not any(d["id_deliberacao"] == id_deliberacao for d in pendentes_depois)

    r_concluir_de_novo = client.post(f"/api/deliberacoes/{id_deliberacao}/concluir", headers=auth_headers, json={})
    assert r_concluir_de_novo.status_code == 400


def test_deliberacao_revogada_nao_aparece_mais_pendente(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)
    id_deliberacao = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Genérica", "texto": "Item que será revogado depois."}).json()["id_deliberacao"]

    r = client.post(f"/api/deliberacoes/{id_deliberacao}/revogar", headers=auth_headers, json={"motivo": "Perdeu o objeto - situação já resolvida por outro meio."})
    assert r.status_code == 200
    assert r.json()["status_execucao"] == "Revogada"

    pendentes = client.get("/api/deliberacoes/pendentes", headers=auth_headers).json()
    assert not any(d["id_deliberacao"] == id_deliberacao for d in pendentes)


def test_deliberacao_eleicao_concluida_cria_mandatos(client, auth_headers, db):
    eleito, _usuario = _criar_associado_com_login(db, "Eleito Diretoria")
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)
    id_deliberacao = client.post(
        f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers,
        json={"tipo": "Eleição", "texto": "Eleição da Diretoria Executiva para o quadriênio."},
    ).json()["id_deliberacao"]

    r = client.post(
        f"/api/deliberacoes/{id_deliberacao}/concluir", headers=auth_headers,
        json={
            "observacao": "Chapa única eleita por aclamação.",
            "mandatos_criar": [{
                "id_associado": eleito.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "PRESIDENTE",
                "data_inicio": str(datetime.utcnow().date()), "ato_origem": f"Deliberação #{id_deliberacao}",
            }],
        },
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["mandatos_criados"]) == 1

    mandatos = client.get(f"/api/mandatos/?id_associado={eleito.id_associado}", headers=auth_headers).json()
    assert any(m["cargo_codigo"] == "PRESIDENTE" for m in mandatos)


def test_deliberacao_reforma_estatuto_concluida_registra_pendencia(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)
    id_deliberacao = client.post(
        f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers,
        json={"tipo": "Reforma de estatuto", "texto": "Alteração do Art. 25 para mandato de 3 anos."},
    ).json()["id_deliberacao"]

    r = client.post(f"/api/deliberacoes/{id_deliberacao}/concluir", headers=auth_headers, json={})
    assert r.status_code == 200
    assert "pendencia" in r.json()
    assert "cartório" in r.json()["pendencia"]


def test_certidao_de_deliberacao_numeracao_sequencial(client, auth_headers):
    id_assembleia = _criar_assembleia_em_andamento(client, auth_headers)
    id_ata = _criar_ata(client, auth_headers, id_assembleia)
    id_deliberacao = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Genérica", "texto": "Deliberação para certidão."}).json()["id_deliberacao"]

    r1 = client.post(f"/api/deliberacoes/{id_deliberacao}/certidao", headers=auth_headers)
    assert r1.status_code == 200, r1.text
    r2 = client.post(f"/api/deliberacoes/{id_deliberacao}/certidao", headers=auth_headers)
    assert r2.json()["numero_sequencial"] == r1.json()["numero_sequencial"] + 1

    listadas = client.get(f"/api/deliberacoes/{id_deliberacao}/certidoes", headers=auth_headers).json()
    assert len(listadas) == 2
