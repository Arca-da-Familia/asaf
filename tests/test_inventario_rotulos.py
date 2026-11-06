"""v9.3i (pedido do Presidente, 06/11: nada de nome técnico na tela): todo campo de dado pessoal que o inventário classifica tem nome em
português, e o inventário (tela, planilha, PDF) e o rascunho do relatório de impacto o usam."""
from app.classificacao_de_dados import CLASSIFICACAO, NAO_PESSOAL
from app.inventario_rotulos import ROTULO_DA_COLUNA, rotulo_da_tabela_do_inventario, rotulo_do_dado
from app.services import inventario


def test_todo_campo_pessoal_classificado_tem_nome_em_portugues():
    pessoais = {coluna for tabela in CLASSIFICACAO.values() for coluna, classe in tabela.colunas.items() if classe != NAO_PESSOAL}
    assert len(pessoais) > 150
    assert sorted(pessoais - ROTULO_DA_COLUNA.keys()) == []
    for rotulo in ROTULO_DA_COLUNA.values():
        assert "_" not in rotulo and rotulo[:1].isupper(), rotulo


def test_toda_tabela_classificada_tem_nome_sem_sublinhado():
    for tabela in CLASSIFICACAO:
        assert "_" not in rotulo_da_tabela_do_inventario(tabela), tabela


def test_o_dado_vira_campo_e_tabela_em_portugues():
    assert rotulo_do_dado("pessoas.cpf") == "CPF (Pessoas)"
    assert rotulo_do_dado("registros_atendimento.relato") == "Relato (Registros de atendimento)"
    assert rotulo_do_dado("enderecos") == "Endereços"


def test_o_inventario_manda_o_nome_de_cada_item_citado(db):
    for atividade in inventario.listar(db)["atividades"]:
        citados = [*atividade["tabelas"], *atividade["dados_pessoais"], *atividade["dados_sensiveis"], *atividade["texto_livre_que_pode_ter_sensivel"]]
        assert set(citados) <= atividade["nomes"].keys()
        assert all("_" not in nome for nome in atividade["nomes"].values()), atividade["codigo"]
