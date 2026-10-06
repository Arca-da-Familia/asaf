"""v2.9 (FASE 2) - calendário institucional: obrigações estatutárias recorrentes calculadas
(AGO semestral Art. 5º/I, eleição quadrienal Art. 25) + agregação de dado real de outros módulos
(assembleia, mandato, deliberação, projeto/evento) + eventos institucionais genéricos."""
from datetime import date, datetime, timedelta, timezone

from app.models.associados import Associado
from app.models.mandatos import Mandato
from app.models.projetos import ProjetoEvento
from app.services.calendario import proxima_eleicao

_ISO = "%Y-%m-%dT%H:%M:%S"


def test_calendario_traz_as_duas_ago_estatutarias(client, auth_headers):
    r = client.get("/api/calendario/?dias_antecedencia=365", headers=auth_headers)
    assert r.status_code == 200
    ago = [i for i in r.json() if i["tipo"] == "AGO_ESTATUTARIA"]
    assert len(ago) == 2
    assert all(i["artigo_origem"] == "Art. 5º, I" for i in ago)


def test_proxima_eleicao_calculada_a_partir_do_ultimo_presidente(client, auth_headers, db):
    from app.models.pessoas import Pessoa
    pessoa = Pessoa(nome_completo="Presidente Teste Calendario")
    db.add(pessoa)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa)
    db.add(associado)
    db.flush()
    # Data bem no futuro de propósito, pra garantir que este é sempre o mandato de Presidente
    # mais recente do banco (independente de quantos outros testes já criaram um) - o que
    # importa aqui é testar a FÓRMULA (data_inicio + DURACAO_MANDATO_ANOS), não uma data real.
    db.add(Mandato(
        id_associado=associado.id_associado, orgao_codigo="DIRETORIA_EXECUTIVA", cargo_codigo="PRESIDENTE",
        data_inicio=datetime(3000, 3, 10), data_fim_previsto=datetime(3004, 3, 10),
    ))
    db.commit()

    eleicao = proxima_eleicao(db, date.today())
    assert eleicao is not None
    assert eleicao["artigo_origem"] == "Art. 25"
    assert eleicao["data"] == date(3004, 2, 1)  # 3000 + DURACAO_MANDATO_ANOS (4, v2.0)


def test_criar_evento_categoria_invalida_falha(client, auth_headers):
    r = client.post(
        "/api/eventos-calendario/", headers=auth_headers,
        json={"titulo": "Reunião qualquer", "categoria": "CATEGORIA_QUE_NAO_EXISTE", "data_inicio": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO)},
    )
    assert r.status_code == 422


def test_criar_evento_institucional_aparece_no_calendario(client, auth_headers):
    data_evento = datetime.utcnow() + timedelta(days=5)
    r = client.post(
        "/api/eventos-calendario/", headers=auth_headers,
        json={"titulo": "Reunião mensal da Diretoria", "categoria": "REUNIAO_DIRETORIA", "data_inicio": data_evento.strftime(_ISO)},
    )
    assert r.status_code == 200, r.text

    calendario = client.get("/api/calendario/?dias_antecedencia=30", headers=auth_headers).json()
    assert any(i["tipo"] == "EVENTO_INSTITUCIONAL" and i["titulo"] == "Reunião mensal da Diretoria" for i in calendario)

    listados = client.get("/api/eventos-calendario/", headers=auth_headers).json()
    assert any(e["titulo"] == "Reunião mensal da Diretoria" for e in listados)


def test_calendario_traz_projeto_evento_real_da_associacao(client, auth_headers, db):
    db.add(ProjetoEvento(nome_projeto="Campanha do Agasalho 2026", data_inicio=datetime.utcnow() + timedelta(days=7), data_fim_prevista=datetime.utcnow() + timedelta(days=14)))
    db.commit()

    calendario = client.get("/api/calendario/?dias_antecedencia=30", headers=auth_headers).json()
    assert any(i["tipo"] == "PROJETO_EVENTO" and i["titulo"] == "Campanha do Agasalho 2026" for i in calendario)


def test_calendario_ordenado_por_data(client, auth_headers):
    calendario = client.get("/api/calendario/?dias_antecedencia=365", headers=auth_headers).json()
    datas = [datetime.strptime(i["data"], "%Y-%m-%d").date() if isinstance(i["data"], str) else i["data"] for i in calendario]
    assert datas == sorted(datas)


def test_ago_le_meses_de_regra_estatutaria_nao_de_texto_fixo(client, auth_headers):
    """Ponto de Revisão FASE 2 (3/3): achado real - `proximas_ago` tinha os meses (2, 8) fixos em
    código, ignorando `MESES_AGO_ESTATUTARIA` (Art. 5º, I, v2.0) que passou a existir depois desta
    revisão. Prova que reformar o parâmetro muda o calendário sem deploy, mesmo padrão já coberto
    para PROCURACAO_PERMITIDA e QUORUM_1A_CONVOCACAO."""
    r = client.put("/api/estatuto/regras/MESES_AGO_ESTATUTARIA", headers=auth_headers, json={"valor": "3,9"})
    assert r.status_code == 200, r.text

    calendario = client.get("/api/calendario/?dias_antecedencia=365", headers=auth_headers).json()
    ago = [i for i in calendario if i["tipo"] == "AGO_ESTATUTARIA"]
    assert len(ago) == 2
    assert {i["titulo"] for i in ago} == {"Assembleia Geral Ordinária (março)", "Assembleia Geral Ordinária (setembro)"}

    r_restaura = client.put("/api/estatuto/regras/MESES_AGO_ESTATUTARIA", headers=auth_headers, json={"valor": "2,8"})
    assert r_restaura.status_code == 200, r_restaura.text


def _evento(client, auth_headers, titulo, inicio, fim=None):
    corpo = {"titulo": titulo, "categoria": "REUNIAO_DIRETORIA", "data_inicio": inicio.strftime(_ISO)}
    if fim:
        corpo["data_fim"] = fim.strftime(_ISO)
    return client.post("/api/eventos-calendario/", headers=auth_headers, json=corpo)


def test_evento_da_noite_aparece_no_dia_local_e_nao_no_dia_seguinte_em_utc(client, auth_headers, db):
    # achado da v5.4d: o calendário tomava o dia em UTC. Uma reunião às 22h30 em Belém (UTC-3) é 01h30 UTC do dia SEGUINTE e aparecia lá.
    from app.services.calendario import dia_local, fuso_da_associacao

    fuso = fuso_da_associacao(db)
    dia = dia_local(datetime.utcnow(), fuso) + timedelta(days=5)
    local_22h30 = datetime(dia.year, dia.month, dia.day, 22, 30, tzinfo=fuso)
    em_utc = local_22h30.astimezone(timezone.utc).replace(tzinfo=None)
    assert em_utc.date() == dia + timedelta(days=1), "o caso só prova algo se o instante UTC cai no dia seguinte"

    r = _evento(client, auth_headers, "Reunião da noite no horário de Belém", em_utc)
    assert r.status_code == 200, r.text
    itens = client.get("/api/calendario/?dias_antecedencia=30", headers=auth_headers).json()
    item = next(i for i in itens if i["titulo"] == "Reunião da noite no horário de Belém")
    assert item["data"] == dia.isoformat()
    assert item["dias_restantes"] == (dia - dia_local(datetime.utcnow(), fuso)).days


def test_evento_com_fim_antes_do_inicio_ou_no_passado_e_recusado(client, auth_headers):
    inicio = datetime.utcnow() + timedelta(days=10)
    r_fim = _evento(client, auth_headers, "Reunião que acaba antes de começar", inicio, fim=inicio - timedelta(hours=1))
    assert r_fim.status_code == 422
    assert "depois do início" in r_fim.text

    r_passado = _evento(client, auth_headers, "Reunião que já passou", datetime.utcnow() - timedelta(days=3))
    assert r_passado.status_code == 400
    assert "já passou" in r_passado.json()["detail"]


def test_remover_evento_agendado_por_engano_sai_do_calendario_e_fica_na_auditoria(client, auth_headers, db):
    from app.models.core import AuditLog
    from tests.test_conselho_fiscal import _criar_associado, _headers

    r = _evento(client, auth_headers, "Evento agendado por engano", datetime.utcnow() + timedelta(days=4))
    id_evento = r.json()["id_evento"]
    itens = client.get("/api/calendario/?dias_antecedencia=30", headers=auth_headers).json()
    assert any(i.get("id_evento") == id_evento for i in itens), "o item do calendário traz o id para a tela poder remover"

    _associado, comum = _criar_associado(db, "Associado Que Nao Remove Evento")
    assert client.delete(f"/api/eventos-calendario/{id_evento}", headers=_headers(comum)).status_code == 403
    assert client.delete(f"/api/eventos-calendario/{id_evento}").status_code == 401

    assert client.delete(f"/api/eventos-calendario/{id_evento}", headers=auth_headers).status_code == 200
    itens = client.get("/api/calendario/?dias_antecedencia=30", headers=auth_headers).json()
    assert not any(i.get("id_evento") == id_evento for i in itens)
    assert client.delete(f"/api/eventos-calendario/{id_evento}", headers=auth_headers).status_code == 404

    removido = db.query(AuditLog).filter(AuditLog.tabela_afetada == "eventos_calendario", AuditLog.acao == "REMOVIDO", AuditLog.id_registro_afetado == id_evento).all()
    assert len(removido) == 1
    assert "Evento agendado por engano" in str(removido[0].dados_antes)

