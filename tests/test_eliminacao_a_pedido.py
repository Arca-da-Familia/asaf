"""v7.2d (FASE 7) - a eliminação a pedido do titular (app/services/eliminacao_a_pedido.py), decisões do Presidente de 2026-10-28 (4 a 7) e de 2026-10-29 (A a G):
  1. associado DESLIGADO: o cadastro é anonimizado na hora (ficam nome e matrícula), os pedidos antigos pelo site perdem o texto, a intenção de doação sem recibo sai,
     a conta do painel perde o e-mail; tudo na Auditoria com o protocolo, sem os valores;
  2. associado ATIVO (vínculo vivo): o cadastro fica, com o motivo; sai o resto; o resultado sugerido é "em parte" com o fundamento do vínculo;
  3. identidade provada só pelo código do e-mail: o cadastro ligado ao e-mail nunca sai;
  4. quem não é associado e não tem vínculo perde também o nome;
  5. a prévia que mudou dá 409; só o encarregado; só o pedido de eliminação; nada a eliminar dá 400; o desligado sem data de desligamento segura o cadastro;
  6. toda tabela do relatório tem destino decidido (sai ou fica, com o fundamento)."""
import json
import uuid
from datetime import datetime, timedelta

from app.models.associados import Associado, Endereco
from app.models.atendimento import Atendimento
from app.models.core import AuditLog, Usuario
from app.models.pessoas import Pessoa
from app.services import eliminacao_a_pedido as servico
from tests.test_atendimento import _cpf_valido
from tests.test_identidade_do_titular import _email

URL = "/api/privacidade/titulares/eliminacoes"


def _pessoa(db, *, associado_status=None, desligado_em=None, com_usuario=False):
    email, cpf = _email(), _cpf_valido()
    pessoa = Pessoa(nome_completo=f"Titular Eliminacao {uuid.uuid4().hex[:6]}", cpf=cpf, email_contato=email, telefone_whatsapp="91988887777")
    db.add(pessoa)
    db.flush()
    associado = None
    if associado_status:
        usuario = None
        if com_usuario:
            usuario = Usuario(email=email, senha_hash="x", ativo=False)
            db.add(usuario)
            db.flush()
        associado = Associado(id_pessoa=pessoa.id_pessoa, status_arrolamento=associado_status, data_desligamento=desligado_em,
                              id_usuario=usuario.id_usuario if usuario else None)
        db.add(associado)
        db.flush()
        db.add(Endereco(id_associado=associado.id_associado, logradouro="Rua do Teste", cidade="Parauapebas"))
    db.commit()
    return pessoa, associado


def _pedido(db, pessoa, *, subtipo="ELIMINACAO", identidade="MANUAL", id_pessoa=True, tipo="TITULAR_LGPD", status="Em atendimento", mensagem="Quero que apaguem meus dados."):
    a = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo=tipo, subtipo=subtipo, mensagem=mensagem, nome_completo=pessoa.nome_completo,
                    email_contato=pessoa.email_contato, cpf=pessoa.cpf, id_pessoa=pessoa.id_pessoa if id_pessoa else None, status=status, prazo_dias=15,
                    prazo_em=datetime.utcnow() + timedelta(days=15), identidade_validacao=identidade,
                    identidade_validada_em=datetime.utcnow() if identidade else None, encerrado_em=datetime.utcnow() if status == "Encerrado" else None)
    db.add(a)
    db.commit()
    return a


def _intencao(db, email, *, status="EXPIRADA", expira_em=None, documento=None):
    from app.models.intencoes_de_doacao import IntencaoDeDoacao

    i = IntencaoDeDoacao(protocolo=f"DOA-{uuid.uuid4().hex[:8]}", nome_doador="Doador Teste", email_doador=email, status=status, consentimento_lgpd_versao="1",
                         consentimento_lgpd_em=datetime.utcnow(), expira_em=expira_em or datetime.utcnow() - timedelta(days=2), documento_doador=documento)
    db.add(i)
    db.commit()
    return i


def _previa(client, headers, a):
    r = client.get(f"{URL}/{a.id_atendimento}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _eliminar(client, headers, a, impressao=None):
    impressao = impressao or _previa(client, headers, a)["impressao"]
    return client.post(f"{URL}/{a.id_atendimento}", json={"impressao": impressao}, headers=headers)


# ------------------------------------------------------------------------------------------------ 1. o desligado
def test_o_associado_desligado_e_anonimizado_na_hora_e_sai_o_resto(client, db, auth_headers):
    pessoa, associado = _pessoa(db, associado_status="Desligado", desligado_em=datetime.utcnow() - timedelta(days=30), com_usuario=True)
    antigo = _pedido(db, pessoa, tipo="CONTATO", subtipo=None, status="Encerrado", mensagem="Mensagem antiga com dado pessoal.")
    id_intencao = _intencao(db, pessoa.email_contato).id_intencao
    a = _pedido(db, pessoa)

    previa = _previa(client, auth_headers, a)
    assert previa["cadastro_sai"] is True and previa["vinculos"] == []
    assert any("pedido(s) antigo(s)" in s for s in previa["sai"]) and any("intenção" in s for s in previa["sai"])
    assert any("ficam o nome e a matrícula" in s for s in previa["sai"])
    assert any(f["nome"] == "Este pedido de eliminação" for f in previa["fica"])

    r = _eliminar(client, auth_headers, a)
    assert r.status_code == 200, r.text
    db.expire_all()
    pessoa = db.get(Pessoa, pessoa.id_pessoa)
    assert pessoa.cpf is None and pessoa.email_contato is None and pessoa.telefone_whatsapp is None
    assert pessoa.nome_completo.startswith("Titular Eliminacao"), "o livro de associados guarda o nome"
    assert db.query(Endereco).filter(Endereco.id_associado == associado.id_associado).count() == 0
    assert db.get(Atendimento, antigo.id_atendimento).mensagem == servico.MARCADOR
    assert db.get(Atendimento, a.id_atendimento).mensagem == "Quero que apaguem meus dados.", "o próprio pedido fica como prova"
    from app.models.intencoes_de_doacao import IntencaoDeDoacao

    assert db.get(IntencaoDeDoacao, id_intencao) is None
    assert db.get(Usuario, associado.id_usuario).email.startswith("removido-")
    entrada = db.query(AuditLog).filter(AuditLog.acao == "ELIMINACAO_A_PEDIDO", AuditLog.id_registro_afetado == a.id_atendimento).one()
    corpo = json.loads(entrada.dados_depois)
    assert corpo["protocolo"] == a.protocolo and corpo["cadastro_sai"] is True
    assert pessoa.nome_completo not in entrada.dados_depois and "Rua do Teste" not in entrada.dados_depois


# ------------------------------------------------------------------------------------------------ 2. o ativo
def test_o_associado_ativo_fica_com_o_cadastro_e_sai_o_resto(client, db, auth_headers):
    pessoa, _ = _pessoa(db, associado_status="Ativo - Em Dia")
    antigo = _pedido(db, pessoa, tipo="CONTATO", subtipo=None, status="Encerrado", mensagem="Mensagem antiga.")
    a = _pedido(db, pessoa)
    previa = _previa(client, auth_headers, a)
    assert previa["cadastro_sai"] is False and any("está no quadro de associados" in v for v in previa["vinculos"])
    fica_pessoas = next(f for f in previa["fica"] if f["tabela"] == "pessoas")
    assert fica_pessoas["fundamento"] == "VINCULO_ATIVO" and "está no quadro de associados" in fica_pessoas["por_que"]
    assert previa["resultado_sugerido"] == "ATENDIDO_EM_PARTE" and previa["fundamento_sugerido"] == "VINCULO_ATIVO"
    r = _eliminar(client, auth_headers, a)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.get(Pessoa, pessoa.id_pessoa).cpf == pessoa.cpf, "o cadastro do ativo fica"
    assert db.get(Atendimento, antigo.id_atendimento).mensagem == servico.MARCADOR


# ------------------------------------------------------------------------------------------------ 3. só o e-mail
def test_identidade_so_pelo_codigo_do_e_mail_nao_tira_o_cadastro(client, db, auth_headers):
    vitima, _ = _pessoa(db)
    id_intencao = _intencao(db, vitima.email_contato).id_intencao
    a = _pedido(db, vitima, identidade="CODIGO_NO_EMAIL")
    previa = _previa(client, auth_headers, a)
    assert previa["pessoa"] is None and previa["cadastro_sai"] is False
    cadastro = next(f for f in previa["fica"] if f["fundamento"] == "IDENTIDADE_NAO_CONFIRMADA")
    assert "provou só o e-mail" in cadastro["por_que"]
    assert previa["resultado_sugerido"] == "ATENDIDO_EM_PARTE" and previa["fundamento_sugerido"] == "IDENTIDADE_NAO_CONFIRMADA"
    assert _eliminar(client, auth_headers, a).status_code == 200
    db.expire_all()
    assert db.get(Pessoa, vitima.id_pessoa).cpf == vitima.cpf, "o cadastro ligado ao e-mail não sai"
    from app.models.intencoes_de_doacao import IntencaoDeDoacao

    assert db.get(IntencaoDeDoacao, id_intencao) is None, "o que foi feito com o e-mail sai"


# ------------------------------------------------------------------------------------------------ 4. quem não é associado
def test_quem_nao_e_associado_e_nao_tem_vinculo_perde_tambem_o_nome(client, db, auth_headers):
    pessoa, _ = _pessoa(db)
    a = _pedido(db, pessoa)
    assert _previa(client, auth_headers, a)["cadastro_sai"] is True
    assert _eliminar(client, auth_headers, a).status_code == 200
    db.expire_all()
    p = db.get(Pessoa, pessoa.id_pessoa)
    assert p.nome_completo == servico.NOME_REMOVIDO and p.cpf is None and p.email_contato is None


# ------------------------------------------------------------------------------------------------ 5. as recusas
def test_as_recusas(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    pessoa, _ = _pessoa(db)
    _pedido(db, pessoa, tipo="CONTATO", subtipo=None, status="Encerrado")
    a = _pedido(db, pessoa)
    conferida = _previa(client, auth_headers, a)["impressao"]
    db.get(Pessoa, pessoa.id_pessoa).profissao = "Mudou depois da prévia"
    db.commit()
    r = _eliminar(client, auth_headers, a, conferida)
    assert r.status_code == 409 and "confira de novo" in r.json()["detail"]

    _, qualquer = _criar_associado(db, f"Sem Permissao Eliminar {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    assert client.get(f"{URL}/{a.id_atendimento}", headers=_headers(qualquer)).status_code == 403
    assert client.post(f"{URL}/{a.id_atendimento}", json={"impressao": "0" * 64}, headers=_headers(qualquer)).status_code == 403
    assert client.get(f"{URL}/99999999", headers=auth_headers).status_code == 404

    acesso = _pedido(db, pessoa, subtipo="ACESSO")
    assert client.get(f"{URL}/{acesso.id_atendimento}", headers=auth_headers).status_code == 400
    sem_validar = _pedido(db, pessoa, identidade=None)
    r = client.get(f"{URL}/{sem_validar.id_atendimento}", headers=auth_headers)
    assert r.status_code == 400 and "identidade" in r.json()["detail"]

    so_email = _pedido(db, pessoa, identidade="CODIGO_NO_EMAIL")
    so_email.email_contato = _email()
    db.commit()
    previa = _previa(client, auth_headers, so_email)
    assert previa["sai"] == []
    r = _eliminar(client, auth_headers, so_email)
    assert r.status_code == 400 and "nada que possa sair" in r.json()["detail"]


def test_o_desligado_sem_data_segura_o_cadastro(client, db, auth_headers):
    pessoa, _ = _pessoa(db, associado_status="Desligado", desligado_em=None)
    a = _pedido(db, pessoa)
    previa = _previa(client, auth_headers, a)
    assert previa["cadastro_sai"] is False and any("não tem data registrada" in v for v in previa["vinculos"])


# ------------------------------------------------------------------------------------------------ 6. toda tabela decidida
def test_toda_tabela_do_relatorio_tem_destino_decidido():
    from app.services import relatorio_do_titular as rt

    assert not servico.SAEM & set(servico.FICAM)
    do_relatorio = {t for t, _ in rt.LIGACOES_DA_PESSOA} | {
        "pessoas", "associados", "usuarios", "beneficiarios", "beneficiarios_projeto", "inscricoes", "atendimentos", "propostas_filiacao", "intencoes_de_doacao",
        "doacoes", "processos_disciplinares", "termos_adesao_voluntario", "alocacoes_voluntarios", "avisos_destinatarios", "fornecedores", "valores_campo",
    }
    decididas = servico.SAEM | set(servico.FICAM)
    assert do_relatorio - decididas == set(), "tabela do relatório sem destino na eliminação (eliminacao_a_pedido.py)"
    assert decididas - do_relatorio == set(), "destino de tabela que não está no relatório"
    from app.services.atendimento import FUNDAMENTOS

    assert {codigo for codigo, _ in servico.FICAM.values()} <= set(FUNDAMENTOS)


# ------------------------------------------------------------------------------------------------ 7. decisão C: eventos que passaram e o certificado
def test_a_inscricao_em_evento_que_passou_perde_o_dado_e_o_certificado_perde_o_arquivo_e_o_nome(client, db, auth_headers):
    from app.models.motores import DocumentoEmitido, Inscricao
    from app.services import armazenamento
    from tests.test_retencao_participacao import _certificado, _evento, _inscrever

    pessoa, _ = _pessoa(db, associado_status="Ativo - Em Dia")
    passada = _inscrever(db, _evento(db, 30), pessoa)
    futura = _inscrever(db, _evento(db, -30), pessoa)
    certificado = _certificado(db, pessoa, 30, pessoa.nome_completo)
    caminho = certificado.caminho_arquivo
    ids = (passada.id_inscricao, futura.id_inscricao, certificado.id_documento)
    a = _pedido(db, pessoa)
    previa = _previa(client, auth_headers, a)
    assert any("está inscrito(a) num evento que ainda vai acontecer" in v for v in previa["vinculos"])
    assert any(f["tabela"] == "inscricoes" and f["registros"] == 1 for f in previa["fica"]), "a inscrição futura fica, e a prévia diz"
    assert any("1 inscrição(ões) em eventos que já passaram" in s for s in previa["sai"]) and any("certificado" in s for s in previa["sai"])
    assert _eliminar(client, auth_headers, a).status_code == 200
    db.expire_all()
    p, f, c = db.get(Inscricao, ids[0]), db.get(Inscricao, ids[1]), db.get(DocumentoEmitido, ids[2])
    assert p.respostas_formulario is None and p.email_da_inscricao is None and p.codigo_checkin is None and p.status == "Presente", "a contagem fica"
    assert f.codigo_checkin is not None, "o evento que ainda vai acontecer não é tocado"
    assert c.caminho_arquivo == "" and c.id_pessoa is None and json.loads(c.variaveis_usadas)["nome_completo"] is None
    assert armazenamento.obter().ler(*armazenamento.separar_url(caminho)) is None, "o arquivo saiu do armazenamento"


# ------------------------------------------------------------------------------------------------ 8. a revisão da v7.2d
def test_quem_ja_foi_funcionario_fica_com_o_cadastro(client, db, auth_headers):
    from app.models.voluntariado import Funcionario

    pessoa, _ = _pessoa(db)
    db.add(Funcionario(id_pessoa=pessoa.id_pessoa, cargo="Auxiliar", data_admissao=datetime.utcnow() - timedelta(days=900), ativo=False, data_desligamento=datetime.utcnow() - timedelta(days=400)))
    db.commit()
    previa = _previa(client, auth_headers, _pedido(db, pessoa))
    assert previa["cadastro_sai"] is False and any("trabalhou ou trabalha" in v for v in previa["vinculos"])


def test_o_e_mail_da_familia_nao_apaga_o_que_e_do_irmao(client, db, auth_headers):
    irmao, _ = _pessoa(db)
    do_irmao = _pedido(db, irmao, tipo="CONTATO", subtipo=None, status="Encerrado", mensagem="Pedido do irmão.")
    intencao_de_outro_cpf = _intencao(db, irmao.email_contato, documento=_cpf_valido()).id_intencao
    quem_pede = Pessoa(nome_completo="Irma Pelo Email", email_contato=irmao.email_contato)
    db.add(quem_pede)
    db.commit()
    a = _pedido(db, quem_pede, identidade="CODIGO_NO_EMAIL", id_pessoa=False)
    a.cpf = None
    db.commit()
    previa = _previa(client, auth_headers, a)
    assert previa["sai"] == [], "nada do irmão sai pelo e-mail compartilhado"
    from app.models.intencoes_de_doacao import IntencaoDeDoacao

    assert db.get(Atendimento, do_irmao.id_atendimento).mensagem == "Pedido do irmão."
    assert db.get(IntencaoDeDoacao, intencao_de_outro_cpf) is not None


def test_desligamento_com_data_futura_segura_o_cadastro(client, db, auth_headers):
    pessoa, _ = _pessoa(db, associado_status="Desligado", desligado_em=datetime.utcnow() + timedelta(days=10))
    previa = _previa(client, auth_headers, _pedido(db, pessoa))
    assert previa["cadastro_sai"] is False and any("só vale a partir de" in v for v in previa["vinculos"])


def test_o_cracha_de_evento_futuro_e_o_documento_generico_ficam(client, db, auth_headers):
    from app.models.motores import DocumentoEmitido
    from tests.test_retencao_participacao import _certificado

    pessoa, _ = _pessoa(db, associado_status="Ativo - Em Dia")
    futuro = _certificado(db, pessoa, -30, pessoa.nome_completo)  # o evento ainda vai acontecer
    id_futuro = futuro.id_documento
    a = _pedido(db, pessoa)
    _pedido(db, pessoa, tipo="CONTATO", subtipo=None, status="Encerrado")
    previa = _previa(client, auth_headers, a)
    assert not any("certificado" in s for s in previa["sai"])
    assert _eliminar(client, auth_headers, a).status_code == 200
    db.expire_all()
    assert db.get(DocumentoEmitido, id_futuro).caminho_arquivo != ""


def test_a_previa_que_venceu_da_409_e_a_segunda_execucao_nao_promete_de_novo(client, db, auth_headers, monkeypatch):
    pessoa, _ = _pessoa(db)
    a = _pedido(db, pessoa)
    conferida = _previa(client, auth_headers, a)["impressao"]
    # o tempo passou e um vínculo apareceu sem mudar o relatório (o plano mudou): a impressão cobre o plano
    monkeypatch.setattr(servico, "vinculos_vivos", lambda db, id_pessoa, agora: ["tem mandato vigente"])
    assert _eliminar(client, auth_headers, a, conferida).status_code == 409
    monkeypatch.undo()
    assert _eliminar(client, auth_headers, a).status_code == 200
    depois = _previa(client, auth_headers, a)
    assert depois["sai"] == [] and depois["cadastro_sai"] is False, "o que já saiu não é prometido de novo"
    assert _eliminar(client, auth_headers, a).status_code == 400
    assert db.query(AuditLog).filter(AuditLog.acao == "ELIMINACAO_A_PEDIDO", AuditLog.id_registro_afetado == a.id_atendimento).count() == 1


def test_a_falha_no_meio_fica_na_auditoria_e_a_previa_mostra_o_que_falta(client, db, auth_headers, monkeypatch):
    pessoa, _ = _pessoa(db)
    antigo = _pedido(db, pessoa, tipo="CONTATO", subtipo=None, status="Encerrado")
    a = _pedido(db, pessoa)

    def quebra(*_args, **_kw):
        raise RuntimeError("armazenamento fora do ar")

    monkeypatch.setattr(servico, "_cadastro", quebra)
    r = _eliminar(client, auth_headers, a)
    assert r.status_code == 502 and "Abra a prévia de novo" in r.json()["detail"]
    falha = db.query(AuditLog).filter(AuditLog.acao == "ELIMINACAO_A_PEDIDO_INCOMPLETA", AuditLog.id_registro_afetado == a.id_atendimento).one()
    assert json.loads(falha.dados_depois)["parou_em"] == "cadastro"
    db.expire_all()
    assert db.get(Atendimento, antigo.id_atendimento).mensagem == servico.MARCADOR, "a etapa que deu certo ficou gravada"
    monkeypatch.undo()
    previa = _previa(client, auth_headers, a)
    assert previa["cadastro_sai"] is True and not any("pedido(s) antigo(s)" in s for s in previa["sai"])
    assert _eliminar(client, auth_headers, a).status_code == 200


def test_o_pedido_sobre_o_presidente_e_decidido_pelo_vice_e_nunca_por_ele(client, db, auth_headers, monkeypatch):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    presidente, usuario_do_presidente = _criar_associado(db, f"Presidente Eliminacao {uuid.uuid4().hex[:6]}", nome_nivel="Presidente")
    _, vice = _criar_associado(db, f"Vice Eliminacao {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    pessoa = db.get(Pessoa, presidente.id_pessoa)
    a = _pedido(db, pessoa)
    a.id_responsavel = vice.id_usuario
    db.commit()
    # v7.3f: o sistema designou o Vice para este pedido (como faz no pedido sobre os dados do Presidente; `responsavel_do_pedido` tem os próprios testes)
    monkeypatch.setattr("app.services.atendimento.responsavel_do_pedido", lambda *_: vice.id_usuario)
    r = client.get(f"{URL}/{a.id_atendimento}", headers=_headers(usuario_do_presidente))
    assert r.status_code == 403 and "próprios dados" in r.json()["detail"]
    assert client.get(f"{URL}/{a.id_atendimento}", headers=_headers(vice)).status_code == 200, "quem responde o pedido decide"


def test_o_desligado_perde_a_conta_do_painel_os_anexos_e_a_foto_da_diretoria(client, db, auth_headers):
    from app.models.associados import DocumentoAnexo
    from app.models.core import TokenAcesso
    from app.models.preferencias_de_comunicacao import PreferenciaDeComunicacao
    from app.services import armazenamento

    pessoa, associado = _pessoa(db, associado_status="Desligado", desligado_em=datetime.utcnow() - timedelta(days=30), com_usuario=True)
    conta = db.get(Usuario, associado.id_usuario)
    conta.mfa_secret, conta.mfa_ativado = "SEGREDO", True
    db.add(TokenAcesso(id_usuario=conta.id_usuario, token=f"t{uuid.uuid4().hex}", data_expiracao=datetime.utcnow() + timedelta(days=1)))
    caminho = armazenamento.salvar_novo("comprovantes", ".pdf", b"%PDF-anexo")
    db.add(DocumentoAnexo(id_associado=associado.id_associado, tipo_documento="RG", caminho_arquivo=caminho))
    db.add(PreferenciaDeComunicacao(id_pessoa=pessoa.id_pessoa, tipo="AVISOS", recebe=False, origem="painel"))
    db.commit()
    a = _pedido(db, pessoa)
    assert _eliminar(client, auth_headers, a).status_code == 200
    db.expire_all()
    conta = db.get(Usuario, associado.id_usuario)
    assert conta.email.startswith("removido-") and conta.mfa_secret is None and conta.ativo is False
    assert db.query(TokenAcesso).filter(TokenAcesso.id_usuario == conta.id_usuario).count() == 0
    assert db.query(DocumentoAnexo).filter(DocumentoAnexo.id_associado == associado.id_associado).count() == 0
    assert armazenamento.obter().ler(*armazenamento.separar_url(caminho)) is None
    assert db.query(PreferenciaDeComunicacao).filter(PreferenciaDeComunicacao.id_pessoa == pessoa.id_pessoa).count() == 0


# ------------------------------------------------------------------------------------------------ 9. v7.2g: a identidade automática não tira o cadastro
def test_a_identidade_automatica_nao_tira_o_cadastro_ate_a_equipe_reforcar(client, db, auth_headers):
    pessoa, _ = _pessoa(db, associado_status="Desligado", desligado_em=datetime.utcnow() - timedelta(days=30))
    a = _pedido(db, pessoa, identidade="AUTOMATICA_CADASTRO")
    previa = _previa(client, auth_headers, a)
    assert previa["cadastro_sai"] is False and previa["pessoa"] is None, "o e-mail e o CPF digitados não bastam para uma eliminação"
    assert any(f["fundamento"] == "IDENTIDADE_NAO_CONFIRMADA" and "outro meio" in f["por_que"] for f in previa["fica"])
    reforco = client.post(f"/api/atendimentos/{a.id_atendimento}/validar-identidade",
                          json={"nota": "Conferi o documento com foto da pessoa na secretaria."}, headers=auth_headers)
    assert reforco.status_code == 200, reforco.text
    assert reforco.json()["identidade_validacao"] == "MANUAL"
    assert _previa(client, auth_headers, a)["cadastro_sai"] is True
    de_novo = client.post(f"/api/atendimentos/{a.id_atendimento}/validar-identidade",
                          json={"nota": "Conferi outra vez o documento da pessoa."}, headers=auth_headers)
    assert de_novo.status_code == 400 and "já está validada" in de_novo.json()["detail"], "a conferida pela equipe não se repete"


def test_a_previa_mostra_a_pessoa_com_o_cpf_escondido(client, db, auth_headers):
    """v7.3f (achado do Ponto de Revisão da FASE 7, 2/3): a prévia devolvia o CPF inteiro, que a tela nem usa."""
    pessoa, _ = _pessoa(db)
    a = _pedido(db, pessoa)
    previa = _previa(client, auth_headers, a)
    assert previa["pessoa"]["cpf"] == f"***.***.***-{pessoa.cpf[-2:]}" and pessoa.cpf not in str(previa)
