"""v9.5i - a credencial do associado (carteirinha) com QR que vale SEMPRE e mostra a situação de AGORA (decisão do Presidente, 14/11/2026)."""
import json
import uuid

from app.models.associados import Associado
from app.models.core import NivelAcesso, Usuario
from app.models.credencial import JUNCAO, PERDA_OU_TROCA, Credencial
from app.models.pessoas import Papel, Pessoa
from app.services import carteirinha
from app.services import credencial as credenciais
from tests.test_catalogos_permissao import _headers
from tests.test_pessoas import _cpf_unico

_JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b" imagem de teste"


def _associado(db, situacao="Ativo - Em Dia", com_login=True, foto=False, **campos):
    sufixo = uuid.uuid4().hex[:8]
    pessoa = Pessoa(
        nome_completo=f"Credencial {sufixo} de Teste", cpf=_cpf_unico(), email_contato=f"cred.{sufixo}@teste.local",
        telefone_whatsapp="91988887777",
    )
    db.add(pessoa)
    db.flush()
    db.add(Papel(id_pessoa=pessoa.id_pessoa, tipo_papel="associado", ativo=situacao != "Desligado"))
    usuario = None
    if com_login:
        nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
        usuario = Usuario(email=f"cred.{sufixo}@login.local", senha_hash="x", id_nivel=nivel.id_nivel, ativo=True)
        db.add(usuario)
        db.flush()
    associado = Associado(
        id_pessoa=pessoa.id_pessoa, status_arrolamento=situacao, categoria="Efetivo",
        id_usuario=usuario.id_usuario if usuario else None, numero_matricula=int(uuid.uuid4().int % 10**8) + 10**8, **campos,
    )
    db.add(associado)
    db.commit()
    if foto:
        from app.services import armazenamento

        nome = armazenamento.nome_aleatorio(".jpg")
        armazenamento.obter().salvar("fotos", nome, _JPEG)
        pessoa.foto = f"/uploads/fotos/{nome}"
        db.commit()
    return associado, pessoa, usuario


def _mensalidade_vencida(db, associado, dias=60):
    from datetime import datetime, timedelta

    from app.models.financeiro import TituloFinanceiro

    db.add(TituloFinanceiro(
        id_associado=associado.id_associado, tipo_titulo="Mensalidade", descricao="teste da credencial", valor_original=50, saldo_devedor=50,
        status="Pendente", data_vencimento=datetime.utcnow() - timedelta(days=dias),
    ))
    db.commit()


def _codigo(db, associado):
    c = credenciais.atual(db, associado)
    db.commit()
    return c.codigo


def test_minha_credencial_nasce_uma_vez_e_nao_leva_cpf_nem_contato(client, db):
    associado, pessoa, usuario = _associado(db)
    r = client.get("/api/minha-credencial", headers=_headers(usuario))
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert corpo["pagina"] == f"/credencial/{corpo['codigo']}" and len(corpo["codigo"]) >= 16
    assert corpo["nome_completo"] == pessoa.nome_completo and corpo["matricula"] == associado.numero_matricula
    assert corpo["situacao"] == "Ativo - Em Dia" and corpo["categoria"] == "Efetivo"
    texto = json.dumps(corpo)
    for proibido in (pessoa.cpf, "cred.", "91988887777"):
        assert proibido not in texto, proibido
    # abrir de novo devolve a MESMA credencial (o cartão impresso continua valendo)
    assert client.get("/api/minha-credencial", headers=_headers(usuario)).json()["codigo"] == corpo["codigo"]
    assert db.query(Credencial).filter(Credencial.id_associado == associado.id_associado).count() == 1


def test_quem_nao_e_associado_nao_tem_carteirinha(client, db):
    nivel = db.query(NivelAcesso).filter(NivelAcesso.nome_nivel == "Associado").first()
    usuario = Usuario(email=f"sem.cadastro.{uuid.uuid4().hex[:8]}@login.local", senha_hash="x", id_nivel=nivel.id_nivel, ativo=True)
    db.add(usuario)
    db.commit()
    assert client.get("/api/minha-credencial", headers=_headers(usuario)).status_code == 404
    assert client.get("/api/minha-credencial").status_code == 401


def test_quem_le_o_qr_ve_a_situacao_de_agora_sem_dado_de_contato(client, db):
    from datetime import datetime, timedelta

    daqui_a_um_mes = datetime.utcnow() + timedelta(days=30)
    casos = {
        "Ativo - Em Dia": ("em_dia", "Associado em dia", {}),
        "Em Experiência": ("em_dia", "Associado em experiência", {"data_fim_experiencia": daqui_a_um_mes}),
        "Ativo - Inadimplente": ("pendencia", "Associado com pendência", {}),
        "Suspenso (Estatuto)": ("pendencia", "Associado suspenso", {}),
        "Licenciado": ("pendencia", "Associado licenciado", {"data_fim_licenca": daqui_a_um_mes}),
    }
    for situacao, (estado, titulo, campos) in casos.items():
        associado, pessoa, _ = _associado(db, situacao, **campos)
        if situacao == "Ativo - Inadimplente":
            _mensalidade_vencida(db, associado)
        codigo = _codigo(db, associado)
        r = client.get(f"/api/publico/credencial/{codigo}")  # sem login
        assert r.status_code == 200
        corpo = r.json()
        assert (corpo["estado"], corpo["titulo"]) == (estado, titulo), situacao
        assert corpo["nome_completo"] == pessoa.nome_completo and corpo["matricula"] == associado.numero_matricula
        assert corpo["situacao"] == situacao and corpo["foto"] is None and corpo["conferido_em"]
        for chave in ("cpf", "email", "email_contato", "telefone_whatsapp", "endereco", "id_pessoa", "id_associado"):
            assert chave not in corpo, chave
        assert pessoa.cpf not in r.text


def test_a_situacao_e_calculada_na_hora_e_nao_a_guardada_no_cadastro(client, db):
    """Achado da conferência independente: o rótulo guardado só muda quando algo dispara o recálculo. A página calcula na hora (a regra do mural):
    passou da tolerância com mensalidade vencida -> pendência, mesmo com o cadastro ainda dizendo "em dia"; a licença que acabou -> em dia."""
    from datetime import datetime, timedelta

    associado, _, _ = _associado(db)
    codigo = _codigo(db, associado)
    assert client.get(f"/api/publico/credencial/{codigo}").json()["estado"] == "em_dia"
    _mensalidade_vencida(db, associado, dias=10)  # dentro da tolerância (30 dias): ainda em dia
    assert client.get(f"/api/publico/credencial/{codigo}").json()["estado"] == "em_dia"
    _mensalidade_vencida(db, associado, dias=45)
    corpo = client.get(f"/api/publico/credencial/{codigo}").json()
    assert (corpo["estado"], corpo["situacao"]) == ("pendencia", "Ativo - Inadimplente")
    db.refresh(associado)
    assert associado.status_arrolamento == "Ativo - Em Dia", "o cadastro não mudou: a página calculou"

    acabou, _, _ = _associado(db, "Licenciado", data_fim_licenca=datetime.utcnow() - timedelta(days=1))
    assert client.get(f"/api/publico/credencial/{_codigo(db, acabou)}").json()["titulo"] == "Associado em dia"


def test_nao_vale_sem_nome_nem_foto_e_com_o_mesmo_texto_nos_tres_casos(client, db):
    desligado, _, _ = _associado(db, "Desligado", foto=True)
    codigo_desligado = _codigo(db, desligado)
    trocado, _, _ = _associado(db, foto=True)
    antigo = _codigo(db, trocado)
    credenciais.emitir_outra(db, trocado, None)
    db.commit()
    respostas = [
        client.get(f"/api/publico/credencial/{c}").json()
        for c in (codigo_desligado, antigo, "codigoQueNaoExiste12345")
    ]
    for corpo in respostas:
        assert corpo["estado"] == "nao_vale" and corpo["titulo"] == "Esta credencial não vale"
        assert set(corpo) == {"estado", "titulo", "detalhe", "conferido_em"}, "nem nome, nem foto, nem situação"
    assert len({r["detalhe"] for r in respostas}) == 1, "a página não diz qual dos casos é"
    for c in (codigo_desligado, antigo):
        assert client.get(f"/api/publico/credencial/{c}/foto").status_code == 404


def test_emitir_outra_tira_a_anterior_na_hora(client, db):
    associado, _, _ = _associado(db)
    primeiro = _codigo(db, associado)
    anterior, nova = credenciais.emitir_outra(db, associado, None)
    db.commit()
    assert anterior.codigo == primeiro and anterior.motivo_substituicao == PERDA_OU_TROCA and anterior.substituida_em is not None
    assert nova.codigo != primeiro and credenciais.valendo(db, associado.id_associado).codigo == nova.codigo
    assert client.get(f"/api/publico/credencial/{nova.codigo}").json()["estado"] == "em_dia"
    assert client.get(f"/api/publico/credencial/{primeiro}").json()["estado"] == "nao_vale"


def test_a_foto_sai_so_pela_rota_que_confere_a_credencial(client, db):
    associado, pessoa, _ = _associado(db, foto=True)
    codigo = _codigo(db, associado)
    corpo = client.get(f"/api/publico/credencial/{codigo}").json()
    assert corpo["foto"] == f"/api/publico/credencial/{codigo}/foto"
    assert "/uploads/" not in json.dumps(corpo), "o endereço aberto da foto nunca sai"
    foto = client.get(corpo["foto"])
    assert foto.status_code == 200 and foto.content == _JPEG and foto.headers["cache-control"] == "no-store"


def test_portaria_e_assembleia_aceitam_o_codigo_e_o_endereco_lido_do_qr(db):
    associado, pessoa, _ = _associado(db)
    codigo = _codigo(db, associado)
    for lido in (codigo, f"https://painel.asaf.org.br/credencial/{codigo}", f"  https://painel.asaf.org.br/credencial/{codigo}/  ", f"/credencial/{codigo}?x=1"):
        payload = carteirinha.decodificar(db, lido)
        assert payload["id_pessoa"] == pessoa.id_pessoa and payload["exp"] is None, lido
    credenciais.emitir_outra(db, associado, None)
    db.commit()
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as erro:
        carteirinha.decodificar(db, codigo)
    assert erro.value.status_code == 400


def test_juncao_fica_uma_credencial_valendo(client, auth_headers, db):
    from tests.test_qualidade_cadastro import _dois_associados, _juntar

    # os dois têm credencial: a do juntado deixa de valer
    antigo, novo, id_fila = _dois_associados(client, db, "Credencial Dupla")
    c_antigo, c_novo = _codigo(db, antigo), _codigo(db, novo)
    assert _juntar(client, auth_headers, antigo, novo, id_fila, "Credencial Dupla N. da Silva").status_code == 200
    db.expire_all()
    assert credenciais.valendo(db, antigo.id_associado).codigo == c_antigo
    sai = credenciais.por_codigo(db, c_novo)
    assert sai.substituida_em is not None and sai.motivo_substituicao == JUNCAO
    assert client.get(f"/api/publico/credencial/{c_novo}").json()["estado"] == "nao_vale"

    # só o juntado tinha: a dele continua valendo, agora do cadastro que fica (o cartão na mão da pessoa não para)
    antigo2, novo2, id_fila2 = _dois_associados(client, db, "Credencial Unica")
    c_novo2 = _codigo(db, novo2)
    assert _juntar(client, auth_headers, antigo2, novo2, id_fila2, "Credencial Unica N. da Silva").status_code == 200
    db.expire_all()
    fica = credenciais.por_codigo(db, c_novo2)
    assert fica.substituida_em is None and fica.id_associado == antigo2.id_associado
    assert client.get(f"/api/publico/credencial/{c_novo2}").json()["estado"] == "em_dia"


def test_a_anonimizacao_apaga_as_credenciais(db):
    from datetime import datetime, timedelta

    from app.services.anonimizacao import anonimizar_associado

    associado, _, _ = _associado(db, "Desligado")
    associado.data_desligamento = datetime.utcnow() - timedelta(days=4000)
    db.commit()
    codigo = _codigo(db, associado)
    assert anonimizar_associado(db, associado, dias=1) is True
    assert credenciais.por_codigo(db, codigo) is None


def test_o_codigo_lido_aceita_so_o_formato_da_credencial():
    assert credenciais.codigo_lido("https://painel.asaf.org.br/credencial/AbCdEfGhIjKlMnOpQrStUv") == "AbCdEfGhIjKlMnOpQrStUv"
    for lixo in ("", None, "curto", "https://outro.site/qualquer", "a.b.c", "<script>alert(1)</script>xxxxxxxx"):
        assert credenciais.codigo_lido(lixo) is None, lixo
    assert credenciais.parece_credencial("eyJhbGciOi.eyJpZCI6MX0.assinatura") is False, "o QR antigo (JWT) segue pelo caminho antigo"


def test_emitir_outra_pela_ficha_exige_a_permissao_fica_na_auditoria_e_recusa_desligado(client, auth_headers, db):
    from app.models.core import AuditLog
    from tests.test_catalogos_permissao import _criar_usuario_com_permissao

    associado, _, _ = _associado(db)
    primeiro = client.get(f"/api/associados/{associado.id_associado}/carteirinha", headers=auth_headers).json()
    assert primeiro["emitida_em"] and primeiro["pagina"] == f"/credencial/{primeiro['codigo']}"
    so_financeiro = _headers(_criar_usuario_com_permissao(db, "financeiro"))
    assert client.post(f"/api/associados/{associado.id_associado}/credencial/emitir-outra", headers=so_financeiro).status_code == 403
    r = client.post(f"/api/associados/{associado.id_associado}/credencial/emitir-outra", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["codigo"] != primeiro["codigo"] and "deixou de valer" in r.json()["mensagem"]
    assert client.get(f"/api/publico/credencial/{primeiro['codigo']}").json()["estado"] == "nao_vale"
    assert db.query(AuditLog).filter(
        AuditLog.acao == "CREDENCIAL_EMITIDA_DE_NOVO", AuditLog.id_registro_afetado == associado.id_associado,
    ).count() == 1
    desligado, _, _ = _associado(db, "Desligado")
    assert client.post(f"/api/associados/{desligado.id_associado}/credencial/emitir-outra", headers=auth_headers).status_code == 409
    assert client.post("/api/associados/999999999/credencial/emitir-outra", headers=auth_headers).status_code == 404


def test_a_regra_dos_dias_diz_que_e_so_do_qr_antigo():
    """A descrição da regra na tela Regras do sistema não pode mais dizer que o QR da carteirinha vence: o texto de fábrica e o da migração são o novo."""
    import importlib.util
    from pathlib import Path

    raiz = Path(__file__).resolve().parent.parent
    fabrica = (raiz / "app" / "database.py").read_text(encoding="utf-8")
    especificacao = importlib.util.spec_from_file_location("v95i", raiz / "alembic" / "versions" / "c4e8a1f7d2b9_v9_5i_credenciais.py")
    migracao = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(migracao)
    assert migracao._TEXTO_NOVO in fabrica and migracao._TEXTO_ANTIGO not in fabrica
    assert "A credencial nova não vence" in migracao._TEXTO_NOVO
