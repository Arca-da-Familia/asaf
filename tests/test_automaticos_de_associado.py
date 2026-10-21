"""v6.2d (FASE 6) - as comunicações automáticas do ciclo do associado: o e-mail de boas-vindas na aprovação da filiação (melhor esforço, resultado na
Auditoria sem o endereço), o sino de boas-vindas quando a secretaria libera o acesso, o aviso a quem cuida de Associados quando acaba o período de
experiência (uma vez por pessoa) e os lembretes de mensalidade diários (o dia de Belém, a recuperação de uma rodada perdida, uma falha que não derruba
o lote). Nenhum e-mail de verdade sai daqui: `enviar_email` é sempre trocado."""
import json
import smtplib
from datetime import datetime, timedelta, timezone

from app.models.associados import Associado
from app.models.core import AuditLog, Usuario
from app.models.financeiro import LembreteMensalidadeEnviado
from app.models.notificacoes_painel import NotificacaoPainel
from app.security import usuario_tem_permissao
from app.services import automaticos_de_associado, lembretes, notificacoes
from tests.apoio_auth import cabecalho_admin
from tests.apoio_filiacao import tres_socios_propoem
from tests.test_contribuicoes import _criar_conta
from tests.test_filiacao import _propor
from tests.test_lembretes import _configurar_pix, _criar_titulo_a_receber
from tests.test_situacao import _criar_associado


def _aprovar(client, db, **dados_da_proposta):
    proposta = _propor(client, **dados_da_proposta).json()
    id_proposta = proposta["id_proposta"]
    assert client.post(f"/api/filiacao/propostas/{id_proposta}/conferir", headers=cabecalho_admin(client)).status_code == 200
    tres_socios_propoem(db, id_proposta)
    r = client.post(f"/api/filiacao/propostas/{id_proposta}/aprovar", headers=cabecalho_admin(client), json={"categoria": "Efetivo"})
    assert r.status_code == 200, r.text
    return r.json()


def _registro_de_boas_vindas(db, id_associado):
    db.expire_all()
    linha = (
        db.query(AuditLog)
        .filter(AuditLog.acao == "BOAS_VINDAS_ENVIADAS", AuditLog.id_registro_afetado == id_associado)
        .order_by(AuditLog.id_log.desc()).first()
    )
    assert linha is not None
    return linha


def _servidor_de_email_ligado(monkeypatch, enviados, erro=None):
    def enviar(destinatario, assunto, corpo_texto, cabecalhos=None):
        if erro is not None:
            raise erro
        enviados.append({"para": destinatario, "assunto": assunto, "corpo": corpo_texto})

    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: True)
    monkeypatch.setattr(notificacoes, "enviar_email", enviar)


def test_a_aprovacao_manda_as_boas_vindas_com_a_matricula_e_a_auditoria_guarda_o_resultado_sem_o_endereco(client, db, monkeypatch):
    enviados = []
    _servidor_de_email_ligado(monkeypatch, enviados)
    corpo = _aprovar(client, db)
    associado = db.get(Associado, corpo["id_associado"])

    assert len(enviados) == 1
    assert enviados[0]["para"] == associado.email_contato
    assert enviados[0]["assunto"] == "Bem-vindo(a) à ASAF"
    assert f"matrícula é a nº {corpo['numero_matricula']}" in enviados[0]["corpo"]
    assert "período de experiência" in enviados[0]["corpo"]
    assert "Estatuto" not in enviados[0]["corpo"]  # o período de experiência é regra do sistema (Configurações), não do Estatuto

    registro = _registro_de_boas_vindas(db, corpo["id_associado"])
    assert json.loads(registro.dados_depois) == {"email": "enviado"}
    assert associado.email_contato not in str(registro.dados_depois)


def test_o_e_mail_que_falha_nunca_desfaz_a_aprovacao(client, db, monkeypatch):
    _servidor_de_email_ligado(monkeypatch, [], erro=smtplib.SMTPServerDisconnected("caiu"))
    corpo = _aprovar(client, db)
    assert corpo["status_arrolamento"] == "Em Experiência"
    assert db.get(Associado, corpo["id_associado"]) is not None
    assert "falhou" in str(_registro_de_boas_vindas(db, corpo["id_associado"]).dados_depois)


def test_sem_servidor_de_email_ou_sem_endereco_a_auditoria_diz_o_motivo(client, db, monkeypatch):
    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: False)
    corpo = _aprovar(client, db)
    assert "sem_servidor_de_email" in str(_registro_de_boas_vindas(db, corpo["id_associado"]).dados_depois)

    enviados = []
    _servidor_de_email_ligado(monkeypatch, enviados)
    sem_email = _aprovar(client, db, email_contato=None)
    assert enviados == []
    assert "sem_email" in str(_registro_de_boas_vindas(db, sem_email["id_associado"]).dados_depois)


def test_liberar_o_acesso_poe_as_boas_vindas_no_sino_do_novo_usuario(client, db):
    associado = _criar_associado(client)
    r = client.post(
        f"/api/associados/{associado['id_associado']}/conceder-acesso",
        json={"email": f"boasvindas{associado['id_associado']}@acesso.example.com", "senha_provisoria": "Provisoria1"},
        headers=cabecalho_admin(client),
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    avisos = db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == r.json()["id_usuario"]).all()
    assert [(a.tipo, a.titulo) for a in avisos] == [("boas_vindas", "Bem-vindo(a) ao painel da ASAF")]


def test_o_fim_da_experiencia_atualiza_a_situacao_e_avisa_uma_vez_quem_cuida_de_associados(client, db, monkeypatch):
    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: False)
    # um usuário ativo SEM a permissão `associados` (nível Associado): não pode receber o aviso
    sem_permissao = _criar_associado(client)
    r = client.post(
        f"/api/associados/{sem_permissao['id_associado']}/conceder-acesso",
        json={"email": f"semperm{sem_permissao['id_associado']}@acesso.example.com", "senha_provisoria": "Provisoria1"}, headers=cabecalho_admin(client),
    )
    assert r.status_code == 200, r.text
    id_sem_permissao = r.json()["id_usuario"]
    assert not usuario_tem_permissao(db, db.get(Usuario, id_sem_permissao), "associados")
    acabou = _aprovar(client, db)
    ainda_nao = _aprovar(client, db)
    a = db.get(Associado, acabou["id_associado"])
    a.data_fim_experiencia = datetime.utcnow() - timedelta(hours=1)
    db.commit()

    resultado = automaticos_de_associado.avisar_fim_de_experiencia(db)
    assert resultado["fim_de_experiencia"] >= 1
    db.expire_all()
    assert db.get(Associado, acabou["id_associado"]).status_arrolamento == "Ativo - Em Dia"
    assert db.get(Associado, ainda_nao["id_associado"]).status_arrolamento == "Em Experiência"

    avisos = db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{acabou['id_associado']}").all()
    assert avisos, "ninguém foi avisado"
    assert all(usuario_tem_permissao(db, db.get(Usuario, n.id_usuario), "associados") for n in avisos)
    assert id_sem_permissao not in {n.id_usuario for n in avisos}
    assert str(acabou["numero_matricula"]) in avisos[0].titulo
    assert db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{ainda_nao['id_associado']}").count() == 0

    # a rotina roda a cada 15 minutos: a segunda rodada não avisa de novo
    automaticos_de_associado.avisar_fim_de_experiencia(db)
    assert db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{acabou['id_associado']}").count() == len(avisos)
    # e a situação que muda DEPOIS (ex.: ficou inadimplente e voltou a ficar em dia) também não: o aviso é só da saída de "Em Experiência"
    from app.services.categoria_associado import recalcular_categoria_associado

    a = db.get(Associado, acabou["id_associado"])
    a.status_arrolamento = "Ativo - Inadimplente"
    db.commit()
    assert recalcular_categoria_associado(db, acabou["id_associado"]) == "Ativo - Em Dia"
    db.expire_all()
    assert db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{acabou['id_associado']}").count() == len(avisos)


def test_licenciado_que_termina_a_experiencia_e_avisado_com_a_situacao_de_verdade(client, db, monkeypatch):
    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: False)
    corpo = _aprovar(client, db)
    a = db.get(Associado, corpo["id_associado"])
    a.data_fim_experiencia = datetime.utcnow() - timedelta(hours=1)
    a.data_fim_licenca = datetime.utcnow() + timedelta(days=30)
    db.commit()
    automaticos_de_associado.avisar_fim_de_experiencia(db)
    db.expire_all()
    assert db.get(Associado, corpo["id_associado"]).status_arrolamento == "Licenciado"
    aviso = db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{corpo['id_associado']}").first()
    assert aviso is not None and "Licenciado" in aviso.texto


# --- lembretes de mensalidade, agora diários ---------------------------------------------------------------------------------------------------------------


def _titulo(client, auth_headers, conta, vencimento):
    associado = _criar_associado(client)
    return _criar_titulo_a_receber(client, auth_headers, conta, associado["id_associado"], 40, vencimento)


def test_uma_rodada_perdida_e_recuperada_no_dia_seguinte_com_os_dias_de_verdade(client, auth_headers, db, monkeypatch):
    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9911", "Receita Lembrete Diario 1", tipo="Receita")
    hoje = datetime(2095, 1, 20)
    atrasado_8 = _titulo(client, auth_headers, conta, hoje - timedelta(days=8))  # o degrau é 7: a rodada de ontem não aconteceu
    vence_em_4 = _titulo(client, auth_headers, conta, hoje + timedelta(days=4))  # o "5 dias antes" era ontem
    venceu_ontem = _titulo(client, auth_headers, conta, hoje - timedelta(days=1))  # o "vence hoje" perdido não sai atrasado (o texto ficaria errado)
    corpos = {}
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda destinatario, assunto, corpo_texto, cabecalhos=None: corpos.setdefault(destinatario, corpo_texto))

    resultado = lembretes.rodada_de_lembretes(db, hoje=hoje)
    tipos = {r["id_titulo"]: r["tipo_lembrete"] for r in resultado["enviados"]}
    assert tipos.get(atrasado_8) == "ATRASO_7"
    assert tipos.get(vence_em_4) == "ANTES_VENCIMENTO"
    assert venceu_ontem not in tipos
    assert resultado["falhas"] == 0 and resultado["parou"] is None
    email_do_atrasado = next(r["email"] for r in resultado["enviados"] if r["id_titulo"] == atrasado_8)
    assert "em atraso há 8 dia(s)" in corpos[email_do_atrasado]

    # no dia seguinte, nada se repete
    seguinte = {r["id_titulo"] for r in lembretes.rodada_de_lembretes(db, hoje=hoje + timedelta(days=1))["enviados"]}
    assert not seguinte & {atrasado_8, vence_em_4}


def test_um_titulo_recebe_um_lembrete_por_rodada_e_nunca_um_atraso_menor_depois_de_um_maior(client, auth_headers, db, monkeypatch):
    from app.models.core import ConfiguracaoInstitucional

    _configurar_pix(db)
    config = db.query(ConfiguracaoInstitucional).filter(ConfiguracaoInstitucional.chave_configuracao == "DIAS_ATRASO_LEMBRETE").first()
    antes = config.valor_configuracao
    config.valor_configuracao = "0,7,8"  # o "0" (o mesmo dia do "vence hoje") é ignorado
    db.commit()
    try:
        conta = _criar_conta(client, auth_headers, "3.2.9912", "Receita Lembrete Diario 2", tipo="Receita")
        hoje = datetime(2095, 3, 20)
        id_titulo = _titulo(client, auth_headers, conta, hoje - timedelta(days=8))  # cabe no degrau 7 (com a tolerância) e no 8
        monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda *a, **k: None)

        primeira = [r for r in lembretes.rodada_de_lembretes(db, hoje=hoje)["enviados"] if r["id_titulo"] == id_titulo]
        assert [r["tipo_lembrete"] for r in primeira] == ["ATRASO_8"]
        segunda = [r for r in lembretes.rodada_de_lembretes(db, hoje=hoje + timedelta(days=1))["enviados"] if r["id_titulo"] == id_titulo]
        assert segunda == []  # o ATRASO_7 não vem depois do ATRASO_8

        vence_hoje = _titulo(client, auth_headers, conta, hoje)
        do_dia = [r["tipo_lembrete"] for r in lembretes.rodada_de_lembretes(db, hoje=hoje)["enviados"] if r["id_titulo"] == vence_hoje]
        assert do_dia == ["NO_VENCIMENTO"]  # um só, sem um "ATRASO_0" junto
    finally:
        config.valor_configuracao = antes
        db.commit()


def test_um_endereco_recusado_nao_derruba_o_lote_e_o_lembrete_sai_na_rodada_seguinte(client, auth_headers, db, monkeypatch):
    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9913", "Receita Lembrete Diario 3", tipo="Receita")
    hoje = datetime(2095, 5, 20)
    recusado = _titulo(client, auth_headers, conta, hoje)
    aceito = _titulo(client, auth_headers, conta, hoje)
    email_recusado = db.get(Associado, _id_associado_do_titulo(db, recusado)).email_contato

    def enviar(destinatario, assunto, corpo_texto, cabecalhos=None):
        if destinatario == email_recusado:
            raise smtplib.SMTPRecipientsRefused({destinatario: (550, b"5.1.1 user unknown")})

    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", enviar)
    resultado = lembretes.rodada_de_lembretes(db, hoje=hoje)
    ids = {r["id_titulo"] for r in resultado["enviados"]}
    assert aceito in ids and recusado not in ids
    assert resultado["falhas"] == 1 and resultado["parou"] is None
    assert db.query(LembreteMensalidadeEnviado).filter(LembreteMensalidadeEnviado.id_titulo == recusado).count() == 0

    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda *a, **k: None)
    assert recusado in {r["id_titulo"] for r in lembretes.rodada_de_lembretes(db, hoje=hoje)["enviados"]}


def test_a_falha_da_conexao_para_a_rodada(client, auth_headers, db, monkeypatch):
    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9914", "Receita Lembrete Diario 4", tipo="Receita")
    hoje = datetime(2095, 7, 20)
    _titulo(client, auth_headers, conta, hoje)
    _titulo(client, auth_headers, conta, hoje)
    tentativas = []

    def enviar(destinatario, assunto, corpo_texto, cabecalhos=None):
        tentativas.append(destinatario)
        raise smtplib.SMTPServerDisconnected("caiu")

    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", enviar)
    resultado = lembretes.rodada_de_lembretes(db, hoje=hoje)
    assert resultado["parou"] == "conexao" and resultado["enviados"] == []
    assert len(tentativas) == 1  # não insiste em todos com o servidor fora


def test_o_hoje_da_rodada_e_o_dia_de_belem(client, auth_headers, db, monkeypatch):
    from app.services import comunicacao

    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9916", "Receita Lembrete Diario 6", tipo="Receita")
    id_titulo = _titulo(client, auth_headers, conta, datetime(2096, 9, 20))

    class Relogio(datetime):
        @classmethod
        def utcnow(cls):
            return datetime(2096, 9, 21, 2, 0)  # 02:00 UTC do dia 21 = 23:00 do dia 20 em Belém

    monkeypatch.setattr(comunicacao, "datetime", Relogio)
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda *a, **k: None)
    assert datetime(2096, 9, 21, 2, 0, tzinfo=timezone.utc).date().isoformat() == "2096-09-21"
    tipos = {r["id_titulo"]: r["tipo_lembrete"] for r in lembretes.rodada_de_lembretes(db)["enviados"]}
    assert tipos.get(id_titulo) == "NO_VENCIMENTO"  # em Belém ainda é o dia 20: "vence hoje"


def test_a_tarefa_mensal_nao_manda_mais_lembretes_e_a_diaria_sim():
    mensal = open("scripts/tarefa_mensal_financeiro.py", encoding="utf-8").read()
    assert "lembretes" not in mensal.split('"""', 2)[2]
    diaria = open(".github/workflows/tarefa-diaria-lembretes.yml", encoding="utf-8").read()
    assert 'cron: "0 12 * * *"' in diaria and "scripts/enviar_lembretes_de_mensalidade.py" in diaria and "SMTP_SENHA" in diaria
    periodica = open(".github/workflows/tarefa-eventos-vagas.yml", encoding="utf-8").read()
    assert "scripts/avisar_fim_de_experiencia.py" in periodica


def _id_associado_do_titulo(db, id_titulo):
    from app.models.financeiro import TituloFinanceiro

    return db.get(TituloFinanceiro, id_titulo).id_associado


def test_a_rodada_de_lembretes_fica_na_auditoria_sem_endereco(client, auth_headers, db, monkeypatch):
    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9915", "Receita Lembrete Diario 5", tipo="Receita")
    hoje = datetime(2095, 11, 20)
    _titulo(client, auth_headers, conta, hoje)
    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", lambda *a, **k: None)
    resultado = lembretes.rodada_de_lembretes(db, hoje=hoje)
    db.expire_all()
    linha = db.query(AuditLog).filter(AuditLog.acao == "LEMBRETES_DO_DIA").order_by(AuditLog.id_log.desc()).first()
    dados = json.loads(linha.dados_depois)
    assert linha.id_usuario is None and dados["dia"] == "2095-11-20" and dados["enviados"] == len(resultado["enviados"]) and dados["falhas"] == 0
    assert "@" not in linha.dados_depois


def test_o_roteiro_da_homologacao_recusa_outro_banco(monkeypatch):
    import importlib.util
    import pytest

    esp = importlib.util.spec_from_file_location("hml_encerrar", "scripts/hml_encerrar_experiencia_do_robo.py")
    roteiro = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(roteiro)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@servidor/asaf?sslmode=require")
    with pytest.raises(SystemExit, match="RECUSADO"):
        roteiro.main()
    # mesmo com a URL enganando, a conferência do nome do banco recusa ANTES de qualquer consulta ou escrita
    import app.database

    class Resultado:
        def scalar(self):
            return "asaf"

    class SessaoDeOutroBanco:
        def execute(self, *_a, **_k):
            return Resultado()

        def query(self, *_a, **_k):
            raise AssertionError("consultou o banco errado")

        def commit(self):
            raise AssertionError("escreveu no banco errado")

        def close(self):
            pass

    monkeypatch.setattr(app.database, "SessaoLocal", SessaoDeOutroBanco)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@servidor/asaf_hml?sslmode=require")
    with pytest.raises(SystemExit, match="RECUSADO"):
        roteiro.main()


def test_a_falha_das_boas_vindas_nao_poe_o_endereco_no_log(client, db, monkeypatch, caplog):
    import logging

    _servidor_de_email_ligado(monkeypatch, [], erro=smtplib.SMTPRecipientsRefused({"recusado@exemplo.com.br": (550, b"5.1.1 user unknown")}))
    with caplog.at_level(logging.WARNING, logger="asaf.automaticos_de_associado"):
        corpo = _aprovar(client, db)
    assert "falhou" in str(_registro_de_boas_vindas(db, corpo["id_associado"]).dados_depois)
    assert caplog.records, "a falha não foi registrada no log"
    assert "@" not in caplog.text


def test_o_fim_da_experiencia_avisa_tambem_quando_um_lancamento_financeiro_recalcula_antes_da_rotina(client, db, monkeypatch):
    from app.services.categoria_associado import recalcular_categoria_associado

    monkeypatch.setattr(notificacoes, "smtp_configurado", lambda: False)
    acabou = _aprovar(client, db)
    licenciado_antes = _aprovar(client, db)
    a = db.get(Associado, acabou["id_associado"])
    a.data_fim_experiencia = datetime.utcnow() - timedelta(minutes=5)
    b = db.get(Associado, licenciado_antes["id_associado"])
    b.data_fim_licenca = datetime.utcnow() + timedelta(days=30)  # entrou de licença no meio da experiência: não é o fim dela
    db.commit()

    recalcular_categoria_associado(db, acabou["id_associado"])  # o mesmo que um lançamento ou uma baixa de título faz
    recalcular_categoria_associado(db, licenciado_antes["id_associado"])
    db.expire_all()
    assert db.query(NotificacaoPainel).filter(NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{acabou['id_associado']}").count() >= 1
    assert db.get(Associado, licenciado_antes["id_associado"]).status_arrolamento == "Licenciado"
    assert db.query(NotificacaoPainel).filter(
        NotificacaoPainel.tipo == "fim_de_experiencia", NotificacaoPainel.link == f"/associados/{licenciado_antes['id_associado']}",
    ).count() == 0


def test_um_endereco_com_acento_nao_para_a_rodada_e_um_erro_fora_do_servidor_e_so_daquela_mensagem(client, auth_headers, db, monkeypatch):
    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9917", "Receita Lembrete Diario 7", tipo="Receita")
    hoje = datetime(2096, 1, 20)
    com_acento = _titulo(client, auth_headers, conta, hoje)
    a = db.get(Associado, _id_associado_do_titulo(db, com_acento))
    a.email_contato = "joão.teste@exemplo.com.br"
    db.commit()
    estranho = _titulo(client, auth_headers, conta, hoje)
    normal = _titulo(client, auth_headers, conta, hoje)
    email_estranho = db.get(Associado, _id_associado_do_titulo(db, estranho)).email_contato
    tentativas = []

    def enviar(destinatario, assunto, corpo_texto, cabecalhos=None):
        tentativas.append(destinatario)
        if destinatario == email_estranho:
            raise UnicodeEncodeError("ascii", "x", 0, 1, "caractere que a conversa com o servidor não aceita")

    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", enviar)
    resultado = lembretes.rodada_de_lembretes(db, hoje=hoje)
    ids = {r["id_titulo"] for r in resultado["enviados"]}
    assert "joão.teste@exemplo.com.br" not in tentativas and com_acento not in ids  # o endereço que o servidor não aceitaria nem é tentado
    assert normal in ids and estranho not in ids
    assert resultado["parou"] is None and resultado["falhas"] == 1


def test_o_endereco_que_nao_existe_vai_para_a_higienizacao(client, auth_headers, db, monkeypatch):
    from app.models.qualidade_cadastro import CONTATO_EMAIL_SUSPEITO, FilaRevisaoCadastro

    _configurar_pix(db)
    conta = _criar_conta(client, auth_headers, "3.2.9918", "Receita Lembrete Diario 8", tipo="Receita")
    hoje = datetime(2096, 3, 20)
    id_titulo = _titulo(client, auth_headers, conta, hoje)
    associado = db.get(Associado, _id_associado_do_titulo(db, id_titulo))

    def enviar(destinatario, assunto, corpo_texto, cabecalhos=None):
        raise smtplib.SMTPRecipientsRefused({destinatario: (550, b"5.1.1 The email account that you tried to reach does not exist")})

    monkeypatch.setattr(lembretes.notificacoes, "enviar_email", enviar)
    resultado = lembretes.rodada_de_lembretes(db, hoje=hoje)
    assert resultado["parou"] is None and resultado["falhas"] >= 1
    db.expire_all()
    assert db.query(FilaRevisaoCadastro).filter(
        FilaRevisaoCadastro.tipo_sinal == CONTATO_EMAIL_SUSPEITO, FilaRevisaoCadastro.id_pessoa_a == associado.id_pessoa,
    ).count() == 1


def test_a_pausa_do_servidor_para_a_rodada_sem_alarme(monkeypatch):
    import importlib.util

    esp = importlib.util.spec_from_file_location("enviar_lembretes", "scripts/enviar_lembretes_de_mensalidade.py")
    roteiro = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(roteiro)
    for parou, saida in [(None, 0), ("pausa", 0), ("conexao", 1), ("limite", 1), ("remetente", 1)]:
        monkeypatch.setattr(lembretes, "rodada_de_lembretes", lambda db, parou=parou: {"enviados": [], "falhas": 0, "parou": parou})
        assert roteiro.main() == saida, parou
