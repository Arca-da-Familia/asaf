"""v2.6 (FASE 2) - Conselho Fiscal com poder real: leitura financeira auditada, parecer exclusivo
de quem tem nível com is_conselho_fiscal, fila de questionamentos, e a trava de "aprovação de
contas exige parecer prévio" na deliberação (v2.5)."""
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.financeiro import TituloFinanceiro
from app.models.pessoas import Pessoa
from app.security import criar_access_token, hash_senha

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_associado(db, nome, nome_nivel="Associado") -> tuple[Associado, Usuario]:
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == nome_nivel).first()
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


def test_leitura_financeira_gera_entrada_de_auditoria(client, auth_headers):
    r = client.get("/api/conselho-fiscal/financeiro/titulos", headers=auth_headers)
    assert r.status_code == 200

    auditoria = client.get("/api/auditoria/?limite=5", headers=auth_headers).json()
    entradas = [e for e in auditoria["entradas"] if e["tabela_afetada"] == "titulos_financeiros" and e["acao"] == "CONSULTA_CONSELHO_FISCAL"]
    assert entradas, "esperava ao menos uma entrada de auditoria de consulta do Conselho Fiscal"


def test_emitir_parecer_exige_nivel_conselho_fiscal(client, auth_headers, db):
    diretor, usuario_diretor = _criar_associado(db, "Diretor Nao Conselho", nome_nivel="Diretoria")
    r_negado = client.post(
        "/api/conselho-fiscal/pareceres", headers=_headers(usuario_diretor),
        json={"ano_exercicio": 2026, "tipo": "Favorável", "texto": "Contas em ordem, sem ressalvas a apontar."},
    )
    assert r_negado.status_code == 403

    conselheiro, usuario_conselheiro = _criar_associado(db, "Conselheiro Fiscal Um", nome_nivel="Conselho Fiscal")
    r = client.post(
        "/api/conselho-fiscal/pareceres", headers=_headers(usuario_conselheiro),
        json={"ano_exercicio": 2026, "tipo": "Favorável", "texto": "Contas em ordem, sem ressalvas a apontar."},
    )
    assert r.status_code == 200, r.text

    listados = client.get("/api/conselho-fiscal/pareceres?ano_exercicio=2026", headers=auth_headers).json()
    assert any(p["id_parecer"] == r.json()["id_parecer"] for p in listados)


def test_fila_de_questionamento_exige_conselho_fiscal_para_abrir_e_financeiro_para_responder(client, auth_headers, db):
    conselheiro, usuario_conselheiro = _criar_associado(db, "Conselheiro Fiscal Dois", nome_nivel="Conselho Fiscal")
    diretor, usuario_diretor = _criar_associado(db, "Diretor Sem Conselho", nome_nivel="Diretoria")

    titulo = TituloFinanceiro(tipo_titulo="Despesa", descricao="Pagamento de fornecedor", valor_original=500, saldo_devedor=500, status="Pago", data_vencimento=datetime.utcnow())
    db.add(titulo)
    db.commit()
    db.refresh(titulo)

    r_negado = client.post(f"/api/financeiro/titulos/{titulo.id_titulo}/questionamentos", headers=_headers(usuario_diretor), json={"pergunta": "Por que esse valor está acima do orçado?"})
    assert r_negado.status_code == 403

    r = client.post(f"/api/financeiro/titulos/{titulo.id_titulo}/questionamentos", headers=_headers(usuario_conselheiro), json={"pergunta": "Por que esse valor está acima do orçado?"})
    assert r.status_code == 200, r.text
    id_questionamento = r.json()["id_questionamento"]
    assert r.json()["status"] == "Aberto"

    r_resp = client.post(f"/api/questionamentos/{id_questionamento}/respostas", headers=auth_headers, json={"texto": "Reajuste contratual anual, conforme cláusula 5 do contrato."})
    assert r_resp.status_code == 200
    assert r_resp.json()["status_questionamento"] == "Respondido"

    respostas = client.get(f"/api/questionamentos/{id_questionamento}/respostas", headers=auth_headers).json()
    assert len(respostas) == 1

    questionamentos = client.get(f"/api/financeiro/titulos/{titulo.id_titulo}/questionamentos", headers=auth_headers).json()
    assert questionamentos[0]["status"] == "Respondido"


def test_deliberacao_aprovacao_contas_exige_parecer_previo(client, auth_headers, db):
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "Aprovação de contas 2027", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    client.post(f"/api/assembleias/{id_assembleia}/abrir-sessao", headers=auth_headers)
    id_ata = client.post(f"/api/assembleias/{id_assembleia}/ata", headers=auth_headers).json()["id_ata"]

    r_sem_ano = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Aprovação de contas", "texto": "Aprovação das contas do exercício."})
    assert r_sem_ano.status_code == 422  # ano_exercicio obrigatório para este tipo

    r_sem_parecer = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Aprovação de contas", "texto": "Aprovação das contas do exercício.", "ano_exercicio": 2027})
    assert r_sem_parecer.status_code == 400
    assert "parecer" in r_sem_parecer.json()["detail"].lower()

    conselheiro, usuario_conselheiro = _criar_associado(db, "Conselheiro Fiscal Tres", nome_nivel="Conselho Fiscal")
    client.post("/api/conselho-fiscal/pareceres", headers=_headers(usuario_conselheiro), json={"ano_exercicio": 2027, "tipo": "Favorável", "texto": "Contas conferidas e aprovadas sem ressalvas."})

    r_com_parecer = client.post(f"/api/atas/{id_ata}/deliberacoes", headers=auth_headers, json={"tipo": "Aprovação de contas", "texto": "Aprovação das contas do exercício.", "ano_exercicio": 2027})
    assert r_com_parecer.status_code == 200, r_com_parecer.text
