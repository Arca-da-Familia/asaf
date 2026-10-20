"""v6.1 (FASE 6) - comunicação interna no painel: avisos com público calculado, mural, caixa de entrada e relatório de leitura.

As promessas que estes testes travam:
  1. só quem tem `comunicar` publica, confere o grupo, lista, inclui e retira; por padrão a Presidência (nível) e os cargos Presidente, 1º e 2º Secretário;
  2. o grupo é calculado pelo servidor, com a situação do associado recalculada na hora (não o rótulo guardado); o desligado nunca recebe;
  3. publicar exige o total conferido igual ao de agora (409 se o grupo mudou) e recusa grupo vazio, validade no passado, texto vazio e categoria inválida;
  4. só quem está entre os destinatários vê o aviso (no mural, na caixa de entrada e pelo endereço: 404 para os outros);
  5. o associado sem acesso ao painel fica registrado como "sem acesso" e vê o aviso quando ganhar acesso;
  6. abrir grava a leitura; "Li e estou ciente" grava a confirmação e vai para a Auditoria, uma vez só;
  7. retirar exige motivo, tira do mural e mantém no histórico de quem recebeu; incluir acrescenta quem entrou no grupo depois sem tirar ninguém;
  8. o prazo de guarda apaga a lista de destinatários 5 anos depois de o aviso sair do mural, guardando os totais;
  9. a migração e5b1d7a3c820 dá `comunicar` a quem tem `gerenciar_acesso` e aos três cargos, e nada mais."""
import importlib.util
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.associados import Associado
from app.models.comunicacao import Aviso, AvisoDestinatario
from app.models.core import AuditLog, Catalogo, NivelAcesso, OpcaoCatalogo, PermissaoSistema, Usuario, perfil_permissao
from app.models.financeiro import TituloFinanceiro
from app.models.notificacoes_painel import NotificacaoPainel
from app.models.pessoas import Pessoa
from app.models.projetos import AlocacaoVoluntario, EquipeProjeto, ProjetoEvento
from app.security import hash_senha
from app.services import comunicacao, retencao
from tests.test_conselho_fiscal import _criar_associado, _headers

HOJE = comunicacao.hoje()


def _nome(prefixo: str) -> str:
    return f"{prefixo} {uuid.uuid4().hex[:6]}"


def _associado_sem_acesso(db, nome: str) -> Associado:
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    return associado


def _projeto(db, *, equipe=(), voluntarios=()) -> ProjetoEvento:
    projeto = ProjetoEvento(nome_projeto=_nome("Projeto do Aviso"))
    db.add(projeto)
    db.flush()
    for associado in equipe:
        db.add(EquipeProjeto(id_projeto=projeto.id_projeto, id_associado=associado.id_associado, papel="COORDENADOR"))
    for associado, status in voluntarios:
        db.add(AlocacaoVoluntario(id_projeto=projeto.id_projeto, id_pessoa=associado.id_pessoa, id_associado=associado.id_associado, status=status))
    db.commit()
    return projeto


def _publico_do_projeto(projeto, partes=("equipe", "voluntarios"), situacoes=()):
    return {"tipo": "projeto", "id_projeto": projeto.id_projeto, "partes_do_projeto": list(partes), "situacoes": list(situacoes)}


def _corpo(publico, total, **extra):
    return {
        "titulo": extra.pop("titulo", _nome("Aviso")), "texto": "Reunião da equipe no sábado às 9h.", "categoria": extra.pop("categoria", "GERAL"),
        "valido_ate": extra.pop("valido_ate", (HOJE + timedelta(days=10)).isoformat()), "exige_confirmacao": extra.pop("exige_confirmacao", False),
        "publico": publico, "total_confirmado": total, **extra,
    }


def _publicar(client, auth_headers, publico, **extra) -> dict:
    previa = client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=auth_headers)
    assert previa.status_code == 200, previa.text
    r = client.post("/api/avisos/", json=_corpo(publico, previa.json()["total"], **extra), headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------------------------------------ 1. quem pode
def test_por_padrao_so_a_presidencia_e_os_cargos_de_presidente_e_secretarios_tem_comunicar(client, db):
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "comunicar").one()
    assert permissao.modulo == "comunicacao"
    niveis = {
        n for (n,) in db.query(NivelAcesso.nome_nivel).join(perfil_permissao, perfil_permissao.c.id_nivel == NivelAcesso.id_nivel)
        .filter(perfil_permissao.c.id_permissao == permissao.id_permissao).all()
    }
    assert niveis == {"Presidente"}, niveis
    cargos = {
        o.codigo for o in db.query(OpcaoCatalogo).join(Catalogo, Catalogo.id_catalogo == OpcaoCatalogo.id_catalogo).filter(Catalogo.chave == "titulo_cargo").all()
        if "comunicar" in (o.metadados or {}).get("permissoes", [])
    }
    assert cargos == {"PRESIDENTE", "SECRETARIO", "VICE_SECRETARIO"}, cargos


def test_quem_nao_tem_comunicar_e_barrado_em_tudo_do_modulo(client, db, auth_headers):
    _, diretor = _criar_associado(db, _nome("Diretor Sem Comunicar"), nome_nivel="Diretoria")
    h = _headers(diretor)
    projeto = _projeto(db)
    publico = _publico_do_projeto(projeto)
    assert client.get("/api/avisos/opcoes-de-publico", headers=h).status_code == 403
    assert client.post("/api/avisos/conferir-publico", json={"publico": publico}, headers=h).status_code == 403
    assert client.post("/api/avisos/", json=_corpo(publico, 0), headers=h).status_code == 403
    assert client.get("/api/avisos/", headers=h).status_code == 403
    assert client.get("/api/avisos/1", headers=h).status_code == 403
    assert client.post("/api/avisos/1/incluir-novos", headers=h).status_code == 403
    assert client.post("/api/avisos/1/retirar", json={"motivo": "motivo qualquer longo"}, headers=h).status_code == 403
    assert client.get("/api/meus-avisos/").status_code == 401
    assert client.get("/api/avisos/").status_code == 401


# ------------------------------------------------------------------------------------------------ 2 e 3. o grupo e a publicação
def test_a_situacao_e_calculada_na_hora_e_o_desligado_nunca_recebe(client, db, auth_headers):
    em_dia, _ = _criar_associado(db, _nome("Em Dia"))
    devedor, _ = _criar_associado(db, _nome("Devedor"))
    licenciado, _ = _criar_associado(db, _nome("Licenciado"))
    desligado, _ = _criar_associado(db, _nome("Desligado"))
    # o rótulo guardado diz "em dia" para os três: a conta e a licença mandam
    db.add(TituloFinanceiro(tipo_titulo="A Receber", id_associado=devedor.id_associado, descricao="Mensalidade", valor_original=50, saldo_devedor=50,
                            data_vencimento=datetime.utcnow() - timedelta(days=120), status="Aberto"))
    db.get(Associado, licenciado.id_associado).data_fim_licenca = datetime.utcnow() + timedelta(days=30)
    db.get(Associado, desligado.id_associado).status_arrolamento = "Desligado"
    db.commit()
    projeto = _projeto(db, equipe=[em_dia, devedor, licenciado, desligado])

    todos = client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto)}, headers=auth_headers).json()
    nomes = {p["nome"] for p in todos["pessoas"]}
    assert nomes == {em_dia.nome_completo, devedor.nome_completo, licenciado.nome_completo}, "o desligado nunca recebe"
    so_em_dia = client.post(
        "/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto, situacoes=["Ativo - Em Dia"])}, headers=auth_headers,
    ).json()
    assert [p["nome"] for p in so_em_dia["pessoas"]] == [em_dia.nome_completo]
    assert "em situação Ativo - Em Dia" in so_em_dia["descricao"] and projeto.nome_projeto in so_em_dia["descricao"]
    inadimplentes = client.post(
        "/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto, situacoes=["Ativo - Inadimplente"])}, headers=auth_headers,
    ).json()
    assert [p["nome"] for p in inadimplentes["pessoas"]] == [devedor.nome_completo]


def test_o_grupo_do_projeto_junta_equipe_e_voluntarios_associados_sem_repetir(client, db, auth_headers):
    coordenadora, _ = _criar_associado(db, _nome("Coordenadora"))
    voluntario, _ = _criar_associado(db, _nome("Voluntario"))
    recusado, _ = _criar_associado(db, _nome("Recusado"))
    projeto = _projeto(db, equipe=[coordenadora], voluntarios=[(voluntario, "CONFIRMADA"), (coordenadora, "PENDENTE"), (recusado, "RECUSADA")])
    nomes = lambda partes: [p["nome"] for p in client.post(  # noqa: E731
        "/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto, partes=partes)}, headers=auth_headers,
    ).json()["pessoas"]]
    assert sorted(nomes(["equipe", "voluntarios"])) == sorted([coordenadora.nome_completo, voluntario.nome_completo])
    assert nomes(["equipe"]) == [coordenadora.nome_completo]
    assert sorted(nomes(["voluntarios"])) == sorted([coordenadora.nome_completo, voluntario.nome_completo]), "a alocação recusada não conta"


def test_o_grupo_por_permissao_e_quem_tem_a_permissao_hoje(client, db, auth_headers):
    _, tesoureiro = _criar_associado(db, _nome("Tesoureira Do Aviso"), nome_nivel="Diretoria")
    _, associado = _criar_associado(db, _nome("Associada Sem Financeiro"))
    previa = client.post("/api/avisos/conferir-publico", json={"publico": {"tipo": "permissao", "codigo_permissao": "financeiro"}}, headers=auth_headers).json()
    nomes = {p["nome"] for p in previa["pessoas"]}
    assert db.query(Associado).filter(Associado.id_usuario == tesoureiro.id_usuario).one().nome_completo in nomes
    assert db.query(Associado).filter(Associado.id_usuario == associado.id_usuario).one().nome_completo not in nomes
    assert all(p["tem_acesso"] for p in previa["pessoas"])
    ruim = client.post("/api/avisos/conferir-publico", json={"publico": {"tipo": "permissao", "codigo_permissao": "nao_existe"}}, headers=auth_headers)
    assert ruim.status_code == 422


def test_publicar_recusa_o_que_tem_de_recusar(client, db, auth_headers):
    membro, _ = _criar_associado(db, _nome("Membro"))
    projeto = _projeto(db, equipe=[membro])
    publico = _publico_do_projeto(projeto)
    vazio = _publico_do_projeto(_projeto(db))
    casos = [
        (_corpo(publico, 5), 409, "grupo mudou"),
        (_corpo(vazio, 0), 422, "Ninguém"),
        (_corpo(publico, 1, valido_ate=(HOJE - timedelta(days=1)).isoformat()), 422, "já passou"),
        (_corpo(publico, 1, valido_ate=(HOJE + timedelta(days=800)).isoformat()), 422, "2 anos"),
        (_corpo(publico, 1, categoria="NAO_EXISTE"), 422, "Categoria"),
        (_corpo(publico, 1, titulo="   "), 422, "título"),
        (_corpo({"tipo": "projeto", "id_projeto": projeto.id_projeto, "partes_do_projeto": []}, 1), 422, "equipe"),
        (_corpo({"tipo": "qualquer"}, 1), 422, "quem recebe"),
    ]
    for corpo, codigo, trecho in casos:
        r = client.post("/api/avisos/", json=corpo, headers=auth_headers)
        assert r.status_code == codigo and trecho in r.json()["detail"], (corpo, r.status_code, r.text)
    assert db.query(Aviso).filter(Aviso.publico["id_projeto"].as_integer() == projeto.id_projeto).count() == 0, "nada foi gravado"


def test_publicar_grava_os_destinatarios_avisa_no_sino_e_vai_para_a_auditoria(client, db, auth_headers):
    com_acesso, usuario = _criar_associado(db, _nome("Com Acesso"))
    sem_acesso = _associado_sem_acesso(db, _nome("Sem Acesso"))
    projeto = _projeto(db, equipe=[com_acesso, sem_acesso])
    previa = client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto)}, headers=auth_headers).json()
    assert previa["total"] == 2 and previa["sem_acesso"] == 1
    aviso = _publicar(client, auth_headers, _publico_do_projeto(projeto), exige_confirmacao=True)
    assert aviso["situacao"] == "No mural" and aviso["totais"] == {"destinatarios": 2, "lidos": 0, "confirmados": 0, "sem_acesso": 1}
    assert {(p["nome"], p["tinha_acesso"]) for p in aviso["destinatarios"]} == {(com_acesso.nome_completo, True), (sem_acesso.nome_completo, False)}
    sino = db.query(NotificacaoPainel).filter(NotificacaoPainel.id_usuario == usuario.id_usuario, NotificacaoPainel.link == f"/meus-avisos/{aviso['id_aviso']}").all()
    assert len(sino) == 1 and aviso["titulo"] in sino[0].titulo
    auditoria = db.query(AuditLog).filter(AuditLog.acao == "AVISO_PUBLICADO", AuditLog.id_registro_afetado == aviso["id_aviso"]).one()
    assert '"total_destinatarios": 2' in auditoria.dados_depois and '"sem_acesso": 1' in auditoria.dados_depois


# ------------------------------------------------------------------------------------------------ 4 a 6. quem vê, ler e confirmar
def test_so_quem_esta_no_grupo_ve_o_aviso(client, db, auth_headers):
    dentro, usuario_dentro = _criar_associado(db, _nome("Dentro"))
    _, usuario_fora = _criar_associado(db, _nome("Fora"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[dentro])))
    id_aviso = aviso["id_aviso"]
    mural = client.get("/api/meus-avisos/?mural=true", headers=_headers(usuario_dentro)).json()
    assert [a["id_aviso"] for a in mural["avisos"]] == [id_aviso] and mural["nao_lidos"] == 1
    assert "texto" not in mural["avisos"][0], "a lista não traz o texto; abrir traz"
    assert id_aviso not in [a["id_aviso"] for a in client.get("/api/meus-avisos/", headers=_headers(usuario_fora)).json()["avisos"]]
    assert client.get(f"/api/meus-avisos/{id_aviso}", headers=_headers(usuario_fora)).status_code == 404
    assert client.post(f"/api/meus-avisos/{id_aviso}/confirmar", headers=_headers(usuario_fora)).status_code == 404


def test_abrir_grava_a_leitura_e_confirmar_vai_para_a_auditoria_uma_vez(client, db, auth_headers):
    pessoa, usuario = _criar_associado(db, _nome("Leitora"))
    projeto = _projeto(db, equipe=[pessoa])
    simples = _publicar(client, auth_headers, _publico_do_projeto(projeto))
    importante = _publicar(client, auth_headers, _publico_do_projeto(projeto), exige_confirmacao=True, categoria="CONVOCACAO")
    h = _headers(usuario)
    mural = client.get("/api/meus-avisos/?mural=true", headers=h).json()
    assert [a["id_aviso"] for a in mural["avisos"]][0] == importante["id_aviso"], "o que pede confirmação vem primeiro"
    assert mural["confirmacoes_pendentes"] == 1

    aberto = client.get(f"/api/meus-avisos/{simples['id_aviso']}", headers=h).json()
    assert aberto["lido_em"] is not None and aberto["texto"] == "Reunião da equipe no sábado às 9h."
    primeira_leitura = aberto["lido_em"]
    assert client.get(f"/api/meus-avisos/{simples['id_aviso']}", headers=h).json()["lido_em"] == primeira_leitura, "a data da primeira leitura não muda"
    assert client.post(f"/api/meus-avisos/{simples['id_aviso']}/confirmar", headers=h).status_code == 409, "aviso que não pede confirmação"

    confirmado = client.post(f"/api/meus-avisos/{importante['id_aviso']}/confirmar", headers=h)
    assert confirmado.status_code == 200 and confirmado.json()["confirmado_em"] is not None and confirmado.json()["lido_em"] is not None
    assert client.post(f"/api/meus-avisos/{importante['id_aviso']}/confirmar", headers=h).status_code == 200
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_CONFIRMADO", AuditLog.id_registro_afetado == importante["id_aviso"]).count() == 1
    relatorio = client.get(f"/api/avisos/{importante['id_aviso']}", headers=auth_headers).json()
    assert relatorio["totais"]["lidos"] == 1 and relatorio["totais"]["confirmados"] == 1
    assert client.get("/api/meus-avisos/?mural=true", headers=h).json()["confirmacoes_pendentes"] == 0


def test_quem_nao_tinha_acesso_ve_o_aviso_quando_ganha_acesso(client, db, auth_headers):
    associado = _associado_sem_acesso(db, _nome("Ganha Acesso Depois"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[associado])))
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").one()
    usuario = Usuario(email=f"ganha.{uuid.uuid4().hex[:6]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    db.get(Associado, associado.id_associado).id_usuario = usuario.id_usuario
    db.commit()
    h = _headers(usuario)
    assert [a["id_aviso"] for a in client.get("/api/meus-avisos/", headers=h).json()["avisos"]] == [aviso["id_aviso"]]
    assert client.get(f"/api/meus-avisos/{aviso['id_aviso']}", headers=h).json()["lido_em"] is not None
    linha = client.get(f"/api/avisos/{aviso['id_aviso']}", headers=auth_headers).json()["destinatarios"][0]
    assert linha["tinha_acesso"] is False and linha["lido_em"] is not None, "o relatório mostra que entrou sem acesso e leu depois"


# ------------------------------------------------------------------------------------------------ 7. retirar e incluir
def test_retirar_exige_motivo_tira_do_mural_e_fica_no_historico(client, db, auth_headers):
    pessoa, usuario = _criar_associado(db, _nome("Recebe e Ve Retirar"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), exige_confirmacao=True)
    url = f"/api/avisos/{aviso['id_aviso']}/retirar"
    assert client.post(url, json={"motivo": "curto"}, headers=auth_headers).status_code == 422
    r = client.post(url, json={"motivo": "Data da reunião mudou, novo aviso a seguir."}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["situacao"] == "Retirado"
    assert client.post(url, json={"motivo": "Retirando de novo por engano."}, headers=auth_headers).status_code == 409
    h = _headers(usuario)
    assert client.get("/api/meus-avisos/?mural=true", headers=h).json()["avisos"] == []
    historico = client.get("/api/meus-avisos/", headers=h).json()["avisos"]
    assert historico[0]["situacao"] == "Retirado" and historico[0]["motivo_retirada"] == "Data da reunião mudou, novo aviso a seguir."
    assert client.post(f"/api/meus-avisos/{aviso['id_aviso']}/confirmar", headers=h).status_code == 409
    assert client.post(f"/api/avisos/{aviso['id_aviso']}/incluir-novos", headers=auth_headers).status_code == 409
    assert db.query(AuditLog).filter(AuditLog.acao == "AVISO_RETIRADO", AuditLog.id_registro_afetado == aviso["id_aviso"]).count() == 1
    retirados = client.get("/api/avisos/?situacao=Retirado&busca=" + aviso["titulo"], headers=auth_headers).json()
    assert [i["id_aviso"] for i in retirados["itens"]] == [aviso["id_aviso"]]


def test_incluir_acrescenta_quem_entrou_no_grupo_e_nao_tira_ninguem(client, db, auth_headers):
    primeira, _ = _criar_associado(db, _nome("Primeira"))
    saiu, _ = _criar_associado(db, _nome("Saiu Do Projeto"))
    projeto = _projeto(db, equipe=[primeira, saiu])
    aviso = _publicar(client, auth_headers, _publico_do_projeto(projeto))
    nova, usuario_nova = _criar_associado(db, _nome("Entrou Depois"))
    db.add(EquipeProjeto(id_projeto=projeto.id_projeto, id_associado=nova.id_associado, papel="VOLUNTARIO"))
    membro = db.query(EquipeProjeto).filter(EquipeProjeto.id_projeto == projeto.id_projeto, EquipeProjeto.id_associado == saiu.id_associado).one()
    membro.data_fim = datetime.utcnow()
    db.commit()
    r = client.post(f"/api/avisos/{aviso['id_aviso']}/incluir-novos", headers=auth_headers).json()
    assert r["incluidos"] == 1 and r["aviso"]["totais"]["destinatarios"] == 3
    assert {p["nome"] for p in r["aviso"]["destinatarios"]} == {primeira.nome_completo, saiu.nome_completo, nova.nome_completo}
    assert client.post(f"/api/avisos/{aviso['id_aviso']}/incluir-novos", headers=auth_headers).json()["incluidos"] == 0
    assert [a["id_aviso"] for a in client.get("/api/meus-avisos/", headers=_headers(usuario_nova)).json()["avisos"]] == [aviso["id_aviso"]]


def test_a_lista_filtra_por_situacao(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Lista"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])), valido_ate=HOJE.isoformat())
    titulo = aviso["titulo"]
    assert [i["id_aviso"] for i in client.get(f"/api/avisos/?situacao=No mural&busca={titulo}", headers=auth_headers).json()["itens"]] == [aviso["id_aviso"]], "válido até hoje = ainda no mural"
    db.get(Aviso, aviso["id_aviso"]).valido_ate = HOJE - timedelta(days=1)
    db.commit()
    assert [i["id_aviso"] for i in client.get(f"/api/avisos/?situacao=Vencido&busca={titulo}", headers=auth_headers).json()["itens"]] == [aviso["id_aviso"]]
    assert client.get("/api/avisos/?situacao=Qualquer", headers=auth_headers).status_code == 422


# ------------------------------------------------------------------------------------------------ 8. prazo de guarda
def test_o_prazo_de_guarda_apaga_a_lista_e_guarda_os_totais(client, db, auth_headers):
    pessoa, usuario = _criar_associado(db, _nome("Prova Antiga"))
    projeto = _projeto(db, equipe=[pessoa])
    velho = _publicar(client, auth_headers, _publico_do_projeto(projeto))
    recente = _publicar(client, auth_headers, _publico_do_projeto(projeto))
    client.get(f"/api/meus-avisos/{velho['id_aviso']}", headers=_headers(usuario))
    db.get(Aviso, velho["id_aviso"]).valido_ate = date.today() - timedelta(days=1830)
    db.get(Aviso, recente["id_aviso"]).valido_ate = date.today() - timedelta(days=1700)
    db.commit()
    resultado = retencao.aplicar_todas(db)
    assert resultado["falhas"] == [] and resultado["aplicadas"]["leitura_de_avisos"] >= 1
    db.expire_all()
    assert db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == velho["id_aviso"]).count() == 0
    assert db.query(AvisoDestinatario).filter(AvisoDestinatario.id_aviso == recente["id_aviso"]).count() == 1, "ainda dentro do prazo"
    guardado = db.get(Aviso, velho["id_aviso"])
    assert guardado.leitura_apagada_em is not None and (guardado.total_destinatarios, guardado.total_lidos, guardado.total_confirmados) == (1, 1, 0)
    relatorio = client.get(f"/api/avisos/{velho['id_aviso']}", headers=auth_headers).json()
    assert relatorio["destinatarios"] == [] and relatorio["totais"]["lidos"] == 1 and relatorio["texto"]
    assert velho["id_aviso"] not in [a["id_aviso"] for a in client.get("/api/meus-avisos/", headers=_headers(usuario)).json()["avisos"]]
    assert retencao.aplicar_todas(db)["aplicadas"]["leitura_de_avisos"] == 0, "rodar de novo não faz nada"


# ------------------------------------------------------------------------------------------------ 9. a migração
_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "e5b1d7a3c820_v6_1_comunicacao_interna_avisos.py"
_TABELAS = ("usuarios", "niveis_acesso", "pessoas", "associados", "permissoes_sistema", "perfil_permissao", "catalogos", "opcoes_catalogo")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_comunicacao", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_existente():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[Base.metadata.tables[t] for t in _TABELAS if t in Base.metadata.tables])
    with motor.begin() as c:
        for codigo in ("gerenciar_acesso", "associados"):
            c.execute(sa.insert(PermissaoSistema), {"modulo": "x", "codigo_permissao": codigo, "descricao": codigo})
        ids = {codigo: c.execute(sa.select(PermissaoSistema.id_permissao).where(PermissaoSistema.codigo_permissao == codigo)).scalar() for codigo in ("gerenciar_acesso", "associados")}
        for nome in ("Presidente", "Diretoria"):
            c.execute(sa.insert(NivelAcesso), {"nome_nivel": nome, "descricao": nome, "exige_mfa": False})
        niveis = {nome: c.execute(sa.select(NivelAcesso.id_nivel).where(NivelAcesso.nome_nivel == nome)).scalar() for nome in ("Presidente", "Diretoria")}
        c.execute(sa.insert(perfil_permissao).values(id_nivel=niveis["Presidente"], id_permissao=ids["gerenciar_acesso"]))
        c.execute(sa.insert(perfil_permissao).values(id_nivel=niveis["Diretoria"], id_permissao=ids["associados"]))
        c.execute(sa.insert(Catalogo), {"chave": "titulo_cargo", "nome_exibido": "Título de cargo"})
        id_catalogo = c.execute(sa.select(Catalogo.id_catalogo)).scalar()
        for codigo, permissoes in (("PRESIDENTE", ["gerenciar_acesso"]), ("SECRETARIO", ["associados"]), ("VICE_SECRETARIO", ["associados"]), ("TESOUREIRO", ["financeiro"])):
            c.execute(sa.insert(OpcaoCatalogo), {"id_catalogo": id_catalogo, "codigo": codigo, "rotulo": codigo, "metadados": {"permissoes": permissoes}})
    return motor


def _do_nivel(motor, nome: str) -> set[str]:
    with motor.connect() as c:
        return set(c.execute(
            sa.select(PermissaoSistema.codigo_permissao).join(perfil_permissao, perfil_permissao.c.id_permissao == PermissaoSistema.id_permissao)
            .join(NivelAcesso, NivelAcesso.id_nivel == perfil_permissao.c.id_nivel).where(NivelAcesso.nome_nivel == nome)
        ).scalars().all())


def _do_cargo(motor, codigo: str) -> set[str]:
    with motor.connect() as c:
        return set(c.execute(sa.select(OpcaoCatalogo.metadados).where(OpcaoCatalogo.codigo == codigo)).scalar()["permissoes"])


def test_a_migracao_da_comunicar_a_presidencia_e_aos_tres_cargos_e_nada_mais():
    motor = _banco_existente()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso", "comunicar"}
    assert _do_nivel(motor, "Diretoria") == {"associados"}
    assert _do_cargo(motor, "PRESIDENTE") == {"gerenciar_acesso", "comunicar"}
    assert _do_cargo(motor, "SECRETARIO") == {"associados", "comunicar"} and _do_cargo(motor, "VICE_SECRETARIO") == {"associados", "comunicar"}
    assert _do_cargo(motor, "TESOUREIRO") == {"financeiro"}
    assert {"avisos", "avisos_destinatarios"} <= set(sa.inspect(motor).get_table_names())
    _rodar(motor, migracao.downgrade)
    assert "comunicar" not in _do_nivel(motor, "Presidente") and "comunicar" not in _do_cargo(motor, "SECRETARIO")
    assert "avisos" not in set(sa.inspect(motor).get_table_names())
    with motor.connect() as c:
        assert c.execute(sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao == "comunicar")).scalar() == 0


def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert diretorio.get_heads() == ["e5b1d7a3c820"] and diretorio.get_revision("e5b1d7a3c820").down_revision == "c4a8e2f6d913"


# ------------------------------------------------------------------------------------------------ achados da conferência independente (2026-10-20)
def _so_comunicar(db):
    """Um nível com SÓ `comunicar` (a comunicação, sem `associados` nem `financeiro`)."""
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == "comunicar").one()
    nome = _nome("Comunicação Teste")
    nivel = NivelAcesso(nome_nivel=nome, descricao=nome, exige_mfa=False)
    db.add(nivel)
    db.flush()
    db.execute(perfil_permissao.insert().values(id_nivel=nivel.id_nivel, id_permissao=permissao.id_permissao))
    db.commit()
    return _criar_associado(db, _nome("Só Comunica"), nome_nivel=nome)[1]


def test_quem_so_tem_comunicar_nao_filtra_pela_situacao_nem_ve_os_nomes_de_um_grupo_por_situacao(client, db, auth_headers):
    devedor, _ = _criar_associado(db, _nome("Devedor Sigiloso"))
    db.add(TituloFinanceiro(tipo_titulo="A Receber", id_associado=devedor.id_associado, descricao="Mensalidade", valor_original=50, saldo_devedor=50,
                            data_vencimento=datetime.utcnow() - timedelta(days=120), status="Aberto"))
    db.commit()
    projeto = _projeto(db, equipe=[devedor])
    h = _headers(_so_comunicar(db))
    assert client.get("/api/avisos/opcoes-de-publico", headers=h).json()["situacoes"] == [], "a tela nem oferece as situações"
    por_situacao = _publico_do_projeto(projeto, situacoes=["Ativo - Inadimplente"])
    r = client.post("/api/avisos/conferir-publico", json={"publico": por_situacao}, headers=h)
    assert r.status_code == 403 and "associados" in r.json()["detail"]
    assert client.post("/api/avisos/", json=_corpo(por_situacao, 1), headers=h).status_code == 403
    # sem filtro de situação, publica normalmente
    assert client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto)}, headers=h).json()["total"] == 1
    # o aviso por situação que a Presidência publicou: quem só comunica vê os totais, não os nomes
    aviso = _publicar(client, auth_headers, por_situacao)
    assert aviso["nomes_ocultos"] is False and aviso["destinatarios"]
    visto = client.get(f"/api/avisos/{aviso['id_aviso']}", headers=h).json()
    assert visto["nomes_ocultos"] is True and visto["destinatarios"] == [] and visto["totais"]["destinatarios"] == 1


def test_calcular_categorias_em_lote_da_o_mesmo_que_uma_a_uma(client, db):
    from app.services.categoria_associado import calcular_categoria, calcular_categorias

    em_dia, _ = _criar_associado(db, _nome("Lote Em Dia"))
    devedor, _ = _criar_associado(db, _nome("Lote Devedor"))
    pago, _ = _criar_associado(db, _nome("Lote Pago"))
    licenca, _ = _criar_associado(db, _nome("Lote Licenca"))
    experiencia, _ = _criar_associado(db, _nome("Lote Experiencia"))
    dentro_da_tolerancia, _ = _criar_associado(db, _nome("Lote Atraso Curto"))
    vencido = datetime.utcnow() - timedelta(days=120)
    db.add(TituloFinanceiro(tipo_titulo="A Receber", id_associado=dentro_da_tolerancia.id_associado, descricao="M", valor_original=1, saldo_devedor=1,
                            data_vencimento=datetime.utcnow() - timedelta(days=5), status="Aberto"))
    db.add(TituloFinanceiro(tipo_titulo="A Receber", id_associado=devedor.id_associado, descricao="M", valor_original=1, saldo_devedor=1, data_vencimento=vencido, status="Aberto"))
    db.add(TituloFinanceiro(tipo_titulo="A Receber", id_associado=pago.id_associado, descricao="M", valor_original=1, saldo_devedor=0, data_vencimento=vencido, status="Pago"))
    db.add(TituloFinanceiro(tipo_titulo="A Receber", id_associado=licenca.id_associado, descricao="M", valor_original=1, saldo_devedor=1, data_vencimento=vencido, status="Aberto"))
    db.get(Associado, licenca.id_associado).data_fim_licenca = datetime.utcnow() + timedelta(days=5)
    db.get(Associado, experiencia.id_associado).data_fim_experiencia = datetime.utcnow() + timedelta(days=5)
    db.commit()
    todos = [db.get(Associado, a.id_associado) for a in (em_dia, devedor, pago, licenca, experiencia, dentro_da_tolerancia)]
    em_lote = calcular_categorias(db, todos)
    assert em_lote == {a.id_associado: calcular_categoria(db, a.id_associado) for a in todos}
    assert list(em_lote.values()) == ["Ativo - Em Dia", "Ativo - Inadimplente", "Ativo - Em Dia", "Licenciado", "Em Experiência", "Ativo - Em Dia"]


def test_desfazer_um_lote_cujo_associado_ja_recebeu_aviso_e_recusado_com_motivo(client, db, auth_headers):
    from tests.test_pessoas import _cpf_unico

    linhas = [{"nome_completo": _nome("Importado Avisado"), "cpf": _cpf_unico(), "categoria": "Efetivo", "resolucao": "nova"}]
    id_lote = client.post("/api/associados/importar-lote", headers=auth_headers, json={"linhas": linhas}).json()["id_lote"]
    importado = db.query(Associado).filter(Associado.id_lote_importacao == id_lote).one()
    _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[importado])))
    r = client.post(f"/api/associados/importar-lote/{id_lote}/desfazer", headers=auth_headers)
    assert r.status_code == 409 and "aviso" in r.json()["detail"]
    db.expire_all()
    assert db.get(Associado, importado.id_associado) is not None, "o cadastro (e a prova) ficam"


def test_no_modo_ver_como_abrir_o_aviso_nao_grava_a_leitura(client, db, auth_headers):
    from app.security import criar_access_token

    pessoa, usuario = _criar_associado(db, _nome("Vista Como"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").one()
    vendo_como = {"Authorization": f"Bearer {criar_access_token(usuario, id_nivel_impersonado=nivel.id_nivel)}"}
    aberto = client.get(f"/api/meus-avisos/{aviso['id_aviso']}", headers=vendo_como)
    assert aberto.status_code == 200 and aberto.json()["lido_em"] is None
    linha = client.get(f"/api/avisos/{aviso['id_aviso']}", headers=auth_headers).json()["destinatarios"][0]
    assert linha["lido_em"] is None


def test_aviso_vencido_nao_se_retira(client, db, auth_headers):
    pessoa, _ = _criar_associado(db, _nome("Vencido Nao Retira"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[pessoa])))
    db.get(Aviso, aviso["id_aviso"]).valido_ate = HOJE - timedelta(days=1)
    db.commit()
    r = client.post(f"/api/avisos/{aviso['id_aviso']}/retirar", json={"motivo": "Retirando um aviso já vencido."}, headers=auth_headers)
    assert r.status_code == 409 and "venceu" in r.json()["detail"]


def test_o_voluntario_alocado_como_pessoa_que_virou_associado_entra_no_grupo(client, db, auth_headers):
    pessoa = Pessoa(nome_completo=_nome("Voluntaria Que Se Associou"))
    db.add(pessoa)
    db.flush()
    projeto = ProjetoEvento(nome_projeto=_nome("Projeto Voluntaria"))
    db.add(projeto)
    db.flush()
    db.add(AlocacaoVoluntario(id_projeto=projeto.id_projeto, id_pessoa=pessoa.id_pessoa, id_associado=None, status="CONFIRMADA"))
    db.add(Associado(id_pessoa=pessoa.id_pessoa))  # depois se tornou associada; a alocação antiga não aponta para o associado
    db.commit()
    previa = client.post("/api/avisos/conferir-publico", json={"publico": _publico_do_projeto(projeto, partes=["voluntarios"])}, headers=auth_headers).json()
    assert [p["nome"] for p in previa["pessoas"]] == [pessoa.nome_completo]


def test_o_relatorio_diz_quem_ganhou_acesso_depois(client, db, auth_headers):
    associado = _associado_sem_acesso(db, _nome("Acesso Depois Sem Ler"))
    aviso = _publicar(client, auth_headers, _publico_do_projeto(_projeto(db, equipe=[associado])))
    antes = client.get(f"/api/avisos/{aviso['id_aviso']}", headers=auth_headers).json()["destinatarios"][0]
    assert (antes["tinha_acesso"], antes["tem_acesso_hoje"]) == (False, False)
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").one()
    usuario = Usuario(email=f"depois.{uuid.uuid4().hex[:6]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    db.get(Associado, associado.id_associado).id_usuario = usuario.id_usuario
    db.commit()
    depois = client.get(f"/api/avisos/{aviso['id_aviso']}", headers=auth_headers).json()["destinatarios"][0]
    assert (depois["tinha_acesso"], depois["tem_acesso_hoje"], depois["lido_em"]) == (False, True, None)


def test_o_aviso_sai_do_mural_no_fim_do_dia_em_belem():
    from app.models.comunicacao import Aviso as ModeloAviso

    aviso = ModeloAviso(valido_ate=date(2026, 10, 20), retirado_em=None)
    assert comunicacao.saiu_do_mural_em(aviso) == datetime(2026, 10, 21, 3, 0), "meia-noite de Belém = 03:00 UTC"
    aviso.retirado_em = datetime(2026, 10, 15, 12, 0)
    assert comunicacao.saiu_do_mural_em(aviso) == datetime(2026, 10, 15, 12, 0), "a retirada antes do fim conta"
