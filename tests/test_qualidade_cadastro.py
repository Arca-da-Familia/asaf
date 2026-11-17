"""v1.8 (FASE 1) - qualidade permanente da base: recadastramento periódico, detector de
duplicidade contínuo (fila de revisão, nunca mescla sozinho), mesclagem com confirmação nomeada
e higienização de contato."""
from datetime import date, timedelta

from app.models.associados import Associado
from app.models.pessoas import Pessoa
from tests.test_pessoas import _cpf_unico
from tests.apoio_auth import cabecalho_admin


def _criar_associado(client, **overrides):
    cpf = _cpf_unico()
    payload = {
        # v1.8 - nome (e e-mail) únicos por padrão: o novo bloqueio de cadastro duplicado
        # (nome + outro dado pessoal batendo) trataria duas chamadas com o mesmo nome e mesmo
        # telefone como a mesma pessoa de propósito - é exatamente o que a v1.8 pediu.
        "nome_completo": f"Pessoa Qualidade Cadastro {cpf[-8:]}", "cpf": cpf, "email_contato": f"{cpf}@x.com",
        "telefone_whatsapp": "11900000000", "categoria": "Efetivo",
        "cep": "01000000", "logradouro": "Rua Teste", "numero": "1", "bairro": "Centro",
        "cidade": "Sao Paulo", "estado": "SP",
        **overrides,
    }
    return client.post("/associados-master/", json=payload, headers=cabecalho_admin(client)).json()


# ---------------------------------------------------------------------------
# Recadastramento periódico
# ---------------------------------------------------------------------------
def test_confirmar_dados_registra_data_e_aparece_na_ficha_360(client, auth_headers):
    meu_id_associado = client.get("/auth/me", headers=auth_headers).json()["id_associado"]

    antes = client.get(f"/api/associados/{meu_id_associado}/ficha-360", headers=auth_headers).json()
    assert antes["dados"]["recadastramento_pendente"] is True  # nunca confirmado ainda

    r = client.post("/auth/perfil/confirmar-dados", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["data_ultima_confirmacao"] is not None

    depois = client.get(f"/api/associados/{meu_id_associado}/ficha-360", headers=auth_headers).json()
    assert depois["dados"]["recadastramento_pendente"] is False
    assert depois["dados"]["data_ultima_confirmacao"] is not None


# ---------------------------------------------------------------------------
# Detector de duplicidade contínuo + fila de revisão
# ---------------------------------------------------------------------------
def test_escanear_duplicidade_fluxo_completo(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    dados_comuns = {"data_nascimento": "2000-06-15", "grau_parentesco": "OUTRO"}
    r1 = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "Nome Igual Nascimento Igual", **dados_comuns},
    )
    r2 = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "nome igual nascimento igual", **dados_comuns},  # mesmo nome, caixa/acento diferentes
    )
    id_a = r1.json()["id_pessoa_vinculada"]
    id_b = r2.json()["id_pessoa_vinculada"]

    escaneio = client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    assert escaneio.status_code == 200
    assert escaneio.json()["novos"] >= 1

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    par = next(
        (i for i in fila if {i["id_pessoa_a"], i["id_pessoa_b"]} == {id_a, id_b}), None,
    )
    assert par is not None
    assert par["tipo_sinal"] == "duplicidade_nome_nascimento"

    # Rodar de novo não duplica a mesma entrada pendente.
    escaneio2 = client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    fila_depois = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    quantidade_do_par = sum(1 for i in fila_depois if {i["id_pessoa_a"], i["id_pessoa_b"]} == {id_a, id_b})
    assert quantidade_do_par == 1


def test_ignorar_item_da_fila(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa
    dados_comuns = {"data_nascimento": "1999-03-03", "grau_parentesco": "OUTRO"}
    client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers, json={"nome_completo": "Par Ignorado A", **dados_comuns})
    client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers, json={"nome_completo": "Par Ignorado A", **dados_comuns})
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    item = next(i for i in fila if i["nome_pessoa_a"] == "Par Ignorado A" or i["nome_pessoa_b"] == "Par Ignorado A")

    r = client.post(f"/api/pessoas/fila-revisao/{item['id_fila']}/ignorar", headers=auth_headers)
    assert r.status_code == 200

    fila_pendente = client.get("/api/pessoas/fila-revisao?status=pendente", headers=auth_headers).json()
    assert all(i["id_fila"] != item["id_fila"] for i in fila_pendente)

    # v7.1 (achado ao vivo): procurar de novo não traz de volta o par que alguém julgou "não é duplicado"
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    fila_pendente = client.get("/api/pessoas/fila-revisao?status=pendente", headers=auth_headers).json()
    assert not [i for i in fila_pendente if "Par Ignorado A" in (i["nome_pessoa_a"], i["nome_pessoa_b"])], "o par ignorado voltou à fila"


# ---------------------------------------------------------------------------
# Mesclagem
# ---------------------------------------------------------------------------
def test_mesclar_pessoas_preserva_historico_e_apaga_absorvida(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == titular["id_associado"]).first().id_pessoa

    criado_a = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": "Duplicata Para Mesclar", "data_nascimento": "1995-07-07", "grau_parentesco": "OUTRO"},
    ).json()
    id_pessoa_mantida = criado_a["id_pessoa_vinculada"]

    id_pessoa_absorvida = db.query(Pessoa).filter(Pessoa.nome_completo == "Fulano Absorvido").first()
    if id_pessoa_absorvida is None:
        pessoa_absorvida = Pessoa(nome_completo="Fulano Absorvido", email_contato="absorvido@x.com")
        db.add(pessoa_absorvida)
        db.commit()
        db.refresh(pessoa_absorvida)
        id_pessoa_absorvida = pessoa_absorvida
    id_pessoa_absorvida = id_pessoa_absorvida.id_pessoa

    r_errado = client.post(
        f"/api/pessoas/{id_pessoa_mantida}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": id_pessoa_absorvida, "nome_confirmacao": "Nome Errado"},
    )
    assert r_errado.status_code == 400

    r = client.post(
        f"/api/pessoas/{id_pessoa_mantida}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": id_pessoa_absorvida, "nome_confirmacao": "Fulano Absorvido"},
    )
    assert r.status_code == 200, r.text

    ainda_existe = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_absorvida).first()
    assert ainda_existe is None

    mantida = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa_mantida).first()
    assert mantida.email_contato == "absorvido@x.com"  # preencheu o campo que estava vazio


# ---------------------------------------------------------------------------
# v9.5 (decisão do Presidente, 13/11/2026): dois cadastros de associado da mesma pessoa - fica a matrícula mais antiga e o número
# que fica livre vai para o próximo associado novo
# ---------------------------------------------------------------------------
def _dois_associados(client, db, prefixo):
    """Dois cadastros de associado (o primeiro mais antigo), com endereço, e-mail e telefone diferentes."""
    from datetime import datetime

    antigo = _criar_associado(client, nome_completo=f"{prefixo} Nonato da Silva", telefone_whatsapp="91988881234", cidade="Belem", estado="PA")
    novo = _criar_associado(client, nome_completo=f"{prefixo} N. da Silva", telefone_whatsapp="91991234567", cidade="Ananindeua", estado="PA")
    a_antigo = db.query(Associado).filter(Associado.id_associado == antigo["id_associado"]).first()
    a_novo = db.query(Associado).filter(Associado.id_associado == novo["id_associado"]).first()
    a_antigo.data_admissao = datetime(2019, 3, 1)
    a_novo.data_admissao = datetime(2025, 8, 1)
    db.commit()
    return a_antigo, a_novo


def _titulo(db, id_associado, status):
    from datetime import datetime, timedelta
    from decimal import Decimal

    from app.models.financeiro import TituloFinanceiro

    t = TituloFinanceiro(
        tipo_titulo="Receber", id_associado=id_associado, descricao="Mensalidade de teste", valor_original=Decimal("30.00"),
        saldo_devedor=Decimal("0.00") if status == "Pago" else Decimal("30.00"), data_vencimento=datetime.utcnow() + timedelta(days=10),
        status=status,
    )
    db.add(t)
    db.commit()
    return t.id_titulo


def test_juntar_dois_associados_fica_a_matricula_mais_antiga_e_tudo_passa_para_ela(client, auth_headers, db):
    from app.models.associados import Endereco
    from app.models.core import AuditLog
    from app.models.financeiro import TituloFinanceiro

    antigo, novo = _dois_associados(client, db, "Raimundo Juntar")
    id_antigo, id_novo = antigo.id_associado, novo.id_associado
    matricula_antiga, matricula_nova = antigo.numero_matricula, novo.numero_matricula
    pessoa_antiga, pessoa_nova = antigo.id_pessoa, novo.id_pessoa
    titulo_do_novo = _titulo(db, id_novo, "Pago")
    _titulo(db, id_antigo, "Pago")

    r = client.post(
        f"/api/pessoas/{pessoa_antiga}/mesclar", headers=auth_headers,
        json={
            "id_pessoa_absorvida": pessoa_nova, "nome_confirmacao": "Raimundo Juntar N. da Silva",
            # o telefone e o endereço do cadastro novo é que estão certos; o nome fica o completo (do antigo)
            "escolhas": {"telefone_whatsapp": "absorvida", "endereco": "absorvida", "nome_completo": "mantida"},
        },
    )
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["matricula_mantida"] == matricula_antiga
    assert corpo["matricula_liberada"] == matricula_nova

    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == id_novo).first() is None, "o cadastro de associado juntado sai"
    mantido = db.query(Associado).filter(Associado.id_associado == id_antigo).first()
    assert mantido.numero_matricula == matricula_antiga
    assert db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == titulo_do_novo).first().id_associado == id_antigo
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == pessoa_antiga).first()
    assert pessoa.nome_completo == "Raimundo Juntar Nonato da Silva"
    assert pessoa.telefone_whatsapp == "91991234567"
    enderecos = db.query(Endereco).filter(Endereco.id_associado == id_antigo).all()
    assert [e.cidade for e in enderecos] == ["Ananindeua"], "fica UM endereço, o escolhido"
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == pessoa_nova).first() is None

    registro = db.query(AuditLog).filter(AuditLog.acao == "MESCLADO", AuditLog.id_registro_afetado == pessoa_antiga).order_by(AuditLog.id_log.desc()).first()
    depois = registro.dados_depois if isinstance(registro.dados_depois, dict) else __import__("json").loads(registro.dados_depois)
    assert depois["matricula_mantida"] == matricula_antiga and depois["matricula_liberada"] == matricula_nova
    assert "telefone_whatsapp" in depois["campos_da_absorvida"]
    assert "91991234567" not in str(depois), "a Auditoria guarda QUAIS campos vieram, nunca os valores"


def test_juntar_recusa_quando_o_que_fica_e_o_cadastro_mais_novo(client, auth_headers, db):
    antigo, novo = _dois_associados(client, db, "Joana Ordem")
    r = client.post(
        f"/api/pessoas/{novo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": antigo.id_pessoa, "nome_confirmacao": "Joana Ordem Nonato da Silva"},
    )
    assert r.status_code == 409
    assert f"nº {antigo.numero_matricula}" in r.json()["detail"]
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == novo.id_associado).first() is not None, "nada foi alterado"


def test_o_numero_que_fica_livre_vai_para_o_proximo_associado_novo(client, auth_headers, db):
    from app.services.matricula import proximo_numero_matricula

    antigo, novo = _dois_associados(client, db, "Pedro Livre")
    livre = novo.numero_matricula
    # o número livre só é o menor se todos os anteriores estiverem em uso: confere o comportamento a partir do estado do banco de teste
    usados = {n for (n,) in db.query(Associado.numero_matricula).all() if n is not None}
    r = client.post(
        f"/api/pessoas/{antigo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": novo.id_pessoa, "nome_confirmacao": "Pedro Livre N. da Silva"},
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    esperado = min(n for n in range(1, max(usados) + 2) if n not in (usados - {livre}))
    assert proximo_numero_matricula(db) == esperado
    assert esperado <= livre, "o número liberado (ou um buraco anterior a ele) é reaproveitado, nunca o maior + 1 por cima de um livre"
    criado = _criar_associado(client, nome_completo="Pedro Chegando Agora")
    assert db.query(Associado).filter(Associado.id_associado == criado["id_associado"]).first().numero_matricula == esperado


def test_juntar_com_cpf_escolhido_da_juntada_e_campo_desconhecido(client, auth_headers, db):
    antigo, novo = _dois_associados(client, db, "Cpf Escolhido")
    cpf_do_novo = db.query(Pessoa).filter(Pessoa.id_pessoa == novo.id_pessoa).first().cpf
    r_ruim = client.post(
        f"/api/pessoas/{antigo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": novo.id_pessoa, "nome_confirmacao": "Cpf Escolhido N. da Silva", "escolhas": {"senha": "absorvida"}},
    )
    assert r_ruim.status_code == 400
    r = client.post(
        f"/api/pessoas/{antigo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": novo.id_pessoa, "nome_confirmacao": "Cpf Escolhido N. da Silva", "escolhas": {"cpf": "absorvida"}},
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == antigo.id_pessoa).first().cpf == cpf_do_novo


def test_juntar_dois_com_acesso_desliga_o_acesso_do_juntado(client, auth_headers, db):
    from app.models.core import Usuario

    antigo, novo = _dois_associados(client, db, "Acesso Duplo")
    for associado, email in ((antigo, "acesso.antigo@x.com"), (novo, "acesso.novo@x.com")):
        u = Usuario(email=email, senha_hash="x", ativo=True)
        db.add(u)
        db.commit()
        associado.id_usuario = u.id_usuario
        db.commit()
    id_usuario_novo = novo.id_usuario
    r = client.post(
        f"/api/pessoas/{antigo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": novo.id_pessoa, "nome_confirmacao": "Acesso Duplo N. da Silva"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["contagens"].get("acesso_ao_painel_desligado") == 1
    db.expire_all()
    assert db.query(Usuario).filter(Usuario.id_usuario == id_usuario_novo).first().ativo is False


def test_comparar_mostra_os_dois_lados_com_o_cpf_escondido_e_quem_fica(client, auth_headers, db):
    from app.models.qualidade_cadastro import FilaRevisaoCadastro

    antigo, novo = _dois_associados(client, db, "Comparar Lados")
    _titulo(db, novo.id_associado, "Pendente")
    item = FilaRevisaoCadastro(tipo_sinal="duplicidade", id_pessoa_a=novo.id_pessoa, id_pessoa_b=antigo.id_pessoa, detalhe="teste")
    db.add(item)
    db.commit()
    r = client.get(f"/api/pessoas/fila-revisao/{item.id_fila}/comparar", headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["os_dois_sao_associados"] is True
    assert corpo["fica"] == antigo.id_pessoa, "fica o cadastro da matrícula mais antiga, mesmo estando do lado B"
    assert corpo["a"]["cpf_mascarado"].startswith("***.***.***-")
    assert "cpf" not in corpo["a"]
    assert corpo["a"]["associado"]["titulos_em_aberto"] == 1
    assert corpo["b"]["associado"]["data_admissao"] == "2019-03-01"


# ---------------------------------------------------------------------------
# Higienização de contato
# ---------------------------------------------------------------------------
def test_higienizar_contatos_marca_telefone_invalido(client, auth_headers, db):
    associado = _criar_associado(client, telefone_whatsapp="11900000000")
    id_pessoa = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().id_pessoa
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    pessoa.telefone_whatsapp = "123"  # inválido, gravado direto no banco (sem passar pelo validador de escrita)
    db.commit()

    r = client.post("/api/pessoas/higienizar-contatos", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["novos"] >= 1

    db.refresh(pessoa)
    assert pessoa.contato_suspeito is True

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    assert any(i["id_pessoa_a"] == id_pessoa and i["tipo_sinal"] == "contato_telefone_invalido" for i in fila)


def test_marcar_email_suspeito_manualmente(client, auth_headers, db):
    associado = _criar_associado(client)
    id_pessoa = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().id_pessoa

    r = client.post(
        f"/api/pessoas/{id_pessoa}/marcar-contato-suspeito", headers=auth_headers,
        json={"motivo": "E-mail voltou (bounce) - reportado pela secretaria."},
    )
    assert r.status_code == 200, r.text

    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == id_pessoa).first()
    assert pessoa.contato_suspeito is True


def test_fila_diz_quem_e_associado_e_a_matricula_quando_os_dois_tem_o_mesmo_nome(client, auth_headers, db):
    """Achado AO VIVO (v5.4c): dois cadastros duplicados costumam ter o MESMO nome; a tela de mesclar só distinguia um do outro se a fila
    dissesse quem é associado (e a matrícula) e quem é só uma pessoa."""
    nome = "Mesmo Nome Duas Vezes Qualidade"
    associado = _criar_associado(client, nome_completo=nome, data_nascimento="1979-03-09")
    registro = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first()

    outro = _criar_associado(client)
    id_pessoa_titular = db.query(Associado).filter(Associado.id_associado == outro["id_associado"]).first().id_pessoa
    r = client.post(
        f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers,
        json={"nome_completo": nome, "data_nascimento": "1979-03-09", "grau_parentesco": "OUTRO"},
    )
    id_dependente = r.json()["id_pessoa_vinculada"]
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)

    fila = client.get("/api/pessoas/fila-revisao", headers=auth_headers).json()
    par = next(i for i in fila if {i["id_pessoa_a"], i["id_pessoa_b"]} == {registro.id_pessoa, id_dependente})
    lado_associado, lado_so_pessoa = ("a", "b") if par["id_pessoa_a"] == registro.id_pessoa else ("b", "a")
    assert par[f"e_associado_{lado_associado}"] is True
    assert par[f"matricula_{lado_associado}"] == registro.numero_matricula
    assert par[f"e_associado_{lado_so_pessoa}"] is False
    assert par[f"matricula_{lado_so_pessoa}"] is None


def test_mesclar_funciona_com_chave_estrangeira_ligada_como_no_postgres(client, auth_headers, db):
    """Achado AO VIVO na homologação (v5.4c, 2026-10-06): a mesclagem apagava a pessoa absorvida enquanto a fila de revisão (de onde ela sempre
    parte), as inscrições, as presenças, os beneficiários etc. ainda apontavam para ela. No Postgres isso é violação de chave estrangeira
    (erro 500 na tela: "Failed to fetch"). A suíte agora liga `PRAGMA foreign_keys=ON` no SQLite (tests/conftest.py) para se comportar igual;
    sem a correção, esta mesclagem pela rota de verdade falha com IntegrityError."""
    from sqlalchemy import text

    from app.models.qualidade_cadastro import FilaRevisaoCadastro

    nome = "Mesclagem Com Chave Estrangeira"
    associado = _criar_associado(client, nome_completo=nome, data_nascimento="1971-07-07")
    mantida = db.query(Associado).filter(Associado.id_associado == associado["id_associado"]).first().id_pessoa
    outro = _criar_associado(client)
    titular = db.query(Associado).filter(Associado.id_associado == outro["id_associado"]).first().id_pessoa
    absorvida = client.post(
        f"/api/pessoas/{titular}/dependentes", headers=auth_headers,
        json={"nome_completo": nome, "data_nascimento": "1971-07-07", "grau_parentesco": "OUTRO"},
    ).json()["id_pessoa_vinculada"]
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    assert db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_pessoa_b.in_([mantida, absorvida])).count() >= 1

    if db.get_bind().dialect.name == "sqlite":  # no Postgres (CI de produção) a chave estrangeira já é conferida de fábrica
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1, "o SQLite da suíte precisa conferir chave estrangeira, como o Postgres"
    r = client.post(f"/api/pessoas/{mantida}/mesclar", headers=auth_headers, json={"id_pessoa_absorvida": absorvida, "nome_confirmacao": nome})
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert resultado["id_pessoa_mantida"] == mantida
    assert resultado["contagens"].get("fila_revisao_cadastro", 0) >= 1, "as entradas da fila passam a apontar para a pessoa que fica"
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == absorvida).first() is None
    assert db.query(FilaRevisaoCadastro).filter(
        (FilaRevisaoCadastro.id_pessoa_a == absorvida) | (FilaRevisaoCadastro.id_pessoa_b == absorvida)
    ).count() == 0
