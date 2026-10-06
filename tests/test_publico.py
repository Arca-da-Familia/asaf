"""v5.2 (FASE 5) - rotas públicas para o site: Diretoria e Conselho, Projetos e editais de assembleia.

Foco: o que NUNCA pode vazar (CPF, e-mail, telefone, responsável, centro de custo, link de acesso
remoto da assembleia) e o que NUNCA pode aparecer (mandato vencido, projeto interno, assembleia em
rascunho). Todas as rotas são sem autenticação - então a lista de campos de cada resposta é testada
por igualdade exata: campo novo no modelo não vira público por descuido."""
import hashlib
import uuid
from datetime import date, datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.mandatos import Mandato
from app.models.pessoas import Pessoa
from tests.apoio_mandatos import liberar_cargo
from app.routers import publico
from app.security import hash_senha

_ISO = "%Y-%m-%dT%H:%M:%S"
CAMPOS_DIRETORIA = {"orgao_codigo", "orgao", "cargo_codigo", "cargo", "nome", "data_inicio", "data_fim_previsto"}
CAMPOS_PROJETO = {
    "id_projeto", "nome", "descricao", "tipo_codigo", "tipo", "status_codigo", "status",
    "publico_alvo", "data_inicio", "data_fim_prevista", "destaque",
}
# v5.5: o detalhe traz também o contexto do projeto (edições/eventos, relatórios e documentos aprovados, fotos)
CAMPOS_DETALHE_DO_PROJETO = CAMPOS_PROJETO | {"eventos", "documentos", "fotos"}
CAMPOS_ASSEMBLEIA = {
    "id_assembleia", "tipo", "status", "pauta", "local_fisico", "convocada_em", "primeira_convocacao",
    "segunda_convocacao", "terceira_convocacao", "edital_texto", "edital_sha256",
}


def _dirigente(db, nome: str, cpf: str, email: str, telefone: str) -> Associado:
    """Associado com TODOS os dados pessoais preenchidos - para provar que nenhum vaza."""
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    pessoa = Pessoa(nome_completo=nome, cpf=cpf, email_contato=email, telefone_whatsapp=telefone, foto="/uploads/fotos/segredo.jpg")
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"login.{uuid.uuid4().hex[:8]}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    return associado


def _dar_posse(client, auth_headers, associado, orgao, cargo, inicio="2026-01-01", fim=None):
    corpo = {"id_associado": associado.id_associado, "orgao_codigo": orgao, "cargo_codigo": cargo, "data_inicio": inicio}
    if fim:
        corpo["data_fim_previsto"] = fim
    liberar_cargo(client, auth_headers, orgao, cargo)
    r = client.post("/api/mandatos/", headers=auth_headers, json=corpo)
    assert r.status_code == 200, r.text
    return r.json()["id_mandato"]


# ==========================================
# DIRETORIA E CONSELHO
# ==========================================
def test_diretoria_publica_nao_exige_login_e_traz_so_os_campos_permitidos(client, auth_headers, db):
    sufixo = uuid.uuid4().hex[:6]
    cpf, email, tel = f"9{uuid.uuid4().int % 10**10:010d}", f"segredo.{sufixo}@particular.com", "(94) 99999-0000"
    nome = f"Presidente Publico {sufixo}"
    _dar_posse(client, auth_headers, _dirigente(db, nome, cpf, email, tel), "DIRETORIA_EXECUTIVA", "PRESIDENTE")

    r = client.get("/api/publico/diretoria")  # SEM cabeçalho de autenticação
    assert r.status_code == 200, r.text
    linha = next(x for x in r.json() if x["nome"] == nome)
    assert set(linha) == CAMPOS_DIRETORIA
    assert (linha["orgao"], linha["cargo"]) == ("Diretoria Executiva", "Presidente")  # rótulos do catálogo, não códigos
    assert linha["data_fim_previsto"] == "2030-01-01"  # mandato de 4 anos (Art. 25/32)

    corpo = r.text
    for segredo in (cpf, email, tel, "segredo.jpg", "uploads"):
        assert segredo not in corpo, f"VAZOU na rota pública: {segredo}"


def test_diretoria_publica_ignora_mandato_vencido_e_encerrado(client, auth_headers, db):
    sufixo = uuid.uuid4().hex[:6]
    vencido = _dirigente(db, f"Ex Vencido {sufixo}", f"8{uuid.uuid4().int % 10**10:010d}", f"v{sufixo}@x.com", "1")
    _dar_posse(client, auth_headers, vencido, "CONSELHO_FISCAL", "CONSELHO_FISCAL", inicio="2000-01-01", fim="2004-01-01")
    encerrado = _dirigente(db, f"Ex Encerrado {sufixo}", f"7{uuid.uuid4().int % 10**10:010d}", f"e{sufixo}@x.com", "2")
    id_mandato = _dar_posse(client, auth_headers, encerrado, "DIRETORIA_EXECUTIVA", "SECRETARIO")
    mandato = db.query(Mandato).filter(Mandato.id_mandato == id_mandato).first()
    mandato.data_fim_efetivo = datetime.utcnow() - timedelta(days=1)
    db.commit()

    nomes = {x["nome"] for x in client.get("/api/publico/diretoria").json()}
    assert f"Ex Vencido {sufixo}" not in nomes
    assert f"Ex Encerrado {sufixo}" not in nomes


def test_diretoria_publica_ordena_pelo_catalogo_diretoria_antes_do_conselho(client, auth_headers, db):
    sufixo = uuid.uuid4().hex[:6]
    for orgao, cargo, nome in (
        ("CONSELHO_FISCAL", "CONSELHO_FISCAL", f"Conselheiro {sufixo}"),
        ("DIRETORIA_EXECUTIVA", "SECRETARIO", f"Secretario {sufixo}"),
        ("DIRETORIA_EXECUTIVA", "PRESIDENTE", f"Presidente {sufixo}"),
    ):
        _dar_posse(client, auth_headers, _dirigente(db, nome, f"6{uuid.uuid4().int % 10**10:010d}", f"o{uuid.uuid4().hex[:5]}@x.com", "3"), orgao, cargo)
    ordem = [x["nome"] for x in client.get("/api/publico/diretoria").json() if x["nome"].endswith(sufixo)]
    assert ordem == [f"Presidente {sufixo}", f"Secretario {sufixo}", f"Conselheiro {sufixo}"]


# ==========================================
# PROJETOS
# ==========================================
def _projeto(client, auth_headers, visibilidade, **extra):
    corpo = {
        "nome_projeto": f"Projeto {visibilidade} {uuid.uuid4().hex[:6]}", "tipo_foco": "Social",
        "necessita_alvara_bombeiros": False, "data_inicio": datetime.utcnow().strftime(_ISO),
        "data_fim_prevista": (datetime.utcnow() + timedelta(days=90)).strftime(_ISO),
        "visibilidade": visibilidade, **extra,
    }
    r = client.post("/projetos/", json=corpo, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id_projeto"], corpo["nome_projeto"]


def test_projetos_publicos_listam_so_os_publicos_com_campos_permitidos(client, auth_headers):
    id_publico, nome_publico = _projeto(client, auth_headers, "Pública", descricao="Aula de reforço.", publico_alvo="Crianças de 6 a 12 anos")
    id_interno, nome_interno = _projeto(client, auth_headers, "Interna")

    r = client.get("/api/publico/projetos")
    assert r.status_code == 200
    nomes = {p["nome"] for p in r.json()}
    assert nome_publico in nomes and nome_interno not in nomes

    projeto = next(p for p in r.json() if p["id_projeto"] == id_publico)
    assert set(projeto) == CAMPOS_PROJETO
    assert projeto["status"] == "Planejamento" and projeto["status_codigo"] == "PLANEJAMENTO"  # rótulo do catálogo
    assert projeto["publico_alvo"] == "Crianças de 6 a 12 anos"
    # Dado de gestão interna jamais aparece, nem com outro nome de campo.
    for proibido in ("responsavel", "centro_custo", "alvara", "orcamento", "visibilidade"):
        assert proibido not in r.text.lower()


def test_projeto_interno_ou_inexistente_responde_404_igual_nao_revela_que_existe(client, auth_headers):
    id_interno, _ = _projeto(client, auth_headers, "Interna")
    id_publico, _ = _projeto(client, auth_headers, "Pública")
    interno, inexistente = client.get(f"/api/publico/projetos/{id_interno}"), client.get("/api/publico/projetos/987654321")
    assert interno.status_code == inexistente.status_code == 404
    assert interno.json() == inexistente.json()
    detalhe = client.get(f"/api/publico/projetos/{id_publico}")
    assert detalhe.status_code == 200 and set(detalhe.json()) == CAMPOS_DETALHE_DO_PROJETO


# ==========================================
# ASSEMBLEIAS (edital)
# ==========================================
def _assembleia(client, auth_headers, convocar: bool, link_remoto=None, local="Sede da ASAF, Rua Paulo Afonso, 150"):
    corpo = {
        "tipo": "Ordinária", "pauta": f"Prestação de contas {uuid.uuid4().hex[:6]}",
        "data_hora_convocacao": (datetime.utcnow() + timedelta(days=20)).strftime(_ISO), "local_fisico": local,
    }
    if link_remoto:
        corpo["link_remoto"] = link_remoto
    r = client.post("/api/assembleias/", headers=auth_headers, json=corpo)
    assert r.status_code == 200, r.text
    id_assembleia = r.json()["id_assembleia"]
    if convocar:
        assert client.post(f"/api/assembleias/{id_assembleia}/convocar", headers=auth_headers).status_code == 200
    return id_assembleia, corpo["pauta"]


def test_assembleia_em_rascunho_nao_e_publica_so_a_convocada(client, auth_headers):
    id_rascunho, _ = _assembleia(client, auth_headers, convocar=False)
    id_convocada, pauta = _assembleia(client, auth_headers, convocar=True)

    lista = client.get("/api/publico/assembleias")
    assert lista.status_code == 200
    ids = {a["id_assembleia"] for a in lista.json()}
    assert id_convocada in ids and id_rascunho not in ids
    assert client.get(f"/api/publico/assembleias/{id_rascunho}").status_code == 404

    detalhe = client.get(f"/api/publico/assembleias/{id_convocada}").json()
    assert set(detalhe) == CAMPOS_ASSEMBLEIA
    assert detalhe["status"] == "Convocada" and pauta in detalhe["edital_texto"]
    assert "EDITAL DE CONVOCAÇÃO PARA ASSEMBLEIA GERAL" in detalhe["edital_texto"]  # Art. 9º, I


def test_edital_publico_nao_divulga_o_link_de_acesso_remoto(client, auth_headers):
    """O edital interno traz 'Acesso remoto: <link>' - publicar isso daria a sala a qualquer pessoa."""
    link = "https://meet.exemplo.org/sala-secreta-da-assembleia"
    id_assembleia, _ = _assembleia(client, auth_headers, convocar=True, link_remoto=link)

    interno = client.get(f"/api/assembleias/{id_assembleia}/edital", headers=auth_headers).json()["edital_texto"]
    assert link in interno  # prova do pressuposto: o texto interno TEM o link

    publico = client.get(f"/api/publico/assembleias/{id_assembleia}")
    assert link not in publico.text and "Acesso remoto" not in publico.text and "meet.exemplo" not in publico.text
    assert "link_remoto" not in publico.json()
    assert "Local: Sede da ASAF" in publico.json()["edital_texto"]  # o local físico continua (Art. 9º, III)


def test_hash_do_edital_confere_com_o_texto_publicado(client, auth_headers):
    id_assembleia, _ = _assembleia(client, auth_headers, convocar=True, link_remoto="https://meet.exemplo.org/x")
    dados = client.get(f"/api/publico/assembleias/{id_assembleia}").json()
    assert dados["edital_sha256"] == hashlib.sha256(dados["edital_texto"].encode("utf-8")).hexdigest()
    # Determinístico: a mesma consulta dá o mesmo comprovante.
    assert client.get(f"/api/publico/assembleias/{id_assembleia}").json()["edital_sha256"] == dados["edital_sha256"]


def test_texto_publico_do_edital_so_remove_a_parte_do_link():
    original = "ASAF\nLocal: Sede | Acesso remoto: https://x.org/y\nAssociados aptos: 3\n"
    assert publico.texto_publico_do_edital(original) == "ASAF\nLocal: Sede\nAssociados aptos: 3\n"
    sem_link = "Local: Sede\nOrdem do dia: Acesso remoto de membros\n"
    assert publico.texto_publico_do_edital(sem_link) == sem_link  # não confunde pauta com o link


# ==========================================
# FRONTEIRA: o roteador público é só leitura
# ==========================================
def test_o_roteador_publico_so_tem_rotas_get():
    metodos = {m for rota in publico.router.routes for m in rota.methods}
    assert metodos <= {"GET", "HEAD"}, f"rota de escrita no roteador público: {metodos}"


def test_rotas_publicas_novas_recusam_escrita(client):
    for caminho in ("/api/publico/diretoria", "/api/publico/projetos", "/api/publico/assembleias"):
        for metodo in (client.post, client.put, client.delete):
            assert metodo(caminho).status_code == 405, (caminho, metodo.__name__)
