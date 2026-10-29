"""v7.2f (FASE 7) - o relatório de atendimento das solicitações do titular (app/services/relatorio_de_atendimento_do_titular.py):
  1. conta as solicitações do período por direito, canal, resultado e fundamento, o prazo, o tempo médio, os relatórios entregues e as eliminações; nada de nome;
  2. a tela da Diretoria (permissão `privacidade`) pede o ano; quem não tem a permissão recebe 403;
  3. o relatório anual leva só os totais, protegidos (abaixo de 5, "menos de 5"; o tempo médio só com 5 respostas ou mais)."""
import uuid
from datetime import datetime, timedelta

from app.auditoria import registrar_auditoria
from app.models.atendimento import Atendimento
from app.services import relatorio_de_atendimento_do_titular as servico

INICIO, FIM = datetime(2031, 1, 1, 3), datetime(2032, 1, 1, 3)  # um ano só deste teste (o banco de teste é compartilhado)


def _pedido(db, *, subtipo="ACESSO", criado=None, respondido_em_dias=None, prazo_dias=15, resultado=None, fundamento=None, origem="site",
            identidade="MANUAL", status=None, nome="Pessoa Do Relatorio"):
    criado = criado or datetime(2031, 3, 10, 12)
    respondido = criado + timedelta(days=respondido_em_dias) if respondido_em_dias is not None else None
    a = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="TITULAR_LGPD", subtipo=subtipo, mensagem="Pedido do teste do relatório.",
                    nome_completo=nome, email_contato="relatorio@example.com", status=status or ("Respondido" if respondido else "Novo"), prazo_dias=prazo_dias,
                    prazo_em=criado + timedelta(days=prazo_dias), criado_em=criado, respondido_em=respondido, resultado=resultado, fundamento=fundamento,
                    origem=origem, identidade_validacao=identidade, identidade_validada_em=criado)
    db.add(a)
    db.commit()
    return a


def test_conta_por_direito_canal_resultado_fundamento_e_prazo(db):
    _pedido(db, subtipo="ACESSO", respondido_em_dias=3, resultado="ATENDIDO")
    _pedido(db, subtipo="ACESSO", respondido_em_dias=20, resultado="ATENDIDO", origem="painel", identidade="PAINEL")
    negado = _pedido(db, subtipo="ELIMINACAO", respondido_em_dias=5, resultado="NEGADO", fundamento="VINCULO_ATIVO", identidade="CODIGO_NO_EMAIL")
    _pedido(db, subtipo="CORRECAO", criado=datetime(2031, 6, 1, 12))  # em andamento e já vencido
    _pedido(db, subtipo="ACESSO", criado=datetime(2032, 2, 1, 12), respondido_em_dias=1, resultado="ATENDIDO")  # de outro ano: não entra
    registrar_auditoria(db, None, "atendimentos", "ELIMINACAO_A_PEDIDO", id_registro_afetado=negado.id_atendimento, dados_depois={"protocolo": negado.protocolo})

    r = servico.resumo(db, INICIO, FIM, agora=datetime(2031, 12, 1))
    assert r["total"] == 4
    assert {d["codigo"]: d["total"] for d in r["por_direito"]} == {"ACESSO": 2, "ELIMINACAO": 1, "CORRECAO": 1}
    assert {d["codigo"]: d["total"] for d in r["por_canal"]} == {"site": 2, "painel": 1, "minha_conta": 1}
    assert {d["codigo"]: d["total"] for d in r["por_resultado"]} == {"ATENDIDO": 2, "NEGADO": 1, "EM_ANDAMENTO": 1}
    assert [d["codigo"] for d in r["por_fundamento"]] == ["VINCULO_ATIVO"]
    assert (r["respondidos"], r["respondidos_no_prazo"], r["respondidos_fora_do_prazo"], r["em_andamento_vencidos"]) == (3, 2, 1, 1)
    assert r["tempo_medio_de_resposta_dias"] == round((3 + 20 + 5) / 3, 1)
    assert r["eliminacoes_feitas"] == 1 and r["relatorios_entregues"] == 0
    assert "Pessoa Do Relatorio" not in str(r), "só contagens"


def test_a_tela_da_diretoria_pede_o_ano_e_exige_a_permissao(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    url = "/api/privacidade/solicitacoes-do-titular/relatorio"
    r = client.get(url, headers=auth_headers)
    assert r.status_code == 200, r.text
    corpo = r.json()
    from app.services.fuso import para_belem

    assert corpo["ano"] == corpo["ano_atual"] == para_belem(datetime.utcnow()).year, "o ano de Belém"
    assert {"total", "por_direito", "por_resultado", "tempo_medio_de_resposta_dias"} <= set(corpo)
    assert client.get(url, params={"ano": 1999}, headers=auth_headers).status_code == 400
    assert client.get(url, params={"ano": 2999}, headers=auth_headers).status_code == 400
    _, sem = _criar_associado(db, f"Sem Privacidade {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    assert client.get(url, headers=_headers(sem)).status_code == 403


def test_o_relatorio_anual_leva_so_os_totais_protegidos_e_nada_se_descobre_por_subtracao():
    pequeno = {"total": 3, "por_resultado": [{"codigo": "ATENDIDO", "total": 2}, {"codigo": "NEGADO", "total": 1}], "respondidos": 3,
               "respondidos_no_prazo": 3, "respondidos_fora_do_prazo": 0, "tempo_medio_de_resposta_dias": 4.2}
    publico = servico.para_o_relatorio_anual(pequeno)
    assert publico["total"] == "menos de 5" and publico["atendidos"] is None and publico["respondidos_no_prazo"] is None
    assert publico["tempo_medio_de_resposta_dias"] is None, "com menos de 5 respostas, o tempo médio não sai"
    # total 6 = 5 atendidos + 1 negado: publicar "5" e "menos de 5" entregaria o "1" por subtração; as partes não saem
    subtracao = {"total": 6, "por_resultado": [{"codigo": "ATENDIDO", "total": 5}, {"codigo": "NEGADO", "total": 1}], "respondidos": 6,
                 "respondidos_no_prazo": 6, "respondidos_fora_do_prazo": 0, "tempo_medio_de_resposta_dias": 3.0}
    publico = servico.para_o_relatorio_anual(subtracao)
    assert publico["total"] == 6 and publico["atendidos"] is None and publico["nao_atendidos"] is None
    assert publico["respondidos_no_prazo"] == 6 and publico["respondidos_fora_do_prazo"] == 0 and publico["tempo_medio_de_resposta_dias"] == 3.0
    # 2 em andamento sobram do total: também não
    sobra = {**subtracao, "total": 12, "por_resultado": [{"codigo": "ATENDIDO", "total": 10}], "respondidos": 10, "respondidos_no_prazo": 10}
    assert servico.para_o_relatorio_anual(sobra)["atendidos"] is None
    grande = {**sobra, "total": 15, "respondidos": 15, "respondidos_no_prazo": 10, "respondidos_fora_do_prazo": 5,
              "por_resultado": [{"codigo": "ATENDIDO", "total": 10}, {"codigo": "NEGADO", "total": 5}], "tempo_medio_de_resposta_dias": 4.2}
    publico = servico.para_o_relatorio_anual(grande)
    assert (publico["total"], publico["atendidos"], publico["atendidos_em_parte"], publico["nao_atendidos"]) == (15, 10, 0, 5)
    assert (publico["respondidos_no_prazo"], publico["respondidos_fora_do_prazo"], publico["tempo_medio_de_resposta_dias"]) == (10, 5, 4.2)
    assert set(publico) == {"total", "atendidos", "atendidos_em_parte", "nao_atendidos", "respondidos_no_prazo", "respondidos_fora_do_prazo",
                            "tempo_medio_de_resposta_dias"}, "sem o detalhe por direito e canal"


def test_o_texto_do_relatorio_anual_traz_os_pedidos_e_o_antigo_continua_valido():
    from app.services import relatorio_anual

    base = {"ano": 2031, "apresentacao": "Apresentação do teste com texto suficiente.", "registros_desde": None, "projetos": [], "eventos": [],
            "eventos_totais": {"inscritos": 0, "presentes": 0}, "beneficiarios": {"pessoas": 0, "atendimentos": 0}, "voluntariado": {"horas": "0", "voluntarios": 0},
            "associados_no_fim_do_ano": 0, "indicadores": [], "contas": None}
    assert "Pedidos sobre dados pessoais" not in relatorio_anual.texto(base), "o relatório publicado antes da v7.2f não tem a parte"
    com = {**base, "solicitacoes_de_titulares": {"total": 15, "atendidos": 10, "atendidos_em_parte": 0, "nao_atendidos": 5,
                                                 "respondidos_no_prazo": 10, "respondidos_fora_do_prazo": 5, "tempo_medio_de_resposta_dias": 4.2}}
    texto = relatorio_anual.texto(com)
    assert "Pedidos sobre dados pessoais (Lei Geral de Proteção de Dados) feitos no ano: 15" in texto and "tempo médio de resposta: 4,2 dias" in texto
    so_total = {**base, "solicitacoes_de_titulares": {"total": "menos de 5", "atendidos": None, "atendidos_em_parte": None, "nao_atendidos": None,
                                                      "respondidos_no_prazo": None, "respondidos_fora_do_prazo": None, "tempo_medio_de_resposta_dias": None}}
    texto = relatorio_anual.texto(so_total)
    assert "feitos no ano: menos de 5 (a situação" in texto and "atendidos:" not in texto



def test_conta_pedidos_e_nao_registros_e_a_eliminacao_que_parou_nao_conta(db):
    liberado = _pedido(db, criado=datetime(2031, 4, 1, 12))
    for _ in range(2):  # liberado de novo (substitui o anterior): um pedido só
        registrar_auditoria(db, None, "atendimentos", "RELATORIO_DO_TITULAR_LIBERADO", id_registro_afetado=liberado.id_atendimento, dados_depois={})
    terminada = _pedido(db, subtipo="ELIMINACAO", criado=datetime(2031, 4, 2, 12))
    parada = _pedido(db, subtipo="ELIMINACAO", criado=datetime(2031, 4, 3, 12))
    for acao in ("ELIMINACAO_A_PEDIDO", "ELIMINACAO_A_PEDIDO_INCOMPLETA", "ELIMINACAO_A_PEDIDO"):  # parou, e eliminar de novo terminou
        registrar_auditoria(db, None, "atendimentos", acao, id_registro_afetado=terminada.id_atendimento, dados_depois={})
    for acao in ("ELIMINACAO_A_PEDIDO", "ELIMINACAO_A_PEDIDO_INCOMPLETA"):  # parou e ninguém terminou
        registrar_auditoria(db, None, "atendimentos", acao, id_registro_afetado=parada.id_atendimento, dados_depois={})
    r = servico.resumo(db, datetime(2031, 4, 1, 3), datetime(2031, 4, 4, 3))
    assert r["relatorios_entregues"] == 1 and r["eliminacoes_feitas"] == 1


def test_a_virada_do_ano_e_a_de_belem_e_o_encerrado_sem_resposta_tem_o_seu_rotulo(db):
    # 01/01/2036 às 02:30 UTC ainda é 31/12/2035 em Belém: é do ano anterior
    _pedido(db, criado=datetime(2036, 1, 1, 2, 30), status="Encerrado")
    _pedido(db, criado=datetime(2036, 1, 1, 3, 30))
    from app.services.relatorio_anual import _instantes_do_ano

    de_2035 = servico.resumo(db, *_instantes_do_ano(2035))
    de_2036 = servico.resumo(db, *_instantes_do_ano(2036))
    assert de_2035["total"] == 1 and de_2036["total"] == 1
    assert [d["codigo"] for d in de_2035["por_resultado"]] == ["ENCERRADO_SEM_RESPOSTA"], "encerrado sem resposta não é 'respondido'"


def test_o_prazo_tambem_nao_se_descobre_pelos_que_faltam_responder():
    # 12 pedidos, 8 respondidos no prazo e 0 fora: publicar daria os 4 sem resposta por subtração
    dados = {"total": 12, "por_resultado": [{"codigo": "ATENDIDO", "total": 12}], "respondidos": 8, "respondidos_no_prazo": 8,
             "respondidos_fora_do_prazo": 0, "tempo_medio_de_resposta_dias": 2.0}
    publico = servico.para_o_relatorio_anual(dados)
    assert publico["respondidos_no_prazo"] is None and publico["respondidos_fora_do_prazo"] is None
