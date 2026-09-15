"""v2.7 (FASE 2) - processo disciplinar (Art. 16/17 do estatuto real): ampla defesa como trava
de verdade, decisão colegiada por maioria da Diretoria Executiva, escalada automática da 4ª
advertência (Art. 17, I), eliminação sempre pendente de homologação da Assembleia (Art. 17,
Parágrafo Único) e confidencialidade do processo."""
from datetime import datetime, timedelta

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.disciplina import DECIDIDO, ProcessoDisciplinar
from app.models.mandatos import Mandato
from app.models.pessoas import Pessoa
from app.security import criar_access_token, hash_senha


def _criar_associado(db, nome, nivel="Associado") -> tuple[Associado, Usuario]:
    nivel_obj = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == nivel).first()
    pessoa = Pessoa(nome_completo=nome)
    db.add(pessoa)
    db.flush()
    usuario = Usuario(email=f"{nome.lower().replace(' ', '.')}@teste.local", senha_hash=hash_senha("SenhaForte123456"), id_nivel=nivel_obj.id_nivel, ativo=True)
    db.add(usuario)
    db.flush()
    associado = Associado(id_pessoa=pessoa.id_pessoa, id_usuario=usuario.id_usuario)
    db.add(associado)
    db.commit()
    db.refresh(associado)
    return associado, usuario


def _criar_diretor(db, nome, cargo="SECRETARIO") -> tuple[Associado, Usuario]:
    associado, usuario = _criar_associado(db, nome, nivel="Diretoria")
    db.add(Mandato(
        id_associado=associado.id_associado, orgao_codigo="DIRETORIA_EXECUTIVA", cargo_codigo=cargo,
        data_inicio=datetime.utcnow() - timedelta(days=1), data_fim_previsto=datetime.utcnow() + timedelta(days=365),
    ))
    db.commit()
    return associado, usuario


def _headers(usuario: Usuario) -> dict:
    return {"Authorization": f"Bearer {criar_access_token(usuario)}"}


def _isolar_diretoria(db) -> None:
    """Expira todo mandato de Diretoria Executiva ainda vigente de OUTROS testes/arquivos
    (mesmo banco cumulativo da sessão de teste) - sem isso, `diretores_aptos` cresce a cada
    teste e o quórum de maioria fica imprevisível (achado real ao escrever esta suíte)."""
    ontem = datetime.utcnow() - timedelta(days=1)
    for m in db.query(Mandato).filter(Mandato.orgao_codigo == "DIRETORIA_EXECUTIVA").all():
        if m.vigente():
            m.data_fim_previsto = ontem
    db.commit()


def _criar_diretoria_para_maioria(db, prefixo: str, quantidade: int = 3) -> list[tuple[Associado, Usuario]]:
    _isolar_diretoria(db)
    return [_criar_diretor(db, f"{prefixo} {i}") for i in range(quantidade)]


def _abrir_processo(client, auth_headers, id_associado) -> int:
    r = client.post(
        "/api/processos-disciplinares/", headers=auth_headers,
        json={"id_associado": id_associado, "motivo_codigo": "COMPORTAMENTO_ANTISSOCIAL", "descricao": "Conduta incompatível relatada por dois associados na última reunião."},
    )
    assert r.status_code == 200, r.text
    return r.json()["id_processo"]


def _decidir_com_maioria(client, auth_headers, id_processo, diretores, pena_proposta):
    for _associado, usuario in diretores:
        r = client.post(f"/api/processos-disciplinares/{id_processo}/manifestacoes", headers=_headers(usuario), json={"pena_proposta": pena_proposta, "justificativa": "Conforme apurado."})
        assert r.status_code == 200, r.text
    return client.post(f"/api/processos-disciplinares/{id_processo}/decidir", headers=auth_headers, json={"texto_decisao": "Decisão fundamentada nos elementos apresentados pelo processo."})


def test_abrir_processo_motivo_invalido_falha(client, auth_headers, db):
    acusado, _ = _criar_associado(db, "Acusado Motivo Invalido")
    r = client.post(
        "/api/processos-disciplinares/", headers=auth_headers,
        json={"id_associado": acusado.id_associado, "motivo_codigo": "MOTIVO_QUE_NAO_EXISTE", "descricao": "Descrição qualquer com tamanho suficiente."},
    )
    assert r.status_code == 400


def test_nao_pode_decidir_antes_do_prazo_de_defesa_sem_defesa_apresentada(client, auth_headers, db):
    acusado, _ = _criar_associado(db, "Acusado Prazo Defesa")
    diretor1, u1 = _criar_diretor(db, "Diretor Prazo Um")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)

    r_manifestar = client.post(f"/api/processos-disciplinares/{id_processo}/manifestacoes", headers=_headers(u1), json={"pena_proposta": "Advertência"})
    assert r_manifestar.status_code == 400
    assert "prazo de defesa" in r_manifestar.json()["detail"].lower()


def test_defesa_apresentada_libera_julgamento_antes_do_prazo_esgotar(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Apresenta Defesa")
    diretores = _criar_diretoria_para_maioria(db, "Diretor Defesa")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)

    r_defesa = client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Nego integralmente os fatos narrados na abertura do processo."})
    assert r_defesa.status_code == 200, r_defesa.text

    r = _decidir_com_maioria(client, auth_headers, id_processo, diretores, "Advertência")
    assert r.status_code == 200, r.text
    assert r.json()["pena_aplicada"] == "Advertência"


def test_acusado_nao_pode_se_manifestar_mesmo_sendo_diretor(client, auth_headers, db):
    acusado_diretor, usuario_acusado = _criar_diretor(db, "Diretor Acusado")
    id_processo = _abrir_processo(client, auth_headers, acusado_diretor.id_associado)
    client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Minha defesa sobre os fatos narrados no processo."})

    r = client.post(f"/api/processos-disciplinares/{id_processo}/manifestacoes", headers=_headers(usuario_acusado), json={"pena_proposta": None})
    assert r.status_code == 403


def test_decidir_sem_quorum_falha(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Sem Quorum")
    diretor1, u1 = _criar_diretor(db, "Diretor Quorum Um")
    diretor2, u2 = _criar_diretor(db, "Diretor Quorum Dois")
    diretor3, u3 = _criar_diretor(db, "Diretor Quorum Tres")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)
    client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Defesa apresentada para liberar o julgamento no teste."})

    client.post(f"/api/processos-disciplinares/{id_processo}/manifestacoes", headers=_headers(u1), json={"pena_proposta": "Advertência"})
    r = client.post(f"/api/processos-disciplinares/{id_processo}/decidir", headers=auth_headers, json={"texto_decisao": "Tentativa de decisão sem quórum suficiente."})
    assert r.status_code == 400
    assert "quórum" in r.json()["detail"].lower()


def test_quarta_advertencia_escalona_automaticamente_para_suspensao(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Quarta Advertencia")
    diretores = _criar_diretoria_para_maioria(db, "Diretor Escalada")

    for i in range(3):
        db.add(ProcessoDisciplinar(
            id_associado=acusado.id_associado, motivo_codigo="VIOLACAO_ESTATUTO", descricao=f"Processo anterior {i}",
            status=DECIDIDO, prazo_defesa_ate=datetime.utcnow(), pena_aplicada="Advertência", decidido_em=datetime.utcnow(),
        ))
    db.commit()

    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)
    client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Defesa apresentada para a quarta ocorrência de advertência."})
    r = _decidir_com_maioria(client, auth_headers, id_processo, diretores, "Advertência")

    assert r.status_code == 200, r.text
    assert r.json()["pena_aplicada"] == "Suspensão"
    assert r.json()["escalada_automatica"] is True

    db.expire_all()
    associado_depois = db.query(Associado).filter(Associado.id_associado == acusado.id_associado).first()
    assert associado_depois.status_arrolamento == "Suspenso (Estatuto)"


def test_suspensao_materializa_status_e_prazo(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Suspensao Direta")
    diretores = _criar_diretoria_para_maioria(db, "Diretor Suspensao")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)
    client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Defesa apresentada quanto à alegada infração."})

    r = _decidir_com_maioria(client, auth_headers, id_processo, diretores, "Suspensão")
    assert r.status_code == 200, r.text
    assert r.json()["pena_aplicada"] == "Suspensão"
    assert r.json()["suspensao_dias"] == 30

    db.expire_all()
    associado_depois = db.query(Associado).filter(Associado.id_associado == acusado.id_associado).first()
    assert associado_depois.status_arrolamento == "Suspenso (Estatuto)"


def test_eliminacao_exige_homologacao_antes_de_desligar(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Eliminacao")
    diretores = _criar_diretoria_para_maioria(db, "Diretor Eliminacao")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)
    client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Defesa apresentada quanto à proposta de eliminação."})

    r = _decidir_com_maioria(client, auth_headers, id_processo, diretores, "Eliminação do quadro social")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "Aguardando homologação da Assembleia"

    db.expire_all()
    associado_ainda_ativo = db.query(Associado).filter(Associado.id_associado == acusado.id_associado).first()
    assert associado_ainda_ativo.status_arrolamento != "Desligado"

    r_recusa = client.post(f"/api/processos-disciplinares/{id_processo}/homologar", headers=auth_headers, json={"aprovado": False, "justificativa": "Assembleia recusou a eliminação por maioria dos presentes."})
    assert r_recusa.json()["status"] == "Rejeitado pela Assembleia"
    db.expire_all()
    associado_apos_recusa = db.query(Associado).filter(Associado.id_associado == acusado.id_associado).first()
    assert associado_apos_recusa.status_arrolamento != "Desligado"


def test_eliminacao_homologada_desliga_associado(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Eliminacao Homologada")
    diretores = _criar_diretoria_para_maioria(db, "Diretor Homolog")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)
    client.post(f"/api/processos-disciplinares/{id_processo}/defesa", headers=_headers(usuario_acusado), json={"texto": "Defesa apresentada quanto à proposta de eliminação homologada."})
    _decidir_com_maioria(client, auth_headers, id_processo, diretores, "Eliminação do quadro social")

    r_homologa = client.post(f"/api/processos-disciplinares/{id_processo}/homologar", headers=auth_headers, json={"aprovado": True, "justificativa": "Assembleia homologou a eliminação por maioria dos presentes."})
    assert r_homologa.status_code == 200, r_homologa.text
    assert r_homologa.json()["status"] == "Homologado"

    db.expire_all()
    associado_depois = db.query(Associado).filter(Associado.id_associado == acusado.id_associado).first()
    assert associado_depois.status_arrolamento == "Desligado"


def test_confidencialidade_processo_visivel_so_para_acusado_e_orgao_julgador(client, auth_headers, db):
    acusado, usuario_acusado = _criar_associado(db, "Acusado Confidencial")
    terceiro, usuario_terceiro = _criar_associado(db, "Terceiro Curioso")
    id_processo = _abrir_processo(client, auth_headers, acusado.id_associado)

    r_terceiro = client.get(f"/api/processos-disciplinares/{id_processo}", headers=_headers(usuario_terceiro))
    assert r_terceiro.status_code == 404

    r_acusado = client.get(f"/api/processos-disciplinares/{id_processo}", headers=_headers(usuario_acusado))
    assert r_acusado.status_code == 200

    r_diretoria = client.get(f"/api/processos-disciplinares/{id_processo}", headers=auth_headers)
    assert r_diretoria.status_code == 200
