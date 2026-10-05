"""v2.1 (FASE 2) - Mandato, cargo concedendo/revogando permissão automaticamente por vigência
(sem cron), vacância (Art. 26) e declaração de conflito de interesse."""
from datetime import date, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.pessoas import Pessoa
from app.security import hash_senha, usuario_tem_permissao


def _criar_associado_nivel_associado(db, nome="Dirigente Teste", email=None) -> Associado:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=email or f"{nome.lower().replace(' ', '.')}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    return associado


def test_criar_mandato_com_orgao_ou_cargo_invalido_falha(client, auth_headers, db):
    associado = _criar_associado_nivel_associado(db, nome="Fulano Cargo Invalido")
    r = client.post(
        "/api/mandatos/", headers=auth_headers,
        json={"id_associado": associado.id_associado, "orgao_codigo": "ORGAO_QUE_NAO_EXISTE", "cargo_codigo": "PRESIDENTE", "data_inicio": str(date.today())},
    )
    assert r.status_code == 400


def test_criar_mandato_usa_duracao_estatutaria_por_padrao(client, auth_headers, db):
    associado = _criar_associado_nivel_associado(db, nome="Fulano Duracao Padrao")
    r = client.post(
        "/api/mandatos/", headers=auth_headers,
        json={"id_associado": associado.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "SECRETARIO", "data_inicio": "2026-01-01"},
    )
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["data_fim_previsto"].startswith("2030-01-01")  # DURACAO_MANDATO_ANOS = 4 (Art. 25/32)
    assert corpo["vigente"] is True


def test_cargo_concede_permissao_automaticamente_e_revoga_ao_encerrar(client, auth_headers, db):
    associado = _criar_associado_nivel_associado(db, nome="Fulano Tesoureiro")
    usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
    assert usuario_tem_permissao(db, usuario, "financeiro") is False  # nível "Associado" sozinho não tem

    r = client.post(
        "/api/mandatos/", headers=auth_headers,
        json={
            "id_associado": associado.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "TESOUREIRO",
            "data_inicio": str(date.today() - timedelta(days=1)), "data_fim_previsto": str(date.today() + timedelta(days=365)),
        },
    )
    assert r.status_code == 200, r.text
    id_mandato = r.json()["id_mandato"]

    db.expire_all()
    assert usuario_tem_permissao(db, usuario, "financeiro") is True  # cargo TESOUREIRO concede "financeiro"
    assert usuario_tem_permissao(db, usuario, "governanca") is False  # só a permissão do cargo, nada além

    r = client.post(f"/api/mandatos/{id_mandato}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    assert r.status_code == 200, r.text
    assert r.json()["vaga_aberta"] is True  # nenhum outro TESOUREIRO vigente na Diretoria Executiva

    db.expire_all()
    assert usuario_tem_permissao(db, usuario, "financeiro") is False  # revogada junto com o encerramento


def test_encerrar_mandato_ja_encerrado_falha(client, auth_headers, db):
    associado = _criar_associado_nivel_associado(db, nome="Fulano Duplo Encerramento")
    r = client.post(
        "/api/mandatos/", headers=auth_headers,
        json={"id_associado": associado.id_associado, "orgao_codigo": "CONSELHO_FISCAL", "cargo_codigo": "CONSELHO_FISCAL", "data_inicio": str(date.today())},
    )
    id_mandato = r.json()["id_mandato"]
    client.post(f"/api/mandatos/{id_mandato}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    r2 = client.post(f"/api/mandatos/{id_mandato}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    assert r2.status_code == 400


def test_mandatos_vencendo_traz_so_quem_vence_na_janela(client, auth_headers, db):
    associado = _criar_associado_nivel_associado(db, nome="Fulano Vencendo")
    client.post(
        "/api/mandatos/", headers=auth_headers,
        json={
            "id_associado": associado.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "SECRETARIO",
            "data_inicio": str(date.today() - timedelta(days=10)), "data_fim_previsto": str(date.today() + timedelta(days=5)),
        },
    )
    r = client.get("/api/mandatos/vencendo?dias=7", headers=auth_headers)
    assert r.status_code == 200
    assert any(m["id_associado"] == associado.id_associado for m in r.json())

    r_curto = client.get("/api/mandatos/vencendo?dias=1", headers=auth_headers)
    assert not any(m["id_associado"] == associado.id_associado for m in r_curto.json())


def test_declaracao_conflito_interesse_ciclo_completo(client, auth_headers, db):
    associado = _criar_associado_nivel_associado(db, nome="Fulano Conflito")
    r = client.post(
        "/api/mandatos/conflitos-interesse", headers=auth_headers,
        json={"id_associado": associado.id_associado, "descricao": "Parente é sócio de fornecedor da ASAF."},
    )
    assert r.status_code == 200, r.text
    id_declaracao = r.json()["id_declaracao"]

    ativas = client.get("/api/mandatos/conflitos-interesse", headers=auth_headers).json()
    assert any(d["id_declaracao"] == id_declaracao for d in ativas)

    client.put(f"/api/mandatos/conflitos-interesse/{id_declaracao}/encerrar", headers=auth_headers)
    ativas_depois = client.get("/api/mandatos/conflitos-interesse", headers=auth_headers).json()
    assert not any(d["id_declaracao"] == id_declaracao for d in ativas_depois)


def _me(client, usuario, id_nivel_impersonado=None):
    from app.security import criar_access_token

    token = criar_access_token(usuario, id_nivel_impersonado=id_nivel_impersonado)
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return r.json()


def test_menu_do_painel_mostra_as_permissoes_do_cargo_nao_so_as_do_nivel(client, auth_headers, db):
    """Achado AO VIVO na homologação (2026-10-05): o Secretário de teste entrava e o painel dizia "Nenhum módulo disponível", porque
    /auth/me só devolvia as permissões do NÍVEL e não as do cargo em mandato vigente, que o servidor já aceitava."""
    associado = _criar_associado_nivel_associado(db, nome="Fulano Menu Do Cargo")
    usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
    assert "financeiro" not in _me(client, usuario)["permissoes"]

    r = client.post(
        "/api/mandatos/", headers=auth_headers,
        json={
            "id_associado": associado.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "TESOUREIRO",
            "data_inicio": str(date.today() - timedelta(days=1)), "data_fim_previsto": str(date.today() + timedelta(days=365)),
        },
    )
    assert r.status_code == 200, r.text
    id_mandato = r.json()["id_mandato"]

    db.expire_all()
    permissoes = _me(client, usuario)["permissoes"]
    assert "financeiro" in permissoes and "parcerias" in permissoes, "o cargo TESOUREIRO concede financeiro e parcerias"
    assert "governanca" not in permissoes, "só o que o cargo concede, nada além"
    assert permissoes == sorted(set(permissoes)), "sem repetição, em ordem estável"
    assert usuario_tem_permissao(db, usuario, "financeiro") is True, "o menu e o servidor dizem a mesma coisa"

    client.post(f"/api/mandatos/{id_mandato}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    db.expire_all()
    assert "financeiro" not in _me(client, usuario)["permissoes"], "encerrou o mandato, o menu perde junto"


def test_ver_como_nao_vaza_as_permissoes_do_cargo_do_usuario_real(client, auth_headers, db):
    """No modo "ver como" o menu reflete SÓ o nível visto, nunca as permissões extras do cargo de quem está por trás."""
    associado = _criar_associado_nivel_associado(db, nome="Fulano Ver Como")
    usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
    client.post(
        "/api/mandatos/", headers=auth_headers,
        json={
            "id_associado": associado.id_associado, "orgao_codigo": "DIRETORIA_EXECUTIVA", "cargo_codigo": "TESOUREIRO",
            "data_inicio": str(date.today() - timedelta(days=1)), "data_fim_previsto": str(date.today() + timedelta(days=365)),
        },
    )
    db.expire_all()
    nivel_associado = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    assert "financeiro" in _me(client, usuario)["permissoes"]
    vendo_como = _me(client, usuario, id_nivel_impersonado=nivel_associado.id_nivel)
    assert "financeiro" not in vendo_como["permissoes"], "o cargo real não vaza para dentro do 'ver como'"
