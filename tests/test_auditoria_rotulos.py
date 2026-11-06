"""v9.3f (pedido do Presidente, 06/11: "tem muita coisa que é tela de sistema, que não é para aparecer"): a Auditoria mostra o nome em português
de cada assunto (tabela) e de cada ação, nunca o código técnico. A trava: toda tabela e toda ação que o código registra na Auditoria — escrita
direto na chamada, numa constante do módulo ou nos dois lados de um `x if y else z` — tem rótulo em `app/auditoria_rotulos.py`. Tabela ou ação
nova sem rótulo reprova aqui (o rótulo de reserva, que troca o sublinhado por espaço, não tem acento nem preposição: "Plano de contas" vira
"Plano de contas" só com o rótulo de verdade)."""
import ast
from pathlib import Path

from app.auditoria import registrar_auditoria
from app.auditoria_rotulos import ROTULO_DA_ACAO, ROTULO_DA_TABELA, rotulo_da_acao, rotulo_da_tabela

RAIZ = Path(__file__).resolve().parent.parent


def _constantes(modulo: ast.Module) -> dict[str, str]:
    achadas = {}
    for no in modulo.body:
        if isinstance(no, ast.Assign) and isinstance(no.value, ast.Constant) and isinstance(no.value.value, str):
            for alvo in no.targets:
                if isinstance(alvo, ast.Name):
                    achadas[alvo.id] = no.value.value
    return achadas


def _valores(no, constantes: dict[str, str]) -> set[str]:
    if isinstance(no, ast.Constant) and isinstance(no.value, str):
        return {no.value}
    if isinstance(no, ast.Name) and no.id in constantes:
        return {constantes[no.id]}
    if isinstance(no, ast.IfExp):
        return _valores(no.body, constantes) | _valores(no.orelse, constantes)
    return set()


def _registrados() -> tuple[set[str], set[str]]:
    tabelas, acoes = set(), set()
    for arquivo in (RAIZ / "app").rglob("*.py"):
        modulo = ast.parse(arquivo.read_text(encoding="utf-8"))
        constantes = _constantes(modulo)
        for no in ast.walk(modulo):
            if not isinstance(no, ast.Call):
                continue
            nome = getattr(no.func, "id", getattr(no.func, "attr", None))
            if nome not in ("registrar_auditoria", "AuditLog"):
                continue
            argumentos = list(no.args)
            nomeados = {k.arg: k.value for k in no.keywords}
            tabelas |= _valores(argumentos[2] if len(argumentos) > 2 else nomeados.get("tabela_afetada"), constantes)
            acoes |= _valores(argumentos[3] if len(argumentos) > 3 else nomeados.get("acao"), constantes)
    return tabelas, acoes


def test_toda_tabela_e_toda_acao_registrada_tem_nome_em_portugues():
    tabelas, acoes = _registrados()
    assert len(tabelas) > 100 and len(acoes) > 150, "a varredura do código parou de achar as chamadas de registrar_auditoria"
    assert sorted(tabelas - ROTULO_DA_TABELA.keys()) == []
    assert sorted(acoes - ROTULO_DA_ACAO.keys()) == []


def test_o_rotulo_nunca_tem_sublinhado_e_comeca_com_maiuscula():
    for rotulo in [*ROTULO_DA_TABELA.values(), *ROTULO_DA_ACAO.values()]:
        assert "_" not in rotulo and rotulo[:1].isupper(), rotulo


def test_o_que_nao_tem_rotulo_ainda_sai_sem_sublinhado():
    assert rotulo_da_tabela("tabela_nova_qualquer") == "Tabela nova qualquer"
    assert rotulo_da_acao("ACAO_NOVA") == "Acao nova"
    assert rotulo_da_tabela(None) is None


def test_a_auditoria_traz_o_nome_em_portugues_e_os_filtros_tambem(client, auth_headers, db):
    registrar_auditoria(db, None, "plano_de_contas", "BAIXA_TITULO", id_registro_afetado=7)
    pagina = client.get("/api/auditoria/?tabela_afetada=plano_de_contas", headers=auth_headers).json()
    entrada = pagina["entradas"][0]
    assert (entrada["tabela_afetada"], entrada["rotulo_tabela"]) == ("plano_de_contas", "Plano de contas")
    assert (entrada["acao"], entrada["rotulo_acao"]) == ("BAIXA_TITULO", "Pagamento de título registrado")

    tabelas = client.get("/api/auditoria/tabelas", headers=auth_headers).json()
    assert {"valor": "plano_de_contas", "rotulo": "Plano de contas"} in tabelas
    assert [t["rotulo"].lower() for t in tabelas] == sorted(t["rotulo"].lower() for t in tabelas)
    acoes = client.get("/api/auditoria/acoes", headers=auth_headers).json()
    assert {"valor": "BAIXA_TITULO", "rotulo": "Pagamento de título registrado"} in acoes


def test_os_filtros_da_auditoria_sao_so_de_quem_ve_a_auditoria(client):
    assert client.get("/api/auditoria/tabelas").status_code == 401
    assert client.get("/api/auditoria/acoes").status_code == 401
