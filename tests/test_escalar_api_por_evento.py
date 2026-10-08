"""A regra que liga uma réplica da API perto de um evento (scripts/escalar_api_por_evento.py) é uma função pura: aqui ela é provada sem rede, com fuso e fronteiras."""
import importlib.util
import json
import sys
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

CAMINHO = Path(__file__).resolve().parent.parent / "scripts" / "escalar_api_por_evento.py"


@pytest.fixture(scope="module")
def escala():
    especificacao = importlib.util.spec_from_file_location("escalar_api_por_evento", CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    sys.modules[especificacao.name] = modulo  # o @dataclass do script procura o módulo por nome
    especificacao.loader.exec_module(modulo)
    return modulo


def _evento(inicio_local: str, fim_local: str | None = None, titulo: str = "Culto de teste") -> dict:
    return {"titulo": titulo, "data_hora_inicio": inicio_local, "data_hora_fim": fim_local}


# o horário dos eventos é o LOCAL (Brasília/Pará, UTC-3): 10/out/2026 19:00 local = 22:00 UTC
EVENTO = _evento("2026-10-10T19:00:00", "2026-10-10T21:00:00")


def _utc(texto: str) -> datetime:
    return datetime.fromisoformat(texto).replace(tzinfo=timezone.utc)


def test_sem_evento_a_api_pode_dormir(escala):
    decisao = escala.decidir([], _utc("2026-10-10T12:00:00"))
    assert decisao.minimo == 0 and "pode dormir" in decisao.motivo


def test_a_janela_comeca_24_horas_antes_do_evento_e_termina_12_horas_depois_do_fim(escala):
    inicio_utc = _utc("2026-10-10T22:00:00")  # 19:00 local
    fim_utc = _utc("2026-10-11T00:00:00")  # 21:00 local
    assert escala.decidir([EVENTO], inicio_utc - timedelta(hours=24, minutes=1)).minimo == 0
    assert escala.decidir([EVENTO], inicio_utc - timedelta(hours=24)).minimo == 1
    assert escala.decidir([EVENTO], inicio_utc).minimo == 1
    assert escala.decidir([EVENTO], fim_utc + timedelta(hours=12)).minimo == 1
    assert escala.decidir([EVENTO], fim_utc + timedelta(hours=12, minutes=1)).minimo == 0


def test_evento_sem_hora_de_fim_conta_12_horas_depois_do_comeco(escala):
    sem_fim = _evento("2026-10-10T19:00:00", None)
    assert escala.decidir([sem_fim], _utc("2026-10-11T10:00:00")).minimo == 1  # 07:00 local do dia seguinte
    assert escala.decidir([sem_fim], _utc("2026-10-11T10:01:00")).minimo == 0


def test_o_fuso_do_evento_e_o_local_nao_o_utc(escala):
    # às 23:00 UTC de 10/10 já são 20:00 locais: o evento das 19:00 local já começou (e a janela segue aberta)
    assert escala.decidir([EVENTO], _utc("2026-10-10T23:00:00")).minimo == 1
    # 11 dias antes não liga
    assert escala.decidir([EVENTO], _utc("2026-09-29T12:00:00")).minimo == 0


def test_basta_um_evento_na_janela_e_o_motivo_diz_qual(escala):
    longe = _evento("2027-01-01T10:00:00", titulo="Longe")
    perto = _evento("2026-10-10T19:00:00", titulo="Perto de agora")
    decisao = escala.decidir([longe, perto], _utc("2026-10-10T15:00:00"))
    assert decisao.minimo == 1 and "Perto de agora" in decisao.motivo


def test_data_ilegivel_nao_derruba_a_decisao(escala):
    estranhos = [{"titulo": "sem data"}, {"data_hora_inicio": "amanhã"}, {"data_hora_inicio": None}, _evento("2026-10-10T19:00:00")]
    assert escala.decidir(estranhos, _utc("2026-10-10T15:00:00")).minimo == 1
    assert escala.decidir(estranhos[:3], _utc("2026-10-10T15:00:00")).minimo == 0


def test_se_nao_conseguir_ler_os_eventos_mantem_como_esta(escala, monkeypatch, capsys):
    def falha(*_args, **_kwargs):
        raise urllib.error.URLError("sem rede")

    monkeypatch.setattr(escala, "ler_eventos", falha)
    monkeypatch.setattr("sys.argv", ["escalar", "--api-url", "https://api.exemplo.org"])
    assert escala.main() == 0
    saida = json.loads(capsys.readouterr().out)
    assert saida["manter"] is True and saida["minimo"] is None


def test_forcar_decide_o_numero_sem_olhar_os_eventos(escala, monkeypatch, capsys):
    monkeypatch.setattr(escala, "ler_eventos", lambda *_a, **_k: pytest.fail("não deveria ler os eventos"))
    for numero in ("0", "1"):
        monkeypatch.setattr("sys.argv", ["escalar", "--api-url", "https://hml-api.exemplo.org", "--forcar", numero])
        assert escala.main() == 0
        assert json.loads(capsys.readouterr().out)["minimo"] == int(numero)
