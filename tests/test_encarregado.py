"""v7.0a (FASE 7) - o encarregado pelo tratamento de dados com ato formal e substituto (Resolução CD/ANPD nº 18/2024; ver app/services/encarregado.py).

  1. ver (`privacidade`) é da Presidência e dos cargos de Presidente e Vice-Presidentes; gerar e registrar (`privacidade_gerir`) só da Presidência e do cargo de
     Presidente (o Vice-Presidente vê, mas não troca o ato); quem não tem nada é barrado em tudo do módulo;
  2. o encarregado e o substituto saem dos mandatos vigentes (o 1º Vice-Presidente; o 2º na falta dele), contados pelo dia de Belém; sem Presidente o ato é recusado;
  3. o ato guarda o texto gerado; gerar outro descarta o que não foi assinado; a cópia assinada torna o ato vigente e o anterior fica substituído;
  4. registrar a assinatura confere que o ato ainda nomeia quem os mandatos dizem;
  5. os avisos dizem o que falta; o PDF tem o texto guardado e página nova quando o texto não cabe;
  6. gerar, assinar e baixar a cópia assinada vão para a Auditoria; a cópia assinada nunca sai pelo endereço público `/uploads`;
  7. os dados fixos da associação no ato são os mesmos do site;
  8. a migração 56d7ae211884 dá as duas permissões a quem tem `gerenciar_acesso`, `privacidade` aos três cargos e `privacidade_gerir` só ao de Presidente, e cria
     exatamente a tabela que o modelo descreve."""
import importlib.util
import io
import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pypdf
import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations

import app.models  # noqa: F401
from app.database import Base
from app.models.core import AuditLog, Catalogo, NivelAcesso, OpcaoCatalogo, PermissaoSistema, perfil_permissao
from app.models.mandatos import Mandato
from app.models.privacidade import DESCARTADO, RASCUNHO, SUBSTITUIDO, VIGENTE, AtoDoEncarregado
from app.services import encarregado
from tests.test_conselho_fiscal import _criar_associado, _headers

_PDF = b"%PDF-1.4\n%assinado\n"
# os mandatos dos testes de serviço moram num futuro distante, onde nenhum outro teste da suíte (banco compartilhado) tem mandato
_FUTURO = datetime(2150, 1, 1, 2, 0)


def _nome(prefixo: str) -> str:
    return f"{prefixo} {uuid.uuid4().hex[:6]}"


def _mandato(db, associado, cargo: str, inicio: datetime, dias: int = 365) -> Mandato:
    mandato = Mandato(
        id_associado=associado.id_associado, orgao_codigo="DIRETORIA_EXECUTIVA", cargo_codigo=cargo, data_inicio=inicio, data_fim_previsto=inicio + timedelta(days=dias),
    )
    db.add(mandato)
    db.commit()
    return mandato


@pytest.fixture()
def sem_atos(db):
    """Os atos são do sistema todo (há um só vigente): cada teste começa sem ato vigente nem aguardando assinatura."""
    for ato in db.query(AtoDoEncarregado).filter(AtoDoEncarregado.situacao.in_((VIGENTE, RASCUNHO))).all():
        ato.situacao = SUBSTITUIDO if ato.situacao == VIGENTE else DESCARTADO
    db.commit()


def _codigos(situacao: dict) -> set[str]:
    return {a["codigo"] for a in situacao["avisos"]}


# ------------------------------------------------------------------------------------------------ 1. a permissão
@pytest.mark.parametrize("codigo, cargos_esperados", [
    ("privacidade", {"PRESIDENTE", "VICE_PRESIDENTE", "VICE_PRESIDENTE_2"}),
    ("privacidade_gerir", {"PRESIDENTE"}),
])
def test_por_padrao_ver_e_da_presidencia_e_dos_vices_e_gerir_so_da_presidencia(db, codigo, cargos_esperados):
    permissao = db.query(PermissaoSistema).filter(PermissaoSistema.codigo_permissao == codigo).one()
    assert permissao.modulo == "privacidade"
    niveis = {
        n for (n,) in db.query(NivelAcesso.nome_nivel).join(perfil_permissao, perfil_permissao.c.id_nivel == NivelAcesso.id_nivel)
        .filter(perfil_permissao.c.id_permissao == permissao.id_permissao).all()
    }
    semeados = {"Presidente", "Diretoria", "Conselho Fiscal", "Associado", "Voluntário Externo", "Documentos - preparo", "Documentos - originais sigilosos",
                "Publicação - aprovação", "Parcerias e emendas - gestão"}
    assert niveis & semeados == {"Presidente"}, niveis
    cargos = {
        o.codigo for o in db.query(OpcaoCatalogo).join(Catalogo, Catalogo.id_catalogo == OpcaoCatalogo.id_catalogo).filter(Catalogo.chave == "titulo_cargo").all()
        if codigo in (o.metadados or {}).get("permissoes", [])
    }
    assert cargos == cargos_esperados, cargos


def test_quem_nao_tem_privacidade_e_barrado_em_tudo_do_modulo(client, db):
    _, diretor = _criar_associado(db, _nome("Diretor Sem Privacidade"), nome_nivel="Diretoria")
    h = _headers(diretor)
    assert client.get("/api/privacidade/encarregado", headers=h).status_code == 403
    assert client.post("/api/privacidade/encarregado/atos", headers=h).status_code == 403
    assert client.get("/api/privacidade/encarregado/atos/1/pdf", headers=h).status_code == 403
    assert client.post("/api/privacidade/encarregado/atos/1/assinado", files={"arquivo": ("a.pdf", _PDF, "application/pdf")}, headers=h).status_code == 403
    assert client.get("/api/privacidade/encarregado/atos/1/assinado", headers=h).status_code == 403
    assert client.get("/api/privacidade/encarregado").status_code == 401


def test_o_vice_presidente_ve_pelo_cargo_mas_nao_gera_nem_registra(client, db):
    vice, usuario = _criar_associado(db, _nome("Vice Pelo Cargo"), nome_nivel="Associado")
    h = _headers(usuario)
    assert client.get("/api/privacidade/encarregado", headers=h).status_code == 403, "sem o mandato, o nível Associado não tem"
    mandato = _mandato(db, vice, "VICE_PRESIDENTE_2", datetime.utcnow() - timedelta(days=400), dias=380)  # já venceu
    assert client.get("/api/privacidade/encarregado", headers=h).status_code == 403, "mandato vencido não dá a permissão"
    mandato.data_fim_previsto = datetime.utcnow() + timedelta(days=30)
    db.commit()
    try:
        visto = client.get("/api/privacidade/encarregado", headers=h)
        assert visto.status_code == 200 and visto.json()["pode_gerir"] is False
        assert client.post("/api/privacidade/encarregado/atos", headers=h).status_code == 403
        assert client.post("/api/privacidade/encarregado/atos/1/assinado", files={"arquivo": ("a.pdf", _PDF, "application/pdf")}, headers=h).status_code == 403
    finally:
        mandato.data_fim_efetivo = datetime.utcnow()  # não deixa um Vice-Presidente vigente no banco compartilhado
        db.commit()


# ------------------------------------------------------------------------------------------------ 2 a 5. o ciclo do ato (serviço, num futuro distante)
def test_o_ciclo_do_ato_do_encarregado(db, sem_atos):
    _, usuario = _criar_associado(db, _nome("Quem Gera"), nome_nivel="Presidente")

    # sem Presidente: o aviso diz e o ato é recusado
    situacao = encarregado.situacao(db, _FUTURO)
    assert situacao["encarregado"] is None and {"SEM_PRESIDENTE", "SEM_ATO", "SEM_SUBSTITUTO"} <= _codigos(situacao)
    with pytest.raises(Exception) as recusa:
        encarregado.gerar(db, usuario, _FUTURO)
    assert getattr(recusa.value, "status_code", None) == 409 and "Mandatos" in recusa.value.detail

    presidente, _ = _criar_associado(db, _nome("Presidente Futuro"))
    vice2, _ = _criar_associado(db, _nome("Segundo Vice"))
    _mandato(db, presidente, "PRESIDENTE", _FUTURO - timedelta(days=10))
    _mandato(db, vice2, "VICE_PRESIDENTE_2", _FUTURO - timedelta(days=10))
    situacao = encarregado.situacao(db, _FUTURO)
    assert situacao["encarregado"]["nome"] == presidente.nome_completo
    assert situacao["substituto"]["nome"] == vice2.nome_completo and situacao["substituto"]["cargo"] == "2º Vice-Presidente", "sem o 1º, o 2º substitui"

    primeiro, descartado = encarregado.gerar(db, usuario, _FUTURO)
    assert descartado is None and primeiro.situacao == RASCUNHO
    assert presidente.nome_completo in primeiro.texto and vice2.nome_completo in primeiro.texto
    assert f"ATO Nº {primeiro.numero}" in primeiro.texto and "Resolução CD/ANPD nº 18" in primeiro.texto and "art. 19, § 1º, II" in primeiro.texto
    assert "31 de dezembro de 2149" in primeiro.texto, "a data do ato é o dia em Belém (02:00 UTC de 1º de janeiro ainda é 31 de dezembro lá)"
    assert "Este é o primeiro ato" in primeiro.texto
    assert {"AGUARDANDO_ASSINATURA", "SEM_ATO"} <= _codigos(encarregado.situacao(db, _FUTURO))

    # o 1º Vice-Presidente chega: ele passa a ser o substituto e o ato impresso antes não pode mais ser assinado
    vice1, _ = _criar_associado(db, _nome("Primeiro Vice"))
    _mandato(db, vice1, "VICE_PRESIDENTE", _FUTURO - timedelta(days=1))
    assert encarregado.situacao(db, _FUTURO)["substituto"]["nome"] == vice1.nome_completo
    with pytest.raises(Exception) as recusa:
        encarregado.registrar_assinatura(db, usuario, primeiro.id_ato, "ato.pdf", _PDF, _FUTURO)
    assert getattr(recusa.value, "status_code", None) == 409 and "substituto mudou" in recusa.value.detail

    segundo, descartado = encarregado.gerar(db, usuario, _FUTURO)
    db.refresh(primeiro)
    assert descartado.id_ato == primeiro.id_ato and primeiro.situacao == DESCARTADO and primeiro.encerrado_em is not None
    assert segundo.numero == primeiro.numero + 1 and vice1.nome_completo in segundo.texto

    # arquivo que não é PDF/JPG/PNG de verdade é recusado e nada muda
    with pytest.raises(Exception) as recusa:
        encarregado.registrar_assinatura(db, usuario, segundo.id_ato, "ato.pdf", b"isto nao e um pdf", _FUTURO)
    assert getattr(recusa.value, "status_code", None) == 400
    db.refresh(segundo)
    assert segundo.situacao == RASCUNHO

    vigente, anterior = encarregado.registrar_assinatura(db, usuario, segundo.id_ato, "Ato assinado.pdf", _PDF, _FUTURO)
    assert anterior is None and vigente.situacao == VIGENTE and vigente.assinado_sha256 and vigente.assinado_nome_arquivo == "Ato assinado.pdf"
    assert encarregado.ler_copia_assinada(vigente) == _PDF
    assert not {"SEM_ATO", "AGUARDANDO_ASSINATURA", "SEM_SUBSTITUTO", "ATO_DE_OUTRA_PESSOA", "SUBSTITUTO_DIFERENTE"} & _codigos(encarregado.situacao(db, _FUTURO))
    with pytest.raises(Exception) as recusa:
        encarregado.registrar_assinatura(db, usuario, vigente.id_ato, "de-novo.pdf", _PDF, _FUTURO)
    assert getattr(recusa.value, "status_code", None) == 409, "o ato vigente não recebe outra cópia"

    # todos os mandatos venceram: o aviso não diz que o ato "designa só pelo cargo" (ele nomeia alguém que não tem mais o cargo)
    sem_ninguem = [a["texto"] for a in encarregado.situacao(db, _FUTURO + timedelta(days=370))["avisos"] if a["codigo"] == "SEM_SUBSTITUTO"]
    assert sem_ninguem and vice1.nome_completo in sem_ninguem[0] and "não tem mais o cargo" in sem_ninguem[0]

    # o mandato muda: o aviso aponta o ato de outra pessoa; o novo ato revoga o anterior, que fica como substituído
    depois = _FUTURO + timedelta(days=400)
    novo_presidente, _ = _criar_associado(db, _nome("Novo Presidente"))
    _mandato(db, novo_presidente, "PRESIDENTE", depois - timedelta(days=5))
    _mandato(db, vice1, "VICE_PRESIDENTE", depois - timedelta(days=5))
    assert "ATO_DE_OUTRA_PESSOA" in _codigos(encarregado.situacao(db, depois))
    terceiro, _ = encarregado.gerar(db, usuario, depois)
    assert f"revoga o Ato nº {vigente.numero}" in terceiro.texto and novo_presidente.nome_completo in terceiro.texto
    novo_vigente, substituido = encarregado.registrar_assinatura(db, usuario, terceiro.id_ato, "foto.jpg", b"\xff\xd8\xff\xe0fotodopapel", depois)
    db.refresh(vigente)
    assert substituido.id_ato == vigente.id_ato and vigente.situacao == SUBSTITUIDO and novo_vigente.situacao == VIGENTE
    assert {a["situacao"] for a in encarregado.situacao(db, depois)["historico"] if a["id_ato"] in (primeiro.id_ato, segundo.id_ato, terceiro.id_ato)} == {
        DESCARTADO, SUBSTITUIDO, VIGENTE,
    }


def test_o_ato_impresso_antes_de_mudar_o_presidente_nao_pode_ser_assinado(db, sem_atos):
    _, usuario = _criar_associado(db, _nome("Quem Gera"), nome_nivel="Presidente")
    momento = _FUTURO + timedelta(days=3000)
    antigo, _ = _criar_associado(db, _nome("Presidente Que Sai"))
    mandato = _mandato(db, antigo, "PRESIDENTE", momento - timedelta(days=10))
    ato, _ = encarregado.gerar(db, usuario, momento)
    mandato.data_fim_efetivo = momento - timedelta(days=1)  # renunciou
    novo, _ = _criar_associado(db, _nome("Presidente Que Entra"))
    _mandato(db, novo, "PRESIDENTE", momento - timedelta(days=1))
    with pytest.raises(Exception) as recusa:
        encarregado.registrar_assinatura(db, usuario, ato.id_ato, "ato.pdf", _PDF, momento)
    assert getattr(recusa.value, "status_code", None) == 409 and antigo.nome_completo in recusa.value.detail


def test_o_ato_cita_o_estatuto_so_no_que_ele_diz_e_o_art_15_como_e(db, sem_atos):
    _, usuario = _criar_associado(db, _nome("Quem Gera"), nome_nivel="Presidente")
    momento = _FUTURO + timedelta(days=6000)
    presidente, _ = _criar_associado(db, _nome("Presidente Do Texto"))
    _mandato(db, presidente, "PRESIDENTE", momento - timedelta(days=10))
    sem_nome, _ = encarregado.gerar(db, usuario, momento)
    assert "o 1º Vice-Presidente em exercício e, na falta dele, o 2º Vice-Presidente em exercício (o Estatuto, art. 21, parágrafo único, atribui aos" in sem_nome.texto
    vice, _ = _criar_associado(db, _nome("Vice Do Texto"))
    _mandato(db, vice, "VICE_PRESIDENTE", momento - timedelta(days=10))
    ato, _ = encarregado.gerar(db, usuario, momento)
    texto = " ".join(ato.texto.split())
    assert "O Estatuto (art. 21, parágrafo único) atribui aos Vice-Presidentes a substituição do Presidente em suas faltas e impedimentos" in texto
    assert "na falta dele, o 2º (Estatuto" not in texto, "o Estatuto não põe ordem entre os Vice-Presidentes"
    assert "III - orientar os funcionários e os contratados da associação" in texto and "IV - executar as demais atribuições" in texto
    assert "os pedidos feitos pelo formulário ficam registrados" in texto, "o e-mail não vira protocolo sozinho"
    assert "(art. 21, parágrafo único, II), a reclamação de titular ou a comunicação da ANPD que questione decisão tomada pelo próprio Presidente" in texto
    assert "é encaminhada pelo encarregado ao substituto designado no item 2, que a examina e responde" in texto
    assert "revisão anual" not in texto and "sem outra pessoa" not in texto


def test_o_mandato_que_comeca_amanha_em_belem_ainda_nao_conta(db):
    presidente, _ = _criar_associado(db, _nome("Presidente De Amanha"))
    _mandato(db, presidente, "PRESIDENTE", datetime(2160, 3, 10))
    vespera_em_belem = datetime(2160, 3, 10, 1, 30)  # 22h30 do dia 9 em Belém, já dia 10 em UTC
    assert encarregado.quem_e_hoje(db, vespera_em_belem)[0] is None
    assert encarregado.quem_e_hoje(db, datetime(2160, 3, 10, 3, 0))[0]["nome"] == presidente.nome_completo


def test_dois_atos_com_o_mesmo_numero_viram_409_e_nao_erro_500(db):
    _, usuario = _criar_associado(db, _nome("Quem Gera"), nome_nivel="Presidente")
    presidente, _ = _criar_associado(db, _nome("Presidente Do Conflito"))
    numero = 9_000_000 + int(uuid.uuid4().int % 100000)
    for _ in range(2):  # como se dois cliques ao mesmo tempo tivessem calculado o mesmo número
        db.add(AtoDoEncarregado(numero=numero, situacao=DESCARTADO, texto="x", id_associado_encarregado=presidente.id_associado, nome_encarregado="x",
                                gerado_em=_FUTURO, id_usuario_geracao=usuario.id_usuario))
    with pytest.raises(Exception) as recusa:
        encarregado._gravar(db)
    assert getattr(recusa.value, "status_code", None) == 409
    assert db.query(AtoDoEncarregado).filter(AtoDoEncarregado.numero == numero).count() == 0


def test_o_banco_nao_aceita_dois_atos_aguardando_nem_dois_vigentes(db, sem_atos):
    _, usuario = _criar_associado(db, _nome("Quem Gera"), nome_nivel="Presidente")
    presidente, _ = _criar_associado(db, _nome("Presidente Do Indice"))
    for situacao in (RASCUNHO, VIGENTE):
        base = 8_000_000 + int(uuid.uuid4().int % 100000) * 2
        for i in range(2):  # como se dois pedidos ao mesmo tempo tivessem escapado da trava de linha
            db.add(AtoDoEncarregado(numero=base + i, situacao=situacao, texto="x", id_associado_encarregado=presidente.id_associado, nome_encarregado="x",
                                    gerado_em=_FUTURO, id_usuario_geracao=usuario.id_usuario))
        with pytest.raises(Exception) as recusa:
            encarregado._gravar(db)
        assert getattr(recusa.value, "status_code", None) == 409, situacao
        assert db.query(AtoDoEncarregado).filter(AtoDoEncarregado.situacao == situacao).count() == 0


def test_o_mandato_que_termina_conta_ate_a_vespera_do_fim_em_belem(db):
    vice, _ = _criar_associado(db, _nome("Vice Que Sai"))
    _mandato(db, vice, "VICE_PRESIDENTE", datetime(2170, 1, 1), dias=365)  # fim previsto 01/01/2171
    assert encarregado.quem_e_hoje(db, datetime(2171, 1, 1, 1, 30))[1]["nome"] == vice.nome_completo, "22h30 do dia 31 em Belém: ainda vale"
    assert encarregado.quem_e_hoje(db, datetime(2171, 1, 1, 3, 30))[1] is None, "o dia do fim previsto em Belém: já não vale"


def test_o_pdf_traz_o_texto_guardado_e_quebra_a_pagina(db):
    ato = AtoDoEncarregado(numero=987654, texto="ATO Nº 987654 — TÍTULO\n\n" + "\n".join(f"Parágrafo {i}: " + "palavra " * 40 for i in range(40)), gerado_em=_FUTURO)
    leitor = pypdf.PdfReader(io.BytesIO(encarregado.pdf(ato)))
    assert len(leitor.pages) > 1, "texto que não cabe numa página continua na seguinte"
    texto = "\n".join(p.extract_text() for p in leitor.pages)
    assert "Parágrafo 0" in texto and "Parágrafo 39" in texto and "Ato nº 987654" in texto


# ------------------------------------------------------------------------------------------------ 6. pelas rotas, com a Auditoria
def test_pelas_rotas_gerar_assinar_e_baixar_vao_para_a_auditoria(client, db, auth_headers, sem_atos):
    # o banco é compartilhado com a suíte inteira: garante UM Presidente vigente hoje e compara com quem o serviço diz que é (não com um nome fixo)
    presidente, _ = _criar_associado(db, _nome("Presidente De Hoje"))
    mandato = _mandato(db, presidente, "PRESIDENTE", datetime.utcnow() - timedelta(days=2))
    try:
        _pelas_rotas(client, db, auth_headers)
    finally:
        mandato.data_fim_efetivo = datetime.utcnow()
        db.commit()


def _pelas_rotas(client, db, auth_headers):
    esperado = encarregado.quem_e_hoje(db)[0]["nome"]
    gerado = client.post("/api/privacidade/encarregado/atos", headers=auth_headers)
    assert gerado.status_code == 200, gerado.text
    assert gerado.json()["pode_gerir"] is True
    rascunho = gerado.json()["rascunho"]
    assert rascunho["nome_encarregado"] == esperado and rascunho["situacao"] == RASCUNHO

    pdf = client.get(f"/api/privacidade/encarregado/atos/{rascunho['id_ato']}/pdf", headers=auth_headers)
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content.startswith(b"%PDF")
    assert pdf.headers["cache-control"] == "no-store"

    assinado = client.post(
        f"/api/privacidade/encarregado/atos/{rascunho['id_ato']}/assinado", files={"arquivo": ("Ato nº 1 assinado.pdf", _PDF, "application/pdf")}, headers=auth_headers,
    )
    assert assinado.status_code == 200, assinado.text
    vigente = assinado.json()["ato_vigente"]
    assert vigente["id_ato"] == rascunho["id_ato"] and vigente["tem_copia_assinada"] and assinado.json()["rascunho"] is None

    copia = client.get(f"/api/privacidade/encarregado/atos/{vigente['id_ato']}/assinado", headers=auth_headers)
    assert copia.status_code == 200 and copia.content == _PDF and copia.headers["content-disposition"].startswith("attachment")
    ato = db.get(AtoDoEncarregado, vigente["id_ato"])
    assert client.get(f"/uploads/documentos-originais/{ato.assinado_arquivo}").status_code == 404, "a cópia assinada nunca sai pelo endereço público"

    acoes = [a for (a,) in db.query(AuditLog.acao).filter(AuditLog.tabela_afetada == "atos_do_encarregado", AuditLog.id_registro_afetado == vigente["id_ato"]).all()]
    assert {"ATO_GERADO", "ATO_ASSINADO", "ATO_ASSINADO_BAIXADO"} <= set(acoes)
    assert client.get("/api/privacidade/encarregado/atos/99999999/pdf", headers=auth_headers).status_code == 404


# ------------------------------------------------------------------------------------------------ 7. os dados fixos são os do site
def test_os_dados_fixos_da_associacao_no_ato_sao_os_do_site():
    ts = (Path(__file__).resolve().parent.parent / "site" / "src" / "config" / "organizacao.ts").read_text(encoding="utf-8")

    def valor(campo: str) -> str:
        return re.search(rf"\b{campo}: '([^']+)'", ts).group(1)

    padrao = encarregado.ORGANIZACAO_PADRAO
    assert padrao["cnpj"] == valor("cnpj") and padrao["email"] == valor("email")
    assert padrao["nome"].startswith(valor("nome")) and valor("sigla") in padrao["nome"]
    for campo in ("logradouro", "numero", "bairro", "cep", "cidade", "uf"):
        assert valor(campo) in padrao["endereco"] or valor(campo) in padrao["cidade"], campo


# ------------------------------------------------------------------------------------------------ 8. a migração
_CAMINHO = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "56d7ae211884_v7_0a_encarregado.py"
_TABELAS = ("usuarios", "niveis_acesso", "pessoas", "associados", "permissoes_sistema", "perfil_permissao", "catalogos", "opcoes_catalogo")


def _carregar():
    especificacao = importlib.util.spec_from_file_location("migracao_encarregado", _CAMINHO)
    modulo = importlib.util.module_from_spec(especificacao)
    especificacao.loader.exec_module(modulo)
    return modulo


def _rodar(motor, funcao):
    with motor.begin() as conexao:
        with Operations.context(MigrationContext.configure(conexao)):
            funcao()


def _banco_existente():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[Base.metadata.tables[t] for t in _TABELAS])
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
        for codigo, permissoes in (
            ("PRESIDENTE", ["gerenciar_acesso"]), ("VICE_PRESIDENTE", ["associados"]), ("VICE_PRESIDENTE_2", ["associados"]), ("SECRETARIO", ["associados"]),
        ):
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


def test_a_migracao_da_ver_aos_tres_cargos_e_gerir_so_ao_presidente_e_nada_mais():
    motor = _banco_existente()
    migracao = _carregar()
    _rodar(motor, migracao.upgrade)
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso", "privacidade", "privacidade_gerir"}
    assert _do_nivel(motor, "Diretoria") == {"associados"}
    assert _do_cargo(motor, "PRESIDENTE") == {"gerenciar_acesso", "privacidade", "privacidade_gerir"}
    assert _do_cargo(motor, "VICE_PRESIDENTE") == {"associados", "privacidade"} and _do_cargo(motor, "VICE_PRESIDENTE_2") == {"associados", "privacidade"}
    assert _do_cargo(motor, "SECRETARIO") == {"associados"}
    assert "atos_do_encarregado" in set(sa.inspect(motor).get_table_names())
    _rodar(motor, migracao.downgrade)
    assert _do_nivel(motor, "Presidente") == {"gerenciar_acesso"} and _do_cargo(motor, "PRESIDENTE") == {"gerenciar_acesso"}
    assert _do_cargo(motor, "VICE_PRESIDENTE") == {"associados"}
    assert "atos_do_encarregado" not in set(sa.inspect(motor).get_table_names())
    with motor.connect() as c:
        assert c.execute(
            sa.select(sa.func.count()).select_from(PermissaoSistema).where(PermissaoSistema.codigo_permissao.in_(("privacidade", "privacidade_gerir")))
        ).scalar() == 0


def test_a_migracao_cria_exatamente_a_tabela_que_o_modelo_descreve():
    motor = sa.create_engine("sqlite://")
    Base.metadata.create_all(motor, tables=[t for nome, t in Base.metadata.tables.items() if nome != "atos_do_encarregado"])
    _rodar(motor, _carregar().upgrade)
    with motor.connect() as conexao:
        diferencas = compare_metadata(MigrationContext.configure(conexao), Base.metadata)
    sobre_a_tabela = [repr(d) for item in diferencas for d in (item if isinstance(item, list) else [item]) if "atos_do_encarregado" in repr(d)]
    assert sobre_a_tabela == [], "a migração e o modelo divergem:\n" + "\n".join(sobre_a_tabela)


def test_a_migracao_continua_a_cadeia_sem_segunda_cabeca():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parent.parent / "alembic"))
    diretorio = ScriptDirectory.from_config(config)
    assert "56d7ae211884" in {r.revision for r in diretorio.walk_revisions()} and len(diretorio.get_heads()) == 1
    assert diretorio.get_revision("56d7ae211884").down_revision == "e8a2c4f6b913"
