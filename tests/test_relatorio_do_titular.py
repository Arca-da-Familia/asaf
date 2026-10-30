"""v7.2b (FASE 7) - o relatório dos dados de uma pessoa (app/services/relatorio_do_titular.py):
  1. junta o que é DELA em todas as tabelas (cadastro, beneficiário, prontuário pelo vínculo, consentimento, inscrição...), com a atividade do inventário de cada
     tabela (finalidade, base legal, com quem é compartilhado, prazo);
  2. só as colunas de dado pessoal ou sensível (nunca código técnico); a Auditoria fica de fora;
  3. o que a pessoa fez pelo site com o e-mail (pedido do titular, pedido de doação) entra pelo e-mail, mesmo sem cadastro;
  4. o que a pessoa OPEROU no painel (como usuário) não é dado dela;
  5. só o encarregado (`privacidade_gerir`) gera; a leitura vai para a Auditoria sem os valores; a busca acha pelo nome, CPF ou e-mail."""
import uuid

from app.models.core import AuditLog
from tests.test_beneficiarios import _criar_beneficiario
from tests.test_consentimento_do_beneficiario import _atender, _vinculo_com_equipe
from tests.test_identidade_do_titular import _pedido


def _relatorio(client, headers, **params):
    r = client.get("/api/privacidade/titulares/relatorio", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _secao(relatorio, tabela):
    return next((s for s in relatorio["secoes"] if s["tabela"] == tabela), None)


def test_o_relatorio_junta_o_que_e_da_pessoa_com_a_atividade_de_cada_tabela(client, db, auth_headers):
    from app.models.beneficiarios import Beneficiario

    id_beneficiario = _criar_beneficiario(client, auth_headers, nome=f"Titular Do Relatorio {uuid.uuid4().hex[:6]}")
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    assert _atender(client, auth_headers, id_vinculo, relato="Relato sensível do relatório.").status_code == 200
    id_pessoa = db.get(Beneficiario, id_beneficiario).id_pessoa

    rel = _relatorio(client, auth_headers, id_pessoa=id_pessoa)
    assert rel["pessoa"]["id_pessoa"] == id_pessoa and rel["pessoa"]["nome_completo"].startswith("Titular Do Relatorio")
    pessoas = _secao(rel, "pessoas")
    assert pessoas and pessoas["linhas"][0]["nome_completo"].startswith("Titular Do Relatorio")
    prontuario = _secao(rel, "registros_atendimento")
    assert prontuario and prontuario["linhas"][0]["relato"] == "Relato sensível do relatório.", "o sensível entra: é o encarregado quem lê"
    assert prontuario["atividades"][0]["codigo"] == "BENEFICIARIOS" and prontuario["atividades"][0]["bases_legais"]
    assert _secao(rel, "consentimentos"), "o consentimento dela"
    assert _secao(rel, "audit_log") is None, "a Auditoria fica de fora"
    assert all("id_usuario_autor" not in linha for linha in prontuario["linhas"]), "quem registrou não é dado dela"


def test_o_que_a_pessoa_fez_pelo_site_entra_pelo_e_mail(client, db, auth_headers):
    email = f"so.pelo.site.{uuid.uuid4().hex[:8]}@example.com"
    a = _pedido(client, db, subtipo="ACESSO", email_contato=email)
    rel = _relatorio(client, auth_headers, email=email.upper())
    atendimentos = _secao(rel, "atendimentos")
    assert atendimentos and [linha["numero"] for linha in atendimentos["linhas"]] == [a.id_atendimento]
    assert rel["pessoa"] is None, "sem cadastro"


def test_o_que_a_pessoa_operou_como_usuario_nao_e_dado_dela(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado

    associado, usuario = _criar_associado(db, f"Operador Do Painel {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    # ela registrou o atendimento de OUTRA pessoa
    from app.models.beneficiarios import RegistroAtendimento

    id_beneficiario = _criar_beneficiario(client, auth_headers)
    id_vinculo = _vinculo_com_equipe(client, db, auth_headers, id_beneficiario)
    db.add(RegistroAtendimento(id_vinculo=id_vinculo, relato="Relato de outra pessoa.", id_usuario_autor=usuario.id_usuario))
    db.commit()
    rel = _relatorio(client, auth_headers, id_pessoa=associado.id_pessoa)
    assert _secao(rel, "registros_atendimento") is None
    assert _secao(rel, "associados") is not None


def test_so_o_encarregado_gera_e_a_leitura_fica_na_auditoria_sem_valores(client, db, auth_headers):
    from tests.test_conselho_fiscal import _criar_associado, _headers

    _, so_projetos = _criar_associado(db, f"So Projetos Relatorio {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    id_beneficiario = _criar_beneficiario(client, auth_headers, nome=f"Pessoa Auditada {uuid.uuid4().hex[:6]}")
    from app.models.beneficiarios import Beneficiario

    id_pessoa = db.get(Beneficiario, id_beneficiario).id_pessoa
    assert client.get("/api/privacidade/titulares/relatorio", params={"id_pessoa": id_pessoa}, headers=_headers(so_projetos)).status_code == 403
    assert client.get("/api/privacidade/titulares", params={"busca": "Pessoa"}, headers=_headers(so_projetos)).status_code == 403
    _relatorio(client, auth_headers, id_pessoa=id_pessoa)
    entrada = db.query(AuditLog).filter(AuditLog.acao == "CONSULTA_RELATORIO_DO_TITULAR", AuditLog.id_registro_afetado == id_pessoa).one()
    assert "Pessoa Auditada" not in entrada.dados_depois and '"linhas"' in entrada.dados_depois
    assert client.get("/api/privacidade/titulares/relatorio", headers=auth_headers).status_code == 400
    assert client.get("/api/privacidade/titulares/relatorio", params={"id_pessoa": 99999999}, headers=auth_headers).status_code == 404


def test_a_busca_acha_pelo_nome_e_mascara_o_cpf(client, db, auth_headers):
    from app.models.pessoas import Pessoa

    nome = f"Pessoa Buscavel {uuid.uuid4().hex[:6]}"
    p = Pessoa(nome_completo=nome, cpf=f"{uuid.uuid4().int % 10**11:011d}")
    db.add(p)
    db.commit()
    r = client.get("/api/privacidade/titulares", params={"busca": nome}, headers=auth_headers)
    assert r.status_code == 200
    [achada] = [x for x in r.json() if x["id_pessoa"] == p.id_pessoa]
    assert achada["cpf_mascarado"] == f"***.***.***-{p.cpf[-2:]}" and p.cpf not in str(achada)
    assert client.get("/api/privacidade/titulares", params={"busca": "ab"}, headers=auth_headers).status_code == 400


# ------------------------------------------------------------------------------------------------ a conferência independente
def test_nenhum_segredo_sai_no_relatorio(client, db, auth_headers):
    """A senha cifrada e a semente do segundo passo de quem tem acesso ao painel nunca saem (quem as tivesse geraria os códigos do MFA)."""
    from app.services import relatorio_do_titular as rt
    from tests.test_conselho_fiscal import _criar_associado

    associado, usuario = _criar_associado(db, f"Com Acesso Ao Painel {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    usuario.mfa_secret = "SEMENTEMFADETESTE"
    db.commit()
    rel = _relatorio(client, auth_headers, id_pessoa=associado.id_pessoa)
    texto = str(rel)
    assert "SEMENTEMFADETESTE" not in texto and usuario.senha_hash not in texto
    for secao in rel["secoes"]:
        for linha in secao["linhas"]:
            assert not any(rt.COLUNAS_SECRETAS.search(c) for c in linha), (secao["tabela"], [c for c in linha if rt.COLUNAS_SECRETAS.search(c)])
    assert _secao(rel, "tokens_acesso") is None and _secao(rel, "notificacoes_painel") is None


def test_toda_ligacao_com_a_pessoa_foi_pensada():
    """Uma tabela nova com chave para a pessoa (ou para o associado, o beneficiário...) tem de entrar numa das duas listas: é dela, ou é de outra natureza."""
    import app.models  # noqa: F401
    from app.database import Base
    from app.services import relatorio_do_titular as rt

    ancoras = {"pessoas", "associados", "usuarios", "beneficiarios", "beneficiarios_projeto", "inscricoes", "atendimentos", "propostas_filiacao",
               "intencoes_de_doacao", "doacoes", "processos_disciplinares", "termos_adesao_voluntario", "alocacoes_voluntarios", "avisos_destinatarios",
               "fornecedores"}
    soltas = []
    for nome, tabela in Base.metadata.tables.items():
        if nome in rt.FORA_DO_RELATORIO:
            continue
        for coluna in tabela.columns:
            for fk in coluna.foreign_keys:
                alvo = fk.column.table.name
                if alvo in ancoras and not (alvo == "usuarios" and coluna.name != "id_usuario"):
                    par = (nome, coluna.name)
                    if par not in rt.LIGACOES_DA_PESSOA and par not in rt.LIGACOES_DE_OUTRA_NATUREZA:
                        soltas.append(par)
    assert soltas == [], f"ligações novas sem decisão (relatorio_do_titular.py): {soltas}"


def test_entram_as_tabelas_sem_coluna_classificada_com_o_contexto_e_o_que_ela_fez_pelo_site(client, db, auth_headers):
    from datetime import datetime

    from app.models.intencoes_de_doacao import IntencaoDeDoacao
    from app.models.motores import RegistroPresenca
    from app.models.pessoas import Pessoa

    email = f"completo.{uuid.uuid4().hex[:8]}@example.com"
    p = Pessoa(nome_completo=f"Pessoa Completa {uuid.uuid4().hex[:6]}", email_contato=email)
    db.add(p)
    db.commit()
    db.add(RegistroPresenca(contexto_tipo="Projeto", id_contexto=1, id_pessoa=p.id_pessoa, meio_registro="QR", hora_entrada=datetime(2026, 10, 1, 9)))
    db.add(IntencaoDeDoacao(protocolo=f"DOA{uuid.uuid4().hex[:8]}", nome_doador=p.nome_completo, email_doador=email, valor_informado=50, status="PENDENTE",
                            consentimento_lgpd_versao="1", consentimento_lgpd_em=datetime(2026, 10, 1), expira_em=datetime(2026, 11, 1)))
    db.commit()
    rel = _relatorio(client, auth_headers, id_pessoa=p.id_pessoa)
    presenca = _secao(rel, "registros_presenca")
    assert presenca and presenca["linhas"][0]["meio_registro"] == "QR", "a presença entra, com o contexto (sem coluna pessoal classificada)"
    assert _secao(rel, "intencoes_de_doacao"), "o pedido de doação pelo e-mail do cadastro entra (com o número do cadastro só)"


def test_o_corte_e_avisado_e_ficam_as_mais_novas(client, db, auth_headers, monkeypatch):
    from datetime import datetime

    from app.models.motores import RegistroPresenca
    from app.models.pessoas import Pessoa
    from app.services import relatorio_do_titular as rt

    p = Pessoa(nome_completo=f"Muitas Presencas {uuid.uuid4().hex[:6]}")
    db.add(p)
    db.commit()
    for dia in (1, 2, 3):
        db.add(RegistroPresenca(contexto_tipo="Projeto", id_contexto=1, id_pessoa=p.id_pessoa, meio_registro="QR", hora_entrada=datetime(2026, 10, dia, 9)))
    db.commit()
    monkeypatch.setattr(rt, "LIMITE_DE_LINHAS_POR_TABELA", 2)
    rel = _relatorio(client, auth_headers, id_pessoa=p.id_pessoa)
    presenca = _secao(rel, "registros_presenca")
    assert presenca["cortado"] is True and rel["algum_corte"] is True and len(presenca["linhas"]) == 2
    assert presenca["linhas"][0]["hora_entrada"].startswith("2026-10-03"), "as mais novas primeiro"


def test_quem_responde_a_solicitacao_dela_tambem_gera_e_so_dela(client, db, auth_headers, monkeypatch):
    from datetime import datetime, timedelta

    from app.models.atendimento import Atendimento
    from app.models.pessoas import Pessoa
    from tests.test_conselho_fiscal import _criar_associado, _headers

    _, vice = _criar_associado(db, f"Vice Que Atende {uuid.uuid4().hex[:6]}", nome_nivel="Associado")
    p = Pessoa(nome_completo=f"Dona Do Pedido {uuid.uuid4().hex[:6]}")
    outra = Pessoa(nome_completo=f"Outra Pessoa {uuid.uuid4().hex[:6]}")
    db.add_all([p, outra])
    db.commit()
    pedido = Atendimento(protocolo=f"TST{uuid.uuid4().hex[:8]}", tipo="TITULAR_LGPD", subtipo="ACESSO", mensagem="Quero meus dados.",
                         nome_completo=p.nome_completo, email_contato="dona@example.com", id_pessoa=p.id_pessoa, status="Novo", prazo_dias=15,
                         prazo_em=datetime.utcnow() + timedelta(days=15), id_responsavel=vice.id_usuario)
    db.add(pedido)
    db.commit()
    # v7.3f: o sistema designou o Vice para este pedido (como faz no pedido sobre os dados do Presidente; `responsavel_do_pedido` tem os próprios testes)
    monkeypatch.setattr("app.services.atendimento.responsavel_do_pedido", lambda *_: vice.id_usuario)
    url = "/api/privacidade/titulares/relatorio"
    assert client.get(url, params={"id_pessoa": p.id_pessoa}, headers=_headers(vice)).status_code == 403, "sem o pedido, não"
    assert client.get(url, params={"id_pessoa": p.id_pessoa, "id_atendimento": pedido.id_atendimento}, headers=_headers(vice)).status_code == 200
    assert client.get(url, params={"id_pessoa": outra.id_pessoa, "id_atendimento": pedido.id_atendimento}, headers=_headers(vice)).status_code == 403
