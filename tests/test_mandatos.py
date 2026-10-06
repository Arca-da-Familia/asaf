"""v2.1 (FASE 2) - Mandato, cargo concedendo/revogando permissão automaticamente por vigência
(sem cron), vacância (Art. 26) e declaração de conflito de interesse."""
from datetime import date, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.pessoas import Pessoa
from tests.apoio_mandatos import liberar_cargo
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
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "SECRETARIO")
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

    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "TESOUREIRO")
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
    liberar_cargo(client, auth_headers, "CONSELHO_FISCAL", "CONSELHO_FISCAL")
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
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "SECRETARIO")
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

    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "TESOUREIRO")
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
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "TESOUREIRO")
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


def _posse(client, auth_headers, associado, orgao, cargo, inicio, fim=None):
    corpo = {"id_associado": associado.id_associado, "orgao_codigo": orgao, "cargo_codigo": cargo, "data_inicio": str(inicio)}
    if fim:
        corpo["data_fim_previsto"] = str(fim)
    return client.post("/api/mandatos/", headers=auth_headers, json=corpo)


def test_cargo_tem_um_titular_so_e_a_posse_de_outra_pessoa_e_recusada(client, auth_headers, db):
    # achado da v5.4d: o servidor dava posse a dois Presidentes ao mesmo tempo, e as permissões do cargo somavam nos dois (Art. 19).
    primeiro = _criar_associado_nivel_associado(db, nome="Primeiro Presidente Vaga")
    segundo = _criar_associado_nivel_associado(db, nome="Segundo Presidente Vaga")
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "PRESIDENTE")

    r1 = _posse(client, auth_headers, primeiro, "DIRETORIA_EXECUTIVA", "PRESIDENTE", date.today())
    assert r1.status_code == 200, r1.text
    r2 = _posse(client, auth_headers, segundo, "DIRETORIA_EXECUTIVA", "PRESIDENTE", date.today())
    assert r2.status_code == 409
    assert "ocupado" in r2.json()["detail"]
    # a mesma pessoa duas vezes no mesmo cargo também não
    r3 = _posse(client, auth_headers, primeiro, "DIRETORIA_EXECUTIVA", "PRESIDENTE", date.today() + timedelta(days=30))
    assert r3.status_code == 409
    assert "já tem mandato" in r3.json()["detail"]
    # outro cargo da mesma diretoria é outra vaga
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "VICE_SECRETARIO")
    assert _posse(client, auth_headers, segundo, "DIRETORIA_EXECUTIVA", "VICE_SECRETARIO", date.today()).status_code == 200


def test_vacancia_libera_a_vaga_no_mesmo_dia_e_o_sucessor_toma_posse_quando_o_mandato_acaba(client, auth_headers, db):
    atual = _criar_associado_nivel_associado(db, nome="Tesoureiro Que Sai Na Vaga")
    substituto = _criar_associado_nivel_associado(db, nome="Tesoureiro Que Entra Na Vaga")
    futuro = _criar_associado_nivel_associado(db, nome="Tesoureiro Do Proximo Mandato")
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "TESOUREIRO")

    fim = date.today() + timedelta(days=100)
    r_atual = _posse(client, auth_headers, atual, "DIRETORIA_EXECUTIVA", "TESOUREIRO", date.today() - timedelta(days=5), fim)
    assert r_atual.status_code == 200, r_atual.text
    # eleito para o mandato SEGUINTE: começa quando o atual acaba, então não sobrepõe
    assert _posse(client, auth_headers, futuro, "DIRETORIA_EXECUTIVA", "TESOUREIRO", fim).status_code == 200
    # começar antes do atual acabar, não
    assert _posse(client, auth_headers, substituto, "DIRETORIA_EXECUTIVA", "TESOUREIRO", fim - timedelta(days=10)).status_code == 409
    # vacância (renúncia) do atual: a vaga abre no mesmo instante, a posse de hoje passa
    client.post(f"/api/mandatos/{r_atual.json()['id_mandato']}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    r_sub = _posse(client, auth_headers, substituto, "DIRETORIA_EXECUTIVA", "TESOUREIRO", date.today(), fim - timedelta(days=1))
    assert r_sub.status_code == 200, r_sub.text


def test_conselho_fiscal_tem_tres_vagas_conforme_o_art_24(client, auth_headers, db):
    membros = [_criar_associado_nivel_associado(db, nome=f"Conselheiro Vaga {i}") for i in range(4)]
    liberar_cargo(client, auth_headers, "CONSELHO_FISCAL", "CONSELHO_FISCAL")
    for membro in membros[:3]:
        r = _posse(client, auth_headers, membro, "CONSELHO_FISCAL", "CONSELHO_FISCAL", date.today())
        assert r.status_code == 200, r.text
    r4 = _posse(client, auth_headers, membros[3], "CONSELHO_FISCAL", "CONSELHO_FISCAL", date.today())
    assert r4.status_code == 409
    assert "3 de 3" in r4.json()["detail"]


def test_posse_em_29_de_fevereiro_nao_derruba_o_servidor_quando_o_fim_cai_em_ano_nao_bissexto(client, auth_headers, db):
    # DURACAO_MANDATO_ANOS = 3 a partir de 29/02/2028 cai em 2031, que não é bissexto: antes dava erro 500 (data inexistente).
    associado = _criar_associado_nivel_associado(db, nome="Posse Bissexta")
    liberar_cargo(client, auth_headers, "DIRETORIA_EXECUTIVA", "VICE_TESOUREIRO")
    original = client.get("/api/estatuto/regras", headers=auth_headers).json()
    duracao = next(r["valor"] for r in original if r["parametro"] == "DURACAO_MANDATO_ANOS")
    try:
        client.put("/api/estatuto/regras/DURACAO_MANDATO_ANOS", headers=auth_headers, json={"valor": "3"})
        r = _posse(client, auth_headers, associado, "DIRETORIA_EXECUTIVA", "VICE_TESOUREIRO", "2028-02-29")
        assert r.status_code == 200, r.text
        assert r.json()["data_fim_previsto"].startswith("2031-02-28")
    finally:
        client.put("/api/estatuto/regras/DURACAO_MANDATO_ANOS", headers=auth_headers, json={"valor": duracao})
