"""v6.3c (FASE 6) - o relatório anual de atividades: números montados pelo sistema, apresentação escrita pela secretaria, aprovação de outra pessoa.

Decisão do Presidente (2026-10-22): o sistema monta os números do ano, a secretaria (permissão Documentos) escreve a apresentação e o Presidente ou o
Secretário (outra pessoa) aprova. Só de ano encerrado e em que o sistema já era usado; sem nome de ninguém; contagem de pessoas abaixo de 5 vira
"menos de 5"; projeto e evento internos não aparecem."""
import json
import uuid
from datetime import datetime

import pytest

from app.models.associados import Associado
from app.models.beneficiarios import Beneficiario, BeneficiarioProjeto, RegistroAtendimento
from app.models.core import AuditLog
from app.models.documentos import DocumentoInstitucional
from app.models.eventos import Evento, SessaoEvento
from app.models.motores import Indicador, Inscricao, MedicaoIndicador, RegistroPresenca
from app.models.pessoas import Pessoa
from app.models.projetos import ProjetoEvento
from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario
from app.services import relatorio_anual
from tests.test_documentos_institucionais import _usuario

ANO = 2015  # um ano só destes testes (o banco de teste é compartilhado)
INICIO_DO_SISTEMA = datetime(2014, 6, 1, 15, 0)  # o primeiro registro da Auditoria no banco de teste
APRESENTACAO = "Em 2015 a ASAF manteve as oficinas, abriu a segunda turma e recebeu a comunidade nos eventos do ano."


def _pessoa(db, nome="Pessoa de teste do relatório"):
    p = Pessoa(nome_completo=f"{nome} {uuid.uuid4().hex[:6]}")
    db.add(p)
    db.flush()
    return p


@pytest.fixture(autouse=True)
def sistema_em_uso_desde_2014(db):
    """O "primeiro registro" do sistema: uma entrada antiga da Auditoria (o banco de teste nasce hoje)."""
    if not db.query(AuditLog).filter(AuditLog.timestamp == INICIO_DO_SISTEMA).first():
        db.add(AuditLog(tabela_afetada="teste", acao="INICIO_DO_SISTEMA_DE_TESTE", timestamp=INICIO_DO_SISTEMA))
        db.commit()


_MONTADO: dict = {}


@pytest.fixture
def ano_com_atividades(db):
    """Monta, uma vez só (o banco de teste é da sessão inteira), um ano de atividades em 2015 (e ruídos que NÃO podem entrar)."""
    if _MONTADO:
        return _MONTADO
    m = uuid.uuid4().hex[:6]

    def projeto(nome, visibilidade, status, inicio, fim=None):
        p = ProjetoEvento(nome_projeto=f"{nome} {m}", visibilidade=visibilidade, status=status, data_inicio=inicio, data_fim_prevista=fim)
        db.add(p)
        return p

    publico = projeto("Oficinas de música", "Pública", "EM_EXECUCAO", datetime(2014, 3, 1))
    concluido = projeto("Reforço escolar", "Pública", "CONCLUIDO", datetime(2015, 2, 1), datetime(2015, 11, 30))
    atrasado = projeto("Horta atrasada", "Pública", "EM_EXECUCAO", datetime(2013, 1, 1), datetime(2014, 6, 30))  # fim PREVISTO vencido: continua
    cancelado = projeto("Coral cancelado em julho", "Pública", "CANCELADO", datetime(2015, 1, 10), datetime(2015, 12, 31))
    sem_fim = projeto("Concluído sem fim previsto", "Pública", "CONCLUIDO", datetime(2012, 1, 1))  # sem data: apareceria em todo ano; fica de fora
    suspenso = projeto("Projeto suspenso", "Pública", "SUSPENSO", datetime(2015, 1, 1))
    interno = projeto("Projeto interno secreto", "Interna", "EM_EXECUCAO", datetime(2015, 1, 1))
    antigo = projeto("Projeto que acabou em 2014", "Pública", "CONCLUIDO", datetime(2013, 1, 1), datetime(2014, 12, 31))
    db.flush()

    def evento(titulo, inicio, visibilidade="Pública", status="Realizado"):
        e = Evento(titulo=f"{titulo} {m}", categoria="CULTURAL", data_hora_inicio=inicio, visibilidade=visibilidade, status=status)
        db.add(e)
        db.flush()
        return e

    realizado = evento("Festival de teste", datetime(2015, 6, 10, 22, 0))
    cancelado_ev = evento("Evento cancelado", datetime(2015, 7, 1, 22, 0), status="Cancelado")
    interno_ev = evento("Reunião interna", datetime(2015, 8, 1, 22, 0), visibilidade="Interna")
    virada = evento("Virada de 2014", datetime(2015, 1, 1, 2, 0))  # 23h de 31/12/2014 em Belém: é de 2014
    esquecido = evento("Programado que passou sem ninguém", datetime(2015, 9, 1, 22, 0), status="Programado")
    com_presenca = evento("Programado com presença", datetime(2015, 10, 1, 22, 0), status="Programado")
    sessao = SessaoEvento(id_evento=realizado.id_evento, titulo="Segunda noite", data_hora_inicio=datetime(2015, 6, 11, 22, 0))
    db.add(sessao)
    db.flush()
    p = [_pessoa(db) for _ in range(8)]
    ev, se = ("Evento", realizado.id_evento), ("SessaoEvento", sessao.id_sessao)

    def inscricao(contexto, pessoa, status):
        db.add(Inscricao(contexto_tipo=contexto[0], id_contexto=contexto[1], id_pessoa=pessoa.id_pessoa, status=status))

    def presenca(contexto, pessoa, quando):
        db.add(RegistroPresenca(contexto_tipo=contexto[0], id_contexto=contexto[1], id_pessoa=pessoa.id_pessoa, hora_entrada=quando, meio_registro="QR"))

    for n in range(4):
        inscricao(ev, p[n], "Confirmado")
    inscricao(ev, p[4], "Presente")  # marcada "Presente" pelo painel, sem leitura na entrada: conta como presença
    inscricao(ev, p[5], "Confirmado")
    inscricao(se, p[5], "Confirmado")  # a mesma pessoa na sessão: uma inscrição só
    inscricao(ev, p[6], "Lista de Espera")  # não conta
    inscricao(ev, p[7], "Cancelado")  # não conta
    for n in range(4):
        presenca(ev, p[n], datetime(2015, 6, 10, 22, 5))
    presenca(se, p[0], datetime(2015, 6, 11, 22, 5))  # a mesma pessoa na sessão: uma presença só
    presenca(("Evento", com_presenca.id_evento), p[1], datetime(2015, 10, 1, 22, 5))

    # beneficiários: 3 pessoas ATENDIDAS no ano (6 atendimentos); uma 4ª com vínculo e sem atendimento no ano não conta
    vinculos = []
    for _ in range(4):
        b = Beneficiario(id_pessoa=_pessoa(db, "Beneficiária de teste").id_pessoa)
        db.add(b)
        db.flush()
        v = BeneficiarioProjeto(id_beneficiario=b.id_beneficiario, id_projeto=publico.id_projeto, papel="PARTICIPANTE", data_inicio=datetime(2014, 3, 1))
        db.add(v)
        db.flush()
        vinculos.append(v)
    for n in range(6):
        db.add(RegistroAtendimento(id_vinculo=vinculos[n % 3].id_vinculo, data_atendimento=datetime(2015, 4, 1 + n, 15), relato="Relato que nunca sai."))
    db.add(RegistroAtendimento(id_vinculo=vinculos[3].id_vinculo, data_atendimento=datetime(2014, 5, 1, 15), relato="Relato de 2014."))

    # voluntariado: 5 voluntários, 30,5 horas aprovadas no ano; uma pendente e uma de 2016 não contam
    termos = []
    for _ in range(5):
        t = TermoAdesaoVoluntario(id_pessoa=_pessoa(db, "Voluntário de teste").id_pessoa, atividade="Oficinas", carga_horaria_semanal=4,
                                  data_inicio=datetime(2015, 1, 1), data_fim_vigencia=datetime(2015, 12, 31))
        db.add(t)
        db.flush()
        termos.append(t)
    for n, t in enumerate(termos):
        db.add(RegistroHorasVoluntariado(id_termo=t.id_termo, data=datetime(2015, 5, 1 + n), horas=6, status="APROVADO"))
    db.add_all([
        RegistroHorasVoluntariado(id_termo=termos[0].id_termo, data=datetime(2015, 12, 31), horas=0.5, status="APROVADO"),
        RegistroHorasVoluntariado(id_termo=termos[1].id_termo, data=datetime(2015, 6, 1), horas=9, status="PENDENTE"),
        RegistroHorasVoluntariado(id_termo=termos[1].id_termo, data=datetime(2016, 1, 1), horas=7, status="APROVADO"),
    ])

    # associados: 6 com vínculo em 31/12/2015 (um deles desligado em 01/01/2016: ainda tinha vínculo); um desligado em 2015 e um admitido em 2016 não
    for admissao, desligamento in ([(datetime(2010, 1, 1), None)] * 5 + [(datetime(2012, 1, 1), datetime(2016, 1, 1)),
                                   (datetime(2012, 1, 1), datetime(2015, 9, 1)), (datetime(2016, 2, 1), None)]):
        db.add(Associado(id_pessoa=_pessoa(db, "Associado de teste").id_pessoa, data_admissao=admissao, data_desligamento=desligamento))

    # indicadores do projeto público: vale o ÚLTIMO período do ano (dezembro vem depois de junho e do 2º trimestre, mesmo escrito "2015-6"); um período
    # fora do formato não entra; um indicador desativado não aparece
    indicador = Indicador(nome="Crianças atendidas", unidade="crianças", meta=40, periodicidade="Mensal", contexto_tipo="Projeto", id_contexto=publico.id_projeto)
    desativado = Indicador(nome="Indicador desativado", unidade="x", periodicidade="Anual", contexto_tipo="Projeto", id_contexto=publico.id_projeto, ativo=False)
    db.add_all([indicador, desativado])
    db.flush()
    db.add_all([
        MedicaoIndicador(id_indicador=indicador.id_indicador, periodo="2015-6", valor=28),
        MedicaoIndicador(id_indicador=indicador.id_indicador, periodo="2015-12", valor=35),
        MedicaoIndicador(id_indicador=indicador.id_indicador, periodo="2015-T2", valor=30),
        MedicaoIndicador(id_indicador=indicador.id_indicador, periodo="2015 (anotação solta)", valor=99),
        MedicaoIndicador(id_indicador=indicador.id_indicador, periodo="2016-01", valor=50),
        MedicaoIndicador(id_indicador=desativado.id_indicador, periodo="2015", valor=1),
    ])
    db.commit()
    nomes = {"publico": publico, "concluido": concluido, "atrasado": atrasado, "cancelado": cancelado, "suspenso": suspenso, "interno": interno,
             "antigo": antigo, "sem_fim": sem_fim, "realizado": realizado, "cancelado_ev": cancelado_ev, "interno_ev": interno_ev, "virada": virada,
             "esquecido": esquecido, "com_presenca": com_presenca}
    _MONTADO.update({k: (v.nome_projeto if isinstance(v, ProjetoEvento) else v.titulo) for k, v in nomes.items()})
    return _MONTADO


def test_so_de_ano_encerrado_em_que_o_sistema_ja_era_usado_e_com_a_permissao(client, db):
    ano_corrente = datetime.utcnow().year
    preparador = _usuario(db, "documentos")
    r = client.post(f"/api/relatorios-anuais/{ano_corrente + 1}/preparar", headers=preparador)
    assert r.status_code == 409 and "ano encerrado" in r.json()["detail"]
    # antes do sistema: os números seriam zeros que não correspondem à realidade
    r = client.post("/api/relatorios-anuais/2013/preparar", headers=preparador)
    assert r.status_code == 409 and "só tem registros desde 01/06/2014" in r.json()["detail"]
    assert client.post(f"/api/relatorios-anuais/{ANO}/preparar").status_code == 401
    assert client.post(f"/api/relatorios-anuais/{ANO}/preparar", headers=_usuario(db, "financeiro")).status_code == 403
    situacao = client.get("/api/relatorios-anuais/2013/no-site", headers=preparador).json()
    assert (situacao["ano_encerrado"], situacao["primeiro_ano"], situacao["registros_desde"]) == (True, 2014, "2014-06-01")


def test_os_numeros_do_ano_sem_nome_e_sem_o_que_e_interno(db, ano_com_atividades):
    dados = relatorio_anual.montar(db, ANO)
    n = ano_com_atividades
    projetos = {p["nome"]: p["situacao"] for p in dados["projetos"]}
    esperados = {n["publico"]: "Em execução", n["concluido"]: "Concluído", n["atrasado"]: "Em execução", n["cancelado"]: "Cancelado"}
    assert {nome: projetos.get(nome) for nome in esperados} == esperados
    assert not {n["suspenso"], n["interno"], n["antigo"], n["sem_fim"]} & set(projetos)
    eventos = {e["titulo"]: e for e in dados["eventos"]}
    assert {n["realizado"], n["com_presenca"]} <= set(eventos)
    assert not {n["cancelado_ev"], n["interno_ev"], n["virada"], n["esquecido"]} & set(eventos)
    festival = eventos[n["realizado"]]
    assert (festival["inscritos"], festival["presentes"], festival["data"]) == (6, 5, "2015-06-10")  # pessoas distintas; 22h UTC = 19h de Belém
    assert eventos[n["com_presenca"]]["presentes"] == "menos de 5"  # 1 pessoa: não se publica o número
    assert dados["beneficiarios"] == {"pessoas": "menos de 5", "atendimentos": 6}  # ATENDIDAS no ano (3), não o vínculo (4)
    assert dados["voluntariado"] == {"horas": "30.5", "voluntarios": 5}
    assert dados["associados_no_fim_do_ano"] == 6
    assert dados["indicadores"] == [{"projeto": n["publico"], "indicador": "Crianças atendidas", "periodo": "2015-12", "valor": "35.00",
                                     "unidade": "crianças", "meta": "40.00"}]
    assert dados["contas"] is None and dados["apresentacao"] == "" and dados["registros_desde"] is None
    corpo = relatorio_anual.texto(dados)
    assert "Voluntariado: 30,5 horas, de 5 voluntário(s)" in corpo and "Contas do exercício: ainda não publicadas" in corpo
    assert "Relato que nunca sai" not in corpo and "Beneficiária de teste" not in corpo and "Pessoa de teste" not in corpo
    assert "(a apresentação ainda não foi escrita)" in corpo and "situação de hoje" in corpo
    # no ano em que o sistema começou, o texto diz a partir de quando os números contam
    assert relatorio_anual.montar(db, 2014)["registros_desde"] == "2014-06-01"
    assert "O sistema começou a ser usado em 01/06/2014" in relatorio_anual.texto(relatorio_anual.montar(db, 2014))


def test_a_apresentacao_e_obrigatoria_conferida_e_quem_escreve_nao_aprova(client, db, ano_com_atividades):
    preparador, aprovador = _usuario(db, "documentos"), _usuario(db, "aprovar_publicacao")
    escritor = _usuario(db, "documentos", "aprovar_publicacao")  # tem as duas permissões (como o Presidente e o 1º Secretário)
    r = client.post(f"/api/relatorios-anuais/{ANO}/preparar", headers=preparador)
    assert r.status_code == 200, r.text
    id_documento = r.json()["id_documento"]
    doc = db.get(DocumentoInstitucional, id_documento)
    assert (doc.tipo, doc.classificacao, doc.situacao, doc.publico_formato, doc.ano) == ("RELATORIO_ANUAL", "Pública", "Rascunho", "TEXTO", ANO)
    # sem apresentação, não vai para revisão
    r = client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador)
    assert r.status_code == 409 and "apresentação da diretoria" in r.json()["detail"]
    # curta demais; com dado pessoal: recusada, mascarada, nada muda
    assert client.put(f"/api/relatorios-anuais/{ANO}/apresentacao", headers=escritor, json={"apresentacao": "Curta."}).status_code == 400
    r = client.put(f"/api/relatorios-anuais/{ANO}/apresentacao", headers=escritor,
                   json={"apresentacao": APRESENTACAO + " Contato da secretária: CPF 529.982.247-25."})
    assert r.status_code == 422 and "529.982.247-25" not in r.text and r.json()["detail"]["resultado"]["bloqueios"]
    assert "A apresentação tem dado pessoal" in r.json()["detail"]["mensagem"]  # a mensagem fala da apresentação, não do parecer
    db.expire_all()
    assert json.loads(db.get(DocumentoInstitucional, id_documento).dados_publicos_json)["apresentacao"] == ""
    # recusada, nada fica na Auditoria (quem tentou não escreveu nada)
    assert db.query(AuditLog).filter(AuditLog.acao == "APRESENTACAO_ESCRITA", AuditLog.id_registro_afetado == id_documento).count() == 0
    # nem o texto nem o PDF se trocam à mão
    r = client.post(f"/api/documentos/{id_documento}/versao-publica-texto", headers=preparador, json={"texto": "Um relatório digitado à mão, com muitas letras."})
    assert r.status_code == 409 and "gerado pelo sistema" in r.json()["detail"]
    # a apresentação boa entra no texto e no JSON; a Auditoria guarda quem escreveu e o SHA-256 do que escreveu
    r = client.put(f"/api/relatorios-anuais/{ANO}/apresentacao", headers=escritor, json={"apresentacao": APRESENTACAO})
    assert r.status_code == 200, r.text
    db.expire_all()
    doc = db.get(DocumentoInstitucional, id_documento)
    assert APRESENTACAO in doc.publico_texto and json.loads(doc.dados_publicos_json)["apresentacao"] == APRESENTACAO
    registro = db.query(AuditLog).filter(AuditLog.acao == "APRESENTACAO_ESCRITA", AuditLog.id_registro_afetado == id_documento).one()
    assert json.loads(registro.dados_depois)["sha256"] and registro.id_usuario is not None
    # refazer os números no rascunho mantém a apresentação
    assert client.post(f"/api/relatorios-anuais/{ANO}/preparar", headers=preparador).json()["id_documento"] == id_documento
    db.expire_all()
    assert APRESENTACAO in db.get(DocumentoInstitucional, id_documento).publico_texto
    assert client.post(f"/api/documentos/{id_documento}/enviar-revisao", headers=preparador).status_code == 200
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=preparador).status_code == 403  # quem preparou não aprova
    # quem ESCREVEU a apresentação também não aprova (nem o painel oferece o botão)
    assert client.get(f"/api/documentos/{id_documento}", headers=escritor).json()["pode_aprovar"] is False
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=escritor).status_code == 403
    # em revisão, a apresentação não muda
    assert client.put(f"/api/relatorios-anuais/{ANO}/apresentacao", headers=preparador, json={"apresentacao": APRESENTACAO + " Outra."}).status_code == 409
    assert client.get(f"/api/documentos/{id_documento}", headers=aprovador).json()["pode_aprovar"] is True
    assert client.post(f"/api/documentos/{id_documento}/aprovar", headers=aprovador).status_code == 200
    publicados = client.get("/api/publico/transparencia/relatorios-anuais").json()
    do_ano = next(r for r in publicados if r["ano"] == ANO)
    assert do_ano["id_documento"] == id_documento and do_ano["dados"]["apresentacao"] == APRESENTACAO and "aprovado_por" in do_ano
    # versão nova: só pela tela de origem, levando a apresentação para ser revista; a publicada continua no ar
    assert client.post(f"/api/documentos/{id_documento}/nova-versao", headers=preparador).status_code == 409
    r = client.post(f"/api/relatorios-anuais/{ANO}/preparar", headers=preparador)
    v2 = r.json()["id_documento"]
    assert v2 != id_documento and r.json()["versao"] == 2
    db.expire_all()
    assert json.loads(db.get(DocumentoInstitucional, v2).dados_publicos_json)["apresentacao"] == APRESENTACAO
    assert next(r for r in client.get("/api/publico/transparencia/relatorios-anuais").json() if r["ano"] == ANO)["id_documento"] == id_documento


def test_com_as_contas_publicadas_o_relatorio_traz_os_totais_aprovados(client, auth_headers, db, exercicio_financeiro_aberto):
    from tests.test_contas_no_site import _ata_com_aprovacao, _parecer, _publicar, _receita_recebida

    ano = 2016
    _receita_recebida(client, auth_headers, 250, competencia=datetime(ano, 5, 1))
    _parecer(client, db, ano)
    _ata_com_aprovacao(client, auth_headers, ano)
    preparador, aprovador = _usuario(db, "documentos"), _usuario(db, "aprovar_publicacao")
    id_contas = client.post(f"/api/prestacoes-de-contas/{ano}/publicar-no-site", headers=preparador).json()["id_documento"]
    _publicar(client, preparador, aprovador, id_contas)
    id_relatorio = client.post(f"/api/relatorios-anuais/{ano}/preparar", headers=preparador).json()["id_documento"]
    doc = db.get(DocumentoInstitucional, id_relatorio)
    contas = json.loads(doc.dados_publicos_json)["contas"]
    assert contas["id_documento"] == id_contas and contas["total_receitas"] == "250.00" and contas["aprovadas_em_assembleia_em"]
    assert "Contas do exercício (aprovadas pela Assembleia Geral em" in doc.publico_texto and "R$ 250,00" in doc.publico_texto


def test_contagem_pequena_e_ordem_dos_periodos():
    assert relatorio_anual._protegido(0) == 0 and relatorio_anual._protegido(4) == "menos de 5" and relatorio_anual._protegido(5) == 5
    ordem = relatorio_anual._ordem_do_periodo
    assert ordem("2015-12", 2015) > ordem("2015-T3", 2015) > ordem("2015-6", 2015) > ordem("2015-S1", 2015)
    assert ordem("2015", 2015) > ordem("2015-12", 2015)  # o ano inteiro é o "último"
    assert ordem("2015-12", 2015) > ordem("2015-T4", 2015) > ordem("2015-S2", 2015)  # mesmo mês final: o mais detalhado vence
    assert ordem("2015-13", 2015) is None and ordem("jan/2015", 2015) is None and ordem("2016-01", 2015) is None


@pytest.mark.parametrize("hoje, esperado", [(datetime(2026, 1, 1, 2, 59), 2025), (datetime(2026, 1, 1, 3, 0), 2026)])
def test_o_ano_de_hoje_e_o_de_belem(monkeypatch, hoje, esperado):
    """Às 23h59 de 31/12 em Belém (02h59 UTC de 01/01) o ano ainda não acabou: o relatório desse ano ainda não pode ser montado."""

    class _Relogio(datetime):
        @classmethod
        def utcnow(cls):
            return hoje

    monkeypatch.setattr(relatorio_anual, "datetime", _Relogio)
    assert relatorio_anual._ano_de_hoje_em_belem() == esperado
    assert relatorio_anual._instantes_do_ano(2025) == (datetime(2025, 1, 1, 3), datetime(2026, 1, 1, 3))


def test_o_inicio_ficticio_da_homologacao_so_roda_no_banco_de_teste_e_uma_vez(db, monkeypatch):
    """O roteiro da homologação (v6.3c): recusa qualquer banco que não seja o de teste; no de teste, grava o início fictício uma vez só."""
    import importlib.util

    esp = importlib.util.spec_from_file_location("hml_inicio", "scripts/hml_inicio_do_sistema.py")
    roteiro = importlib.util.module_from_spec(esp)
    esp.loader.exec_module(roteiro)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@servidor/asaf?sslmode=require")
    with pytest.raises(SystemExit, match="RECUSADO"):
        roteiro.main()
    # num banco novo (como a homologação recém-criada): grava uma vez; na segunda, nada
    import sqlalchemy as sa
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401
    from app.database import Base

    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor)
    novo = sessionmaker(bind=motor)()
    assert roteiro.marcar(novo) is True and roteiro.marcar(novo) is False
    assert relatorio_anual.primeiro_ano(novo) == 2025
    novo.close()
    # no banco que já tem registro antigo (o daqui tem o de 2014): nada a fazer
    assert roteiro.marcar(db) is False
