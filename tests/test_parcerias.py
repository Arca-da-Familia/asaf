"""v5.4a - módulo Parcerias e emendas: o dinheiro vem do livro-caixa, o site só enxerga o que foi aprovado.

As promessas que estes testes travam (a página de Transparência depende de TODAS):
  1. cada parceria nasce com um centro de custo EXCLUSIVO; recebido e pago são lidos do razão contábil, nunca digitados;
  2. soma das parcelas <= valor; recebido <= valor; pago <= recebido. Violação = erro com o nome do registro, e o que o
     razão decide trava a aprovação da publicação;
  3. lançamento do razão sem classificação trava a publicação; depois de publicada, o site só diz quantos faltam;
  4. nenhum texto público tem dado pessoal; pagamento de equipe sai só com FUNÇÃO e valor, nunca nome;
  5. quem criou ou enviou para revisão não aprova; só a parceria APROVADA aparece na API pública, com campos fixos;
  6. nada se apaga em silêncio: tudo cai na trilha de auditoria; relatório apresentado não se apaga."""
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.models.core import AuditLog, NivelAcesso, PermissaoSistema, Usuario, perfil_permissao
from app.models.financeiro import CentroDeCusto, Exercicio, Fornecedor, PlanoDeContas, TituloFinanceiro
from app.security import criar_access_token, hash_senha
from app.services import contabilidade
from tests.test_documentos_verificacao import CPF_VALIDO


# ------------------------------------------------------------------------------------------ apoio
def _usuario(db, *codigos: str):
    """Um usuário cujo nível tem EXATAMENTE as permissões pedidas (nenhuma a mais)."""
    nivel = NivelAcesso(nome_nivel=f"nivel_parc_{uuid.uuid4().hex[:8]}", descricao="teste", exige_mfa=False)
    db.add(nivel)
    db.flush()
    for codigo in codigos:
        permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).first()
        assert permissao is not None, f"permissão {codigo!r} não existe no seed"
        db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    usuario = Usuario(email=f"parc_{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.commit()
    db.refresh(usuario)
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


@pytest.fixture(autouse=True)
def _admin_primeiro(admin_token):
    """O primeiro usuário do banco é o admin (bootstrap-admin só funciona uma vez): ele tem que nascer ANTES dos
    usuários de teste deste arquivo, em qualquer ordem de execução."""


@pytest.fixture()
def gestor(db):  # a tesouraria/secretaria que cadastra e envia, não aprova
    return _usuario(db, "parcerias")


@pytest.fixture()
def aprovador(db):  # Presidente ou Secretário: só aprova
    return _usuario(db, "aprovar_publicacao")


class Razao:
    """O livro-caixa de teste: contas (caixa, receita, despesa) e os dois movimentos de uma parceria."""

    def __init__(self, db, exercicio):
        self.db, self.exercicio = db, exercicio
        sufixo = uuid.uuid4().hex[:6]
        self.caixa = PlanoDeContas(codigo_contabil=f"P1-{sufixo}", descricao_conta=f"Caixa parceria {sufixo}", tipo="Ativo")
        self.receita = PlanoDeContas(codigo_contabil=f"P2-{sufixo}", descricao_conta=f"Repasse de emenda {sufixo}", tipo="Receita")
        self.despesa = PlanoDeContas(codigo_contabil=f"P3-{sufixo}", descricao_conta=f"Despesa de parceria {sufixo}", tipo="Despesa")
        db.add_all([self.caixa, self.receita, self.despesa])
        db.commit()

    def receber(self, id_centro_custo, valor, historico="Repasse da emenda"):
        valor = Decimal(str(valor))
        lancamento = contabilidade.criar_lancamento(
            self.db, exercicio=self.exercicio, historico=historico, tipo_origem="TESTE",
            partidas=[(self.caixa.id_conta, contabilidade.DEBITO, valor, id_centro_custo),
                      (self.receita.id_conta, contabilidade.CREDITO, valor, id_centro_custo)],
        )
        self.db.commit()
        return lancamento.id_lancamento

    def pagar(self, id_centro_custo, valor, historico="Pagamento", id_titulo=None):
        valor = Decimal(str(valor))
        lancamento = contabilidade.criar_lancamento(
            self.db, exercicio=self.exercicio, historico=historico, tipo_origem="TESTE", id_titulo=id_titulo,
            partidas=[(self.despesa.id_conta, contabilidade.DEBITO, valor, id_centro_custo),
                      (self.caixa.id_conta, contabilidade.CREDITO, valor, id_centro_custo)],
        )
        self.db.commit()
        return lancamento.id_lancamento

    def estornar(self, id_lancamento):
        from app.models.financeiro import LancamentoContabil
        original = self.db.query(LancamentoContabil).filter(LancamentoContabil.id_lancamento == id_lancamento).first()
        contabilidade.estornar_lancamento(self.db, original=original, motivo="lançado errado")
        self.db.commit()

    def titulo_de_fornecedor(self, razao_social="Gráfica Boa Impressão LTDA", cnpj=None):
        fornecedor = Fornecedor(razao_social=razao_social, cnpj=cnpj or str(uuid.uuid4().int)[:14], categoria_servico="Gráfica")
        self.db.add(fornecedor)
        self.db.flush()
        titulo = TituloFinanceiro(
            tipo_titulo="A Pagar", id_conta_contabil=self.despesa.id_conta, id_fornecedor=fornecedor.id_fornecedor,
            descricao="Impressão", valor_original=Decimal("100"), saldo_devedor=Decimal("0"),
            data_vencimento=datetime.utcnow() + timedelta(days=5), status="Pago",
        )
        self.db.add(titulo)
        self.db.commit()
        return titulo.id_titulo


@pytest.fixture()
def razao(db, exercicio_financeiro_aberto):
    exercicio = db.query(Exercicio).filter(Exercicio.status == "Aberto").first()
    assert exercicio is not None
    return Razao(db, exercicio)


def _dados(**sobrescrever):
    dados = {
        "tipo": "EMENDA", "ano": 2026, "titulo": f"Emenda de teste {uuid.uuid4().hex[:6]}",
        "objeto": "Oficinas de música e reforço escolar para crianças do bairro.",
        "esfera": "Municipal", "orgao_concedente": "Secretaria Municipal de Assistência Social",
        "numero_emenda": "123/2026", "proponente": "Vereador Exemplo", "valor_total": "50000.00",
    }
    dados.update(sobrescrever)
    return {k: v for k, v in dados.items() if v is not None}


def _criar(client, headers, **sobrescrever):
    r = client.post("/api/parcerias", json=_dados(**sobrescrever), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _lancamento(client, headers, id_parceria, **campos):
    return client.post(f"/api/parcerias/{id_parceria}/lancamentos", json=campos, headers=headers)


def _classificar_tudo(client, headers, parceria):
    """Classifica todos os lançamentos pendentes (recebimento: sem parcela; pagamento: categoria Outro)."""
    detalhe = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=headers).json()
    for p in detalhe["lancamentos_sem_classificacao"]:
        corpo = {"id_lancamento": p["id_lancamento"], "natureza": p["natureza"], "descricao_publica": "Movimento do projeto"}
        if p["natureza"] == "PAGAMENTO":
            corpo["categoria"] = "OUTRO"
        r = _lancamento(client, headers, parceria["id_parceria"], **corpo)
        assert r.status_code == 201, r.text


def _publicada(client, gestor, aprovador, razao=None, **sobrescrever):
    parceria = _criar(client, gestor, **sobrescrever)
    assert client.post(f"/api/parcerias/{parceria['id_parceria']}/enviar-revisao", headers=gestor).status_code == 200
    r = client.post(f"/api/parcerias/{parceria['id_parceria']}/aprovar", headers=aprovador)
    assert r.status_code == 200, r.text
    return parceria


# ----------------------------------------------------------------------------- login e permissão
def test_todas_as_rotas_exigem_login(client):
    for metodo, caminho in [("get", "/api/parcerias"), ("get", "/api/parcerias/1"), ("post", "/api/parcerias"),
                            ("get", "/api/parcerias/opcoes"), ("post", "/api/parcerias/1/aprovar"),
                            ("post", "/api/parcerias/1/parcelas"), ("post", "/api/parcerias/1/lancamentos"),
                            ("get", "/api/parcerias/1/historico")]:
        assert getattr(client, metodo)(caminho).status_code == 401, f"{metodo} {caminho}"


def test_quem_nao_tem_permissao_de_parceria_nao_ve_nem_a_lista(client, db):
    sem = _usuario(db)
    assert client.get("/api/parcerias", headers=sem).status_code == 403
    assert client.post("/api/parcerias", json=_dados(), headers=sem).status_code == 403


def test_cada_perfil_so_faz_o_que_e_dele(client, db, gestor, aprovador):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    # a gestão cadastra e lista, mas NÃO aprova
    assert client.get("/api/parcerias", headers=gestor).status_code == 200
    assert client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=gestor).status_code == 403
    # a aprovação lista, mas não cadastra nem edita
    assert client.get("/api/parcerias", headers=aprovador).status_code == 200
    assert client.post("/api/parcerias", json=_dados(), headers=aprovador).status_code == 403
    assert client.patch(f"/api/parcerias/{id_parceria}", json={"ano": 2027}, headers=aprovador).status_code == 403
    assert client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "100"}, headers=aprovador).status_code == 403


def test_o_detalhe_diz_o_que_cada_usuario_pode_fazer(client, gestor, aprovador):
    parceria = _criar(client, gestor)
    como_gestor = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=gestor).json()
    como_aprovador = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=aprovador).json()
    assert como_gestor["pode_editar"] is True and como_gestor["pode_enviar_revisao"] is True and como_gestor["pode_aprovar"] is False
    assert como_aprovador["pode_editar"] is False and como_aprovador["pode_enviar_revisao"] is False


# ----------------------------------------------------------------------------- cadastro
def test_criar_gera_centro_de_custo_exclusivo_e_nasce_rascunho(client, db, gestor):
    a = _criar(client, gestor)
    b = _criar(client, gestor)
    assert a["situacao"] == "Proposta" and a["situacao_publicacao"] == "Rascunho"
    assert a["id_centro_custo"] and b["id_centro_custo"] and a["id_centro_custo"] != b["id_centro_custo"]
    assert a["codigo_centro_custo"] == f"PARC-{a['id_parceria']:04d}"
    centro = db.query(CentroDeCusto).filter(CentroDeCusto.id_centro_custo == a["id_centro_custo"]).first()
    assert centro is not None and centro.codigo == a["codigo_centro_custo"]
    assert Decimal(str(a["recebido"])) == 0 and Decimal(str(a["pago"])) == 0


@pytest.mark.parametrize("campo,valor,trecho", [
    ("tipo", "INVENTADO", "Tipo inválido"),
    ("ano", 1990, "Ano inválido"),
    ("titulo", "ab", "Título"),
    ("objeto", "curto", "Objeto"),
    ("esfera", "Intergaláctica", "Esfera inválida"),
    ("valor_total", "0", "maior que zero"),
    ("valor_total", "-5", "maior que zero"),
    ("situacao", "Sonhada", "Situação inválida"),
])
def test_cadastro_recusa_dado_invalido(client, gestor, campo, valor, trecho):
    r = client.post("/api/parcerias", json=_dados(**{campo: valor}), headers=gestor)
    assert r.status_code in (400, 422), r.text
    assert trecho in r.text


def test_valor_que_nao_e_numero_e_recusado(client, gestor):
    assert client.post("/api/parcerias", json=_dados(valor_total="abc"), headers=gestor).status_code == 422


def test_cadastro_exige_os_campos_essenciais(client, gestor):
    r = client.post("/api/parcerias", json={"tipo": "EMENDA"}, headers=gestor)
    assert r.status_code == 400 and "ano" in r.text and "valor_total" in r.text


def test_vigencia_nao_pode_terminar_antes_de_comecar(client, gestor):
    r = client.post("/api/parcerias", json=_dados(vigencia_inicio="2026-06-01", vigencia_fim="2026-05-01"), headers=gestor)
    assert r.status_code == 400 and "vigência" in r.text.lower()


def test_identificador_unico_nao_repete(client, gestor):
    identificador = f"EM-{uuid.uuid4().hex[:8]}"
    primeira = _criar(client, gestor, identificador_unico=identificador)
    r = client.post("/api/parcerias", json=_dados(identificador_unico=identificador), headers=gestor)
    assert r.status_code == 409 and str(primeira["id_parceria"]) in r.text


def test_texto_que_vai_ao_site_nao_pode_ter_dado_pessoal(client, gestor):
    r = client.post("/api/parcerias", json=_dados(objeto=f"Oficinas coordenadas por Fulano, CPF {CPF_VALIDO}, para crianças."), headers=gestor)
    assert r.status_code == 422 and "objeto" in r.text.lower() and "dado pessoal" in r.text.lower()
    assert CPF_VALIDO not in r.text, "o erro não pode devolver o CPF inteiro"
    r = client.post("/api/parcerias", json=_dados(proponente="fulano@gmail.com"), headers=gestor)
    assert r.status_code == 422


def test_termo_assinado_exige_numero_do_termo(client, gestor):
    r = client.post("/api/parcerias", json=_dados(situacao="Termo assinado"), headers=gestor)
    assert r.status_code == 400 and "termo" in r.text.lower()
    parceria = _criar(client, gestor)
    r = client.patch(f"/api/parcerias/{parceria['id_parceria']}", json={"situacao": "Em execução"}, headers=gestor)
    assert r.status_code == 409 and "número do termo" in r.text
    r = client.patch(f"/api/parcerias/{parceria['id_parceria']}", json={"situacao": "Em execução", "numero_termo": "TF 009/2026"}, headers=gestor)
    assert r.status_code == 200 and r.json()["situacao"] == "Em execução"


def test_editar_nao_deixa_o_valor_ficar_abaixo_das_parcelas_nem_do_recebido(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="1000")
    id_parceria = parceria["id_parceria"]
    client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "600"}, headers=gestor)
    r = client.patch(f"/api/parcerias/{id_parceria}", json={"valor_total": "500"}, headers=gestor)
    assert r.status_code == 409 and "parcelas" in r.text
    razao.receber(parceria["id_centro_custo"], "700")
    r = client.patch(f"/api/parcerias/{id_parceria}", json={"valor_total": "650"}, headers=gestor)
    assert r.status_code == 409 and "recebido" in r.text


def test_listagem_filtra_por_ano_tipo_e_busca(client, gestor):
    marca = uuid.uuid4().hex[:8]
    _criar(client, gestor, ano=2031, titulo=f"Emenda {marca} A", tipo="EMENDA")
    _criar(client, gestor, ano=2032, titulo=f"Termo {marca} B", tipo="TERMO_FOMENTO")
    por_busca = client.get(f"/api/parcerias?busca={marca}", headers=gestor).json()
    assert {p["ano"] for p in por_busca} == {2031, 2032}
    assert [p["ano"] for p in client.get(f"/api/parcerias?busca={marca}&ano=2032", headers=gestor).json()] == [2032]
    assert [p["tipo"] for p in client.get(f"/api/parcerias?busca={marca}&tipo=EMENDA", headers=gestor).json()] == ["EMENDA"]


def test_opcoes_para_os_formularios(client, gestor):
    o = client.get("/api/parcerias/opcoes", headers=gestor).json()
    assert {t["codigo"] for t in o["tipos"]} >= {"EMENDA", "TERMO_FOMENTO"}
    assert "Regulares com ressalvas" in o["resultados"] and "Irregulares" in o["resultados"]
    assert {c["codigo"] for c in o["categorias_de_pagamento"]} == {"FORNECEDOR", "EQUIPE", "TARIFA", "OUTRO"}


# ----------------------------------------------------------------------------- parcelas
def test_parcelas_numeram_sozinhas_e_a_soma_nao_passa_do_valor(client, gestor):
    parceria = _criar(client, gestor, valor_total="1000", titulo="Emenda das parcelas")
    id_parceria = parceria["id_parceria"]
    r = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "400", "data_prevista": "2026-08-10"}, headers=gestor)
    assert r.status_code == 201
    r = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "400"}, headers=gestor)
    assert [p["numero"] for p in r.json()["parcelas"]] == [1, 2]
    r = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "300"}, headers=gestor)
    assert r.status_code == 409
    assert "soma das parcelas" in r.text and "1000" in r.text
    r = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "200"}, headers=gestor)
    assert r.status_code == 201 and Decimal(str(r.json()["total_das_parcelas"])) == Decimal("1000")


def test_parcela_duplicada_e_valor_invalido(client, gestor):
    parceria = _criar(client, gestor, valor_total="1000")
    id_parceria = parceria["id_parceria"]
    client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"numero": 1, "valor_previsto": "100"}, headers=gestor)
    assert client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"numero": 1, "valor_previsto": "100"}, headers=gestor).status_code == 409
    assert client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "0"}, headers=gestor).status_code == 400
    assert client.post(f"/api/parcerias/{id_parceria}/parcelas", json={}, headers=gestor).status_code == 400


def test_editar_e_apagar_parcela(client, gestor):
    parceria = _criar(client, gestor, valor_total="1000")
    id_parceria = parceria["id_parceria"]
    parcelas = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "400"}, headers=gestor).json()["parcelas"]
    id_parcela = parcelas[0]["id_parcela"]
    r = client.patch(f"/api/parcerias/{id_parceria}/parcelas/{id_parcela}", json={"valor_previsto": "1200"}, headers=gestor)
    assert r.status_code == 409
    r = client.patch(f"/api/parcerias/{id_parceria}/parcelas/{id_parcela}", json={"valor_previsto": "900", "data_prevista": "2026-09-01"}, headers=gestor)
    assert r.status_code == 200 and Decimal(str(r.json()["parcelas"][0]["valor_previsto"])) == 900
    r = client.delete(f"/api/parcerias/{id_parceria}/parcelas/{id_parcela}", headers=gestor)
    assert r.status_code == 200 and r.json()["parcelas"] == []


def test_parcela_de_outra_parceria_nao_e_alcancada(client, gestor):
    a = _criar(client, gestor)
    b = _criar(client, gestor)
    id_parcela = client.post(f"/api/parcerias/{a['id_parceria']}/parcelas", json={"valor_previsto": "100"}, headers=gestor).json()["parcelas"][0]["id_parcela"]
    assert client.patch(f"/api/parcerias/{b['id_parceria']}/parcelas/{id_parcela}", json={"valor_previsto": "50"}, headers=gestor).status_code == 404
    assert client.delete(f"/api/parcerias/{b['id_parceria']}/parcelas/{id_parcela}", headers=gestor).status_code == 404


def test_parcela_com_recebimento_ligado_nao_se_apaga(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="1000")
    id_parceria = parceria["id_parceria"]
    id_parcela = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "400"}, headers=gestor).json()["parcelas"][0]["id_parcela"]
    id_lancamento = razao.receber(parceria["id_centro_custo"], "400")
    assert _lancamento(client, gestor, id_parceria, id_lancamento=id_lancamento, natureza="RECEBIMENTO", descricao_publica="1ª parcela", id_parcela=id_parcela).status_code == 201
    r = client.delete(f"/api/parcerias/{id_parceria}/parcelas/{id_parcela}", headers=gestor)
    assert r.status_code == 409 and "recebimento" in r.text


# ----------------------------------------------------------------------------- etapas
def test_etapas_criar_editar_apagar(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    r = client.post(f"/api/parcerias/{id_parceria}/etapas", json={"titulo": "Oficina de percussão", "local": "Quadra da escola", "data_prevista": "2026-09-20"}, headers=gestor)
    assert r.status_code == 201
    etapa = r.json()["etapas"][0]
    assert etapa["situacao"] == "Prevista"
    r = client.patch(f"/api/parcerias/{id_parceria}/etapas/{etapa['id_etapa']}", json={"situacao": "Realizada", "data_realizacao": "2026-09-20", "publico_atendido": 35}, headers=gestor)
    assert r.status_code == 200 and r.json()["etapas"][0]["publico_atendido"] == 35
    r = client.delete(f"/api/parcerias/{id_parceria}/etapas/{etapa['id_etapa']}", headers=gestor)
    assert r.status_code == 200 and r.json()["etapas"] == []


def test_etapa_realizada_exige_data_e_nao_aceita_numero_negativo(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    id_etapa = client.post(f"/api/parcerias/{id_parceria}/etapas", json={"titulo": "Entrega de material"}, headers=gestor).json()["etapas"][0]["id_etapa"]
    assert client.patch(f"/api/parcerias/{id_parceria}/etapas/{id_etapa}", json={"situacao": "Realizada"}, headers=gestor).status_code == 409
    assert client.patch(f"/api/parcerias/{id_parceria}/etapas/{id_etapa}", json={"publico_atendido": -3}, headers=gestor).status_code == 400
    assert client.patch(f"/api/parcerias/{id_parceria}/etapas/{id_etapa}", json={"situacao": "Inventada"}, headers=gestor).status_code == 400


def test_texto_de_etapa_nao_pode_ter_contato_pessoal(client, gestor):
    parceria = _criar(client, gestor)
    r = client.post(f"/api/parcerias/{parceria['id_parceria']}/etapas", json={"titulo": "Oficina", "descricao": "Inscrições com a Maria: (94) 99999-1234"}, headers=gestor)
    assert r.status_code == 422 and "dado pessoal" in r.text.lower()


# ----------------------------------------------------------------------------- relatórios
def test_relatorio_prazo_de_analise_de_150_dias(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    r = client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "PARCIAL", "data_prevista": "2026-10-30", "data_apresentacao": "2026-11-03"}, headers=gestor)
    assert r.status_code == 201
    relatorio = r.json()["relatorios"][0]
    assert relatorio["prazo_analise_dias"] == 150 and relatorio["resultado"] == "Em análise"
    assert relatorio["data_limite_analise"] == "2027-04-02"  # 2026-11-03 + 150 dias


def test_relatorio_so_tem_resultado_depois_de_apresentado(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    r = client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL", "resultado": "Regulares"}, headers=gestor)
    assert r.status_code == 409 and "apresentado" in r.text
    id_relatorio = client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL", "data_apresentacao": "2026-12-01"}, headers=gestor).json()["relatorios"][0]["id_relatorio"]
    r = client.patch(f"/api/parcerias/{id_parceria}/relatorios/{id_relatorio}", json={"resultado": "Regulares com ressalvas"}, headers=gestor)
    assert r.status_code == 409 and "data do resultado" in r.text
    r = client.patch(f"/api/parcerias/{id_parceria}/relatorios/{id_relatorio}", json={"resultado": "Regulares com ressalvas", "data_resultado": "2026-11-01"}, headers=gestor)
    assert r.status_code == 400 and "anterior" in r.text
    r = client.patch(f"/api/parcerias/{id_parceria}/relatorios/{id_relatorio}", json={"resultado": "Regulares com ressalvas", "data_resultado": "2027-02-01"}, headers=gestor)
    assert r.status_code == 200 and r.json()["relatorios"][0]["resultado"] == "Regulares com ressalvas"


def test_relatorio_recusa_tipo_resultado_e_prazo_invalidos(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    assert client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "OUTRO"}, headers=gestor).status_code == 400
    assert client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL", "resultado": "Aprovadíssimo"}, headers=gestor).status_code == 400
    assert client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL", "prazo_analise_dias": 0}, headers=gestor).status_code == 400
    assert client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL", "periodo_inicio": "2026-05-01", "periodo_fim": "2026-04-01"}, headers=gestor).status_code == 400


def test_relatorio_apresentado_nao_se_apaga_mas_o_rascunho_sim(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    relatorios = client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "MONITORAMENTO"}, headers=gestor).json()["relatorios"]
    client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "PARCIAL", "data_apresentacao": "2026-10-01"}, headers=gestor)
    todos = client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()["relatorios"]
    apresentado = next(r for r in todos if r["tipo"] == "PARCIAL")
    r = client.delete(f"/api/parcerias/{id_parceria}/relatorios/{apresentado['id_relatorio']}", headers=gestor)
    assert r.status_code == 409 and "não se apaga" in r.text
    r = client.delete(f"/api/parcerias/{id_parceria}/relatorios/{relatorios[0]['id_relatorio']}", headers=gestor)
    assert r.status_code == 200 and len(r.json()["relatorios"]) == 1


def test_concluida_so_com_prestacao_de_contas_final_apresentada(client, gestor):
    parceria = _criar(client, gestor, numero_termo="TF 001/2026")
    id_parceria = parceria["id_parceria"]
    r = client.patch(f"/api/parcerias/{id_parceria}", json={"situacao": "Concluída"}, headers=gestor)
    assert r.status_code == 409 and "prestação de contas FINAL" in r.text
    client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL"}, headers=gestor)  # ainda não apresentado
    assert client.patch(f"/api/parcerias/{id_parceria}", json={"situacao": "Concluída"}, headers=gestor).status_code == 409
    id_relatorio = client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()["relatorios"][0]["id_relatorio"]
    client.patch(f"/api/parcerias/{id_parceria}/relatorios/{id_relatorio}", json={"data_apresentacao": "2026-12-15"}, headers=gestor)
    r = client.patch(f"/api/parcerias/{id_parceria}", json={"situacao": "Concluída"}, headers=gestor)
    assert r.status_code == 200 and r.json()["situacao"] == "Concluída"


def test_alertas_de_relatorio_atrasado_e_analise_vencida(client, gestor):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    ontem = (date.today() - timedelta(days=2)).isoformat()  # 2 dias: não depende do fuso do servidor
    antigo = (date.today() - timedelta(days=400)).isoformat()
    client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "PARCIAL", "data_prevista": ontem}, headers=gestor)
    client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "FINAL", "data_apresentacao": antigo}, headers=gestor)
    codigos = {a["codigo"] for a in client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()["consistencia"]["avisos"]}
    assert {"RELATORIO_ATRASADO", "ANALISE_ATRASADA"} <= codigos


# ----------------------------------------------------------------------------- dinheiro vem do livro-caixa
def test_recebido_e_pago_sao_lidos_do_razao_pelo_centro_de_custo(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    outra = _criar(client, gestor, valor_total="10000")
    razao.receber(parceria["id_centro_custo"], "4000")
    razao.pagar(parceria["id_centro_custo"], "1500")
    razao.receber(outra["id_centro_custo"], "9999")  # outro centro de custo: não pode misturar
    d = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=gestor).json()
    assert Decimal(str(d["recebido"])) == 4000 and Decimal(str(d["pago"])) == 1500 and Decimal(str(d["saldo"])) == 2500
    lista = {p["id_parceria"]: p for p in client.get("/api/parcerias", headers=gestor).json()}
    assert Decimal(str(lista[outra["id_parceria"]]["recebido"])) == 9999


def test_estorno_tira_o_valor_do_total_e_do_site(client, gestor, aprovador, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_parceria = parceria["id_parceria"]
    id_lancamento = razao.receber(parceria["id_centro_custo"], "3000")
    _classificar_tudo(client, gestor, parceria)
    assert len(client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()["lancamentos"]) == 1
    razao.estornar(id_lancamento)
    d = client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()
    assert Decimal(str(d["recebido"])) == 0
    assert d["lancamentos"][0]["estornado"] is True
    assert d["lancamentos_sem_classificacao"] == [], "estorno e estornado não contam como pendência"


def test_lancamentos_do_centro_aparecem_como_sem_classificacao(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_recebimento = razao.receber(parceria["id_centro_custo"], "2000", "Repasse 1ª parcela")
    id_pagamento = razao.pagar(parceria["id_centro_custo"], "300", "Compra de instrumentos")
    pendentes = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=gestor).json()["lancamentos_sem_classificacao"]
    por_id = {p["id_lancamento"]: p for p in pendentes}
    assert por_id[id_recebimento]["natureza"] == "RECEBIMENTO" and Decimal(str(por_id[id_recebimento]["valor"])) == 2000
    assert por_id[id_pagamento]["natureza"] == "PAGAMENTO" and por_id[id_pagamento]["historico"] == "Compra de instrumentos"


def test_classificar_recebimento_na_parcela(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_parceria = parceria["id_parceria"]
    id_parcela = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "5000"}, headers=gestor).json()["parcelas"][0]["id_parcela"]
    id_lancamento = razao.receber(parceria["id_centro_custo"], "5000")
    r = _lancamento(client, gestor, id_parceria, id_lancamento=id_lancamento, natureza="RECEBIMENTO", descricao_publica="Repasse da 1ª parcela", id_parcela=id_parcela)
    assert r.status_code == 201
    d = r.json()
    assert d["lancamentos_sem_classificacao"] == []
    assert Decimal(str(d["parcelas"][0]["valor_recebido"])) == 5000
    assert d["lancamentos"][0]["parcela_numero"] == 1 and Decimal(str(d["lancamentos"][0]["valor"])) == 5000


def test_vinculo_so_aceita_lancamento_do_centro_de_custo_da_parceria(client, gestor, razao):
    a = _criar(client, gestor)
    b = _criar(client, gestor)
    id_lancamento = razao.receber(b["id_centro_custo"], "100")
    r = _lancamento(client, gestor, a["id_parceria"], id_lancamento=id_lancamento, natureza="RECEBIMENTO", descricao_publica="Repasse")
    assert r.status_code == 409 and "centro de custo" in r.text
    r = _lancamento(client, gestor, a["id_parceria"], id_lancamento=99999999, natureza="RECEBIMENTO", descricao_publica="Repasse")
    assert r.status_code == 409


def test_lancamento_pertence_a_uma_parceria_so(client, gestor, razao):
    parceria = _criar(client, gestor)
    id_lancamento = razao.receber(parceria["id_centro_custo"], "100")
    assert _lancamento(client, gestor, parceria["id_parceria"], id_lancamento=id_lancamento, natureza="RECEBIMENTO", descricao_publica="Repasse").status_code == 201
    r = _lancamento(client, gestor, parceria["id_parceria"], id_lancamento=id_lancamento, natureza="RECEBIMENTO", descricao_publica="Repasse")
    assert r.status_code == 409 and "já está ligado" in r.text


def test_natureza_tem_que_bater_com_o_que_o_razao_diz(client, gestor, razao):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    recebimento = razao.receber(parceria["id_centro_custo"], "100")
    pagamento = razao.pagar(parceria["id_centro_custo"], "10")
    r = _lancamento(client, gestor, id_parceria, id_lancamento=recebimento, natureza="PAGAMENTO", categoria="OUTRO", descricao_publica="Pagamento")
    assert r.status_code == 409 and "não é um pagamento" in r.text
    r = _lancamento(client, gestor, id_parceria, id_lancamento=pagamento, natureza="RECEBIMENTO", descricao_publica="Repasse")
    assert r.status_code == 409 and "não é um recebimento" in r.text
    assert _lancamento(client, gestor, id_parceria, id_lancamento=pagamento, natureza="INVENTADA", descricao_publica="Repasse").status_code == 400


def test_estornado_nao_pode_ser_classificado(client, gestor, razao):
    parceria = _criar(client, gestor)
    id_lancamento = razao.receber(parceria["id_centro_custo"], "100")
    razao.estornar(id_lancamento)
    r = _lancamento(client, gestor, parceria["id_parceria"], id_lancamento=id_lancamento, natureza="RECEBIMENTO", descricao_publica="Repasse")
    assert r.status_code == 409 and "estornado" in r.text


def test_pagamento_exige_categoria_e_equipe_exige_funcao(client, gestor, razao):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    pagamento = razao.pagar(parceria["id_centro_custo"], "800")
    assert _lancamento(client, gestor, id_parceria, id_lancamento=pagamento, natureza="PAGAMENTO", descricao_publica="Pagamento de oficineiro").status_code == 400
    r = _lancamento(client, gestor, id_parceria, id_lancamento=pagamento, natureza="PAGAMENTO", categoria="EQUIPE", descricao_publica="Pagamento de oficineiro")
    assert r.status_code == 400 and "função" in r.text
    r = _lancamento(client, gestor, id_parceria, id_lancamento=pagamento, natureza="PAGAMENTO", categoria="EQUIPE", descricao_publica="Pagamento mensal", funcao="Oficineiro de percussão")
    assert r.status_code == 201


def test_pagamento_a_fornecedor_exige_fornecedor_cadastrado(client, gestor, razao):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    sem_fornecedor = razao.pagar(parceria["id_centro_custo"], "200")
    r = _lancamento(client, gestor, id_parceria, id_lancamento=sem_fornecedor, natureza="PAGAMENTO", categoria="FORNECEDOR", descricao_publica="Impressão de cartazes")
    assert r.status_code == 409 and "fornecedor" in r.text.lower()
    com_fornecedor = razao.pagar(parceria["id_centro_custo"], "250", id_titulo=razao.titulo_de_fornecedor())
    r = _lancamento(client, gestor, id_parceria, id_lancamento=com_fornecedor, natureza="PAGAMENTO", categoria="FORNECEDOR", descricao_publica="Impressão de cartazes")
    assert r.status_code == 201
    ligado = next(v for v in r.json()["lancamentos"] if v["id_lancamento"] == com_fornecedor)
    assert ligado["fornecedor"]["razao_social"] == "Gráfica Boa Impressão LTDA"


def test_descricao_publica_nao_pode_ter_dado_pessoal(client, gestor, razao):
    parceria = _criar(client, gestor)
    pagamento = razao.pagar(parceria["id_centro_custo"], "100")
    r = _lancamento(client, gestor, parceria["id_parceria"], id_lancamento=pagamento, natureza="PAGAMENTO", categoria="EQUIPE",
                    descricao_publica=f"Pagamento a Fulano CPF {CPF_VALIDO}", funcao="Monitor")
    assert r.status_code == 422 and CPF_VALIDO not in r.text
    r = _lancamento(client, gestor, parceria["id_parceria"], id_lancamento=pagamento, natureza="PAGAMENTO", categoria="EQUIPE",
                    descricao_publica="Pagamento mensal", funcao="Monitor - fulano@gmail.com")
    assert r.status_code == 422


def test_corrigir_texto_e_desfazer_classificacao(client, gestor, razao):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    recebimento = razao.receber(parceria["id_centro_custo"], "100")
    d = _lancamento(client, gestor, id_parceria, id_lancamento=recebimento, natureza="RECEBIMENTO", descricao_publica="Repasse").json()
    id_vinculo = d["lancamentos"][0]["id_vinculo"]
    r = client.patch(f"/api/parcerias/{id_parceria}/lancamentos/{id_vinculo}", json={"descricao_publica": "Repasse da primeira parcela"}, headers=gestor)
    assert r.status_code == 200 and r.json()["lancamentos"][0]["descricao_publica"] == "Repasse da primeira parcela"
    r = client.delete(f"/api/parcerias/{id_parceria}/lancamentos/{id_vinculo}", headers=gestor)
    assert r.status_code == 200 and r.json()["lancamentos"] == []
    assert [p["id_lancamento"] for p in r.json()["lancamentos_sem_classificacao"]] == [recebimento]


# ----------------------------------------------------------------------------- consistência
def test_pago_acima_do_recebido_trava_a_publicacao(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    razao.receber(parceria["id_centro_custo"], "1000")
    razao.pagar(parceria["id_centro_custo"], "1500")
    _classificar_tudo(client, gestor, parceria)
    detalhe = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=gestor).json()
    codigos = {b["codigo"] for b in detalhe["consistencia"]["bloqueios"]}
    assert codigos == {"PAGO_ACIMA_DO_RECEBIDO"}
    assert f"nº {parceria['id_parceria']}" in detalhe["consistencia"]["bloqueios"][0]["mensagem"], "o erro diz de qual parceria é"
    r = client.post(f"/api/parcerias/{parceria['id_parceria']}/enviar-revisao", headers=gestor)
    assert r.status_code == 409 and "PAGO_ACIMA_DO_RECEBIDO" in r.text


def test_recebido_acima_do_valor_trava_a_publicacao(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="1000")
    razao.receber(parceria["id_centro_custo"], "1500")
    _classificar_tudo(client, gestor, parceria)
    codigos = {b["codigo"] for b in client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=gestor).json()["consistencia"]["bloqueios"]}
    assert "RECEBIDO_ACIMA_DO_VALOR" in codigos


def test_lancamento_sem_classificacao_trava_a_publicacao(client, gestor, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_lancamento = razao.receber(parceria["id_centro_custo"], "1000")
    r = client.post(f"/api/parcerias/{parceria['id_parceria']}/enviar-revisao", headers=gestor)
    assert r.status_code == 409 and "LANCAMENTOS_SEM_CLASSIFICACAO" in r.text and str(id_lancamento) in r.text
    _classificar_tudo(client, gestor, parceria)
    assert client.post(f"/api/parcerias/{parceria['id_parceria']}/enviar-revisao", headers=gestor).status_code == 200


def test_parcelas_abaixo_do_valor_e_so_aviso(client, gestor):
    parceria = _criar(client, gestor, valor_total="1000")
    client.post(f"/api/parcerias/{parceria['id_parceria']}/parcelas", json={"valor_previsto": "400"}, headers=gestor)
    c = client.get(f"/api/parcerias/{parceria['id_parceria']}", headers=gestor).json()["consistencia"]
    assert [a["codigo"] for a in c["avisos"]] == ["PARCELAS_ABAIXO_DO_VALOR"] and c["bloqueios"] == []


# ----------------------------------------------------------------------------- publicação
def test_quem_criou_ou_enviou_nao_aprova(client, db, gestor):
    os_dois = _usuario(db, "parcerias", "aprovar_publicacao")
    parceria = _criar(client, os_dois)
    id_parceria = parceria["id_parceria"]
    assert client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=os_dois).status_code == 200
    r = client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=os_dois)
    assert r.status_code == 403 and "outra pessoa" in r.text
    detalhe = client.get(f"/api/parcerias/{id_parceria}", headers=os_dois).json()
    assert detalhe["pode_aprovar"] is False

    # criada por A, enviada por B: nenhum dos dois aprova
    a = _usuario(db, "parcerias", "aprovar_publicacao")
    b = _usuario(db, "parcerias", "aprovar_publicacao")
    outra = _criar(client, a)
    client.post(f"/api/parcerias/{outra['id_parceria']}/enviar-revisao", headers=b)
    assert client.post(f"/api/parcerias/{outra['id_parceria']}/aprovar", headers=a).status_code == 403
    assert client.post(f"/api/parcerias/{outra['id_parceria']}/aprovar", headers=b).status_code == 403
    terceiro = _usuario(db, "aprovar_publicacao")
    assert client.post(f"/api/parcerias/{outra['id_parceria']}/aprovar", headers=terceiro).status_code == 200


def test_fluxo_aprovar_e_aparecer_no_site(client, gestor, aprovador):
    parceria = _criar(client, gestor, titulo="Emenda do fluxo completo")
    id_parceria = parceria["id_parceria"]
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").status_code == 404, "rascunho não aparece"
    assert client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=aprovador).status_code == 409, "só aprova o que está em revisão"
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").status_code == 404, "em revisão não aparece"
    d = client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=aprovador).json()
    assert d["situacao_publicacao"] == "Aprovado" and d["aprovado_em"]
    publico = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}")
    assert publico.status_code == 200 and publico.json()["titulo"] == "Emenda do fluxo completo"
    assert id_parceria in [p["id_parceria"] for p in client.get("/api/publico/transparencia/parcerias").json()]


def test_recusar_exige_motivo_e_volta_a_rascunho(client, gestor, aprovador):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    assert client.post(f"/api/parcerias/{id_parceria}/recusar", json={"motivo": "curto"}, headers=aprovador).status_code == 400
    d = client.post(f"/api/parcerias/{id_parceria}/recusar", json={"motivo": "O objeto precisa citar o bairro atendido."}, headers=aprovador).json()
    assert d["situacao_publicacao"] == "Rascunho" and "bairro" in d["motivo_recusa"]
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").status_code == 404
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)  # corrige e reenvia
    assert client.get(f"/api/parcerias/{id_parceria}", headers=gestor).json()["motivo_recusa"] is None


def test_retirar_do_site_some_na_hora_e_preserva_o_historico(client, gestor, aprovador):
    parceria = _publicada(client, gestor, aprovador)
    id_parceria = parceria["id_parceria"]
    assert client.post(f"/api/parcerias/{id_parceria}/retirar", json={"motivo": "curto"}, headers=aprovador).status_code == 400
    assert client.post(f"/api/parcerias/{id_parceria}/retirar", json={"motivo": "Valor informado errado, vamos corrigir."}, headers=gestor).status_code == 403
    d = client.post(f"/api/parcerias/{id_parceria}/retirar", json={"motivo": "Valor informado errado, vamos corrigir."}, headers=aprovador).json()
    assert d["situacao_publicacao"] == "Retirado" and d["retirado_em"]
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").status_code == 404
    assert id_parceria not in [p["id_parceria"] for p in client.get("/api/publico/transparencia/parcerias").json()]
    # corrigir e publicar de novo
    assert client.post(f"/api/parcerias/{id_parceria}/reabrir", headers=gestor).json()["situacao_publicacao"] == "Rascunho"
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    assert client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=aprovador).status_code == 200
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").status_code == 200


def test_pendencia_nova_entre_o_envio_e_a_aprovacao_trava_a_aprovacao(client, gestor, aprovador, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_parceria = parceria["id_parceria"]
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    razao.receber(parceria["id_centro_custo"], "500")  # entrou dinheiro e ninguém classificou
    r = client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=aprovador)
    assert r.status_code == 409 and "LANCAMENTOS_SEM_CLASSIFICACAO" in r.text
    assert client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").status_code == 404


def test_nao_envia_para_revisao_duas_vezes_nem_aprova_rascunho(client, gestor, aprovador):
    parceria = _criar(client, gestor)
    id_parceria = parceria["id_parceria"]
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    assert client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor).status_code == 409
    assert client.post(f"/api/parcerias/{id_parceria}/retirar", json={"motivo": "Não está publicada ainda."}, headers=aprovador).status_code == 409
    assert client.post(f"/api/parcerias/{id_parceria}/reabrir", headers=gestor).status_code == 409


# ----------------------------------------------------------------------------- API pública
CAMPOS_PUBLICOS_DA_LISTA = {
    "id_parceria", "tipo_codigo", "tipo", "ano", "titulo", "objeto", "esfera", "orgao_concedente", "numero_emenda",
    "identificador_unico", "proponente", "numero_termo", "situacao", "valor_total", "recebido", "pago", "data_assinatura",
    "vigencia_inicio", "vigencia_fim", "lancamentos_em_classificacao", "ultima_atualizacao",
}


def test_api_publica_nao_exige_login_e_so_tem_os_campos_da_lista_fixa(client, gestor, aprovador):
    parceria = _publicada(client, gestor, aprovador)
    lista = client.get("/api/publico/transparencia/parcerias")
    assert lista.status_code == 200
    item = next(p for p in lista.json() if p["id_parceria"] == parceria["id_parceria"])
    assert set(item) == CAMPOS_PUBLICOS_DA_LISTA
    detalhe = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()
    assert set(detalhe) == CAMPOS_PUBLICOS_DA_LISTA | {"parcelas", "recebimentos", "pagamentos", "etapas", "relatorios", "documentos"}
    for proibido in ("id_centro_custo", "codigo_centro_custo", "id_usuario_criacao", "motivo_recusa", "motivo_retirada", "situacao_publicacao",
                     "pode_editar", "lancamentos", "consistencia", "criado_em"):
        assert proibido not in item and proibido not in detalhe, proibido


def test_api_publica_mostra_o_dinheiro_do_razao_e_as_partes_classificadas(client, gestor, aprovador, razao):
    parceria = _criar(client, gestor, valor_total="20000", titulo="Emenda com tudo")
    id_parceria = parceria["id_parceria"]
    id_parcela = client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "10000", "data_prevista": "2026-08-01"}, headers=gestor).json()["parcelas"][0]["id_parcela"]
    client.post(f"/api/parcerias/{id_parceria}/etapas", json={"titulo": "Oficina de música", "local": "Quadra da escola", "data_realizacao": "2026-09-01", "situacao": "Realizada", "publico_atendido": 40}, headers=gestor)
    client.post(f"/api/parcerias/{id_parceria}/relatorios", json={"tipo": "PARCIAL", "data_apresentacao": "2026-10-01"}, headers=gestor)
    recebimento = razao.receber(parceria["id_centro_custo"], "10000")
    equipe = razao.pagar(parceria["id_centro_custo"], "1200", "Pgto João da Silva oficineiro")
    fornecedor = razao.pagar(parceria["id_centro_custo"], "800", "Cartazes", id_titulo=razao.titulo_de_fornecedor("Gráfica Aurora ME", "12345678000199"))
    tarifa = razao.pagar(parceria["id_centro_custo"], "15", "Tarifa da conta")
    _lancamento(client, gestor, id_parceria, id_lancamento=recebimento, natureza="RECEBIMENTO", descricao_publica="Repasse da 1ª parcela", id_parcela=id_parcela)
    _lancamento(client, gestor, id_parceria, id_lancamento=equipe, natureza="PAGAMENTO", categoria="EQUIPE", descricao_publica="Pagamento mensal de oficineiro", funcao="Oficineiro de música")
    _lancamento(client, gestor, id_parceria, id_lancamento=fornecedor, natureza="PAGAMENTO", categoria="FORNECEDOR", descricao_publica="Impressão de cartazes")
    _lancamento(client, gestor, id_parceria, id_lancamento=tarifa, natureza="PAGAMENTO", categoria="TARIFA", descricao_publica="Tarifa bancária")
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    assert client.post(f"/api/parcerias/{id_parceria}/aprovar", headers=aprovador).status_code == 200

    d = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").json()
    assert d["valor_total"] == 20000 and d["recebido"] == 10000 and d["pago"] == 2015
    assert d["parcelas"] == [{"numero": 1, "valor_previsto": 10000.0, "data_prevista": "2026-08-01", "valor_recebido": 10000.0}]
    assert d["recebimentos"][0]["descricao"] == "Repasse da 1ª parcela" and d["recebimentos"][0]["parcela"] == 1
    por_categoria = {p["categoria"]: p for p in d["pagamentos"]}
    assert por_categoria["EQUIPE"]["funcao"] == "Oficineiro de música" and por_categoria["EQUIPE"]["fornecedor"] is None
    assert por_categoria["FORNECEDOR"]["fornecedor"] == {"razao_social": "Gráfica Aurora ME", "cnpj": "12345678000199"}
    assert por_categoria["TARIFA"]["funcao"] is None and por_categoria["TARIFA"]["fornecedor"] is None
    assert d["etapas"][0]["publico_atendido"] == 40 and d["relatorios"][0]["data_limite_analise"] == "2027-02-28"
    # o histórico do razão (que tem o nome da pessoa) NUNCA vai ao site
    assert "João da Silva" not in client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").text
    assert "Pgto" not in client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").text


def test_site_diz_so_quantos_lancamentos_faltam_classificar(client, gestor, aprovador, razao):
    parceria = _publicada(client, gestor, aprovador, valor_total="10000")
    razao.receber(parceria["id_centro_custo"], "700", "Repasse com histórico interno")
    d = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()
    assert d["lancamentos_em_classificacao"] == 1 and d["recebido"] == 700
    assert d["recebimentos"] == []
    assert "Repasse com histórico interno" not in client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").text


def test_estornado_nao_aparece_no_site(client, gestor, aprovador, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_lancamento = razao.receber(parceria["id_centro_custo"], "500")
    _classificar_tudo(client, gestor, parceria)
    client.post(f"/api/parcerias/{parceria['id_parceria']}/enviar-revisao", headers=gestor)
    client.post(f"/api/parcerias/{parceria['id_parceria']}/aprovar", headers=aprovador)
    assert len(client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()["recebimentos"]) == 1
    razao.estornar(id_lancamento)
    d = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()
    assert d["recebimentos"] == [] and d["recebido"] == 0


def test_so_documento_aprovado_e_vinculado_aparece_na_parceria_publica(client, db, gestor, aprovador):
    from app.models.documentos import DocumentoInstitucional

    parceria = _publicada(client, gestor, aprovador)
    id_parceria = parceria["id_parceria"]

    def documento(situacao, publicar=True):
        doc = DocumentoInstitucional(
            tipo="TERMO_FOMENTO", titulo=f"Termo {situacao}", classificacao="Interna", publicar_no_site=publicar,
            vinculo_tipo="parceria", vinculo_id=id_parceria, grupo_versao=uuid.uuid4().hex, versao=1, vigente=True,
            publico_nome=f"x-{uuid.uuid4().hex}.pdf", situacao=situacao,
        )
        db.add(doc)
        db.commit()
        return doc.id_documento

    aprovado = documento("Aprovado")
    documento("Rascunho")
    documento("Retirado")
    documento("Aprovado", publicar=False)
    docs = client.get(f"/api/publico/transparencia/parcerias/{id_parceria}").json()["documentos"]
    assert [d["id_documento"] for d in docs] == [aprovado]
    assert docs[0]["arquivo"] == f"/api/publico/transparencia/documentos/{aprovado}/arquivo"


def test_datas_do_site_nao_dependem_do_fuso_de_quem_le(client, db, gestor, aprovador, razao):
    """`ultima_atualizacao` sai em UTC com `Z`; a data de cada movimento é o DIA no relógio de Parauapebas (UTC-3):
    um pagamento feito às 22h do dia 10 (01h UTC do dia 11) tem que aparecer como dia 10."""
    from app.models.financeiro import LancamentoContabil

    parceria = _criar(client, gestor, valor_total="1000")
    id_lancamento = razao.receber(parceria["id_centro_custo"], "500")
    lancamento = db.query(LancamentoContabil).filter(LancamentoContabil.id_lancamento == id_lancamento).first()
    lancamento.data_lancamento = datetime(2026, 8, 11, 1, 30)  # 22h30 do dia 10, em Belém
    db.commit()
    _classificar_tudo(client, gestor, parceria)
    client.post(f"/api/parcerias/{parceria['id_parceria']}/enviar-revisao", headers=gestor)
    client.post(f"/api/parcerias/{parceria['id_parceria']}/aprovar", headers=aprovador)
    d = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()
    assert d["ultima_atualizacao"].endswith("Z") and len(d["ultima_atualizacao"]) > 20
    assert d["recebimentos"][0]["data"] == "2026-08-10"


def test_ultima_atualizacao_anda_quando_algo_muda(client, gestor, aprovador):
    parceria = _publicada(client, gestor, aprovador)
    antes = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()["ultima_atualizacao"]
    client.post(f"/api/parcerias/{parceria['id_parceria']}/etapas", json={"titulo": "Nova oficina"}, headers=gestor)
    depois = client.get(f"/api/publico/transparencia/parcerias/{parceria['id_parceria']}").json()["ultima_atualizacao"]
    assert depois > antes


def test_detalhe_publico_de_id_inexistente_e_404(client):
    assert client.get("/api/publico/transparencia/parcerias/99999999").status_code == 404


# ----------------------------------------------------------------------------- trilha de auditoria
def test_historico_conta_quem_fez_o_que_sem_vazar_campo_interno(client, db, gestor, aprovador, razao):
    parceria = _criar(client, gestor, valor_total="10000")
    id_parceria = parceria["id_parceria"]
    client.patch(f"/api/parcerias/{id_parceria}", json={"ano": 2027}, headers=gestor)
    client.post(f"/api/parcerias/{id_parceria}/parcelas", json={"valor_previsto": "1000"}, headers=gestor)
    client.post(f"/api/parcerias/{id_parceria}/enviar-revisao", headers=gestor)
    client.post(f"/api/parcerias/{id_parceria}/recusar", json={"motivo": "Faltou citar o bairro atendido."}, headers=aprovador)
    trilha = client.get(f"/api/parcerias/{id_parceria}/historico", headers=aprovador).json()
    assert [e["acao"] for e in trilha] == ["CRIADO", "EDITADO", "PARCELA_CRIADA", "ENVIADO_REVISAO", "RECUSADO"]
    assert trilha[-1]["rotulo"] == "Publicação recusada" and trilha[-1]["detalhes"]["motivo"] == "Faltou citar o bairro atendido."
    assert all(e["quem"] and e["quem"].endswith("@teste.local") for e in trilha)
    linhas = db.query(AuditLog).filter(AuditLog.tabela_afetada == "parcerias", AuditLog.id_registro_afetado == id_parceria).count()
    assert linhas == 5


def test_historico_exige_permissao_de_leitura(client, db, gestor):
    parceria = _criar(client, gestor)
    assert client.get(f"/api/parcerias/{parceria['id_parceria']}/historico", headers=_usuario(db)).status_code == 403
