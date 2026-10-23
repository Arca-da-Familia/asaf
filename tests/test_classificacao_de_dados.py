"""v7.0b (FASE 7) - a classificação dos dados por sensibilidade, no próprio modelo (ver app/classificacao_de_dados.py).

  1. coluna cujo nome indica dado de pessoa não passa sem classificação; o que o mapa cita existe no modelo; a classificação está escrita no `info` do modelo;
  2. os titulares saem das chaves estrangeiras (e do que o mapa acrescenta); o inventário lido do modelo traz cada tabela com dado de pessoa;
  3. a Auditoria não grava o valor de coluna sensível nem o de coluna pessoal de tabela que pode ter dado de criança; a licença não grava o motivo;
  4. toda coluna sensível tem a leitura auditada, e cada rota de leitura grava a ação declarada (prontuário, encaminhamentos, histórico de situação);
  5. a anonimização do desligado cobre toda coluna pessoal da pessoa (as habilidades e o motivo das mudanças de situação passaram a ser apagados);
  6. achados da conferência independente: o motivo da licença e do desligamento saiu da linha do tempo (que a ficha 360 mostra sem auditar) e das linhas já
     gravadas (migração 6f679ca3b6bd); os campos personalizados e a mesclagem não gravam valor nem nome na Auditoria; tabela central de pessoa tem TODA coluna
     classificada; a marca de criança é derivada pelas chaves estrangeiras."""
import json
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import app.models  # noqa: F401
from app import classificacao_de_dados as cl
from app.auditoria import registrar_auditoria
from app.database import Base
from app.models.associados import Associado
from app.models.core import AuditLog
from app.models.pessoas import Pessoa
from app.services import anonimizacao
from tests.test_beneficiarios import _associado_do_token, _criar_beneficiario, _criar_projeto, _vincular
from tests.test_situacao import _criar_associado

_RAIZ = Path(__file__).resolve().parent.parent


def _candidatas(tabela):
    """As colunas que o detector exige classificar: nome de dado de pessoa, sem ser chave (primária ou estrangeira) nem `id_*`."""
    return [c for c in tabela.columns if cl.DETECTOR.search(c.name) and not c.name.startswith("id_") and not c.foreign_keys and not c.primary_key]


# ------------------------------------------------------------------------------------------------ 1. nada sem classificação
def test_toda_coluna_com_nome_de_dado_de_pessoa_esta_classificada():
    faltando = [f"{nome}.{c.name}" for nome, t in sorted(Base.metadata.tables.items()) for c in _candidatas(t) if cl.coluna(nome, c.name) is None]
    assert faltando == [], "classifique em app/classificacao_de_dados.py (pessoal, sensível ou NAO_PESSOAIS): " + ", ".join(faltando)


def test_toda_coluna_das_tabelas_centrais_de_crianca_e_de_dado_sensivel_esta_classificada():
    """Na tabela que É a pessoa (ou o pedido dela), na que pode ter criança e na que tem dado sensível, o nome da coluna não basta: `possui_deficiencia` ou
    `tipo_sanguineo` passariam pelo detector de nomes."""
    tabelas = set(cl.TITULAR_POR_CHAVE) | {
        nome for nome, entrada in cl.CLASSIFICACAO.items() if entrada.criancas or any(c.categoria == cl.SENSIVEL for c in entrada.colunas.values())
    }
    assert {"registros_atendimento", "encaminhamentos_rede_externa", "mudancas_situacao", "valores_campo", "dependentes_familiares"} <= tabelas
    faltando = [
        f"{nome}.{c.name}" for nome in sorted(tabelas) for c in Base.metadata.tables[nome].columns
        if not (c.primary_key or c.foreign_keys or c.name.startswith("id_")) and cl.coluna(nome, c.name) is None
    ]
    assert faltando == [], ", ".join(faltando)


def test_o_detector_pega_os_nomes_de_dado_sensivel():
    for nome in ("possui_deficiencia", "tipo_sanguineo", "religiao", "raca_cor", "condicao_saude", "alergias", "medicamentos", "genero", "orientacao_sexual",
                 "filiacao_sindical", "biometria_facial", "digital", "rg", "nis", "renda_familiar", "responsavel_legal", "escola", "emails", "laudo"):
        assert cl.DETECTOR.search(nome), nome


def test_o_detector_pega_o_que_deve_e_nao_pega_chave():
    for nome in ("nome_completo", "email_contato", "cpf", "ip_origem", "motivo", "data_nascimento", "observacao", "habilidades"):
        assert cl.DETECTOR.search(nome), nome
    for nome in ("criado_em", "valor", "status", "quantidade", "nomeacao"):
        assert not cl.DETECTOR.search(nome), nome


def test_tudo_que_o_mapa_cita_existe_no_modelo_e_nada_esta_nos_dois_lados():
    tabelas = Base.metadata.tables
    inexistentes = []
    for nome, entrada in cl.CLASSIFICACAO.items():
        if nome not in tabelas:
            inexistentes.append(nome)
            continue
        inexistentes += [f"{nome}.{c}" for c in entrada.colunas if c not in tabelas[nome].c]
    for nome, colunas in cl.NAO_PESSOAIS.items():
        if nome not in tabelas:
            inexistentes.append(nome)
            continue
        inexistentes += [f"{nome}.{c}" for c in colunas if c not in tabelas[nome].c]
        repetidas = set(colunas) & set(cl.CLASSIFICACAO.get(nome, cl.Tabela()).colunas)
        assert not repetidas, f"{nome}: {repetidas} está como pessoal e como não pessoal"
    assert inexistentes == [], "o mapa cita o que não existe mais no modelo: " + ", ".join(inexistentes)


def test_a_classificacao_esta_escrita_no_proprio_modelo():
    pessoas = Base.metadata.tables["pessoas"]
    assert pessoas.c.cpf.info["lgpd"] == cl.PESSOAL and pessoas.info["lgpd_criancas"] is True
    relato = Base.metadata.tables["registros_atendimento"].c.relato
    assert relato.info["lgpd"] == cl.SENSIVEL and relato.info["lgpd_leitura_auditada"] == cl.CONSULTA_PRONTUARIO
    assert Base.metadata.tables["associados"].c.observacoes_gerenciais.info["lgpd_pode_conter_sensivel"] is True
    assert Base.metadata.tables["espacos"].c.nome.info["lgpd"] == cl.NAO_PESSOAL
    assert Base.metadata.tables["titulos_financeiros"].info["lgpd_criancas"] is False
    # derivada: a linha do tempo e a presença apontam para a pessoa (que pode ser criança); o associado (16+, Estatuto art. 12) e a Diretoria não
    tabelas = Base.metadata.tables
    assert tabelas["eventos_linha_do_tempo"].info["lgpd_criancas"] and tabelas["registros_presenca"].info["lgpd_criancas"]
    assert tabelas["respostas_pesquisa_satisfacao"].info["lgpd_criancas"], "aponta para a inscrição, que pode ser de família"
    assert not tabelas["associados"].info["lgpd_criancas"] and not tabelas["fotos_da_diretoria"].info["lgpd_criancas"]
    assert tabelas["propostas_de_socios"].info["lgpd_criancas"], "o comentário do sócio é sobre o candidato, que pode ter 16 ou 17 anos"
    inventario = {linha["tabela"]: linha for linha in cl.inventario_do_modelo()}
    assert inventario["associados"]["pode_ter_crianca"], "o associado pode ter 16 ou 17 anos: o inventário diz, mesmo sem a máscara na Auditoria"


# ------------------------------------------------------------------------------------------------ 2. titulares e inventário
def test_os_titulares_saem_das_chaves_e_do_mapa():
    presenca = Base.metadata.tables["registros_presenca"].info["lgpd_titulares"]
    assert cl.PESSOA in presenca and cl.USUARIO in presenca, "quem esteve presente e quem registrou"
    assert cl.VISITANTE in Base.metadata.tables["codigos_de_visitante"].info["lgpd_titulares"], "sem chave estrangeira: vem do mapa"
    assert Base.metadata.tables["catalogos"].info["lgpd_titulares"] == ()


def test_o_inventario_lido_do_modelo_traz_toda_tabela_com_dado_de_pessoa():
    inventario = {linha["tabela"]: linha for linha in cl.inventario_do_modelo()}
    pessoas = inventario["pessoas"]
    assert pessoas["pode_ter_crianca"] and "cpf" in pessoas["colunas_pessoais"] and "habilidades" in pessoas["colunas_pessoais"]
    assert inventario["registros_atendimento"]["colunas_sensiveis"] == ["relato"]
    assert inventario["registros_atendimento"]["leitura_auditada"] == [cl.CONSULTA_PRONTUARIO]
    assert "mensagem" in inventario["atendimentos"]["texto_livre_que_pode_ter_sensivel"]
    for nome, tabela in Base.metadata.tables.items():
        tem_pessoa = any(fk.column.table.name in cl.TITULAR_POR_CHAVE for c in tabela.columns for fk in c.foreign_keys)
        tem_pessoa = tem_pessoa or any(cl.coluna(nome, c.name) and cl.coluna(nome, c.name).categoria != cl.NAO_PESSOAL for c in tabela.columns)
        assert (nome in inventario) == tem_pessoa, nome
    assert "catalogos" not in inventario and "plano_de_contas" not in inventario


# ------------------------------------------------------------------------------------------------ 3. a Auditoria sem o valor sensível ou de criança
def _ultima(db, tabela: str, acao: str) -> AuditLog:
    db.expire_all()
    return db.query(AuditLog).filter(AuditLog.tabela_afetada == tabela, AuditLog.acao == acao).order_by(AuditLog.id_log.desc()).first()


def test_a_auditoria_nao_grava_valor_sensivel_nem_de_crianca(db):
    acao = f"TESTE_{uuid.uuid4().hex[:6]}"
    registrar_auditoria(db, None, "registros_atendimento", acao, dados_depois={"relato": "febre e tosse há três dias", "id_vinculo": 7})
    depois = json.loads(_ultima(db, "registros_atendimento", acao).dados_depois)
    assert depois == {"relato": cl.MASCARA_SENSIVEL, "id_vinculo": 7}, "a chave fica, o valor não"
    registrar_auditoria(db, None, "dependentes_familiares", acao, dados_antes={"grau_parentesco": "FILHO"}, dados_depois={"grau_parentesco": None})
    entrada = _ultima(db, "dependentes_familiares", acao)
    assert json.loads(entrada.dados_antes) == {"grau_parentesco": cl.MASCARA_CRIANCA} and json.loads(entrada.dados_depois) == {"grau_parentesco": None}
    registrar_auditoria(db, None, "usuarios", acao, dados_depois={"email": "adulto@exemplo.org"})
    assert json.loads(_ultima(db, "usuarios", acao).dados_depois) == {"email": "adulto@exemplo.org"}, "pessoal de adulto continua (o que mudou)"
    registrar_auditoria(db, None, "eventos_linha_do_tempo", acao, dados_depois={"descricao": "Inscrição da filha"})
    assert json.loads(_ultima(db, "eventos_linha_do_tempo", acao).dados_depois) == {"descricao": cl.MASCARA_CRIANCA}, "marca derivada também esconde"
    registrar_auditoria(db, None, "registros_atendimento", acao, dados_depois="texto solto")
    assert _ultima(db, "registros_atendimento", acao).dados_depois == "texto solto"


def test_a_licenca_nao_grava_o_motivo_na_auditoria(client, auth_headers, db):
    associado = _criar_associado(client)
    r = client.post(
        f"/api/associados/{associado['id_associado']}/licenca", headers=auth_headers,
        json={"motivo": "SAUDE", "data_inicio": str(date.today()), "data_fim_prevista": str(date.today() + timedelta(days=30))},
    )
    assert r.status_code == 200, r.text
    entrada = _ultima(db, "associados", "LICENCA_REGISTRADA")
    assert entrada.id_registro_afetado == associado["id_associado"] and "SAUDE" not in (entrada.dados_depois or "") and "motivo" not in json.loads(entrada.dados_depois)


# ------------------------------------------------------------------------------------------------ 4. a leitura do que é sensível vai para a Auditoria
def test_toda_coluna_sensivel_tem_a_leitura_auditada_e_a_acao_existe_no_codigo():
    codigo = "\n".join(p.read_text(encoding="utf-8") for p in (_RAIZ / "app").rglob("*.py"))
    acoes = set()
    for nome, entrada in cl.CLASSIFICACAO.items():
        for coluna, c in entrada.colunas.items():
            if c.categoria == cl.SENSIVEL:
                assert c.leitura_auditada, f"{nome}.{coluna}: sensível sem leitura auditada"
                acoes.add(c.leitura_auditada)
    for acao in acoes:
        assert re.search(rf'registrar_auditoria\([^)]*"{acao}"', codigo, re.S), f"nenhuma rota grava {acao}"
    # cada ação tem o seu teste de rota abaixo (ou em tests/test_beneficiarios.py, o do prontuário)
    assert acoes == {cl.CONSULTA_PRONTUARIO, cl.CONSULTA_ENCAMINHAMENTOS, cl.CONSULTA_HISTORICO_SITUACAO}


def test_ler_os_encaminhamentos_vai_para_a_auditoria(client, auth_headers, db):
    id_projeto = _criar_projeto(client, auth_headers)
    id_vinculo = _vincular(client, auth_headers, _criar_beneficiario(client, auth_headers), id_projeto)
    client.post(f"/api/projetos/{id_projeto}/equipe", json={"id_associado": _associado_do_token(db, auth_headers).id_associado, "papel": "COORDENADOR"}, headers=auth_headers)
    r = client.post(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", json={"tipo_rede": "POSTO_DE_SAUDE", "descricao": "Encaminhada para avaliação."}, headers=auth_headers)
    assert r.status_code == 200, r.text
    criado = _ultima(db, "encaminhamentos_rede_externa", "CREATE")
    assert json.loads(criado.dados_depois)["tipo_rede"] == cl.MASCARA_SENSIVEL, "a rede (posto de saúde) não fica na Auditoria"
    assert client.get(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", headers=auth_headers).status_code == 200
    leitura = _ultima(db, "encaminhamentos_rede_externa", cl.CONSULTA_ENCAMINHAMENTOS)
    assert leitura is not None and leitura.id_registro_afetado == id_vinculo and leitura.id_usuario is not None


def test_ler_o_historico_de_situacao_vai_para_a_auditoria(client, auth_headers, db):
    associado = _criar_associado(client)
    assert client.get(f"/api/associados/{associado['id_associado']}/historico-situacao", headers=auth_headers).status_code == 200
    leitura = _ultima(db, "mudancas_situacao", cl.CONSULTA_HISTORICO_SITUACAO)
    assert leitura is not None and leitura.id_registro_afetado == associado["id_associado"] and leitura.id_usuario is not None


# ------------------------------------------------------------------------------------------------ 5. a anonimização cobre toda coluna pessoal da pessoa
def test_a_anonimizacao_cobre_toda_coluna_pessoal_da_pessoa():
    pessoais = {c.name for c in Base.metadata.tables["pessoas"].columns if c.info.get("lgpd") in (cl.PESSOAL, cl.SENSIVEL)}
    cobertas = set(anonimizacao.CAMPOS_ANONIMIZAVEIS) | set(anonimizacao.MANTIDOS_NA_ANONIMIZACAO)
    assert pessoais == cobertas, f"sem destino na anonimização: {pessoais - cobertas}; citado sem ser pessoal: {cobertas - pessoais}"
    assert not set(anonimizacao.CAMPOS_ANONIMIZAVEIS) & set(anonimizacao.MANTIDOS_NA_ANONIMIZACAO)


def test_a_anonimizacao_apaga_as_habilidades(db):
    pessoa = Pessoa(nome_completo=f"Desligada Com Habilidade {uuid.uuid4().hex[:6]}", cpf=str(uuid.uuid4().int)[:11], habilidades="PRIMEIROS_SOCORROS,MOTORISTA")
    db.add(pessoa)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, status_arrolamento="Desligado", data_desligamento=datetime.utcnow() - timedelta(days=4000))
    db.add(associado)
    db.commit()
    assert anonimizacao.anonimizar_associado(db, associado, dias=1825) is True
    db.refresh(pessoa)
    assert pessoa.habilidades is None and pessoa.cpf is None and pessoa.nome_completo.startswith("Desligada Com Habilidade")


# ------------------------------------------------------------------------------------------------ 6. achados da conferência independente
def test_desligamento_e_licenca_sem_o_motivo_na_auditoria_e_na_linha_do_tempo(client, auth_headers, db):
    from app.models.linha_do_tempo import EventoLinhaDoTempo

    associado = _criar_associado(client)
    id_associado = associado["id_associado"]
    hoje = date.today()
    assert client.post(f"/api/associados/{id_associado}/licenca", headers=auth_headers, json={
        "motivo": "SAUDE", "data_inicio": str(hoje), "data_fim_prevista": str(hoje + timedelta(days=30)),
    }).status_code == 200
    assert client.post(f"/api/associados/{id_associado}/desligar", headers=auth_headers, json={
        "motivo": "PEDIDO_VOLUNTARIO", "data_efetiva": str(hoje),
    }).status_code == 200
    desligado = _ultima(db, "associados", "DESLIGADO")
    assert desligado.id_registro_afetado == id_associado and "motivo" not in json.loads(desligado.dados_depois)
    id_pessoa = db.get(Associado, id_associado).id_pessoa
    linhas = db.query(EventoLinhaDoTempo).filter(EventoLinhaDoTempo.id_pessoa == id_pessoa, EventoLinhaDoTempo.modulo_origem == "situacao").all()
    assert {linha.tipo for linha in linhas} >= {"LICENCA_REGISTRADA", "DESLIGAMENTO"}
    assert all("SAUDE" not in (linha.descricao or "") and "Motivo" not in (linha.descricao or "") for linha in linhas)
    historico = client.get(f"/api/associados/{id_associado}/historico-situacao", headers=auth_headers).json()
    assert {h["motivo"] for h in historico} >= {"SAUDE", "PEDIDO_VOLUNTARIO"}, "o motivo continua no histórico, de leitura auditada"


def test_a_anonimizacao_apaga_o_motivo_das_mudancas_de_situacao(db):
    from app.models.situacao import MudancaSituacao

    pessoa = Pessoa(nome_completo=f"Desligada Com Licenca {uuid.uuid4().hex[:6]}", cpf=str(uuid.uuid4().int)[:11])
    db.add(pessoa)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, status_arrolamento="Desligado", data_desligamento=datetime.utcnow() - timedelta(days=4000))
    db.add(associado)
    db.flush()
    db.add(MudancaSituacao(id_associado=associado.id_associado, tipo="LICENCA", motivo="SAUDE", data_efetiva=datetime.utcnow() - timedelta(days=4100)))
    db.commit()
    assert anonimizacao.anonimizar_associado(db, associado, dias=1825) is True
    db.expire_all()
    mudanca = db.query(MudancaSituacao).filter(MudancaSituacao.id_associado == associado.id_associado).one()
    assert mudanca.motivo is None and mudanca.tipo == "LICENCA", "fica o tipo e a data (o livro de associados), sai o motivo"
    assert anonimizacao.anonimizar_associado(db, associado, dias=1825) is False, "rodar de novo não faz nada"


def test_campos_personalizados_vao_para_a_auditoria_sem_os_valores(client, auth_headers, db):
    definicao = client.post("/api/campos-personalizados/", headers=auth_headers, json={
        "entidade": "beneficiario", "rotulo": f"Alergias {uuid.uuid4().hex[:6]}", "tipo": "texto",
    }).json()
    r = client.put("/api/campos-personalizados/beneficiario/4242/valores", headers=auth_headers, json={
        "valores": [{"id_definicao": definicao["id_definicao"], "valor": "alergia a penicilina"}],
    })
    assert r.status_code == 200, r.text
    entrada = _ultima(db, "valores_campo", "UPDATE")
    assert "penicilina" not in entrada.dados_depois and json.loads(entrada.dados_depois)["campos"] == [definicao["id_definicao"]]


def test_a_mesclagem_nao_grava_o_nome_na_auditoria(client, auth_headers, db):
    titular = _criar_associado(client)
    id_pessoa_titular = db.get(Associado, titular["id_associado"]).id_pessoa
    nome = f"Duplicada Mesclar {uuid.uuid4().hex[:6]}"
    mantida = client.post(f"/api/pessoas/{id_pessoa_titular}/dependentes", headers=auth_headers, json={
        "nome_completo": nome, "data_nascimento": "2015-07-07", "grau_parentesco": "OUTRO",
    }).json()["id_pessoa_vinculada"]
    absorvida = Pessoa(nome_completo=f"Absorvida {uuid.uuid4().hex[:6]}")
    db.add(absorvida)
    db.commit()
    id_absorvida, nome_absorvida = absorvida.id_pessoa, absorvida.nome_completo  # a absorvida é apagada pela mesclagem
    r = client.post(f"/api/pessoas/{mantida}/mesclar", headers=auth_headers, json={"id_pessoa_absorvida": id_absorvida, "nome_confirmacao": nome_absorvida})
    assert r.status_code == 200, r.text
    entrada = _ultima(db, "pessoas", "MESCLADO")
    assert nome_absorvida not in entrada.dados_depois and json.loads(entrada.dados_depois)["id_pessoa_absorvida"] == id_absorvida


def test_a_migracao_tira_o_motivo_das_linhas_do_tempo_ja_gravadas():
    import importlib.util

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    caminho = _RAIZ / "alembic" / "versions" / "6f679ca3b6bd_v7_0b_motivo_fora_da_linha_do_tempo.py"
    especificacao = importlib.util.spec_from_file_location("migracao_motivo", caminho)
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    assert migracao.sem_motivo("Motivo: SAUDE. Retorno previsto em 2026-11-20.") == "Retorno previsto em 2026-11-20."
    assert migracao.sem_motivo("Motivo: PEDIDO_VOLUNTARIO.") is None
    assert migracao.sem_motivo("Retorno previsto em 2026-11-20.") == "Retorno previsto em 2026-11-20."

    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[Base.metadata.tables[t] for t in ("pessoas", "eventos_linha_do_tempo")])
    linhas = Base.metadata.tables["eventos_linha_do_tempo"]
    with motor.begin() as c:
        c.execute(sa.insert(Base.metadata.tables["pessoas"]), {"id_pessoa": 1, "nome_completo": "X"})
        for i, (tipo, modulo, texto) in enumerate((
            ("LICENCA_REGISTRADA", "situacao", "Motivo: SAUDE. Retorno previsto em 2026-11-20."), ("DESLIGAMENTO", "situacao", "Motivo: FALECIMENTO."),
            ("READMISSAO", "situacao", "Motivo: algo que não é deste tipo"), ("LICENCA_REGISTRADA", "outro", "Motivo: SAUDE."),
        ), start=1):
            c.execute(sa.insert(linhas), {"id_evento": i, "id_pessoa": 1, "modulo_origem": modulo, "tipo": tipo, "titulo": "t", "descricao": texto,
                                          "data_evento": datetime(2026, 1, 1)})
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            migracao.upgrade()
    with motor.connect() as c:
        depois = dict(c.execute(sa.select(linhas.c.id_evento, linhas.c.descricao)).all())
    assert depois == {1: "Retorno previsto em 2026-11-20.", 2: None, 3: "Motivo: algo que não é deste tipo", 4: "Motivo: SAUDE."}


def test_o_andamento_continua_visivel_na_auditoria_mesmo_em_tabela_de_crianca(db):
    """O consentimento do responsável registrado e a situação da inscrição são a PROVA do que mudou: não se escondem (achado da reconferência)."""
    acao = f"TESTE_{uuid.uuid4().hex[:6]}"
    registrar_auditoria(db, None, "beneficiarios", acao, dados_depois={"consentimento_lgpd_registrado": True, "observacao_consentimento": "mãe autorizou"})
    assert json.loads(_ultima(db, "beneficiarios", acao).dados_depois) == {"consentimento_lgpd_registrado": True, "observacao_consentimento": cl.MASCARA_CRIANCA}
    registrar_auditoria(db, None, "inscricoes", acao, dados_antes={"status": "Confirmada"}, dados_depois={"status": "Cancelada"})
    assert json.loads(_ultima(db, "inscricoes", acao).dados_depois) == {"status": "Cancelada"}


def test_a_anonimizacao_apaga_o_documento_de_referencia_da_mudanca_de_situacao(db):
    from app.models.situacao import MudancaSituacao

    pessoa = Pessoa(nome_completo=f"Desligada Com Atestado {uuid.uuid4().hex[:6]}")
    db.add(pessoa)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, status_arrolamento="Desligado", data_desligamento=datetime.utcnow() - timedelta(days=4000))
    db.add(associado)
    db.flush()
    db.add(MudancaSituacao(id_associado=associado.id_associado, tipo="LICENCA", documento_referencia="Atestado médico CRM 123",
                           data_efetiva=datetime.utcnow() - timedelta(days=4100)))
    db.commit()
    assert anonimizacao.anonimizar_associado(db, associado, dias=1825) is True
    db.expire_all()
    assert db.query(MudancaSituacao).filter(MudancaSituacao.id_associado == associado.id_associado).one().documento_referencia is None
