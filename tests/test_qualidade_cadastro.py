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
    item = db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.id_pessoa_a.in_([mantida, absorvida]), FilaRevisaoCadastro.id_pessoa_b.in_([mantida, absorvida]),
    ).one()

    if db.get_bind().dialect.name == "sqlite":  # no Postgres (CI de produção) a chave estrangeira já é conferida de fábrica
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1, "o SQLite da suíte precisa conferir chave estrangeira, como o Postgres"
    # v9.5 (reconferência, item 8): com cadastro de associado de um dos lados, só a partir do item pendente da fila que aponta o par
    corpo = {"id_pessoa_absorvida": absorvida, "nome_confirmacao": nome}
    assert client.post(f"/api/pessoas/{mantida}/mesclar", headers=auth_headers, json=corpo).status_code == 409
    r = client.post(f"/api/pessoas/{mantida}/mesclar", headers=auth_headers, json={**corpo, "id_fila": item.id_fila})
    assert r.status_code == 200, r.text
    resultado = r.json()
    assert resultado["id_pessoa_mantida"] == mantida
    assert resultado["contagens"].get("fila_revisao_cadastro", 0) >= 1, "as entradas da fila passam a apontar para a pessoa que fica"
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == absorvida).first() is None
    assert db.query(FilaRevisaoCadastro).filter(
        (FilaRevisaoCadastro.id_pessoa_a == absorvida) | (FilaRevisaoCadastro.id_pessoa_b == absorvida)
    ).count() == 0


# ---------------------------------------------------------------------------
# v9.5 (decisão do Presidente, 13/11/2026): dois cadastros de associado da mesma pessoa - fica a matrícula mais antiga e o número
# que fica livre vai para o próximo associado novo. Com os achados da conferência independente de 17/11 (mensalidade do mesmo mês nos dois,
# situação, acesso, endereço em branco, foto, CPF que só parece igual, par fora da fila).
# ---------------------------------------------------------------------------
def _dois_associados(client, db, prefixo):
    """Dois cadastros de associado (o primeiro mais antigo), com endereço, e-mail e telefone diferentes, e o item PENDENTE da fila que aponta o
    par (dois associados só se juntam a partir dele)."""
    from datetime import datetime

    from app.models.qualidade_cadastro import FilaRevisaoCadastro

    antigo = _criar_associado(client, nome_completo=f"{prefixo} Nonato da Silva", telefone_whatsapp="91988881234", cidade="Belem", estado="PA")
    novo = _criar_associado(client, nome_completo=f"{prefixo} N. da Silva", telefone_whatsapp="91991234567", cidade="Ananindeua", estado="PA")
    a_antigo = db.query(Associado).filter(Associado.id_associado == antigo["id_associado"]).first()
    a_novo = db.query(Associado).filter(Associado.id_associado == novo["id_associado"]).first()
    a_antigo.data_admissao = datetime(2019, 3, 1, 15, 0)
    a_novo.data_admissao = datetime(2025, 8, 1, 15, 0)
    item = FilaRevisaoCadastro(tipo_sinal="duplicidade_nome_nascimento", id_pessoa_a=a_novo.id_pessoa, id_pessoa_b=a_antigo.id_pessoa, detalhe="teste")
    db.add(item)
    db.commit()
    return a_antigo, a_novo, item.id_fila


def _juntar(client, auth_headers, antigo, novo, id_fila, nome, **extra):
    return client.post(
        f"/api/pessoas/{antigo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": novo.id_pessoa, "nome_confirmacao": nome, "id_fila": id_fila, **extra},
    )


def _escolhas_completas(client, auth_headers, id_fila, **escolhidas):
    """Como a tela faz: uma escolha para CADA campo que a comparação mostrou como diferente (o que não foi escolhido fica o do cadastro que fica)."""
    campos = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()["campos"]
    return {**{c["chave"]: "mantida" for c in campos if c["modo"] == "escolher"}, **escolhidas}


def _plano(db, categoria="Efetivo"):
    from uuid import uuid4

    from app.models.financeiro import PlanoDeContas, PlanoDeContribuicao

    # conta de receita completa: no Postgres o banco é o mesmo para a suíte inteira, e uma conta sem tipo quebrava o balancete de outros testes
    conta = PlanoDeContas(codigo_contabil=f"3.9.{uuid4().hex[:10]}", descricao_conta="Mensalidade de teste da junção", tipo="Receita")
    db.add(conta)
    db.flush()
    plano = PlanoDeContribuicao(categoria=categoria, descricao="Mensalidade de teste", dia_vencimento=10, id_conta_contabil=conta.id_conta)
    db.add(plano)
    db.commit()
    return plano.id_plano


def _titulo(db, id_associado, status, competencia=None, id_plano=None, competencia_fim=None, saldo=None):
    from datetime import datetime, timedelta
    from decimal import Decimal

    from app.models.financeiro import TituloFinanceiro

    if saldo is None:
        saldo = "0.00" if status == "Pago" else "30.00"
    t = TituloFinanceiro(
        tipo_titulo="Receber", id_associado=id_associado, descricao="Mensalidade de teste", valor_original=Decimal("30.00"),
        saldo_devedor=Decimal(saldo), data_vencimento=datetime.utcnow() + timedelta(days=10),
        status=status, competencia=competencia, competencia_fim=competencia_fim, id_plano_contribuicao=id_plano,
    )
    db.add(t)
    db.commit()
    return t.id_titulo


def test_juntar_dois_associados_fica_a_matricula_mais_antiga_e_tudo_passa_para_ela(client, auth_headers, db):
    import json

    from app.models.associados import Endereco
    from app.models.core import AuditLog
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Raimundo Juntar")
    id_antigo, id_novo = antigo.id_associado, novo.id_associado
    matricula_antiga, matricula_nova = antigo.numero_matricula, novo.numero_matricula
    pessoa_antiga, pessoa_nova = antigo.id_pessoa, novo.id_pessoa
    titulo_do_novo = _titulo(db, id_novo, "Pago")
    _titulo(db, id_antigo, "Pago")

    r = _juntar(
        client, auth_headers, antigo, novo, id_fila, "Raimundo Juntar N. da Silva",
        # o telefone e o endereço do cadastro novo é que estão certos; o nome fica o completo (do antigo)
        escolhas=_escolhas_completas(client, auth_headers, id_fila, telefone_whatsapp="absorvida", endereco="absorvida", nome_completo="mantida"),
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
    depois = json.loads(registro.dados_depois)
    assert depois["matricula_mantida"] == matricula_antiga and depois["matricula_liberada"] == matricula_nova
    assert "telefone_whatsapp" in depois["campos_da_absorvida"]
    assert "endereco" in depois["campos_da_absorvida"], "o endereço que veio do juntado também fica registrado (3ª conferência)"
    assert "91991234567" not in registro.dados_depois, "a Auditoria guarda QUAIS campos vieram, nunca os valores"


def test_dois_associados_so_se_juntam_a_partir_do_item_pendente_da_fila(client, auth_headers, db):
    antigo, novo, id_fila = _dois_associados(client, db, "Fora da Fila")
    nome = "Fora da Fila N. da Silva"
    assert _juntar(client, auth_headers, antigo, novo, None, nome).status_code == 409
    outro, _, id_outro = _dois_associados(client, db, "Outro Par")
    assert _juntar(client, auth_headers, antigo, novo, id_outro, nome).status_code == 409, "o item tem de ser o deste par"
    assert _juntar(client, auth_headers, antigo, novo, id_fila, nome).status_code == 200


def test_juntar_recusa_quando_o_que_fica_e_o_cadastro_mais_novo(client, auth_headers, db):
    antigo, novo, id_fila = _dois_associados(client, db, "Joana Ordem")
    r = client.post(
        f"/api/pessoas/{novo.id_pessoa}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": antigo.id_pessoa, "nome_confirmacao": "Joana Ordem Nonato da Silva", "id_fila": id_fila},
    )
    assert r.status_code == 409
    assert f"nº {antigo.numero_matricula}" in r.json()["detail"]
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == novo.id_associado).first() is not None, "nada foi alterado"


def test_mais_antigo_e_pelo_dia_nao_pela_hora(db):
    from datetime import datetime

    from app.services.mesclagem import mais_antigo

    # 3ª conferência: horários que caem em dias DIFERENTES em UTC e no MESMO dia em Belém (sem a conversão de fuso, o teste falharia)
    cedo = Associado(id_associado=1, numero_matricula=120, data_admissao=datetime(2026, 5, 4, 13, 0))  # 04/05, 10h em Belém
    tarde_numero_menor = Associado(id_associado=2, numero_matricula=41, data_admissao=datetime(2026, 5, 5, 2, 0))  # 04/05, 23h em Belém
    assert mais_antigo(tarde_numero_menor) < mais_antigo(cedo), "mesmo dia em Belém: vale o número menor"


def test_o_numero_que_fica_livre_vai_para_o_proximo_associado_novo(client, auth_headers, db):
    from app.services.matricula import proximo_numero_matricula

    antigo, novo, id_fila = _dois_associados(client, db, "Pedro Livre")
    livre = novo.numero_matricula
    usados = {n for (n,) in db.query(Associado.numero_matricula).all() if n is not None}
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Pedro Livre N. da Silva").status_code == 200
    db.expire_all()
    esperado = min(n for n in range(1, max(usados) + 2) if n not in (usados - {livre}))
    assert proximo_numero_matricula(db) == esperado
    assert esperado <= livre, "o número liberado (ou um buraco anterior a ele) é reaproveitado, nunca o maior + 1 por cima de um livre"
    criado = _criar_associado(client, nome_completo="Pedro Chegando Agora")
    assert db.query(Associado).filter(Associado.id_associado == criado["id_associado"]).first().numero_matricula == esperado


def test_juntar_com_cpf_escolhido_da_juntada_e_campo_desconhecido(client, auth_headers, db):
    antigo, novo, id_fila = _dois_associados(client, db, "Cpf Escolhido")
    cpf_do_novo = db.query(Pessoa).filter(Pessoa.id_pessoa == novo.id_pessoa).first().cpf
    nome = "Cpf Escolhido N. da Silva"
    assert _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas={"senha": "absorvida"}).status_code == 400
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=_escolhas_completas(client, auth_headers, id_fila, cpf="absorvida"))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == antigo.id_pessoa).first().cpf == cpf_do_novo


def test_mensalidade_do_mesmo_mes_nos_dois_fica_uma_so(client, auth_headers, db):
    """Achado da conferência: os dois cadastros recebem a mensalidade todo mês - antes, a junção era recusada para sempre (trava de um título
    por plano e mês) e, com planos diferentes, a pessoa ficava devendo o mesmo mês duas vezes."""
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Mensal Dobro")
    plano, outro_plano = _plano(db), _plano(db)
    pendente_antigo_nov = _titulo(db, antigo.id_associado, "Pendente", "2026-11", plano)
    pendente_novo_nov = _titulo(db, novo.id_associado, "Pendente", "2026-11", plano)
    pendente_antigo_out = _titulo(db, antigo.id_associado, "Pendente", "2026-10", plano)
    pago_novo_out = _titulo(db, novo.id_associado, "Pago", "2026-10", outro_plano)  # outro plano: sem trava no banco, mas é o mesmo mês
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Mensal Dobro N. da Silva")
    assert r.status_code == 200, r.text
    assert r.json()["contagens"]["mensalidades_em_dobro_canceladas"] == 2
    db.expire_all()
    status = {t.id_titulo: (t.status, t.id_associado) for t in db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_titulo.in_([pendente_antigo_nov, pendente_novo_nov, pendente_antigo_out, pago_novo_out]))}
    assert status[pendente_antigo_nov] == ("Pendente", antigo.id_associado), "nenhuma paga: fica a pendente do cadastro que fica"
    assert status[pendente_novo_nov] == ("Cancelado", antigo.id_associado)
    assert status[pago_novo_out] == ("Pago", antigo.id_associado), "uma paga: fica a paga"
    assert status[pendente_antigo_out] == ("Cancelado", antigo.id_associado)


def test_mensalidade_paga_nos_dois_recusa_e_nada_muda(client, auth_headers, db):
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Pago Dobro")
    plano = _plano(db)
    _titulo(db, antigo.id_associado, "Pago", "2026-09", plano)
    pago_novo = _titulo(db, novo.id_associado, "Pago", "2026-09", plano)
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Pago Dobro N. da Silva")
    assert r.status_code == 409
    assert "09/2026" in r.json()["detail"]
    db.expire_all()
    assert db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == pago_novo).first().id_associado == novo.id_associado
    assert db.query(Associado).filter(Associado.id_associado == novo.id_associado).first() is not None


def test_o_mesmo_aviso_nos_dois_fica_um_so_com_a_leitura(client, auth_headers, db):
    from datetime import datetime, timedelta

    from app.models.comunicacao import Aviso, AvisoDestinatario
    from app.models.core import Usuario

    antigo, novo, id_fila = _dois_associados(client, db, "Aviso Dobro")
    autor = db.query(Usuario).first()
    aviso = Aviso(
        titulo="Aviso de teste", texto="Texto", categoria="GERAL", valido_ate=datetime.utcnow() + timedelta(days=5), publico="todos",
        publico_descricao="Todos", id_usuario_autor=autor.id_usuario,
    )
    db.add(aviso)
    db.flush()
    lido = datetime(2026, 11, 1, 10, 0)
    db.add(AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=antigo.id_associado))
    db.add(AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=novo.id_associado, lido_em=lido))
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Aviso Dobro N. da Silva").status_code == 200
    db.expire_all()
    linhas = db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == aviso.id_aviso).all()
    assert len(linhas) == 1 and linhas[0].id_associado == antigo.id_associado
    assert linhas[0].lido_em == lido, "a leitura que só o juntado tinha não se perde"


def test_cadastro_que_fica_desligado_e_o_juntado_ativo_a_pessoa_continua_ativa(client, auth_headers, db):
    """Achado da conferência: a matrícula mais antiga podia ser de um desligamento antigo - a pessoa ativa virava Desligada (perdia a
    carteirinha, deixava de ser cobrada e seria anonimizada pela retenção)."""
    from datetime import datetime

    from app.models.pessoas import Papel

    antigo, novo, id_fila = _dois_associados(client, db, "Volta Ativa")
    antigo.status_arrolamento = "Desligado"
    antigo.data_desligamento = datetime(2022, 3, 1)
    for p in db.query(Papel).filter(Papel.id_pessoa == antigo.id_pessoa, Papel.tipo_papel == "associado").all():
        p.ativo = False
    novo.status_arrolamento = "Ativo - Em Dia"
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Volta Ativa N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    mantido = db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first()
    assert mantido.status_arrolamento != "Desligado"
    assert mantido.data_desligamento is None
    papel = db.query(Papel).filter(Papel.id_pessoa == antigo.id_pessoa, Papel.tipo_papel == "associado").one()
    assert papel.ativo is True, "o papel ativo de quem está ativo fica (a carteirinha continua valendo)"


def test_suspensao_nao_some_ao_juntar(client, auth_headers, db):
    antigo, novo, id_fila = _dois_associados(client, db, "Suspenso Junta")
    novo.status_arrolamento = "Suspenso (Estatuto)"
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Suspenso Junta N. da Silva").status_code == 200
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first().status_arrolamento == "Suspenso (Estatuto)"


def test_acesso_fica_o_ativo_e_nunca_o_proprio_acesso_de_quem_junta_e_desligado(client, auth_headers, db):
    from app.models.core import Usuario

    # 1) o cadastro que fica tem login DESLIGADO e o juntado tem login ativo: fica o ativo
    antigo, novo, id_fila = _dois_associados(client, db, "Acesso Ativo")
    for associado, email, ativo in ((antigo, "acesso.desligado@x.com", False), (novo, "acesso.ligado@x.com", True)):
        u = Usuario(email=email, senha_hash="x", ativo=ativo)
        db.add(u)
        db.commit()
        associado.id_usuario = u.id_usuario
        db.commit()
    login_ativo = novo.id_usuario
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Acesso Ativo N. da Silva").status_code == 200
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first().id_usuario == login_ativo
    assert db.query(Usuario).filter(Usuario.id_usuario == login_ativo).first().ativo is True

    # 2) os dois ativos, e o do juntado é o de QUEM ESTÁ JUNTANDO: o dele fica, o outro é desligado. O operador é um usuário próprio deste
    # teste (3ª conferência: ligar o login do administrador da suíte a outro associado deixava dois associados com o mesmo login nos testes
    # seguintes)
    from tests.test_catalogos_permissao import _criar_usuario_com_permissao, _headers

    operador = _criar_usuario_com_permissao(db, "associados")
    id_operador = operador.id_usuario
    antigo, novo, id_fila = _dois_associados(client, db, "Acesso Operador")
    outro = Usuario(email="acesso.outro@x.com", senha_hash="x", ativo=True)
    db.add(outro)
    db.commit()
    antigo.id_usuario = outro.id_usuario
    novo.id_usuario = id_operador
    db.commit()
    r = _juntar(client, _headers(operador), antigo, novo, id_fila, "Acesso Operador N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Usuario).filter(Usuario.id_usuario == id_operador).first().ativo is True
    assert db.query(Usuario).filter(Usuario.id_usuario == outro.id_usuario).first().ativo is False
    assert db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first().id_usuario == id_operador


def test_endereco_em_branco_do_que_fica_nao_apaga_o_endereco_do_juntado(client, auth_headers, db):
    from app.models.associados import Endereco

    antigo, novo, id_fila = _dois_associados(client, db, "Endereco Branco")
    for e in db.query(Endereco).filter(Endereco.id_associado == antigo.id_associado).all():
        e.cep = e.logradouro = e.numero = e.bairro = e.cidade = e.estado = ""
    db.commit()
    c = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    endereco = next(x for x in c["campos"] if x["chave"] == "endereco")
    assert endereco["modo"] == "vem_do_juntado" and endereco["fica"] is None
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Endereco Branco N. da Silva").status_code == 200
    db.expire_all()
    cidades = [e.cidade for e in db.query(Endereco).filter(Endereco.id_associado == antigo.id_associado).all()]
    assert cidades == ["Ananindeua"]


def test_foto_diferente_pede_escolha_e_a_que_nao_fica_e_apagada(client, auth_headers, db, monkeypatch):
    from app.services import armazenamento

    apagadas = []
    monkeypatch.setattr(armazenamento, "remover_url", lambda url: apagadas.append(url))
    antigo, novo, id_fila = _dois_associados(client, db, "Foto Dupla")
    db.query(Pessoa).filter(Pessoa.id_pessoa == antigo.id_pessoa).first().foto = "/uploads/fotos/antiga.jpg"
    db.query(Pessoa).filter(Pessoa.id_pessoa == novo.id_pessoa).first().foto = "/uploads/fotos/nova.jpg"
    db.commit()
    c = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    assert next(x for x in c["campos"] if x["chave"] == "foto")["modo"] == "escolher"
    r = _juntar(
        client, auth_headers, antigo, novo, id_fila, "Foto Dupla N. da Silva", escolhas=_escolhas_completas(client, auth_headers, id_fila, foto="absorvida"),
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == antigo.id_pessoa).first().foto == "/uploads/fotos/nova.jpg"
    assert apagadas == ["/uploads/fotos/antiga.jpg"], "a foto que não ficou sai do armazenamento"


def test_comparar_mostra_os_dois_lados_com_o_cpf_escondido_e_quem_fica(client, auth_headers, db):
    antigo, novo, id_fila = _dois_associados(client, db, "Comparar Lados")
    _titulo(db, novo.id_associado, "Pendente")
    r = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["os_dois_sao_associados"] is True
    assert corpo["fica"] == antigo.id_pessoa, "fica o cadastro da matrícula mais antiga, mesmo estando do lado B"
    assert corpo["a"]["cpf_mascarado"].startswith("***.***.***-")
    assert "cpf" not in corpo["a"]
    assert corpo["a"]["associado"]["titulos_em_aberto"] == 1
    assert corpo["b"]["associado"]["data_admissao"] == "2019-03-01"
    assert corpo["situacao"]["depois"] and corpo["acesso"]["depois"]
    cpf = next(x for x in corpo["campos"] if x["chave"] == "cpf")
    assert cpf["fica"].startswith("***.***.***-") and cpf["sai"].startswith("***.***.***-")


def test_cpfs_diferentes_com_o_mesmo_final_nao_aparecem_como_iguais(client, auth_headers, db):
    """Achado da conferência: a tela comparava o CPF já escondido (só os 2 últimos números) - CPFs diferentes com o mesmo final pareciam iguais."""
    antigo, novo, id_fila = _dois_associados(client, db, "Cpf Final")
    db.query(Pessoa).filter(Pessoa.id_pessoa == antigo.id_pessoa).first().cpf = "11122233399"
    db.query(Pessoa).filter(Pessoa.id_pessoa == novo.id_pessoa).first().cpf = "44455566699"
    db.commit()
    corpo = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    cpf = next(x for x in corpo["campos"] if x["chave"] == "cpf")
    assert cpf["fica"] == cpf["sai"] == "***.***.***-99"
    assert cpf["modo"] == "escolher" and corpo["cpf_diferente"] is True


def test_comparar_e_juntar_exigem_a_permissao_de_associados(client, db):
    from tests.test_catalogos_permissao import _criar_usuario_com_permissao, _headers

    so_financeiro = _headers(_criar_usuario_com_permissao(db, "financeiro"))
    antigo, novo, id_fila = _dois_associados(client, db, "Sem Permissao")
    assert client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=so_financeiro).status_code == 403
    assert _juntar(client, so_financeiro, antigo, novo, id_fila, "Sem Permissao N. da Silva").status_code == 403


def test_registro_que_nao_se_junta_sozinho_recusa_e_nada_muda(client, auth_headers, db, monkeypatch):
    """Dois votos (ou duas manifestações) da mesma pessoa no mesmo assunto não se resolvem sozinhos: a junção é recusada e nada é gravado. O
    caminho é o mesmo para as três tabelas da regra "recusar"; aqui ele é exercitado com o aviso repetido marcado como "recusar"."""
    from datetime import datetime, timedelta

    from app.models.comunicacao import Aviso, AvisoDestinatario
    from app.models.core import Usuario
    from app.services import mesclagem

    monkeypatch.setitem(mesclagem._UNICOS_POR_ASSOCIADO, "avisos_destinatarios", (("id_aviso",), "recusar", "um voto na mesma votação"))
    antigo, novo, id_fila = _dois_associados(client, db, "Voto Dobro")
    aviso = Aviso(
        titulo="Aviso", texto="Texto", categoria="GERAL", valido_ate=datetime.utcnow() + timedelta(days=5), publico="todos",
        publico_descricao="Todos", id_usuario_autor=db.query(Usuario).first().id_usuario,
    )
    db.add(aviso)
    db.flush()
    db.add(AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=antigo.id_associado))
    db.add(AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=novo.id_associado))
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Voto Dobro N. da Silva")
    assert r.status_code == 409
    assert "um voto na mesma votação" in r.json()["detail"]
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == novo.id_associado).first() is not None
    assert db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == aviso.id_aviso).count() == 2


# ---------------------------------------------------------------------------
# Reconferência independente (17/11): N1-N5, Q1, Q2 e o item 8
# ---------------------------------------------------------------------------
def test_escolhas_incompletas_pedem_comparar_de_novo_e_nada_muda(client, auth_headers, db):
    """N5: a tela manda uma escolha para cada campo que mostrou como diferente. Se chega um campo diferente sem escolha, o cadastro mudou depois
    da comparação - a junção é recusada em vez de ficar, calada, com o valor de um dos lados."""
    antigo, novo, id_fila = _dois_associados(client, db, "Escolha Faltando")
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Escolha Faltando N. da Silva", escolhas={"nome_completo": "mantida"})
    assert r.status_code == 400
    assert "compare de novo" in r.json()["detail"]
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == novo.id_associado).first() is not None


def test_o_mesmo_aviso_nos_dois_leva_junto_a_entrega_por_email(client, auth_headers, db):
    """N1: o aviso repetido nos dois sai do juntado, mas a entrega por e-mail que apontava para ele passa para o que fica (antes, a chave
    estrangeira travava a junção no Postgres). A mesma entrega nos dois (o mesmo canal) fica uma só."""
    from datetime import datetime, timedelta

    from app.models.comunicacao import Aviso, AvisoDestinatario, EntregaDeAviso
    from app.models.core import Usuario

    antigo, novo, id_fila = _dois_associados(client, db, "Entrega Junto")
    autor = db.query(Usuario).first().id_usuario
    ids = {}
    for nome in ("so_no_juntado", "nos_dois"):
        aviso = Aviso(
            titulo=f"Aviso {nome}", texto="Texto", categoria="GERAL", valido_ate=datetime.utcnow() + timedelta(days=5), publico="todos",
            publico_descricao="Todos", id_usuario_autor=autor,
        )
        db.add(aviso)
        db.flush()
        do_antigo = AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=antigo.id_associado)
        do_novo = AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=novo.id_associado)
        db.add_all([do_antigo, do_novo])
        db.flush()
        db.add(EntregaDeAviso(id_destinatario=do_novo.id_destinatario, canal="email", situacao="Enviado"))
        if nome == "nos_dois":
            db.add(EntregaDeAviso(id_destinatario=do_antigo.id_destinatario, canal="email", situacao="Enviado"))
        ids[nome] = (aviso.id_aviso, do_antigo.id_destinatario)
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Entrega Junto N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    for nome, (id_aviso, id_destinatario_que_fica) in ids.items():
        linhas = db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == id_aviso).all()
        assert [l.id_destinatario for l in linhas] == [id_destinatario_que_fica], nome
        entregas = db.query(EntregaDeAviso).filter(EntregaDeAviso.id_destinatario == id_destinatario_que_fica).all()
        assert len(entregas) == 1, f"{nome}: a entrega por e-mail fica uma só, no destinatário que fica"


def test_habilitado_em_um_dos_dois_continua_habilitado(client, auth_headers, db):
    """Q1: na lista de quem pode votar, se um dos dois cadastros estava habilitado, a pessoa está (antes ficava a linha do cadastro que fica,
    mesmo inabilitada)."""
    from datetime import datetime, timedelta

    from app.models.governanca import Assembleia, HabilitadoAssembleia

    antigo, novo, id_fila = _dois_associados(client, db, "Habilitado Um")
    assembleia = Assembleia(tipo="ORDINARIA", pauta="Pauta de teste", data_hora_convocacao=datetime.utcnow() + timedelta(days=20))
    db.add(assembleia)
    db.flush()
    db.add(HabilitadoAssembleia(
        id_assembleia=assembleia.id_assembleia, id_associado=antigo.id_associado, habilitado=False, motivo_inabilitacao="inadimplente",
        status_arrolamento_no_momento="Ativo - Inadimplente",
    ))
    db.add(HabilitadoAssembleia(
        id_assembleia=assembleia.id_assembleia, id_associado=novo.id_associado, habilitado=True, status_arrolamento_no_momento="Ativo - Em Dia",
    ))
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Habilitado Um N. da Silva").status_code == 200
    db.expire_all()
    linha = db.query(HabilitadoAssembleia).filter(HabilitadoAssembleia.id_assembleia == assembleia.id_assembleia).one()
    assert linha.id_associado == antigo.id_associado
    assert linha.habilitado is True and linha.motivo_inabilitacao is None
    assert linha.status_arrolamento_no_momento == "Ativo - Em Dia"


def test_licenca_pedida_agora_continua_de_qualquer_lado(client, auth_headers, db):
    """Q2: a situação que vale é a mais recente. Licença registrada AGORA no cadastro antigo (o que fica) continua; licença recente no cadastro
    juntado passa para o que fica."""
    from datetime import datetime, timedelta

    from app.models.situacao import LICENCA, MudancaSituacao

    # 1) a licença é do cadastro que fica
    antigo, novo, id_fila = _dois_associados(client, db, "Licenca Antigo")
    antigo.status_arrolamento = "Licenciado"
    antigo.data_fim_licenca = datetime.utcnow() + timedelta(days=60)
    novo.status_arrolamento = "Ativo - Em Dia"
    db.add(MudancaSituacao(id_associado=antigo.id_associado, tipo=LICENCA, data_efetiva=datetime.utcnow()))
    db.commit()
    c = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    assert c["situacao"]["depois"].startswith("Continua Licenciado")
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Licenca Antigo N. da Silva").status_code == 200
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first().status_arrolamento == "Licenciado"

    # 2) a licença é do cadastro juntado
    antigo, novo, id_fila = _dois_associados(client, db, "Licenca Novo")
    antigo.status_arrolamento = "Ativo - Em Dia"
    novo.status_arrolamento = "Licenciado"
    novo.data_fim_licenca = datetime.utcnow() + timedelta(days=60)
    db.add(MudancaSituacao(id_associado=novo.id_associado, tipo=LICENCA, data_efetiva=datetime.utcnow()))
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Licenca Novo N. da Silva").status_code == 200
    db.expire_all()
    mantido = db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first()
    assert mantido.status_arrolamento == "Licenciado" and mantido.data_fim_licenca is not None


def test_dois_planos_no_mesmo_mes_so_o_mesmo_plano_e_repeticao(client, auth_headers, db):
    """N2: mensalidade e fundo (dois planos) no mesmo mês não são cobrança em dobro. O par é o mesmo plano e mês; planos diferentes só quando cada
    cadastro tem UMA mensalidade naquele mês."""
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Dois Planos")
    mensal, fundo = _plano(db), _plano(db)
    mensal_antigo = _titulo(db, antigo.id_associado, "Pendente", "2026-11", mensal)
    fundo_antigo = _titulo(db, antigo.id_associado, "Pendente", "2026-11", fundo)
    mensal_novo = _titulo(db, novo.id_associado, "Pendente", "2026-11", mensal)
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Dois Planos N. da Silva")
    assert r.status_code == 200, r.text
    assert r.json()["contagens"]["mensalidades_em_dobro_canceladas"] == 1
    db.expire_all()
    status = {t.id_titulo: t.status for t in db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_titulo.in_([mensal_antigo, fundo_antigo, mensal_novo]))}
    assert status[mensal_novo] == "Cancelado"
    assert status[mensal_antigo] == status[fundo_antigo] == "Pendente", "o fundo do mesmo mês não é repetição da mensalidade"


def test_planos_diferentes_sem_par_claro_recusam_em_vez_de_cobrar_em_dobro_calado(client, auth_headers, db):
    """3ª conferência: um título no cadastro que fica e dois (de outros planos) no juntado, no mesmo mês - não dá para saber qual cobrança repete
    qual. Antes, nada era cancelado e a cobrança em dobro ficava calada; agora a junção é recusada e o Financeiro resolve."""
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Sem Par")
    outro_a, outro_b, outro_c = _plano(db), _plano(db), _plano(db)
    dez = [
        _titulo(db, antigo.id_associado, "Pendente", "2026-12", outro_a),
        _titulo(db, novo.id_associado, "Pendente", "2026-12", outro_b),
        _titulo(db, novo.id_associado, "Pendente", "2026-12", outro_c),
    ]
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Sem Par N. da Silva")
    assert r.status_code == 409
    assert "12/2026" in r.json()["detail"] and "planos diferentes" in r.json()["detail"]
    db.expire_all()
    assert all(t.status == "Pendente" for t in db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo.in_(dez)))


def test_pagamento_antecipado_em_bloco_cobre_cada_mes(client, auth_headers, db):
    """N3: o bloco pago (setembro a dezembro) cobre novembro - a pendente de novembro do outro cadastro é cancelada. Um bloco ainda PENDENTE
    nunca é cancelado pela metade: a junção é recusada explicando."""
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Bloco Pago")
    plano = _plano(db)
    bloco = _titulo(db, novo.id_associado, "Pago", "2026-09", plano, competencia_fim="2026-12")
    novembro = _titulo(db, antigo.id_associado, "Pendente", "2026-11", plano)
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Bloco Pago N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == novembro).first().status == "Cancelado"
    assert db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == bloco).first().status == "Pago"

    antigo, novo, id_fila = _dois_associados(client, db, "Bloco Pendente")
    plano = _plano(db)
    bloco = _titulo(db, novo.id_associado, "Pendente", "2026-09", plano, competencia_fim="2026-12")
    _titulo(db, antigo.id_associado, "Pendente", "2026-11", plano)
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Bloco Pendente N. da Silva")
    assert r.status_code == 409
    assert "pagamento antecipado" in r.json()["detail"] and "11/2026" in r.json()["detail"]
    db.expire_all()
    assert db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == bloco).first().status == "Pendente", "nada mudou"


def test_pago_em_parte_e_renegociado_contam_como_dinheiro(client, auth_headers, db):
    """N4: a mensalidade paga em parte (saldo menor que o valor) é a que fica - a pendente inteira do outro lado é cancelada; renegociada de um
    lado e paga do outro é pagamento em dobro (recusa)."""
    from app.models.financeiro import TituloFinanceiro

    antigo, novo, id_fila = _dois_associados(client, db, "Pago Parte")
    plano = _plano(db)
    inteira_antigo = _titulo(db, antigo.id_associado, "Pendente", "2026-08", plano)
    parte_novo = _titulo(db, novo.id_associado, "Pendente", "2026-08", plano, saldo="10.00")
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Pago Parte N. da Silva").status_code == 200
    db.expire_all()
    assert db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == inteira_antigo).first().status == "Cancelado"
    ficou = db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == parte_novo).first()
    assert ficou.status == "Pendente" and ficou.id_associado == antigo.id_associado

    antigo, novo, id_fila = _dois_associados(client, db, "Renegociado Dobro")
    plano = _plano(db)
    _titulo(db, antigo.id_associado, "Renegociado", "2026-07", plano)
    _titulo(db, novo.id_associado, "Pago", "2026-07", plano)
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Renegociado Dobro N. da Silva")
    assert r.status_code == 409
    assert "07/2026" in r.json()["detail"]


# ---------------------------------------------------------------------------
# 3ª conferência independente (17/11)
# ---------------------------------------------------------------------------
def test_juncao_que_termina_desligado_faz_o_que_o_desligamento_faz(client, auth_headers, db):
    """O cadastro antigo foi desligado há pouco (a pedido da pessoa) e o duplicado novo continuava ativo, com login e cobranças. A mudança mais
    recente é o desligamento: a pessoa fica Desligada - e, como no desligamento, a carteirinha e o login ficam desligados e as cobranças
    pendentes que vencem depois dele são canceladas (a paga em parte fica: dinheiro nunca some)."""
    from datetime import datetime

    from app.models.core import Usuario
    from app.models.financeiro import TituloFinanceiro
    from app.models.pessoas import Papel
    from app.models.situacao import DESLIGAMENTO, MudancaSituacao

    antigo, novo, id_fila = _dois_associados(client, db, "Desligado Agora")
    antigo.status_arrolamento = "Desligado"
    antigo.data_desligamento = datetime(2026, 10, 20)
    for p in db.query(Papel).filter(Papel.id_pessoa == antigo.id_pessoa, Papel.tipo_papel == "associado").all():
        p.ativo = False
    db.add(MudancaSituacao(id_associado=antigo.id_associado, tipo=DESLIGAMENTO, data_efetiva=datetime(2026, 10, 20)))
    login = Usuario(email="desligado.agora@x.com", senha_hash="x", ativo=True)
    db.add(login)
    db.commit()
    novo.id_usuario = login.id_usuario
    novo.status_arrolamento = "Ativo - Em Dia"
    db.commit()
    pendente = _titulo(db, novo.id_associado, "Pendente")
    paga_em_parte = _titulo(db, novo.id_associado, "Pendente", saldo="10.00")
    vencida_antes = _titulo(db, novo.id_associado, "Pendente")
    db.query(TituloFinanceiro).filter(TituloFinanceiro.id_titulo == vencida_antes).first().data_vencimento = datetime(2026, 10, 10)
    db.commit()

    c = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    assert c["situacao"]["depois"].startswith("Continua Desligado") and "carteirinha" in c["situacao"]["depois"]
    assert c["acesso"]["depois"].startswith("Desligado"), "a tela mostra o que a junção grava"
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Desligado Agora N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    mantido = db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first()
    assert mantido.status_arrolamento == "Desligado"
    papel = db.query(Papel).filter(Papel.id_pessoa == antigo.id_pessoa, Papel.tipo_papel == "associado").one()
    assert papel.ativo is False, "a carteirinha deixa de valer"
    assert db.query(Usuario).filter(Usuario.id_usuario == login.id_usuario).first().ativo is False
    status = {t.id_titulo: t.status for t in db.query(TituloFinanceiro).filter(
        TituloFinanceiro.id_titulo.in_([pendente, paga_em_parte, vencida_antes]))}
    assert status == {pendente: "Cancelado", paga_em_parte: "Pendente", vencida_antes: "Pendente"}, "a dívida de antes do desligamento fica"


def test_juncao_que_termina_desligado_nunca_desliga_o_acesso_de_quem_junta(client, db):
    from datetime import datetime

    from app.models.situacao import DESLIGAMENTO, MudancaSituacao
    from tests.test_catalogos_permissao import _criar_usuario_com_permissao, _headers

    operador = _criar_usuario_com_permissao(db, "associados")
    antigo, novo, id_fila = _dois_associados(client, db, "Desligado Operador")
    antigo.status_arrolamento = "Desligado"
    antigo.data_desligamento = datetime(2026, 10, 20)
    db.add(MudancaSituacao(id_associado=antigo.id_associado, tipo=DESLIGAMENTO, data_efetiva=datetime(2026, 10, 20)))
    novo.id_usuario = operador.id_usuario
    db.commit()
    r = _juntar(client, _headers(operador), antigo, novo, id_fila, "Desligado Operador N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    from app.models.core import Usuario

    assert db.query(Usuario).filter(Usuario.id_usuario == operador.id_usuario).first().ativo is True


def test_campos_personalizados_do_juntado_vao_junto_e_valores_diferentes_recusam(client, auth_headers, db):
    from app.models.core import DefinicaoCampo, ValorCampo

    do_associado = DefinicaoCampo(entidade="associado", rotulo="Igreja de origem (teste da junção)", tipo="texto", ativo=False)
    da_pessoa = DefinicaoCampo(entidade="pessoa", rotulo="Apelido (teste da junção)", tipo="texto", ativo=False)
    db.add_all([do_associado, da_pessoa])
    db.commit()

    antigo, novo, id_fila = _dois_associados(client, db, "Campo Junto")
    db.add(ValorCampo(id_definicao=do_associado.id_definicao, id_registro=novo.id_associado, valor="Igreja do Marco"))
    db.add(ValorCampo(id_definicao=da_pessoa.id_definicao, id_registro=novo.id_pessoa, valor="Mundico"))
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Campo Junto N. da Silva").status_code == 200
    db.expire_all()
    valores = {
        v.id_definicao: (v.id_registro, v.valor) for v in db.query(ValorCampo).filter(
            ValorCampo.id_definicao.in_([do_associado.id_definicao, da_pessoa.id_definicao]))
    }
    assert valores == {
        do_associado.id_definicao: (antigo.id_associado, "Igreja do Marco"),
        da_pessoa.id_definicao: (antigo.id_pessoa, "Mundico"),
    }, "nada some da ficha"

    antigo, novo, id_fila = _dois_associados(client, db, "Campo Diferente")
    db.add(ValorCampo(id_definicao=do_associado.id_definicao, id_registro=antigo.id_associado, valor="Igreja da Pedreira"))
    db.add(ValorCampo(id_definicao=do_associado.id_definicao, id_registro=novo.id_associado, valor="Igreja do Guamá"))
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Campo Diferente N. da Silva")
    assert r.status_code == 409
    assert "Igreja de origem (teste da junção)" in r.json()["detail"]
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == novo.id_associado).first() is not None


def test_preferencia_de_email_nos_dois_fica_a_mais_recente(client, auth_headers, db):
    """Antes, a mesma preferência nos dois cadastros (a pessoa descadastrou nos dois) travava a junção com erro de integridade."""
    from datetime import datetime

    from app.models.preferencias_de_comunicacao import LEMBRETES_DE_MENSALIDADE, ORIGEM_LINK, ORIGEM_PAINEL, PreferenciaDeComunicacao

    antigo, novo, id_fila = _dois_associados(client, db, "Preferencia Dupla")
    db.add(PreferenciaDeComunicacao(
        id_pessoa=antigo.id_pessoa, tipo=LEMBRETES_DE_MENSALIDADE, recebe=True, origem=ORIGEM_PAINEL, alterado_em=datetime(2026, 9, 1),
    ))
    db.add(PreferenciaDeComunicacao(
        id_pessoa=novo.id_pessoa, tipo=LEMBRETES_DE_MENSALIDADE, recebe=False, origem=ORIGEM_LINK, alterado_em=datetime(2026, 11, 1),
    ))
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Preferencia Dupla N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    linhas = db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == antigo.id_pessoa).all()
    assert [(p.tipo, p.recebe, p.origem) for p in linhas] == [(LEMBRETES_DE_MENSALIDADE, False, ORIGEM_LINK)], "vale a última vontade"


def test_pagamento_antecipado_numa_categoria_e_cadastro_em_outra_recusa(client, auth_headers, db):
    """A geração do mês só pula quem tem pagamento antecipado no MESMO plano: o bloco pago na categoria do juntado, com o cadastro ficando em
    outra categoria, faria os meses já pagos serem cobrados de novo. Escolher a categoria do bloco resolve."""
    from datetime import datetime

    from app.services.fuso import para_belem

    antigo, novo, id_fila = _dois_associados(client, db, "Bloco Categoria")
    novo.categoria = "Contribuinte"
    db.commit()
    mes = para_belem(datetime.utcnow()).strftime("%Y-%m")
    fim = f"{int(mes[:4]) + 1}{mes[4:]}"
    _titulo(db, novo.id_associado, "Pago", mes, _plano(db, "Contribuinte"), competencia_fim=fim)
    nome = "Bloco Categoria N. da Silva"
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=_escolhas_completas(client, auth_headers, id_fila, categoria="mantida"))
    assert r.status_code == 409
    assert "categoria Contribuinte" in r.json()["detail"]
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=_escolhas_completas(client, auth_headers, id_fila, categoria="absorvida"))
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first().categoria == "Contribuinte"


def test_valor_mudado_depois_da_comparacao_pede_comparar_de_novo(client, auth_headers, db):
    """A recusa olhava só QUAIS campos diferem: um telefone trocado por outro (ainda diferente) depois da comparação seria gravado sem a tela
    ter mostrado. Agora a assinatura da comparação pega qualquer valor mudado."""
    antigo, novo, id_fila = _dois_associados(client, db, "Assinatura Velha")
    c = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    assert c["assinatura"] and "11122233" not in c["assinatura"]
    escolhas = {x["chave"]: "absorvida" for x in c["campos"] if x["modo"] == "escolher" and x["chave"] != "nome_completo"}
    escolhas["nome_completo"] = "mantida"
    db.query(Pessoa).filter(Pessoa.id_pessoa == novo.id_pessoa).first().telefone_whatsapp = "91977776666"
    db.commit()
    nome = "Assinatura Velha N. da Silva"
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=escolhas, assinatura=c["assinatura"])
    assert r.status_code == 400 and "compare de novo" in r.json()["detail"]
    nova = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()["assinatura"]
    assert nova != c["assinatura"]
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=escolhas, assinatura=nova)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(Pessoa).filter(Pessoa.id_pessoa == antigo.id_pessoa).first().telefone_whatsapp == "91977776666"


def test_decisao_do_registro_repetido_nao_se_perde_e_decisoes_diferentes_recusam(client, auth_headers, db):
    from datetime import datetime, timedelta

    from app.models.chamada import JustificativaFalta
    from app.models.filiacao import PropostaDeSocio, PropostaFiliacao
    from app.models.governanca import Assembleia

    assembleia = Assembleia(tipo="ORDINARIA", pauta="Pauta de teste", data_hora_convocacao=datetime.utcnow() - timedelta(days=20))
    db.add(assembleia)
    db.commit()

    # 1) a justificativa do que fica está pendente e a do juntado foi aceita: a aceitação vem
    antigo, novo, id_fila = _dois_associados(client, db, "Justifica Aceita")
    decidido = datetime(2026, 11, 3, 14, 0)
    db.add(JustificativaFalta(id_assembleia=assembleia.id_assembleia, id_associado=antigo.id_associado, motivo="Viagem", status="Pendente"))
    db.add(JustificativaFalta(
        id_assembleia=assembleia.id_assembleia, id_associado=novo.id_associado, motivo="Viagem", status="Aceita", motivo_decisao="Comprovado",
        decidido_em=decidido,
    ))
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Justifica Aceita N. da Silva").status_code == 200
    db.expire_all()
    linha = db.query(JustificativaFalta).filter(
        JustificativaFalta.id_assembleia == assembleia.id_assembleia, JustificativaFalta.id_associado == antigo.id_associado,
    ).one()
    assert (linha.status, linha.motivo_decisao, linha.decidido_em) == ("Aceita", "Comprovado", decidido)

    # 2) aceita num e rejeitada no outro: não se resolve sozinho
    antigo, novo, id_fila = _dois_associados(client, db, "Justifica Briga")
    db.add(JustificativaFalta(id_assembleia=assembleia.id_assembleia, id_associado=antigo.id_associado, motivo="Saúde", status="Rejeitada"))
    db.add(JustificativaFalta(id_assembleia=assembleia.id_assembleia, id_associado=novo.id_associado, motivo="Saúde", status="Aceita"))
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Justifica Briga N. da Silva")
    assert r.status_code == 409 and "justificativa de falta" in r.json()["detail"]

    # 3) duas respostas diferentes na mesma proposta de filiação
    antigo, novo, id_fila = _dois_associados(client, db, "Proposta Briga")
    proposta = PropostaFiliacao(nome_completo="Candidato da Junção", cpf="52998224725")
    db.add(proposta)
    db.flush()
    db.add(PropostaDeSocio(id_proposta=proposta.id_proposta, id_associado=antigo.id_associado, decisao="Propõe"))
    db.add(PropostaDeSocio(id_proposta=proposta.id_proposta, id_associado=novo.id_associado, decisao="Recusa"))
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Proposta Briga N. da Silva")
    assert r.status_code == 409 and "proposta de filiação" in r.json()["detail"]


def test_busca_acha_nomes_parecidos_com_um_dado_pessoal_igual(client, auth_headers, db):
    """A busca só achava nome IDÊNTICO com a mesma data de nascimento: "Raimundo Nonato da Silva" e "Raimundo N. da Silva" nunca entravam na fila
    (e cadastro de associado só se junta a partir dela). Agora: o mesmo primeiro e último nome com a mesma data de nascimento, telefone ou
    e-mail. Só o nome parecido, sem dado igual, não basta."""
    from uuid import uuid4

    from app.models.qualidade_cadastro import DUPLICIDADE_PARECIDA, FilaRevisaoCadastro
    from app.services.duplicidade import primeiro_e_ultimo_nome

    assert primeiro_e_ultimo_nome("Raimundo N. da Silva") == primeiro_e_ultimo_nome("Raimundo Nonato da Silva") == ("raimundo", "silva")
    sobrenome = "Parecido" + "".join(c for c in uuid4().hex if c.isalpha())[:6].lower()
    a = _criar_associado(client, nome_completo=f"Raimundo Nonato da {sobrenome}", telefone_whatsapp="91955554444")
    b = _criar_associado(client, nome_completo=f"Raimundo N. da {sobrenome}", telefone_whatsapp="(91) 95555-4444")
    c = _criar_associado(client, nome_completo=f"Raimundo José da {sobrenome}", telefone_whatsapp="91933332222")
    pessoa = {x["id_associado"]: db.query(Associado).filter(Associado.id_associado == x["id_associado"]).first().id_pessoa for x in (a, b, c)}
    assert client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers).status_code == 200
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)  # a segunda busca não repete o par
    itens = db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.tipo_sinal == DUPLICIDADE_PARECIDA,
        FilaRevisaoCadastro.id_pessoa_a.in_(pessoa.values()), FilaRevisaoCadastro.id_pessoa_b.in_(pessoa.values()),
    ).all()
    assert len(itens) == 1, "só o par com o mesmo telefone; o terceiro tem só o nome parecido"
    item = itens[0]
    assert {item.id_pessoa_a, item.id_pessoa_b} == {pessoa[a["id_associado"]], pessoa[b["id_associado"]]}
    assert "o mesmo telefone" in item.detalhe and "95555" not in item.detalhe

    comparacao = client.get(f"/api/pessoas/fila-revisao/{item.id_fila}/comparar", headers=auth_headers).json()
    fica = comparacao["fica"]
    sai = item.id_pessoa_b if fica == item.id_pessoa_a else item.id_pessoa_a
    nome_sai = db.query(Pessoa).filter(Pessoa.id_pessoa == sai).first().nome_completo
    r = client.post(f"/api/pessoas/{fica}/mesclar", headers=auth_headers, json={
        "id_pessoa_absorvida": sai, "nome_confirmacao": nome_sai, "id_fila": item.id_fila, "assinatura": comparacao["assinatura"],
        "escolhas": {x["chave"]: "mantida" for x in comparacao["campos"] if x["modo"] == "escolher"},
    })
    assert r.status_code == 200, r.text


def test_telefone_da_familia_nao_enche_a_fila_de_falsos_duplicados(client, auth_headers, db):
    """Mais de 3 pessoas com o mesmo primeiro e último nome e o mesmo telefone é o telefone da família (ou dado de teste repetido, como os robôs
    da homologação), não cadastro repetido: nenhum par é apontado por esse dado."""
    from uuid import uuid4

    from app.models.qualidade_cadastro import DUPLICIDADE_PARECIDA, FilaRevisaoCadastro

    sobrenome = "Familia" + "".join(c for c in uuid4().hex if c.isalpha())[:6].lower()
    ids = []
    for meio in ("Antonio", "Bento", "Carlos", "Davi"):
        criado = _criar_associado(client, nome_completo=f"Jose {meio} {sobrenome}", telefone_whatsapp="91912341234")
        ids.append(db.query(Associado).filter(Associado.id_associado == criado["id_associado"]).first().id_pessoa)
    client.post("/api/pessoas/duplicidade/escanear", headers=auth_headers)
    assert db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.tipo_sinal == DUPLICIDADE_PARECIDA, FilaRevisaoCadastro.id_pessoa_a.in_(ids),
    ).count() == 0


def test_juntar_so_tira_da_fila_o_item_do_par(client, auth_headers, db):
    """Antes, a junção marcava como "juntado" qualquer item pendente da pessoa (um telefone inválido, por exemplo) sem ele ter sido resolvido."""
    from app.models.qualidade_cadastro import CONTATO_TELEFONE_INVALIDO, MESCLADO, PENDENTE, FilaRevisaoCadastro

    antigo, novo, id_fila = _dois_associados(client, db, "Fila Limpa")
    telefone_do_que_fica = FilaRevisaoCadastro(tipo_sinal=CONTATO_TELEFONE_INVALIDO, id_pessoa_a=antigo.id_pessoa, detalhe="Telefone 123")
    telefone_do_juntado = FilaRevisaoCadastro(tipo_sinal=CONTATO_TELEFONE_INVALIDO, id_pessoa_a=novo.id_pessoa, detalhe="Telefone 456")
    db.add_all([telefone_do_que_fica, telefone_do_juntado])
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Fila Limpa N. da Silva").status_code == 200
    db.expire_all()
    situacao = {
        i.id_fila: (i.status, i.id_pessoa_a) for i in db.query(FilaRevisaoCadastro).filter(
            FilaRevisaoCadastro.id_fila.in_([id_fila, telefone_do_que_fica.id_fila, telefone_do_juntado.id_fila]))
    }
    assert situacao[id_fila][0] == MESCLADO
    assert situacao[telefone_do_que_fica.id_fila] == (PENDENTE, antigo.id_pessoa)
    assert situacao[telefone_do_juntado.id_fila] == (PENDENTE, antigo.id_pessoa), "continua pendente, agora apontando quem fica"


# ---------------------------------------------------------------------------
# 4ª conferência independente (17/11)
# ---------------------------------------------------------------------------
def test_aviso_para_os_dois_com_login_so_no_juntado_nao_trava_a_juncao(client, auth_headers, db):
    """Regressão achada na conferência: o aviso para "Todos" gravou (aviso, antigo, sem login) e (aviso, novo, login X). Copiar o login do
    juntado para a linha que fica batia na trava de um aviso por login e a junção era recusada - num caso comum. A linha que fica continua sem
    login (o "Meus avisos" acha pelo cadastro) e a leitura do juntado não se perde."""
    from datetime import datetime, timedelta

    from app.models.comunicacao import Aviso, AvisoDestinatario
    from app.models.core import Usuario

    antigo, novo, id_fila = _dois_associados(client, db, "Aviso Login")
    login = Usuario(email="aviso.login@x.com", senha_hash="x", ativo=True)
    db.add(login)
    db.commit()
    novo.id_usuario = login.id_usuario
    aviso = Aviso(
        titulo="Aviso para todos", texto="Texto", categoria="GERAL", valido_ate=datetime.utcnow() + timedelta(days=5), publico="todos",
        publico_descricao="Todos", id_usuario_autor=db.query(Usuario).first().id_usuario,
    )
    db.add(aviso)
    db.flush()
    lido = datetime(2026, 11, 2, 9, 0)
    db.add(AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=antigo.id_associado))
    db.add(AvisoDestinatario(id_aviso=aviso.id_aviso, id_associado=novo.id_associado, id_usuario=login.id_usuario, tinha_acesso=True, lido_em=lido))
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Aviso Login N. da Silva")
    assert r.status_code == 200, r.text
    db.expire_all()
    linha = db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == aviso.id_aviso).one()
    assert linha.id_associado == antigo.id_associado and linha.lido_em == lido
    assert db.query(Associado).filter(Associado.id_associado == antigo.id_associado).first().id_usuario == login.id_usuario


def test_credenciamento_repetido_nao_leva_a_saida_de_um_para_a_entrada_do_outro(client, auth_headers, db):
    """Achado da conferência: quem fica entrou às 10h (ainda presente) e o juntado entrou às 9h e saiu às 9h30 - a saída ia para a linha que fica
    (saída antes da entrada) e a pessoa sumia do quórum de uma sessão em andamento."""
    from datetime import datetime, timedelta

    from app.models.governanca import Assembleia
    from app.models.sessao_assembleia import PRESENCIAL, Credenciamento

    antigo, novo, id_fila = _dois_associados(client, db, "Credencia Dobro")
    assembleia = Assembleia(tipo="ORDINARIA", pauta="Pauta de teste", data_hora_convocacao=datetime.utcnow() + timedelta(days=1))
    db.add(assembleia)
    db.flush()
    db.add(Credenciamento(id_assembleia=assembleia.id_assembleia, id_associado=antigo.id_associado, modalidade=PRESENCIAL,
                          hora_entrada=datetime(2026, 11, 17, 13, 0)))
    db.add(Credenciamento(id_assembleia=assembleia.id_assembleia, id_associado=novo.id_associado, modalidade=PRESENCIAL,
                          hora_entrada=datetime(2026, 11, 17, 12, 0), hora_saida=datetime(2026, 11, 17, 12, 30)))
    db.commit()
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Credencia Dobro N. da Silva").status_code == 200
    db.expire_all()
    linha = db.query(Credenciamento).filter(Credenciamento.id_assembleia == assembleia.id_assembleia).one()
    assert linha.id_associado == antigo.id_associado
    assert linha.hora_entrada == datetime(2026, 11, 17, 13, 0) and linha.hora_saida is None, "continua presente"


def test_assinatura_pega_o_acesso_mudado_e_nunca_da_erro_500(client, auth_headers, db):
    """A assinatura cobre também o acesso (o login do juntado desligado depois da comparação muda o que a tela disse) e uma assinatura com
    acento é recusada como as outras, em vez de erro 500."""
    from app.models.core import Usuario

    antigo, novo, id_fila = _dois_associados(client, db, "Assinatura Acesso")
    login = Usuario(email="assinatura.acesso@x.com", senha_hash="x", ativo=True)
    db.add(login)
    db.commit()
    novo.id_usuario = login.id_usuario
    db.commit()
    c = client.get(f"/api/pessoas/fila-revisao/{id_fila}/comparar", headers=auth_headers).json()
    escolhas = {x["chave"]: "mantida" for x in c["campos"] if x["modo"] == "escolher"}
    nome = "Assinatura Acesso N. da Silva"
    login.ativo = False
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=escolhas, assinatura=c["assinatura"])
    assert r.status_code == 400 and "compare de novo" in r.json()["detail"]
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas=escolhas, assinatura="ação-forjada")
    assert r.status_code == 400


def test_numero_de_outro_item_da_fila_numa_juncao_sem_associado_nao_marca_esse_item(client, auth_headers, db):
    """Na junção de duas pessoas sem cadastro de associado o item da fila não é exigido; mandar o número de OUTRO item não pode marcá-lo como
    juntado (antes, marcava)."""
    from app.models.qualidade_cadastro import CONTATO_TELEFONE_INVALIDO, PENDENTE, FilaRevisaoCadastro

    titular = db.query(Associado).filter(Associado.id_associado == _criar_associado(client)["id_associado"]).first().id_pessoa
    nome = "Dependente Repetido Sem Matricula"
    ids = [
        client.post(
            f"/api/pessoas/{titular}/dependentes", headers=auth_headers,
            json={"nome_completo": nome + sufixo, "data_nascimento": "2015-05-05", "grau_parentesco": "OUTRO"},
        ).json()["id_pessoa_vinculada"]
        for sufixo in ("", " Filho")
    ]
    outro = FilaRevisaoCadastro(tipo_sinal=CONTATO_TELEFONE_INVALIDO, id_pessoa_a=titular, detalhe="Telefone 789")
    db.add(outro)
    db.commit()
    r = client.post(
        f"/api/pessoas/{ids[0]}/mesclar", headers=auth_headers,
        json={"id_pessoa_absorvida": ids[1], "nome_confirmacao": nome + " Filho", "id_fila": outro.id_fila},
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.query(FilaRevisaoCadastro).filter(FilaRevisaoCadastro.id_fila == outro.id_fila).first().status == PENDENTE
