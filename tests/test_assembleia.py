"""v2.2 (FASE 2) - convocação e habilitação de assembleia. Critério de habilitados é só o que o
estatuto real tem (Art. 13 caput + Art. 4º): em dia com as obrigações e em pleno gozo dos
direitos - "licenciado" nunca vota (decisão confirmada pelo usuário: pedir licença é abrir mão
dos direitos associativos, independente de estar em dia com a mensalidade)."""
from datetime import date, datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.financeiro import TituloFinanceiro
from app.models.governanca import PeticaoConvocacao
from app.models.pessoas import Pessoa
from app.security import criar_access_token, hash_senha

_ISO = "%Y-%m-%dT%H:%M:%S"


def _criar_associado(db, nome, status_extra=None) -> Associado:
    """status_extra: 'licenciado' ou 'inadimplente' - None é 'Ativo - Em Dia' comum."""
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"{nome.lower().replace(' ', '.')}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    if status_extra == "licenciado":
        associado.data_fim_licenca = datetime.utcnow() + timedelta(days=30)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    if status_extra == "inadimplente":
        db.add(TituloFinanceiro(
            id_associado=associado.id_associado, tipo_titulo="Mensalidade", descricao="Mensalidade de teste",
            valor_original=50, saldo_devedor=50, status="Pendente",
            data_vencimento=datetime.utcnow() - timedelta(days=60),
        ))
        db.commit()
    return associado


def _headers_para(usuario: Usuario) -> dict:
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def test_criar_assembleia_tipo_invalido_falha(client, auth_headers):
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Informal", "pauta": "Pauta qualquer", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    assert r.status_code == 422


def test_convocar_assembleia_antes_do_prazo_minimo_falha(client, auth_headers):
    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "Pauta de teste", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=1)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    r2 = client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    assert r2.status_code == 400
    assert "Art. 8" in r2.json()["detail"]


def test_convocar_assembleia_congela_lista_de_habilitados_pelo_criterio_real_do_estatuto(client, auth_headers, db):
    em_dia = _criar_associado(db, "Em Dia Assembleia")
    licenciado = _criar_associado(db, "Licenciado Assembleia", status_extra="licenciado")
    inadimplente = _criar_associado(db, "Inadimplente Assembleia", status_extra="inadimplente")

    r = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Extraordinária", "pauta": "Eleição da Diretoria", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r.json()["id_assembleia"]
    r2 = client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "Convocada"

    habilitados = {h["id_associado"]: h for h in client.get(f"/api/assembleias/{id_assembleia}/habilitados", headers=auth_headers).json()}
    assert habilitados[em_dia.id_associado]["habilitado"] is True
    assert habilitados[licenciado.id_associado]["habilitado"] is False
    assert habilitados[inadimplente.id_associado]["habilitado"] is False

    # congelada: mesmo que o associado deixe de estar licenciado depois, a lista não recalcula.
    db.query(Associado).filter(Associado.id_associado == licenciado.id_associado).update({"data_fim_licenca": None})
    db.commit()
    habilitados_depois = {h["id_associado"]: h for h in client.get(f"/api/assembleias/{id_assembleia}/habilitados", headers=auth_headers).json()}
    assert habilitados_depois[licenciado.id_associado]["habilitado"] is False

    edital = client.get(f"/api/assembleias/{id_assembleia}/edital", headers=auth_headers).json()["edital_texto"]
    assert "EDITAL DE CONVOCAÇÃO" in edital
    assert "Eleição da Diretoria" in edital


def test_peticao_atinge_quorum_e_converte_em_assembleia_pela_diretoria(client, auth_headers, db):
    base_antes = db.query(Associado).filter(Associado.status_arrolamento != "Desligado").count()
    qtd_novos = base_antes // 4 + 1  # garante >= 1/5 só com os novos aderentes
    aderentes = [_criar_associado(db, f"Peticionario {i}") for i in range(qtd_novos)]

    r = client.post("/api/peticoes-convocacao/", headers=auth_headers, json={"pauta_proposta": "Reforma do estatuto"})
    id_peticao = r.json()["id_peticao"]

    for associado in aderentes:
        usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
        r_ade = client.post(f"/api/peticoes-convocacao/{id_peticao}/aderir", headers=_headers_para(usuario))
        assert r_ade.status_code == 200, r_ade.text

    detalhe = client.get(f"/api/peticoes-convocacao/{id_peticao}", headers=auth_headers).json()
    assert detalhe["status"] == "Quórum atingido"
    assert detalhe["fracao_atual"] >= 0.2

    r_conv = client.post(
        f"/api/peticoes-convocacao/{id_peticao}/converter-em-assembleia", headers=auth_headers,
        json={"tipo": "Extraordinária", "pauta": "Reforma do estatuto", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    assert r_conv.status_code == 200, r_conv.text
    assert r_conv.json()["origem_convocacao"] == "Petição"

    peticao_depois = db.query(PeticaoConvocacao).filter(PeticaoConvocacao.id_peticao == id_peticao).first()
    assert peticao_depois.status == "Convertida em assembleia"


def test_peticao_aderente_nao_pode_converter_antes_do_prazo_do_presidente_esgotar(client, auth_headers, db):
    base_antes = db.query(Associado).filter(Associado.status_arrolamento != "Desligado").count()
    qtd_novos = base_antes // 4 + 1
    aderentes = [_criar_associado(db, f"Peticionario Prazo {i}") for i in range(qtd_novos)]

    r = client.post("/api/peticoes-convocacao/", headers=auth_headers, json={"pauta_proposta": "Convocação por petição"})
    id_peticao = r.json()["id_peticao"]
    for associado in aderentes:
        usuario = db.query(Usuario).filter(Usuario.id_usuario == associado.id_usuario).first()
        client.post(f"/api/peticoes-convocacao/{id_peticao}/aderir", headers=_headers_para(usuario))

    primeiro_aderente_usuario = db.query(Usuario).filter(Usuario.id_usuario == aderentes[0].id_usuario).first()
    corpo_conversao = {"tipo": "Extraordinária", "pauta": "Convocação por petição", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)}

    r_cedo = client.post(f"/api/peticoes-convocacao/{id_peticao}/converter-em-assembleia", headers=_headers_para(primeiro_aderente_usuario), json=corpo_conversao)
    assert r_cedo.status_code == 403

    # Art. 10, Parágrafo Único: passado o prazo do Presidente (30 dias) sem convocar, os
    # próprios associados podem - simula o prazo já esgotado.
    peticao = db.query(PeticaoConvocacao).filter(PeticaoConvocacao.id_peticao == id_peticao).first()
    peticao.data_quorum_atingido = datetime.utcnow() - timedelta(days=31)
    db.commit()

    r_tarde = client.post(f"/api/peticoes-convocacao/{id_peticao}/converter-em-assembleia", headers=_headers_para(primeiro_aderente_usuario), json=corpo_conversao)
    assert r_tarde.status_code == 200, r_tarde.text


def test_edital_le_quorum_de_regra_estatutaria_nao_de_texto_fixo(client, auth_headers):
    """Ponto de Revisão FASE 2 (1/3): achado real - `gerar_edital` tinha "2/3"/"1/2 + 1"/"1/4"
    escritos direto no texto do edital, ignorando `QUORUM_1A/2A/3A_CONVOCACAO` (v2.0). Corrigido
    para ler `obter_regra_vigente`; este teste prova que reformar o parâmetro muda o edital sem
    deploy, mesma garantia já coberta para PROCURACAO_PERMITIDA."""
    r = client.put("/api/estatuto/regras/QUORUM_1A_CONVOCACAO", headers=auth_headers, json={"valor": "3/4"})
    assert r.status_code == 200, r.text

    r_assembleia = client.post(
        "/api/assembleias/", headers=auth_headers,
        json={"tipo": "Ordinária", "pauta": "Pauta de teste", "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO)},
    )
    id_assembleia = r_assembleia.json()["id_assembleia"]
    client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers)

    edital = client.get(f"/api/assembleias/{id_assembleia}/edital", headers=auth_headers).json()["edital_texto"]
    assert "quórum: 3/4 dos associados aptos" in edital
    assert "quórum: 2/3 dos associados aptos" not in edital

    # restaura o valor real do estatuto - `RegraEstatutaria` é estado global de sessão de teste
    # (ver conftest.py: sem rollback por transação), outros testes (ex.: test_seed_traz_valores_
    # reais_do_estatuto) dependem de QUORUM_1A_CONVOCACAO continuar "2/3".
    r_restaura = client.put("/api/estatuto/regras/QUORUM_1A_CONVOCACAO", headers=auth_headers, json={"valor": "2/3"})
    assert r_restaura.status_code == 200, r_restaura.text
