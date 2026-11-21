"""v9.6b - `GET /api/financeiro/pendencias`: o que a Visão geral do Financeiro mostra nos lugares que mudam sozinhos e os números ao lado das telas
no menu do módulo.

As promessas que estes testes travam:
  1. só quem OPERA o Financeiro (`financeiro`) lê; quem só audita (`financeiro_auditar`, o Conselho Fiscal) recebe 403 e anônimo é barrado;
  2. as compras são as que esperam a assinatura DESTA pessoa: pela alçada do valor (cargo), nunca as que ela mesma pediu, nunca as que ela já
     assinou, e com quem já assinou (dupla assinatura);
  3. as contas batem: mensalidades em atraso (só as vencidas ANTES de hoje, no dia de Belém, sem nome), contas a pagar vencidas e a mais antiga,
     reembolsos que a pessoa pode decidir, perguntas do Conselho sem resposta, extrato do mês passado sem fechar e o Pix do site a conferir.

O banco dos testes é um só para a suíte inteira: cada teste mede a DIFERENÇA que ele mesmo causou."""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from app.models.compras import ReembolsoDespesa
from app.models.conselho_fiscal import QuestionamentoLancamento
from app.models.fechamento import FechamentoMensal
from app.models.financeiro import ContaFinanceira, PlanoDeContas, PlanoDeContribuicao, TituloFinanceiro
from app.services import compras as compras_service
from app.services.lancamento_tardio import hoje_da_associacao
from tests.test_compras import _criar_alcada, _criar_conta, _criar_fornecedor, _criar_solicitacao, _criar_usuario_com_mandato
from tests.test_documentos_institucionais import _usuario
from tests.test_situacao import _criar_associado

ROTA = "/api/financeiro/pendencias"


def _pendencias(client, headers) -> dict:
    r = client.get(ROTA, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_so_quem_opera_le_as_pendencias(client, auth_headers, db):
    assert client.get(ROTA).status_code == 401

    # quem só audita (o Conselho Fiscal) não opera: 403, e continua indo ao Conselho Fiscal pela tela
    r = client.get(ROTA, headers=_usuario(db, "financeiro_auditar"))
    assert r.status_code == 403
    assert r.json()["detail"] == "Sem permissão 'financeiro'."
    # nem uma permissão de outro módulo abre
    assert client.get(ROTA, headers=_usuario(db, "associados")).status_code == 403

    corpo = _pendencias(client, _usuario(db, "financeiro"))
    assert set(corpo) == {
        "hoje", "compras_para_aprovar", "pix_do_site", "mensalidades_em_atraso", "a_pagar_vencidas", "reembolsos_para_decidir",
        "perguntas_sem_resposta", "extrato_sem_fechar", "contadores",
    }
    assert set(corpo["contadores"]) == {"compras", "doacoes", "reembolsos", "conciliacao"}
    # o dia é o de Belém
    assert corpo["hoje"] == hoje_da_associacao(db).isoformat()


def test_compras_que_esperam_a_minha_assinatura(client, auth_headers, db):
    conta = _criar_conta(client, auth_headers, f"4.1.96{uuid.uuid4().int % 100:02d}", "Despesa")
    fornecedor = _criar_fornecedor(client, auth_headers, "9601")
    # faixa só deste teste, abaixo do valor que exige cotação, com dupla assinatura (1º Tesoureiro e Presidente; cada cargo tem uma vaga só)
    _criar_alcada(client, auth_headers, ["TESOUREIRO", "PRESIDENTE"], valor_minimo=641, valor_maximo=649, dupla=True)
    id_a, tesoureiro_a = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    _, tesoureiro_b = _criar_usuario_com_mandato(client, auth_headers, "PRESIDENTE")
    _, vice = _criar_usuario_com_mandato(client, auth_headers, "VICE_TESOUREIRO")

    def total(headers):
        return _pendencias(client, headers)["compras_para_aprovar"]["total"]

    antes = {"a": total(tesoureiro_a), "b": total(tesoureiro_b), "vice": total(vice)}

    # o pedido do administrador: o 1º Tesoureiro (A) e o Presidente (B) têm de assinar; o 2º Tesoureiro não tem o cargo da alçada
    pedido = _criar_solicitacao(client, auth_headers, conta, valor=645, id_fornecedor=fornecedor)
    assert total(tesoureiro_a) == antes["a"] + 1
    assert total(tesoureiro_b) == antes["b"] + 1
    assert total(vice) == antes["vice"]

    # o pedido que o próprio tesoureiro A fez nunca espera a assinatura dele (quem pede não aprova), mas espera a do B
    pedido_de_a = _criar_solicitacao(client, tesoureiro_a, conta, valor=646, id_fornecedor=fornecedor)
    assert total(tesoureiro_a) == antes["a"] + 1
    assert total(tesoureiro_b) == antes["b"] + 2

    r = client.post(f"/api/solicitacoes-compra/{pedido}/aprovar", headers=tesoureiro_a)
    assert r.status_code == 200, r.text
    assert r.json()["aprovacoes"] == 1
    # A já assinou: sai da lista dele; B ainda precisa assinar e vê a assinatura de A
    assert total(tesoureiro_a) == antes["a"]
    assert total(tesoureiro_b) == antes["b"] + 2

    from app.models.associados import Associado

    associado_a = db.query(Associado).filter(Associado.id_associado == id_a).one()
    nome_de_a = associado_a.nome_completo
    for item in compras_service.solicitacoes_que_aguardam_a_assinatura(db, associado_a.id_usuario):
        assert item["solicitacao"].id_solicitacao not in (pedido, pedido_de_a)
    db.rollback()

    corpo_b = _pendencias(client, tesoureiro_b)
    itens_b = {i["id_solicitacao"]: i for i in corpo_b["compras_para_aprovar"]["itens"]}
    # o resumo da janela "Aprovar": valor, fornecedor, a regra da alçada e quem já assinou (a Visão geral mostra até 20 pedidos e o banco dos testes
    # pode ter pedidos mais antigos na frente; o serviço sem limite é conferido no teste seguinte)
    if pedido in itens_b:
        item = itens_b[pedido]
        assert Decimal(str(item["valor"])) == Decimal("645")
        assert item["fornecedor"] == "Fornecedor Teste Compras"
        assert item["alcada"]["exigidas"] == 2
        assert item["alcada"]["cargos"] == "Presidente, 1º Tesoureiro"
        assert [a["nome"] for a in item["assinaturas"]] == [nome_de_a]
        assert item["faltam_cotacoes"] == 0

    # o B assina: o pedido fica aprovado e sai da lista de todo mundo
    r = client.post(f"/api/solicitacoes-compra/{pedido}/aprovar", headers=tesoureiro_b)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Aprovada"
    assert total(tesoureiro_b) == antes["b"] + 1
    assert total(tesoureiro_a) == antes["a"]


def test_o_resumo_do_pedido_vem_do_servico_sem_limite(client, auth_headers, db):
    """O serviço (sem o limite de 20 da Visão geral) devolve o pedido com a alçada, as cotações que faltam e quem já assinou."""
    conta = _criar_conta(client, auth_headers, f"4.1.97{uuid.uuid4().int % 100:02d}", "Despesa")
    fornecedor = _criar_fornecedor(client, auth_headers, "9602")
    # valor que exige 2 cotações (o padrão é a partir de R$ 1.000,00): a janela avisa que faltam
    _criar_alcada(client, auth_headers, ["TESOUREIRO"], valor_minimo=1641, valor_maximo=1649)
    id_tesoureiro, _ = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    pedido = _criar_solicitacao(client, auth_headers, conta, valor=1645, id_fornecedor=fornecedor)

    from app.models.associados import Associado

    id_usuario = db.query(Associado.id_usuario).filter(Associado.id_associado == id_tesoureiro).scalar()
    itens = {i["solicitacao"].id_solicitacao: i for i in compras_service.solicitacoes_que_aguardam_a_assinatura(db, id_usuario)}
    db.rollback()
    assert pedido in itens
    assert itens[pedido]["exigidas"] == 1
    assert itens[pedido]["faltam_cotacoes"] == 2
    assert itens[pedido]["assinaturas"] == []


def test_mensalidades_e_contas_a_pagar_em_atraso(client, auth_headers, db):
    headers = _usuario(db, "financeiro")
    antes = _pendencias(client, headers)
    hoje = hoje_da_associacao(db)
    meia_noite = datetime(hoje.year, hoje.month, hoje.day)

    receita = _criar_conta(client, auth_headers, f"3.1.96{uuid.uuid4().int % 100:02d}", "Receita")
    despesa = _criar_conta(client, auth_headers, f"4.1.98{uuid.uuid4().int % 100:02d}", "Despesa")
    fornecedor = _criar_fornecedor(client, auth_headers, "9603")
    associado = _criar_associado(client)["id_associado"]
    # (o que vai direto ao banco vem depois dos pedidos à API: o SQLite dos testes trava com uma escrita aberta)
    plano = PlanoDeContribuicao(categoria=f"Categoria pendencias {receita}", descricao="Mensalidade pendências", periodicidade="Mensal",
                                dia_vencimento=10, id_conta_contabil=receita)
    db.add(plano)
    db.flush()

    def titulo(**campos):
        base = {"id_conta_contabil": receita, "valor_original": Decimal("40"), "saldo_devedor": Decimal("40"), "status": "Pendente"}
        db.add(TituloFinanceiro(**{**base, **campos}))

    # conta: só a mensalidade vencida ANTES de hoje e ainda pendente
    titulo(tipo_titulo="A Receber", id_associado=associado, id_plano_contribuicao=plano.id_plano, descricao="Mensalidade vencida",
           data_vencimento=meia_noite - timedelta(days=3), saldo_devedor=Decimal("37.50"))
    titulo(tipo_titulo="A Receber", id_associado=associado, id_plano_contribuicao=plano.id_plano, descricao="Mensalidade vencida 2",
           data_vencimento=meia_noite - timedelta(days=35))
    # não contam: vence hoje (ainda não atrasou), já paga, sem plano (não é mensalidade)
    titulo(tipo_titulo="A Receber", id_associado=associado, id_plano_contribuicao=plano.id_plano, descricao="Vence hoje", data_vencimento=meia_noite)
    titulo(tipo_titulo="A Receber", id_associado=associado, id_plano_contribuicao=plano.id_plano, descricao="Paga", data_vencimento=meia_noite - timedelta(days=5),
           status="Pago", saldo_devedor=Decimal("0"))
    titulo(tipo_titulo="A Receber", id_associado=associado, descricao="Taxa avulsa vencida", data_vencimento=meia_noite - timedelta(days=5))
    # a pagar: uma vencida bem antiga (fica sendo a mais antiga) e uma que vence amanhã (não conta)
    titulo(tipo_titulo="A Pagar", id_conta_contabil=despesa, id_fornecedor=fornecedor, descricao="Contador de março", data_vencimento=datetime(1971, 3, 4),
           valor_original=Decimal("300"), saldo_devedor=Decimal("300"))
    titulo(tipo_titulo="A Pagar", id_conta_contabil=despesa, descricao="Vence amanhã", data_vencimento=meia_noite + timedelta(days=1))
    db.commit()

    depois = _pendencias(client, headers)
    mensalidades_antes, mensalidades = antes["mensalidades_em_atraso"], depois["mensalidades_em_atraso"]
    assert mensalidades["titulos"] == mensalidades_antes["titulos"] + 2
    assert mensalidades["associados"] == mensalidades_antes["associados"] + 1
    assert Decimal(str(mensalidades["soma"])) - Decimal(str(mensalidades_antes["soma"])) == Decimal("77.50")
    assert set(mensalidades) == {"titulos", "associados", "soma"}  # sem nome de ninguém

    a_pagar_antes, a_pagar = antes["a_pagar_vencidas"], depois["a_pagar_vencidas"]
    assert a_pagar["total"] == a_pagar_antes["total"] + 1
    assert Decimal(str(a_pagar["soma"])) - Decimal(str(a_pagar_antes["soma"])) == Decimal("300")
    assert a_pagar["mais_antiga"]["descricao"] == "Contador de março"
    assert a_pagar["mais_antiga"]["fornecedor"] == "Fornecedor Teste Compras"
    assert a_pagar["mais_antiga"]["vencimento"] == "1971-03-04"


def test_reembolsos_perguntas_extrato_e_pix(client, auth_headers, db):
    headers = _usuario(db, "financeiro")
    antes = _pendencias(client, headers)

    despesa = _criar_conta(client, auth_headers, f"4.1.99{uuid.uuid4().int % 100:02d}", "Despesa")
    beneficiario, tesoureiro = _criar_usuario_com_mandato(client, auth_headers, "TESOUREIRO")
    from app.models.associados import Associado

    id_usuario_tesoureiro = db.query(Associado.id_usuario).filter(Associado.id_associado == beneficiario).scalar()
    antes_tesoureiro = _pendencias(client, tesoureiro)["reembolsos_para_decidir"]["total"]
    outro = _criar_associado(client)["id_associado"]
    # um reembolso para o próprio tesoureiro (ele não decide) e um pedido por ele para outra pessoa (também não decide: quem pede não aprova)
    db.add(ReembolsoDespesa(id_associado=beneficiario, descricao="Táxi", valor=Decimal("20"), comprovante="x.pdf", id_conta_contabil=despesa, status="Solicitado"))
    db.add(ReembolsoDespesa(id_associado=outro, descricao="Lanche", valor=Decimal("15"), comprovante="y.pdf", id_conta_contabil=despesa, status="Solicitado",
                            id_usuario_solicitante=id_usuario_tesoureiro))
    db.add(ReembolsoDespesa(id_associado=outro, descricao="Já aprovado", valor=Decimal("15"), comprovante="z.pdf", id_conta_contabil=despesa, status="Aprovado"))

    # uma pergunta do Conselho sem resposta, sobre um título de março de 1972
    titulo = TituloFinanceiro(tipo_titulo="A Pagar", id_conta_contabil=despesa, descricao="Título questionado", valor_original=Decimal("10"),
                              saldo_devedor=Decimal("0"), status="Pago", data_vencimento=datetime(1972, 3, 15))
    db.add(titulo)
    db.flush()
    db.add(QuestionamentoLancamento(id_titulo=titulo.id_titulo, id_associado_questionador=outro, pergunta="Cadê a nota?", status="Aberto",
                                    criado_em=datetime(1972, 3, 20)))

    # uma conta bancária nova: o extrato do mês passado dela está sem fechar
    conta_banco = PlanoDeContas(codigo_contabil=f"1.1.96.{uuid.uuid4().hex[:6]}", descricao_conta=f"Banco pendências {uuid.uuid4().hex[:6]}", tipo="Ativo")
    db.add(conta_banco)
    db.flush()
    financeira = ContaFinanceira(id_conta=conta_banco.id_conta, tipo_conta_financeira="Banco", ativo=True)
    db.add(financeira)
    db.commit()
    nome_do_banco = conta_banco.descricao_conta

    depois = _pendencias(client, headers)
    assert depois["reembolsos_para_decidir"]["total"] == antes["reembolsos_para_decidir"]["total"] + 2
    assert _pendencias(client, tesoureiro)["reembolsos_para_decidir"]["total"] == antes_tesoureiro

    assert depois["perguntas_sem_resposta"]["total"] == antes["perguntas_sem_resposta"]["total"] + 1
    assert depois["perguntas_sem_resposta"]["mes_mais_antigo"] == "1972-03"
    assert depois["perguntas_sem_resposta"]["da_auditoria"] is False

    hoje = hoje_da_associacao(db)
    mes_passado = (hoje.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    assert depois["extrato_sem_fechar"]["competencia"] == mes_passado
    assert depois["extrato_sem_fechar"]["contas"] == antes["extrato_sem_fechar"]["contas"] + 1
    assert nome_do_banco in depois["extrato_sem_fechar"]["nomes"]

    # fechado o mês passado dessa conta, ela sai da pendência
    db.add(FechamentoMensal(competencia=mes_passado, id_conta_financeira=financeira.id_conta_financeira, saldo_sistema=0, saldo_extrato_bancario=0,
                            divergencia=0))
    db.commit()
    fechado = _pendencias(client, headers)
    assert fechado["extrato_sem_fechar"]["contas"] == antes["extrato_sem_fechar"]["contas"]
    assert nome_do_banco not in fechado["extrato_sem_fechar"]["nomes"]

    # o Pix do site é o mesmo número da conferência das doações
    resumo = client.get("/api/intencoes-doacao/resumo", headers=auth_headers).json()
    assert fechado["pix_do_site"] == {"a_conferir": resumo["a_conferir"], "vencidos": resumo["expiradas"]}
    # os números do menu
    assert fechado["contadores"] == {
        "compras": fechado["compras_para_aprovar"]["total"], "doacoes": resumo["a_conferir"],
        "reembolsos": fechado["reembolsos_para_decidir"]["total"], "conciliacao": fechado["extrato_sem_fechar"]["contas"],
    }
