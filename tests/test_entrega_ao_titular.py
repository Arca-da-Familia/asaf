"""v7.2c (FASE 7) - a entrega do relatório dos dados ao titular pela Minha conta (app/services/entrega_ao_titular.py):
  1. o encarregado libera o relatório conferido; a pessoa baixa o PDF e o arquivo da portabilidade pela Minha conta, com a sessão do e-mail do pedido; tudo na Auditoria;
  2. o que ela baixa é a cópia congelada na liberação, igual à conferida (o relatório que mudou depois da conferência dá 409; o anotado depois não entra);
  3. outro e-mail não baixa; vencidos os 15 dias, não baixa e a limpeza apaga a cópia (ficam as datas);
  4. a liberação exige a identidade validada, o e-mail, a ligação ao cadastro no pedido feito pelo responsável, e quem pode (o encarregado ou quem responde);
     ninguém libera o pedido sobre os próprios dados;
  5. a portabilidade leva só o que a pessoa forneceu e o que é dela no financeiro: toda tabela do relatório foi decidida;
  6. a migração 12f16313d972 cria exatamente a tabela do modelo."""
import importlib.util
import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.models.atendimento import Atendimento, EntregaAoTitular
from app.models.core import AuditLog
from app.services import entrega_ao_titular as servico
from tests.test_atendimento import _cpf_valido
from tests.test_doacao_online import emails  # noqa: F401  (a fixture `emails`)
from tests.test_identidade_do_titular import _associado, _email, _entrar_na_conta, _pedido


def _conferir(client, headers, a: Atendimento) -> dict:
    """A pré-visualização pelo número do pedido: é ela que o encarregado confere (e a impressão que volta com ela)."""
    r = client.get("/api/privacidade/titulares/relatorio", params={"id_atendimento": a.id_atendimento}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _liberar(client, headers, a: Atendimento, impressao: str | None = None):
    impressao = impressao or _conferir(client, headers, a)["impressao"]
    return client.post(f"/api/privacidade/titulares/entregas/{a.id_atendimento}", json={"impressao": impressao}, headers=headers)


def _baixar(client, token: str, a: Atendimento, formato: str = "pdf"):
    return client.get(f"/api/visitante/pedidos/{a.protocolo}/relatorio", params={"formato": formato}, headers={"Authorization": f"Bearer {token}"})


def _pedido_de_associada(client, db, subtipo="ACESSO"):
    email, cpf = _email(), _cpf_valido()
    pessoa = _associado(db, cpf, email)
    a = _pedido(client, db, subtipo=subtipo, email_contato=email, cpf=cpf)
    assert a.identidade_validada_em is not None, "o e-mail é o do cadastro: identidade validada na hora"
    return a, pessoa, email


# ------------------------------------------------------------------------------------------------ 1. liberar e baixar
def test_o_encarregado_libera_e_a_pessoa_baixa_o_pdf_e_o_arquivo_pela_minha_conta(client, db, auth_headers, emails):
    a, pessoa, email = _pedido_de_associada(client, db)
    r = _liberar(client, auth_headers, a)
    assert r.status_code == 200, r.text
    valido_ate = datetime.fromisoformat(r.json()["valido_ate"])
    assert timedelta(days=14, hours=23) < valido_ate - datetime.utcnow() <= timedelta(days=15)
    liberada = db.query(AuditLog).filter(AuditLog.acao == "RELATORIO_DO_TITULAR_LIBERADO", AuditLog.id_registro_afetado == a.id_atendimento).one()
    assert liberada.id_usuario is not None and pessoa.nome_completo not in liberada.dados_depois and '"linhas"' in liberada.dados_depois
    assert client.get(f"/api/atendimentos/{a.id_atendimento}", headers=auth_headers).json()["relatorio_liberado_ate"]

    token = _entrar_na_conta(client, emails, email)
    conta = client.get("/api/visitante/minha-conta", headers={"Authorization": f"Bearer {token}"}).json()
    [na_conta] = [p for p in conta["pedidos_do_titular"] if p["protocolo"] == a.protocolo]
    assert na_conta["relatorio_disponivel_ate"]

    pdf = _baixar(client, token, a)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and pdf.headers["content-type"] == "application/pdf"
    assert "attachment" in pdf.headers["content-disposition"] and pdf.headers["cache-control"] == "no-store"
    arquivo = _baixar(client, token, a, "json")
    assert arquivo.status_code == 200 and arquivo.headers["content-type"].startswith("application/json")
    corpo = json.loads(arquivo.content)
    assert corpo["protocolo"] == a.protocolo and corpo["titular"] == pessoa.nome_completo
    assert corpo["dados"]["pessoas"][0]["cpf"] == pessoa.cpf, "o que ela forneceu"
    assert all("resposta" not in linha for linha in corpo["dados"]["atendimentos"]), "o que a equipe escreveu não vai na portabilidade"
    baixados = db.query(AuditLog).filter(AuditLog.acao == "DOWNLOAD_RELATORIO_DO_TITULAR", AuditLog.id_registro_afetado == a.id_atendimento).all()
    assert sorted(json.loads(b.dados_depois)["formato"] for b in baixados) == ["json", "pdf"]
    assert _baixar(client, token, a, "csv").status_code == 400


# ------------------------------------------------------------------------------------------------ 2. a cópia congelada
def test_o_que_ela_baixa_e_o_que_foi_conferido_na_liberacao(client, db, auth_headers, emails):
    from app.models.pessoas import Pessoa

    a, pessoa, email = _pedido_de_associada(client, db)
    conferido = _conferir(client, auth_headers, a)
    db.get(Pessoa, pessoa.id_pessoa).telefone_whatsapp = "91900000000"
    db.commit()
    r = _liberar(client, auth_headers, a, conferido["impressao"])
    assert r.status_code == 409 and "confira de novo" in r.json()["detail"], "mudou depois de conferido: não libera o que ninguém viu"
    assert _liberar(client, auth_headers, a).status_code == 200
    db.get(Pessoa, pessoa.id_pessoa).profissao = "Anotada depois da conferência"
    db.commit()
    token = _entrar_na_conta(client, emails, email)
    corpo = json.loads(_baixar(client, token, a, "json").content)
    assert corpo["dados"]["pessoas"][0].get("profissao") != "Anotada depois da conferência"
    # liberar de novo substitui (e apaga) a anterior
    assert _liberar(client, auth_headers, a).status_code == 200
    db.expire_all()
    entregas = db.query(EntregaAoTitular).filter(EntregaAoTitular.id_atendimento == a.id_atendimento).order_by(EntregaAoTitular.id_entrega).all()
    assert [e.conteudo is None for e in entregas] == [True, False] and entregas[0].apagado_em is not None
    assert json.loads(_baixar(client, token, a, "json").content)["dados"]["pessoas"][0]["profissao"] == "Anotada depois da conferência"


# ------------------------------------------------------------------------------------------------ 3. outro e-mail; o prazo
def test_outro_e_mail_nao_baixa_e_vencido_some(client, db, auth_headers, emails):
    from app.services import retencao

    a, _, email = _pedido_de_associada(client, db)
    assert _liberar(client, auth_headers, a).status_code == 200
    outro, _, outro_email = _pedido_de_associada(client, db)
    token_de_outra = _entrar_na_conta(client, emails, outro_email)
    assert _baixar(client, token_de_outra, a).status_code == 404, "o pedido é de outro e-mail"
    assert _baixar(client, token_de_outra, outro).status_code == 404, "sem relatório liberado"
    assert client.get(f"/api/visitante/pedidos/{a.protocolo}/relatorio").status_code == 401

    token = _entrar_na_conta(client, emails, email)
    entrega = servico.vigente(db, a)
    entrega.valido_ate = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    assert _baixar(client, token, a).status_code == 404
    conta = client.get("/api/visitante/minha-conta", headers={"Authorization": f"Bearer {token}"}).json()
    assert [p["relatorio_disponivel_ate"] for p in conta["pedidos_do_titular"] if p["protocolo"] == a.protocolo] == [None]
    resultado = retencao.aplicar_todas(db)
    assert resultado["limpeza_tecnica"]["entrega_ao_titular"] >= 1 and "entrega_ao_titular" not in resultado["falhas"]
    db.refresh(entrega)
    assert entrega.conteudo is None and entrega.apagado_em is not None and entrega.liberado_em is not None, "ficam as datas"


# ------------------------------------------------------------------------------------------------ 4. quando não se libera
def test_a_liberacao_exige_identidade_e_quem_pode(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    sem_validar = _pedido(client, db, subtipo="ACESSO", email_contato=_email(), cpf=_cpf_valido())
    assert sem_validar.identidade_validada_em is None
    r = _liberar(client, auth_headers, sem_validar, "0" * 64)
    assert r.status_code == 400 and "identidade" in r.json()["detail"]

    a, _, _ = _pedido_de_associada(client, db)
    _, qualquer = _criar_associado(db, f"Sem Permissao Entrega {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    assert _liberar(client, _headers(qualquer), a, "0" * 64).status_code == 403
    assert client.post("/api/privacidade/titulares/entregas/99999999", json={"impressao": "0" * 64}, headers=auth_headers).status_code == 404
    contato = _pedido(client, db, subtipo="ACESSO", email_contato=_email())
    contato.tipo = "CONTATO"
    db.commit()
    assert _liberar(client, auth_headers, contato, "0" * 64).status_code == 400

    pelo_responsavel = _pedido(client, db, subtipo="ACESSO", email_contato=_email())
    pelo_responsavel.id_pessoa, pelo_responsavel.por_representante, pelo_responsavel.identidade_validada_em = None, True, datetime.utcnow()
    db.commit()
    r = _liberar(client, auth_headers, pelo_responsavel, "0" * 64)
    assert r.status_code == 400 and "responsável" in r.json()["detail"], "o e-mail é de quem pediu, não do titular"
    # quem não pode recebe 403 antes de saber qualquer coisa do pedido (nem que foi feito pelo responsável)
    previa = client.get("/api/privacidade/titulares/relatorio", params={"id_atendimento": pelo_responsavel.id_atendimento}, headers=_headers(qualquer))
    assert previa.status_code == 403

    for subtipo in ("ELIMINACAO", "CORRECAO", "OPOSICAO"):
        outro, _, _ = _pedido_de_associada(client, db, subtipo=subtipo)
        r = _liberar(client, auth_headers, outro, "0" * 64)
        assert r.status_code == 400 and "não se responde com o relatório" in r.json()["detail"], subtipo
    encerrado, _, _ = _pedido_de_associada(client, db)
    encerrado.status = "Encerrado"
    db.commit()
    assert _liberar(client, auth_headers, encerrado, "0" * 64).status_code == 400


def test_ninguem_libera_o_pedido_sobre_os_proprios_dados(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    presidente, usuario_do_presidente = _criar_associado(db, f"Presidente Entrega {uuid.uuid4().hex[:6]}", nome_nivel="Presidente")
    a, _, _ = _pedido_de_associada(client, db)
    a.id_pessoa = presidente.id_pessoa
    db.commit()
    r = _liberar(client, _headers(usuario_do_presidente), a, "0" * 64)
    assert r.status_code == 403 and "próprios dados" in r.json()["detail"]
    assert _liberar(client, auth_headers, a).status_code == 200, "outra pessoa da equipe libera"


# ------------------------------------------------------------------------------------------------ 5. a portabilidade
def test_toda_tabela_do_relatorio_foi_decidida_para_a_portabilidade():
    import app.models  # noqa: F401
    from app.database import Base
    from app.services import relatorio_do_titular as rt

    assert not servico.PORTAVEIS & servico.NAO_PORTAVEIS
    do_relatorio = {t for t, _ in rt.LIGACOES_DA_PESSOA} | {
        "pessoas", "associados", "usuarios", "beneficiarios", "beneficiarios_projeto", "inscricoes", "atendimentos", "propostas_filiacao", "intencoes_de_doacao",
        "doacoes", "processos_disciplinares", "termos_adesao_voluntario", "alocacoes_voluntarios", "avisos_destinatarios", "fornecedores", "valores_campo",
    }
    decididas = servico.PORTAVEIS | servico.NAO_PORTAVEIS
    assert do_relatorio - decididas == set(), "tabela do relatório sem decisão de portabilidade (entrega_ao_titular.py)"
    assert decididas - do_relatorio == set(), "decisão sobre tabela que não está no relatório"
    for tabela, colunas in servico.COLUNAS_DA_EQUIPE.items():
        assert tabela in servico.PORTAVEIS and colunas <= set(Base.metadata.tables[tabela].columns.keys())


def test_o_pdf_diz_a_data_de_nascimento_no_dia_certo_e_a_hora_em_belem():
    assert servico._em_palavras("1990-03-04T00:00:00") == "04/03/1990"
    assert servico._em_palavras("1990-03-04") == "04/03/1990"
    assert servico._em_palavras("2026-10-29T15:00:00") == "29/10/2026 às 12:00"
    assert servico._em_palavras(True) == "Sim" and servico._em_palavras(12) == "12"
    assert servico._rotulo("id_projeto") == "Projeto" and servico._rotulo("data_nascimento") == "Data nascimento"


# ------------------------------------------------------------------------------------------------ 6. a migração
_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "12f16313d972_v7_2c_entrega_ao_titular.py"


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_entrega_ao_titular", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def test_a_migracao_cria_exatamente_a_tabela_do_modelo_e_desfaz():
    import app.models  # noqa: F401
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from app.database import Base

    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "entregas_ao_titular"])
    migracao = _carregar()
    with motor.begin() as conexao, Operations.context(MigrationContext.configure(conexao)):
        migracao.upgrade()
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_ela = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "entregas_ao_titular" in repr(d)]
    assert sobre_ela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_ela)
    with motor.begin() as conexao, Operations.context(MigrationContext.configure(conexao)):
        migracao.downgrade()
    assert "entregas_ao_titular" not in sa.inspect(motor).get_table_names()

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert len(diretorio.get_heads()) == 1, diretorio.get_heads()
    assert diretorio.get_revision("12f16313d972").down_revision == "b0227d30a6a9"


# ------------------------------------------------------------------------------------------------ 7. o painel confere pelo pedido o mesmo que será liberado
def test_o_relatorio_pelo_numero_do_pedido_e_o_da_entrega(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    sem_cadastro = _pedido(client, db, subtipo="ACESSO", email_contato=_email())
    assert sem_cadastro.id_pessoa is None
    r = client.get("/api/privacidade/titulares/relatorio", params={"id_atendimento": sem_cadastro.id_atendimento}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert [linha["numero"] for linha in next(s for s in r.json()["secoes"] if s["tabela"] == "atendimentos")["linhas"]] == [sem_cadastro.id_atendimento]
    _, qualquer = _criar_associado(db, f"Sem Permissao Pedido {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    for numero in (sem_cadastro.id_atendimento, 99999999):
        assert client.get("/api/privacidade/titulares/relatorio", params={"id_atendimento": numero}, headers=_headers(qualquer)).status_code == 403
        assert client.post(f"/api/privacidade/titulares/entregas/{numero}", json={"impressao": "0" * 64}, headers=_headers(qualquer)).status_code == 403
    assert client.get("/api/privacidade/titulares/relatorio", params={"id_atendimento": 99999999}, headers=auth_headers).status_code == 404


# ------------------------------------------------------------------------------------------------ 8. a revisão da v7.2c
def test_identidade_provada_so_pelo_codigo_do_e_mail_nao_entrega_o_cadastro_ligado(client, db, auth_headers):
    """O e-mail "plantado" no cadastro de quem não é associado (a deduplicação por CPF numa inscrição) não abre o relatório do cadastro: com a identidade
    provada só pelo código, o relatório traz só o que foi feito com aquele e-mail."""
    from app.models.atendimento import IDENTIDADE_CODIGO_NO_EMAIL
    from app.models.pessoas import Pessoa

    email = _email()
    vitima = Pessoa(nome_completo=f"Vitima Do Email Plantado {uuid.uuid4().hex[:6]}", cpf=_cpf_valido(), email_contato=email)
    db.add(vitima)
    db.commit()
    a = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="TITULAR_LGPD", subtipo="ACESSO", mensagem="Quero meus dados.", nome_completo="Quem Pediu",
                    email_contato=email, id_pessoa=vitima.id_pessoa, status="Novo", prazo_dias=15, prazo_em=datetime.utcnow() + timedelta(days=15),
                    identidade_validacao=IDENTIDADE_CODIGO_NO_EMAIL, identidade_validada_em=datetime.utcnow())
    db.add(a)
    db.commit()
    previa = _conferir(client, auth_headers, a)
    assert previa["pessoa"] is None and all(s["tabela"] != "pessoas" for s in previa["secoes"]), "o cadastro da vítima não entra"
    assert [s["tabela"] for s in previa["secoes"]] == ["atendimentos"]
    assert _liberar(client, auth_headers, a).status_code == 200
    db.expire_all()
    assert vitima.nome_completo not in servico.vigente(db, a).conteudo


def test_o_e_mail_da_familia_nao_traz_o_pedido_do_irmao(client, db, auth_headers):
    from app.models.pessoas import Pessoa

    email = _email()
    irma, irmao = Pessoa(nome_completo="Irma Do Email", cpf=_cpf_valido(), email_contato=email), Pessoa(nome_completo="Irmao Do Email", cpf=_cpf_valido())
    db.add_all([irma, irmao])
    db.commit()
    do_irmao = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="CONTATO", mensagem="Pedido do irmão.", nome_completo="Irmao Do Email", email_contato=email,
                           id_pessoa=irmao.id_pessoa, status="Novo", prazo_dias=10, prazo_em=datetime.utcnow() + timedelta(days=10))
    sem_cadastro = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="CONTATO", mensagem="Pedido sem cadastro.", nome_completo="Irma Do Email",
                               email_contato=email.upper(), status="Novo", prazo_dias=10, prazo_em=datetime.utcnow() + timedelta(days=10))
    db.add_all([do_irmao, sem_cadastro])
    db.commit()
    r = client.get("/api/privacidade/titulares/relatorio", params={"id_pessoa": irma.id_pessoa}, headers=auth_headers).json()
    numeros = [linha["numero"] for s in r["secoes"] if s["tabela"] == "atendimentos" for linha in s["linhas"]]
    assert do_irmao.id_atendimento not in numeros, "a linha é de outra pessoa do cadastro"
    assert sem_cadastro.id_atendimento in numeros, "sem cadastro na linha, o e-mail dela basta"


def test_o_e_mail_do_pedido_com_maiusculas_baixa_e_a_eliminacao_apaga_a_copia(client, db, auth_headers, emails):
    a, pessoa, email = _pedido_de_associada(client, db)
    a.email_contato = email.upper()
    db.commit()
    assert _liberar(client, auth_headers, a).status_code == 200
    token = _entrar_na_conta(client, emails, email)
    assert _baixar(client, token, a).status_code == 200
    assert servico.apagar_da_pessoa(db, pessoa.id_pessoa) == 1
    db.commit()
    assert _baixar(client, token, a).status_code == 404, "eliminado: a cópia some antes dos 15 dias"


def test_as_eliminacoes_apagam_a_copia_entregue():
    """A anonimização do associado e a eliminação do prontuário chamam a limpeza da cópia (o teste de cada eliminação está no seu arquivo)."""
    raiz = Path(__file__).resolve().parent.parent / "app" / "services"
    for arquivo in ("anonimizacao.py", "beneficiarios.py"):
        assert "entrega_ao_titular.apagar_da_pessoa(" in (raiz / arquivo).read_text(encoding="utf-8"), arquivo


def test_ninguem_libera_o_proprio_relatorio_nem_sem_ligacao_ao_cadastro(client, db, auth_headers):
    from app.models.core import Usuario
    from tests.test_conselho_fiscal import _headers

    admin = db.query(Usuario).filter(Usuario.id_usuario == 1).one()
    a = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="TITULAR_LGPD", subtipo="ACESSO", mensagem="Quero meus dados.", nome_completo="Eu Mesmo",
                    email_contato=admin.email.upper(), status="Novo", prazo_dias=15, prazo_em=datetime.utcnow() + timedelta(days=15),
                    identidade_validacao="MANUAL", identidade_validada_em=datetime.utcnow())
    db.add(a)
    db.commit()
    r = _liberar(client, _headers(admin), a, "0" * 64)
    assert r.status_code == 403 and "próprios dados" in r.json()["detail"]


def test_o_texto_que_parece_data_e_a_palavra_enorme_nao_quebram_o_pdf():
    from app.services import pdf_de_texto

    assert servico._em_palavras("2026-02-30") == "2026-02-30"
    assert servico._em_palavras("2026-10-29T10:00 reunião") == "2026-10-29T10:00 reunião"
    linhas = pdf_de_texto._quebrar("x" * 600, 400, "Helvetica", 9)
    assert len(linhas) > 1 and "".join(linhas) == "x" * 600, "a palavra enorme vira várias linhas, sem perder nada"
    assert pdf_de_texto.gerar("t", ["linha com \r\nquebra do Windows"], "rodapé").startswith(b"%PDF")
