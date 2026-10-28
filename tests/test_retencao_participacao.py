"""v7.1d (FASE 7) - os prazos que faltavam (app/services/retencao_participacao.py) e a eliminação do prontuário a pedido (app/services/beneficiarios.py::eliminar_prontuario).

O que o servidor garante:
  1. inscrição e presença: 5 anos depois do evento saem as respostas, o e-mail, o QR, o código do cancelamento e o comentário da pesquisa; as linhas ficam (as contagens);
  2. quem só se inscreveu em evento: 5 anos depois do último evento o papel acaba e, sem outro vínculo, a pessoa é anonimizada; associado e quem tem outro papel não;
  3. voluntário: 5 anos depois do fim do último termo saem as referências e o texto livre, o papel acaba (destrava o associado desligado), as horas ficam;
  4. certificado: 10 anos depois o arquivo sai e o nome sai; a verificação pública continua dizendo que é válido (e usa o nome IMPRESSO, não o do cadastro);
  5. Auditoria: 10 anos depois saem quem fez, o IP e os valores; a entrada fica (a trava contra apagar continua);
  6. o prontuário só é eliminado com o consentimento retirado, a solicitação do titular certa e a identidade validada, por quem tem `privacidade_gerir`;
  7. tudo é idempotente (rodar de novo não muda nada).
(Datas relativas ao agora REAL: o banco de teste é compartilhado.)"""
import json
import uuid
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.atendimento import TITULAR_LGPD, Atendimento
from app.models.core import AuditLog
from app.models.eventos import Evento
from app.models.motores import DocumentoEmitido, Inscricao, RegistroPresenca, TemplateDocumento
from app.models.pessoas import Papel, Pessoa
from app.models.voluntariado import RegistroHorasVoluntariado, TermoAdesaoVoluntario
from app.services import armazenamento, retencao_participacao as rp

AGORA = datetime.utcnow()
CINCO_ANOS = 1825
DEZ_ANOS = 3650


def _ha(dias: float) -> datetime:
    return AGORA - timedelta(days=dias)


def _u() -> str:
    return uuid.uuid4().hex[:10]


def _pessoa(db, nome=None, *, papel=None, papel_criado_ha=3000) -> Pessoa:
    p = Pessoa(nome_completo=nome or f"Pessoa Retencao {_u()}", cpf=f"{uuid.uuid4().int % 10**11:011d}", email_contato=f"{_u()}@exemplo.com",
               telefone_whatsapp="91999990000")
    db.add(p)
    db.flush()
    if papel:
        db.add(Papel(id_pessoa=p.id_pessoa, tipo_papel=papel, ativo=True, criado_em=_ha(papel_criado_ha)))
    db.commit()
    return p


def _evento(db, fim_ha: float) -> Evento:
    e = Evento(titulo=f"Evento antigo {_u()}", categoria="PALESTRA", data_hora_inicio=_ha(fim_ha) - timedelta(hours=2), data_hora_fim=_ha(fim_ha))
    db.add(e)
    db.commit()
    return e


def _inscrever(db, evento: Evento, pessoa: Pessoa, status="Presente") -> Inscricao:
    i = Inscricao(contexto_tipo="Evento", id_contexto=evento.id_evento, id_pessoa=pessoa.id_pessoa, status=status,
                  respostas_formulario=json.dumps({"1": "resposta livre"}), codigo_checkin=f"QR{_u()}", token_cancelamento=f"TK{_u()}",
                  email_da_inscricao=pessoa.email_contato)
    db.add(i)
    db.add(RegistroPresenca(contexto_tipo="Evento", id_contexto=evento.id_evento, id_pessoa=pessoa.id_pessoa, meio_registro="QR", hora_entrada=evento.data_hora_inicio))
    db.commit()
    return i


# ------------------------------------------------------------------------------------------------ 1. inscrição e presença
def test_inscricao_de_evento_antigo_perde_o_dado_da_pessoa_e_a_linha_fica(db):
    from app.models.pesquisa_satisfacao import RespostaPesquisaSatisfacao

    pessoa = _pessoa(db)
    antigo, recente = _evento(db, 2000), _evento(db, 100)
    velha, nova = _inscrever(db, antigo, pessoa), _inscrever(db, recente, pessoa)
    db.add(RespostaPesquisaSatisfacao(id_evento=antigo.id_evento, id_inscricao=velha.id_inscricao, token=f"T{_u()}", nota=5, comentario="gostei muito"))
    db.commit()
    assert rp.inscricoes_e_presencas(db, datetime.utcnow(), CINCO_ANOS) >= 1
    db.expire_all()
    v = db.get(Inscricao, velha.id_inscricao)
    assert (v.respostas_formulario, v.email_da_inscricao, v.codigo_checkin, v.token_cancelamento) == (None, None, None, None)
    assert v.status == "Presente" and v.id_pessoa == pessoa.id_pessoa, "a linha e a situação ficam (as contagens)"
    assert db.query(RegistroPresenca).filter(RegistroPresenca.id_contexto == antigo.id_evento).count() == 1
    assert db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_inscricao == velha.id_inscricao).one().comentario is None
    n = db.get(Inscricao, nova.id_inscricao)
    assert n.respostas_formulario and n.codigo_checkin, "o evento recente fica intacto"
    assert rp.inscricoes_e_presencas(db, datetime.utcnow(), CINCO_ANOS) == 0, "rodar de novo não faz nada"


# ------------------------------------------------------------------------------------------------ 2. quem só se inscreveu
def test_participante_externo_antigo_e_anonimizado_e_o_que_tem_vinculo_nao(db):
    so_participou = _pessoa(db, papel="participante_externo")
    tambem_beneficiario = _pessoa(db, papel="participante_externo")
    tambem_voluntario = _pessoa(db, papel="participante_externo")
    db.add(Papel(id_pessoa=tambem_voluntario.id_pessoa, tipo_papel="voluntario", ativo=True))
    recente = _pessoa(db, papel="participante_externo")
    from app.models.beneficiarios import Beneficiario

    db.add(Beneficiario(id_pessoa=tambem_beneficiario.id_pessoa))
    db.commit()
    antigo = _evento(db, 2000)
    for p in (so_participou, tambem_beneficiario, tambem_voluntario):
        _inscrever(db, antigo, p)
    _inscrever(db, antigo, recente)
    _inscrever(db, _evento(db, 30), recente)

    afetadas, falhas = rp.participantes_externos(db, datetime.utcnow(), CINCO_ANOS)
    assert falhas == 0 and afetadas >= 3
    db.expire_all()
    a = db.get(Pessoa, so_participou.id_pessoa)
    assert a.nome_completo == rp.NOME_APAGADO and (a.cpf, a.email_contato, a.telefone_whatsapp) == (None, None, None)
    for quem in (tambem_beneficiario, tambem_voluntario):
        p = db.get(Pessoa, quem.id_pessoa)
        assert p.cpf is not None and p.nome_completo == quem.nome_completo, "tem outro vínculo: o dado ainda serve a ele"
    assert db.get(Pessoa, recente.id_pessoa).cpf is not None, "inscrito num evento recente"
    papeis = {p.id_pessoa: p.ativo for p in db.query(Papel).filter(Papel.tipo_papel == "participante_externo",
                                                                  Papel.id_pessoa.in_([so_participou.id_pessoa, recente.id_pessoa]))}
    assert papeis == {so_participou.id_pessoa: False, recente.id_pessoa: True}
    assert db.query(Inscricao).filter(Inscricao.id_pessoa == so_participou.id_pessoa).count() == 1, "a inscrição fica (a contagem do evento)"
    assert db.query(AuditLog).filter(AuditLog.acao == "ANONIMIZADO", AuditLog.id_registro_afetado == so_participou.id_pessoa).count() == 1
    assert rp.participantes_externos(db, datetime.utcnow(), CINCO_ANOS)[0] == 0


def test_participante_sem_inscricao_conta_da_criacao_do_papel(db):
    novo = _pessoa(db, papel="participante_externo", papel_criado_ha=10)
    rp.participantes_externos(db, datetime.utcnow(), CINCO_ANOS)
    db.expire_all()
    assert db.get(Pessoa, novo.id_pessoa).cpf is not None


def test_participante_que_e_associado_nao_perde_o_nome(db):
    from tests.test_sessao_assembleia import _criar_associado

    associado = _criar_associado(db, f"Associado Participante {_u()}")
    db.add(Papel(id_pessoa=associado.id_pessoa, tipo_papel="participante_externo", ativo=True, criado_em=_ha(3000)))
    db.commit()
    _inscrever(db, _evento(db, 2000), associado.pessoa)
    rp.participantes_externos(db, datetime.utcnow(), CINCO_ANOS)
    db.expire_all()
    assert db.get(Associado, associado.id_associado).pessoa.nome_completo.startswith("Associado Participante")


# ------------------------------------------------------------------------------------------------ 3. voluntário
def test_voluntario_encerrado_perde_referencias_e_texto_e_o_papel_acaba_as_horas_ficam(db):
    pessoa = _pessoa(db, papel="voluntario")
    termo = TermoAdesaoVoluntario(id_pessoa=pessoa.id_pessoa, atividade="Apoio na cozinha", carga_horaria_semanal=4, data_inicio=_ha(2600),
                                  data_fim_vigencia=_ha(2000), documento_referencia="Termo nº 12", autorizacao_responsavel_referencia="Autorização da mãe",
                                  ativo=True)
    db.add(termo)
    db.commit()
    db.add(RegistroHorasVoluntariado(id_termo=termo.id_termo, data=_ha(2100), horas=3, descricao_atividade="Servi o almoço", status="APROVADO"))
    vigente = _pessoa(db, papel="voluntario")
    db.add(TermoAdesaoVoluntario(id_pessoa=vigente.id_pessoa, atividade="Recepção", carga_horaria_semanal=2, data_inicio=_ha(2600),
                                 data_fim_vigencia=_ha(2000), documento_referencia="velho"))
    db.add(TermoAdesaoVoluntario(id_pessoa=vigente.id_pessoa, atividade="Recepção", carga_horaria_semanal=2, data_inicio=_ha(100),
                                 data_fim_vigencia=AGORA + timedelta(days=200), documento_referencia="renovado", ativo=True))
    db.commit()

    afetadas, falhas = rp.voluntarios_encerrados(db, datetime.utcnow(), CINCO_ANOS)
    assert falhas == 0 and afetadas >= 1
    db.expire_all()
    t = db.get(TermoAdesaoVoluntario, termo.id_termo)
    assert (t.documento_referencia, t.autorizacao_responsavel_referencia, t.ativo) == (None, None, False) and t.atividade == "Apoio na cozinha"
    horas = db.query(RegistroHorasVoluntariado).filter(RegistroHorasVoluntariado.id_termo == termo.id_termo).one()
    assert horas.horas == 3 and horas.descricao_atividade == rp.MARCADOR_DE_TEXTO
    assert db.query(Papel).filter(Papel.id_pessoa == pessoa.id_pessoa, Papel.tipo_papel == "voluntario").one().ativo is False
    assert db.get(Pessoa, pessoa.id_pessoa).nome_completo == rp.NOME_APAGADO
    renovou = db.query(TermoAdesaoVoluntario).filter(TermoAdesaoVoluntario.id_pessoa == vigente.id_pessoa).all()
    assert {x.documento_referencia for x in renovou} == {"velho", "renovado"}, "o fim que conta é o do ÚLTIMO termo"
    assert rp.voluntarios_encerrados(db, datetime.utcnow(), CINCO_ANOS)[0] == 0


def test_o_associado_desligado_que_foi_voluntario_e_anonimizado_depois_que_o_papel_acaba(db):
    from app.services import retencao
    from tests.test_sessao_assembleia import _criar_associado

    desligado = _criar_associado(db, f"Desligado Ex Voluntario {_u()}")
    desligado.status_arrolamento = "Desligado"
    desligado.data_desligamento = _ha(2000)
    desligado.pessoa.cpf = f"{uuid.uuid4().int % 10**11:011d}"
    db.add(Papel(id_pessoa=desligado.id_pessoa, tipo_papel="voluntario", ativo=True))
    db.add(TermoAdesaoVoluntario(id_pessoa=desligado.id_pessoa, atividade="Apoio", carga_horaria_semanal=2, data_inicio=_ha(2600),
                                 data_fim_vigencia=_ha(1900)))
    db.commit()
    retencao.aplicar_todas(db, agora=datetime.utcnow())  # o papel acaba
    retencao.aplicar_todas(db, agora=datetime.utcnow())  # e o desligado passa a ser anonimizado
    db.expire_all()
    a = db.get(Associado, desligado.id_associado)
    assert a.pessoa.cpf is None and a.pessoa.nome_completo.startswith("Desligado Ex Voluntario"), "o nome fica (livro de associados)"


# ------------------------------------------------------------------------------------------------ 4. certificado
def _certificado(db, pessoa, emitido_ha: float, nome_impresso: str) -> DocumentoEmitido:
    template = db.query(TemplateDocumento).filter(TemplateDocumento.codigo == "CERTIFICADO_EVENTO").first()
    if template is None:  # o modelo do certificado nasce na primeira emissão
        template = TemplateDocumento(codigo="CERTIFICADO_EVENTO", nome="Certificado de participação", corpo_texto="Certificamos que {nome_completo}.")
        db.add(template)
        db.commit()
    caminho = armazenamento.salvar_novo("documentos", ".pdf", b"%PDF-teste", nome=f"{_u()}.pdf")
    proximo = (db.query(DocumentoEmitido.numero_sequencial).order_by(DocumentoEmitido.numero_sequencial.desc()).limit(1).scalar() or 0) + 1
    d = DocumentoEmitido(id_template=template.id_template, numero_sequencial=proximo, contexto_tipo="Evento", id_contexto=_evento(db, emitido_ha).id_evento,
                         id_pessoa=pessoa.id_pessoa, variaveis_usadas=json.dumps({"nome_completo": nome_impresso, "titulo_evento": "Palestra"}),
                         caminho_arquivo=caminho, emitida_em=_ha(emitido_ha), codigo_verificacao=f"V{_u()}{_u()}")
    db.add(d)
    db.commit()
    return d


def test_certificado_de_10_anos_perde_o_arquivo_e_o_nome_e_continua_valido(client, db):
    pessoa = _pessoa(db)
    velho = _certificado(db, pessoa, 3700, "Maria Impressa")
    arquivo_do_velho = velho.caminho_arquivo
    novo = _certificado(db, pessoa, 100, "Maria Impressa")
    pessoa.nome_completo = rp.NOME_APAGADO  # a pessoa já foi anonimizada (5 anos): o certificado ainda mostra o nome IMPRESSO até os 10
    db.commit()
    r = client.get(f"/certificado/verificar/{novo.codigo_verificacao}").json()
    assert r["nome_completo"] == "Maria Impressa" and r["nome_retirado"] is False

    afetados, falhas = rp.certificados(db, datetime.utcnow(), DEZ_ANOS)
    assert falhas == 0 and afetados >= 1
    db.expire_all()
    d = db.get(DocumentoEmitido, velho.id_documento)
    assert d.caminho_arquivo == "" and d.id_pessoa is None and json.loads(d.variaveis_usadas)["nome_completo"] is None
    assert json.loads(d.variaveis_usadas)["titulo_evento"] == "Palestra"
    pasta, nome = armazenamento.separar_url(arquivo_do_velho)
    assert not armazenamento.obter()._caminho(pasta, nome).exists(), "o arquivo saiu do armazenamento (a pasta é pública)"
    r = client.get(f"/certificado/verificar/{velho.codigo_verificacao}")
    assert r.status_code == 200 and r.json()["nome_completo"] is None and r.json()["nome_retirado"] is True, "continua válido, sem o nome"
    assert db.get(DocumentoEmitido, novo.id_documento).caminho_arquivo, "o recente fica"
    assert rp.certificados(db, datetime.utcnow(), DEZ_ANOS)[0] == 0


def test_se_o_armazenamento_nao_apaga_o_certificado_fica_para_a_proxima_rodada(db, monkeypatch):
    d = _certificado(db, _pessoa(db), 3700, "Fulano")

    class Quebrado:
        def remover(self, *_):
            raise RuntimeError("armazenamento indisponível")

    monkeypatch.setattr(armazenamento, "obter", lambda: Quebrado())
    afetados, falhas = rp.certificados(db, datetime.utcnow(), DEZ_ANOS)
    assert falhas >= 1
    db.expire_all()
    assert db.get(DocumentoEmitido, d.id_documento).caminho_arquivo == d.caminho_arquivo, "sem o arquivo apagado, nada muda"


# ------------------------------------------------------------------------------------------------ 5. Auditoria
def test_auditoria_de_10_anos_perde_quem_o_ip_e_os_valores_e_a_entrada_fica(db):
    velha = AuditLog(id_usuario=None, tabela_afetada="teste_retencao", id_registro_afetado=7, acao="ALGO", dados_depois='{"nome": "Fulano"}',
                     ip_origem="10.1.2.3", timestamp=_ha(3700))
    nova = AuditLog(tabela_afetada="teste_retencao", id_registro_afetado=8, acao="ALGO", dados_depois='{"nome": "Ciclano"}', ip_origem="10.1.2.4",
                    timestamp=_ha(10))
    db.add_all([velha, nova])
    db.commit()
    assert rp.auditoria(db, datetime.utcnow(), DEZ_ANOS) >= 1
    db.expire_all()
    v = db.get(AuditLog, velha.id_log)
    assert (v.ip_origem, v.dados_depois, v.dados_antes, v.id_usuario) == (None, None, None, None)
    assert (v.acao, v.tabela_afetada, v.id_registro_afetado) == ("ALGO", "teste_retencao", 7), "fica o que aconteceu, onde e quando"
    assert db.get(AuditLog, nova.id_log).ip_origem == "10.1.2.4"
    assert rp.auditoria(db, datetime.utcnow(), DEZ_ANOS) == 0


# ------------------------------------------------------------------------------------------------ 6. eliminação do prontuário a pedido
def _pedido_do_titular(db, *, subtipo="ELIMINACAO", validado=True, nome="Mãe de Teste", status="Novo") -> Atendimento:
    protocolo = f"TIT{_u()[:8].upper()}"
    a = Atendimento(protocolo=protocolo, tipo=TITULAR_LGPD, subtipo=subtipo, nome_completo=nome, status=status, email_contato="mae@exemplo.com",
                    mensagem="Quero apagar o prontuário.", prazo_dias=15, prazo_em=AGORA + timedelta(days=15),
                    identidade_validacao="MANUAL" if validado else None)
    db.add(a)
    db.commit()
    return a


def test_eliminar_o_prontuario_so_com_a_revogacao_o_pedido_certo_e_a_identidade(client, db, auth_headers):
    from app.models.beneficiarios import EncaminhamentoRedeExterna, RegistroAtendimento
    from tests.test_beneficiarios import _registrar_consentimento
    from tests.test_consentimento_do_beneficiario import _atender, _vinculo_com_equipe
    from tests.test_beneficiarios import _criar_beneficiario

    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    assert _atender(client, auth_headers, id_vinculo, relato="Relato sensível da família.").status_code == 200
    assert client.post(f"/api/beneficiarios-projeto/{id_vinculo}/encaminhamentos", json={"tipo_rede": "CRAS", "descricao": "Encaminhada ao CRAS."},
                       headers=auth_headers).status_code == 200
    from app.models.beneficiarios import Beneficiario

    nome = db.get(Pessoa, db.get(Beneficiario, id_beneficiario).id_pessoa).nome_completo
    pedido = _pedido_do_titular(db, nome=nome.upper())  # o nome confere sem diferença de maiúscula
    url = f"/api/beneficiarios/{id_beneficiario}/eliminar-prontuario"

    vigente = client.post(url, json={"protocolo": pedido.protocolo}, headers=auth_headers)
    assert vigente.status_code == 409 and "vigente" in vigente.json()["detail"]
    assert client.post(f"/api/beneficiarios/{id_beneficiario}/consentimento/revogar", json={}, headers=auth_headers).status_code == 200
    assert client.post(url, json={"protocolo": "NAOEXISTE"}, headers=auth_headers).status_code == 404
    assert client.post(url, json={"protocolo": _pedido_do_titular(db, subtipo="ACESSO", nome=nome).protocolo}, headers=auth_headers).status_code == 400
    de_outra = client.post(url, json={"protocolo": _pedido_do_titular(db, nome="Outra Pessoa Qualquer").protocolo}, headers=auth_headers)
    assert de_outra.status_code == 400 and "não é desta pessoa" in de_outra.json()["detail"], "o protocolo de outra pessoa não apaga este prontuário"
    encerrado = client.post(url, json={"protocolo": _pedido_do_titular(db, nome=nome, status="Encerrado").protocolo}, headers=auth_headers)
    assert encerrado.status_code == 409
    sem_identidade = client.post(url, json={"protocolo": _pedido_do_titular(db, validado=False, nome=nome).protocolo}, headers=auth_headers)
    assert sem_identidade.status_code == 409 and "identidade" in sem_identidade.json()["detail"]

    ok = client.post(url, json={"protocolo": pedido.protocolo.lower()}, headers=auth_headers)
    assert ok.status_code == 200, ok.text
    assert (ok.json()["relatos"], ok.json()["encaminhamentos"]) == (1, 1)
    db.expire_all()
    r = db.query(RegistroAtendimento).filter(RegistroAtendimento.id_vinculo == id_vinculo).one()
    e = db.query(EncaminhamentoRedeExterna).filter(EncaminhamentoRedeExterna.id_vinculo == id_vinculo).one()
    assert "sensível" not in r.relato and "CRAS." not in e.descricao and e.tipo_rede == "CRAS", "ficam a data e o tipo (as contagens)"
    entrada = db.query(AuditLog).filter(AuditLog.acao == "PRONTUARIO_ELIMINADO", AuditLog.id_registro_afetado == id_beneficiario).one()
    assert pedido.protocolo in entrada.dados_depois and "sensível" not in entrada.dados_depois
    assert client.post(url, json={"protocolo": pedido.protocolo}, headers=auth_headers).json()["relatos"] == 0, "de novo não muda nada"
    assert _registrar_consentimento(client, auth_headers, id_beneficiario).status_code == 200, "um termo novo pode ser registrado depois"


def test_so_o_encarregado_elimina_o_prontuario(client, db, auth_headers):
    from tests.test_beneficiarios import _criar_beneficiario
    from tests.test_conselho_fiscal import _criar_associado, _headers

    id_beneficiario = _criar_beneficiario(client, auth_headers, com_consentimento=False)
    _, associado = _criar_associado(db, f"So Projetos {_u()}", nome_nivel="Associado")
    r = client.post(f"/api/beneficiarios/{id_beneficiario}/eliminar-prontuario", json={"protocolo": _pedido_do_titular(db).protocolo},
                    headers=_headers(associado))
    assert r.status_code == 403


# ------------------------------------------------------------------------------------------------ 7. o dado antigo inventado da homologação (o robô v7.1d-01 confere lá)
def test_o_dado_antigo_da_homologacao_faz_a_rotina_agir_e_o_roteiro_recusa_outro_banco(client, db, monkeypatch):
    import importlib.util
    from pathlib import Path

    import pytest

    from app.services import retencao

    caminho = Path(__file__).resolve().parent.parent / "scripts" / "hml_dados_antigos_da_retencao.py"
    spec = importlib.util.spec_from_file_location("hml_dados_antigos_da_retencao", caminho)
    roteiro = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(roteiro)
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:s@servidor/asaf")
    with pytest.raises(SystemExit, match="RECUSADO"):
        roteiro.main()

    gravado = roteiro.semear(db, datetime.utcnow())
    resultado = retencao.aplicar_todas(db, agora=datetime.utcnow())
    assert resultado["falhas"] == []
    db.expire_all()
    [inscricao] = db.query(Inscricao).filter(Inscricao.contexto_tipo == "Evento", Inscricao.id_contexto == gravado["evento"]).all()
    assert inscricao.status == "Presente" and inscricao.codigo_checkin is None
    assert db.get(Pessoa, gravado["participante"]).nome_completo == rp.NOME_APAGADO
    assert db.get(Pessoa, gravado["voluntario"]).nome_completo == rp.NOME_APAGADO
    r = client.get(f"/certificado/verificar/{gravado['codigo']}").json()
    assert r["nome_completo"] is None and r["nome_retirado"] is True
    entrada = db.query(AuditLog).filter(AuditLog.acao == "TESTE_DA_RETENCAO", AuditLog.id_registro_afetado == gravado["evento"]).one()
    assert (entrada.ip_origem, entrada.dados_depois) == (None, None)
    assert roteiro.mover_a_auditoria_antiga(db) >= 1
    db.expire_all()
    assert db.get(AuditLog, entrada.id_log).timestamp == roteiro.MOVER_PARA, "o relatório anual da homologação segue começando em 2025"


# ------------------------------------------------------------------------------------------------ 8. os casos da conferência independente
def test_quem_tem_inscricao_recente_familiar_ou_funcionario_nao_e_anonimizado(db):
    from app.models.associados import DependenteFamiliar
    from app.models.voluntariado import Funcionario

    vai_ao_evento = _pessoa(db, papel="voluntario")
    db.add(TermoAdesaoVoluntario(id_pessoa=vai_ao_evento.id_pessoa, atividade="Apoio", carga_horaria_semanal=2, data_inicio=_ha(2600),
                                 data_fim_vigencia=_ha(2000)))
    db.commit()
    _inscrever(db, _evento(db, -20), vai_ao_evento)  # inscrita num evento do mês que vem, pelo CPF (sem o papel de participante)
    familiar = _pessoa(db, papel="participante_externo")
    titular = _pessoa(db)
    db.add(DependenteFamiliar(id_pessoa_titular=titular.id_pessoa, id_pessoa_vinculada=familiar.id_pessoa, grau_parentesco="MAE"))
    funcionaria = _pessoa(db, papel="participante_externo")
    db.add(Funcionario(id_pessoa=funcionaria.id_pessoa, cargo="Cozinheira", data_admissao=_ha(400)))
    db.commit()
    antigo = _evento(db, 2000)
    _inscrever(db, antigo, familiar)
    _inscrever(db, antigo, funcionaria)
    rp.voluntarios_encerrados(db, datetime.utcnow(), CINCO_ANOS)
    rp.participantes_externos(db, datetime.utcnow(), CINCO_ANOS)
    db.expire_all()
    for quem in (vai_ao_evento, familiar, funcionaria):
        assert db.get(Pessoa, quem.id_pessoa).cpf is not None, quem.nome_completo


def test_quem_se_inscreveu_sem_o_papel_tambem_vence(db):
    so_inscrito = _pessoa(db)
    _inscrever(db, _evento(db, 2000), so_inscrito)
    rp.participantes_externos(db, datetime.utcnow(), CINCO_ANOS)
    db.expire_all()
    assert db.get(Pessoa, so_inscrito.id_pessoa).nome_completo == rp.NOME_APAGADO


def test_o_evento_vence_pela_ultima_sessao_e_o_comentario_de_quem_foi_inscrito_pelo_painel_sai(db):
    from app.models.eventos import SessaoEvento
    from app.models.pesquisa_satisfacao import RespostaPesquisaSatisfacao

    longo = _evento(db, 2000)
    db.add(SessaoEvento(id_evento=longo.id_evento, titulo="Encerramento", data_hora_inicio=_ha(30), data_hora_fim=_ha(30)))
    db.commit()
    no_longo = _inscrever(db, longo, _pessoa(db))
    antigo = _evento(db, 2000)
    pelo_painel = Inscricao(contexto_tipo="Evento", id_contexto=antigo.id_evento, id_pessoa=_pessoa(db).id_pessoa, status="Presente")
    db.add(pelo_painel)
    db.commit()
    db.add(RespostaPesquisaSatisfacao(id_evento=antigo.id_evento, id_inscricao=pelo_painel.id_inscricao, token=f"T{_u()}", nota=4, comentario="meu comentário"))
    db.commit()
    rp.inscricoes_e_presencas(db, datetime.utcnow(), CINCO_ANOS)
    db.expire_all()
    assert db.get(Inscricao, no_longo.id_inscricao).codigo_checkin is not None, "a última sessão foi há um mês"
    assert db.query(RespostaPesquisaSatisfacao).filter(RespostaPesquisaSatisfacao.id_inscricao == pelo_painel.id_inscricao).one().comentario is None


def test_a_regra_do_certificado_nao_toca_outro_documento_do_evento(db):
    from app.models.motores import TemplateDocumento

    oficio = db.query(TemplateDocumento).filter(TemplateDocumento.codigo == "OFICIO_TESTE_RETENCAO").first()
    if oficio is None:
        oficio = TemplateDocumento(codigo="OFICIO_TESTE_RETENCAO", nome="Ofício", corpo_texto="Ofício.")
        db.add(oficio)
        db.commit()
    d = _certificado(db, _pessoa(db), 3700, "Fulano")
    d.id_template = oficio.id_template
    db.commit()
    rp.certificados(db, datetime.utcnow(), DEZ_ANOS)
    db.expire_all()
    assert db.get(DocumentoEmitido, d.id_documento).caminho_arquivo, "só o certificado e o crachá"


def test_o_piso_da_auditoria_e_de_5_anos(db):
    from app.services import retencao
    from tests.test_retencao import _config

    regra = next(r for r in retencao.REGRAS if r.codigo == "auditoria")
    antigo = _config(db, regra.chave_de_config, "400")
    try:
        assert retencao.dias_da_regra(db, regra) == 3650, "um ano não serve: o \"quem fez\" ainda é usado"
    finally:
        _config(db, regra.chave_de_config, antigo)
