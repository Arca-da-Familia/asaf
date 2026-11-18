"""v9.5h - o painel de gráficos do módulo Associados (GET /api/associados/painel-de-graficos): só contagens, com filtros (período, situação,
categoria, bairro). O banco de testes é um só para a suíte inteira: cada teste cria os seus associados numa categoria só dele e filtra por ela."""
import json
import uuid
from datetime import datetime, timedelta

from app.models.associados import Associado, Endereco
from app.models.core import Usuario
from app.models.filiacao import APROVADA, PROPOE, PropostaDeSocio, PropostaFiliacao
from app.models.pessoas import Pessoa
from tests.test_pessoas import _cpf_unico

ROTA = "/api/associados/painel-de-graficos"


def _categoria() -> str:
    return f"Categoria Grafico {uuid.uuid4().hex[:8]}"


def _associado(db, categoria, nome, situacao, entrou_ha_dias, idade=None, bairro=None, saiu_ha_dias=None, com_login=False):
    agora = datetime.utcnow()
    pessoa = Pessoa(
        nome_completo=nome,
        data_nascimento=(agora - timedelta(days=int(idade * 365.25) + 10)) if idade is not None else None,
    )
    db.add(pessoa)
    db.flush()
    associado = Associado(
        id_pessoa=pessoa.id_pessoa, categoria=categoria, status_arrolamento=situacao,
        data_admissao=agora - timedelta(days=entrou_ha_dias),
        data_desligamento=(agora - timedelta(days=saiu_ha_dias)) if saiu_ha_dias is not None else None,
    )
    if com_login:
        login = Usuario(email=f"grafico.{uuid.uuid4().hex[:10]}@teste.local", senha_hash="x", ativo=True)
        db.add(login)
        db.flush()
        associado.id_usuario = login.id_usuario
    db.add(associado)
    db.flush()
    if bairro:
        db.add(Endereco(id_associado=associado.id_associado, bairro=bairro))
    db.commit()
    return associado


def _quadro_de_teste(db):
    """Cinco cadastros numa categoria nova:
    A em dia, entrou há 2 anos, 40 anos, Marco, com login; B inadimplente, entrou há 60 dias, 20 anos, Pedreira;
    C desligado há 30 dias (entrou há 3 anos), Marco; D em experiência, entrou hoje, sem nascimento nem endereço; E licenciado, entrou há ~10,7 anos, 70 anos, Umarizal."""
    categoria = _categoria()
    _associado(db, categoria, "Grafico Alfa de Teste", "Ativo - Em Dia", 730, idade=40, bairro="Marco", com_login=True)
    _associado(db, categoria, "Grafico Beta de Teste", "Ativo - Inadimplente", 60, idade=20, bairro="Pedreira")
    _associado(db, categoria, "Grafico Gama de Teste", "Desligado", 1095, idade=55, bairro="Marco", saiu_ha_dias=30)
    _associado(db, categoria, "Grafico Delta de Teste", "Em Experiência", 0)
    # ~10,7 anos atrás (2016): mais de 10 anos de casa, mas DEPOIS de 2015, o ano que o teste do relatório anual reserva no banco compartilhado
    _associado(db, categoria, "Grafico Epsilon de Teste", "Licenciado", 3900, idade=70, bairro="Umarizal")
    return categoria


def test_numeros_e_graficos_do_quadro_filtrado_pela_categoria(client, auth_headers, db):
    categoria = _quadro_de_teste(db)
    r = client.get(ROTA, params={"categoria": categoria, "meses": 12}, headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    n = corpo["numeros"]
    assert (n["cadastrados"], n["no_quadro"], n["desligados"], n["ativos"], n["em_dia"]) == (5, 4, 1, 2, 1)
    assert n["percentual_em_dia"] == 50
    assert (n["entraram"], n["sairam"]) == (2, 1)
    assert (n["idade_media"], n["idade_minima"], n["idade_maxima"]) == (43, 20, 70)
    assert (n["com_acesso"], n["percentual_com_acesso"]) == (1, 25)

    assert len(corpo["por_mes"]) == 12 and len(corpo["quadro_por_mes"]) == 12
    assert corpo["quadro_por_mes"][-1]["total"] == 4, "no fim do mês atual: quem está no quadro hoje"
    assert corpo["quadro_por_mes"][0]["total"] == 3, "12 meses atrás: A, C (ainda não desligado) e E"
    assert sum(m["entraram"] for m in corpo["por_mes"]) == 2 and sum(m["sairam"] for m in corpo["por_mes"]) == 1

    assert {s["nome"]: s["total"] for s in corpo["por_situacao"]} == {
        "Ativo - Em Dia": 1, "Ativo - Inadimplente": 1, "Em Experiência": 1, "Licenciado": 1, "Desligado": 1,
    }
    assert [s["nome"] for s in corpo["por_situacao"]][:2] == ["Ativo - Em Dia", "Ativo - Inadimplente"], "na ordem do catálogo"
    assert corpo["por_categoria"] == [{"nome": categoria, "total": 4}]
    idades = {f["faixa"]: f["total"] for f in corpo["faixas_de_idade"]}
    assert idades["18–29"] == 1 and idades["30–44"] == 1 and idades["60 ou mais"] == 1 and idades["Sem data de nascimento"] == 1
    assert "Menos de 16" not in idades
    # onde moram e tempo de associação: só quem está no quadro (o desligado do Marco não conta)
    assert {b["nome"]: b["total"] for b in corpo["por_bairro"]} == {"Marco": 1, "Pedreira": 1, "Umarizal": 1, "Sem bairro informado": 1}
    tempos = {t["faixa"]: t["total"] for t in corpo["tempo_de_associacao"]}
    assert (tempos["Menos de 1 ano"], tempos["De 1 a 3 anos"], tempos["10 anos ou mais"]) == (2, 1, 1)
    assert "Sem data de entrada" not in tempos

    assert categoria in corpo["filtros_disponiveis"]["categorias"]
    assert {"Marco", "Pedreira", "Umarizal"} <= set(corpo["filtros_disponiveis"]["bairros"])
    assert corpo["periodo"]["meses"] == 12


def test_filtros_de_situacao_e_bairro(client, auth_headers, db):
    categoria = _quadro_de_teste(db)
    so_inadimplentes = client.get(ROTA, params={"categoria": categoria, "situacao": "Ativo - Inadimplente"}, headers=auth_headers).json()
    assert so_inadimplentes["numeros"]["cadastrados"] == 1 and so_inadimplentes["numeros"]["em_dia"] == 0
    marco = client.get(ROTA, params={"categoria": categoria, "bairro": "Marco"}, headers=auth_headers).json()
    assert (marco["numeros"]["cadastrados"], marco["numeros"]["no_quadro"], marco["numeros"]["desligados"]) == (2, 1, 1)


def test_periodo_curto_so_conta_o_que_aconteceu_nele(client, auth_headers, db):
    categoria = _quadro_de_teste(db)
    corpo = client.get(ROTA, params={"categoria": categoria, "meses": 1}, headers=auth_headers).json()
    assert len(corpo["por_mes"]) == 1 and corpo["periodo"]["de"] == corpo["periodo"]["ate"]
    # no mês atual só entrou D (B entrou há 60 dias); a saída de C foi há 30 dias e pode cair no mês passado
    assert corpo["numeros"]["entraram"] == 1
    assert client.get(ROTA, params={"meses": 0}, headers=auth_headers).status_code == 422
    assert client.get(ROTA, params={"meses": 61}, headers=auth_headers).status_code == 422


def test_so_contagens_nenhum_nome_ou_cpf_sai_da_rota(client, auth_headers, db):
    categoria = _categoria()
    a = _associado(db, categoria, "Nome Que Nao Pode Aparecer", "Ativo - Em Dia", 100, idade=33, bairro="Sacramenta")
    pessoa = db.query(Pessoa).filter(Pessoa.id_pessoa == a.id_pessoa).first()
    cpf = _cpf_unico()
    pessoa.cpf = cpf
    pessoa.email_contato = "nao.pode.aparecer@teste.local"
    db.commit()
    texto = json.dumps(client.get(ROTA, params={"categoria": categoria}, headers=auth_headers).json(), ensure_ascii=False)
    for proibido in ("Nome Que Nao Pode Aparecer", cpf, f"{cpf[:3]}.{cpf[3:6]}.{cpf[6:9]}-{cpf[9:]}", "nao.pode.aparecer"):
        assert proibido not in texto, proibido


def test_quem_foi_readmitido_conta_no_quadro_e_desligado_sem_data_nao(client, auth_headers, db):
    """A data de desligamento antiga de quem voltou não o tira do quadro; desligado sem data não entra em mês nenhum."""
    categoria = _categoria()
    _associado(db, categoria, "Grafico Readmitido", "Ativo - Em Dia", 900, idade=50, saiu_ha_dias=200)
    _associado(db, categoria, "Grafico Desligado Sem Data", "Desligado", 900, idade=50)
    corpo = client.get(ROTA, params={"categoria": categoria, "meses": 12}, headers=auth_headers).json()
    assert [m["total"] for m in corpo["quadro_por_mes"]] == [1] * 12
    assert corpo["numeros"]["no_quadro"] == 1 and corpo["numeros"]["desligados"] == 1


def test_idade_abaixo_da_primeira_faixa_e_cadastro_sem_data_de_entrada_nao_somem(client, auth_headers, db):
    categoria = _categoria()
    jovem = _associado(db, categoria, "Grafico Jovem", "Em Experiência", 10, idade=14)
    jovem.data_admissao = None
    db.commit()
    corpo = client.get(ROTA, params={"categoria": categoria}, headers=auth_headers).json()
    assert {f["faixa"]: f["total"] for f in corpo["faixas_de_idade"]}["Menos de 16"] == 1
    assert {t["faixa"]: t["total"] for t in corpo["tempo_de_associacao"]}["Sem data de entrada"] == 1
    assert corpo["quadro_por_mes"][-1]["total"] == 1


def test_filiacao_conta_os_pedidos_recebidos_no_periodo(client, auth_headers, db):
    categoria = _quadro_de_teste(db)
    antes = client.get(ROTA, params={"categoria": categoria}, headers=auth_headers).json()["filiacao"]
    socios = db.query(Associado).filter(Associado.categoria == categoria).limit(3).all()
    aprovado = PropostaFiliacao(nome_completo="Pedido Grafico Aprovado", cpf=_cpf_unico(), status=APROVADA)
    com_os_tres = PropostaFiliacao(nome_completo="Pedido Grafico Tres Socios", cpf=_cpf_unico())
    antigo = PropostaFiliacao(nome_completo="Pedido Grafico Antigo", cpf=_cpf_unico(), criado_em=datetime.utcnow() - timedelta(days=800))
    db.add_all([aprovado, com_os_tres, antigo])
    db.flush()
    for socio in socios:
        db.add(PropostaDeSocio(id_proposta=com_os_tres.id_proposta, id_associado=socio.id_associado, decisao=PROPOE))
    db.commit()
    depois = client.get(ROTA, params={"categoria": categoria}, headers=auth_headers).json()["filiacao"]
    assert depois["pedidos"] - antes["pedidos"] == 2, "o pedido de 800 dias atrás está fora dos 12 meses"
    assert depois["aprovados"] - antes["aprovados"] == 1
    assert depois["com_os_3_socios"] - antes["com_os_3_socios"] == 1
    assert depois["em_andamento"] - antes["em_andamento"] == 1


def test_exige_login_e_a_permissao_de_associados(client, db):
    from tests.test_catalogos_permissao import _criar_usuario_com_permissao, _headers

    assert client.get(ROTA).status_code == 401
    so_financeiro = _headers(_criar_usuario_com_permissao(db, "financeiro"))
    assert client.get(ROTA, headers=so_financeiro).status_code == 403
    com_associados = _headers(_criar_usuario_com_permissao(db, "associados"))
    assert client.get(ROTA, headers=com_associados).status_code == 200
