"""v4.6 (FASE 4) - inscrição pública com deduplicação: formulário do site (sem login), CPF já
conhecido vincula ao cadastro existente (nunca duplica), CPF novo cria "participante externo"
(nunca vira associado automaticamente), perguntas personalizadas obrigatórias, código de
check-in + autocancelamento por token, rate limiting por IP e honeypot."""
import uuid
from datetime import datetime, timedelta

from tests.test_pessoas import _cpf_unico

_ISO = "%Y-%m-%dT%H:%M:%S"


def _ip_de_teste() -> dict:
    """Cada teste usa um IP fake próprio (via X-Forwarded-For - ver `_ip_publico` em
    app/routers/eventos.py, que existe justamente pra tratar o IP real de quem está atrás do
    proxy do Container App) - sem isso, todos os testes deste arquivo compartilhariam o mesmo
    balde de rate limiting (o `request.client.host` do TestClient é sempre o mesmo), e um teste
    esbarraria no 429 gerado por outro."""
    return {"X-Forwarded-For": f"203.0.113.{uuid.uuid4().hex[:2]}"}


def _criar_evento_publico(client, auth_headers, **overrides) -> int:
    payload = {
        "titulo": f"Evento Público Teste {uuid.uuid4().hex[:6]}",
        "categoria": "PALESTRA",
        "data_hora_inicio": (datetime.utcnow() + timedelta(days=10)).strftime(_ISO),
        "visibilidade": "Pública",
        **overrides,
    }
    r = client.post("/api/eventos/", json=payload, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_evento"]


def _payload_inscricao(**overrides) -> dict:
    cpf = _cpf_unico()
    payload = {
        "nome_completo": "Participante Externo Teste",
        "cpf": cpf,
        "email": f"{cpf}@x.com",
        "telefone": "11988887777",
        "consentimento_lgpd": True,
        "versao_texto_consentimento": "1",
        **overrides,
    }
    return payload


def test_inscricao_publica_cria_participante_externo_novo(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    payload = _payload_inscricao()

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload, headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["codigo_checkin"]
    assert corpo["status"] == "Pré-inscrito"

    pessoas = client.get("/api/associados/busca-simples", headers=auth_headers).json()
    assert not any(p.get("cpf_final") == payload["cpf"][-4:] for p in pessoas), "participante externo nunca deveria aparecer como associado"


def test_inscricao_publica_com_cpf_conhecido_vincula_ao_cadastro_existente(client, auth_headers, db):
    from app.models.pessoas import Papel, Pessoa

    id_evento_1 = _criar_evento_publico(client, auth_headers)
    id_evento_2 = _criar_evento_publico(client, auth_headers)
    payload = _payload_inscricao()
    ip = _ip_de_teste()

    r1 = client.post(f"/api/publico/eventos/{id_evento_1}/inscrever-se", json=payload, headers=ip)
    assert r1.status_code == 200, r1.text

    total_pessoas_com_cpf = db.query(Pessoa).filter(Pessoa.cpf == payload["cpf"]).count()
    assert total_pessoas_com_cpf == 1

    # segunda inscrição, outro evento, MESMO CPF - nunca cria uma segunda Pessoa.
    r2 = client.post(f"/api/publico/eventos/{id_evento_2}/inscrever-se", json=payload, headers=ip)
    assert r2.status_code == 200, r2.text
    assert db.query(Pessoa).filter(Pessoa.cpf == payload["cpf"]).count() == 1

    pessoa = db.query(Pessoa).filter(Pessoa.cpf == payload["cpf"]).first()
    papel = db.query(Papel).filter(Papel.id_pessoa == pessoa.id_pessoa, Papel.tipo_papel == "participante_externo").first()
    assert papel is not None


def test_inscricao_publica_evento_interno_e_recusada(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers, visibilidade="Interna")
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=_ip_de_teste())
    assert r.status_code == 404


def test_inscricao_publica_exige_consentimento_lgpd(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(consentimento_lgpd=False), headers=_ip_de_teste())
    assert r.status_code == 422


def test_inscricao_publica_recusa_versao_de_consentimento_desatualizada(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(versao_texto_consentimento="999"), headers=_ip_de_teste())
    assert r.status_code == 422
    assert "consentimento" in r.json()["detail"].lower()


def test_inscricao_publica_valida_cpf_invalido(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(cpf="11111111111"), headers=_ip_de_teste())
    assert r.status_code == 422


def test_pergunta_obrigatoria_nao_respondida_e_recusada(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    r = client.post(f"/api/eventos/{id_evento}/perguntas", json={
        "enunciado": "Qual seu tamanho de camiseta?", "tipo": "SELECAO_UNICA", "opcoes": "P,M,G",
        "obrigatoria": True, "ordem": 0,
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    id_pergunta = r.json()["id_pergunta"]
    ip = _ip_de_teste()

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=ip)
    assert r.status_code == 422
    assert "obrigatória" in r.json()["detail"].lower()

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(respostas={str(id_pergunta): "M"}), headers=ip)
    assert r.status_code == 200, r.text


def test_perguntas_publicas_sao_listadas_no_detalhe_do_evento(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    client.post(f"/api/eventos/{id_evento}/perguntas", json={
        "enunciado": "Restrição alimentar?", "tipo": "TEXTO_CURTO", "obrigatoria": False, "ordem": 0,
    }, headers=auth_headers)

    detalhe = client.get(f"/api/publico/eventos/{id_evento}").json()
    assert len(detalhe["perguntas"]) == 1
    assert detalhe["perguntas"][0]["enunciado"] == "Restrição alimentar?"


def test_honeypot_finge_sucesso_sem_gravar_nada(client, auth_headers, db):
    from app.models.pessoas import Pessoa

    id_evento = _criar_evento_publico(client, auth_headers)
    payload = _payload_inscricao(pagina_web="http://spam.exemplo")

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=payload, headers=_ip_de_teste())
    assert r.status_code == 200, r.text
    assert r.json()["codigo_checkin"] is None

    assert db.query(Pessoa).filter(Pessoa.cpf == payload["cpf"]).count() == 0


def test_autocancelamento_por_token(client, auth_headers, db):
    from app.models.motores import Inscricao

    id_evento = _criar_evento_publico(client, auth_headers)
    ip = _ip_de_teste()
    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=ip)
    id_inscricao = r.json()["id_inscricao"]
    token = db.query(Inscricao).filter(Inscricao.id_inscricao == id_inscricao).first().token_cancelamento

    r = client.post(f"/api/publico/inscricoes/{token}/cancelar", headers=ip)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Cancelado"

    r = client.post(f"/api/publico/inscricoes/{token}/cancelar", headers=ip)
    assert r.status_code == 400  # já estava cancelada


def test_autocancelamento_com_token_invalido_e_404(client):
    r = client.post("/api/publico/inscricoes/token-que-nao-existe/cancelar", headers=_ip_de_teste())
    assert r.status_code == 404


def test_endpoint_publico_de_consentimento_lgpd_nao_colide_com_detalhe_do_evento(client):
    """Achado real da v4.5 (rota literal vs `/{id_evento}` casando por ordem de registro) quase
    se repetiu aqui com `/api/publico/eventos/consentimento-lgpd` - teste dedicado pra nunca
    mais deixar passar sem cobertura."""
    r = client.get("/api/publico/eventos/consentimento-lgpd")
    assert r.status_code == 200, r.text
    assert "texto" in r.json() and "versao" in r.json()


def test_rate_limiting_por_ip_no_endpoint_publico_de_inscricao(client, auth_headers):
    id_evento = _criar_evento_publico(client, auth_headers)
    ip = _ip_de_teste()  # UM ip fixo, reaproveitado nas 6 chamadas - é isso que está sendo testado

    for _ in range(5):
        r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=ip)
        assert r.status_code == 200, r.text

    r = client.post(f"/api/publico/eventos/{id_evento}/inscrever-se", json=_payload_inscricao(), headers=ip)
    assert r.status_code == 429
