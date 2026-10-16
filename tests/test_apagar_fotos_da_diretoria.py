"""v5.7d - a foto da Diretoria NÃO fica guardada depois do mandato (decisão do Presidente, 2026-10-15: "tem que apagar automaticamente; não pode ficar guardada").

O que o servidor garante:
  1. encerrar o mandato (vacância) apaga a foto na hora, arquivo e linha, e conta isso na resposta e na Auditoria; se a pessoa ainda tem outro mandato vigente, a foto fica;
  2. a rotina do sistema apanha o vencimento natural (que nenhum clique provoca): foto de quem não tem mandato vigente nem marcado sai; de quem está vigente, ou vai tomar posse, não;
  3. quem recebeu a foto antes de o mandato ser cadastrado tem 24 horas; passado esse prazo sem nenhum mandato, a foto sai;
  4. se o armazenamento não conseguiu apagar o arquivo, a foto continua cadastrada (nunca uma linha apagada com arquivo solto) e a próxima rodada tenta de novo;
  5. a Auditoria guarda só o fato, sem dado pessoal; rodar de novo não faz nada."""
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException

from app.models.core import AuditLog
from app.models.mandatos import FotoDaDiretoria, Mandato
from app.services import armazenamento
from app.services import fotos_da_diretoria as servico
from tests.test_foto_da_diretoria import _enviar, _jpeg, _linha_publica, _novo_dirigente
from tests.test_publico import _dar_posse


def _foto(db, dirigente) -> FotoDaDiretoria | None:
    db.expire_all()
    return db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_pessoa == dirigente.id_pessoa).first()


def _com_foto(client, auth_headers, db, cargo="PRESIDENTE"):
    dirigente, id_mandato = _novo_dirigente(db, cargo=cargo, client=client, auth_headers=auth_headers)
    assert _enviar(client, auth_headers, dirigente.id_associado, _jpeg()).status_code == 201
    foto = _foto(db, dirigente)
    return dirigente, id_mandato, foto.id_foto, foto.arquivo_nome


def _ultimo_log(db) -> int:
    from sqlalchemy import func

    return db.query(func.coalesce(func.max(AuditLog.id_log), 0)).scalar()


def _auditorias(db, acao, id_foto, desde=0):
    """As linhas da Auditoria DEPOIS de `desde` (o banco de teste reaproveita o número de uma foto apagada: `id_foto` sozinho pegaria linha de outro teste)."""
    return db.query(AuditLog).filter(
        AuditLog.acao == acao, AuditLog.tabela_afetada == "fotos_da_diretoria", AuditLog.id_registro_afetado == id_foto, AuditLog.id_log > desde,
    ).all()


def test_encerrar_o_mandato_apaga_a_foto_na_hora(client, auth_headers, db):
    dirigente, id_mandato, id_foto, arquivo = _com_foto(client, auth_headers, db)
    assert armazenamento.obter().ler(servico.PASTA_DAS_FOTOS, arquivo) is not None
    desde = _ultimo_log(db)

    r = client.post(f"/api/mandatos/{id_mandato}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    assert r.status_code == 200, r.text
    assert r.json()["foto_apagada"] is True

    assert _foto(db, dirigente) is None, "a linha saiu"
    assert armazenamento.obter().ler(servico.PASTA_DAS_FOTOS, arquivo) is None, "o arquivo saiu do armazenamento"
    assert client.get(f"/api/publico/diretoria/fotos/{id_foto}").status_code == 404
    assert client.get(f"/api/mandatos/associados/{dirigente.id_associado}/foto-publica", headers=auth_headers).json()["foto"] is None
    entradas = _auditorias(db, "FOTO_APAGADA_AUTOMATICAMENTE", id_foto, desde)
    assert len(entradas) == 1 and entradas[0].id_usuario is not None, "quem encerrou o mandato ficou na Auditoria"
    assert dirigente.nome_completo not in str(entradas[0].dados_depois), "a Auditoria não guarda dado pessoal"


def test_encerrar_um_mandato_nao_apaga_a_foto_de_quem_tem_outro_vigente(client, auth_headers, db):
    dirigente, id_mandato, id_foto, arquivo = _com_foto(client, auth_headers, db, cargo="PRESIDENTE")
    id_outro = _dar_posse(client, auth_headers, dirigente, "DIRETORIA_EXECUTIVA", "SECRETARIO")
    r = client.post(f"/api/mandatos/{id_mandato}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"})
    assert r.status_code == 200, r.text
    assert r.json()["foto_apagada"] is False
    assert _foto(db, dirigente) is not None and armazenamento.obter().ler(servico.PASTA_DAS_FOTOS, arquivo) is not None
    assert _linha_publica(client, dirigente.nome_completo)["foto"] is not None
    # o último mandato encerrado leva a foto
    assert client.post(f"/api/mandatos/{id_outro}/encerrar", headers=auth_headers, json={"motivo": "Renúncia"}).json()["foto_apagada"] is True
    assert _foto(db, dirigente) is None


def test_a_rotina_apanha_o_vencimento_natural_do_mandato(client, auth_headers, db):
    dirigente, id_mandato, id_foto, arquivo = _com_foto(client, auth_headers, db)
    desde = _ultimo_log(db)
    assert servico.apagar_fotos_sem_mandato(db) == (0, 0), "com o mandato vigente nada acontece"
    assert _foto(db, dirigente) is not None

    mandato = db.query(Mandato).filter(Mandato.id_mandato == id_mandato).one()
    mandato.data_fim_previsto = datetime.utcnow() - timedelta(days=1)  # o mandato venceu sozinho, sem clique de ninguém
    db.commit()
    assert servico.apagar_fotos_sem_mandato(db)[0] >= 1
    assert _foto(db, dirigente) is None
    assert armazenamento.obter().ler(servico.PASTA_DAS_FOTOS, arquivo) is None
    assert len(_auditorias(db, "FOTO_APAGADA_AUTOMATICAMENTE", id_foto, desde)) == 1
    assert servico.apagar_fotos_sem_mandato(db) == (0, 0), "rodar de novo não faz nada"


def test_quem_vai_tomar_posse_mantem_a_foto_e_quem_nunca_teve_mandato_tem_24_horas(client, auth_headers, db):
    # cargos diferentes: dar posse a um cargo encerra o mandato vigente de quem o ocupava (e, agora, a foto dele)
    # posse marcada para daqui a uma semana: a foto da posse não pode sumir antes
    futuro, id_mandato, _, _ = _com_foto(client, auth_headers, db, cargo="VICE_PRESIDENTE_2")
    mandato = db.query(Mandato).filter(Mandato.id_mandato == id_mandato).one()
    mandato.data_inicio = datetime.utcnow() + timedelta(days=7)
    mandato.data_fim_previsto = datetime.utcnow() + timedelta(days=7 + 365)
    db.commit()
    try:
        # sem nenhum mandato: 24 horas de carência
        novo, id_mandato_novo, _, _ = _com_foto(client, auth_headers, db, cargo="VICE_SECRETARIO")
        db.query(Mandato).filter(Mandato.id_mandato == id_mandato_novo).delete()
        db.commit()
        antiga, id_mandato_antiga, id_foto_antiga, _ = _com_foto(client, auth_headers, db, cargo="VICE_TESOUREIRO")
        db.query(Mandato).filter(Mandato.id_mandato == id_mandato_antiga).delete()
        db.query(FotoDaDiretoria).filter(FotoDaDiretoria.id_foto == id_foto_antiga).update({"criado_em": datetime.utcnow() - timedelta(hours=25)})
        db.commit()

        servico.apagar_fotos_sem_mandato(db)
        assert _foto(db, futuro) is not None, "a posse marcada segura a foto"
        assert _foto(db, novo) is not None, "foto de ontem à noite, mandato ainda por cadastrar: dentro das 24 horas"
        assert _foto(db, antiga) is None, "passadas as 24 horas sem nenhum mandato, a foto sai"
    finally:
        # o banco de teste é compartilhado: a posse marcada para o futuro não pode barrar a posse de outro teste neste cargo
        db.query(Mandato).filter(Mandato.id_mandato == id_mandato).delete()
        db.commit()


def test_se_o_armazenamento_falha_a_foto_continua_cadastrada_e_a_proxima_rodada_apaga(client, auth_headers, db, monkeypatch):
    dirigente, id_mandato, id_foto, arquivo = _com_foto(client, auth_headers, db)
    mandato = db.query(Mandato).filter(Mandato.id_mandato == id_mandato).one()
    mandato.data_fim_previsto = datetime.utcnow() - timedelta(days=1)
    db.commit()

    original = servico.remover_arquivo
    desde = _ultimo_log(db)

    def quebra(*_a, **_k):
        raise HTTPException(status_code=502, detail="armazenamento fora do ar")

    monkeypatch.setattr(servico, "remover_arquivo", quebra)
    assert servico.apagar_fotos_sem_mandato(db) == (0, 1), "nada apagado e a falha é CONTADA (quem roda não pode deixá-la passar)"
    assert _foto(db, dirigente) is not None and armazenamento.obter().ler(servico.PASTA_DAS_FOTOS, arquivo) is not None
    assert _auditorias(db, "FOTO_APAGADA_AUTOMATICAMENTE", id_foto, desde) == [], "nada foi apagado, nada na Auditoria"

    monkeypatch.setattr(servico, "remover_arquivo", original)
    assert servico.apagar_fotos_sem_mandato(db)[0] >= 1
    assert _foto(db, dirigente) is None and armazenamento.obter().ler(servico.PASTA_DAS_FOTOS, arquivo) is None


def test_o_roteiro_do_sistema_roda_a_rotina(db, monkeypatch, capsys):
    import importlib.util
    from pathlib import Path

    caminho = Path(__file__).resolve().parent.parent / "scripts" / "apagar_fotos_da_diretoria_vencidas.py"
    especificacao = importlib.util.spec_from_file_location("apagar_fotos_da_diretoria_vencidas", caminho)
    roteiro = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(roteiro)

    class SemFechar:  # o roteiro fecha a sessão no fim; a do teste continua aberta
        def __getattr__(self, nome):
            return getattr(db, nome)

        def close(self):
            pass

    monkeypatch.setattr(roteiro, "SessaoLocal", lambda: SemFechar())
    assert roteiro.main() == 0
    assert "[apagar-fotos-da-diretoria] fotos apagadas:" in capsys.readouterr().out


def test_o_roteiro_do_sistema_fica_vermelho_quando_alguma_foto_nao_foi_apagada(monkeypatch, capsys):
    """Antes (achado da conferência independente), sem papel de dados no armazenamento a rotina engolia o 403 e o fluxo ficava verde com a foto guardada para sempre."""
    import importlib.util
    from pathlib import Path

    caminho = Path(__file__).resolve().parent.parent / "scripts" / "apagar_fotos_da_diretoria_vencidas.py"
    especificacao = importlib.util.spec_from_file_location("apagar_fotos_da_diretoria_vencidas_vermelho", caminho)
    roteiro = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(roteiro)

    class Sessao:
        def close(self):
            pass

    monkeypatch.setattr(roteiro, "SessaoLocal", lambda: Sessao())
    monkeypatch.setattr(roteiro.fotos_da_diretoria, "apagar_fotos_sem_mandato", lambda db: (1, 2))
    assert roteiro.main() == 1
    saida = capsys.readouterr().out
    assert "fotos apagadas: 1; que não foi possível apagar: 2" in saida and "::error::2 foto(s)" in saida
    monkeypatch.setattr(roteiro.fotos_da_diretoria, "apagar_fotos_sem_mandato", lambda db: (3, 0))
    assert roteiro.main() == 0
