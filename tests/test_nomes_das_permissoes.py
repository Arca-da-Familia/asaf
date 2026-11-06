"""v9.3g (pedido do Presidente, 06/11: nada de nome técnico na tela): toda permissão do sistema tem um nome curto em português, e as telas o
recebem do servidor (a matriz de Níveis e permissões, o público do aviso, a revisão anual)."""
import re
from pathlib import Path

from app.nomes_das_permissoes import NOME_DA_PERMISSAO, nome_da_permissao
from app.services.comunicacao import descrever_publico


def test_toda_permissao_semeada_tem_nome_em_portugues():
    # as permissões que o sistema cria (app/database.py); outros testes criam permissões de mentira no mesmo banco, que não contam
    fonte = (Path(__file__).resolve().parent.parent / "app" / "database.py").read_text(encoding="utf-8")
    codigos = set(re.findall(r'"codigo_permissao": "([a-z_]+)"', fonte))
    assert len(codigos) >= 20
    assert sorted(codigos - NOME_DA_PERMISSAO.keys()) == []
    for nome in NOME_DA_PERMISSAO.values():
        assert "_" not in nome and nome[:1].isupper(), nome


def test_o_nome_de_reserva_nao_tem_sublinhado():
    assert nome_da_permissao("permissao_nova") == "Permissao nova"


def test_as_telas_recebem_o_nome(client, auth_headers, db):
    nomes = client.get("/api/permissoes/nomes", headers=auth_headers).json()
    assert nomes["exportar_dados_pessoais"] == "Exportar dados pessoais de associados"
    lista = client.get("/api/permissoes/", headers=auth_headers).json()
    assert {p["codigo_permissao"]: p["nome"] for p in lista}["financeiro_auditar"] == "Financeiro (auditar, sem operar)"
    assert client.get("/api/permissoes/nomes").status_code == 401


def test_o_publico_do_aviso_se_descreve_pelo_nome(db):
    texto = descrever_publico(db, {"tipo": "permissao", "codigo_permissao": "financeiro_auditar"})
    assert texto == 'Quem tem a permissão "Financeiro (auditar, sem operar)"'
