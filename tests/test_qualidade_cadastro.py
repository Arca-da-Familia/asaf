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


def _plano(db):
    from app.models.financeiro import PlanoDeContas, PlanoDeContribuicao

    conta = PlanoDeContas()
    db.add(conta)
    db.flush()
    plano = PlanoDeContribuicao(categoria="Efetivo", descricao="Mensalidade de teste", dia_vencimento=10, id_conta_contabil=conta.id_conta)
    db.add(plano)
    db.commit()
    return plano.id_plano


def _titulo(db, id_associado, status, competencia=None, id_plano=None):
    from datetime import datetime, timedelta
    from decimal import Decimal

    from app.models.financeiro import TituloFinanceiro

    t = TituloFinanceiro(
        tipo_titulo="Receber", id_associado=id_associado, descricao="Mensalidade de teste", valor_original=Decimal("30.00"),
        saldo_devedor=Decimal("0.00") if status == "Pago" else Decimal("30.00"), data_vencimento=datetime.utcnow() + timedelta(days=10),
        status=status, competencia=competencia, id_plano_contribuicao=id_plano,
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
        escolhas={"telefone_whatsapp": "absorvida", "endereco": "absorvida", "nome_completo": "mantida"},
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

    cedo = Associado(id_associado=1, numero_matricula=120, data_admissao=datetime(2026, 5, 4, 13, 0))
    tarde_numero_menor = Associado(id_associado=2, numero_matricula=41, data_admissao=datetime(2026, 5, 4, 20, 0))
    assert mais_antigo(tarde_numero_menor) < mais_antigo(cedo), "mesmo dia: vale o número menor"


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
    r = _juntar(client, auth_headers, antigo, novo, id_fila, nome, escolhas={"cpf": "absorvida"})
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

    # 2) os dois ativos, e o do juntado é o de QUEM ESTÁ JUNTANDO: o dele fica, o outro é desligado
    antigo, novo, id_fila = _dois_associados(client, db, "Acesso Operador")
    id_operador = db.query(Usuario).filter(Usuario.email.like("%@teste.local")).order_by(Usuario.id_usuario).first().id_usuario
    outro = Usuario(email="acesso.outro@x.com", senha_hash="x", ativo=True)
    db.add(outro)
    db.commit()
    antigo.id_usuario = outro.id_usuario
    novo.id_usuario = id_operador
    db.commit()
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Acesso Operador N. da Silva")
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
    r = _juntar(client, auth_headers, antigo, novo, id_fila, "Foto Dupla N. da Silva", escolhas={"foto": "absorvida"})
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
